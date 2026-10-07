// Native Chromium checks, isolated from the production WebSocket server.
const { app, BrowserWindow, session, ipcMain } = require('electron');
const path = require('node:path');
const assert = require('node:assert/strict');
const { startOverlayServer } = require('../overlay-server');
const { configureMediaRequests } = require('../media-network');
app.setPath('userData', path.join(__dirname, '../node_modules/.smoke-profile'));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
ipcMain.handle('load-settings', () => null);
ipcMain.handle('save-settings', () => {});
ipcMain.handle('prepare-media', () => true);
let server;
const deadline = setTimeout(() => { console.error('Smoke test timed out'); app.exit(1); }, 55000);
app.whenReady().then(async () => {
    const local = await startOverlayServer(path.join(__dirname, '..'));
    server = local.server;
    configureMediaRequests(session.defaultSession);
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['wss://livechat-bot-0m01.onrender.com/*'] }, (_details, callback) => callback({ cancel: true }));
    const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, preload: path.join(__dirname, '../preload.js') } });
    const errors = [];
    window.webContents.on('console-message', details => {
        if (details?.level === 'error') errors.push(details.message);
    });
    await window.loadURL(local.origin + '/');
    const result = await window.webContents.executeJavaScript(`(async () => {
        await handleMessage({ data: JSON.stringify({ type: 'play_media', text: '<b>test</b>', author: 'Smoke' }) });
        changeSize(0.1);
        cyclePosition();
        const result = { text: textContainer.textContent, author: authorName.textContent, visible: widget.style.display, bridge: typeof window.electronAPI.loadSettings };
        await handleMessage({ data: JSON.stringify({ type: 'play_media', url: 'javascript:alert(1)' }) });
        result.invalid = textContainer.textContent;
        hideWidget();
        return result;
    })()`);
    assert.equal(result.text, '<b>test</b>');
    assert.equal(result.author, 'Smoke');
    assert.equal(result.visible, 'flex');
    assert.equal(result.bridge, 'function');
    assert.match(result.invalid, /impossible/);
    console.log('Native Electron DOM/preload/CSP smoke checks passed');
    if (process.env.LIVE_YOUTUBE === '1') {
        const youtube = await window.webContents.executeJavaScript(`(async () => {
            await handleMessage({ data: JSON.stringify({ type: 'play_media', url: 'https://www.youtube.com/watch?v=M7lc1UVf-VE' }) });
            const deadline = Date.now() + 30000;
            while (Date.now() < deadline) {
                if (youtubeReady && youtubePlayer?.getPlayerState() === 1) {
                    const result = { state: 'playing', time: youtubePlayer.getCurrentTime(), volume: youtubePlayer.getVolume() };
                    changeVolume(-0.2);
                    await new Promise(resolve => setTimeout(resolve, 700));
                    result.adjustedVolume = youtubePlayer.getVolume();
                    result.laterTime = youtubePlayer.getCurrentTime();
                    result.captionUnloadSupported = typeof youtubePlayer.unloadModule === 'function';
                    result.captionUnloads = 0;
                    if (result.captionUnloadSupported) {
                        const unload = youtubePlayer.unloadModule.bind(youtubePlayer);
                        youtubePlayer.unloadModule = name => { result.captionUnloads++; unload(name); };
                        youtubePlayer.loadModule('captions');
                        await new Promise(resolve => setTimeout(resolve, 300));
                        youtubePlayer.setOption('captions', 'track', { languageCode: 'en' });
                        const captionDeadline = Date.now() + 5000;
                        while (Date.now() < captionDeadline) {
                            await new Promise(resolve => setTimeout(resolve, 200));
                            if (result.captionUnloads > 0 && Object.keys(youtubePlayer.getOption('captions', 'track') || {}).length === 0) break;
                        }
                    }
                    result.activeCaptionTrack = youtubePlayer.getOption('captions', 'track');
                    return result;
                }
                if (!youtubePlayer) return { state: 'failed', message: textContainer.innerText };
                await new Promise(resolve => setTimeout(resolve, 500));
            }
            return { state: 'timeout', ready: youtubeReady, message: textContainer.innerText };
        })()`);
        console.log('Live YouTube result:', JSON.stringify(youtube));
        assert.equal(youtube.state, 'playing');
        assert.equal(youtube.adjustedVolume, 80);
        assert.ok(youtube.laterTime > youtube.time);
        assert.equal(youtube.captionUnloadSupported, true);
        assert.ok(youtube.captionUnloads > 0);
        const frame = window.webContents.mainFrame.framesInSubtree.find(frame => frame.url.includes('youtube.com/embed/'));
        const captions = await frame.executeJavaScript(`({ pressed: document.querySelector('.ytp-subtitles-button')?.getAttribute('aria-pressed'), windows: document.querySelectorAll('.caption-window').length, track: document.querySelector('#movie_player')?.getOption?.('captions', 'track') })`);
        console.log('Caption state:', JSON.stringify(captions));
        assert.equal(captions.windows, 0);
        assert.deepEqual(captions.track, {});
        await window.webContents.executeJavaScript('hideWidget()');
    }
    console.log('Renderer error logs:', JSON.stringify(errors));
    window.destroy();
    server.close();
    clearTimeout(deadline);
    app.exit(0);
}).catch(error => { console.error(error); server?.close(); clearTimeout(deadline); app.exit(1); });
