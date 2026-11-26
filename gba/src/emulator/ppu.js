// GBA PPU：mode0-5、文本 BG、仿射 BG、精灵、窗口、混色，逐扫描线渲染到 240x160 RGB555

const W = 240, H = 160;

// BG 尺寸表 [size][0]=宽 [1]=高
const TEXT_SIZE = [[256, 256], [512, 256], [256, 512], [512, 512]];
const AFF_SIZE = [[128, 128], [256, 256], [512, 512], [1024, 1024]];
// 精灵尺寸 [shape][size] = [w,h]
const OBJ_SIZE = [
  [[8, 8], [16, 16], [32, 32], [64, 64]],
  [[16, 8], [32, 8], [32, 16], [64, 32]],
  [[8, 16], [8, 32], [16, 32], [32, 64]],
];

export class PPU {
  constructor(mmu) {
    this.m = mmu;
    this.frame = new Uint16Array(W * H);      // RGB555
    this.bgBuf = [];
    for (let i = 0; i < 4; i++) this.bgBuf.push(new Uint16Array(W));
    this.objBuf = new Uint16Array(W);
    this.objPrioBuf = new Uint8Array(W);
    this.bottomBuf = new Uint16Array(W);
    this.frameCycles = 0;
    this.refX = [0, 0];    // BG2/BG3 内部参考点
    this.refY = [0, 0];
    this.spriteCycles = 0;
  }

  reg(a) { return this.m.io[a] | (this.m.io[(a + 1) & 0x3ff] << 8); }
  reg32(a) {
    return (this.m.io[a] | (this.m.io[(a + 1) & 0x3ff] << 8) |
      (this.m.io[(a + 2) & 0x3ff] << 16) | (this.m.io[(a + 3) & 0x3ff] << 24)) >>> 0;
  }
  get dispcnt() { return this.reg(0x00); }
  get mode() { return this.dispcnt & 7; }

  // 帧开始时锁定仿射参考点
  latchRefs() {
    for (let i = 0; i < 2; i++) {
      const base = i === 0 ? 0x28 : 0x38;
      let x = this.reg32(base);
      let y = this.reg32(base + 4);
      if (x & 0x08000000) x |= 0xf0000000;
      if (y & 0x08000000) y |= 0xf0000000;
      this.refX[i] = x | 0;
      this.refY[i] = y | 0;
    }
  }

  // ---------- 主入口 ----------
  renderLine(line) {
    const dcnt = this.dispcnt;
    if (dcnt & 0x80) { // 强制空白：整行白色
      const off = line * W;
      this.frame.fill(0x7fff, off, off + W);
      return;
    }
    const mode = dcnt & 7;
    for (let i = 0; i < 4; i++) this.bgBuf[i].fill(0);
    this.objBuf.fill(0);
    this.objPrioBuf.fill(0xff);
    this.bottomBuf.fill(0);

    if (mode >= 3) {
      this.drawBitmap(line, mode, dcnt);
    } else {
      if (mode === 0 || mode === 1) {
        if (dcnt & 0x100) this.drawText(line, 0);
        if (dcnt & 0x200) this.drawText(line, 1);
        if (dcnt & 0x400) {
          if (mode === 1) this.drawAffine(line, 2);
          else this.drawText(line, 2);
        }
        if (dcnt & 0x800) this.drawText(line, 3);
      } else { // mode 2
        if (dcnt & 0x400) this.drawAffine(line, 2);
        if (dcnt & 0x800) this.drawAffine(line, 3);
      }
    }
    if (dcnt & 0x1000) this.drawSprites(line);

    this.composite(line, dcnt);
  }

  // ---------- 位图模式 ----------
  drawBitmap(line, mode, dcnt) {
    const off = line * W;
    const page = (dcnt & 0x10) ? 0xa000 : 0;
    if (mode === 3) {
      for (let x = 0; x < W; x++) {
        const a = page + (line * W + x) * 2;
        this.bgBuf[2][x] = (this.m.vram[a] | (this.m.vram[a + 1] << 8)) | 0x8000;
      }
    } else if (mode === 4) {
      for (let x = 0; x < W; x++) {
        const idx = this.m.vram[page + line * W + x];
        if (idx === 0) continue;
        this.bgBuf[2][x] = (this.m.pal[idx * 2] | (this.m.pal[idx * 2 + 1] << 8)) | 0x8000;
      }
    } else { // mode5：160x128
      if (line >= 128) return;
      for (let x = 0; x < W; x++) {
        if (x >= 160) break;
        const a = page + (line * 160 + x) * 2;
        this.bgBuf[2][x] = (this.m.vram[a] | (this.m.vram[a + 1] << 8)) | 0x8000;
      }
    }
  }

