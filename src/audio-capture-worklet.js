class ProcessAudioCaptureWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.capacity = 48000; // 1 segundo em 48kHz
    this.leftRing = new Float32Array(this.capacity);
    this.rightRing = new Float32Array(this.capacity);
    this.writeIndex = 0;
    this.readIndex = 0;
    this.available = 0;
    this.isBuffering = true;

    this.prebufferFrames = 960; // 20ms de pré-buffer para absorver jitter de IPC
    this.maxBufferFrames = 4320; // 90ms teto máximo (corta atraso acumulado)
    this.targetResetFrames = 1440; // 30ms alvo após corte de atraso

    this.port.onmessage = (event) => {
      const data = event.data;
      if (!data) return;

      if (data.type === 'reset') {
        this.writeIndex = 0;
        this.readIndex = 0;
        this.available = 0;
        this.isBuffering = true;
        return;
      }

      let int16 = null;
      if (data instanceof Int16Array) {
        int16 = data;
      } else if (data instanceof Uint8Array) {
        const alignedLen = data.byteLength & ~3;
        if (alignedLen <= 0) return;
        int16 = new Int16Array(data.buffer, data.byteOffset, alignedLen >> 1);
      } else if (data instanceof ArrayBuffer) {
        const alignedLen = data.byteLength & ~3;
        if (alignedLen <= 0) return;
        int16 = new Int16Array(data, 0, alignedLen >> 1);
      } else if (ArrayBuffer.isView(data)) {
        const alignedLen = data.byteLength & ~3;
        if (alignedLen <= 0) return;
        int16 = new Int16Array(data.buffer, data.byteOffset, alignedLen >> 1);
      }

      if (!int16 || int16.length < 2) return;

      const frames = int16.length >> 1;
      const scale = 1.0 / 32768.0;
      const cap = this.capacity;
      let wIdx = this.writeIndex;

      for (let i = 0; i < frames; i++) {
        const sampleIndex = i << 1;
        this.leftRing[wIdx] = int16[sampleIndex] * scale;
        this.rightRing[wIdx] = int16[sampleIndex + 1] * scale;
        wIdx++;
        if (wIdx >= cap) wIdx = 0;
      }

      this.writeIndex = wIdx;
      this.available += frames;

      if (this.available > this.maxBufferFrames) {
        this.available = this.targetResetFrames;
        this.readIndex = (this.writeIndex - this.targetResetFrames + cap) % cap;
      }
    };
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;

    const outL = output[0];
    const outR = output.length > 1 ? output[1] : null;
    const frameCount = outL.length;

    if (this.isBuffering) {
      if (this.available >= this.prebufferFrames) {
        this.isBuffering = false;
      } else {
        outL.fill(0);
        if (outR) outR.fill(0);
        return true;
      }
    }

    const cap = this.capacity;
    let rIdx = this.readIndex;

    if (this.available >= frameCount) {
      for (let i = 0; i < frameCount; i++) {
        outL[i] = this.leftRing[rIdx];
        if (outR) outR[i] = this.rightRing[rIdx];
        rIdx++;
        if (rIdx >= cap) rIdx = 0;
      }
      this.readIndex = rIdx;
      this.available -= frameCount;
    } else {
      const avail = this.available;
      for (let i = 0; i < avail; i++) {
        outL[i] = this.leftRing[rIdx];
        if (outR) outR[i] = this.rightRing[rIdx];
        rIdx++;
        if (rIdx >= cap) rIdx = 0;
      }
      for (let i = avail; i < frameCount; i++) {
        outL[i] = 0;
        if (outR) outR[i] = 0;
      }
      this.readIndex = rIdx;
      this.available = 0;
      this.isBuffering = true;
    }

    return true;
  }
}

registerProcessor('process-audio-worklet', ProcessAudioCaptureWorklet);
