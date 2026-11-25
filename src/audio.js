// 音频驱动：以声卡时钟驱动模拟器（经典做法，天然锁定 60fps）
// AudioContext 未解锁时退化为定时器驱动

export class AudioDriver {
  constructor(gb) {
    this.gb = gb;
    this.ctx = null;
    this.node = null;
    this.master = null;
    this.timerId = null;
    this.running = false;
    this.usingTimer = false;
    this.paused = false;
    this.tmp = new Float32Array(8192);
    this.volume = 0.8;
  }

  // 尝试初始化（需要在用户手势中调用）
  async start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return true;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.gb.apu.setSampleRate(this.ctx.sampleRate);
      this.gb.apu.bufL.fill(0); this.gb.apu.bufR.fill(0);
      this.gb.apu.wIdx = this.gb.apu.rIdx = 0;

      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);

      this.node = this.ctx.createScriptProcessor(1024, 0, 2);
      this.node.onaudioprocess = (e) => this.fill(e);
      this.node.connect(this.master);

      // 注意：无用户手势时 resume() 返回的 promise 可能永远 pending，
      // 绝不能 await 它，否则下面的定时器降级永远执行不到
      this.running = true;
      if (this.ctx.state === 'running') {
        this.usingTimer = false;
        this.stopTimer();
      } else {
        this.usingTimer = true;
        this.startTimer();
        this.ctx.resume().then(() => {
          // 手势到来、上下文恢复后，切回声卡时钟
          if (this.ctx && this.ctx.state === 'running') {
            this.usingTimer = false;
            this.stopTimer();
          }
        }).catch(() => { /* 保持定时器驱动 */ });
      }
      return true;
    } catch (err) {
      console.warn('音频初始化失败，回退到定时器驱动', err);
      this.running = true;
      this.usingTimer = true;
      this.startTimer();
      return false;
    }
  }

  // 用户手势后恢复：成功切回声卡时钟就停掉定时器，避免双重驱动
  resume() {
    if (!this.ctx) return this.start();
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().then(() => {
        if (this.ctx && this.ctx.state === 'running') {
          this.running = true;
          this.usingTimer = false;
          this.stopTimer();
        }
      }).catch(() => { /* 保持定时器驱动 */ });
    }
    return Promise.resolve(this.ctx.state === 'running');
  }

  fill(e) {
    const outL = e.outputBuffer.getChannelData(0);
    const outR = e.outputBuffer.getChannelData(1);
    const n = outL.length;
    if (!this.running || this.paused || !this.gb.cartridge || this.usingTimer) {
      outL.fill(0); outR.fill(0);
      return;
    }
    // 按需推进模拟器，凑足采样
    let guard = 0;
    while (this.gb.apu.available() < n && guard++ < 60) {
      this.gb.runForSamples(n);
    }
    const got = this.gb.apu.drain(this.tmp);
    for (let i = 0; i < n; i++) {
      outL[i] = got > i * 2 ? this.tmp[i * 2] : 0;
      outR[i] = got > i * 2 + 1 ? this.tmp[i * 2 + 1] : 0;
    }
  }

  // 无音频上下文时用定时器驱动模拟器
  startTimer() {
    if (this.timerId) return;
    this.usingTimer = true;
    this.timerId = setInterval(() => {
      if (this.paused || !this.gb.cartridge || !this.usingTimer) return;
      this.gb.runForSamples(735);
      // 定时器模式下没人消费音频缓冲，把积压的旧采样丢掉，
      // 否则缓冲写满后 available() 饱和，runForSamples 会失控加速
      const avail = this.gb.apu.available();
      if (avail > 4096) this.gb.apu.discard(avail - 2048);
    }, 16.6);
  }

  stopTimer() {
    if (this.timerId) { clearInterval(this.timerId); this.timerId = null; }
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
    this.gb.apu.volume = v;
  }

  setPaused(p) {
    this.paused = p;
  }

  // 合成"咔哒"插卡音效
  click() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const bufferSize = 2048;
    const buf = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 3);
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 2600;
    filter.Q.value = 1.2;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.5, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    src.connect(filter); filter.connect(gain); gain.connect(this.master || this.ctx.destination);
    src.start(t);
  }

  // 开机"叮"
  ding() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = 1046;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.12, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    osc.connect(gain); gain.connect(this.master || this.ctx.destination);
    osc.start(t); osc.stop(t + 0.45);
  }
}
