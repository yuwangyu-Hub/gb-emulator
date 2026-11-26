// 卡带与 MBC（内存组控制器）

const RAM_SIZES = [0, 0x800, 0x2000, 0x8000, 0x20000, 0x10000];

export const MBC_NAMES = {
  0x00: 'ROM ONLY',
  0x01: 'MBC1',
  0x02: 'MBC1+RAM',
  0x03: 'MBC1+RAM+BATTERY',
  0x05: 'MBC2',
  0x06: 'MBC2+BATTERY',
  0x08: 'ROM+RAM',
  0x09: 'ROM+RAM+BATTERY',
  0x0b: 'MMM01',
  0x0c: 'MMM01+RAM',
  0x0d: 'MMM01+RAM+BATTERY',
  0x0f: 'MBC3+TIMER+BATTERY',
  0x10: 'MBC3+TIMER+RAM+BATTERY',
  0x11: 'MBC3',
  0x12: 'MBC3+RAM',
  0x13: 'MBC3+RAM+BATTERY',
  0x19: 'MBC5',
  0x1a: 'MBC5+RAM',
  0x1b: 'MBC5+RAM+BATTERY',
  0x1c: 'MBC5+RUMBLE',
  0x1d: 'MBC5+RUMBLE+RAM',
  0x1e: 'MBC5+RUMBLE+RAM+BATTERY',
};

// 老的厂商代号表（GB 卡头 0x14B）
export const LICENSEE_NAMES = {
  0x00: 'None', 0x01: 'Nintendo', 0x08: 'Capcom', 0x09: 'Hot-B',
  0x0a: 'Jaleco', 0x0b: 'Coconuts Japan', 0x0c: 'Elite Systems', 0x13: 'EA (Electronic Arts)',
  0x18: 'Hudson Soft', 0x19: 'ITC Entertainment', 0x1a: 'Yanoman', 0x1d: 'Clary',
  0x1f: 'Virgin Games', 0x24: 'PCM Complete', 0x25: 'San-X', 0x28: 'Kemco',
  0x29: 'SETA Corporation', 0x30: 'Infogrames', 0x31: 'Nintendo', 0x32: 'Bandai',
  0x33: 'New Licensee', 0x34: 'Konami', 0x35: 'HectorSoft', 0x38: 'Capcom',
  0x39: 'Banpresto', 0x3c: '.Entertainment i', 0x3e: 'Gremlin', 0x41: 'Ubisoft',
  0x42: 'Atlus', 0x44: 'Malibu', 0x46: 'Angel', 0x47: 'Spectrum Holobyte',
  0x49: 'Irem', 0x4a: 'Virgin Games', 0x4d: 'Malibu', 0x4f: 'U.S. Gold',
  0x50: 'Absolute', 0x51: 'Acclaim', 0x52: 'Activision', 0x53: 'American Sammy',
  0x54: 'GameTek', 0x55: 'Park Place', 0x56: 'LJN', 0x57: 'Matchbox',
  0x59: 'Milton Bradley', 0x5a: 'Mindscape', 0x5b: 'Romstar', 0x5c: 'Naxat Soft',
  0x5d: 'Tradewest', 0x60: 'Titus', 0x61: 'Virgin Games', 0x67: 'Ocean',
  0x69: 'EA (Electronic Arts)', 0x6e: 'Elite Systems', 0x6f: 'Electro Brain',
  0x70: 'Infogrames', 0x71: 'Interplay', 0x72: 'Broderbund', 0x73: 'Sculptered Soft',
  0x75: 'The Sales Curve', 0x78: 't.hq', 0x79: 'Accolade', 0x7a: 'Triffix Entertainment',
  0x7c: 'Microprose', 0x7f: 'Kemco', 0x83: 'LOZC', 0x86: 'Tokuma Shoten',
  0x8b: 'Bullet-Proof Software', 0x8c: 'Vic Tokai', 0x8e: 'Ape', 0x8f: 'I\'Max',
  0x91: 'Chun Soft', 0x92: 'Video System', 0x93: 'Tsuburaya', 0x95: 'Varie',
  0x96: 'Yonezawa/S\'pal', 0x97: 'Kaneko', 0x99: 'Arc', 0x9a: 'Nihon Bussan',
  0x9b: 'Tecmo', 0x9c: 'Imagineer', 0x9d: 'Banpresto', 0x9f: 'Nova',
  0xa1: 'Hori Electric', 0xa2: 'Bandai', 0xa4: 'Konami', 0xa6: 'Kawada',
  0xa7: 'Takara', 0xa9: 'Technos Japan', 0xaa: 'Broderbund', 0xac: 'Toei Animation',
  0xad: 'Toho', 0xaf: 'Namco', 0xb0: 'acclaim', 0xb1: 'ASCII or Nexsoft',
  0xb2: 'Bandai', 0xb4: 'Enix', 0xb6: 'HAL', 0xb7: 'SNK',
  0xb9: 'Pony Canyon', 0xba: 'Culture Brain', 0xbb: 'Sunsoft', 0xbd: 'Sony Imagesoft',
  0xbf: 'Sammy', 0xc0: 'Taito', 0xc2: 'Kemco', 0xc3: 'Square',
  0xc4: 'Tokuma Shoten', 0xc5: 'Data East', 0xc6: 'Tonkin House', 0xc8: 'Koei',
  0xc9: 'UFL', 0xca: 'Ultra', 0xcb: 'Vap', 0xcc: 'Use',
  0xcd: 'Meldac', 0xce: 'Pony Canyon', 0xcf: 'Angel', 0xd0: 'Taito',
  0xd1: 'Sofel', 0xd2: 'Quest', 0xd3: 'Sigma Enterprises', 0xd4: 'Ask Kodansha',
  0xd6: 'Naxat Soft', 0xd7: 'Copya System', 0xd9: 'Banpresto', 0xda: 'Tomy',
  0xdb: 'LJN', 0xdd: 'NCS', 0xde: 'Human', 0xdf: 'Altron',
  0xe0: 'Jaleco', 0xe1: 'Towachiki', 0xe2: 'Uutaka', 0xe3: 'Varie',
  0xe5: 'Epoch', 0xe7: 'Athena', 0xe8: 'Asmik', 0xe9: 'Natsume',
  0xea: 'King Records', 0xeb: 'Atlus', 0xec: 'Epic/Sony Records', 0xee: 'IGS',
  0xf0: 'A Wave', 0xf3: 'Extreme Entertainment', 0xff: 'LJN',
};

