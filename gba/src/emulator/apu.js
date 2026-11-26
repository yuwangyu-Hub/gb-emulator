// GBA APU：2 路方波 + 波形 + 噪声 + 2 路 Direct Sound FIFO
// 采样率 32768Hz（每 512 个 CPU 周期一个采样点），输出交错 Float32 左/右声道

const SAMPLE_RATE = 32768;
const CYCLES_PER_SAMPLE = 512;          // 16.78MHz / 32768
const SEQ_CYCLES = 32768;               // 512Hz 帧序列器

export class APU {
  constructor(mmu) {
    this.m = mmu;
    this.buffer = [];
    this.sampleAcc = 0;
    this.seqAcc = 0;
    this.enabled = false;
    // 通道状态
    this.ch = [
      { phase: 0, duty: 0, freq: 0, vol: 0, env: 0, envDir: 0, envStep: 0, len: 0, playing: false, sweep: 0 },
      { phase: 0, duty: 0, freq: 0, vol: 0, env: 0, envDir: 0, envStep: 0, len: 0, playing: false },
      { pos: 0, freq: 0, vol: 0, playing: false, bank: 0, len: 0 },
      { lfsr: 0x7fff, freq: 0, vol: 0, env: 0, envDir: 0, envStep: 0, len: 0, playing: false },
    ];
    this.fifo = [
      { q: [], out: 0 },
      { q: [], out: 0 },
    ];
    this.seqStep = 0;
  }

  reg(a) { return this.m.io[a] | (this.m.io[(a + 1) & 0x3ff] << 8); }

  onIOWrite(addr) {
    // 通道控制写入：触发包络/长度重载
    if (addr === 0x64 && (this.m.io[0x64] & 0x80)) this.trigger(0);
    if (addr === 0x6c && (this.m.io[0x6c] & 0x80)) this.trigger(1);
    if (addr === 0x74 && (this.m.io[0x74] & 0x80)) this.trigger(2);
    if (addr === 0x7c && (this.m.io[0x7c] & 0x80)) this.trigger(3);
    if (addr === 0x84) this.enabled = !!(this.m.io[0x84] & 0x80);
    // FIFO 写入（32 位，落在 0xa0/0xa4）
    if (addr >= 0xa0 && addr < 0xa8) {
      const idx = addr < 0xa4 ? 0 : 1;
      const v = (this.m.io[addr & ~3] | (this.m.io[(addr & ~3) + 1] << 8) |
        (this.m.io[(addr & ~3) + 2] << 16) | (this.m.io[(addr & ~3) + 3] << 24)) >>> 0;
      for (let i = 0; i < 4; i++) {
        if (this.fifo[idx].q.length < 32) this.fifo[idx].q.push(((v >>> (i * 8)) & 0xff) | 0);
      }
    }
  }

  trigger(i) {
    const c = this.ch[i];
    if (i === 0) {
      const h = this.reg(0x62);
      c.duty = (h >>> 6) & 3;
      c.vol = (h >>> 12) & 0xf;
      c.envDir = (h >>> 11) & 1;
      c.envStep = h & 7;
      c.len = (h & 0x3f) | 0;
      c.playing = true;
    } else if (i === 1) {
      const l = this.reg(0x68);
      c.duty = (l >>> 6) & 3;
      c.vol = (l >>> 12) & 0xf;
      c.envDir = (l >>> 11) & 1;
      c.envStep = l & 7;
      c.len = l & 0x3f;
      c.playing = true;
    } else if (i === 2) {
      const h = this.reg(0x72);
      c.vol = (h >>> 13) & 3;   // 0=静音 1=100% 2=50% 3=25%
      c.playing = true;
      c.pos = 0;
    } else {
      const l = this.reg(0x78);
      c.vol = (l >>> 12) & 0xf;
      c.envDir = (l >>> 11) & 1;
      c.envStep = l & 7;
      c.lfsr = 0x7fff;
      c.playing = true;
    }
  }

  tick(cycles) {
    if (!this.enabled) { this.sampleAcc = 0; return; }
    this.sampleAcc += cycles;
    while (this.sampleAcc >= CYCLES_PER_SAMPLE) {
      this.sampleAcc -= CYCLES_PER_SAMPLE;
      this.sample();
    }
    this.seqAcc += cycles;
    while (this.seqAcc >= SEQ_CYCLES) {
      this.seqAcc -= SEQ_CYCLES;
      this.sequencer();
    }
  }

  sequencer() {
    this.seqStep = (this.seqStep + 1) & 7;
    const even = (this.seqStep & 1) === 0;
    // 长度计数
    if (even) {
      for (let i = 0; i < 4; i++) {
        const c = this.ch[i];
        const en = i === 2 ? (this.reg(0x72) & 0x4000) : ((this.reg(i === 0 ? 0x62 : i === 1 ? 0x68 : 0x78) >>> 14) & 1);
        if (en && c.len > 0) { c.len--; if (c.len === 0) c.playing = false; }
      }
    }
    // 包络
    if (this.seqStep === 7) {
      for (const i of [0, 1, 3]) {
        const c = this.ch[i];
        if (c.envStep === 0) continue;
        let v = c.vol;
        if (c.envDir) v++; else v--;
        if (v < 0) v = 0;
        if (v > 15) v = 15;
        c.vol = v;
      }
    }
    // 扫频（通道 1）
    if (even && (this.seqStep & 3) === 2) {
      const sw = this.reg(0x60);
      const shift = sw & 7;
      const c = this.ch[0];
      if ((sw >>> 4) & 1 && shift) {
        let f = c.freq;
        if ((sw >>> 3) & 1) f -= (f >> shift);
        else f += (f >> shift);
        if (f > 2047) { c.playing = false; f = 2047; }
        c.freq = f;
      }
    }
  }