  // ---------- 文本 BG ----------
  drawText(line, bg) {
    const cnt = this.reg(0x08 + bg * 2);
    const [bw, bh] = TEXT_SIZE[(cnt >>> 14) & 3];
    const charBase = ((cnt >>> 2) & 3) * 0x4000;
    const screenBase = ((cnt >>> 8) & 0x1f) * 0x800;
    const bpp8 = (cnt >>> 7) & 1;
    const scrollX = this.reg(0x10 + bg * 4);
    const scrollY = this.reg(0x12 + bg * 4);
    const y = (line + scrollY) & (bh - 1);
    const rowBase = screenBase + ((y >>> 3) & 31) * (bw >>> 2) * 2;
    const buf = this.bgBuf[bg];
    const wrap = (cnt >>> 13) & 1;

    for (let x = 0; x < W; x++) {
      const sx = (x + scrollX) & (bw - 1);
      const col = (sx >>> 3) & 31;
      const seOff = rowBase + col * 2;
      let se = this.m.vram[seOff] | (this.m.vram[seOff + 1] << 8);
      const tile = se & 0x3ff;
      const hflip = (se >>> 10) & 1;
      const vflip = (se >>> 11) & 1;
      const palNo = (se >>> 12) & 0xf;
      const tx = sx & 7;
      const ty = y & 7;
      const px = hflip ? 7 - tx : tx;
      const py = vflip ? 7 - ty : ty;
      let color = 0;
      if (bpp8) {
        const a = charBase + tile * 64 + py * 8 + px;
        const idx = this.m.vram[a];
        if (idx === 0) continue;
        color = this.m.pal[idx * 2] | (this.m.pal[idx * 2 + 1] << 8);
      } else {
        const a = charBase + tile * 32 + py * 4 + (px >>> 1);
        const byte = this.m.vram[a];
        const idx = (px & 1) ? (byte >>> 4) : (byte & 0xf);
        if (idx === 0) continue;
        color = this.m.pal[(palNo * 16 + idx) * 2] | (this.m.pal[(palNo * 16 + idx) * 2 + 1] << 8);
      }
      buf[x] = color | 0x8000;   // 最高位 = 不透明标记
    }
  }

  // ---------- 仿射 BG ----------
  drawAffine(line, bg) {
    const idx = bg - 2;
    const cnt = this.reg(0x08 + bg * 2);
    const [bw, bh] = AFF_SIZE[(cnt >>> 14) & 3];
    const charBase = ((cnt >>> 2) & 3) * 0x4000;
    const screenBase = ((cnt >>> 8) & 0x1f) * 0x800;
    const wrap = (cnt >>> 13) & 1;
    const pa = this.s16(this.reg(0x20 + idx * 0x10));
    const pb = this.s16(this.reg(0x22 + idx * 0x10));
    const pc = this.s16(this.reg(0x24 + idx * 0x10));
    const pd = this.s16(this.reg(0x26 + idx * 0x10));
    let x0 = this.refX[idx] + pb * line;
    let y0 = this.refY[idx] + pd * line;
    const buf = this.bgBuf[bg];
    for (let x = 0; x < W; x++) {
      const tx = (x0 >> 8) & (bw - 1);
      const ty = (y0 >> 8) & (bh - 1);
      if (!wrap && ((x0 >> 8) < 0 || (x0 >> 8) >= bw || (y0 >> 8) < 0 || (y0 >> 8) >= bh)) {
        x0 += pa; y0 += pc;
        continue;
      }
      const tile = this.m.vram[screenBase + (ty >>> 3) * (bw >>> 3) + (tx >>> 3)];
      const a = charBase + tile * 64 + (ty & 7) * 8 + (tx & 7);
      const c = this.m.vram[a];
      if (c !== 0) buf[x] = (this.m.pal[c * 2] | (this.m.pal[c * 2 + 1] << 8)) | 0x8000;
      x0 += pa; y0 += pc;
    }
  }

  s16(v) { return (v & 0x8000) ? (v | 0xffff0000) : v; }