export function parseROMHeader(rom) {
  const titleBytes = rom.subarray(0x134, 0x144);
  let title = '';
  let cgb = rom[0x143];
  let end = 0x144;
  if (cgb === 0xc0 || cgb === 0x80) end = 0x13f; // CGB 卡带标题只有 15 字节
  for (let i = 0x134; i < end; i++) {
    const c = rom[i];
    if (c === 0) break;
    if (c >= 0x20 && c < 0x7f) title += String.fromCharCode(c);
  }
  title = title.trim();

  const cartType = rom[0x147];
  const romSizeCode = rom[0x148];
  const ramSizeCode = rom[0x149];
  const romBanks = Math.max(2, 2 << (romSizeCode & 0xff));
  const romSize = romBanks * 0x4000;
  const ramSize = RAM_SIZES[ramSizeCode] || 0;

  // 头部校验和
  let hsum = 0;
  for (let i = 0x134; i < 0x14d; i++) hsum = (hsum - rom[i] - 1) & 0xff;
  // 全局校验和
  let gsum = 0;
  for (let i = 0; i < rom.length; i++) {
    if (i === 0x14e || i === 0x14f) continue;
    gsum = (gsum + rom[i]) & 0xffff;
  }
  const storedGsum = (rom[0x14e] << 8) | rom[0x14f];

  // Nintendo Logo 校验
  const LOGO = [
    0xce, 0xed, 0x66, 0x66, 0xcc, 0x0d, 0x00, 0x0b, 0x03, 0x73, 0x00, 0x83, 0x00, 0x0c, 0x00, 0x0d,
    0x00, 0x08, 0x11, 0x1f, 0x88, 0x89, 0x00, 0x0e, 0xdc, 0xcc, 0x6e, 0xe6, 0xdd, 0xdd, 0xd9, 0x99,
    0xbb, 0xbb, 0x67, 0x63, 0x6e, 0x0e, 0xec, 0xcc, 0xdd, 0xdc, 0x99, 0x9f, 0xbb, 0xb9, 0x33, 0x3e,
  ];
  let logoOk = true;
  for (let i = 0; i < 48; i++) {
    if (rom[0x104 + i] !== LOGO[i]) { logoOk = false; break; }
  }

  // 新厂商代号（4 字符，如 "01"）
  let licensee = '';
  if (rom[0x14b] === 0x33) {
    for (let i = 0x144; i < 0x146; i++) licensee += String.fromCharCode(rom[i]);
  } else {
    licensee = LICENSEE_NAMES[rom[0x14b]] || ('0x' + rom[0x14b].toString(16).toUpperCase());
  }

  return {
    title: title || '未知卡带',
    cgbSupport: cgb === 0x80 ? 'CGB 兼容' : (cgb === 0xc0 ? 'CGB 专用' : 'DMG (黑白)'),
    cartType,
    mbcName: MBC_NAMES[cartType] || ('未知 0x' + cartType.toString(16).toUpperCase()),
    romBanks,
    romSize,
    ramSize,
    hasBattery: [0x03, 0x06, 0x09, 0x0d, 0x0f, 0x10, 0x13, 0x1b, 0x1e].includes(cartType),
    hasRTC: [0x0f, 0x10].includes(cartType),
    headerChecksumOk: hsum === rom[0x14d],
    globalChecksum: gsum,
    storedGlobalChecksum: storedGsum,
    logoOk,
    licensee,
    destination: rom[0x14a] === 0 ? '日本' : '海外',
    version: rom[0x14c],
  };
}

