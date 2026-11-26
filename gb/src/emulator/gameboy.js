// Game Boy 主类：串联 CPU / PPU / APU / MMU / Timer / Joypad

import { CPU } from './cpu.js?v=1795666799';
import { PPU, SCREEN_W, SCREEN_H, PALETTES } from './ppu.js?v=1795666799';
import { MMU } from './mmu.js?v=1795666799';
import { Timer } from './timer.js?v=1795666799';
import { Joypad } from './joypad.js?v=1795666799';
import { APU } from './apu.js?v=1795666799';
import { Cartridge, parseROMHeader } from './cartridge.js?v=1795666799';

export const CLOCK_HZ = 4194304;
const CYCLES_PER_FRAME = 70224;

export class GameBoy {
  constructor() {
    this.cpu = new CPU(this);
    this.ppu = new PPU(this);
    this.mmu = new MMU(this);
    this.timer = new Timer(this);
    this.joypad = new Joypad();
    this.apu = new APU(this);
    this.if_ = 0x00;
    this.cartridge = null;
    this.running = false;
    this.serialLog = false;
    this.frameCount = 0;
    this.cyclesThisFrame = 0;
    this.speedMultiplier = 1;
    this.ppu.onFrame = () => { this.frameCount++; };
  }

  loadROM(data, ramData, sampleRate) {
    const rom = data instanceof Uint8Array ? data : new Uint8Array(data);
    this.cartridge = new Cartridge(rom);
    if (ramData) this.cartridge.loadRAM(new Uint8Array(ramData));
    this.apu.setSampleRate(sampleRate || 44100);
    this.mmu.loadCartridge(this.cartridge);
    this.reset(false);
    return this.cartridge.info;
  }

  get info() {
    return this.cartridge ? this.cartridge.info : null;
  }

  reset(keepRAM = true) {
    const ram = keepRAM && this.cartridge ? this.cartridge.ram.slice() : null;
    const cart = this.cartridge;
    this.cpu.reset();
    this.ppu.reset();
    this.mmu.reset();
    this.timer.reset();
    this.joypad.reset();
    this.apu.reset();
    this.if_ = 0x00;
    this.frameCount = 0;
    this.cyclesThisFrame = 0;
    if (cart) {
      this.mmu.loadCartridge(cart);
      if (ram) cart.loadRAM(ram);
    }
    // 跳过 Boot ROM：直接把硬件寄存器初始化为开机后的状态
    this.mmu.write(0xff05, 0x00);
    this.mmu.write(0xff06, 0x00);
    this.mmu.write(0xff07, 0x00);
    this.mmu.write(0xff10, 0x80);
    this.mmu.write(0xff11, 0xbf);
    this.mmu.write(0xff12, 0xf3);
    this.mmu.write(0xff14, 0xbf);
    this.mmu.write(0xff16, 0x3f);
    this.mmu.write(0xff17, 0x00);
    this.mmu.write(0xff19, 0xbf);
    this.mmu.write(0xff1a, 0x7f);
    this.mmu.write(0xff1b, 0xff);
    this.mmu.write(0xff1c, 0x9f);
    this.mmu.write(0xff1e, 0xbf);
    this.mmu.write(0xff20, 0xff);
    this.mmu.write(0xff21, 0x00);
    this.mmu.write(0xff22, 0x00);
    this.mmu.write(0xff23, 0xbf);
    this.mmu.write(0xff24, 0x77);
    this.mmu.write(0xff25, 0xf3);
    this.mmu.write(0xff26, 0xf1);
    this.mmu.write(0xff40, 0x91);
    this.mmu.write(0xff41, 0x85);
    this.mmu.write(0xff42, 0x00);
    this.mmu.write(0xff43, 0x00);
    this.mmu.write(0xff45, 0x00);
    this.mmu.write(0xff47, 0xfc);
    this.mmu.write(0xff48, 0xff);
    this.mmu.write(0xff49, 0xff);
    this.mmu.write(0xff4a, 0x00);
    this.mmu.write(0xff4b, 0x00);
    this.mmu.ie = 0x00;
  }

  requestInterrupt(n) {
    this.if_ |= (1 << n) & 0x1f;
  }

  // 推进一帧（到 VBlank 结束），返回是否产生新画面
  runFrame(maxCycles = CYCLES_PER_FRAME * 4) {
    let cycles = 0;
    this.ppu.frameReady = false;
    while (!this.ppu.frameReady) {
      const c = this.cpu.step();
      this.timer.step(c);
      this.ppu.step(c);
      this.apu.step(c);
      cycles += c;
      if (cycles > maxCycles) break;
    }
    return true;
  }

  // 按采样数推进模拟器（音频驱动模式下使用）
  runForSamples(n) {
    // 安全上限：缓冲快满时不再生成，防止调用方（如定时器驱动）失控狂奔
    const target = Math.min(this.apu.available() + n, this.apu.bufSize - 1024);
    if (target <= this.apu.available()) return;
    let guard = 0;
    while (this.apu.available() < target && guard++ < 120) {
      const deficit = target - this.apu.available();
      const cycles = Math.min(70224, Math.ceil(deficit * 4194304 / this.apu.sampleRate));
      this.stepCycles(cycles);
    }
  }

  // 供音频驱动使用：按时间推进若干周期
  stepCycles(cycles) {
    let left = cycles;
    while (left > 0) {
      const c = this.cpu.step();
      this.timer.step(c);
      this.ppu.step(c);
      this.apu.step(c);
      left -= c;
    }
  }

  getFramebuffer() {
    return this.ppu.framebuffer;
  }

  setPalette(name) {
    this.ppu.setPalette(name);
  }

  exportRAM() {
    if (!this.cartridge || this.cartridge.ram.length === 0) return null;
    return this.cartridge.ram.slice();
  }

  serialize() {
    return {
      cpu: this.cpu.serialize(),
      ppu: this.ppu.serialize(),
      mmu: this.mmu.serialize(),
      timer: this.timer.serialize(),
      if_: this.if_,
    };
  }

  deserialize(s) {
    this.cpu.deserialize(s.cpu);
    this.ppu.deserialize(s.ppu);
    this.mmu.deserialize(s.mmu);
    this.timer.deserialize(s.timer);
    this.if_ = s.if_;
  }
}

export { SCREEN_W, SCREEN_H, PALETTES, parseROMHeader };
