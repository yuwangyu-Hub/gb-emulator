// Game Boy PPU（图像处理器）
// LCD 分辨率 160x144，每帧 70224 个周期

export const SCREEN_W = 160;
export const SCREEN_H = 144;

// 经典 DMG 绿色调色板（由浅到深）
export const PALETTES = {
  dmg: [0xff9bbc0f, 0xff8bac0f, 0xff306230, 0xff0f380f],
  green: [0xffc4d8a0, 0xff8fb87a, 0xff4d7a4a, 0xff1f3d2b],
  gray: [0xfff8f8f8, 0xffb8b8b8, 0xff707070, 0xff202020],
  berry: [0xfff2e8dc, 0xffd98cb3, 0xff8c4a7a, 0xff3a1a44],
};

export class PPU {
  constructor(gb) {
    this.gb = gb;
    this.vram = new Uint8Array(0x2000);
    this.oam = new Uint8Array(0xa0);
    // RGBA 帧缓冲
    this.framebuffer = new Uint8Array(SCREEN_W * SCREEN_H * 4);
    this.reset();
  }

  reset() {
    this.vram.fill(0);
    this.oam.fill(0);
    this.lcdc = 0x91;
    this.stat = 0x85;
    this.scy = 0;
    this.scx = 0;
    this.ly = 0;
    this.lyc = 0;
    this.bgp = 0xfc;
    this.obp0 = 0xff;
    this.obp1 = 0xff;
    this.wy = 0;
    this.wx = 0;
    this.mode = 2;
    this.modeClock = 0;
    this.mode3Len = 172;
    this.windowLine = 0;
    this.frameReady = false;
    this.prevStatFlag = false;
    this.setPalette('dmg');
    this.framebuffer.fill(0);
    for (let i = 3; i < this.framebuffer.length; i += 4) this.framebuffer[i] = 0xff;
    this.clearScreen(0);
    this.enabled = true;
  }

  setPalette(name) {
    const p = PALETTES[name] || PALETTES.dmg;
    this.palette = new Uint32Array([
      p[0], p[1], p[2], p[3],
    ]);
    // 转成 RGBA 分量，方便写入帧缓冲
    this.rgba = [
      [(p[0] >> 16) & 0xff, (p[0] >> 8) & 0xff, p[0] & 0xff],
      [(p[1] >> 16) & 0xff, (p[1] >> 8) & 0xff, p[1] & 0xff],
      [(p[2] >> 16) & 0xff, (p[2] >> 8) & 0xff, p[2] & 0xff],
      [(p[3] >> 16) & 0xff, (p[3] >> 8) & 0xff, p[3] & 0xff],
    ];
  }

  clearScreen(colorIdx) {
    const c = this.rgba[colorIdx];
    for (let i = 0; i < this.framebuffer.length; i += 4) {
      this.framebuffer[i] = c[0];
      this.framebuffer[i + 1] = c[1];
      this.framebuffer[i + 2] = c[2];
      this.framebuffer[i + 3] = 0xff;
    }
  }

  readReg(addr) {
    switch (addr) {
      case 0xff40: return this.lcdc;
      case 0xff41: {
        let v = this.stat & 0xf8;
        if (this.enabled) {
          v |= this.mode & 0x03;
          if (this.ly === this.lyc) v |= 0x04;
        }
        return v | 0x80;
      }
      case 0xff42: return this.scy;
      case 0xff43: return this.scx;
      case 0xff44: return this.enabled ? this.ly : 0;
      case 0xff45: return this.lyc;
      case 0xff47: return this.bgp;
      case 0xff48: return this.obp0;
      case 0xff49: return this.obp1;
      case 0xff4a: return this.wy;
      case 0xff4b: return this.wx;
      default: return 0xff;
    }
  }

  writeReg(addr, v) {
    switch (addr) {
      case 0xff40: {
        const wasEnabled = this.enabled;
        this.lcdc = v;
        const nowEnabled = (v & 0x80) !== 0;
        if (nowEnabled && !wasEnabled) {
          this.enabled = true;
          this.modeClock = 0;
          this.mode = 2;
          this.ly = 0;
        } else if (!nowEnabled && wasEnabled) {
          this.enabled = false;
          this.ly = 0;
          this.mode = 0;
          this.modeClock = 0;
          this.clearScreen(0);
          this.frameReady = true;
        }
        break;
      }
      case 0xff41: {
        // 低 3 位只读（模式 + LYC 标志），高 5 位为中断选择
        this.stat = v & 0xf8;
        break;
      }
      case 0xff42: this.scy = v; break;
      case 0xff43: this.scx = v; break;
      case 0xff44: break; // LY 只读
      case 0xff45: this.lyc = v; break;
      case 0xff47: this.bgp = v; break;
      case 0xff48: this.obp0 = v; break;
      case 0xff49: this.obp1 = v; break;
      case 0xff4a: this.wy = v; break;
      case 0xff4b: this.wx = v; break;
      default: break;
    }
    if (this.enabled) this.updateStatInt();
  }

