// GBA 主机装配：CPU + MMU + PPU + APU + DMA + 定时器 + 中断 + 按键

import { CPU } from './cpu.js';
import { MMU } from './mmu.js';
import { PPU } from './ppu.js';
import { APU } from './apu.js';

export const CYCLES_PER_LINE = 1232;
export const VISIBLE_CYCLES = 960;
export const LINES_PER_FRAME = 228;
export const CYCLES_PER_FRAME = CYCLES_PER_LINE * LINES_PER_FRAME;   // 280896

const PRESCALER = [1, 64, 256, 1024];

export class GBA {
  constructor() {
    this.mmu = new MMU({ ioHook: { read: (a) => this.ioReadHook(a), write: (a, w, v) => this.ioWrite(a, w, v) } });
    this.cpu = new CPU(this.mmu);
    this.ppu = new PPU(this.mmu);
    this.apu = new APU(this.mmu);
    this.cpu.swiHook = (c) => this.swi(c);
    this.keys = 0x3ff;                 // 1=未按下（KEYINPUT 取反语义）
    this.timers = [0, 1, 2, 3].map(() => ({ counter: 0, reload: 0, prescaler: 0, cascade: false, irq: false, enabled: false, acc: 0 }));
    this.dma = [0, 1, 2, 3].map(() => ({ sad: 0, dad: 0, count: 0, ctrl: 0, active: false }));
    this.ime = 0;
    this.halted = false;
    this.frameDone = false;
    this.saveType = 'none';
    this.onFrame = null;
    this.romTitle = '';
    this.romCode = '';
  }

  loadROM(rom) {
    this.mmu.rom = rom;
    this.mmu.romSize = rom.length;
    let mask = 1;
    while (mask < rom.length) mask <<= 1;
    this.mmu.romMask = mask - 1;
    // 卡带信息
    const t = [];
    for (let i = 0xa0; i < 0xac; i++) { const c = rom[i]; if (!c) break; t.push(String.fromCharCode(c)); }
    this.romTitle = t.join('').trim();
    const c = [];
    for (let i = 0xac; i < 0xb0; i++) c.push(String.fromCharCode(rom[i]));
    this.romCode = c.join('');
    this.detectSave(rom);
    this.reset();
  }

  detectSave(rom) {
    const text = Buffer ? null : null;
    let s = '';
    for (let i = 0; i < rom.length && s.length < 0x400000; i += 0x1000) {
      // 粗略扫描：把连续可读字符拼起来
    }
    const str = (() => {
      let out = '';
      for (let i = 0; i < Math.min(rom.length, 0x400000); i++) {
        const c = rom[i];
        out += (c >= 0x20 && c < 0x7f) ? String.fromCharCode(c) : '.';
      }
      return out;
    })();
    if (str.indexOf('EEPROM_V') >= 0) this.saveType = 'eeprom';
    else if (str.indexOf('FLASH1M_V') >= 0) this.saveType = 'flash1m';
    else if (str.indexOf('FLASH_V') >= 0 || str.indexOf('FLASH512_V') >= 0) this.saveType = 'flash';
    else if (str.indexOf('SRAM_V') >= 0 || str.indexOf('SRAM_F_V') >= 0) this.saveType = 'sram';
    else this.saveType = 'none';
  }

  reset() {
    this.cpu.reset(true);
    this.mmu.io.fill(0);
    this.mmu.pal.fill(0);
    this.mmu.vram.fill(0);
    this.mmu.oam.fill(0);
    this.mmu.wram.fill(0);
    this.mmu.iwram.fill(0);
    this.mmu.io[0x84] = 0x80;      // SOUNDCNT_X 主使能
    this.apu.enabled = true;
    this.ime = 0;
    this.halted = false;
    for (const t of this.timers) { t.counter = 0; t.reload = 0; t.enabled = false; t.acc = 0; }
  }

  // ---------- IO ----------
  ioReadHook(addr) {
    if (addr === 0x130 || addr === 0x131) {
      const v = this.keys & 0x3ff;
      this.mmu.io[0x130] = v & 0xff;
      this.mmu.io[0x131] = (v >>> 8) & 0xff;
    }
    for (let i = 0; i < 4; i++) {
      const base = 0x100 + i * 4;
      if (addr === base || addr === base + 1) {
        const v = this.timers[i].counter & 0xffff;
        this.mmu.io[base] = v & 0xff;
        this.mmu.io[base + 1] = (v >>> 8) & 0xff;
      }
    }
    if (addr === 0x84) {  // SOUNDCNT_X 状态
      let st = this.mmu.io[0x84] & 0x80;
      for (let i = 0; i < 4; i++) if (this.apu.ch[i].playing) st |= (1 << i);
      this.mmu.io[0x84] = st;
    }
  }

