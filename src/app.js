import { MultiStreamRoomEngine, QUALITY_PRESETS } from './webrtc-engine.js';

const uiState = {
  layoutMode: 'grid', // 'grid' | 'spotlight' | 'single'
  spotlightStreamId: null,
  minimizedStreams: new Set(), // Streams que o usuário escolheu fechar/ocultar na tela dele
  activeStreams: new Map(),
  peersList: [],
  hideSelfPreview: false,
  allMuted: false,
  sourceFilter: 'all',
  availableSources: [],
  selectedSourceId: null,
  selectedSourceName: 'Tela Principal',
  selectedPresetId: 'balanced-60',
  overlayActive: false,
  overlayClickThrough: false
};

const el = {
  roomToolbar: document.getElementById('room-toolbar'),
  activeRoomCode: document.getElementById('active-room-code'),
  copyRoomBtn: document.getElementById('copy-room-btn'),
  peersCountText: document.getElementById('peers-count-text'),

  layoutGridBtn: document.getElementById('layout-grid-btn'),
  layoutSpotlightBtn: document.getElementById('layout-spotlight-btn'),
  layoutSingleBtn: document.getElementById('layout-single-btn'),

  updateAppBtn: document.getElementById('update-app-btn'),
  checkUpdateBtn: document.getElementById('check-update-btn'),
  toggleOverlayBtn: document.getElementById('toggle-overlay-btn'),
  winMinBtn: document.getElementById('win-min-btn'),
  winMaxBtn: document.getElementById('win-max-btn'),
  winCloseBtn: document.getElementById('win-close-btn'),

  overlayHudBar: document.getElementById('overlay-hud-bar'),
  overlayOpacitySlider: document.getElementById('overlay-opacity-slider'),
  overlayCycleStreamBtn: document.getElementById('overlay-cycle-stream-btn'),
  overlayClickthroughBtn: document.getElementById('overlay-clickthrough-btn'),
  overlayExitBtn: document.getElementById('overlay-exit-btn'),
  clickthroughBanner: document.getElementById('clickthrough-banner'),

  lobbySection: document.getElementById('lobby-section'),
  joinRoomForm: document.getElementById('join-room-form'),
  nicknameInput: document.getElementById('nickname-input'),
  roomCodeInput: document.getElementById('room-code-input'),
  randomRoomBtn: document.getElementById('random-room-btn'),
  joinRoomSubmitBtn: document.getElementById('join-room-submit-btn'),

  roomSection: document.getElementById('room-section'),
  roomSidebar: document.getElementById('room-sidebar'),
  sidebarTitle: document.getElementById('sidebar-title'),
  sidebarMembersList: document.getElementById('sidebar-members-list'),
  watchAllStreamsBtn: document.getElementById('watch-all-streams-btn'),
  closeAllStreamsBtn: document.getElementById('close-all-streams-btn'),
  toggleSidebarBtn: document.getElementById('toggle-sidebar-btn'),

  minimizedDock: document.getElementById('minimized-dock'),
  minimizedPillsList: document.getElementById('minimized-pills-list'),
  restoreAllStreamsBtn: document.getElementById('restore-all-streams-btn'),

  streamsStage: document.getElementById('streams-stage'),
  emptyStageCard: document.getElementById('empty-stage-card'),
  emptyStageTitle: document.getElementById('empty-stage-title'),
  emptyStageDesc: document.getElementById('empty-stage-desc'),
  emptyStartShareBtn: document.getElementById('empty-start-share-btn'),
  connectedFriendsList: document.getElementById('connected-friends-list'),
  streamsContainer: document.getElementById('streams-container'),

  openShareModalBtn: document.getElementById('open-share-modal-btn'),
  changeQualityBtn: document.getElementById('change-quality-btn'),
  stopShareBtn: document.getElementById('stop-share-btn'),
  localShareDot: document.getElementById('local-share-dot'),
  localShareText: document.getElementById('local-share-text'),
  hideSelfPreviewToggle: document.getElementById('hide-self-preview-toggle'),
  muteAllStreamsBtn: document.getElementById('mute-all-streams-btn'),
  leaveRoomBtn: document.getElementById('leave-room-btn'),

  shareModal: document.getElementById('share-modal'),
  closeShareModalBtn: document.getElementById('close-share-modal-btn'),
  cancelShareModalBtn: document.getElementById('cancel-share-modal-btn'),
  confirmStartShareBtn: document.getElementById('confirm-start-share-btn'),
  refreshSourcesBtn: document.getElementById('refresh-sources-btn'),
  sourcesGrid: document.getElementById('sources-grid'),
  tabSourceAll: document.getElementById('tab-source-all'),
  tabSourceScreens: document.getElementById('tab-source-screens'),
  tabSourceWindows: document.getElementById('tab-source-windows'),

  shareSystemAudioCheckbox: document.getElementById('share-system-audio-checkbox'),
  modalEcoPreviewCheckbox: document.getElementById('modal-eco-preview-checkbox'),
  presetsGrid: document.getElementById('presets-grid'),

  selectResolution: document.getElementById('select-resolution'),
  selectFps: document.getElementById('select-fps'),
  bitrateSlider: document.getElementById('bitrate-slider'),
  bitrateValueLabel: document.getElementById('bitrate-value-label'),
  selectCodec: document.getElementById('select-codec'),
  selectPriority: document.getElementById('select-priority')
};

