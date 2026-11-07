/**
 * Motor WebRTC Multi-Stream P2P de Alta Performance para Jogos
 * Suporta salas com 10+ participantes simultâneos, controle fino de bitrate/FPS/codec,
 * áudio exclusivo do sistema/jogo (sem microfone) e pausa inteligente de streams minimizadas.
 */

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:openrelay.metered.ca:80' },
  { urls: 'stun:openrelay.metered.ca:443' },
  {
    urls: [
      'turn:openrelay.metered.ca:80',
      'turn:openrelay.metered.ca:443',
      'turn:openrelay.metered.ca:443?transport=tcp'
    ],
    username: 'openrelayproject',
    credential: 'openrelayproject'
  }
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
    codec: 'VP9',
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
    codec: 'VP9',
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
    codec: 'VP9',
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
    codec: 'VP9',
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
    codec: 'VP9',
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

    // Map<peerId, { conn, allConns, nickname, sharing, streamMeta, mediaConn, remoteStream, viewerVisibility, viewerTier }>
    this.peers = new Map();
    // Map<peerId, DataConnection> (conexões de dados ainda em handshake)
    this.pendingConns = new Map();
    // Map<peerId, MediaConnection> (conexões onde EU envio minha tela para o peer)
    this.outgoingCalls = new Map();
    // Map<peerId, MediaConnection> (conexões onde EU recebo a tela do peer)
    this.incomingCalls = new Map();

    this.localStream = null;
    this.isSharing = false;
    this.smartScalingEnabled = true;
    this.allowedControllerPeerId = null;

    this.qualityConfig = {
      ...QUALITY_PRESETS['balanced-60'],
      includeSystemAudio: true,
      audioTargetSourceId: 'active',
      sourceId: null,
      sourceName: 'Tela Principal'
    };

    this.audioCtx = null;
    this.workletLoaded = false;
    this.audioWorkletNode = null;
    this.audioDestination = null;
    this.removeAudioPcmListener = null;
    this.removeAudioStatusListener = null;
    this.activeAudioStatus = null;

    this.statsInterval = null;
    this.discoveryTimeouts = [];
    this.telemetryTickCount = 0;
    this.previousStats = new Map();

    let savedClientId = '';
    try {
      savedClientId = localStorage.getItem('sspro_client_instance_id') || '';
      if (!savedClientId) {
        savedClientId = `cid-${Math.random().toString(36).substring(2, 10)}-${Date.now().toString(36)}`;
        localStorage.setItem('sspro_client_instance_id', savedClientId);
      }
    } catch (_) {
      savedClientId = `cid-${Math.random().toString(36).substring(2, 10)}`;
    }
    this.clientId = savedClientId;
    this.sessionId = `sess-${Math.random().toString(36).substring(2, 10)}-${Date.now().toString(36)}`;
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

  getRoomSlotIds(roomCode) {
    const clean = this.normalizeRoomCode(roomCode).toLowerCase();
    const slots = [`sspro-v1-room-${clean}-host`];
    for (let i = 1; i <= 7; i++) {
      slots.push(`sspro-v1-room-${clean}-s${i}`);
    }
    return slots;
  }

  generateMemberId(roomCode) {
    const clean = this.normalizeRoomCode(roomCode).toLowerCase();
    const rand = Math.random().toString(36).substring(2, 8);
    return `sspro-v1-room-${clean}-p-${rand}`;
  }

  _getOrderedCandidateSlots(roomCode) {
    const clean = this.normalizeRoomCode(roomCode).toLowerCase();
    const slots = this.getRoomSlotIds(roomCode);
    try {
      const raw = localStorage.getItem(`sspro_last_slot_${clean}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (
          parsed &&
          typeof parsed.slotIndex === 'number' &&
          parsed.slotIndex >= 0 &&
          parsed.slotIndex < slots.length &&
          Date.now() - (parsed.ts || 0) < 45000
        ) {
          const rotated = [];
          for (let i = 1; i <= slots.length; i++) {
            rotated.push(slots[(parsed.slotIndex + i) % slots.length]);
          }
          return rotated;
        }
      }
    } catch (_) {}
    return slots;
  }

  _saveMySlotIndex(roomCode, peerId) {
    const clean = this.normalizeRoomCode(roomCode).toLowerCase();
    const slots = this.getRoomSlotIds(roomCode);
    const idx = slots.indexOf(peerId);
    if (idx >= 0) {
      try {
        localStorage.setItem(
          `sspro_last_slot_${clean}`,
          JSON.stringify({ slotIndex: idx, ts: Date.now() })
        );
      } catch (_) {}
    }
  }

  _saveKnownRoomPeers() {
    if (!this.roomCode || this.peers.size === 0) return;
    const clean = this.normalizeRoomCode(this.roomCode).toLowerCase();
    try {
      const existing = this._getKnownRoomPeers(this.roomCode);
      const merged = new Set();
      for (const pid of this.peers.keys()) {
        if (pid && pid !== this.myPeerId) merged.add(pid);
      }
      for (const pid of existing) {
        if (pid && pid !== this.myPeerId && merged.size < 12) {
          merged.add(pid);
        }
      }
      localStorage.setItem(
        `sspro_known_peers_${clean}`,
        JSON.stringify({ ts: Date.now(), peers: Array.from(merged) })
      );
    } catch (_) {}
  }

  _getKnownRoomPeers(roomCode) {
    const clean = this.normalizeRoomCode(roomCode).toLowerCase();
    try {
      const raw = localStorage.getItem(`sspro_known_peers_${clean}`);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.peers)) return [];
      if (Date.now() - (parsed.ts || 0) > 2 * 60 * 60 * 1000) return [];
      return parsed.peers.filter((p) => typeof p === 'string' && p.length > 0);
    } catch (_) {
      return [];
    }
  }

  /**
   * Entra ou cria automaticamente uma sala pelo Código da Sala.
   * Usa sistema multi-slot determinístico + descoberta em malha (Mesh) para que
   * qualquer membro possa sair/fechar o app e reentrar na sala encontrando todos imediatamente.
   */
  async joinRoom(rawRoomCode, nickname) {
    const code = this.normalizeRoomCode(rawRoomCode);
    if (!code) {
      throw new Error('Digite um código de sala válido.');
    }

    const hadActivePeer = Boolean(this.peer || this.roomCode);
    this.leaveRoom();
    if (hadActivePeer) {
      await new Promise((r) => setTimeout(r, 90));
    }

    this.roomCode = code;
    this.myNickname = (nickname || 'Jogador').trim().slice(0, 24) || 'Jogador';
    this.sessionId = `sess-${Math.random().toString(36).substring(2, 10)}-${Date.now().toString(36)}`;

    const coordinatorId = this.getCoordinatorId(code);
    const candidateSlots = this._getOrderedCandidateSlots(code);

    return new Promise((resolve, reject) => {
      let settled = false;

      const attachNonFatalErrorHandling = (err) => {
        if (err?.type === 'peer-unavailable') {
          const match = /peer\s+(\S+)/i.exec(err.message || '');
          const targetId = match ? match[1].trim() : null;
          if (targetId && this.pendingConns.has(targetId)) {
            const pending = this.pendingConns.get(targetId);
            this.pendingConns.delete(targetId);
            pending._ssproReplaced = true;
            try {
              pending.close();
            } catch (_) {}
          }
          return;
        }
        this.callbacks.onError?.(err);
      };

      const finalizeOpen = (peerObj, id) => {
        if (settled) return;
        settled = true;
        this.peer = peerObj;
        this.myPeerId = id;
        this.isRoomCoordinator = id === coordinatorId;
        this._saveMySlotIndex(code, id);
        this._setupPeerListeners(peerObj);
        this._startTelemetryLoop();
        this._scheduleRoomDiscovery();

        this.callbacks.onRoomJoined?.({
          roomCode: this.roomCode,
          myPeerId: this.myPeerId,
          isHost: this.isRoomCoordinator
        });
        resolve({
          roomCode: this.roomCode,
          myPeerId: this.myPeerId,
          isHost: this.isRoomCoordinator
        });
      };

      const trySlot = (slotIdx) => {
        const candidateId =
          slotIdx < candidateSlots.length ? candidateSlots[slotIdx] : this.generateMemberId(code);

        const peerCandidate = new window.Peer(candidateId, {
          config: {
            iceServers: ICE_SERVERS,
            sdpSemantics: 'unified-plan'
          },
          debug: 1
        });

        peerCandidate.on('open', (id) => {
          finalizeOpen(peerCandidate, id);
        });

        peerCandidate.on('error', (err) => {
          if (!settled && err.type === 'unavailable-id' && slotIdx < candidateSlots.length) {
            try {
              peerCandidate.destroy();
            } catch (_) {}
            trySlot(slotIdx + 1);
            return;
          }
          if (!settled) {
            settled = true;
            reject(err);
          } else {
            attachNonFatalErrorHandling(err);
          }
        });
      };

      trySlot(0);
    });
  }

  _scheduleRoomDiscovery() {
    if (this.discoveryTimeouts) {
      for (const t of this.discoveryTimeouts) clearTimeout(t);
    }
    this.discoveryTimeouts = [];

    this._discoverRoomPeers();

    for (const delayMs of [1000, 2600, 5200]) {
      const timer = setTimeout(() => {
        if (this.peer && !this.peer.destroyed && this.roomCode) {
          this._discoverRoomPeers();
        }
      }, delayMs);
      this.discoveryTimeouts.push(timer);
    }
  }

  _discoverRoomPeers() {
    if (!this.peer || this.peer.destroyed || !this.roomCode) return;

    const targets = new Set([
      ...this.getRoomSlotIds(this.roomCode),
      ...this._getKnownRoomPeers(this.roomCode)
    ]);

    for (const targetPeerId of targets) {
      if (!targetPeerId || targetPeerId === this.myPeerId) continue;
      this._connectToPeer(targetPeerId);
    }
  }

  _setupPeerListeners(peerInstance) {
    peerInstance.on('connection', (dataConn) => {
      if (dataConn) {
        dataConn._ssproCreatedAt = Date.now();
        this._registerDataConnection(dataConn);
      }
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

  _connectToPeer(remotePeerId) {
    if (!this.peer || this.peer.destroyed || !remotePeerId || remotePeerId === this.myPeerId) return;
    const existing = this.peers.get(remotePeerId);
    if (existing?.conn && existing.conn.open) return;

    const pending = this.pendingConns.get(remotePeerId);
    if (pending) {
      if (pending.open || Date.now() - (pending._ssproCreatedAt || 0) < 3200) {
        return;
      }
      this.pendingConns.delete(remotePeerId);
      pending._ssproReplaced = true;
      try {
        pending.close();
      } catch (_) {}
    }

    let conn = null;
    try {
      conn = this.peer.connect(remotePeerId, {
        reliable: true,
        metadata: {
          nickname: this.myNickname,
          roomCode: this.roomCode,
          clientId: this.clientId,
          sessionId: this.sessionId
        }
      });
    } catch (_) {
      return;
    }

    if (!conn) return;
    conn._ssproCreatedAt = Date.now();
    this._registerDataConnection(conn);
  }

  _purgeDuplicatePeers(activePeerId, clientId, nickname) {
    const now = Date.now();
    for (const [pid, info] of Array.from(this.peers.entries())) {
      if (activePeerId && pid === activePeerId) continue;
      const sameClient = clientId && info.clientId && info.clientId === clientId;
      const sameNickStale =
        nickname &&
        info.nickname &&
        info.nickname.toLowerCase() === nickname.toLowerCase() &&
        (!info.conn?.open || now - (info.lastSeen || 0) > 2200);

      if (sameClient || sameNickStale) {
        this._handlePeerDisconnected(pid);
      }
    }
  }

  _attachDataConnectionWatcher(conn, remotePeerId) {
    const pc = conn?.peerConnection;
    if (!pc || pc._ssproWatched) return;
    pc._ssproWatched = true;
    const checkState = () => {
      if (conn._ssproReplaced) return;
      const ice = pc.iceConnectionState;
      const state = pc.connectionState;
      if (ice === 'failed' || ice === 'closed' || state === 'failed' || state === 'closed') {
        const peerEntry = this.peers.get(remotePeerId);
        if (!peerEntry) return;
        peerEntry.allConns?.delete(conn);
        if (peerEntry.allConns && peerEntry.allConns.size > 0) {
          for (const otherConn of peerEntry.allConns) {
            if (otherConn.open) {
              peerEntry.conn = otherConn;
              return;
            }
          }
        }
        this._handlePeerDisconnected(remotePeerId);
      }
    };
    pc.addEventListener('iceconnectionstatechange', checkState);
    pc.addEventListener('connectionstatechange', checkState);
  }

  _hasActiveOutgoingCall(remotePeerId) {
    const call = this.outgoingCalls.get(remotePeerId);
    if (!call) return false;
    const state = call.peerConnection?.connectionState;
    const ice = call.peerConnection?.iceConnectionState;
    if (state === 'closed' || state === 'failed' || ice === 'closed' || ice === 'failed') {
      return false;
    }
    return true;
  }

  _registerDataConnection(conn) {
    const remotePeerId = conn?.peer;
    if (!remotePeerId || remotePeerId === this.myPeerId) return;

    if (!this.pendingConns.has(remotePeerId)) {
      this.pendingConns.set(remotePeerId, conn);
    }

    const pendingTimeout = setTimeout(() => {
      if (!conn.open) {
        if (this.pendingConns.get(remotePeerId) === conn) {
          this.pendingConns.delete(remotePeerId);
        }
        conn._ssproReplaced = true;
        try {
          conn.close();
        } catch (_) {}
      }
    }, 4500);

    conn.on('open', () => {
      clearTimeout(pendingTimeout);
      if (this.pendingConns.get(remotePeerId) === conn) {
        this.pendingConns.delete(remotePeerId);
      }

      const incomingClientId = conn.metadata?.clientId || null;
      const incomingSessionId = conn.metadata?.sessionId || null;
      const incomingNick = conn.metadata?.nickname || 'Amigo';

      this._purgeDuplicatePeers(remotePeerId, incomingClientId, incomingNick);

      let peerEntry = this.peers.get(remotePeerId);
      if (!peerEntry) {
        peerEntry = {
          peerId: remotePeerId,
          clientId: incomingClientId,
          sessionId: incomingSessionId,
          nickname: incomingNick,
          conn,
          allConns: new Set([conn]),
          sharing: false,
          streamMeta: null,
          remoteStream: null,
          viewerVisibility: true,
          viewerTier: 'high',
          lastSeen: Date.now()
        };
        this.peers.set(remotePeerId, peerEntry);
      } else {
        if (incomingSessionId && peerEntry.sessionId && incomingSessionId !== peerEntry.sessionId) {
          if (peerEntry.allConns) {
            for (const oldC of peerEntry.allConns) {
              if (oldC !== conn) {
                oldC._ssproReplaced = true;
                try {
                  oldC.close();
                } catch (_) {}
              }
            }
            peerEntry.allConns.clear();
          }
          const oldOut = this.outgoingCalls.get(remotePeerId);
          if (oldOut) {
            try {
              oldOut.close();
            } catch (_) {}
            this.outgoingCalls.delete(remotePeerId);
          }
        }
        if (!peerEntry.allConns) {
          peerEntry.allConns = new Set();
        }
        peerEntry.allConns.add(conn);
        peerEntry.conn = conn;
        peerEntry.lastSeen = Date.now();
        if (incomingClientId) peerEntry.clientId = incomingClientId;
        if (incomingSessionId) peerEntry.sessionId = incomingSessionId;
        if (conn.metadata?.nickname) {
          peerEntry.nickname = conn.metadata.nickname;
        }
      }

      this._saveKnownRoomPeers();
      this._attachDataConnectionWatcher(conn, remotePeerId);

      // Envia apresentação + estado atual da minha transmissão
      this._sendToPeer(remotePeerId, {
        type: 'hello',
        peerId: this.myPeerId,
        clientId: this.clientId,
        sessionId: this.sessionId,
        nickname: this.myNickname,
        sharing: this.isSharing,
        streamMeta: this.isSharing ? this._buildMyStreamMeta() : null
      });

      // Qualquer participante da sala envia a lista de membros conhecidos para fechar a malha P2P
      const peerList = [];
      for (const [pid, info] of this.peers.entries()) {
        if (pid !== remotePeerId && info.conn?.open) {
          peerList.push({
            peerId: pid,
            nickname: info.nickname
          });
        }
      }
      if (peerList.length > 0) {
        this._sendToPeer(remotePeerId, {
          type: 'room-roster',
          peers: peerList
        });
      }

      // Se eu já estou compartilhando tela, inicio envio da stream para este amigo
      if (this.isSharing && this.localStream && !this._hasActiveOutgoingCall(remotePeerId)) {
        this._callPeerWithScreen(remotePeerId);
      }

      this._notifyPeersUpdated();
    });

    conn.on('data', (msg) => {
      this._handleDataMessage(remotePeerId, msg);
    });

    const handleConnClosed = () => {
      clearTimeout(pendingTimeout);
      if (this.pendingConns.get(remotePeerId) === conn) {
        this.pendingConns.delete(remotePeerId);
      }
      if (conn._ssproReplaced) return;

      const peerEntry = this.peers.get(remotePeerId);
      if (!peerEntry) return;

      peerEntry.allConns?.delete(conn);
      if (peerEntry.allConns && peerEntry.allConns.size > 0) {
        for (const otherConn of peerEntry.allConns) {
          if (otherConn.open) {
            peerEntry.conn = otherConn;
            return;
          }
        }
      }

      this._handlePeerDisconnected(remotePeerId);
    };

    conn.on('close', handleConnClosed);
    conn.on('error', handleConnClosed);
  }

  _handleDataMessage(remotePeerId, msg) {
    if (!msg || typeof msg !== 'object') return;
    const peerEntry = this.peers.get(remotePeerId);
    if (!peerEntry) return;
    peerEntry.lastSeen = Date.now();

    switch (msg.type) {
      case 'hello': {
        peerEntry.nickname = msg.nickname || peerEntry.nickname;
        if (msg.clientId) peerEntry.clientId = msg.clientId;
        if (msg.sessionId) peerEntry.sessionId = msg.sessionId;
        peerEntry.sharing = Boolean(msg.sharing);
        peerEntry.streamMeta = msg.streamMeta || null;
        this._purgeDuplicatePeers(remotePeerId, peerEntry.clientId, peerEntry.nickname);
        this._saveKnownRoomPeers();
        if (this.isSharing && this.localStream && !this._hasActiveOutgoingCall(remotePeerId)) {
          this._callPeerWithScreen(remotePeerId);
        }
        if (peerEntry.sharing && !peerEntry.remoteStream) {
          setTimeout(() => {
            const current = this.peers.get(remotePeerId);
            if (current && current.sharing && !current.remoteStream) {
              this._sendToPeer(remotePeerId, { type: 'request-stream' });
            }
          }, 1200);
        }
        this._notifyPeersUpdated();
        break;
      }

      case 'request-stream': {
        if (this.isSharing && this.localStream) {
          this._callPeerWithScreen(remotePeerId);
        }
        break;
      }

      case 'ping': {
        this._sendToPeer(remotePeerId, {
          type: 'pong',
          ts: msg.ts
        });
        break;
      }

      case 'pong': {
        break;
      }

      case 'peer-leaving': {
        this._handlePeerDisconnected(remotePeerId);
        if (msg.clientId) {
          this._purgeDuplicatePeers(null, msg.clientId, null);
        }
        break;
      }

      case 'room-roster': {
        if (Array.isArray(msg.peers)) {
          for (const item of msg.peers) {
            if (item.peerId && item.peerId !== this.myPeerId && !this.peers.has(item.peerId)) {
              this._connectToPeer(item.peerId);
            }
          }
          this._saveKnownRoomPeers();
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
            inc._ssproReplaced = true;
            try { inc.close(); } catch (_) {}
            this.incomingCalls.delete(remotePeerId);
          }
          this.callbacks.onRemoteStreamRemoved?.(remotePeerId);
        } else if (!peerEntry.remoteStream) {
          setTimeout(() => {
            const current = this.peers.get(remotePeerId);
            if (current && current.sharing && !current.remoteStream) {
              this._sendToPeer(remotePeerId, { type: 'request-stream' });
            }
          }, 1200);
        }
        this._notifyPeersUpdated();
        break;
      }

      case 'viewer-visibility': {
        peerEntry.viewerVisibility = Boolean(msg.visible);
        peerEntry.viewerTier = msg.tier || 'high';
        if (peerEntry.viewerVisibility && this.isSharing && this.localStream && !this._hasActiveOutgoingCall(remotePeerId)) {
          this._callPeerWithScreen(remotePeerId);
        } else {
          this._applyEncodingForPeer(remotePeerId);
        }
        this._notifyPeersUpdated();
        break;
      }

      case 'control-request': {
        if (this.isSharing) {
          this.callbacks.onControlRequest?.({
            peerId: remotePeerId,
            nickname: peerEntry.nickname
          });
        } else {
          this._sendToPeer(remotePeerId, {
            type: 'control-response',
            granted: false
          });
        }
        break;
      }

      case 'control-response': {
        this.callbacks.onControlResponse?.({
          peerId: remotePeerId,
          nickname: peerEntry.nickname,
          granted: Boolean(msg.granted)
        });
        break;
      }

      case 'control-revoke': {
        this.callbacks.onControlRevoked?.({
          peerId: remotePeerId,
          nickname: peerEntry.nickname
        });
        break;
      }

      case 'control-stop': {
        if (this.allowedControllerPeerId === remotePeerId) {
          this.allowedControllerPeerId = null;
          this.callbacks.onControllerStopped?.({ peerId: remotePeerId });
        }
        break;
      }

      case 'remote-input': {
        if (this.isSharing && this.allowedControllerPeerId === remotePeerId && msg.evt) {
          window.electronAPI?.executeRemoteInput(msg.evt);
        }
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
      existingCall._ssproReplaced = true;
      try { existingCall.close(); } catch (_) {}
    }

    this.incomingCalls.set(remotePeerId, mediaConn);
    // Responde sem enviar mídia de volta (cada transmissão é unidirecional por chamada para máxima performance)
    mediaConn.answer();

    mediaConn.on('stream', (remoteStream) => {
      const incClientId = mediaConn.metadata?.clientId || null;
      const incNick = mediaConn.metadata?.nickname || 'Amigo';
      this._purgeDuplicatePeers(remotePeerId, incClientId, incNick);

      let peerEntry = this.peers.get(remotePeerId);
      if (!peerEntry) {
        peerEntry = {
          peerId: remotePeerId,
          clientId: incClientId,
          sessionId: mediaConn.metadata?.sessionId || null,
          nickname: incNick,
          conn: null,
          allConns: new Set(),
          sharing: true,
          streamMeta: mediaConn.metadata?.streamMeta || null,
          remoteStream,
          viewerVisibility: true,
          viewerTier: 'high',
          lastSeen: Date.now()
        };
        this.peers.set(remotePeerId, peerEntry);
        this._connectToPeer(remotePeerId);
      } else {
        peerEntry.sharing = true;
        peerEntry.remoteStream = remoteStream;
        peerEntry.lastSeen = Date.now();
        if (incClientId) peerEntry.clientId = incClientId;
        if (mediaConn.metadata?.streamMeta) {
          peerEntry.streamMeta = mediaConn.metadata.streamMeta;
        }
        if (!peerEntry.conn || !peerEntry.conn.open) {
          this._connectToPeer(remotePeerId);
        }
      }

      this._saveKnownRoomPeers();
      this.callbacks.onRemoteStreamAdded?.({
        peerId: remotePeerId,
        nickname: peerEntry.nickname,
        stream: remoteStream,
        streamMeta: peerEntry.streamMeta
      });
      this._notifyPeersUpdated();
    });

    mediaConn.on('close', () => {
      if (mediaConn._ssproReplaced || this.incomingCalls.get(remotePeerId) !== mediaConn) return;
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
    if (this.allowedControllerPeerId === remotePeerId) {
      this.allowedControllerPeerId = null;
      this.callbacks.onControllerStopped?.({ peerId: remotePeerId });
    }

    const pending = this.pendingConns.get(remotePeerId);
    if (pending) {
      pending._ssproReplaced = true;
      try { pending.close(); } catch (_) {}
      this.pendingConns.delete(remotePeerId);
    }

    const outCall = this.outgoingCalls.get(remotePeerId);
    if (outCall) {
      try { outCall.close(); } catch (_) {}
      this.outgoingCalls.delete(remotePeerId);
    }

    const incCall = this.incomingCalls.get(remotePeerId);
    if (incCall) {
      incCall._ssproReplaced = true;
      try { incCall.close(); } catch (_) {}
      this.incomingCalls.delete(remotePeerId);
    }

    const peerEntry = this.peers.get(remotePeerId);
    if (peerEntry?.allConns) {
      for (const c of peerEntry.allConns) {
        c._ssproReplaced = true;
        try { c.close(); } catch (_) {}
      }
      peerEntry.allConns.clear();
    } else if (peerEntry?.conn) {
      peerEntry.conn._ssproReplaced = true;
      try { peerEntry.conn.close(); } catch (_) {}
    }

    this.peers.delete(remotePeerId);
    this.previousStats.delete(remotePeerId);
    this.callbacks.onRemoteStreamRemoved?.(remotePeerId);
    this._notifyPeersUpdated();
  }

  _sendToPeer(remotePeerId, payload) {
    const peerEntry = this.peers.get(remotePeerId);
    if (!peerEntry) return;

    if (peerEntry.conn && peerEntry.conn.open) {
      try {
        peerEntry.conn.send(payload);
        return;
      } catch (err) {
        console.warn('Falha ao enviar mensagem para peer:', remotePeerId, err);
      }
    }

    if (peerEntry.allConns) {
      for (const c of peerEntry.allConns) {
        if (c.open) {
          peerEntry.conn = c;
          try {
            c.send(payload);
            return;
          } catch (_) {}
        }
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

  requestRemoteControl(remotePeerId) {
    this._sendToPeer(remotePeerId, {
      type: 'control-request'
    });
  }

  respondRemoteControl(remotePeerId, granted) {
    if (granted) {
      if (this.allowedControllerPeerId && this.allowedControllerPeerId !== remotePeerId) {
        this._sendToPeer(this.allowedControllerPeerId, {
          type: 'control-revoke'
        });
      }
      this.allowedControllerPeerId = remotePeerId;
    } else if (this.allowedControllerPeerId === remotePeerId) {
      this.allowedControllerPeerId = null;
    }

    this._sendToPeer(remotePeerId, {
      type: 'control-response',
      granted: Boolean(granted)
    });
  }

  revokeRemoteControl() {
    if (this.allowedControllerPeerId) {
      const prev = this.allowedControllerPeerId;
      this.allowedControllerPeerId = null;
      this._sendToPeer(prev, {
        type: 'control-revoke'
      });
    }
    this.callbacks.onControllerStopped?.();
  }

  stopControllingPeer(remotePeerId) {
    this._sendToPeer(remotePeerId, {
      type: 'control-stop'
    });
  }

  sendRemoteInput(remotePeerId, evt) {
    this._sendToPeer(remotePeerId, {
      type: 'remote-input',
      evt
    });
  }

  _extractWindowHwnd(sourceId) {
    if (!sourceId || typeof sourceId !== 'string') return 0;
    const match = /^window:(\d+):/i.exec(sourceId.trim());
    return match ? Number(match[1]) || 0 : 0;
  }

  _resolveAudioWorkerTarget() {
    const videoWindowHwnd = this._extractWindowHwnd(this.qualityConfig.sourceId);
    if (videoWindowHwnd > 0) {
      return { mode: 'window', hwnd: videoWindowHwnd };
    }

    const customAudioHwnd = this._extractWindowHwnd(this.qualityConfig.audioTargetSourceId);
    if (customAudioHwnd > 0) {
      return { mode: 'window', hwnd: customAudioHwnd };
    }

    return { mode: 'active', hwnd: 0 };
  }

  async _setupIsolatedAudioTrack(workerTarget) {
    if (!window.electronAPI?.startProcessAudio) return null;

    try {
      const res = await window.electronAPI.startProcessAudio(workerTarget);
      if (!res?.ok) return null;
      if (res.status) {
        this.activeAudioStatus = res.status;
      }

      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!this.audioCtx || this.audioCtx.state === 'closed') {
        this.audioCtx = new AudioCtx({
          sampleRate: 48000,
          latencyHint: 'interactive'
        });
        this.workletLoaded = false;
        this.audioWorkletNode = null;
      }

      if (this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume();
      }

      if (!this.workletLoaded) {
        await this.audioCtx.audioWorklet.addModule('audio-capture-worklet.js');
        this.workletLoaded = true;
      }

      if (!this.audioWorkletNode) {
        this.audioWorkletNode = new AudioWorkletNode(this.audioCtx, 'process-audio-worklet', {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [2]
        });
      } else {
        this.audioWorkletNode.port.postMessage({ type: 'reset' });
        try {
          this.audioWorkletNode.disconnect();
        } catch (_) {}
      }

      this.audioDestination = this.audioCtx.createMediaStreamDestination();
      this.audioWorkletNode.connect(this.audioDestination);

      if (!this.removeAudioPcmListener) {
        this.removeAudioPcmListener = window.electronAPI.onProcessAudioChunk((pcmChunk) => {
          if (this.audioWorkletNode) {
            this.audioWorkletNode.port.postMessage(pcmChunk);
          }
        });
      }

      if (!this.removeAudioStatusListener && window.electronAPI.onProcessAudioStatus) {
        this.removeAudioStatusListener = window.electronAPI.onProcessAudioStatus((status) => {
          this.activeAudioStatus = status;
          this.callbacks.onAudioTargetChanged?.(status);
        });
      }

      const track = this.audioDestination.stream.getAudioTracks()[0] || null;
      if (track) {
        try {
          track.contentHint = 'music';
        } catch (_) {}
      }
      return track;
    } catch (err) {
      console.warn('Falha ao inicializar áudio isolado por processo:', err);
      return null;
    }
  }

  _stopIsolatedAudioCapture() {
    if (this.removeAudioPcmListener) {
      try {
        this.removeAudioPcmListener();
      } catch (_) {}
      this.removeAudioPcmListener = null;
    }
    if (this.removeAudioStatusListener) {
      try {
        this.removeAudioStatusListener();
      } catch (_) {}
      this.removeAudioStatusListener = null;
    }
    if (this.audioWorkletNode) {
      try {
        this.audioWorkletNode.port.postMessage({ type: 'reset' });
        this.audioWorkletNode.disconnect();
      } catch (_) {}
    }
    if (this.audioDestination) {
      try {
        this.audioDestination.stream.getTracks().forEach((t) => t.stop());
      } catch (_) {}
      this.audioDestination = null;
    }
    this.activeAudioStatus = null;
    window.electronAPI?.stopProcessAudio?.();
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
      hasAudio,
      audioWindowTitle: this.activeAudioStatus?.title || null
    };
  }

  /**
   * Inicia ou troca a captura de tela/jogo (vídeo de alta performance + áudio isolado apenas da janela selecionada ou janela ativa, sem Discord).
   */
  async startScreenShare(customConfig = {}) {
    this.qualityConfig = {
      ...this.qualityConfig,
      ...customConfig
    };

    const { sourceId, includeSystemAudio, width, height, fps, contentHint } = this.qualityConfig;

    let isolatedAudioTrack = null;
    if (includeSystemAudio) {
      const workerTarget = this._resolveAudioWorkerTarget();
      isolatedAudioTrack = await this._setupIsolatedAudioTrack(workerTarget);
    } else {
      this._stopIsolatedAudioCapture();
    }

    const useFallbackSystemLoopback = Boolean(includeSystemAudio && !isolatedAudioTrack);

    // Prepara o handler do processo principal do Electron com a janela/tela escolhida
    if (window.electronAPI?.prepareCapture) {
      await window.electronAPI.prepareCapture({
        sourceId,
        includeSystemAudio,
        useFallbackSystemLoopback
      });
    }

    let newStream = null;

    // 1ª tentativa: getDisplayMedia nativo (captura WGC de alto FPS)
    try {
      newStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: width, max: width },
          height: { ideal: height, max: height },
          frameRate: { ideal: fps, max: fps }
        },
        audio: useFallbackSystemLoopback
      });
    } catch (err) {
      console.warn('getDisplayMedia falhou, tentando novamente sem áudio de sistema:', err);
      // Em alguns sistemas (ex.: Linux) o pedido de áudio de sistema não é suportado
      if (useFallbackSystemLoopback) {
        try {
          newStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
              width: { ideal: width, max: width },
              height: { ideal: height, max: height },
              frameRate: { ideal: fps, max: fps }
            },
            audio: false
          });
        } catch (retryErr) {
          console.warn('getDisplayMedia sem áudio também falhou, usando fallback desktopCapturer getUserMedia:', retryErr);
        }
      }
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

      const audioConstraints = useFallbackSystemLoopback
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
        newStream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints,
          audio: false
        });
      }
    }

    if (!newStream) {
      if (isolatedAudioTrack) {
        this._stopIsolatedAudioCapture();
      }
      throw new Error('Não foi possível capturar a tela ou janela selecionada.');
    }

    // Anexa a track de áudio isolada por janela/processo (sem Discord)
    if (isolatedAudioTrack) {
      newStream.getAudioTracks().forEach((t) => {
        if (t.id !== isolatedAudioTrack.id) {
          t.stop();
          newStream.removeTrack(t);
        }
      });
      if (!newStream.getAudioTracks().some((t) => t.id === isolatedAudioTrack.id)) {
        newStream.addTrack(isolatedAudioTrack);
      }
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
      const activeIds = new Set(newStream.getTracks().map((t) => t.id));
      previousStream.getTracks().forEach((t) => {
        if (!activeIds.has(t.id)) {
          t.stop();
        }
      });
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
    if (this.allowedControllerPeerId) {
      this.revokeRemoteControl();
    }

    this._stopIsolatedAudioCapture();

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
        clientId: this.clientId,
        sessionId: this.sessionId,
        streamMeta: this._buildMyStreamMeta()
      }
    });

    if (!call) return;
    this.outgoingCalls.set(remotePeerId, call);

    const applyParams = () => {
      this._applyCodecPreference(call.peerConnection, this.qualityConfig.codec || 'VP9');
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

  _applyCodecPreference(pc, preferredCodec = 'VP9') {
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
    // IMPORTANTE: isVisibleOnViewer inicia como TRUE para que streams novas nunca fiquem
    // travadas em 0.0 Mbps / tela preta por dessincronização de eventos
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
          // Mantém ativo a menos que o peer explicitamente minimize
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
    this.telemetryTickCount = 0;

    this.statsInterval = setInterval(async () => {
      const now = Date.now();
      this.telemetryTickCount = (this.telemetryTickCount || 0) + 1;

      if (this.roomCode && this.myPeerId && this.telemetryTickCount % 5 === 0) {
        this._saveMySlotIndex(this.roomCode, this.myPeerId);
        this._saveKnownRoomPeers();
      }

      if (this.peers.size === 0 && this.telemetryTickCount % 3 === 0) {
        this._discoverRoomPeers();
      }

      // Envia heartbeat (ping) e remove imediatamente membros fantasmas que fecharam o app
      for (const [remotePeerId, peerEntry] of Array.from(this.peers.entries())) {
        let activeConn = peerEntry.conn;
        if ((!activeConn || !activeConn.open) && peerEntry.allConns) {
          for (const c of peerEntry.allConns) {
            if (c.open) {
              activeConn = c;
              peerEntry.conn = c;
              break;
            }
          }
        }

        const pc = activeConn?.peerConnection;
        const pcDead =
          pc &&
          (pc.iceConnectionState === 'failed' ||
            pc.iceConnectionState === 'closed' ||
            pc.connectionState === 'failed' ||
            pc.connectionState === 'closed');

        if (pcDead || now - (peerEntry.lastSeen || now) > 5500) {
          this._handlePeerDisconnected(remotePeerId);
          continue;
        }

        if (activeConn?.open) {
          this._sendToPeer(remotePeerId, { type: 'ping', ts: now });
        }
      }

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
    if (this.discoveryTimeouts) {
      for (const t of this.discoveryTimeouts) clearTimeout(t);
      this.discoveryTimeouts = [];
    }

    if (this.roomCode && this.myPeerId) {
      this._saveMySlotIndex(this.roomCode, this.myPeerId);
    }
    this._saveKnownRoomPeers();

    const leavingPeerId = this.myPeerId;
    const leavingClientId = this.clientId;
    const peerToDestroy = this.peer;
    const openConns = [];

    for (const [, peerEntry] of this.peers.entries()) {
      if (peerEntry.allConns && peerEntry.allConns.size > 0) {
        for (const c of peerEntry.allConns) {
          if (c.open) openConns.push(c);
        }
      } else if (peerEntry.conn?.open) {
        openConns.push(peerEntry.conn);
      }
    }

    // Avisa todos os peers conectados antes de fechar para remoção instantânea sem membro fantasma
    for (const conn of openConns) {
      try {
        conn.send({
          type: 'peer-leaving',
          peerId: leavingPeerId,
          clientId: leavingClientId
        });
      } catch (_) {}
    }

    this.stopScreenShare();

    for (const [, call] of this.incomingCalls.entries()) {
      call._ssproReplaced = true;
      try { call.close(); } catch (_) {}
    }
    this.incomingCalls.clear();

    for (const [, pending] of this.pendingConns.entries()) {
      pending._ssproReplaced = true;
      try { pending.close(); } catch (_) {}
    }
    this.pendingConns.clear();

    this.peers.clear();
    this.previousStats.clear();
    this.peer = null;
    this.myPeerId = null;
    this.roomCode = null;
    this.isRoomCoordinator = false;

    if (openConns.length > 0 || peerToDestroy) {
      setTimeout(() => {
        for (const c of openConns) {
          c._ssproReplaced = true;
          try { c.close(); } catch (_) {}
        }
        if (peerToDestroy && !peerToDestroy.destroyed) {
          try { peerToDestroy.destroy(); } catch (_) {}
        }
      }, 60);
    }

    this.callbacks.onRoomLeft?.();
  }
}