export class Cartridge {
  constructor(rom) {
    this.rom = rom;
    this.info = parseROMHeader(rom);
    this.type = this.info.cartType;
    this.romBankCount = Math.max(1, Math.floor(rom.length / 0x4000));
    this.ramBankCount = this.info.ramSize > 0 ? Math.max(1, Math.floor(this.info.ramSize / 0x2000)) : 0;
    this.ram = new Uint8Array(this.info.ramSize);
    this.mbc2Ram = new Uint8Array(0x200);

    // MBC1
    this.romBank = 1;
    this.ramBank = 0;
    this.ramEnabled = false;
    this.mbc1Mode = 0;
    this.bank1 = 1;
    this.bank2 = 0;

    // MBC3 RTC
    this.rtcReg = 0;
    this.rtcLatched = false;
    this.rtcLatch = [0, 0, 0, 0, 0];
    this.rtcBase = Date.now();
    this.rtcHalt = false;
  }

  get ramDirty() { return this._ramDirty; }
  set ramDirty(v) { this._ramDirty = v; }

  // ---- ROM 区域写（MBC 控制寄存器） ----
  write(addr, v) {
    switch (this.type) {
      case 0x00: case 0x08: case 0x09:
        break; // 无分页

      case 0x01: case 0x02: case 0x03: { // MBC1
        if (addr < 0x2000) {
          this.ramEnabled = (v & 0x0f) === 0x0a;
        } else if (addr < 0x4000) {
          this.bank1 = v & 0x1f;
          if (this.bank1 === 0) this.bank1 = 1;
        } else if (addr < 0x6000) {
          this.bank2 = v & 0x03;
        } else {
          this.mbc1Mode = v & 0x01;
        }
        break;
      }

      case 0x05: case 0x06: { // MBC2
        if (addr < 0x4000) {
          if ((addr & 0x0100) === 0) {
            this.ramEnabled = (v & 0x0f) === 0x0a;
          } else {
            const b = v & 0x0f;
            if (b !== 0) this.romBank = b;
          }
        }
        break;
      }

      case 0x0f: case 0x10: case 0x11: case 0x12: case 0x13: { // MBC3
        if (addr < 0x2000) {
          this.ramEnabled = (v & 0x0f) === 0x0a;
        } else if (addr < 0x4000) {
          const b = v & 0x7f;
          this.romBank = b === 0 ? 1 : b;
        } else if (addr < 0x6000) {
          if (v <= 0x03) this.ramBank = v;
          else if (v >= 0x08 && v <= 0x0c) this.rtcReg = v;
        } else {
          // 时钟锁存：先写 0 再写 1
          if (v === 0x00) this.rtcLatchPending = true;
          else if (v === 0x01 && this.rtcLatchPending) {
            this.rtcLatched = true;
            this.doLatchRTC();
            this.rtcLatchPending = false;
          }
        }
        break;
      }

      case 0x19: case 0x1a: case 0x1b: case 0x1c: case 0x1d: case 0x1e: { // MBC5
        if (addr < 0x2000) {
          this.ramEnabled = (v & 0x0f) === 0x0a;
        } else if (addr < 0x3000) {
          this.romBank = (this.romBank & 0x100) | v;
        } else if (addr < 0x4000) {
          this.romBank = (this.romBank & 0xff) | ((v & 0x01) << 8);
        } else if (addr < 0x6000) {
          this.ramBank = v & 0x0f;
        }
        break;
      }

      default:
        break;
    }
  }