  updateStatInt() {
    let flag = false;
    // LYC == LY
    if ((this.stat & 0x40) && this.ly === this.lyc) flag = true;
    // 模式中断: mode 0 -> bit3, 1 -> bit4, 2 -> bit5
    let sel = 0;
    if (this.mode === 0) sel = 0x08;
    else if (this.mode === 1) sel = 0x10;
    else if (this.mode === 2) sel = 0x20;
    if ((this.stat & sel) && sel) flag = true;
    if (flag && !this.prevStatFlag) {
      this.gb.requestInterrupt(1);
    }
    this.prevStatFlag = flag;
  }

  // 推进 PPU 状态机
  step(cycles) {
    if (!this.enabled) return;
    this.modeClock += cycles;
    switch (this.mode) {
      case 2: // OAM 搜索 80 周期
        if (this.modeClock >= 80) {
          this.modeClock -= 80;
          this.mode = 3;
          this.mode3Len = 168 + this.countSpritesOnLine() * 4;
        }
        break;
      case 3: // 数据传输
        if (this.modeClock >= this.mode3Len) {
          this.modeClock -= this.mode3Len;
          this.mode = 0;
          this.renderScanline();
        }
        break;
      case 0: // HBlank 剩余周期
        {
          const hblank = 456 - 80 - this.mode3Len;
          if (this.modeClock >= hblank) {
            this.modeClock -= hblank;
            this.ly++;
            if (this.ly === 144) {
              this.mode = 1;
              this.gb.requestInterrupt(0); // VBlank
              this.frameReady = true;
              this.windowLine = 0;
              if (this.onFrame) this.onFrame();
            } else {
              this.mode = 2;
            }
          }
        }
        break;
      case 1: // VBlank，每 456 周期推进一行
        if (this.modeClock >= 456) {
          this.modeClock -= 456;
          this.ly++;
          if (this.ly > 153) {
            this.ly = 0;
            this.mode = 2;
          }
        }
        break;
      default: break;
    }
    this.updateStatInt();
  }

  countSpritesOnLine() {
    const h = (this.lcdc & 0x04) ? 16 : 8;
    let count = 0;
    for (let i = 0; i < 40; i++) {
      const y = this.oam[i * 4];
      if (this.ly + 16 >= y && this.ly + 16 < y + h) count++;
      if (count >= 10) break;
    }
    return count > 10 ? 10 : count;
  }

  bgColorIndex(idx) {
    // 调色板寄存器：bit0-1 对应颜色 0
    return (this.bgp >> (idx * 2)) & 0x03;
  }

  objColorIndex(pal, idx) {
    const reg = (pal === 1) ? this.obp1 : this.obp0;
    if (idx === 0) return -1; // 精灵颜色 0 透明
    return (reg >> (idx * 2)) & 0x03;
  }

  putPixel(x, y, colorIdx) {
    const c = this.rgba[colorIdx & 3];
    const o = (y * SCREEN_W + x) * 4;
    this.framebuffer[o] = c[0];
    this.framebuffer[o + 1] = c[1];
    this.framebuffer[o + 2] = c[2];
    this.framebuffer[o + 3] = 0xff;
  }

