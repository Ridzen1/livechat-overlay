const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Only the HTTP cache is cleared. Cookie/storage APIs are intentionally unused.
function createCacheMaintenance({ sessions, isBusy, readLastClear, writeLastClear, now = Date.now }) {
    let lastClear = Number(readLastClear()) || 0;
    let running = null;
    let requested = false;
    let error = null;
    let retryAfter = 0;
    const status = () => ({ lastClear, pending: requested, running: Boolean(running), error });
    async function check() {
        if (running) { await running; return status(); }
        const due = requested || now() - lastClear >= WEEK_MS || lastClear > now();
        if (!due || isBusy() || now() < retryAfter) return status();
        running = (async () => {
            try {
                for (const session of sessions()) await session.clearCache();
                const completed = now();
                writeLastClear(completed);
                lastClear = completed;
                requested = false;
                error = null;
            } catch {
                error = 'Le cache n’a pas pu être vidé. Une nouvelle tentative aura lieu plus tard.';
                retryAfter = now() + 60 * 60 * 1000;
            }
        })();
        await running;
        running = null;
        return status();
    }
    return {
        status, check,
        async request() { requested = true; retryAfter = 0; return check(); },
        async waitForClear() { if (running) await running; }
    };
}
module.exports = { createCacheMaintenance, WEEK_MS };
