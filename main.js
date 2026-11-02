const { app, BrowserWindow, ipcMain, desktopCapturer, globalShortcut, session, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { spawn, execFileSync } = require('child_process');

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
  includeSystemAudio: true,
  useFallbackSystemLoopback: false
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
      if (pendingCaptureConfig.includeSystemAudio && pendingCaptureConfig.useFallbackSystemLoopback) {
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

  let isClosingGracefully = false;
  mainWindow.on('close', (event) => {
    if (isClosingGracefully) return;
    isClosingGracefully = true;
    event.preventDefault();
    try {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('app:prepare-close');
      }
    } catch (_) {}
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.destroy();
      }
    }, 180);
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
  const pkg = require(path.join(__dirname, 'package.json'));
  const currentVersion = pkg.version || '1.0.0';
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
// CONTROLE REMOTO NATIVO DO WINDOWS (USER32.DLL SEM DRIVERS EXTERNOS)
// ============================================================================
let inputWorker = null;

function ensureInputWorker() {
  if (inputWorker && !inputWorker.killed) {
    return inputWorker;
  }

  const psScript = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class WinInput {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int nIndex);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, int dwData, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

  public static void Move10k(int nx, int ny) {
    int w = GetSystemMetrics(0);
    int h = GetSystemMetrics(1);
    int x = (nx * w) / 10000;
    int y = (ny * h) / 10000;
    SetCursorPos(x, y);
  }
}
"@
[WinInput]::SetProcessDPIAware() | Out-Null
while (($line = [Console]::In.ReadLine()) -ne $null) {
  $p = $line.Split(' ')
  switch ($p[0]) {
    'M' {
      [WinInput]::Move10k([int]$p[1], [int]$p[2])
    }
    'MD' {
      [WinInput]::Move10k([int]$p[1], [int]$p[2])
      $btn = [int]$p[3]
      $flag = if ($btn -eq 2) { 0x0008 } elseif ($btn -eq 1) { 0x0020 } else { 0x0002 }
      [WinInput]::mouse_event([uint32]$flag, 0, 0, 0, [UIntPtr]::Zero)
    }
    'MU' {
      [WinInput]::Move10k([int]$p[1], [int]$p[2])
      $btn = [int]$p[3]
      $flag = if ($btn -eq 2) { 0x0010 } elseif ($btn -eq 1) { 0x0040 } else { 0x0004 }
      [WinInput]::mouse_event([uint32]$flag, 0, 0, 0, [UIntPtr]::Zero)
    }
    'MW' {
      [WinInput]::mouse_event(0x0800, 0, 0, [int]$p[1], [UIntPtr]::Zero)
    }
    'KD' {
      $vk = [int]$p[1]
      if ($vk -gt 0 -and $vk -lt 255) {
        [WinInput]::keybd_event([byte]$vk, 0, 0, [UIntPtr]::Zero)
      }
    }
    'KU' {
      $vk = [int]$p[1]
      if ($vk -gt 0 -and $vk -lt 255) {
        [WinInput]::keybd_event([byte]$vk, 0, 2, [UIntPtr]::Zero)
      }
    }
  }
}
`;

  inputWorker = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', psScript],
    {
      stdio: ['pipe', 'ignore', 'ignore'],
      windowsHide: true
    }
  );

  inputWorker.on('exit', () => {
    inputWorker = null;
  });

  inputWorker.on('error', () => {
    inputWorker = null;
  });

  return inputWorker;
}

function sendInputCommand(line) {
  const worker = ensureInputWorker();
  if (worker && worker.stdin && !worker.stdin.destroyed) {
    try {
      worker.stdin.write(line + '\n');
    } catch (_) {}
  }
}

function executeRemoteInputEvent(evt) {
  if (!evt || typeof evt !== 'object') return;
  const nx = Math.max(0, Math.min(10000, Math.round((Number(evt.nx) || 0) * 10000)));
  const ny = Math.max(0, Math.min(10000, Math.round((Number(evt.ny) || 0) * 10000)));

  switch (evt.action) {
    case 'mousemove':
      sendInputCommand(`M ${nx} ${ny}`);
      break;
    case 'mousedown':
      sendInputCommand(`MD ${nx} ${ny} ${Number(evt.button) || 0}`);
      break;
    case 'mouseup':
      sendInputCommand(`MU ${nx} ${ny} ${Number(evt.button) || 0}`);
      break;
    case 'wheel': {
      const wheelDelta = (Number(evt.deltaY) || 0) > 0 ? -120 : 120;
      sendInputCommand(`MW ${wheelDelta}`);
      break;
    }
    case 'keydown':
      sendInputCommand(`KD ${Number(evt.keyCode) || 0}`);
      break;
    case 'keyup':
      sendInputCommand(`KU ${Number(evt.keyCode) || 0}`);
      break;
    default:
      break;
  }
}

// ============================================================================
// CAPTURA DE ÁUDIO ISOLADO POR JANELA / JANELA ATIVA (WASAPI PROCESS LOOPBACK)
// Ignora Discord e o próprio Tela Compartilhada sem precisar de drivers externos
// ============================================================================
let audioWorker = null;
let audioRemainderBuffer = null;
let audioStderrBuffer = '';
let compiledAudioWorkerPath = null;
let currentAudioStatus = {
  state: 'IDLE',
  pid: 0,
  exeName: '',
  title: ''
};

function ensureAudioWorkerBinary() {
  if (process.platform !== 'win32') return null;
  if (compiledAudioWorkerPath && fs.existsSync(compiledAudioWorkerPath)) {
    return compiledAudioWorkerPath;
  }

  const userDataDir = app.getPath('userData');
  const targetExe = path.join(userDataDir, 'tc-audio-loopback-v2.exe');
  if (fs.existsSync(targetExe)) {
    compiledAudioWorkerPath = targetExe;
    return targetExe;
  }

  const csSourcePath = path.join(__dirname, 'src', 'audio-loopback-worker.cs');
  if (!fs.existsSync(csSourcePath)) {
    return null;
  }

  const windir = process.env.WINDIR || 'C:\\Windows';
  const csc64 = path.join(windir, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  const csc32 = path.join(windir, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe');
  const cscPath = fs.existsSync(csc64) ? csc64 : fs.existsSync(csc32) ? csc32 : null;
  if (!cscPath) {
    return null;
  }

  const tempCs = path.join(app.getPath('temp'), `tc_audio_worker_${process.pid}_${Date.now()}.cs`);
  try {
    const csCode = fs.readFileSync(csSourcePath, 'utf8');
    fs.writeFileSync(tempCs, csCode, 'utf8');
    execFileSync(cscPath, ['/nologo', '/optimize+', `/out:${targetExe}`, tempCs], {
      windowsHide: true,
      stdio: 'ignore'
    });
    if (fs.existsSync(targetExe)) {
      compiledAudioWorkerPath = targetExe;
      return targetExe;
    }
  } catch (err) {
    console.warn('Falha ao compilar worker de áudio WASAPI:', err);
  } finally {
    try {
      if (fs.existsSync(tempCs)) fs.unlinkSync(tempCs);
    } catch (_) {}
  }

  return null;
}

function parseAudioWorkerStderrLine(line) {
  if (!line || !line.startsWith('STATUS|')) return;
  const parts = line.split('|');
  currentAudioStatus = {
    state: parts[1] || 'IDLE',
    pid: Number(parts[2]) || 0,
    exeName: parts[3] || '',
    title: parts[4] || ''
  };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('audio-capture:status', currentAudioStatus);
  }
}

function startOrUpdateAudioWorker(config = {}) {
  const mode = config?.mode === 'window' && Number(config?.hwnd) > 0 ? 'window' : 'active';
  const hwnd = Number(config?.hwnd) || 0;

  if (audioWorker && !audioWorker.killed && audioWorker.stdin && !audioWorker.stdin.destroyed) {
    try {
      if (mode === 'window' && hwnd > 0) {
        audioWorker.stdin.write(`WINDOW ${hwnd}\n`);
      } else {
        audioWorker.stdin.write('ACTIVE\n');
      }
      return { ok: true, status: currentAudioStatus };
    } catch (_) {}
  }

  stopAudioWorker();

  const exePath = ensureAudioWorkerBinary();
  if (!exePath) {
    return { ok: false, error: 'Worker WASAPI indisponível neste sistema.' };
  }

  audioRemainderBuffer = null;
  audioStderrBuffer = '';

  try {
    audioWorker = spawn(
      exePath,
      ['--self-pid', String(process.pid), '--mode', mode, '--hwnd', String(hwnd)],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      }
    );
  } catch (err) {
    audioWorker = null;
    return { ok: false, error: err.message };
  }

  audioWorker.stdout.on('data', (chunk) => {
    if (!chunk || chunk.length === 0) return;
    let combined = chunk;
    if (audioRemainderBuffer && audioRemainderBuffer.length > 0) {
      combined = Buffer.concat([audioRemainderBuffer, chunk]);
      audioRemainderBuffer = null;
    }

    const alignedLen = combined.length & ~3;
    if (combined.length > alignedLen) {
      audioRemainderBuffer = Buffer.from(combined.subarray(alignedLen));
    }

    if (alignedLen > 0 && mainWindow && !mainWindow.isDestroyed()) {
      const payload = combined.length === alignedLen ? combined : combined.subarray(0, alignedLen);
      mainWindow.webContents.send('audio-capture:pcm', payload);
    }
  });

  audioWorker.stderr.on('data', (chunk) => {
    audioStderrBuffer += chunk.toString('utf8');
    let nlIndex;
    while ((nlIndex = audioStderrBuffer.indexOf('\n')) !== -1) {
      const line = audioStderrBuffer.slice(0, nlIndex).trim();
      audioStderrBuffer = audioStderrBuffer.slice(nlIndex + 1);
      parseAudioWorkerStderrLine(line);
    }
  });

  audioWorker.on('exit', () => {
    audioWorker = null;
    audioRemainderBuffer = null;
  });

  audioWorker.on('error', () => {
    audioWorker = null;
    audioRemainderBuffer = null;
  });

  return { ok: true, status: currentAudioStatus };
}

function stopAudioWorker() {
  if (audioWorker) {
    try {
      if (audioWorker.stdin && !audioWorker.stdin.destroyed) {
        audioWorker.stdin.write('STOP\n');
      }
    } catch (_) {}
    try {
      if (!audioWorker.killed) {
        audioWorker.kill();
      }
    } catch (_) {}
    audioWorker = null;
  }
  audioRemainderBuffer = null;
  audioStderrBuffer = '';
  currentAudioStatus = {
    state: 'IDLE',
    pid: 0,
    exeName: '',
    title: ''
  };
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

  // Atalho de segurança para cortar o controle remoto imediatamente de qualquer lugar
  globalShortcut.register('Alt+Shift+K', () => {
    if (!mainWindow) return;
    mainWindow.webContents.send('shortcut:revoke-remote-control');
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
    includeSystemAudio: Boolean(config?.includeSystemAudio),
    useFallbackSystemLoopback: Boolean(config?.useFallbackSystemLoopback)
  };
  return true;
});

ipcMain.handle('audio-capture:start', (_event, config) => {
  return startOrUpdateAudioWorker(config);
});

ipcMain.handle('audio-capture:update-target', (_event, config) => {
  return startOrUpdateAudioWorker(config);
});

ipcMain.handle('audio-capture:stop', () => {
  return stopAudioWorker();
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

ipcMain.on('remote-input:execute', (_event, evt) => {
  executeRemoteInputEvent(evt);
});

app.whenReady().then(() => {
  setTimeout(() => {
    try {
      ensureAudioWorkerBinary();
    } catch (_) {}
  }, 100);
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
  stopAudioWorker();
  if (inputWorker && !inputWorker.killed) {
    try {
      inputWorker.kill();
    } catch (_) {}
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