  // ---------- 精灵 ----------
  drawSprites(line) {
    const dcnt = this.dispcnt;
    const oneDim = (dcnt >>> 6) & 1;
    const vramBase = 0x10000;
    // 按优先级从低到高绘制（高优先级覆盖）
    for (let prio = 3; prio >= 0; prio--) {
      for (let i = 0; i < 128; i++) {
        const o = i * 8;
        const attr0 = this.m.oam[o] | (this.m.oam[o + 1] << 8);
        const attr1 = this.m.oam[o + 2] | (this.m.oam[o + 3] << 8);
        const attr2 = this.m.oam[o + 4] | (this.m.oam[o + 5] << 8);
        const objMode = (attr0 >>> 8) & 3;
        if (objMode === 2) continue;                     // 隐藏
        const pr = (attr2 >>> 10) & 3;
        if (pr !== prio) continue;
        const shape = (attr0 >>> 14) & 3;
        const size = (attr1 >>> 14) & 3;
        const [w, h] = OBJ_SIZE[shape][size];
        let y = attr0 & 0xff;
        if (y >= 160 && y < 256) y -= 256;               // 顶部溢出
        if (objMode === 3) { /* 双倍尺寸 affine */ }
        if (line < y || line >= y + h) continue;
        let x = attr1 & 0x1ff;
        if (x >= 240) x -= 512;
        const bpp8 = (attr0 >>> 13) & 1;
        const tileId = attr2 & 0x3ff;
        const palNo = (attr2 >>> 12) & 0xf;
        const affine = objMode === 1 || objMode === 3;
        let hflip = (attr1 >>> 12) & 1;
        let vflip = (attr1 >>> 13) & 1;
        let pa = 256, pb = 0, pc = 0, pd = 256;
        if (affine) {
          const pIdx = ((attr1 >>> 9) & 0x1f) * 0x20;
          pa = this.s16(this.m.oam[pIdx + 0x06] | (this.m.oam[pIdx + 0x07] << 8));
          pb = this.s16(this.m.oam[pIdx + 0x0e] | (this.m.oam[pIdx + 0x0f] << 8));
          pc = this.s16(this.m.oam[pIdx + 0x16] | (this.m.oam[pIdx + 0x17] << 8));
          pd = this.s16(this.m.oam[pIdx + 0x1e] | (this.m.oam[pIdx + 0x1f] << 8));
        }
        const doubleSize = objMode === 3;
        const wSpan = doubleSize ? w * 2 : w;
        const hSpan = doubleSize ? h * 2 : h;
        const centerX = x + wSpan / 2;
        const centerY = y + hSpan / 2;
        const localY = line - y;
        for (let px = 0; px < wSpan; px++) {
          const sx = x + px;
          if (sx < 0 || sx >= W) continue;
          let tx, ty;
          if (affine) {
            const dx = px - wSpan / 2;
            const dy = localY - hSpan / 2;
            tx = ((pa * dx + pb * dy) >> 8) + (w >> 1);
            ty = ((pc * dx + pd * dy) >> 8) + (h >> 1);
            if (tx < 0 || tx >= w || ty < 0 || ty >= h) continue;
          } else {
            tx = hflip ? (w - 1 - px) : px;
            ty = vflip ? (h - 1 - localY) : localY;
          }
          const tileX = tx >>> 3, tileY = ty >>> 3;
          let tidx;
          if (oneDim) tidx = tileId + tileY * (w >>> 3) + tileX;
          else tidx = tileId + tileY * 32 + tileX;
          tidx &= 0x3ff;
          let color = 0;
          if (bpp8) {
            const a = vramBase + tidx * 64 + (ty & 7) * 8 + (tx & 7);
            const c = this.m.vram[a];
            if (c === 0) continue;
            color = this.m.pal[0x200 + c * 2] | (this.m.pal[0x200 + c * 2 + 1] << 8);
          } else {
            const a = vramBase + tidx * 32 + (ty & 7) * 4 + ((tx & 7) >>> 1);
            const byte = this.m.vram[a];
            const c = (tx & 1) ? (byte >>> 4) : (byte & 0xf);
            if (c === 0) continue;
            color = this.m.pal[0x200 + (palNo * 16 + c) * 2] | (this.m.pal[0x200 + (palNo * 16 + c) * 2 + 1] << 8);
          }
          if (this.objPrioBuf[sx] <= prio || this.objBuf[sx] === 0) {
            this.objBuf[sx] = color | 0x8000;
            this.objPrioBuf[sx] = prio;
          }
        }
      }
    }
  }

