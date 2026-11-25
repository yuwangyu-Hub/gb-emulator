// APU：4 声道（2 方波 + 波形 + 噪声）
// 输出立体声采样到内部缓冲，由外部音频线程消费

const DUTY = [
  [0, 0, 0, 0, 0, 0, 0, 1], // 12.5%
  [1, 0, 0, 0, 0, 0, 0, 1], // 25%
  [1, 0, 0, 0, 0, 1, 1, 1], // 50%
  [0, 1, 1, 1, 1, 1, 1, 0], // 75%
];

class SquareChannel {
  constructor(hasSweep) {
    this.hasSweep = hasSweep;
    this.reset();
  }
  reset() {
    this.enabled = false;
    this.dac = false;
    this.duty = 0;
    this.dutyPos = 0;
    this.freqTimer = 0;
    this.freq = 0;
    this.length = 0;
    this.lengthEnabled = false;
    this.envVolume = 0;
    this.envPeriod = 0;
    this.envDir = 0;
    this.envTimer = 0;
    // sweep
    this.sweepPeriod = 0;
    this.sweepDir = 0;
    this.sweepShift = 0;
    this.sweepTimer = 0;
    this.shadowFreq = 0;
  }
  freqCycles() { return (2048 - this.freq) * 4; }
  stepFreq(cycles) {
    this.freqTimer -= cycles;
    while (this.freqTimer <= 0) {
      this.freqTimer += this.freqCycles();
      this.dutyPos = (this.dutyPos + 1) & 7;
    }
  }
  sample() {
    if (!this.enabled || !this.dac) return 0;
    const v = DUTY[this.duty][this.dutyPos] ? this.envVolume : 0;
    return v;
  }
}

class WaveChannel {
  constructor() { this.wave = new Uint8Array(32); this.reset(); }
  reset() {
    this.enabled = false;
    this.dac = false;
    this.volumeShift = 0;
    this.freq = 0;
    this.freqTimer = 0;
    this.pos = 0;
    this.length = 0;
    this.lengthEnabled = false;
    this.wave.fill(0);
  }
  freqCycles() { return (2048 - this.freq) * 2; }
  stepFreq(cycles) {
    this.freqTimer -= cycles;
    while (this.freqTimer <= 0) {
      this.freqTimer += this.freqCycles();
      this.pos = (this.pos + 1) & 31;
    }
  }
  sample() {
    if (!this.enabled || !this.dac) return 0;
    if (this.volumeShift === 0) return 0;
    let v = this.wave[this.pos];
    v >>= (this.volumeShift - 1);
    return v;
  }
}

class NoiseChannel {
  constructor() { this.reset(); }
  reset() {
    this.enabled = false;
    this.dac = false;
    this.lfsr = 0x7fff;
    this.freqTimer = 0;
    this.divisor = 0;
    this.width7 = false;
    this.shift = 0;
    this.length = 0;
    this.lengthEnabled = false;
    this.envVolume = 0;
    this.envPeriod = 0;
    this.envDir = 0;
    this.envTimer = 0;
  }
  freqCycles() {
    const d = this.divisor === 0 ? 0.5 : this.divisor;
    return Math.max(1, Math.floor(d * (1 << this.shift) * 8));
  }
  stepFreq(cycles) {
    this.freqTimer -= cycles;
    while (this.freqTimer <= 0) {
      this.freqTimer += this.freqCycles();
      const bit = (this.lfsr ^ (this.lfsr >> 1)) & 1;
      this.lfsr >>= 1;
      if (bit) this.lfsr |= 0x4000;
      if (this.width7) {
        if (bit) this.lfsr |= 0x40; else this.lfsr &= ~0x40;
      }
    }
  }
  sample() {
    if (!this.enabled || !this.dac) return 0;
    return (this.lfsr & 1) ? 0 : this.envVolume;
  }
}

export class APU {
  constructor(gb) {
    this.gb = gb;
    this.ch1 = new SquareChannel(true);
    this.ch2 = new SquareChannel(false);
    this.ch3 = new WaveChannel();
    this.ch4 = new NoiseChannel();
    this.reset();
  }

  reset() {
    this.enabled = true;
    this.leftVol = 7;
    this.rightVol = 7;
    this.ch1.reset(); this.ch2.reset(); this.ch3.reset(); this.ch4.reset();
    this.seqStep = 0;
    this.seqCounter = 0;
    this.sampleRate = 44100;
    this.sampleAccum = 0;
    // 环形缓冲，避免 GC 抖动
    this.bufSize = 16384;
    this.bufL = new Float32Array(this.bufSize);
    this.bufR = new Float32Array(this.bufSize);
    this.wIdx = 0;
    this.rIdx = 0;
    this.muted = false;
    this.volume = 0.8;
    // NR52 电源开启
    this.powerOn = true;
  }