  ioWrite(addr, width, val) {
    // 定时任务/声音/DMA 副作用
    if (addr >= 0x60 && addr < 0xb0) this.apu.onIOWrite(addr);
    if (addr === 0x202 || addr === 0x203) {   // IF：写入位表示清除
      if (addr === 0x202) this.mmu.io[0x202] &= ~val;
      else this.mmu.io[0x203] &= ~val;
      return;
    }
    if (addr >= 0x100 && addr < 0x110) { this.timerWrite(addr); return; }
    if (addr >= 0xb0 && addr < 0xe0) { this.dmaWrite(addr); return; }
    if (addr === 0x208 || addr === 0x209) { this.ime = this.mmu.io[0x208] & 1; return; }
    if (addr === 0x300 || addr === 0x301) { this.halted = true; return; }
    if (addr === 0x206 || addr === 0x207) { /* POSTFLG */ return; }
  }

  timerWrite(addr) {
    const i = (addr - 0x100) >> 2;
    const t = this.timers[i];
    const h = this.mmu.io[0x100 + i * 4 + 2] | (this.mmu.io[0x100 + i * 4 + 3] << 8);
    const oldEnabled = t.enabled;
    t.reload = this.mmu.io[0x100 + i * 4] | (this.mmu.io[0x100 + i * 4 + 1] << 8);
    t.prescaler = h & 3;
    t.cascade = !!(h & 4);
    t.irq = !!(h & 0x40);
    t.enabled = !!(h & 0x80);
    if (t.enabled && !oldEnabled) t.counter = t.reload;
  }

  dmaWrite(addr) {
    const i = (addr - 0xb0) >> 2;
    if (i > 3) return;
    const d = this.dma[i];
    const base = 0xb0 + i * 12;
    d.sad = (this.mmu.io[base] | (this.mmu.io[base + 1] << 8) | (this.mmu.io[base + 2] << 16) | (this.mmu.io[base + 3] << 24)) >>> 0;
    d.dad = (this.mmu.io[base + 4] | (this.mmu.io[base + 5] << 8) | (this.mmu.io[base + 6] << 16) | (this.mmu.io[base + 7] << 24)) >>> 0;
    d.count = this.mmu.io[base + 8] | (this.mmu.io[base + 9] << 8);
    d.ctrl = this.mmu.io[base + 10] | (this.mmu.io[base + 11] << 8);
    if (d.ctrl & 0x8000) {
      const mode = (d.ctrl >>> 12) & 3;
      if (mode === 0) this.runDMA(i);
    }
  }

  runDMA(i) {
    const d = this.dma[i];
    const width = (d.ctrl >>> 10) & 1;
    const srcCtrl = (d.ctrl >>> 7) & 3;
    const dstCtrl = (d.ctrl >>> 5) & 3;
    let count = d.count || (width ? 0x10000 : 0x4000);
    let src = d.sad & 0xfffffffe;
    let dst = d.dad & 0xfffffffe;
    const step = width ? 4 : 2;
    for (let n = 0; n < count; n++) {
      if (width) {
        this.mmu.write32(dst, this.mmu.read32(src));
      } else {
        this.mmu.write16(dst, this.mmu.read16(src));
      }
      // 源地址调整
      if (srcCtrl === 0) src += step;
      else if (srcCtrl === 1) src -= step;
      else if (srcCtrl === 3) src += step;
      // 目标地址调整
      if (dstCtrl === 0) dst += step;
      else if (dstCtrl === 1) dst -= step;
      else if (dstCtrl === 3) dst += step;
      src >>>= 0; dst >>>= 0;
    }
    d.sad = src; d.dad = dst;
    d.count = 0;
    if (d.ctrl & 0x4000) this.requestIRQ(1 << (8 + i));
    if (!((d.ctrl >>> 9) & 1)) d.ctrl &= ~0x8000;   // 非重复传输：结束
    this.mmu.setIo16(0xb0 + i * 12 + 10, d.ctrl);
  }

  requestIRQ(bits) {
    const ie = this.mmu.io[0x200] | (this.mmu.io[0x201] << 8);
    let if_ = this.mmu.io[0x202] | (this.mmu.io[0x203] << 8);
    if_ |= bits;
    this.mmu.io[0x202] = if_ & 0xff;
    this.mmu.io[0x203] = (if_ >>> 8) & 0xff;
  }