const engine = new MultiStreamRoomEngine({
  onRoomJoined: ({ roomCode }) => {
    el.lobbySection.hidden = true;
    el.roomSection.hidden = false;
    el.roomToolbar.hidden = false;
    el.activeRoomCode.textContent = roomCode;
    uiState.peersList = [];
    updateRoomStatusUI([]);
    syncStreamsStage();
  },

  onRoomLeft: () => {
    uiState.activeStreams.clear();
    uiState.minimizedStreams.clear();
    uiState.peersList = [];
    uiState.spotlightStreamId = null;
    el.streamsContainer.innerHTML = '';
    el.roomSection.hidden = true;
    el.roomToolbar.hidden = true;
    el.lobbySection.hidden = false;
    updateShareControlButtons();
  },

  onPeersUpdated: (peersList) => {
    uiState.peersList = peersList;
    updateRoomStatusUI(peersList);
    syncStreamsStage();
  },

  onLocalStreamUpdated: (stream, streamMeta) => {
    uiState.activeStreams.set('local', {
      id: 'local',
      isLocal: true,
      nickname: `${engine.myNickname} (Você)`,
      stream,
      streamMeta,
      volume: 0,
      muted: true
    });
    if (!uiState.spotlightStreamId) {
      uiState.spotlightStreamId = 'local';
    }
    updateShareControlButtons();
    updateRoomStatusUI(uiState.peersList);
    syncStreamsStage();
  },

  onLocalStreamStopped: () => {
    uiState.activeStreams.delete('local');
    uiState.minimizedStreams.delete('local');
    if (uiState.spotlightStreamId === 'local') {
      uiState.spotlightStreamId = getFirstAvailableStreamId();
    }
    updateShareControlButtons();
    updateRoomStatusUI(uiState.peersList);
    syncStreamsStage();
  },

  onRemoteStreamAdded: ({ peerId, nickname, stream, streamMeta }) => {
    const existing = uiState.activeStreams.get(peerId);
    uiState.activeStreams.set(peerId, {
      id: peerId,
      isLocal: false,
      nickname: nickname || 'Amigo',
      stream,
      streamMeta,
      volume: existing?.volume ?? 100,
      muted: existing?.muted ?? uiState.allMuted
    });

    if (uiState.layoutMode === 'single' && uiState.spotlightStreamId && uiState.spotlightStreamId !== peerId) {
      uiState.minimizedStreams.add(peerId);
    } else if (!uiState.spotlightStreamId || uiState.spotlightStreamId === 'local') {
      uiState.spotlightStreamId = peerId;
    }

    updateRoomStatusUI(uiState.peersList);
    syncStreamsStage();
  },

  onRemoteStreamRemoved: (peerId) => {
    uiState.activeStreams.delete(peerId);
    uiState.minimizedStreams.delete(peerId);
    const card = document.getElementById(`stream-card-${peerId}`);
    if (card) card.remove();

    if (uiState.spotlightStreamId === peerId) {
      uiState.spotlightStreamId = getFirstAvailableStreamId();
    }
    updateRoomStatusUI(uiState.peersList);
    syncStreamsStage();
  },

  onTelemetryUpdate: ({ streams, activeViewers, minimizedViewers }) => {
    for (const [peerId, stat] of Object.entries(streams)) {
      const badge = document.getElementById(`telemetry-${peerId}`);
      if (!badge) continue;
      const resLabel = stat.height ? `${stat.height}p` : 'AO VIVO';
      const fpsLabel = stat.fps ? `${stat.fps} FPS` : '-- FPS';
      const mbpsLabel = `${stat.bitrateMbps.toFixed(1)} Mbps`;
      const pingLabel = stat.rttMs != null ? ` | ${stat.rttMs}ms` : '';
      const codecLabel = stat.codecName ? ` | ${stat.codecName}` : '';
      badge.textContent = `${resLabel} | ${fpsLabel} | ${mbpsLabel}${pingLabel}${codecLabel}`;
    }

    if (engine.isSharing) {
      const meta = engine._buildMyStreamMeta();
      const viewersInfo =
        activeViewers > 0
          ? `${activeViewers} assistindo`
          : minimizedViewers > 0
          ? 'Pausado (fecharam sua tela)'
          : 'Ninguém abriu ainda';
      el.localShareText.textContent = `${meta.height}p ${meta.fps}FPS (${meta.bitrateMbps}Mbps) | ${viewersInfo}`;
    }
  },

  onError: (err) => {
    console.warn('Aviso P2P:', err);
  }
});

function getFirstAvailableStreamId() {
  for (const id of uiState.activeStreams.keys()) {
    if (!uiState.minimizedStreams.has(id)) return id;
  }
  const first = uiState.activeStreams.keys().next();
  return first.done ? null : first.value;
}

