const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const MediaUtils = require('../media-utils');
const { startOverlayServer } = require('../overlay-server');
const { configureMediaRequests } = require('../media-network');

test('Twitter media omit the loopback Referer without changing other headers or YouTube', () => {
    let handler;
    configureMediaRequests({ webRequest: { onBeforeSendHeaders(filter, callback) {
        assert.deepEqual(filter.urls, ['https://video.twimg.com/*']);
        handler = callback;
    } } });
    const headers = { Referer: 'http://127.0.0.1:1234/', Range: 'bytes=0-', 'User-Agent': 'Electron' };
    handler({ resourceType: 'media', requestHeaders: headers }, result => {
        assert.deepEqual(result.requestHeaders, { Range: 'bytes=0-', 'User-Agent': 'Electron' });
    });
    assert.ok(headers.Referer);
    handler({ resourceType: 'xhr', requestHeaders: headers }, result => assert.deepEqual(result.requestHeaders, headers));
});

test('YouTube links, Shorts, embeds and timestamps', () => {
    for (const url of [
        'https://www.youtube.com/watch?v=M7lc1UVf-VE&t=1m30s',
        'https://youtu.be/M7lc1UVf-VE?t=90',
        'https://m.youtube.com/shorts/M7lc1UVf-VE?start=90',
        'https://youtube.com/live/M7lc1UVf-VE#t=90',
        'https://www.youtube-nocookie.com/embed/M7lc1UVf-VE?start=90'
    ]) assert.deepEqual(MediaUtils.youtubeVideo(url), { id: 'M7lc1UVf-VE', start: 90, ...(url.includes('/shorts/') ? { portrait: true } : {}) });
    for (const url of ['https://youtube.com.evil.test/watch?v=M7lc1UVf-VE', 'https://evil.test/youtube.com/watch?v=M7lc1UVf-VE', 'https://youtube.com/watch?v=invalid', null, {}]) {
        assert.equal(MediaUtils.youtubeVideo(url), null);
    }
});

test('Reject local, executable and credentialed URLs', () => {
    for (const url of ['javascript:alert(1)', 'file:///C:/secret', 'data:text/html,hello', 'https://user:pass@example.com', {}, null]) {
        assert.equal(MediaUtils.safeUrl(url), null);
    }
});

