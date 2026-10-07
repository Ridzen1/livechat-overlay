function applyStartupSetting(app, enabled, portablePath) {
    if (!app.isPackaged || process.platform !== 'win32') return;
    app.setLoginItemSettings({
        openAtLogin: enabled,
        enabled,
        path: portablePath || app.getPath('exe'),
        args: []
    });
}
module.exports = { applyStartupSetting };
