const { app, BrowserWindow, ipcMain, desktopCapturer, globalShortcut, session, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { spawn } = require('child_process');

const GITHUB_REPO = 'AlexWBMaya/tela-compartilhada';

// ============================================================================
// OTIMIZAÇÕES DE HARDWARE E PERFORMANCE PARA JOGOS (ZERO-COPY & GPU ENCODE)
// ============================================================================
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-accelerated-video-decode');
app.commandLine.appendSwitch('enable-accelerated-video-encode');
app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecoder,VaapiVideoEncoder,PlatformHEVCEncoderSupport,WebRTCPipeWireCapturer');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

let mainWindow = null;
let overlayState = {
  active: false,
  clickThrough: false,
  opacity: 0.92,
  previousBounds: null,
  wasMaximized: false
};

let pendingCaptureConfig = {
  sourceId: null,
  includeSystemAudio: true
};

let latestUpdateInfo = null;

function createMainWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  mainWindow = new BrowserWindow({
    width: Math.min(1440, Math.round(width * 0.88)),
    height: Math.min(900, Math.round(height * 0.88)),
    minWidth: 360,
    minHeight: 240,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false
    }
  });

  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
      let chosenSource = null;

      if (pendingCaptureConfig.sourceId) {
        chosenSource = sources.find((s) => s.id === pendingCaptureConfig.sourceId);
      }
      if (!chosenSource && sources.length > 0) {
        chosenSource = sources[0];
      }

      if (!chosenSource) {
        callback({});
        return;
      }

      const response = { video: chosenSource };
      if (pendingCaptureConfig.includeSystemAudio) {
        response.audio = 'loopback';
      }
      callback(response);
    } catch (err) {
      console.error('Erro no setDisplayMediaRequestHandler:', err);
      callback({});
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (process.argv.includes('--dev')) {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  });

  mainWindow.on('maximize', () => {
    mainWindow.webContents.send('window:maximized-changed', true);
  });

  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send('window:maximized-changed', false);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ============================================================================
// ATUALIZADOR AUTOMÁTICO DE 1 CLIQUE VIA GITHUB RELEASES
// ============================================================================
function normalizeVersion(ver) {
  return String(ver || '')
    .trim()
    .replace(/^v/i, '')
    .split('.')
    .map((n) => parseInt(n, 10) || 0);
}

function isNewerVersion(latestStr, currentStr) {
  const latest = normalizeVersion(latestStr);
  const current = normalizeVersion(currentStr);
  const len = Math.max(latest.length, current.length);
  for (let i = 0; i < len; i++) {
    const l = latest[i] || 0;
    const c = current[i] || 0;
    if (l > c) return true;
    if (l < c) return false;
  }
  return false;
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': 'TelaCompartilhada-Updater',
          Accept: 'application/vnd.github+json'
        }
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          fetchJson(res.headers.location).then(resolve).catch(reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy(new Error('Timeout'));
    });
  });
}

function downloadFileWithProgress(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const requestUrl = (currentUrl) => {
      https
        .get(
          currentUrl,
          {
            headers: {
              'User-Agent': 'TelaCompartilhada-Updater'
            }
          },
          (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
              requestUrl(res.headers.location);
              return;
            }
            if (res.statusCode !== 200) {
              reject(new Error(`Erro no download: HTTP ${res.statusCode}`));
              return;
            }

            const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
            let receivedBytes = 0;
            const fileStream = fs.createWriteStream(destPath);

            res.on('data', (chunk) => {
              receivedBytes += chunk.length;
              if (totalBytes > 0 && onProgress) {
                const percent = Math.min(99, Math.round((receivedBytes / totalBytes) * 100));
                onProgress(percent);
              }
            });

            res.pipe(fileStream);

            fileStream.on('finish', () => {
              fileStream.close(() => resolve(destPath));
            });

            fileStream.on('error', (err) => {
              try {
                fs.unlinkSync(destPath);
              } catch (_) {}
              reject(err);
            });
          }
        )
        .on('error', reject);
    };

    requestUrl(url);
  });
}

