const { app, BrowserWindow, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const profile = path.join(__dirname, '../node_modules/.settings-smoke-profile');
app.setPath('userData', profile);
app.on('browser-window-created', (_event, window) => {
    window.show = () => {};
    window.showInactive = () => {};
    window.hide();
});
app.whenReady().then(() => {
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['wss://livechat-bot-0m01.onrender.com/*'] }, (_details, callback) => callback({ cancel: true }));
});
require('../main');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(callback) {
    for (let i = 0; i < 150; i++) { const value = await callback(); if (value) return value; await sleep(100); }
    throw new Error('Timed out');
}
(async () => {
    await app.whenReady();
    const overlay = await waitFor(() => BrowserWindow.getAllWindows().find(window => /:\d+\/$/.test(window.webContents.getURL()) && !window.webContents.isLoading()));
    await overlay.webContents.executeJavaScript('window.electronAPI.openSettings()');
    const config = await waitFor(() => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/settings') && !window.webContents.isLoading()));
    await waitFor(() => config.webContents.executeJavaScript('!document.getElementById("controls").disabled'));
    await config.webContents.executeJavaScript(`(async () => {
        await window.electronAPI.settingsAction('reset');
        await window.electronAPI.saveSettings({openAtLogin: true});
        volume.value = 37; volume.dispatchEvent(new Event('input'));
        scale.value = 95; scale.dispatchEvent(new Event('input'));
        document.querySelector('[data-position="2"]').click();
        await pending;
    })()`);
    const settings = await overlay.webContents.executeJavaScript('({ volume: currentVolume, scale: currentScale, positionIndex: currentPosIndex })');
    assert.deepEqual(settings, { volume: .37, scale: .95, positionIndex: 2 });
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(profile, 'settings.json'), 'utf8')), { ...settings, youtubeFormat: 'auto', openAtLogin: true });
    await config.webContents.executeJavaScript(`youtubeFormat.value = 'portrait'; youtubeFormat.dispatchEvent(new Event('change')); pending`);
    assert.equal(await overlay.webContents.executeJavaScript('currentYoutubeFormat'), 'portrait');
    await overlay.webContents.executeJavaScript('changeVolume(.1)');
    await waitFor(() => config.webContents.executeJavaScript('volume.value === "47"'));
    await config.webContents.executeJavaScript('window.electronAPI.settingsAction("preview")');
    assert.equal(await overlay.webContents.executeJavaScript('widget.style.display'), 'flex');
    await config.webContents.executeJavaScript('window.electronAPI.settingsAction("stop")');
    assert.equal(await overlay.webContents.executeJavaScript('widget.style.display'), 'none');
    await config.webContents.executeJavaScript('window.electronAPI.settingsAction("reset")');
    assert.equal(await overlay.webContents.executeJavaScript('currentScale'), .7);
    await config.webContents.executeJavaScript(`openAtLogin.checked = false; openAtLogin.dispatchEvent(new Event('change')); pending`);
    assert.equal(JSON.parse(fs.readFileSync(path.join(profile, 'settings.json'), 'utf8')).openAtLogin, false);
    await session.defaultSession.cookies.set({ url: 'https://cache-test.example', name: 'keep', value: 'yes' });
    await config.webContents.executeJavaScript(`localStorage.setItem('cache-test', 'keep')`);
    const cleared = await config.webContents.executeJavaScript('window.electronAPI.clearCache()');
    assert.ok(cleared.lastClear > 0);
    assert.equal(cleared.error, null);
    assert.equal((await session.defaultSession.cookies.get({ name: 'keep' }))[0].value, 'yes');
    assert.equal(await config.webContents.executeJavaScript(`localStorage.getItem('cache-test')`), 'keep');
    assert.equal(JSON.parse(fs.readFileSync(path.join(profile, 'settings.json'), 'utf8')).openAtLogin, false);
    BrowserWindow.prototype.showInactive.call(config);
    await sleep(600);
    const bounds = await config.webContents.executeJavaScript('({ scroll: document.documentElement.scrollHeight, viewport: innerHeight, width:innerWidth, boxes: [...document.querySelectorAll("header, main, .shortcuts, footer")].map(x=>({tag:x.tagName,height:x.getBoundingClientRect().height})) })');
    assert.ok(bounds.scroll <= bounds.viewport, JSON.stringify(bounds));
    fs.writeFileSync(path.join(profile, 'configuration.png'), (await config.webContents.capturePage()).toPNG());
    config.close();
    await waitFor(() => config.isDestroyed());
    await overlay.webContents.executeJavaScript('window.electronAPI.openSettings()');
    await waitFor(() => BrowserWindow.getAllWindows().some(window => window.webContents.getURL().endsWith('/settings') && !window.webContents.isLoading()));
    const close = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/close'));
    assert.ok(close);
    close.showInactive = () => BrowserWindow.prototype.showInactive.call(close);
    assert.equal(close.isVisible(), false);
    assert.equal(await overlay.webContents.executeJavaScript('widget.style.top'), '10px');
    await overlay.webContents.executeJavaScript(`handleMessage({data: JSON.stringify({type:'play_media', text:'Test de fermeture', author:'Alice'})})`);
    await waitFor(() => close.isVisible());
    const reopened = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/settings'));
    assert.equal(await reopened.webContents.executeJavaScript('openAtLogin.checked'), false);
    assert.equal((await reopened.webContents.executeJavaScript('window.electronAPI.clearCache()')).pending, true);
    for (const positionIndex of [0, 1, 2, 3]) {
        await overlay.webContents.executeJavaScript(`applySettings({positionIndex: ${positionIndex}, scale: 0.9})`);
        const rect = await overlay.webContents.executeJavaScript('({right: authorContainer.getBoundingClientRect().right, top: authorContainer.getBoundingClientRect().top, height: authorContainer.getBoundingClientRect().height})');
        const origin = overlay.getBounds();
        await waitFor(() => Math.abs(close.getBounds().x - (origin.x + rect.right + 8)) <= 1 && Math.abs(close.getBounds().y + 16 - (origin.y + rect.top + rect.height / 2)) <= 1);
    }
    await close.webContents.executeJavaScript('document.getElementById("stop").click()');
    await waitFor(() => !close.isVisible());
    await waitFor(() => reopened.webContents.executeJavaScript('window.electronAPI.cacheStatus().then(s => !s.pending && !s.running)'));
    assert.equal(overlay.isDestroyed(), false);
    assert.equal(await overlay.webContents.executeJavaScript('widget.style.display'), 'none');
    await overlay.webContents.executeJavaScript(`handleMessage({data: JSON.stringify({type:'play_media', text:'Le prochain message fonctionne'})})`);
    await waitFor(() => close.isVisible());
    await overlay.webContents.executeJavaScript('hideWidget()');
    await waitFor(() => !close.isVisible());
    console.log('Settings native checks passed, including conditional stop button, next message and unchanged top-right position.');
    app.quit();
})().catch(error => { console.error(error); app.exit(1); });
