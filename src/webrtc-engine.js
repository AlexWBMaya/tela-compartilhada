/**
 * Motor WebRTC Multi-Stream P2P de Alta Performance para Jogos
 * Suporta salas com 10+ participantes simultâneos, controle fino de bitrate/FPS/codec,
 * áudio exclusivo do sistema/jogo (sem microfone) e pausa inteligente de streams minimizadas.
 */

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' }
];

export const QUALITY_PRESETS = {
  'gamer-eco': {
    id: 'gamer-eco',
    name: 'Leve',
    badge: '720p | 60 FPS | 4 Mbps',
    description: 'Pesa quase nada. Bom pra quando todo mundo estiver transmitindo junto.',
    width: 1280,
    height: 720,
    fps: 60,
    bitrateMbps: 4,
    codec: 'H264',
    contentHint: 'motion',
    degradationPreference: 'maintain-framerate'
  },
  'balanced-60': {
    id: 'balanced-60',
    name: 'Padrão (1080p)',
    badge: '1080p | 60 FPS | 10 Mbps',
    description: 'Boa qualidade e 60 FPS estáveis sem pesar no jogo.',
    width: 1920,
    height: 1080,
    fps: 60,
    bitrateMbps: 10,
    codec: 'H264',
    contentHint: 'motion',
    degradationPreference: 'maintain-framerate'
  },
  'high-1080': {
    id: 'high-1080',
    name: 'Alta (1080p+)',
    badge: '1080p | 60 FPS | 18 Mbps',
    description: 'Mais bitrate pra imagem não quadricular em jogo rápido.',
    width: 1920,
    height: 1080,
    fps: 60,
    bitrateMbps: 18,
    codec: 'H264',
    contentHint: 'motion',
    degradationPreference: 'maintain-framerate'
  },
  'ultra-1440': {
    id: 'ultra-1440',
    name: '2K (1440p)',
    badge: '1440p | 60 FPS | 25 Mbps',
    description: 'Imagem em 2K a 60 FPS.',
    width: 2560,
    height: 1440,
    fps: 60,
    bitrateMbps: 25,
    codec: 'H264',
    contentHint: 'motion',
    degradationPreference: 'maintain-framerate'
  },
  'insane-120': {
    id: 'insane-120',
    name: '120 FPS',
    badge: '1440p | 120 FPS | 35 Mbps',
    description: 'Até 120 FPS. Precisa de internet boa.',
    width: 2560,
    height: 1440,
    fps: 120,
    bitrateMbps: 35,
    codec: 'H264',
    contentHint: 'motion',
    degradationPreference: 'maintain-framerate'
  }
};

export class MultiStreamRoomEngine {
  constructor(callbacks = {}) {
    this.callbacks = callbacks;
    this.peer = null;
    this.myPeerId = null;
    this.myNickname = 'Jogador';
    this.roomCode = null;
    this.isRoomCoordinator = false;

    // Map<peerId, { conn, nickname, sharing, streamMeta, mediaConn, remoteStream, viewerVisibility, viewerTier }>
    this.peers = new Map();
    // Map<peerId, MediaConnection> (conexões onde EU envio minha tela para o peer)
    this.outgoingCalls = new Map();
    // Map<peerId, MediaConnection> (conexões onde EU recebo a tela do peer)
    this.incomingCalls = new Map();

    this.localStream = null;
    this.isSharing = false;
    this.smartScalingEnabled = true;

    this.qualityConfig = {
      ...QUALITY_PRESETS['balanced-60'],
      includeSystemAudio: true,
      sourceId: null,
      sourceName: 'Tela Principal'
    };

    this.statsInterval = null;
    this.previousStats = new Map();
  }

