// Canvas 生成纹理：卡带标签、机身上文字、LCD 等

import * as THREE from 'three';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// 由字符串生成稳定的 0..1 哈希
export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

const LABEL_SCHEMES = [
  { main: '#5b7fbe', accent: '#3d5a94', band: '#e8eef7' },
  { main: '#c9563e', accent: '#96382a', band: '#f9ece8' },
  { main: '#4e9a6f', accent: '#33714e', band: '#e9f5ee' },
  { main: '#8a63b8', accent: '#5f4185', band: '#f1ecf9' },
  { main: '#c99a2e', accent: '#96711d', band: '#faf4e4' },
  { main: '#3f8f9e', accent: '#2a6773', band: '#e8f4f7' },
  { main: '#b84d7e', accent: '#8c345d', band: '#f8ecf2' },
  { main: '#6d6f75', accent: '#4b4d52', band: '#eef0f2' },
];

// ---------- 卡带标签 ----------
export function makeLabelTexture(info) {
  const W = 512, H = 445;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  const scheme = LABEL_SCHEMES[Math.floor(hashStr(info.title) * LABEL_SCHEMES.length) % LABEL_SCHEMES.length];

  // 底
  ctx.fillStyle = '#e9e7e2';
  ctx.fillRect(0, 0, W, H);

  // 顶部条
  ctx.fillStyle = scheme.main;
  ctx.fillRect(0, 0, W, 74);
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.font = 'italic 700 40px Georgia, "Times New Roman", serif';
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText('Nintendo', 28, 38);
  ctx.font = '700 30px "Helvetica Neue", Arial, sans-serif';
  ctx.fillText('GAME BOY™', 230, 40);

  // 标题区
  ctx.fillStyle = scheme.band;
  roundRect(ctx, 24, 98, W - 48, 218, 14);
  ctx.fill();
  ctx.strokeStyle = scheme.accent;
  ctx.lineWidth = 3;
  roundRect(ctx, 24, 98, W - 48, 218, 14);
  ctx.stroke();

  // 标题文字（自动换行 + 缩放）
  const title = info.title.toUpperCase();
  ctx.fillStyle = '#26282e';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  let size = title.length > 14 ? 52 : 64;
  ctx.font = `800 ${size}px "Helvetica Neue", Arial, "PingFang SC", sans-serif`;
  const maxW = W - 100;
  let lines = wrapText(ctx, title, maxW);
  while (lines.length > 3 && size > 30) {
    size -= 6;
    ctx.font = `800 ${size}px "Helvetica Neue", Arial, "PingFang SC", sans-serif`;
    lines = wrapText(ctx, title, maxW);
  }
  const lh = size * 1.15;
  const startY = 98 + 109 - ((lines.length - 1) * lh) / 2;
  lines.forEach((ln, i) => ctx.fillText(ln, W / 2, startY + i * lh));

  // 彩色斜纹装饰带
  ctx.save();
  ctx.translate(24, 338);
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = i % 2 === 0 ? scheme.main : scheme.accent;
    ctx.beginPath();
    ctx.moveTo(i * 40, 0);
    ctx.lineTo(i * 40 + 28, 0);
    ctx.lineTo(i * 40 + 28 + 26, 44);
    ctx.lineTo(i * 40 + 26, 44);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // 信息行
  ctx.fillStyle = '#5a5c63';
  ctx.font = '600 22px "Helvetica Neue", Arial, "PingFang SC", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`${info.mbcName}`, 28, 412);
  ctx.textAlign = 'right';
  ctx.fillText(`${(info.romSize / 1024 / 1024).toFixed(info.romSize % 1048576 === 0 ? 0 : 1)}MB · ${info.romBanks} BANKS`, W - 28, 412);

  // 边框
  ctx.strokeStyle = '#c9c7c2';
  ctx.lineWidth = 2;
  ctx.strokeRect(3, 3, W - 6, H - 6);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// ---------- 用真实卡带封面生成标签 ----------
// 标签画布比例与卡带模型标签面一致：46 : 40
export function makeLabelTextureFromImage(img, info) {
  const W = 512, H = 445;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');

  ctx.fillStyle = '#0e0e10';
  ctx.fillRect(0, 0, W, H);

  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;

  // 背景：同图放大模糊，做无缝填充
  try {
    ctx.save();
    ctx.filter = 'blur(22px) saturate(1.25) brightness(0.75)';
    const cover = Math.max(W / iw, H / ih);
    const cw = iw * cover, ch = ih * cover;
    ctx.drawImage(img, (W - cw) / 2, (H - ch) / 2, cw, ch);
    ctx.restore();
  } catch (e) {
    ctx.fillStyle = '#20222a';
    ctx.fillRect(0, 0, W, H);
  }

  // 主体：完整放入（contain）
  const pad = 12;
  const scale = Math.min((W - pad * 2) / iw, (H - pad * 2 - 34) / ih);
  const dw = iw * scale, dh = ih * scale;
  ctx.drawImage(img, (W - dw) / 2, pad + (H - pad * 2 - 34 - dh) / 2, dw, dh);

  // 底部信息条
  ctx.fillStyle = 'rgba(12,14,18,0.72)';
  ctx.fillRect(0, H - 34, W, 34);
  ctx.fillStyle = 'rgba(255,255,255,0.82)';
  ctx.font = '600 18px "Helvetica Neue", Arial, "PingFang SC", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(info.mbcName, 12, H - 17);
  ctx.textAlign = 'right';
  const mb = info.romSize / 1048576;
  ctx.fillText(`${mb >= 1 ? mb.toFixed(mb % 1 === 0 ? 0 : 1) : (info.romSize / 1024).toFixed(0) + 'KB'} · ${info.romBanks} BANKS`, W - 12, H - 17);

  // 边框
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, W - 6, H - 6);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function wrapText(ctx, text, maxW) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? cur + ' ' + w : w;
    if (ctx.measureText(test).width > maxW && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ---------- 机身文字（透明底） ----------
export function makeTextTexture(lines, opts = {}) {
  const W = opts.width || 1024;
  const H = opts.height || 128;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let y = H / 2;
  if (lines.length === 2) y = H * 0.32;
  lines.forEach((ln, i) => {
    ctx.font = ln.font;
    ctx.fillStyle = ln.color || opts.color || '#26282e';
    ctx.fillText(ln.text, W / 2, lines.length === 2 ? H * (0.32 + i * 0.38) : y + i * (H / lines.length));
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// ---------- 机身正面 Logo："Nintendo GAME BOY™" ----------
export function makeLogoTexture() {
  const W = 1024, H = 160;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#2b2d33';
  ctx.font = 'italic 700 78px Georgia, "Times New Roman", serif';
  const nintendoW = ctx.measureText('Nintendo').width;
  ctx.font = '800 92px "Helvetica Neue", Arial, sans-serif';
  const gameboyW = ctx.measureText('GAME BOY').width;
  const total = nintendoW + 40 + gameboyW + 34;
  let x = (W - total) / 2;
  ctx.font = 'italic 700 78px Georgia, "Times New Roman", serif';
  ctx.fillText('Nintendo', x, H / 2);
  x += nintendoW + 40;
  ctx.font = '800 92px "Helvetica Neue", Arial, sans-serif';
  ctx.fillText('GAME BOY', x, H / 2);
  x += gameboyW + 12;
  ctx.font = '600 26px Arial';
  ctx.fillText('TM', x + 10, H / 2 - 30);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// ---------- 电源开关标签："◄ OFF · ON ►" ----------
export function makePowerLabelTexture() {
  const W = 512, H = 96;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#55565c';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.font = '600 40px "Helvetica Neue", Arial, sans-serif';
  ctx.fillText('OFF', 190, H / 2);
  ctx.fillText('ON', 330, H / 2);
  // 小三角
  ctx.beginPath();
  ctx.moveTo(120, H / 2 - 10); ctx.lineTo(140, H / 2); ctx.lineTo(120, H / 2 + 10);
  ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(400, H / 2 - 10); ctx.lineTo(420, H / 2); ctx.lineTo(400, H / 2 + 10);
  ctx.closePath(); ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// ---------- LCD 待机/开机画面绘制 ----------
export class LCDScreen {
  constructor() {
    this.canvas = canvas(160, 144);
    this.ctx = this.canvas.getContext('2d');
    this.imgData = this.ctx.createImageData(160, 144);
  }

  // 把模拟器帧缓冲刷上去
  drawFramebuffer(fb) {
    const d = this.imgData.data;
    d.set(fb);
    this.ctx.putImageData(this.imgData, 0, 0);
  }

  // 待机画面：GAME BOY 开机动画风格
  drawIdle(t) {
    const ctx = this.ctx;
    ctx.fillStyle = '#9bbc0f';
    ctx.fillRect(0, 0, 160, 144);
    // 下落的 LOGO（模仿开机画面）
    const targetY = 62;
    const dropT = (t % 7) / 7; // 每 7 秒重播一次
    let y;
    if (dropT < 0.35) {
      const p = easeOutBounce(dropT / 0.35);
      y = -30 + p * (targetY + 30);
    } else {
      y = targetY;
    }
    ctx.fillStyle = '#0f380f';
    ctx.font = 'bold 26px "Helvetica Neue", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('GAME BOY', 80, y);
    ctx.font = '10px Arial';
    ctx.fillText('™', 132, y - 20);

    // 闪烁提示
    if (dropT > 0.45) {
      const blink = Math.floor(t * 2) % 2 === 0;
      if (blink) {
        ctx.font = '11px "PingFang SC", "Microsoft YaHei", sans-serif';
        ctx.fillText('· 请插入卡带 ·', 80, 104);
      }
    }
  }

  // 开机白闪过渡
  drawBootFlash(p) {
    // p: 1 → 0 白色渐隐
    const ctx = this.ctx;
    ctx.fillStyle = `rgba(233,241,222,${Math.max(0, Math.min(1, p))})`;
    ctx.fillRect(0, 0, 160, 144);
  }
}

function easeOutBounce(x) {
  const n1 = 7.5625, d1 = 2.75;
  if (x < 1 / d1) return n1 * x * x;
  if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75;
  if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375;
  return n1 * (x -= 2.625 / d1) * x + 0.984375;
}