  sample() {
    const cntL = this.reg(0x80);
    const cntH = this.reg(0x82);
    const leftVol = (cntL >>> 4) & 7;      // 0..7 → 1/8 步长
    const rightVol = cntL & 7;
    const gbVol = cntH & 3;                // GB 通道音量倍率
    let l = 0, r = 0;

    // 读取频率
    this.ch[0].freq = this.reg(0x64) & 0x7ff;
    this.ch[1].freq = this.reg(0x6c) & 0x7ff;
    this.ch[2].freq = this.reg(0x74) & 0x7ff;
    const ch4h = this.reg(0x7c);
    this.ch[3].freq = ch4h & 0x7ff;

    // 通道 1/2：方波
    for (const i of [0, 1]) {
      const c = this.ch[i];
      if (!c.playing) continue;
      const rate = 131072 / (2048 - c.freq);
      c.phase += rate / SAMPLE_RATE;
      if (c.phase >= 1) c.phase -= 1;
      const dutyTable = [0.125, 0.25, 0.5, 0.75];
      const on = c.phase < dutyTable[c.duty];
      const amp = on ? (c.vol / 15) * (1 / 8) * (gbVol + 1) / 4 : 0;
      const enL = (cntL >>> (12 + i)) & 1, enR = (cntL >>> (8 + i)) & 1;
      if (enL) l += amp * (leftVol / 7);
      if (enR) r += amp * (rightVol / 7);
    }
    // 通道 3：波形
    {
      const c = this.ch[2];
      if (c.playing) {
        const rate = 2097152 / (2048 - c.freq) / 2;
        c.pos += rate / SAMPLE_RATE;
        if (c.pos >= 32) c.pos -= 32;
        const idx = (c.pos | 0) & 31;
        const byte = this.m.io[0x90 + (idx >> 1)];
        const nib = (idx & 1) ? (byte & 0xf) : (byte >>> 4);
        const volSel = c.vol;
        const scale = volSel === 0 ? 0 : volSel === 1 ? 1 : volSel === 2 ? 0.5 : 0.25;
        const amp = (nib / 15) * scale * (1 / 8) * (gbVol + 1) / 4;
        if ((cntL >>> 14) & 1) l += amp * (leftVol / 7);
        if ((cntL >>> 10) & 1) r += amp * (rightVol / 7);
      }
    }
    // 通道 4：噪声
    {
      const c = this.ch[3];
      if (c.playing) {
        const divisor = [8, 16, 32, 48, 64, 80, 96, 112][(ch4h >>> 4) & 7];
        const clk = 524288 / divisor;
        const shift = ch4h >>> 4;
        const steps = Math.max(1, Math.round(clk / SAMPLE_RATE));
        for (let s = 0; s < steps; s++) {
          const bit = (c.lfsr ^ (c.lfsr >> 1)) & 1;
          c.lfsr = ((c.lfsr >> 1) | (bit << 14)) & 0x7fff;
        }
        const on = (c.lfsr & 1) === 0;
        const amp = on ? (c.vol / 15) * (1 / 8) * (gbVol + 1) / 4 : 0;
        if ((cntL >>> 15) & 1) l += amp * (leftVol / 7);
        if ((cntL >>> 11) & 1) r += amp * (rightVol / 7);
      }
    }
    // Direct Sound FIFO
    const dsA = (cntH >>> 2) & 1, dsB = (cntH >>> 3) & 1;
    const fifoVol = (cntH >>> 2) & 1 ? 1 : 0.5;
    if ((cntH >>> 10) & 1) {  // A 右/左使能位
      const v = this.fifo[0].q.length ? ((this.fifo[0].q.shift() | 0) - 128) / 128 : this.fifo[0].out;
      this.fifo[0].out = v;
      if ((cntH >>> 8) & 1) l += v * fifoVol * 0.5;
      if ((cntH >>> 9) & 1) r += v * fifoVol * 0.5;
    } else if (this.fifo[0].q.length) this.fifo[0].q.shift();
    if ((cntH >>> 14) & 1) {
      const v = this.fifo[1].q.length ? ((this.fifo[1].q.shift() | 0) - 128) / 128 : this.fifo[1].out;
      this.fifo[1].out = v;
      if ((cntH >>> 12) & 1) l += v * fifoVol * 0.5;
      if ((cntH >>> 13) & 1) r += v * fifoVol * 0.5;
    } else if (this.fifo[1].q.length) this.fifo[1].q.shift();

    l = Math.max(-1, Math.min(1, l));
    r = Math.max(-1, Math.min(1, r));
    this.buffer.push(l, r);
  }

  readSamples() {
    const out = this.buffer;
    this.buffer = [];
    return out;
  }
}
