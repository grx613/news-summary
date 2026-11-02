// Ежедневный сбор саммари по фиксированному списку тикеров.
// Работает внутри процесса сервера: так кеш один, и запись в cache.json не конфликтует.

const TICK_MS = 10 * 60_000; // как часто проверяем, не пора ли кого-то обновить
const RETRY_FAILED_MS = 6 * 3600_000; // неудача по тикеру — не долбим его чаще, чем раз в 6 часов
const FIRST_DELAY_MS = 60_000; // не стартуем одновременно с загрузкой сервера
const THIN_STRIKES = 2; // столько сухих прогонов подряд — и тикер выпадает из ротации

// state переживает перезапуск: сюда складываем счётчики «сухих» тикеров
export function createCrawler({ cfg, log, cache, cacheKey, isFresh, refresh, listUniverse, state, onDone }) {
  const persistent = state || {};
  if (!persistent.thin) persistent.thin = {};

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

  // key -> timestamp, до которого тикер не трогаем после ошибки
  const backoff = new Map();
  let timer = null;

  const age = (rec) => (rec ? Date.now() - new Date(rec.generatedAt).getTime() : Infinity);

  // Крон обновляет чуть раньше истечения TTL, чтобы у посетителей почти никогда
  // не случался «протухший» кеш и лишняя генерация по кнопке
  const dueAfter = cfg.intervalMs * 0.9;

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
        // Тикер дважды подряд остался без публикаций: модель по нему пишет «данных нет»
        // за наши деньги. Вернём в ротацию, только если его откроет человек
        if ((persistent.thin[key] || 0) >= THIN_STRIKES) {
          stats.thin++;
          return false;
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
              backoff.delete(key);
            } catch (e) {
              stats.failed++;
              runtime.failed++;
              backoff.set(key, Date.now() + RETRY_FAILED_MS);
              // 404 = публикаций не нашлось: считаем страйк, чтобы не платить за тикер ежедневно
              if (e.status === 404) persistent.thin[key] = (persistent.thin[key] || 0) + 1;
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