  swi(comment) {
    // BIOS HLE：只实现最常见的几个，其余忽略
    if (comment === 0x00 || comment === 0x26) { /* SoftReset：忽略 */ }
    return;
  }

  // ---------- 定时器 / 时钟推进 ----------
  tickTimers(delta) {
    let overflowChain = 0;
    for (let i = 0; i < 4; i++) {
      const t = this.timers[i];
      if (!t.enabled) continue;
      if (t.cascade) {
        if (overflowChain) {
          t.counter = (t.counter + 1) & 0xffff;
          if (t.counter === 0) { t.counter = t.reload; if (t.irq) this.requestIRQ(1 << (3 + i)); overflowChain = 1; }
        }
        continue;
      }
      const period = PRESCALER[t.prescaler] * 1;   // 每 N 个 CPU 周期 +1
      t.acc += delta;
      if (t.acc < period) continue;
      const steps = (t.acc / period) | 0;
      t.acc -= steps * period;
      for (let s = 0; s < steps && s < 4096; s++) {
        t.counter = (t.counter + 1) & 0xffff;
        if (t.counter === 0) {
          t.counter = t.reload;
          if (t.irq) this.requestIRQ(1 << (3 + i));
          overflowChain = 1;
        }
      }
    }
  }

  runCycles(n) {
    const target = this.cpu.cycles + n;
    while (this.cpu.cycles < target) {
      const ie = this.mmu.io[0x200] | (this.mmu.io[0x201] << 8);
      const if_ = this.mmu.io[0x202] | (this.mmu.io[0x203] << 8);
      if (this.halted) {
        if (this.ime && (ie & if_)) {
          this.halted = false;
          this.cpu.tryIRQ(this.ime, ie, if_);
        } else {
          const rest = target - this.cpu.cycles;
          this.cpu.cycles += rest;
          this.tickTimers(rest);
          this.apu.tick(rest);
          break;
        }
      }
      const before = this.cpu.cycles;
      this.cpu.step();
      const used = this.cpu.cycles - before;
      if (used > 0) { this.tickTimers(used); this.apu.tick(used); }
      const ie2 = this.mmu.io[0x200] | (this.mmu.io[0x201] << 8);
      const if2 = this.mmu.io[0x202] | (this.mmu.io[0x203] << 8);
      if (this.ime && (ie2 & if2) && !(this.cpu.cpsr & 0x80)) {
        this.cpu.tryIRQ(this.ime, ie2, if2);
      }
    }
  }

  // ---------- 一帧 ----------
  runFrame() {
    this.ppu.latchRefs();
    for (let line = 0; line < LINES_PER_FRAME; line++) {
      this.mmu.io[0x06] = line & 0xff;
      this.mmu.io[0x07] = (line >>> 8) & 0xff;
      let dispstat = this.mmu.io[0x04] | (this.mmu.io[0x05] << 8);
      dispstat &= ~0x0002;                       // 清 HBlank
      if (line >= 160) dispstat |= 0x0001;       // VBlank
      else dispstat &= ~0x0001;
      const vcountSet = (dispstat >>> 8) & 0xff;
      if (line === vcountSet && (dispstat & 0x20)) this.requestIRQ(0x0004);
      this.mmu.setIo16(0x04, dispstat);

      this.runCycles(VISIBLE_CYCLES);
      if (line < 160) this.ppu.renderLine(line);

      dispstat |= 0x0002;                        // 进入 HBlank
      this.mmu.setIo16(0x04, dispstat);
      if (line < 160) {
        if (dispstat & 0x10) this.requestIRQ(0x0002);
        for (let i = 0; i < 4; i++) {
          const d = this.dma[i];
          if ((d.ctrl & 0x8000) && ((d.ctrl >>> 12) & 3) === 2) this.runDMA(i);
        }
      }
      if (line === 160) {
        if (dispstat & 0x08) this.requestIRQ(0x0001);
        for (let i = 0; i < 4; i++) {
          const d = this.dma[i];
          if ((d.ctrl & 0x8000) && ((d.ctrl >>> 12) & 3) === 1) this.runDMA(i);
        }
      }
      this.runCycles(CYCLES_PER_LINE - VISIBLE_CYCLES);
    }
    if (this.onFrame) this.onFrame();
  }

  // ---------- 按键 ----------
  setKey(i, down) {
    // i: 0=A 1=B 2=Select 3=Start 4=Right 5=Left 6=Up 7=Down 8=R 9=L
    if (down) this.keys &= ~(1 << i);
    else this.keys |= (1 << i);
    this.keys &= 0x3ff;
  }
}
