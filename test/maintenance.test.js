const test = require('node:test');
const assert = require('node:assert/strict');
const { createCacheMaintenance, WEEK_MS } = require('../cache-maintenance');
const { applyStartupSetting } = require('../startup');

test('weekly cleanup waits for idle, persists date and preserves storage', async () => {
    let time = WEEK_MS * 2, busy = true, saved = 0, calls = 0;
    const maintenance = createCacheMaintenance({
        sessions: () => [{ clearCache: async () => { calls++; }, clearStorageData: () => assert.fail('Storage must be preserved') }],
        isBusy: () => busy, readLastClear: () => saved,
        writeLastClear: value => { saved = value; }, now: () => time
    });
    await maintenance.check();
    assert.equal(calls, 0);
    busy = false;
    await maintenance.check();
    assert.equal(saved, time);
    await maintenance.check();
    assert.equal(calls, 1);
    time += WEEK_MS;
    await maintenance.check();
    assert.equal(calls, 2);
    busy = true;
    assert.equal((await maintenance.request()).pending, true);
    busy = false;
    await maintenance.check();
    assert.equal(calls, 3);
    assert.equal(maintenance.status().pending, false);
});

test('cleanup is serialized and media can wait for completion', async () => {
    let finish, calls = 0, ready = false;
    const maintenance = createCacheMaintenance({
        sessions: () => [{ clearCache: () => { calls++; return new Promise(resolve => { finish = resolve; }); } }],
        isBusy: () => false, readLastClear: () => 0, writeLastClear: () => {}, now: () => WEEK_MS
    });
    const first = maintenance.check();
    const second = maintenance.check();
    const media = maintenance.waitForClear().then(() => { ready = true; });
    assert.equal(ready, false);
    assert.equal(calls, 1);
    finish();
    await Promise.all([first, second, media]);
    assert.equal(ready, true);
    assert.equal(maintenance.status().running, false);
});

test('failure keeps prior date and retries after an hour', async () => {
    let time = WEEK_MS * 2, calls = 0;
    const maintenance = createCacheMaintenance({
        sessions: () => [{ clearCache: async () => { if (++calls === 1) throw new Error('busy'); } }],
        isBusy: () => false, readLastClear: () => 1, writeLastClear: () => {}, now: () => time
    });
    assert.ok((await maintenance.check()).error);
    assert.equal(maintenance.status().lastClear, 1);
    await maintenance.check();
    assert.equal(calls, 1);
    time += 3600000;
    assert.equal((await maintenance.check()).error, null);
    assert.equal(calls, 2);
});

test('startup uses portable path and never changes Windows in development', () => {
    const calls = [];
    const app = { isPackaged: false, setLoginItemSettings: value => calls.push(value), getPath: () => 'fallback.exe' };
    applyStartupSetting(app, true, 'portable.exe');
    assert.equal(calls.length, 0);
    if (process.platform !== 'win32') return;
    app.isPackaged = true;
    applyStartupSetting(app, false, 'C:\\Portable folder\\overlay.exe');
    assert.deepEqual(calls[0], { openAtLogin: false, enabled: false, path: 'C:\\Portable folder\\overlay.exe', args: [] });
    applyStartupSetting(app, true);
    assert.equal(calls[1].path, 'fallback.exe');
    assert.equal(calls[1].openAtLogin, true);
});