  setSampleRate(rate) { this.sampleRate = rate || 44100; }

  readReg(addr) {
    const c1 = this.ch1, c2 = this.ch2, c3 = this.ch3, c4 = this.ch4;
    switch (addr) {
      case 0xff10: return 0x80 | (c1.sweepPeriod << 4) | (c1.sweepDir << 3) | c1.sweepShift;
      case 0xff11: return (c1.duty << 6) | 0x3f;
      case 0xff12: return (c1.envVolume << 4) | (c1.envDir << 3) | c1.envPeriod;
      case 0xff14: return 0xbf | (c1.lengthEnabled ? 0x40 : 0);
      case 0xff16: return (c2.duty << 6) | 0x3f;
      case 0xff17: return (c2.envVolume << 4) | (c2.envDir << 3) | c2.envPeriod;
      case 0xff19: return 0xbf | (c2.lengthEnabled ? 0x40 : 0);
      case 0xff1a: return (c3.dac ? 0x80 : 0) | 0x7f;
      case 0xff1c: return (c3.volumeShift << 5) | 0x9f;
      case 0xff1e: return 0xbf | (c3.lengthEnabled ? 0x40 : 0);
      case 0xff20: return 0xff;
      case 0xff21: return (c4.envVolume << 4) | (c4.envDir << 3) | c4.envPeriod;
      case 0xff22: return (c4.shift << 4) | (c4.width7 ? 8 : 0) | c4.divisor;
      case 0xff23: return 0xbf | (c4.lengthEnabled ? 0x40 : 0);
      case 0xff24: return (this.leftVol << 4) | this.rightVol;
      case 0xff25: return this.panning !== undefined ? this.panning : 0xf3;
      case 0xff26: {
        let v = this.powerOn ? 0x80 : 0x00;
        if (c1.enabled) v |= 0x01;
        if (c2.enabled) v |= 0x02;
        if (c3.enabled) v |= 0x04;
        if (c4.enabled) v |= 0x08;
        return v | 0x70;
      }
      default:
        if (addr >= 0xff30 && addr <= 0xff3f) return this.ch3.wave[(addr - 0xff30) * 2] << 4 | this.ch3.wave[(addr - 0xff30) * 2 + 1];
        return 0xff;
    }
  }

