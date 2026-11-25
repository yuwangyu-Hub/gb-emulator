// MMU：地址解码 + 硬件寄存器分发

export class MMU {
  constructor(gb) {
    this.gb = gb;
    this.wram = new Uint8Array(0x2000);
    this.hram = new Uint8Array(0x80);
    this.ie = 0x00;
    this.cart = null;
    this.dmaInProgress = false;
    this.serialOut = '';
  }

  reset() {
    this.wram.fill(0);
    this.hram.fill(0);
    this.ie = 0x00;
    this.serialOut = '';
  }

  loadCartridge(cart) {
    this.cart = cart;
  }

  read(addr) {
    addr &= 0xffff;
    const a = addr >> 12;

    if (addr < 0x8000) {
      if (!this.cart) return 0xff;
      return this.cart.readROM(addr);
    }
    if (addr < 0xa000) return this.gb.ppu.vram[addr - 0x8000];
    if (addr < 0xc000) {
      if (!this.cart) return 0xff;
      return this.cart.readRAM(addr - 0xa000);
    }
    if (addr < 0xe000) return this.wram[addr - 0xc000];
    if (addr < 0xfe00) return this.wram[addr - 0xe000]; // echo
    if (addr < 0xfea0) return this.gb.ppu.oam[addr - 0xfe00];
    if (addr < 0xff00) return 0xff; // 未使用区域
    if (addr < 0xff80) return this.readIO(addr);
    if (addr < 0xffff) return this.hram[addr - 0xff80];
    return this.ie;
  }

  write(addr, v) {
    addr &= 0xffff;
    v &= 0xff;

    if (addr < 0x8000) {
      if (this.cart) this.cart.write(addr, v);
      return;
    }
    if (addr < 0xa000) { this.gb.ppu.vram[addr - 0x8000] = v; return; }
    if (addr < 0xc000) { if (this.cart) this.cart.writeRAM(addr - 0xa000, v); return; }
    if (addr < 0xe000) { this.wram[addr - 0xc000] = v; return; }
    if (addr < 0xfe00) { this.wram[addr - 0xe000] = v; return; }
    if (addr < 0xfea0) { this.gb.ppu.oam[addr - 0xfe00] = v; return; }
    if (addr < 0xff00) return; // 未使用
    if (addr < 0xff80) { this.writeIO(addr, v); return; }
    if (addr < 0xffff) { this.hram[addr - 0xff80] = v; return; }
    this.ie = v;
  }

  readIO(addr) {
    const gb = this.gb;
    switch (addr) {
      case 0xff00: return gb.joypad.read();
      case 0xff01: return 0xff;
      case 0xff02: return 0x7e;
      case 0xff04: return gb.timer.div;
      case 0xff05: return gb.timer.tima;
      case 0xff06: return gb.timer.tma;
      case 0xff07: return gb.timer.tac | 0xf8;
      case 0xff0f: return gb.if_ | 0xe0;
      case 0xff44: return gb.ppu.readReg(addr);
      case 0xff40: case 0xff41: case 0xff42: case 0xff43:
      case 0xff45: case 0xff47: case 0xff48: case 0xff49:
      case 0xff4a: case 0xff4b:
        return gb.ppu.readReg(addr);
      case 0xff4d: return 0xff; // CGB speed
      case 0xff4f: return 0xff; // VRAM bank
      case 0xff70: return 0xff;
      default:
        if (addr >= 0xff10 && addr <= 0xff3f) return gb.apu.readReg(addr);
        if (addr >= 0xff30 && addr <= 0xff3f) return gb.apu.readReg(addr);
        return 0xff;
    }
  }

  writeIO(addr, v) {
    const gb = this.gb;
    switch (addr) {
      case 0xff00: gb.joypad.write(v); return;
      case 0xff01:
        if (gb.serialLog) this.serialOut += String.fromCharCode(v);
        return;
      case 0xff02: return;
      case 0xff04: gb.timer.div = 0; gb.timer.divCounter = 0; return;
      case 0xff05: gb.timer.tima = v; return;
      case 0xff06: gb.timer.tma = v; return;
      case 0xff07: gb.timer.tac = v & 0x07; return;
      case 0xff0f: gb.if_ = v & 0x1f; return;
      case 0xff46: this.startDMA(v); return;
      case 0xff4d: return;
      default:
        if (addr >= 0xff10 && addr <= 0xff3f) { gb.apu.writeReg(addr, v); return; }
        if (addr >= 0xff40 && addr <= 0xff4b) { gb.ppu.writeReg(addr, v); return; }
        return;
    }
  }

  startDMA(src) {
    const base = (src & 0xff) << 8;
    for (let i = 0; i < 0xa0; i++) {
      this.gb.ppu.oam[i] = this.read(base + i);
    }
  }

  serialize() {
    return {
      wram: Array.from(this.wram),
      hram: Array.from(this.hram),
      ie: this.ie,
    };
  }

  deserialize(s) {
    this.wram.set(s.wram);
    this.hram.set(s.hram);
    this.ie = s.ie;
  }
}