  // ---------- 合成 ----------
  composite(line, dcnt) {
    const off = line * W;
    const bldcnt = this.reg(0x50);
    const bldalpha = this.reg(0x52);
    const bldy = this.reg(0x54);
    const eva = bldalpha & 0x1f;
    const evb = (bldalpha >>> 8) & 0x1f;
    const backdrop = (this.m.pal[0] | (this.m.pal[1] << 8)) >>> 0;
    const useWindow = (dcnt >>> 13) & 3;
    let win0x1 = 0, win0x2 = 240, win0y1 = 0, win0y2 = 160;
    let win1x1 = 0, win1x2 = 240, win1y1 = 0, win1y2 = 160;
    if (useWindow) {
      const w0h = this.reg(0x40), w1h = this.reg(0x42);
      const w0v = this.reg(0x44), w1v = this.reg(0x46);
      win0x1 = w0h >>> 8; win0x2 = w0h & 0xff;
      win1x1 = w1h >>> 8; win1x2 = w1h & 0xff;
      win0y1 = w0v >>> 8; win0y2 = w0v & 0xff;
      win1y1 = w1v >>> 8; win1y2 = w1v & 0xff;
      if (win0x2 < win0x1 || win0x2 > 240) win0x2 = 240;
      if (win1x2 < win1x1 || win1x2 > 240) win1x2 = 240;
    }
    const winin = this.reg(0x48), winout = this.reg(0x4a);

    for (let x = 0; x < W; x++) {
      let top = 0, bottom = 0, topLayer = -1, bottomLayer = -1;
      // 收集该像素上所有不透明图层，按「优先级数值大→小、同优先级 BG 序号小→大、OBJ 最上」排序
      const items = [];
      for (let bg = 0; bg < 4; bg++) {
        if (((dcnt >>> (8 + bg)) & 1) === 0) continue;
        if (!this.bgBuf[bg][x]) continue;
        items.push({ prio: this.reg(0x08 + bg * 2) & 3, kind: bg, c: this.bgBuf[bg][x] & 0x7fff });
      }
      if ((dcnt & 0x1000) && this.objBuf[x]) {
        items.push({ prio: this.objPrioBuf[x] & 3, kind: 4, c: this.objBuf[x] & 0x7fff });
      }
      if (items.length > 1) {
        items.sort((a, b) => (b.prio - a.prio) || (a.kind - b.kind));
      }
      for (const it of items) {
        const lid = it.kind;
        // 窗口裁剪
        if (useWindow) {
          let inside = 0;
          if (line >= win0y1 && line < win0y2 && x >= win0x1 && x < win0x2) inside = 1;
          else if (line >= win1y1 && line < win1y2 && x >= win1x1 && x < win1x2) inside = 2;
          const mask = inside === 1 ? (winin & 0x3f) : inside === 2 ? ((winin >>> 8) & 0x3f) : (winout & 0x3f);
          if (!((mask >>> lid) & 1)) continue;
        }
        bottom = top; bottomLayer = topLayer;
        top = it.c; topLayer = lid;
      }
      let out;
      if (topLayer === -1) out = backdrop;
      else out = top;
      // 混色
      const mode = (bldcnt >>> 6) & 3;
      if (mode !== 0 && topLayer !== -1 && bottomLayer !== -1) {
        const first = bldcnt & 0x3f;
        const second = (bldcnt >>> 8) & 0x3f;
        const isFirst = (first >>> topLayer) & 1;
        const isSecond = (second >>> bottomLayer) & 1;
        if (mode === 1 && isFirst && isSecond) {
          const r = Math.min(31, ((top & 0x1f) * eva + (bottom & 0x1f) * evb) >> 4);
          const g = Math.min(31, (((top >>> 5) & 0x1f) * eva + ((bottom >>> 5) & 0x1f) * evb) >> 4);
          const b = Math.min(31, (((top >>> 10) & 0x1f) * eva + ((bottom >>> 10) & 0x1f) * evb) >> 4);
          out = (r | (g << 5) | (b << 10)) >>> 0;
        } else if (mode === 2 && isFirst) {
          const inc = bldy & 0x1f;
          const r = Math.min(31, (top & 0x1f) + (((31 - (top & 0x1f)) * inc) >> 4));
          const g = Math.min(31, ((top >>> 5) & 0x1f) + (((31 - ((top >>> 5) & 0x1f)) * inc) >> 4));
          const b = Math.min(31, ((top >>> 10) & 0x1f) + (((31 - ((top >>> 10) & 0x1f)) * inc) >> 4));
          out = (r | (g << 5) | (b << 10)) >>> 0;
        } else if (mode === 3 && isFirst) {
          const dec = bldy & 0x1f;
          const r = Math.max(0, (top & 0x1f) - (((top & 0x1f) * dec) >> 4));
          const g = Math.max(0, ((top >>> 5) & 0x1f) - ((((top >>> 5) & 0x1f) * dec) >> 4));
          const b = Math.max(0, ((top >>> 10) & 0x1f) - ((((top >>> 10) & 0x1f) * dec) >> 4));
          out = (r | (g << 5) | (b << 10)) >>> 0;
        }
      }
      this.frame[off + x] = out & 0xffff;
    }
  }

  toRGBA(out) {
    const o = out || new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      const c = this.frame[i];
      const r = (c & 0x1f) * 255 / 31;
      const g = ((c >>> 5) & 0x1f) * 255 / 31;
      const b = ((c >>> 10) & 0x1f) * 255 / 31;
      const p = i * 4;
      o[p] = r; o[p + 1] = g; o[p + 2] = b; o[p + 3] = 255;
    }
    return o;
  }
}
