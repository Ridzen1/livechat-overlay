const { contextBridge, ipcRenderer } = require('electron');

// On expose uniquement cette fonction précise à la fenêtre (index.html),
// rien d'autre de Node/Electron n'est accessible depuis le HTML (sécurité).
contextBridge.exposeInMainWorld('electronAPI', {
    resolveInstagramVideo: (url) => ipcRenderer.invoke('resolve-instagram-video', url),
    loadSettings: () => ipcRenderer.invoke('load-settings'),
    saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
    openSettings: () => ipcRenderer.invoke('open-settings'),
    stopMedia: () => ipcRenderer.invoke('stop-media'),
    prepareMedia: () => ipcRenderer.invoke('prepare-media'),
    cacheStatus: () => ipcRenderer.invoke('cache-status'),
    clearCache: () => ipcRenderer.invoke('clear-cache'),
    setMediaActive: (active) => ipcRenderer.send('media-active', active),
    setMediaControlBounds: (bounds) => ipcRenderer.send('media-control-bounds', bounds),
    settingsAction: (action) => ipcRenderer.invoke('settings-action', action),
    onSettingsChanged: (callback) => {
        const listener = (_event, settings) => callback(settings);
        ipcRenderer.on('settings-changed', listener);
        return () => ipcRenderer.removeListener('settings-changed', listener);
    }
});