// ============================================================================
// ABRIR / FECHAR TRANSMISSÕES ESPECÍFICAS (EX: VER SÓ JOÃO E ALEX)
// ============================================================================
function isWatchingStream(streamId) {
  return uiState.activeStreams.has(streamId) && !uiState.minimizedStreams.has(streamId);
}

function openSpecificStream(streamId, exclusiveSingle = false) {
  uiState.minimizedStreams.delete(streamId);

  if (exclusiveSingle) {
    uiState.layoutMode = 'single';
    uiState.spotlightStreamId = streamId;
    for (const id of uiState.activeStreams.keys()) {
      if (id !== streamId) {
        uiState.minimizedStreams.add(id);
      }
    }
  } else {
    // Se estava no modo "Só 1 Tela" e o usuário clicou em "Assistir" em uma segunda pessoa na lista lateral,
    // muda automaticamente para Grade para deixar as duas (ou mais) escolhidas abertas!
    const currentlyOpenCount = Array.from(uiState.activeStreams.keys()).filter(
      (id) => !uiState.minimizedStreams.has(id)
    ).length;

    if (uiState.layoutMode === 'single' && currentlyOpenCount > 1) {
      uiState.layoutMode = 'grid';
    }
    if (!uiState.spotlightStreamId) {
      uiState.spotlightStreamId = streamId;
    }
  }

  // Caso seja uma transmissão remota, avisa o peer imediatamente para enviar o vídeo
  if (streamId !== 'local') {
    engine.setRemoteStreamVisibility(streamId, true, 'high');
  }

  updateLayoutButtonsUI();
  updateRoomStatusUI(uiState.peersList);
  syncStreamsStage();
}

function closeSpecificStream(streamId) {
  uiState.minimizedStreams.add(streamId);
  if (uiState.spotlightStreamId === streamId) {
    uiState.spotlightStreamId = getFirstAvailableStreamId();
  }
  if (streamId !== 'local') {
    engine.setRemoteStreamVisibility(streamId, false, 'high');
  }
  updateRoomStatusUI(uiState.peersList);
  syncStreamsStage();
}

function updateLayoutButtonsUI() {
  const mode = uiState.layoutMode;
  el.layoutGridBtn.classList.toggle('active', mode === 'grid');
  el.layoutSpotlightBtn.classList.toggle('active', mode === 'spotlight');
  el.layoutSingleBtn.classList.toggle('active', mode === 'single');

  el.streamsStage.classList.remove('layout-grid', 'layout-spotlight', 'layout-single');
  el.streamsStage.classList.add(`layout-${mode}`);
}

function setLayoutMode(mode, targetFocusId = null) {
  uiState.layoutMode = mode;
  updateLayoutButtonsUI();

  if (targetFocusId && uiState.activeStreams.has(targetFocusId)) {
    uiState.spotlightStreamId = targetFocusId;
  } else if (!uiState.spotlightStreamId || !uiState.activeStreams.has(uiState.spotlightStreamId)) {
    uiState.spotlightStreamId = getFirstAvailableStreamId();
  }

  if (mode === 'single' && uiState.spotlightStreamId) {
    for (const id of uiState.activeStreams.keys()) {
      if (id !== uiState.spotlightStreamId) {
        uiState.minimizedStreams.add(id);
      } else {
        uiState.minimizedStreams.delete(id);
      }
    }
  }

  updateRoomStatusUI(uiState.peersList);
  syncStreamsStage();
}

function syncStreamsStage() {
  const visibleStreams = [];
  const minimizedList = [];

  for (const [id, info] of uiState.activeStreams.entries()) {
    if (uiState.minimizedStreams.has(id)) {
      minimizedList.push(info);
    } else {
      visibleStreams.push(info);
    }
  }

  // Se não houver nenhuma transmissão aberta no momento, mostra o card central explicativo
  el.emptyStageCard.hidden = visibleStreams.length > 0;
  if (visibleStreams.length === 0) {
    if (minimizedList.length > 0) {
      el.emptyStageTitle.textContent = `${minimizedList.length} transmissão(ões) rolando na sala`;
      el.emptyStageDesc.textContent =
        'Escolha na lista lateral quais transmissões você quer abrir na tela.';
    } else {
      el.emptyStageTitle.textContent = 'Ninguém está transmitindo ainda';
      el.emptyStageDesc.textContent =
        'Você já está conectado na sala. Quando alguém transmitir, vai aparecer na lista ao lado pra você assistir.';
    }
  }

  if (visibleStreams.length > 0) {
    const hasValidSpotlight = visibleStreams.some((s) => s.id === uiState.spotlightStreamId);
    if (!hasValidSpotlight) {
      uiState.spotlightStreamId = visibleStreams[0].id;
    }
  }

  const count = visibleStreams.length;
  let cols = 1;
  if (count === 2) cols = 2;
  else if (count >= 3 && count <= 4) cols = 2;
  else if (count >= 5 && count <= 9) cols = 3;
  else if (count >= 10) cols = 4;
  el.streamsStage.style.setProperty('--grid-cols', String(cols));

  // Atualiza barra superior de transmissões fechadas/pausadas
  el.minimizedDock.hidden = minimizedList.length === 0;
  el.minimizedPillsList.innerHTML = '';
  for (const item of minimizedList) {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'minimized-pill';
    pill.textContent = `${item.nickname} (Assistir)`;
    pill.addEventListener('click', () => openSpecificStream(item.id, false));
    el.minimizedPillsList.appendChild(pill);
  }

  // Remove cards que foram fechados
  for (const child of Array.from(el.streamsContainer.children)) {
    const sid = child.dataset.streamId;
    if (!uiState.activeStreams.has(sid) || uiState.minimizedStreams.has(sid)) {
      child.remove();
    }
  }

  // Cria ou atualiza os cards abertos
  for (const info of visibleStreams) {
    let card = document.getElementById(`stream-card-${info.id}`);
    if (!card) {
      card = createStreamCardElement(info);
      el.streamsContainer.appendChild(card);
    }
    updateStreamCardElement(card, info);
  }

  // Atualiza visibilidade de rede para cada peer
  for (const [id, info] of uiState.activeStreams.entries()) {
    if (info.isLocal) continue;
    const isVisible = !uiState.minimizedStreams.has(id);
    let tier = 'high';
    if (uiState.layoutMode === 'spotlight' && uiState.spotlightStreamId !== id) {
      tier = 'thumbnail';
    } else if (uiState.layoutMode === 'grid' && visibleStreams.length >= 5) {
      tier = 'thumbnail';
    }
    engine.setRemoteStreamVisibility(id, isVisible, tier);
  }
}

