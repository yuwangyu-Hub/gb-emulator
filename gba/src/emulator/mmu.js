// GBA 内存总线：BIOS / WRAM / IWRAM / IO / PALETTE / VRAM / OAM / ROM / SRAM
// 简化处理：open-bus 返回上一次总线值；ROM 等待周期按 WAIT 表近似。

const REGION = (addr) => (addr >>> 24) & 0xf;

export class MMU {
  constructor({ bios = null, rom = null, ioHook = null } = {}) {
    this.bios = bios;                       // Uint8Array(16K) 或 null（跳过 BIOS）
    this.rom = rom || new Uint8Array(0x2000000);
    this.romSize = this.rom.length;
    this.romMask = 1;
    while (this.romMask < this.romSize) this.romMask <<= 1;
    this.romMask -= 1;
    this.wram = new Uint8Array(0x40000);    // 256KB
    this.iwram = new Uint8Array(0x8000);    // 32KB
    this.io = new Uint8Array(0x400);        // IO 寄存器镜像
    this.pal = new Uint8Array(0x400);       // 调色板
    this.vram = new Uint8Array(0x18000);    // VRAM 96KB
    this.oam = new Uint8Array(0x400);       // OAM
    this.sram = new Uint8Array(0x10000);    // 存档（EEPROM/Flash 复用）
    this.ioHook = ioHook;                   // { read(addr,width), write(addr,width,val) }
    this.openBus = 0;
    this.lastAddr = 0;
    // 等待周期表（非顺序访问，16 位总线）
    this.WAIT = [4, 4, 4, 1, 1, 1, 1, 1, 4, 4, 4, 4, 4, 4, 4, 5];
  }

  wait(addr) {
    const r = (addr >>> 24) & 0xf;
    let w = this.WAIT[r];
    if (w === 0) return 1;
    return w;
  }

  inRom(addr) {
    return addr >= 0x08000000 && addr < 0x0e000000;
  }
  romAddr(addr) {
    let a = addr & 0x01ffffff;
    if (a >= this.romSize) a = a & this.romMask;   // 镜像
    return a;
  }

  read8(addr) {
    addr >>>= 0;
    this.lastAddr = addr;
    switch ((addr >>> 24) & 0xf) {
      case 0: {
        if (addr < 0x4000) return this.bios ? this.bios[addr] : 0xff;
        return this.openBus & 0xff;
      }
      case 1: return this.openBus & 0xff;
      case 2: return this.wram[addr & 0x3ffff];
      case 3: return this.iwram[addr & 0x7fff];
      case 4: {
        if ((addr & 0xfff) < 0x400) {
          const v = this.io[addr & 0x3ff];
          if (this.ioHook) this.ioHook.read(addr & 0x3ff, 0);
          return v;
        }
        return this.openBus & 0xff;
      }
      case 5: return this.pal[addr & 0x3ff];
      case 6: {
        let a = addr & 0x1ffff;
        if (a >= 0x18000) a -= 0x8000;      // 96KB 后的镜像
        return this.vram[a < 0x18000 ? a : 0];
      }
      case 7: return this.oam[addr & 0x3ff];
      case 8: case 9: case 0xa: case 0xb: case 0xc: case 0xd:
        return this.rom[this.romAddr(addr)];
      case 0xe: case 0xf: return this.sram[addr & 0xffff];
      default: return this.openBus & 0xff;
    }
  }

  read16(addr) {
    addr >>>= 0;
    if (this.inRom(addr) && (addr & 1) === 0) {
      const a = this.romAddr(addr);
      if (a + 1 < this.romSize) {
        const v = this.rom[a] | (this.rom[a + 1] << 8);
        this.openBus = v;
        return v;
      }
    }
    const lo = this.read8(addr);
    const hi = this.read8((addr + 1) >>> 0);
    const v = (lo | (hi << 8)) >>> 0;
    this.openBus = v;
    return v;
  }

  read32(addr) {
    addr >>>= 0;
    if (this.inRom(addr) && (addr & 3) === 0) {
      const a = this.romAddr(addr);
      if (a + 3 < this.romSize) {
        const v = (this.rom[a] | (this.rom[a + 1] << 8) | (this.rom[a + 2] << 16) | (this.rom[a + 3] << 24)) >>> 0;
        this.openBus = v;
        return v;
      }
    }
    const v = (this.read16(addr) | (this.read16((addr + 2) >>> 0) << 16)) >>> 0;
    this.openBus = v;
    return v;
  }

  write8(addr, val) {
    addr >>>= 0; val &= 0xff;
    this.lastAddr = addr;
    switch ((addr >>> 24) & 0xf) {
      case 2: this.wram[addr & 0x3ffff] = val; break;
      case 3: this.iwram[addr & 0x7fff] = val; break;
      case 4: {
        const a = addr & 0x3ff;
        this.io[a] = val;
        if (this.ioHook) this.ioHook.write(a, 0, val);
        break;
      }
      case 5: this.pal[addr & 0x3ff] = val; break;
      case 6: {
        let a = addr & 0x1ffff;
        if (a >= 0x18000) a -= 0x8000;
        if (a < 0x18000) this.vram[a] = val;
        break;
      }
      case 7: this.oam[addr & 0x3ff] = val; break;
      case 0xe: case 0xf: this.sram[addr & 0xffff] = val; break;
      default: break;   // ROM/BIOS 写忽略
    }
  }

  write16(addr, val) {
    addr >>>= 0; val &= 0xffff;
    this.write8(addr, val & 0xff);
    this.write8((addr + 1) >>> 0, (val >>> 8) & 0xff);
  }

  write32(addr, val) {
    addr >>>= 0; val >>>= 0;
    this.write16(addr, val & 0xffff);
    this.write16((addr + 2) >>> 0, (val >>> 16) & 0xffff);
  }

  // 供设备快速访问
  io16(addr) { return this.io[addr] | (this.io[(addr + 1) & 0x3ff] << 8); }
  setIo16(addr, v) { this.io[addr] = v & 0xff; this.io[(addr + 1) & 0x3ff] = (v >>> 8) & 0xff; }
}