  renderScanline() {
    const y = this.ly;
    if (y >= SCREEN_H) return;
    const lcdc = this.lcdc;
    const bgLine = new Uint8Array(SCREEN_W); // 背景颜色索引（用于精灵优先级判断）

    if (!(lcdc & 0x01)) {
      // BG 关闭：整行为颜色 0
      for (let x = 0; x < SCREEN_W; x++) {
        bgLine[x] = 0;
        this.putPixel(x, y, 0);
      }
    } else {
      const mapBase = (lcdc & 0x08) ? 0x1c00 : 0x1800;
      const signed = (lcdc & 0x10) === 0;
      const rowY = (y + this.scy) & 0xff;
      const tileRow = rowY >> 3;
      const tileY = rowY & 7;

      for (let x = 0; x < SCREEN_W; x++) {
        const px = (x + this.scx) & 0xff;
        const tileCol = px >> 3;
        const tileX = px & 7;
        const mapIdx = mapBase + tileRow * 32 + tileCol;
        let tileNo = this.vram[mapIdx];
        let addr;
        if (signed) {
          const st = tileNo & 0x80 ? tileNo - 256 : tileNo;
          addr = (0x1000 + st * 16) & 0x1fff;
        } else {
          addr = tileNo * 16;
        }
        const lo = this.vram[addr + tileY * 2];
        const hi = this.vram[addr + tileY * 2 + 1];
        const bit = 7 - tileX;
        const colorIdx = ((lo >> bit) & 1) | (((hi >> bit) & 1) << 1);
        bgLine[x] = colorIdx;
        this.putPixel(x, y, this.bgColorIndex(colorIdx));
      }
    }

    // 窗口
    if ((lcdc & 0x20) && this.wy <= y) {
      const winX = this.wx - 7;
      if (this.wx <= 166) {
        const mapBase = (lcdc & 0x40) ? 0x1c00 : 0x1800;
        const signed = (lcdc & 0x10) === 0;
        const wY = this.windowLine;
        const tileRow = wY >> 3;
        const tileY = wY & 7;
        for (let x = 0; x < SCREEN_W; x++) {
          if (x < winX) continue;
          const px = x - winX;
          const tileCol = px >> 3;
          const tileX = px & 7;
          let tileNo = this.vram[mapBase + tileRow * 32 + tileCol];
          let addr;
          if (signed) {
            const st = tileNo & 0x80 ? tileNo - 256 : tileNo;
            addr = (0x1000 + st * 16) & 0x1fff;
          } else {
            addr = tileNo * 16;
          }
          const lo = this.vram[addr + tileY * 2];
          const hi = this.vram[addr + tileY * 2 + 1];
          const bit = 7 - tileX;
          const colorIdx = ((lo >> bit) & 1) | (((hi >> bit) & 1) << 1);
          bgLine[x] = colorIdx;
          this.putPixel(x, y, this.bgColorIndex(colorIdx));
        }
      }
    }
    if ((lcdc & 0x20) && this.wy <= y) this.windowLine++;

    // 精灵
    if (lcdc & 0x02) {
      this.renderSprites(y, bgLine);
    }
  }

  renderSprites(y, bgLine) {
    const lcdc = this.lcdc;
    const h = (lcdc & 0x04) ? 16 : 8;
    const candidates = [];
    for (let i = 0; i < 40 && candidates.length < 10; i++) {
      const oy = this.oam[i * 4];
      if (this.ly + 16 >= oy && this.ly + 16 < oy + h) {
        candidates.push({ i, x: this.oam[i * 4 + 1], tile: this.oam[i * 4 + 2], attr: this.oam[i * 4 + 3] });
      }
    }
    // 优先级：x 小者优先，x 相同则 OAM 索引小者优先
    candidates.sort((p, q) => (p.x - q.x) || (p.i - q.i));

    // 反向绘制：优先级高的最后绘制（覆盖在上面）
    for (let c = candidates.length - 1; c >= 0; c--) {
      const s = candidates[c];
      const sx = s.x - 8;
      let py = y + 16 - this.oam[s.i * 4];
      let tileLine = py;
      if (s.attr & 0x40) tileLine = h - 1 - py; // Y 翻转
      let tileIdx = h === 16 ? (s.tile & 0xfe) : s.tile;
      if (tileLine >= 8) {
        tileIdx |= 1;
        tileLine -= 8;
      }
      const addr = tileIdx * 16 + tileLine * 2;
      const lo = this.oamReadVRAM(addr);
      const hi = this.oamReadVRAM(addr + 1);
      const palIdx = (s.attr & 0x10) ? 1 : 0;

      for (let tx = 0; tx < 8; tx++) {
        const px = sx + tx;
        if (px < 0 || px >= SCREEN_W) continue;
        const bit = (s.attr & 0x20) ? tx : (7 - tx); // X 翻转
        const colorIdx = ((lo >> bit) & 1) | (((hi >> bit) & 1) << 1);
        if (colorIdx === 0) continue; // 透明
        // BG 优先（attr bit7）
        if ((s.attr & 0x80) && bgLine[px] !== 0) continue;
        const c2 = this.objColorIndex(palIdx, colorIdx);
        if (c2 < 0) continue;
        this.putPixel(px, y, c2);
      }
    }
  }

  oamReadVRAM(addr) {
    return this.vram[addr & 0x1fff];
  }

  serialize() {
    return {
      vram: Array.from(this.vram), oam: Array.from(this.oam),
      lcdc: this.lcdc, stat: this.stat, scy: this.scy, scx: this.scx,
      ly: this.ly, lyc: this.lyc, bgp: this.bgp, obp0: this.obp0, obp1: this.obp1,
      wy: this.wy, wx: this.wx, mode: this.mode, modeClock: this.modeClock,
      windowLine: this.windowLine, enabled: this.enabled,
    };
  }

  deserialize(s) {
    this.vram.set(s.vram); this.oam.set(s.oam);
    this.lcdc = s.lcdc; this.stat = s.stat; this.scy = s.scy; this.scx = s.scx;
    this.ly = s.ly; this.lyc = s.lyc; this.bgp = s.bgp; this.obp0 = s.obp0; this.obp1 = s.obp1;
    this.wy = s.wy; this.wx = s.wx; this.mode = s.mode; this.modeClock = s.modeClock;
    this.windowLine = s.windowLine; this.enabled = s.enabled;
  }
}