async function checkForGitHubUpdates() {
  const currentVersion = app.getVersion();
  try {
    const release = await fetchJson(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`);
    const latestTag = release.tag_name || release.name || '';
    const latestVersion = latestTag.replace(/^v/i, '');
    const assets = Array.isArray(release.assets) ? release.assets : [];
    const exeAsset =
      assets.find((a) => a.name && a.name.toLowerCase() === 'telacompartilhada.exe') ||
      assets.find((a) => a.name && a.name.toLowerCase().endsWith('.exe'));

    const updateAvailable = Boolean(exeAsset && isNewerVersion(latestVersion, currentVersion));

    latestUpdateInfo = {
      updateAvailable,
      currentVersion,
      latestVersion: latestVersion || currentVersion,
      downloadUrl: exeAsset ? exeAsset.browser_download_url : null,
      releaseName: release.name || latestTag
    };

    return latestUpdateInfo;
  } catch (err) {
    return {
      updateAvailable: false,
      currentVersion,
      latestVersion: currentVersion,
      error: err.message
    };
  }
}

async function downloadAndInstallUpdate() {
  if (!latestUpdateInfo?.downloadUrl) {
    const check = await checkForGitHubUpdates();
    if (!check.updateAvailable || !check.downloadUrl) {
      throw new Error('Nenhuma atualização encontrada no GitHub.');
    }
  }

  const tempDir = app.getPath('temp');
  const downloadedExe = path.join(tempDir, `TelaCompartilhada_update_${Date.now()}.exe`);

  await downloadFileWithProgress(latestUpdateInfo.downloadUrl, downloadedExe, (percent) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('updater:progress', { percent, stage: 'downloading' });
    }
  });

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('updater:progress', { percent: 100, stage: 'installing' });
  }

  // Determina qual arquivo .exe substituir (PORTABLE_EXECUTABLE_FILE quando aberto pelo portátil)
  let targetExe = process.env.PORTABLE_EXECUTABLE_FILE;
  if (!targetExe) {
    const localPortable = path.join(__dirname, 'TelaCompartilhada.exe');
    if (fs.existsSync(localPortable)) {
      targetExe = localPortable;
    } else {
      targetExe = process.execPath;
    }
  }

  const updaterBat = path.join(tempDir, `tc_updater_${Date.now()}.bat`);
  const batContent = [
    '@echo off',
    'chcp 65001 >nul',
    'set "SRC=%~1"',
    'set "DST=%~2"',
    'set /a TRIES=0',
    ':loop',
    'timeout /t 1 /nobreak >nul',
    'move /y "%SRC%" "%DST%" >nul 2>&1',
    'if errorlevel 1 (',
    '  set /a TRIES+=1',
    '  if %TRIES% lss 25 goto loop',
    '  copy /y "%SRC%" "%DST%" >nul 2>&1',
    ')',
    'start "" "%DST%"',
    'del "%~f0"'
  ].join('\r\n');

  fs.writeFileSync(updaterBat, batContent, 'utf8');

  const child = spawn('cmd.exe', ['/c', updaterBat, downloadedExe, targetExe], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  });
  child.unref();

  setTimeout(() => {
    app.quit();
  }, 400);

  return true;
}

// ============================================================================
// ATALHOS GLOBAIS
// ============================================================================
function registerGlobalShortcuts() {
  globalShortcut.unregisterAll();

  globalShortcut.register('Alt+Shift+O', () => {
    if (!mainWindow) return;
    setOverlayMode(!overlayState.active);
  });

  globalShortcut.register('Alt+Shift+L', () => {
    if (!mainWindow) return;
    if (!overlayState.active) {
      setOverlayMode(true);
    }
    setClickThrough(!overlayState.clickThrough);
  });

  globalShortcut.register('Alt+Shift+H', () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.showInactive();
      if (overlayState.active) {
        mainWindow.setAlwaysOnTop(true, 'screen-saver');
      }
    }
  });

  globalShortcut.register('Alt+Shift+M', () => {
    if (!mainWindow) return;
    mainWindow.webContents.send('shortcut:toggle-mute-all');
  });
}

function setOverlayMode(enabled, customBounds = null) {
  if (!mainWindow) return overlayState;

  overlayState.active = Boolean(enabled);

  if (overlayState.active) {
    overlayState.wasMaximized = mainWindow.isMaximized();
    if (overlayState.wasMaximized) {
      mainWindow.unmaximize();
    }
    overlayState.previousBounds = mainWindow.getBounds();

    const display = screen.getDisplayMatching(overlayState.previousBounds);
    const workArea = display.workArea;

    const targetWidth = customBounds?.width || 480;
    const targetHeight = customBounds?.height || 300;
    const targetX = customBounds?.x ?? (workArea.x + workArea.width - targetWidth - 20);
    const targetY = customBounds?.y ?? (workArea.y + 20);

    mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    mainWindow.setBounds({
      x: targetX,
      y: targetY,
      width: targetWidth,
      height: targetHeight
    });
  } else {
    setClickThrough(false);
    mainWindow.setAlwaysOnTop(false);
    mainWindow.setVisibleOnAllWorkspaces(false);
    mainWindow.setOpacity(1.0);

    if (overlayState.previousBounds) {
      mainWindow.setBounds(overlayState.previousBounds);
    }
    if (overlayState.wasMaximized) {
      mainWindow.maximize();
    }
  }

  mainWindow.webContents.send('overlay:state-changed', overlayState);
  return overlayState;
}

function setClickThrough(enabled) {
  if (!mainWindow) return overlayState;
  overlayState.clickThrough = Boolean(enabled);

  if (overlayState.clickThrough) {
    mainWindow.setIgnoreMouseEvents(true, { forward: true });
  } else {
    mainWindow.setIgnoreMouseEvents(false);
  }

  mainWindow.webContents.send('overlay:state-changed', overlayState);
  return overlayState;
}

// ============================================================================
// HANDLERS IPC
// ============================================================================
ipcMain.handle('desktop:get-sources', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 440, height: 248 },
    fetchWindowIcons: true
  });

  return sources.map((source) => ({
    id: source.id,
    name: source.name,
    displayId: source.display_id,
    isScreen: source.id.startsWith('screen:'),
    thumbnail: source.thumbnail.toDataURL(),
    appIcon: source.appIcon ? source.appIcon.toDataURL() : null
  }));
});

ipcMain.handle('desktop:prepare-capture', (_event, config) => {
  pendingCaptureConfig = {
    sourceId: config?.sourceId || null,
    includeSystemAudio: Boolean(config?.includeSystemAudio)
  };
  return true;
});

ipcMain.handle('window:minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.handle('window:toggle-maximize', () => {
  if (!mainWindow) return false;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
    return false;
  } else {
    mainWindow.maximize();
    return true;
  }
});

ipcMain.handle('window:close', () => {
  if (mainWindow) mainWindow.close();
});

ipcMain.handle('overlay:toggle', (_event, enabled) => {
  const next = typeof enabled === 'boolean' ? enabled : !overlayState.active;
  return setOverlayMode(next);
});

ipcMain.handle('overlay:set-click-through', (_event, enabled) => {
  return setClickThrough(enabled);
});

ipcMain.handle('overlay:set-opacity', (_event, opacityValue) => {
  if (!mainWindow) return overlayState;
  const clamped = Math.max(0.2, Math.min(1.0, Number(opacityValue) || 0.92));
  overlayState.opacity = clamped;
  mainWindow.webContents.send('overlay:state-changed', overlayState);
  return overlayState;
});

ipcMain.handle('overlay:get-state', () => overlayState);

ipcMain.handle('updater:check', async () => {
  return checkForGitHubUpdates();
});

ipcMain.handle('updater:install', async () => {
  return downloadAndInstallUpdate();
});

app.whenReady().then(() => {
  createMainWindow();
  registerGlobalShortcuts();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