  normalizeRoomCode(code) {
    return String(code || '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9-]/g, '')
      .slice(0, 24);
  }

  getCoordinatorId(roomCode) {
    const clean = this.normalizeRoomCode(roomCode).toLowerCase();
    return `sspro-v1-room-${clean}-host`;
  }

  generateMemberId(roomCode) {
    const clean = this.normalizeRoomCode(roomCode).toLowerCase();
    const rand = Math.random().toString(36).substring(2, 8);
    return `sspro-v1-room-${clean}-p-${rand}`;
  }

  /**
   * Entra ou cria automaticamente uma sala pelo Código da Sala.
   * Tenta registrar como Coordenador da sala primeiro; se a sala já existir,
   * entra como participante e conecta em malha (Mesh) com todos os amigos presentes.
   */
  async joinRoom(rawRoomCode, nickname) {
    const code = this.normalizeRoomCode(rawRoomCode);
    if (!code) {
      throw new Error('Digite um código de sala válido.');
    }

    this.leaveRoom();

    this.roomCode = code;
    this.myNickname = (nickname || 'Jogador').trim().slice(0, 24) || 'Jogador';

    const coordinatorId = this.getCoordinatorId(code);

    return new Promise((resolve, reject) => {
      let settled = false;

      const tryAsCoordinator = () => {
        const hostPeer = new window.Peer(coordinatorId, {
          config: {
            iceServers: ICE_SERVERS,
            sdpSemantics: 'unified-plan'
          },
          debug: 1
        });

        hostPeer.on('open', (id) => {
          if (settled) return;
          settled = true;
          this.peer = hostPeer;
          this.myPeerId = id;
          this.isRoomCoordinator = true;
          this._setupPeerListeners(hostPeer);
          this._startTelemetryLoop();
          this.callbacks.onRoomJoined?.({
            roomCode: this.roomCode,
            myPeerId: this.myPeerId,
            isHost: true
          });
          resolve({ roomCode: this.roomCode, myPeerId: this.myPeerId, isHost: true });
        });

        hostPeer.on('error', (err) => {
          if (!settled && err.type === 'unavailable-id') {
            // A sala já existe! Conecta como membro da sala existente
            try {
              hostPeer.destroy();
            } catch (_) {}
            tryAsMember();
            return;
          }
          if (!settled) {
            settled = true;
            reject(err);
          } else {
            this.callbacks.onError?.(err);
          }
        });
      };

      const tryAsMember = () => {
        const memberId = this.generateMemberId(code);
        const memberPeer = new window.Peer(memberId, {
          config: {
            iceServers: ICE_SERVERS,
            sdpSemantics: 'unified-plan'
          },
          debug: 1
        });

        memberPeer.on('open', (id) => {
          if (settled) return;
          settled = true;
          this.peer = memberPeer;
          this.myPeerId = id;
          this.isRoomCoordinator = false;
          this._setupPeerListeners(memberPeer);
          this._startTelemetryLoop();

          // Conecta ao coordenador da sala para descobrir todos os amigos presentes
          this._connectToPeer(coordinatorId, true);

          this.callbacks.onRoomJoined?.({
            roomCode: this.roomCode,
            myPeerId: this.myPeerId,
            isHost: false
          });
          resolve({ roomCode: this.roomCode, myPeerId: this.myPeerId, isHost: false });
        });

        memberPeer.on('error', (err) => {
          if (!settled) {
            settled = true;
            reject(err);
          } else {
            this.callbacks.onError?.(err);
          }
        });
      };

      tryAsCoordinator();
    });
  }

  _setupPeerListeners(peerInstance) {
    peerInstance.on('connection', (dataConn) => {
      this._registerDataConnection(dataConn);
    });

    peerInstance.on('call', (mediaConn) => {
      this._handleIncomingCall(mediaConn);
    });

    peerInstance.on('disconnected', () => {
      if (this.peer && !this.peer.destroyed) {
        this.peer.reconnect();
      }
    });
  }

  _connectToPeer(remotePeerId, isCoordinator = false) {
    if (!this.peer || remotePeerId === this.myPeerId) return;
    const existing = this.peers.get(remotePeerId);
    if (existing?.conn && existing.conn.open) return;

    const conn = this.peer.connect(remotePeerId, {
      reliable: true,
      metadata: {
        nickname: this.myNickname,
        roomCode: this.roomCode
      }
    });

    this._registerDataConnection(conn, isCoordinator);
  }

  _registerDataConnection(conn, isCoordinator = false) {
    const remotePeerId = conn.peer;
    if (!remotePeerId || remotePeerId === this.myPeerId) return;

    let peerEntry = this.peers.get(remotePeerId);
    if (!peerEntry) {
      peerEntry = {
        peerId: remotePeerId,
        nickname: conn.metadata?.nickname || 'Amigo',
        conn,
        sharing: false,
        streamMeta: null,
        remoteStream: null,
        viewerVisibility: true, // Se este amigo está com a minha tela aberta
        viewerTier: 'high'      // 'high' | 'thumbnail'
      };
      this.peers.set(remotePeerId, peerEntry);
    } else {
      peerEntry.conn = conn;
      if (conn.metadata?.nickname) {
        peerEntry.nickname = conn.metadata.nickname;
      }
    }

    conn.on('open', () => {
      // Envia apresentação + estado atual da minha transmissão
      this._sendToPeer(remotePeerId, {
        type: 'hello',
        peerId: this.myPeerId,
        nickname: this.myNickname,
        sharing: this.isSharing,
        streamMeta: this.isSharing ? this._buildMyStreamMeta() : null
      });

      // Se eu sou o coordenador da sala, envio a lista de todos os participantes para o novo membro
      if (this.isRoomCoordinator) {
        const peerList = [];
        for (const [pid, info] of this.peers.entries()) {
          if (pid !== remotePeerId && info.conn?.open) {
            peerList.push({
              peerId: pid,
              nickname: info.nickname
            });
          }
        }
        this._sendToPeer(remotePeerId, {
          type: 'room-roster',
          peers: peerList
        });
      }

      // Se eu já estou compartilhando tela, inicio envio da stream para este amigo
      if (this.isSharing && this.localStream) {
        this._callPeerWithScreen(remotePeerId);
      }

      this._notifyPeersUpdated();
    });

    conn.on('data', (msg) => {
      this._handleDataMessage(remotePeerId, msg);
    });

    conn.on('close', () => {
      this._handlePeerDisconnected(remotePeerId);
    });

    conn.on('error', () => {
      this._handlePeerDisconnected(remotePeerId);
    });
  }

  _handleDataMessage(remotePeerId, msg) {
    if (!msg || typeof msg !== 'object') return;
    const peerEntry = this.peers.get(remotePeerId);
    if (!peerEntry) return;

    switch (msg.type) {
      case 'hello': {
        peerEntry.nickname = msg.nickname || peerEntry.nickname;
        peerEntry.sharing = Boolean(msg.sharing);
        peerEntry.streamMeta = msg.streamMeta || null;
        this._notifyPeersUpdated();
        break;
      }

      case 'room-roster': {
        if (Array.isArray(msg.peers)) {
          for (const item of msg.peers) {
            if (item.peerId && item.peerId !== this.myPeerId && !this.peers.has(item.peerId)) {
              this._connectToPeer(item.peerId);
            }
          }
        }
        break;
      }

      case 'stream-state': {
        peerEntry.sharing = Boolean(msg.sharing);
        peerEntry.streamMeta = msg.streamMeta || null;
        if (!peerEntry.sharing) {
          peerEntry.remoteStream = null;
          const inc = this.incomingCalls.get(remotePeerId);
          if (inc) {
            try { inc.close(); } catch (_) {}
            this.incomingCalls.delete(remotePeerId);
          }
          this.callbacks.onRemoteStreamRemoved?.(remotePeerId);
        }
        this._notifyPeersUpdated();
        break;
      }

      case 'viewer-visibility': {
        // O amigo informou se minimizou ou restaurou minha tela, ou se está em miniatura/destaque!
        peerEntry.viewerVisibility = Boolean(msg.visible);
        peerEntry.viewerTier = msg.tier || 'high';
        this._applyEncodingForPeer(remotePeerId);
        this._notifyPeersUpdated();
        break;
      }

      default:
        break;
    }
  }

  _handleIncomingCall(mediaConn) {
    const remotePeerId = mediaConn.peer;
    const existingCall = this.incomingCalls.get(remotePeerId);
    if (existingCall && existingCall !== mediaConn) {
      try { existingCall.close(); } catch (_) {}
    }

    this.incomingCalls.set(remotePeerId, mediaConn);
    // Responde sem enviar mídia de volta (cada transmissão é unidirecional por chamada para máxima performance)
    mediaConn.answer();

    mediaConn.on('stream', (remoteStream) => {
      let peerEntry = this.peers.get(remotePeerId);
      if (!peerEntry) {
        peerEntry = {
          peerId: remotePeerId,
          nickname: mediaConn.metadata?.nickname || 'Amigo',
          conn: null,
          sharing: true,
          streamMeta: mediaConn.metadata?.streamMeta || null,
          remoteStream,
          viewerVisibility: true,
          viewerTier: 'high'
        };
        this.peers.set(remotePeerId, peerEntry);
      } else {
        peerEntry.sharing = true;
        peerEntry.remoteStream = remoteStream;
        if (mediaConn.metadata?.streamMeta) {
          peerEntry.streamMeta = mediaConn.metadata.streamMeta;
        }
      }

      this.callbacks.onRemoteStreamAdded?.({
        peerId: remotePeerId,
        nickname: peerEntry.nickname,
        stream: remoteStream,
        streamMeta: peerEntry.streamMeta
      });
      this._notifyPeersUpdated();
    });

    mediaConn.on('close', () => {
      this.incomingCalls.delete(remotePeerId);
      const peerEntry = this.peers.get(remotePeerId);
      if (peerEntry) {
        peerEntry.remoteStream = null;
      }
      this.callbacks.onRemoteStreamRemoved?.(remotePeerId);
      this._notifyPeersUpdated();
    });
  }

  _handlePeerDisconnected(remotePeerId) {
    const outCall = this.outgoingCalls.get(remotePeerId);
    if (outCall) {
      try { outCall.close(); } catch (_) {}
      this.outgoingCalls.delete(remotePeerId);
    }

    const incCall = this.incomingCalls.get(remotePeerId);
    if (incCall) {
      try { incCall.close(); } catch (_) {}
      this.incomingCalls.delete(remotePeerId);
    }

    this.peers.delete(remotePeerId);
    this.previousStats.delete(remotePeerId);
    this.callbacks.onRemoteStreamRemoved?.(remotePeerId);
    this._notifyPeersUpdated();
  }

  _sendToPeer(remotePeerId, payload) {
    const peerEntry = this.peers.get(remotePeerId);
    if (peerEntry?.conn && peerEntry.conn.open) {
      try {
        peerEntry.conn.send(payload);
      } catch (err) {
        console.warn('Falha ao enviar mensagem para peer:', remotePeerId, err);
      }
    }
  }

  broadcastData(payload) {
    for (const remotePeerId of this.peers.keys()) {
      this._sendToPeer(remotePeerId, payload);
    }
  }

  /**
   * Informa ao amigo remoto se a tela dele está visível ou minimizada aqui,
   * permitindo pausar o envio de vídeo na origem para economizar GPU e banda.
   */
  setRemoteStreamVisibility(remotePeerId, visible, tier = 'high') {
    this._sendToPeer(remotePeerId, {
      type: 'viewer-visibility',
      visible: Boolean(visible),
      tier
    });
  }

  _buildMyStreamMeta() {
    const videoTrack = this.localStream?.getVideoTracks()?.[0];
    const settings = videoTrack?.getSettings?.() || {};
    const hasAudio = (this.localStream?.getAudioTracks()?.length || 0) > 0;

    return {
      sourceName: this.qualityConfig.sourceName || 'Tela Compartilhada',
      width: settings.width || this.qualityConfig.width,
      height: settings.height || this.qualityConfig.height,
      fps: this.qualityConfig.fps,
      bitrateMbps: this.qualityConfig.bitrateMbps,
      codec: this.qualityConfig.codec,
      hasAudio
    };
  }

  /**
   * Inicia ou troca a captura de tela/jogo (APENAS vídeo + áudio opcional do sistema/jogo, SEM microfone).
   */
  async startScreenShare(customConfig = {}) {
    this.qualityConfig = {
      ...this.qualityConfig,
      ...customConfig
    };

    const { sourceId, includeSystemAudio, width, height, fps, contentHint } = this.qualityConfig;

    // Prepara o handler do processo principal do Electron com a janela/tela escolhida e loopback de áudio
    if (window.electronAPI?.prepareCapture) {
      await window.electronAPI.prepareCapture({
        sourceId,
        includeSystemAudio
      });
    }

    let newStream = null;

    // 1ª tentativa: getDisplayMedia nativo (suporta loopback de áudio limpo do Windows + captura WGC de alto FPS)
    try {
      newStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: width, max: width },
          height: { ideal: height, max: height },
          frameRate: { ideal: fps, max: fps }
        },
        audio: Boolean(includeSystemAudio)
      });
    } catch (err) {
      console.warn('getDisplayMedia falhou, usando fallback desktopCapturer getUserMedia:', err);
    }

    // 2ª tentativa (Fallback direto por sourceId via chromeMediaSource: 'desktop')
    if (!newStream && sourceId) {
      const videoConstraints = {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId,
          maxWidth: width,
          maxHeight: height,
          minFrameRate: Math.min(30, fps),
          maxFrameRate: fps
        }
      };

      const audioConstraints = includeSystemAudio
        ? {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: sourceId
            }
          }
        : false;

      try {
        newStream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints,
          audio: audioConstraints
        });
      } catch (audioErr) {
        // Caso uma janela específica não permita captura direta de áudio no fallback, captura apenas o vídeo
        newStream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints,
          audio: false
        });
      }
    }

    if (!newStream) {
      throw new Error('Não foi possível capturar a tela ou janela selecionada.');
    }

    // Aplica dica de conteúdo (motion = prioriza fluidez de FPS em jogos; detail = prioriza nitidez de texto)
    const videoTrack = newStream.getVideoTracks()[0];
    if (videoTrack) {
      try {
        videoTrack.contentHint = contentHint || 'motion';
      } catch (_) {}

      videoTrack.onended = () => {
        this.stopScreenShare();
      };
    }

    // Se já estávamos compartilhando, substitui as tracks sem derrubar as conexões WebRTC
    const previousStream = this.localStream;
    this.localStream = newStream;
    this.isSharing = true;

    if (previousStream) {
      previousStream.getTracks().forEach((t) => t.stop());
    }

    // Conecta ou atualiza todos os peers da sala
    for (const remotePeerId of this.peers.keys()) {
      this._callPeerWithScreen(remotePeerId);
    }

    const meta = this._buildMyStreamMeta();
    this.broadcastData({
      type: 'stream-state',
      sharing: true,
      streamMeta: meta
    });

    this.callbacks.onLocalStreamUpdated?.(this.localStream, meta);
    this._notifyPeersUpdated();
    return this.localStream;
  }

  /**
   * Atualiza qualidade (Bitrate, FPS, Resolução, Prioridade) em tempo real durante o jogo
   */
  async updateQualityLive(partialConfig = {}) {
    const resolutionOrSourceChanged =
      (partialConfig.sourceId && partialConfig.sourceId !== this.qualityConfig.sourceId) ||
      (partialConfig.width && partialConfig.width !== this.qualityConfig.width) ||
      (partialConfig.height && partialConfig.height !== this.qualityConfig.height);

    this.qualityConfig = {
      ...this.qualityConfig,
      ...partialConfig
    };

    if (!this.isSharing || !this.localStream) return;

    if (resolutionOrSourceChanged && this.qualityConfig.sourceId) {
      await this.startScreenShare(this.qualityConfig);
      return;
    }

    const videoTrack = this.localStream.getVideoTracks()[0];
    if (videoTrack) {
      try {
        videoTrack.contentHint = this.qualityConfig.contentHint || 'motion';
        await videoTrack.applyConstraints({
          width: { ideal: this.qualityConfig.width, max: this.qualityConfig.width },
          height: { ideal: this.qualityConfig.height, max: this.qualityConfig.height },
          frameRate: { ideal: this.qualityConfig.fps, max: this.qualityConfig.fps }
        });
      } catch (err) {
        console.warn('Aviso ao aplicar constraints ao vivo:', err);
      }
    }

    for (const remotePeerId of this.outgoingCalls.keys()) {
      await this._applyEncodingForPeer(remotePeerId);
    }

    const meta = this._buildMyStreamMeta();
    this.broadcastData({
      type: 'stream-state',
      sharing: true,
      streamMeta: meta
    });
    this.callbacks.onLocalStreamUpdated?.(this.localStream, meta);
  }

  stopScreenShare() {
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
      this.localStream = null;
    }
    this.isSharing = false;

    for (const [, call] of this.outgoingCalls.entries()) {
      try { call.close(); } catch (_) {}
    }
    this.outgoingCalls.clear();

    this.broadcastData({
      type: 'stream-state',
      sharing: false,
      streamMeta: null
    });

    this.callbacks.onLocalStreamStopped?.();
    this._notifyPeersUpdated();
  }

  _callPeerWithScreen(remotePeerId) {
    if (!this.peer || !this.localStream || !this.isSharing) return;

    const existingCall = this.outgoingCalls.get(remotePeerId);
    if (existingCall) {
      try { existingCall.close(); } catch (_) {}
      this.outgoingCalls.delete(remotePeerId);
    }

    const call = this.peer.call(remotePeerId, this.localStream, {
      metadata: {
        nickname: this.myNickname,
        streamMeta: this._buildMyStreamMeta()
      }
    });

    if (!call) return;
    this.outgoingCalls.set(remotePeerId, call);

    const applyParams = () => {
      this._applyCodecPreference(call.peerConnection, this.qualityConfig.codec);
      this._applyEncodingForPeer(remotePeerId);
    };

    if (call.peerConnection) {
      applyParams();
      call.peerConnection.addEventListener('connectionstatechange', () => {
        if (call.peerConnection.connectionState === 'connected') {
          this._applyEncodingForPeer(remotePeerId);
        }
      });
    }

    setTimeout(() => this._applyEncodingForPeer(remotePeerId), 600);
    setTimeout(() => this._applyEncodingForPeer(remotePeerId), 2000);
  }

  _applyCodecPreference(pc, preferredCodec = 'H264') {
    if (!pc || !window.RTCRtpSender?.getCapabilities) return;
    try {
      const capabilities = RTCRtpSender.getCapabilities('video');
      if (!capabilities?.codecs) return;

      const targetMime = `video/${preferredCodec}`.toLowerCase();
      const preferred = [];
      const rest = [];

      for (const codec of capabilities.codecs) {
        if (codec.mimeType.toLowerCase() === targetMime) {
          preferred.push(codec);
        } else {
          rest.push(codec);
        }
      }

      if (preferred.length > 0 && pc.getTransceivers) {
        for (const transceiver of pc.getTransceivers()) {
          if (
            transceiver.sender?.track?.kind === 'video' &&
            typeof transceiver.setCodecPreferences === 'function'
          ) {
            transceiver.setCodecPreferences([...preferred, ...rest]);
          }
        }
      }
    } catch (err) {
      console.warn('Não foi possível definir preferência de codec:', err);
    }
  }

  async _applyEncodingForPeer(remotePeerId) {
    const call = this.outgoingCalls.get(remotePeerId);
    const pc = call?.peerConnection;
    if (!pc) return;

    const peerEntry = this.peers.get(remotePeerId);
    const isVisibleOnViewer = peerEntry ? peerEntry.viewerVisibility !== false : true;
    const viewerTier = peerEntry?.viewerTier || 'high';

    const senders = pc.getSenders ? pc.getSenders() : [];
    for (const sender of senders) {
      if (!sender.track) continue;

      if (sender.track.kind === 'video') {
        try {
          const params = sender.getParameters();
          if (!params.encodings || params.encodings.length === 0) {
            params.encodings = [{}];
          }

          params.degradationPreference =
            this.qualityConfig.degradationPreference || 'maintain-framerate';

          const encoding = params.encodings[0];
          // Pausa Inteligente: Se o amigo minimizou esta tela, desativa o envio de vídeo para ele!
          encoding.active = isVisibleOnViewer;

          if (isVisibleOnViewer) {
            const isThumbnailScale = this.smartScalingEnabled && viewerTier === 'thumbnail';
            const targetBitrateMbps = isThumbnailScale
              ? Math.max(2.5, Math.round(this.qualityConfig.bitrateMbps * 0.45))
              : this.qualityConfig.bitrateMbps;

            encoding.maxBitrate = Math.round(targetBitrateMbps * 1_000_000);
            encoding.maxFramerate = this.qualityConfig.fps;
            encoding.scaleResolutionDownBy = isThumbnailScale ? 1.5 : 1.0;
            encoding.priority = 'high';
            encoding.networkPriority = 'high';
          }

          await sender.setParameters(params);
        } catch (err) {
          console.warn('Aviso ao configurar parâmetros de vídeo WebRTC:', err);
        }
      } else if (sender.track.kind === 'audio') {
        try {
          const params = sender.getParameters();
          if (!params.encodings || params.encodings.length === 0) {
            params.encodings = [{}];
          }
          // Áudio do jogo com bitrate alto (192 kbps estéreo limpo)
          params.encodings[0].maxBitrate = 192_000;
          params.encodings[0].priority = 'high';
          await sender.setParameters(params);
        } catch (_) {}
      }
    }
  }

  _startTelemetryLoop() {
    if (this.statsInterval) clearInterval(this.statsInterval);

    this.statsInterval = setInterval(async () => {
      const statsByPeer = {};

      // Coleta telemetria das streams recebidas
      for (const [remotePeerId, call] of this.incomingCalls.entries()) {
        const pc = call?.peerConnection;
        if (!pc) continue;

        try {
          const report = await pc.getStats();
          let fps = 0;
          let width = 0;
          let height = 0;
          let bytesReceived = 0;
          let timestamp = 0;
          let rttMs = null;
          let codecName = '';
          let decoderImpl = '';

          report.forEach((stat) => {
            if (stat.type === 'inbound-rtp' && stat.kind === 'video') {
              fps = stat.framesPerSecond || 0;
              width = stat.frameWidth || 0;
              height = stat.frameHeight || 0;
              bytesReceived = stat.bytesReceived || 0;
              timestamp = stat.timestamp || Date.now();
              decoderImpl = stat.decoderImplementation || '';
              if (stat.codecId && report.get(stat.codecId)) {
                const codecStat = report.get(stat.codecId);
                codecName = (codecStat.mimeType || '').replace('video/', '');
              }
            }
            if (stat.type === 'candidate-pair' && stat.state === 'succeeded' && stat.currentRoundTripTime != null) {
              rttMs = Math.round(stat.currentRoundTripTime * 1000);
            }
          });

          const prev = this.previousStats.get(remotePeerId);
          let bitrateMbps = 0;
          if (prev && timestamp > prev.timestamp && bytesReceived >= prev.bytesReceived) {
            const deltaSec = (timestamp - prev.timestamp) / 1000;
            const bits = (bytesReceived - prev.bytesReceived) * 8;
            bitrateMbps = Number((bits / deltaSec / 1_000_000).toFixed(1));
          }
          this.previousStats.set(remotePeerId, { bytesReceived, timestamp });

          statsByPeer[remotePeerId] = {
            fps: Math.round(fps),
            width,
            height,
            bitrateMbps,
            rttMs,
            codecName,
            decoderImpl
          };
        } catch (_) {}
      }

      // Quantos amigos estão assistindo minha transmissão ativamente vs minimizada
      let activeViewers = 0;
      let minimizedViewers = 0;
      if (this.isSharing) {
        for (const peerEntry of this.peers.values()) {
          if (peerEntry.viewerVisibility === false) {
            minimizedViewers++;
          } else {
            activeViewers++;
          }
        }
      }

      this.callbacks.onTelemetryUpdate?.({
        streams: statsByPeer,
        activeViewers,
        minimizedViewers
      });
    }, 1200);
  }

  _notifyPeersUpdated() {
    const list = [];
    for (const p of this.peers.values()) {
      list.push({
        peerId: p.peerId,
        nickname: p.nickname,
        sharing: p.sharing,
        streamMeta: p.streamMeta,
        hasRemoteStream: Boolean(p.remoteStream),
        viewerVisibility: p.viewerVisibility
      });
    }
    this.callbacks.onPeersUpdated?.(list);
  }

  leaveRoom() {
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }

    this.stopScreenShare();

    for (const [, call] of this.incomingCalls.entries()) {
      try { call.close(); } catch (_) {}
    }
    this.incomingCalls.clear();

    for (const [, peerEntry] of this.peers.entries()) {
      try { peerEntry.conn?.close(); } catch (_) {}
    }
    this.peers.clear();
    this.previousStats.clear();

    if (this.peer) {
      try { this.peer.destroy(); } catch (_) {}
      this.peer = null;
    }

    this.myPeerId = null;
    this.roomCode = null;
    this.isRoomCoordinator = false;
    this.callbacks.onRoomLeft?.();
  }
}