function createStreamCardElement(info) {
  const card = document.createElement('article');
  card.className = 'stream-card';
  card.id = `stream-card-${info.id}`;
  card.dataset.streamId = info.id;

  card.innerHTML = `
    <div class="stream-card-topbar">
      <div class="stream-user-badge">
        <span class="live-pill">AO VIVO</span>
        <span class="stream-title-label"></span>
      </div>
      <div class="stream-telemetry-badge" id="telemetry-${info.id}">
        ${info.isLocal ? 'Sua tela' : 'Conectando...'}
      </div>
    </div>

    <div class="stream-video-wrapper">
      <video class="stream-video" playsinline autoplay></video>
      <div class="eco-hidden-placeholder" hidden>
        <strong>Prévia ocultada pra economizar GPU</strong>
        <span>Seus amigos continuam vendo sua tela normalmente.</span>
      </div>
    </div>

    <div class="stream-card-controls">
      <div class="stream-volume-group">
        <button type="button" class="card-action-btn btn-mute-toggle">
          Som
        </button>
        <input type="range" class="stream-volume-slider" min="0" max="100" value="100" aria-label="Volume" />
      </div>

      <div class="stream-actions-group">
        <button type="button" class="card-action-btn btn-make-spotlight">
          Deixar grande
        </button>
        <button type="button" class="card-action-btn btn-focus-single">
          Ver só esta
        </button>
        <button type="button" class="card-action-btn btn-minimize-stream">
          Fechar tela
        </button>
        <button type="button" class="card-action-btn btn-fullscreen-stream">
          Tela cheia
        </button>
      </div>
    </div>
  `;

  const videoEl = card.querySelector('.stream-video');
  const muteBtn = card.querySelector('.btn-mute-toggle');
  const volumeSlider = card.querySelector('.stream-volume-slider');
  const spotlightBtn = card.querySelector('.btn-make-spotlight');
  const singleBtn = card.querySelector('.btn-focus-single');
  const minBtn = card.querySelector('.btn-minimize-stream');
  const fsBtn = card.querySelector('.btn-fullscreen-stream');

  if (info.isLocal) {
    videoEl.muted = true;
    card.querySelector('.stream-volume-group').hidden = true;
  } else {
    videoEl.muted = info.muted;
    videoEl.volume = (info.volume ?? 100) / 100;
    volumeSlider.value = String(info.volume ?? 100);
    muteBtn.textContent = info.muted ? 'Mudo' : 'Som';

    muteBtn.addEventListener('click', () => {
      const current = uiState.activeStreams.get(info.id);
      if (!current) return;
      current.muted = !current.muted;
      videoEl.muted = current.muted;
      muteBtn.textContent = current.muted ? 'Mudo' : 'Som';
    });

    volumeSlider.addEventListener('input', () => {
      const current = uiState.activeStreams.get(info.id);
      if (!current) return;
      const val = Number(volumeSlider.value);
      current.volume = val;
      current.muted = val === 0;
      videoEl.volume = val / 100;
      videoEl.muted = current.muted;
      muteBtn.textContent = current.muted ? 'Mudo' : 'Som';
    });
  }

  videoEl.addEventListener('dblclick', () => {
    if (uiState.layoutMode === 'spotlight' && uiState.spotlightStreamId === info.id) {
      setLayoutMode('grid');
    } else {
      setLayoutMode('spotlight', info.id);
    }
  });

  spotlightBtn.addEventListener('click', () => {
    setLayoutMode('spotlight', info.id);
  });

  singleBtn.addEventListener('click', () => {
    openSpecificStream(info.id, true);
  });

  minBtn.addEventListener('click', () => {
    closeSpecificStream(info.id);
  });

  fsBtn.addEventListener('click', () => {
    if (document.fullscreenElement === card) {
      document.exitFullscreen().catch(() => {});
    } else {
      card.requestFullscreen().catch(() => {});
    }
  });

  return card;
}