  writeReg(addr, v) {
    if (!this.powerOn && addr !== 0xff26 && addr < 0xff30) {
      // 断电时大部分寄存器不可写（简化：允许写但不出声）
    }
    const c1 = this.ch1, c2 = this.ch2, c3 = this.ch3, c4 = this.ch4;
    switch (addr) {
      // ---- CH1 ----
      case 0xff10:
        c1.sweepPeriod = (v >> 4) & 0x07;
        c1.sweepDir = (v >> 3) & 0x01;
        c1.sweepShift = v & 0x07;
        break;
      case 0xff11:
        c1.duty = (v >> 6) & 0x03;
        c1.length = 64 - (v & 0x3f);
        break;
      case 0xff12: {
        c1.envVolume = (v >> 4) & 0x0f;
        c1.envDir = (v >> 3) & 0x01;
        c1.envPeriod = v & 0x07;
        c1.dac = (v & 0xf8) !== 0;
        if (!c1.dac) c1.enabled = false;
        break;
      }
      case 0xff13:
        c1.freq = (c1.freq & 0x700) | v;
        break;
      case 0xff14: {
        c1.freq = (c1.freq & 0xff) | ((v & 0x07) << 8);
        c1.lengthEnabled = (v & 0x40) !== 0;
        if (v & 0x80) this.trigger(c1, 64);
        break;
      }
      // ---- CH2 ----
      case 0xff16:
        c2.duty = (v >> 6) & 0x03;
        c2.length = 64 - (v & 0x3f);
        break;
      case 0xff17: {
        c2.envVolume = (v >> 4) & 0x0f;
        c2.envDir = (v >> 3) & 0x01;
        c2.envPeriod = v & 0x07;
        c2.dac = (v & 0xf8) !== 0;
        if (!c2.dac) c2.enabled = false;
        break;
      }
      case 0xff18:
        c2.freq = (c2.freq & 0x700) | v;
        break;
      case 0xff19: {
        c2.freq = (c2.freq & 0xff) | ((v & 0x07) << 8);
        c2.lengthEnabled = (v & 0x40) !== 0;
        if (v & 0x80) this.trigger(c2, 64);
        break;
      }
      // ---- CH3 ----
      case 0xff1a:
        c3.dac = (v & 0x80) !== 0;
        if (!c3.dac) c3.enabled = false;
        break;
      case 0xff1b:
        c3.length = 256 - v;
        break;
      case 0xff1c:
        c3.volumeShift = (v >> 5) & 0x03;
        break;
      case 0xff1d:
        c3.freq = (c3.freq & 0x700) | v;
        break;
      case 0xff1e: {
        c3.freq = (c3.freq & 0xff) | ((v & 0x07) << 8);
        c3.lengthEnabled = (v & 0x40) !== 0;
        if (v & 0x80) this.trigger(c3, 256);
        break;
      }
      case 0xff20:
        c4.length = 64 - (v & 0x3f);
        break;
      case 0xff21: {
        c4.envVolume = (v >> 4) & 0x0f;
        c4.envDir = (v >> 3) & 0x01;
        c4.envPeriod = v & 0x07;
        c4.dac = (v & 0xf8) !== 0;
        if (!c4.dac) c4.enabled = false;
        break;
      }
      case 0xff22:
        c4.shift = (v >> 4) & 0x0f;
        c4.width7 = (v & 0x08) !== 0;
        c4.divisor = v & 0x07;
        break;
      case 0xff23: {
        c4.lengthEnabled = (v & 0x40) !== 0;
        if (v & 0x80) this.trigger(c4, 64);
        break;
      }
      // ---- 控制 ----
      case 0xff24:
        this.leftVol = (v >> 4) & 0x07;
        this.rightVol = v & 0x07;
        break;
      case 0xff25:
        this.panning = v & 0xff;
        break;
      case 0xff26: {
        const on = (v & 0x80) !== 0;
        if (!on) {
          this.powerOn = false;
          c1.enabled = c2.enabled = c3.enabled = c4.enabled = false;
        } else if (!this.powerOn) {
          this.powerOn = true;
          this.seqStep = 0;
        }
        break;
      }
      default:
        if (addr >= 0xff30 && addr <= 0xff3f) {
          const idx = (addr - 0xff30) * 2;
          c3.wave[idx] = (v >> 4) & 0x0f;
          c3.wave[idx + 1] = v & 0x0f;
        }
        break;
    }
  }

  trigger(ch, maxLen) {
    ch.enabled = true;
    if (ch.length === 0) ch.length = maxLen;
    ch.freqTimer = ch.freqCycles();
    if (ch instanceof SquareChannel) {
      ch.envTimer = ch.envPeriod;
      ch.dutyPos = 0;
      ch.shadowFreq = ch.freq;
      if (ch.hasSweep) {
        ch.sweepTimer = ch.sweepPeriod === 0 ? 8 : ch.sweepPeriod;
        if (ch.sweepShift !== 0) this.sweepCalc(ch);
      }
    } else if (ch instanceof NoiseChannel) {
      ch.envTimer = ch.envPeriod;
      ch.lfsr = 0x7fff;
    } else {
      ch.pos = 0;
    }
  }

  sweepCalc(ch, update) {
    let newFreq = ch.shadowFreq >> ch.sweepShift;
    if (ch.sweepDir) newFreq = ch.shadowFreq - newFreq;
    else newFreq = ch.shadowFreq + newFreq;
    if (newFreq > 2047) {
      ch.enabled = false;
      return;
    }
    if (update) {
      ch.shadowFreq = newFreq;
      ch.freq = newFreq;
    }
  }

  stepLength(ch) {
    if (ch.lengthEnabled && ch.length > 0) {
      ch.length--;
      if (ch.length === 0) ch.enabled = false;
    }
  }

  stepEnvelope(ch) {
    if (ch.envPeriod === 0) return;
    ch.envTimer--;
    if (ch.envTimer <= 0) {
      ch.envTimer = ch.envPeriod;
      let v = ch.envVolume;
      if (ch.envDir === 1) { if (v < 15) v++; }
      else { if (v > 0) v--; }
      ch.envVolume = v;
    }
  }