  // ---- ROM 读 ----
  readROM(addr) {
    let bank = 0;
    if (addr < 0x4000) {
      switch (this.type) {
        case 0x01: case 0x02: case 0x03:
          bank = this.mbc1Mode === 1 ? (this.bank2 << 5) : 0;
          break;
        default:
          bank = 0;
      }
      if (bank === 0) {
        return this.rom[addr] !== undefined ? this.rom[addr] : 0xff;
      }
    } else {
      switch (this.type) {
        case 0x01: case 0x02: case 0x03: {
          bank = this.bank1 | (this.bank2 << 5);
          break;
        }
        case 0x05: case 0x06:
          bank = this.romBank;
          break;
        case 0x0f: case 0x10: case 0x11: case 0x12: case 0x13:
          bank = this.romBank;
          break;
        case 0x19: case 0x1a: case 0x1b: case 0x1c: case 0x1d: case 0x1e:
          bank = this.romBank;
          break;
        default:
          bank = 1;
      }
    }
    const mask = this.romBankCount - 1;
    bank &= Math.max(1, mask);
    if (bank >= this.romBankCount) bank = bank % this.romBankCount;
    const off = bank * 0x4000 + (addr & 0x3fff);
    return off < this.rom.length ? this.rom[off] : 0xff;
  }

  // ---- 外部 RAM 读 ----
  readRAM(addr) {
    if (this.info.ramSize === 0) {
      // MBC2 内置 512 半字节 RAM
      if (this.type === 0x05 || this.type === 0x06) {
        if (!this.ramEnabled) return 0xff;
        return this.mbc2Ram[addr & 0x1ff] | 0xf0;
      }
      return 0xff;
    }
    if (!this.ramEnabled) return 0xff;
    if (this.info.hasRTC && this.rtcReg >= 0x08) {
      return this.readRTC();
    }
    let offset;
    if (this.type === 0x01 || this.type === 0x02 || this.type === 0x03) {
      offset = (this.mbc1Mode === 1 ? this.bank2 : 0) * 0x2000 + (addr & 0x1fff);
    } else {
      offset = this.ramBank * 0x2000 + (addr & 0x1fff);
    }
    if (offset >= this.ram.length) return 0xff;
    return this.ram[offset];
  }

  writeRAM(addr, v) {
    if (this.info.ramSize === 0) {
      if (this.type === 0x05 || this.type === 0x06) {
        if (!this.mbc2Ram) this.mbc2Ram = new Uint8Array(0x200);
        if (this.ramEnabled) this.mbc2Ram[addr & 0x1ff] = v & 0x0f;
      }
      return;
    }
    if (!this.ramEnabled) return;
    if (this.info.hasRTC && this.rtcReg >= 0x08) {
      this.writeRTC(v);
      return;
    }
    let offset;
    if (this.type === 0x01 || this.type === 0x02 || this.type === 0x03) {
      offset = (this.mbc1Mode === 1 ? this.bank2 : 0) * 0x2000 + (addr & 0x1fff);
    } else {
      offset = this.ramBank * 0x2000 + (addr & 0x1fff);
    }
    if (offset < this.ram.length) {
      this.ram[offset] = v;
      this._ramDirty = true;
    }
  }

  // ---- RTC (MBC3) ----
  doLatchRTC() {
    const total = Math.floor((Date.now() - this.rtcBase) / 1000);
    this.rtcLatch[0] = total % 60;
    this.rtcLatch[1] = Math.floor(total / 60) % 60;
    this.rtcLatch[2] = Math.floor(total / 3600) % 24;
    const days = Math.floor(total / 86400);
    this.rtcLatch[3] = days & 0xff;
    this.rtcLatch[4] = ((days >> 8) & 0x01) | (this.rtcHalt ? 0x40 : 0) | ((days > 511) ? 0x80 : 0);
  }

  readRTC() {
    if (!this.rtcLatched) this.doLatchRTC();
    return this.rtcLatch[this.rtcReg - 0x08] || 0;
  }

  writeRTC(v) {
    // 简易实现：写入即更新基准时间
    const idx = this.rtcReg - 0x08;
    if (idx >= 0 && idx < 5) {
      this.rtcLatch[idx] = v;
    }
  }

  loadRAM(data) {
    if (data && this.ram.length) {
      this.ram.set(data.subarray(0, Math.min(data.length, this.ram.length)));
    }
  }
}