function renderer() {
    class Element {
        constructor(tag = 'div') { this.tagName = tag.toUpperCase(); this.style = { setProperty() {} }; this.children = []; }
        appendChild(child) { this.children.push(child); return child; }
        replaceChildren() { this.children = []; }
        querySelector(tag) { return this.children.find(child => child.tagName === tag.toUpperCase()); }
        removeAttribute(name) { delete this[name]; }
        setAttribute(name, value) { this[name] = value; }
        pause() { this.paused = true; }
        load() {}
        play() { return Promise.resolve(); }
    }
    const elements = new Map();
    const timers = new Map();
    let nextTimer = 1;
    const context = vm.createContext({
        MediaUtils, URL, AbortController, AbortSignal, console,
        location: { origin: 'http://127.0.0.1:1234' },
        setTimeout(fn) { const id = nextTimer++; timers.set(id, fn); return id; },
        clearTimeout(id) { timers.delete(id); }, setInterval() {}, clearInterval() {},
        document: {
            getElementById(id) { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); },
            createElement(tag) { return new Element(tag); }, documentElement: new Element(), head: new Element()
        },
        WebSocket: class { static OPEN = 1; },
        window: { electronAPI: { loadSettings: async () => null, saveSettings: async () => {} } }
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../renderer.js'), 'utf8'), context);
    return { context, elements, timers, run: code => vm.runInContext(code, context), send: data => context.handleMessage({ data: JSON.stringify(data) }) };
}

test('Malformed messages cannot crash the handler; text stays text', async () => {
    const r = renderer();
    await r.context.handleMessage({ data: 'not-json' });
    await r.send(null);
    await r.send({ type: 'play_media', text: '<img src=x onerror=alert(1)>' });
    assert.equal(r.elements.get('text-container').innerText, '<img src=x onerror=alert(1)>');
});

test('Stop button follows media activity and top-right keeps the original margin', async () => {
    const r = renderer();
    const activity = [];
    r.context.window.electronAPI.setMediaActive = active => activity.push(active);
    r.context.showLaunchAnnouncement();
    assert.equal(activity.at(-1), false);
    await r.send({ type: 'play_media', text: 'Message reçu' });
    assert.equal(activity.at(-1), true);
    r.context.applySettings({ positionIndex: 0 });
    assert.equal(r.elements.get('widget-container').style.top, '10px');
    r.context.hideWidget();
    assert.equal(activity.at(-1), false);
    r.context.showConfigurationPreview();
    assert.equal(activity.at(-1), false);
});

test('Slow resolution and stale video events cannot replace a newer message', async () => {
    const r = renderer();
    let resolve;
    r.context.fetch = () => new Promise(done => { resolve = done; });
    const old = r.send({ type: 'play_media', url: 'https://x.com/name/status/123', text: 'old' });
    await r.send({ type: 'play_media', url: 'https://example.com/new.mp4', text: 'new' });
    const video = r.elements.get('media-container').children[0];
    resolve({ ok: true, json: async () => ({ media_extended: [{ type: 'video', url: 'https://example.com/old.mp4' }] }) });
    await old;
    assert.equal(r.elements.get('media-container').children[0], video);
    r.context.changeSize(0.1);
    r.context.cyclePosition();
    assert.equal(r.elements.get('media-container').children[0], video);
    await r.send({ type: 'play_media', text: 'latest' });
    video.onended();
    video.onerror();
    assert.equal(r.elements.get('text-container').innerText, 'latest');
});

test('URLs containing quotes are assigned as attributes, never HTML', async () => {
    const r = renderer();
    await r.send({ type: 'play_media', url: 'https://example.com/image.png?x=" onerror="alert(1)' });
    const element = r.elements.get('media-container').children[0];
    assert.equal(element.tagName, 'IMG');
    assert.ok(element.src.includes('%22'));
    await r.send({ type: 'play_media', url: 'javascript:alert(1)' });
    assert.equal(r.elements.get('media-container').children.length, 0);
});

test('Discord GIF attachments preserve signed URLs and stop normally', async () => {
    const r = renderer();
    const url = 'https://cdn.discordapp.com/attachments/123/456/animation.gif?ex=abcdef&is=123456&hm=signature';
    await r.send({ type: 'play_media', url, author: 'Discord' });
    const gif = r.elements.get('media-container').children[0];
    assert.equal(gif.tagName, 'IMG');
    assert.equal(gif.src, url);
    r.context.hideWidget();
    assert.equal(r.elements.get('media-container').children.length, 0);
});

test('Tenor links in command text resolve as images; obsolete resolutions cannot replace new media', async () => {
    const r = renderer();
    const url = 'https://tenor.com/fr/view/the-rock-stare-thinking-gif-5680807550909397990';
    const gif = 'https://media1.tenor.com/m/TtZIXo1Pu-YAAAAC/the-rock-stare.gif';
    r.context.window.electronAPI.resolveGif = async value => { assert.equal(value, url); return gif; };
    await r.send({ type: 'play_media', text: '!livechat ' + url });
    assert.equal(r.elements.get('media-container').children[0].tagName, 'IMG');
    assert.equal(r.elements.get('media-container').children[0].src, gif);
    let finish;
    r.context.window.electronAPI.resolveGif = () => new Promise(resolve => { finish = resolve; });
    const previous = r.send({ type: 'play_media', url });
    await r.send({ type: 'play_media', text: 'Nouveau message' });
    finish(gif);
    await previous;
    assert.equal(r.elements.get('media-container').children.length, 0);
    assert.equal(r.elements.get('text-container').innerText, 'Nouveau message');
});

test('Giphy, GIFDB and direct GIF/WebP links work in command text', async () => {
    const r = renderer();
    for (const url of ['https://giphy.com/gifs/happy-abc123', 'https://gifdb.com/gif/cat-abc.html']) {
        r.context.window.electronAPI.resolveGif = async value => { assert.equal(value, url); return 'https://example.com/test.gif'; };
        await r.send({ type: 'play_media', text: '!livechat ' + url });
        assert.equal(r.elements.get('media-container').children[0].tagName, 'IMG');
    }
    r.context.window.electronAPI.resolveGif = () => assert.fail('Direct media needs no resolver');
    for (const url of ['https://example.com/a.gif?ex=123&hm=signature', 'https://example.com/a.webp']) {
        await r.send({ type: 'play_media', text: '!livechat ' + url });
        assert.equal(r.elements.get('media-container').children[0].src, url);
    }
});

test('YouTube lifecycle: timestamp, volume, errors, cleanup and text links', async () => {
    const r = renderer();
    let options, player;
    r.context.window.YT = {
        PlayerState: { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3 },
        Player: class {
            constructor(mount, config) { options = config; player = this; this.iframe = r.context.document.createElement('iframe'); this.modules = ['captions']; this.unloads = 0; }
            getOptions() { return this.modules; }
            unloadModule(name) { assert.equal(name, 'captions'); this.modules = []; this.unloads++; }
            getIframe() { return this.iframe; }
            setVolume(value) { this.volume = value; }
            playVideo() { this.played = true; }
            destroy() { this.destroyed = true; }
        }
    };
    await r.send({ type: 'play_media', text: 'Regarde https://youtu.be/M7lc1UVf-VE?t=42' });
    assert.equal(options.playerVars.start, 42);
    options.events.onReady({ target: player });
    assert.equal(player.played, true);
    assert.equal(player.unloads, 1);
    options.events.onApiChange({ target: player });
    assert.equal(player.unloads, 1); // No unload loop when the module is already gone.
    player.modules = ['captions'];
    options.events.onApiChange({ target: player });
    assert.equal(player.unloads, 2);
    r.context.changeVolume(-0.1);
    assert.equal(player.volume, 90);
    options.events.onError({ data: 101 });
    assert.equal(player.destroyed, true);
    assert.match(r.elements.get('text-container').innerText, /101/);
    await r.send({ type: 'play_media', text: 'new' });
    player.modules = ['captions'];
    options.events.onApiChange({ target: player });
    assert.equal(player.unloads, 2); // Ignore late events from a replaced player.
    options.events.onStateChange({ data: 0 });
    assert.equal(r.elements.get('text-container').innerText, 'new');
});

test('Direct video failures expire and obsolete playback promises are harmless', async () => {
    const r = renderer();
    await r.send({ type: 'play_media', url: 'https://example.com/a.mp4' });
    const video = r.elements.get('media-container').children[0];
    video.onplaying();
    assert.equal(r.timers.size, 0);
    video.onstalled();
    assert.equal(r.timers.size, 1);
    [...r.timers.values()][0]();
    assert.equal(video.paused, true);
    assert.match(r.elements.get('text-container').innerText, /Impossible/);
    assert.equal(r.elements.get('media-container').children.length, 0);
});

test('Settings restoration ignores nonfinite and fractional values', async () => {
    const r = renderer();
    r.context.window.electronAPI.loadSettings = async () => ({ volume: NaN, scale: Infinity, positionIndex: 1.5 });
    await r.context.restoreSavedSettings();
    assert.equal(r.run('currentVolume'), 1);
    assert.equal(r.run('currentScale'), 0.7);
    assert.equal(r.run('currentPosIndex'), 0);
});

test('Shorts use a portrait player; format changes keep the video running', async () => {
    const r = renderer();
    let options, player;
    r.context.window.YT = {
        PlayerState: { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3 },
        Player: class {
            constructor(mount, config) { options = config; player = this; }
            getIframe() { return r.context.document.createElement('iframe'); }
            setVolume() {} playVideo() {} destroy() {}
            setSize(width, height) { this.ratio = width / height; }
        }
    };
    await r.send({ type: 'play_media', url: 'https://youtube.com/shorts/M7lc1UVf-VE' });
    assert.equal(options.width / options.height, 9 / 16);
    options.events.onReady({ target: player });
    r.context.applySettings({ youtubeFormat: 'landscape' });
    assert.equal(player.ratio, 16 / 9);
    r.context.applySettings({ youtubeFormat: 'portrait', scale: .3 });
    assert.equal(player.ratio, 9 / 16);
    assert.equal(r.run('youtubeReady'), true);
    assert.ok(r.run('youtubeSize().width * currentScale') >= 200);
});

test('Loopback server exposes only app assets with CSP and a Referer policy', async t => {
    const { server, origin } = await startOverlayServer(path.join(__dirname, '..'));
    t.after(() => server.close());
    const response = await fetch(origin);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
    assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.match(await response.text(), /renderer.js/);
    for (const file of ['/main.js', '/package.json', '/.git/config', '/..%2Fmain.js']) {
        assert.equal((await fetch(origin + file)).status, 404);
    }
    const status = await new Promise((resolve, reject) => {
        require('node:http').get(origin, { headers: { Host: 'evil.test' } }, res => {
            res.resume();
            resolve(res.statusCode);
        }).on('error', reject);
    });
    assert.equal(status, 404);
});
