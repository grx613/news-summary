// Ежедневный сбор саммари по фиксированному списку тикеров.
// Работает внутри процесса сервера: так кеш один, и запись в cache.json не конфликтует.

const TICK_MS = 10 * 60_000; // как часто проверяем, не пора ли кого-то обновить
const RETRY_FAILED_MS = 6 * 3600_000; // неудача по тикеру — не долбим его чаще, чем раз в 6 часов
const FIRST_DELAY_MS = 60_000; // не стартуем одновременно с загрузкой сервера
const THIN_STRIKES = 2; // столько сухих прогонов подряд — и тикер выпадает из ротации
// «Тонкий» тикер выпадает не навсегда: раз в неделю его пробуют снова. Постоянное
// исключение было ошибкой — 404 не стоит денег (MIN_NEWS срабатывает до вызова модели),
// а страница при этом навсегда оставалась со старой сводкой
const THIN_RETRY_MS = 7 * 24 * 3600_000;

// state переживает перезапуск: сюда складываем счётчики «сухих» тикеров
export function createCrawler({ cfg, log, cache, cacheKey, isFresh, refresh, listUniverse, state, onDone, ttlMs = 0 }) {
  const persistent = state || {};
  if (!persistent.thin) persistent.thin = {};
  if (!persistent.thinAt) persistent.thinAt = {};
  if (!persistent.backoff) persistent.backoff = {};

  const runtime = {
    running: false,
    lastRunAt: null,
    lastRunMs: null,
    lastStats: null,
    universeSize: 0,
    ok: 0,
    failed: 0,
    thinCount: 0,
    errors: [],
  };

  // Сразу после старта показываем реальное число, не дожидаясь первого прогона
  runtime.thinCount = Object.values(persistent.thin).filter((n) => n >= THIN_STRIKES).length;

  // key -> timestamp, до которого тикер не трогаем после ошибки.
  // Живёт в файле, а не только в памяти: перезапуск сбрасывал его, крон через минуту
  // снова бил по тем же тикерам и второй раз засчитывал страйк за те же сутки
  const backoff = new Map(Object.entries(persistent.backoff));
  let timer = null;

  const age = (rec) => (rec ? Date.now() - new Date(rec.generatedAt).getTime() : Infinity);

  // Крон обновляет чуть раньше истечения TTL, чтобы у посетителей почти никогда
  // не случался «протухший» кеш и лишняя генерация по кнопке.
  // Считается от TTL, а не от интервала крона: если TTL окажется короче интервала,
  // сводки будут протухать между прогонами, и никакая доля интервала это не исправит
  const dueAfter = ttlMs ? Math.min(cfg.intervalMs * 0.9, ttlMs * 0.85) : cfg.intervalMs * 0.9;

  async function runOnce() {
    if (runtime.running) return runtime;
    runtime.running = true;
    const started = Date.now();

    const stats = { total: 0, done: 0, skipped: 0, failed: 0, thin: 0 };
    try {
      const universe = await listUniverse();
      const items = universe.items || [];
      runtime.universeSize = items.length;

      const queue = items.filter((a) => {
        const key = cacheKey(a);
        const rec = cache[key];
        if (rec && age(rec) < dueAfter) return false;
        if ((backoff.get(key) || 0) > Date.now()) return false;
        // Тикер дважды подряд остался без публикаций: модель по нему пишет «данных нет».
        // Держим его вне ротации, но не вечно — через неделю пробуем снова, иначе
        // страница навсегда остаётся со сводкой недельной давности
        if ((persistent.thin[key] || 0) >= THIN_STRIKES) {
          const since = persistent.thinAt[key] || 0;
          if (Date.now() - since < THIN_RETRY_MS) {
            stats.thin++;
            return false;
          }
          delete persistent.thin[key];
          delete persistent.thinAt[key];
        }
        return true;
      });
      stats.total = queue.length;
      stats.skipped = items.length - queue.length - stats.thin;
      log(`крон: в списке ${items.length}, к обновлению ${queue.length}, тонких ${stats.thin}`);

      if (queue.length) {
        let cursor = 0;
        const worker = async () => {
          while (cursor < queue.length && runtime.running) {
            const asset = queue[cursor++];
            const key = cacheKey(asset);
            try {
              // Пока очередь ждала, тикер мог обновить пользователь — тогда не тратим деньги
              if (isFresh(cache[key]) && age(cache[key]) < dueAfter) {
                stats.skipped++;
                continue;
              }
              await refresh(asset);
              stats.done++;
              runtime.ok++;
              persistent.thin[key] = 0;
              delete persistent.thinAt[key];
              backoff.delete(key);
              persistent.backoff[key] = 0;
            } catch (e) {
              stats.failed++;
              runtime.failed++;
              backoff.set(key, Date.now() + RETRY_FAILED_MS);
              persistent.backoff[key] = Date.now() + RETRY_FAILED_MS;
              // 404 = публикаций не нашлось: считаем страйк, чтобы не платить за тикер ежедневно
              if (e.status === 404) {
                persistent.thin[key] = (persistent.thin[key] || 0) + 1;
                // Момент первого страйка: от него отсчитывается неделя до повторной попытки
                if (!persistent.thinAt[key]) persistent.thinAt[key] = Date.now();
              }
              const msg = `${asset.market}:${asset.symbol} — ${e.message}`;
              runtime.errors.push(msg);
              if (runtime.errors.length > 40) runtime.errors.shift();
              log(`крон: ${msg}`);
            }
            if (cfg.gapMs) await new Promise((r) => setTimeout(r, cfg.gapMs));
          }
        };
        await Promise.all(Array.from({ length: Math.max(1, cfg.concurrency) }, worker));
      }

      log(`крон: готово ${stats.done}, ошибок ${stats.failed}, пропущено ${stats.skipped + stats.thin}`);
    } catch (e) {
      log(`крон: запуск не удался — ${e.message}`);
      runtime.errors.push(`запуск: ${e.message}`);
    } finally {
      runtime.running = false;
      runtime.lastRunAt = new Date().toISOString();
      runtime.lastRunMs = Date.now() - started;
      runtime.lastStats = stats;
      runtime.thinCount = Object.values(persistent.thin).filter((n) => n >= THIN_STRIKES).length;
      // Просроченные отсрочки не копим: файл не должен расти от старых неудач
      const now = Date.now();
      for (const [k, until] of Object.entries(persistent.backoff)) {
        if (!until || until <= now) delete persistent.backoff[k];
      }
      if (onDone) onDone();
    }
    return runtime;
  }

  function schedule(delay) {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      await runOnce().catch(() => {});
      schedule(TICK_MS);
    }, delay);
    if (timer.unref) timer.unref();
  }

  return {
    start() {
      if (!cfg.enabled) return;
      schedule(FIRST_DELAY_MS);
      log(`крон включён: обновление раз в ${cfg.intervalMs / 3600_000} ч, параллельно ${cfg.concurrency}`);
    },
    stop() {
      clearTimeout(timer);
      runtime.running = false;
    },
    runNow: runOnce,
    status: () => ({
      enabled: cfg.enabled,
      running: runtime.running,
      intervalHours: cfg.intervalMs / 3600_000,
      // Порог, после которого сводка считается устаревшей у посетителя: крон обязан
      // обновлять раньше этого момента, иначе страница протухает между прогонами
      dueAfterHours: Number((dueAfter / 3600_000).toFixed(1)),
      universeSize: runtime.universeSize,
      lastRunAt: runtime.lastRunAt,
      lastRunSec: runtime.lastRunMs ? Math.round(runtime.lastRunMs / 1000) : null,
      lastStats: runtime.lastStats,
      totals: { ok: runtime.ok, failed: runtime.failed },
      thinCount: runtime.thinCount,
      recentErrors: runtime.errors.slice(-5),
    }),
  };
}