function updateStreamCardElement(card, info) {
  card.classList.toggle('is-spotlight', uiState.spotlightStreamId === info.id);

  const titleLabel = card.querySelector('.stream-title-label');
  const sourceTitle = info.streamMeta?.sourceName ? ` - ${info.streamMeta.sourceName}` : '';
  titleLabel.textContent = `${info.nickname}${sourceTitle}`;

  const videoEl = card.querySelector('.stream-video');
  const ecoPlaceholder = card.querySelector('.eco-hidden-placeholder');

  if (info.isLocal && uiState.hideSelfPreview) {
    if (videoEl.srcObject) {
      videoEl.srcObject = null;
    }
    videoEl.hidden = true;
    ecoPlaceholder.hidden = false;
  } else {
    ecoPlaceholder.hidden = true;
    videoEl.hidden = false;
    if (videoEl.srcObject !== info.stream) {
      videoEl.srcObject = info.stream;
      videoEl.play().catch(() => {});
    }
  }

  if (info.isLocal) {
    const telemetryBadge = document.getElementById(`telemetry-${info.id}`);
    if (telemetryBadge && info.streamMeta) {
      telemetryBadge.textContent = `${info.streamMeta.height || 1080}p | ${info.streamMeta.fps || 60} FPS | ${info.streamMeta.bitrateMbps} Mbps | ${info.streamMeta.codec}`;
    }
  }
}

// ============================================================================
// LISTA LATERAL DA SALA (QUEM ESTÁ NA SALA + QUEM ESTÁ TRANSMITINDO + BOTÃO ASSISTIR/FECHAR)
// ============================================================================
function updateRoomStatusUI(peersList) {
  const totalInRoom = peersList.length + 1;
  const sharingCount = peersList.filter((p) => p.sharing).length + (engine.isSharing ? 1 : 0);
  el.peersCountText.textContent = `${totalInRoom} na sala | ${sharingCount} transmitindo`;
  el.sidebarTitle.textContent = `Na sala (${totalInRoom})`;

  // Renderiza lista lateral estilo Discord
  el.sidebarMembersList.innerHTML = '';

  // 1. Item do próprio usuário
  const myItem = document.createElement('div');
  myItem.className = `member-item ${engine.isSharing ? 'is-streaming' : ''}`;
  const myMeta = engine.isSharing ? engine._buildMyStreamMeta() : null;
  const myWatching = isWatchingStream('local');

  myItem.innerHTML = `
    <div class="member-info">
      <div class="member-name-row">
        <span class="member-name">${engine.myNickname} (Você)</span>
        ${engine.isSharing ? '<span class="member-stream-tag">AO VIVO</span>' : ''}
      </div>
      <span class="member-sub">
        ${engine.isSharing ? `${myMeta?.sourceName || 'Sua tela'} (${myMeta?.height || 1080}p)` : 'Só assistindo'}
      </span>
    </div>
  `;

  if (engine.isSharing) {
    const toggleSelfBtn = document.createElement('button');
    toggleSelfBtn.type = 'button';
    toggleSelfBtn.className = `member-watch-btn ${myWatching ? 'watching' : ''}`;
    toggleSelfBtn.textContent = myWatching ? 'Fechar' : 'Assistir';
    toggleSelfBtn.addEventListener('click', () => {
      if (isWatchingStream('local')) {
        closeSpecificStream('local');
      } else {
        openSpecificStream('local', false);
      }
    });
    myItem.appendChild(toggleSelfBtn);
  }
  el.sidebarMembersList.appendChild(myItem);

  // 2. Itens de todos os amigos na sala
  for (const peer of peersList) {
    const row = document.createElement('div');
    row.className = `member-item ${peer.sharing ? 'is-streaming' : ''}`;
    const watching = isWatchingStream(peer.peerId);
    const streamDesc = peer.sharing
      ? `${peer.streamMeta?.sourceName || 'Tela'} (${peer.streamMeta?.height || 1080}p ${peer.streamMeta?.fps || 60}FPS)`
      : 'Só na sala';

    row.innerHTML = `
      <div class="member-info">
        <div class="member-name-row">
          <span class="member-name">${peer.nickname}</span>
          ${peer.sharing ? '<span class="member-stream-tag">AO VIVO</span>' : ''}
        </div>
        <span class="member-sub">${streamDesc}</span>
      </div>
    `;

    if (peer.sharing) {
      const watchBtn = document.createElement('button');
      watchBtn.type = 'button';
      watchBtn.className = `member-watch-btn ${watching ? 'watching' : ''}`;
      watchBtn.textContent = watching ? 'Fechar' : 'Assistir';
      watchBtn.addEventListener('click', () => {
        if (isWatchingStream(peer.peerId)) {
          closeSpecificStream(peer.peerId);
        } else {
          openSpecificStream(peer.peerId, false);
        }
      });
      row.appendChild(watchBtn);
    }

    el.sidebarMembersList.appendChild(row);
  }

  // Atualiza também os chips rápidos no card central quando nenhuma tela está aberta
  el.connectedFriendsList.innerHTML = '';
  for (const peer of peersList) {
    if (peer.sharing && !isWatchingStream(peer.peerId)) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn-primary btn-sm';
      btn.textContent = `Assistir ${peer.nickname}`;
      btn.addEventListener('click', () => openSpecificStream(peer.peerId, false));
      el.connectedFriendsList.appendChild(btn);
    }
  }
}