  stepSweep(ch) {
    if (!ch.hasSweep) return;
    ch.sweepTimer--;
    if (ch.sweepTimer <= 0) {
      ch.sweepTimer = ch.sweepPeriod === 0 ? 8 : ch.sweepPeriod;
      if (ch.sweepPeriod !== 0) {
        this.sweepCalc(ch, true);
        if (ch.sweepShift !== 0) this.sweepCalc(ch, false);
      }
    }
  }

  // 每帧序列器：512 Hz
  stepFrameSequencer() {
    switch (this.seqStep) {
      case 0: this.stepLength(this.ch1); this.stepLength(this.ch2); this.stepLength(this.ch3); this.stepLength(this.ch4); break;
      case 2: this.stepLength(this.ch1); this.stepLength(this.ch2); this.stepLength(this.ch3); this.stepLength(this.ch4); this.stepSweep(this.ch1); break;
      case 4: this.stepLength(this.ch1); this.stepLength(this.ch2); this.stepLength(this.ch3); this.stepLength(this.ch4); break;
      case 6: this.stepLength(this.ch1); this.stepLength(this.ch2); this.stepLength(this.ch3); this.stepLength(this.ch4); this.stepSweep(this.ch1); break;
      case 7: this.stepEnvelope(this.ch1); this.stepEnvelope(this.ch2); this.stepEnvelope(this.ch4); break;
      default: break;
    }
    this.seqStep = (this.seqStep + 1) & 7;
  }

  step(cycles) {
    if (!this.powerOn) {
      // 仍然按采样率填充静音
      this.fillSilence(cycles);
      return;
    }
    // 帧序列器 512 Hz（每 8192 周期）
    this.seqCounter += cycles;
    while (this.seqCounter >= 8192) {
      this.seqCounter -= 8192;
      this.stepFrameSequencer();
    }
    this.ch1.stepFreq(cycles);
    this.ch2.stepFreq(cycles);
    this.ch3.stepFreq(cycles);
    this.ch4.stepFreq(cycles);
    this.mix(cycles);
  }

  push(l, r) {
    this.bufL[this.wIdx] = l;
    this.bufR[this.wIdx] = r;
    this.wIdx = (this.wIdx + 1) % this.bufSize;
    if (this.wIdx === this.rIdx) this.rIdx = (this.rIdx + 1) % this.bufSize;
  }

  fillSilence(cycles) {
    this.sampleAccum += cycles * (this.sampleRate / 4194304);
    const n = Math.floor(this.sampleAccum);
    if (n <= 0) return;
    this.sampleAccum -= n;
    for (let i = 0; i < n; i++) this.push(0, 0);
  }

  mix(cycles) {
    const s1 = this.ch1.sample();
    const s2 = this.ch2.sample();
    const s3 = this.ch3.sample();
    const s4 = this.ch4.sample();
    const pan = this.panning !== undefined ? this.panning : 0xf3;
    const lv = this.leftVol / 7;
    const rv = this.rightVol / 7;

    let sumL = 0, sumR = 0;
    if (pan & 0x10) sumL += s1;
    if (pan & 0x01) sumR += s1;
    if (pan & 0x20) sumL += s2;
    if (pan & 0x02) sumR += s2;
    if (pan & 0x40) sumL += s3;
    if (pan & 0x04) sumR += s3;
    if (pan & 0x80) sumL += s4;
    if (pan & 0x08) sumR += s4;
    // 单声道满量程为 15，归一化到 -1..1
    let outL = (sumL / 15 - 1) * lv * this.volume;
    let outR = (sumR / 15 - 1) * rv * this.volume;
    if (this.muted) { outL = 0; outR = 0; }

    this.sampleAccum += cycles * (this.sampleRate / 4194304);
    const n = Math.floor(this.sampleAccum);
    if (n <= 0) return;
    this.sampleAccum -= n;
    for (let i = 0; i < n; i++) this.push(outL, outR);
  }

  // 取出可用采样（交错立体声），返回写入的采样点数
  drain(out) {
    let i = 0;
    while (this.rIdx !== this.wIdx && i < out.length - 1) {
      out[i++] = this.bufL[this.rIdx];
      out[i++] = this.bufR[this.rIdx];
      this.rIdx = (this.rIdx + 1) % this.bufSize;
    }
    return i;
  }

  available() {
    return (this.wIdx - this.rIdx + this.bufSize) % this.bufSize;
  }

  // 丢弃最旧的 n 个采样（定时器驱动模式下没人消费音频，防止缓冲写满）
  discard(n) {
    n = Math.min(n, this.available());
    this.rIdx = (this.rIdx + n) % this.bufSize;
    return n;
  }
}
