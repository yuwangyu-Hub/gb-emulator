import * as THREE from 'three';

// GBA 展示层贴图：LCD 画面 / 卡带标签
//
// LCD 是 240×160 的真机像素尺寸，用 CanvasTexture 贴到 3D 屏幕上；
// 待机时画一块 GBA 风格的开机画面，避免黑屏。

const W = 240;
const H = 160;

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export class LCDScreen {
  constructor() {
    this.canvas = makeCanvas(W, H);
    this.ctx = this.canvas.getContext('2d');
    this.imgData = this.ctx.createImageData(W, H);
  }

  /** 把模拟器帧缓冲（RGBA）刷上去 */
  drawFramebuffer(rgba) {
    this.imgData.data.set(rgba);
    this.ctx.putImageData(this.imgData, 0, 0);
  }

  /** 待机画面：GBA 开机风 */
  drawIdle(t) {
    const ctx = this.ctx;
    ctx.fillStyle = '#0d1220';
    ctx.fillRect(0, 0, W, H);

    // 背景细扫描线
    ctx.fillStyle = 'rgba(120, 170, 255, 0.045)';
    for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);

    // 呼吸的边光
    const pulse = 0.5 + 0.5 * Math.sin(t * 1.8);
    ctx.strokeStyle = `rgba(120, 170, 255, ${0.16 + pulse * 0.16})`;
    ctx.lineWidth = 1;
    ctx.strokeRect(6.5, 6.5, W - 13, H - 13);

    // 标题
    ctx.textAlign = 'center';
    ctx.fillStyle = '#cfe3ff';
    ctx.font = 'bold 21px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText('GAME BOY', W / 2, 66);
    ctx.fillStyle = '#8fb4e8';
    ctx.font = 'bold 15px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText('ADVANCE', W / 2, 86);

    // 底部提示（光标闪烁）
    const blink = Math.sin(t * 3.2) > 0;
    ctx.fillStyle = 'rgba(200, 220, 255, 0.62)';
    ctx.font = '11px "PingFang SC", "Microsoft YaHei", Arial, sans-serif';
    ctx.fillText('上传 .gba 卡带开始', W / 2, 122);
    if (blink) {
      ctx.fillStyle = '#8fb4e8';
      ctx.fillRect(W / 2 - 2, 128, 4, 2);
    }
  }

  /** 通电白闪（插卡完成后） */
  drawFlash(amount) {
    const ctx = this.ctx;
    ctx.fillStyle = `rgba(255, 255, 255, ${Math.max(0, Math.min(1, amount))})`;
    ctx.fillRect(0, 0, W, H);
  }
}

/** 卡带标签贴图：色块 + 标题 + 一行小字 */
export function makeLabelTexture(info) {
  const w = 256, h = 128;
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');

  const title = (info && info.title) || 'GBA';
  // 用标题做稳定色相，同一张卡每次颜色一致
  let hash = 0;
  for (let i = 0; i < title.length; i++) hash = (hash * 31 + title.charCodeAt(i)) >>> 0;
  const hue = hash % 360;

  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, `hsl(${hue}, 62%, 58%)`);
  g.addColorStop(1, `hsl(${(hue + 28) % 360}, 58%, 38%)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // 斜向高光
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  ctx.beginPath();
  ctx.moveTo(0, h);
  ctx.lineTo(w * 0.55, 0);
  ctx.lineTo(w * 0.78, 0);
  ctx.lineTo(0, h * 1.35);
  ctx.closePath();
  ctx.fill();

  // 顶部色带
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fillRect(0, 0, w, 22);

  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.font = 'bold 12px "Helvetica Neue", Arial, sans-serif';
  ctx.fillText('GAME BOY ADVANCE', 12, 15);

  // 标题（自动缩字号 + 换行）
  const line = title.length > 13 ? title.slice(0, 13) : title;
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 26px "PingFang SC", "Microsoft YaHei", Arial, sans-serif';
  ctx.fillText(line, 12, 60);

  if (title.length > 13) {
    ctx.font = 'bold 22px "PingFang SC", "Microsoft YaHei", Arial, sans-serif';
    ctx.fillText(title.slice(13, 26), 12, 86);
  }

  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.font = '10px "Helvetica Neue", Arial, sans-serif';
  ctx.fillText((info && info.romCode) || 'AGB-001', 12, h - 12);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