function renderQualityPresets() {
  el.presetsGrid.innerHTML = '';
  for (const preset of Object.values(QUALITY_PRESETS)) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `preset-card ${uiState.selectedPresetId === preset.id ? 'selected' : ''}`;
    btn.innerHTML = `
      <span class="preset-card-title">${preset.name}</span>
      <span class="preset-card-badge">${preset.badge}</span>
      <span class="preset-card-desc">${preset.description}</span>
    `;
    btn.addEventListener('click', () => {
      uiState.selectedPresetId = preset.id;
      el.selectResolution.value = `${preset.width}x${preset.height}`;
      el.selectFps.value = String(preset.fps);
      el.bitrateSlider.value = String(preset.bitrateMbps);
      el.bitrateValueLabel.textContent = `${preset.bitrateMbps} Mbps`;
      el.selectCodec.value = preset.codec;
      el.selectPriority.value = preset.contentHint;
      renderQualityPresets();
    });
    el.presetsGrid.appendChild(btn);
  }
}

async function loadDesktopSources() {
  el.sourcesGrid.innerHTML = '<p class="field-hint">Procurando telas e janelas...</p>';
  try {
    const sources = await window.electronAPI.getDesktopSources();
    uiState.availableSources = sources;

    if (!uiState.selectedSourceId && sources.length > 0) {
      uiState.selectedSourceId = sources[0].id;
      uiState.selectedSourceName = sources[0].name;
    }

    renderSourcesGrid();
  } catch (err) {
    el.sourcesGrid.innerHTML = `<p class="field-hint">Erro ao listar janelas: ${err.message}</p>`;
  }
}

function renderSourcesGrid() {
  el.sourcesGrid.innerHTML = '';
  const filtered = uiState.availableSources.filter((src) => {
    if (uiState.sourceFilter === 'screen') return src.isScreen;
    if (uiState.sourceFilter === 'window') return !src.isScreen;
    return true;
  });

  for (const src of filtered) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `source-item ${uiState.selectedSourceId === src.id ? 'selected' : ''}`;
    const hasValidThumb = src.thumbnail && src.thumbnail.length > 60;
    const typeLabel = src.isScreen ? '[TELA]' : '[JANELA]';
    const thumbMarkup = hasValidThumb
      ? `<img class="source-thumb" src="${src.thumbnail}" alt="${src.name}" />`
      : `<div class="source-thumb-placeholder">${typeLabel}</div>`;

    item.innerHTML = `
      ${thumbMarkup}
      <span class="source-title">${src.name}</span>
    `;
    item.addEventListener('click', () => {
      uiState.selectedSourceId = src.id;
      uiState.selectedSourceName = src.name;
      renderSourcesGrid();
    });
    el.sourcesGrid.appendChild(item);
  }
}

async function openShareConfigurationModal() {
  renderQualityPresets();
  el.modalEcoPreviewCheckbox.checked = uiState.hideSelfPreview;
  el.shareModal.showModal();
  await loadDesktopSources();
}

function getSelectedQualityConfig() {
  const [wStr, hStr] = (el.selectResolution.value || '1920x1080').split('x');
  const width = Number(wStr) || 1920;
  const height = Number(hStr) || 1080;
  const fps = Number(el.selectFps.value) || 60;
  const bitrateMbps = Number(el.bitrateSlider.value) || 10;
  const codec = el.selectCodec.value || 'H264';
  const contentHint = el.selectPriority.value || 'motion';

  return {
    sourceId: uiState.selectedSourceId,
    sourceName: uiState.selectedSourceName,
    includeSystemAudio: el.shareSystemAudioCheckbox.checked,
    width,
    height,
    fps,
    bitrateMbps,
    codec,
    contentHint,
    degradationPreference: contentHint === 'detail' ? 'maintain-resolution' : 'maintain-framerate'
  };
}

function updateShareControlButtons() {
  const sharing = engine.isSharing;
  el.openShareModalBtn.hidden = sharing;
  el.changeQualityBtn.hidden = !sharing;
  el.stopShareBtn.hidden = !sharing;
  el.localShareDot.classList.toggle('live', sharing);
  if (sharing) {
    const meta = engine._buildMyStreamMeta();
    el.localShareText.textContent = `Transmitindo: ${meta.height}p ${meta.fps}FPS (${meta.bitrateMbps}Mbps)`;
  } else {
    el.localShareText.textContent = 'Só assistindo (sem transmitir)';
  }
}

