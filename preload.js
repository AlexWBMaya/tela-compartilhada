const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getDesktopSources: () => ipcRenderer.invoke('desktop:get-sources'),
  prepareCapture: (config) => ipcRenderer.invoke('desktop:prepare-capture', config),

  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('window:toggle-maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),

  toggleOverlay: (enabled) => ipcRenderer.invoke('overlay:toggle', enabled),
  setClickThrough: (enabled) => ipcRenderer.invoke('overlay:set-click-through', enabled),
  setOverlayOpacity: (opacity) => ipcRenderer.invoke('overlay:set-opacity', opacity),
  getOverlayState: () => ipcRenderer.invoke('overlay:get-state'),

  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),

  onUpdateProgress: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('updater:progress', listener);
    return () => ipcRenderer.removeListener('updater:progress', listener);
  },

  onOverlayStateChanged: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('overlay:state-changed', listener);
    return () => ipcRenderer.removeListener('overlay:state-changed', listener);
  },

  onMaximizedChanged: (callback) => {
    const listener = (_event, isMaximized) => callback(isMaximized);
    ipcRenderer.on('window:maximized-changed', listener);
    return () => ipcRenderer.removeListener('window:maximized-changed', listener);
  },

  onToggleMuteAllShortcut: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('shortcut:toggle-mute-all', listener);
    return () => ipcRenderer.removeListener('shortcut:toggle-mute-all', listener);
  }
});