function toggleMuteAllStreams() {
  uiState.allMuted = !uiState.allMuted;
  for (const [id, info] of uiState.activeStreams.entries()) {
    if (info.isLocal) continue;
    info.muted = uiState.allMuted;
    const card = document.getElementById(`stream-card-${id}`);
    if (card) {
      const video = card.querySelector('.stream-video');
      const muteBtn = card.querySelector('.btn-mute-toggle');
      if (video) video.muted = uiState.allMuted;
      if (muteBtn) muteBtn.textContent = uiState.allMuted ? 'Mudo' : 'Som';
    }
  }
  el.muteAllStreamsBtn.textContent = uiState.allMuted ? 'Som das telas: Mudo' : 'Som das telas: Ligado';
}

function applyOverlayStateToDOM(state) {
  uiState.overlayActive = Boolean(state.active);
  uiState.overlayClickThrough = Boolean(state.clickThrough);

  document.documentElement.classList.toggle('is-overlay-mode', uiState.overlayActive);
  document.documentElement.classList.toggle('is-click-through', uiState.overlayClickThrough);
  document.documentElement.style.setProperty('--overlay-opacity', String(state.opacity ?? 0.92));

  el.overlayHudBar.hidden = !uiState.overlayActive;
  el.clickthroughBanner.hidden = !(uiState.overlayActive && uiState.overlayClickThrough);
}

function initEvents() {
  const savedName = localStorage.getItem('sspro_nickname') || '';
  const savedRoom = localStorage.getItem('sspro_room_code') || '';
  if (savedName) el.nicknameInput.value = savedName;
  if (savedRoom) {
    el.roomCodeInput.value = savedRoom;
  } else {
    el.roomCodeInput.value = `SALA-${Math.floor(100 + Math.random() * 900)}`;
  }

  el.randomRoomBtn.addEventListener('click', () => {
    el.roomCodeInput.value = `SALA-${Math.floor(100 + Math.random() * 900)}`;
  });

  el.joinRoomForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nickname = el.nicknameInput.value.trim() || 'Jogador';
    const roomCode = el.roomCodeInput.value.trim().toUpperCase();
    if (!roomCode) return;

    localStorage.setItem('sspro_nickname', nickname);
    localStorage.setItem('sspro_room_code', roomCode);

    el.joinRoomSubmitBtn.disabled = true;
    el.joinRoomSubmitBtn.textContent = 'Conectando...';

    try {
      await engine.joinRoom(roomCode, nickname);
    } catch (err) {
      alert(`Não deu pra conectar na sala: ${err.message || err}`);
    } finally {
      el.joinRoomSubmitBtn.disabled = false;
      el.joinRoomSubmitBtn.textContent = 'Entrar';
    }
  });

  el.copyRoomBtn.addEventListener('click', async () => {
    if (!engine.roomCode) return;
    await navigator.clipboard.writeText(engine.roomCode);
    el.copyRoomBtn.textContent = 'Copiado';
    setTimeout(() => {
      el.copyRoomBtn.textContent = 'Copiar';
    }, 1500);
  });

  el.layoutGridBtn.addEventListener('click', () => setLayoutMode('grid'));
  el.layoutSpotlightBtn.addEventListener('click', () => setLayoutMode('spotlight'));
  el.layoutSingleBtn.addEventListener('click', () => setLayoutMode('single'));

  const openAllStreams = () => {
    uiState.minimizedStreams.clear();
    if (uiState.layoutMode === 'single' && uiState.activeStreams.size > 1) {
      uiState.layoutMode = 'grid';
      updateLayoutButtonsUI();
    }
    updateRoomStatusUI(uiState.peersList);
    syncStreamsStage();
  };

  const closeAllStreams = () => {
    for (const id of uiState.activeStreams.keys()) {
      uiState.minimizedStreams.add(id);
    }
    updateRoomStatusUI(uiState.peersList);
    syncStreamsStage();
  };

  el.restoreAllStreamsBtn.addEventListener('click', openAllStreams);
  el.watchAllStreamsBtn.addEventListener('click', openAllStreams);
  el.closeAllStreamsBtn.addEventListener('click', closeAllStreams);

  el.toggleSidebarBtn.addEventListener('click', () => {
    el.roomSidebar.hidden = !el.roomSidebar.hidden;
  });

  el.openShareModalBtn.addEventListener('click', openShareConfigurationModal);
  el.emptyStartShareBtn.addEventListener('click', openShareConfigurationModal);
  el.changeQualityBtn.addEventListener('click', openShareConfigurationModal);

  el.closeShareModalBtn.addEventListener('click', () => el.shareModal.close());
  el.cancelShareModalBtn.addEventListener('click', () => el.shareModal.close());
  el.refreshSourcesBtn.addEventListener('click', loadDesktopSources);

  const setSourceFilter = (filter) => {
    uiState.sourceFilter = filter;
    el.tabSourceAll.classList.toggle('active', filter === 'all');
    el.tabSourceScreens.classList.toggle('active', filter === 'screen');
    el.tabSourceWindows.classList.toggle('active', filter === 'window');
    renderSourcesGrid();
  };
  el.tabSourceAll.addEventListener('click', () => setSourceFilter('all'));
  el.tabSourceScreens.addEventListener('click', () => setSourceFilter('screen'));
  el.tabSourceWindows.addEventListener('click', () => setSourceFilter('window'));

  el.bitrateSlider.addEventListener('input', () => {
    el.bitrateValueLabel.textContent = `${el.bitrateSlider.value} Mbps`;
  });

  el.confirmStartShareBtn.addEventListener('click', async () => {
    const config = getSelectedQualityConfig();
    uiState.hideSelfPreview = el.modalEcoPreviewCheckbox.checked;
    el.hideSelfPreviewToggle.checked = uiState.hideSelfPreview;

    el.confirmStartShareBtn.disabled = true;
    el.confirmStartShareBtn.textContent = 'Abrindo...';

    try {
      await engine.startScreenShare(config);
      el.shareModal.close();
    } catch (err) {
      alert(`Erro ao capturar tela: ${err.message}`);
    } finally {
      el.confirmStartShareBtn.disabled = false;
      el.confirmStartShareBtn.textContent = 'Transmitir';
    }
  });

  el.stopShareBtn.addEventListener('click', () => {
    engine.stopScreenShare();
  });

  el.hideSelfPreviewToggle.addEventListener('change', () => {
    uiState.hideSelfPreview = el.hideSelfPreviewToggle.checked;
    syncStreamsStage();
  });

  el.muteAllStreamsBtn.addEventListener('click', toggleMuteAllStreams);

  el.leaveRoomBtn.addEventListener('click', () => {
    engine.leaveRoom();
  });

  el.winMinBtn.addEventListener('click', () => window.electronAPI?.minimizeWindow());
  el.winMaxBtn.addEventListener('click', () => window.electronAPI?.toggleMaximizeWindow());
  el.winCloseBtn.addEventListener('click', () => window.electronAPI?.closeWindow());

  el.toggleOverlayBtn.addEventListener('click', () => {
    window.electronAPI?.toggleOverlay(true);
  });

  el.overlayExitBtn.addEventListener('click', () => {
    window.electronAPI?.toggleOverlay(false);
  });

  el.overlayClickthroughBtn.addEventListener('click', () => {
    window.electronAPI?.setClickThrough(!uiState.overlayClickThrough);
  });

  el.overlayOpacitySlider.addEventListener('input', () => {
    const val = Number(el.overlayOpacitySlider.value) / 100;
    window.electronAPI?.setOverlayOpacity(val);
  });

  el.overlayCycleStreamBtn.addEventListener('click', () => {
    const ids = Array.from(uiState.activeStreams.keys());
    if (ids.length === 0) return;
    const currentIdx = ids.indexOf(uiState.spotlightStreamId);
    const nextId = ids[(currentIdx + 1) % ids.length];
    openSpecificStream(nextId, true);
  });

  if (window.electronAPI) {
    window.electronAPI.onOverlayStateChanged((state) => {
      applyOverlayStateToDOM(state);
    });

    window.electronAPI.onToggleMuteAllShortcut(() => {
      toggleMuteAllStreams();
    });

    if (window.electronAPI.onUpdateProgress) {
      window.electronAPI.onUpdateProgress(({ percent, stage }) => {
        el.updateAppBtn.hidden = false;
        el.updateAppBtn.disabled = true;
        if (stage === 'installing') {
          el.updateAppBtn.textContent = 'Instalando e reiniciando...';
        } else {
          el.updateAppBtn.textContent = `Baixando atualização (${percent}%)...`;
        }
      });
    }

    const runUpdateCheck = async (manual = false) => {
      if (!window.electronAPI?.checkForUpdates) return;
      if (manual) {
        el.checkUpdateBtn.textContent = 'Verificando...';
      }
      try {
        const res = await window.electronAPI.checkForUpdates();
        if (res?.currentVersion) {
          el.checkUpdateBtn.textContent = `v${res.currentVersion}`;
        }
        if (res?.updateAvailable) {
          el.updateAppBtn.hidden = false;
          el.updateAppBtn.disabled = false;
          el.updateAppBtn.textContent = `Atualizar para v${res.latestVersion} (1 clique)`;
        } else if (manual) {
          el.checkUpdateBtn.textContent = `v${res?.currentVersion || '1.0.0'} (Atualizado)`;
          setTimeout(() => {
            el.checkUpdateBtn.textContent = `v${res?.currentVersion || '1.0.0'}`;
          }, 2500);
        }
      } catch (_) {
        if (manual) {
          el.checkUpdateBtn.textContent = 'v1.0.0';
        }
      }
    };

    el.checkUpdateBtn.addEventListener('click', () => runUpdateCheck(true));

    el.updateAppBtn.addEventListener('click', async () => {
      el.updateAppBtn.disabled = true;
      el.updateAppBtn.textContent = 'Iniciando download...';
      try {
        await window.electronAPI.installUpdate();
      } catch (err) {
        alert(`Erro ao atualizar: ${err.message || err}`);
        el.updateAppBtn.disabled = false;
        el.updateAppBtn.textContent = 'Tentar atualizar novamente';
      }
    });

    runUpdateCheck(false);
    setInterval(() => runUpdateCheck(false), 10 * 60 * 1000);
  }
}

initEvents();
