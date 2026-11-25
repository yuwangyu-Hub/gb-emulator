// Node 冒烟测试：加载 ROM 跑若干帧，导出 PNG 便于肉眼校验
import fs from 'node:fs';
import zlib from 'node:zlib';
import { GameBoy, SCREEN_W, SCREEN_H } from '../src/emulator/gameboy.js';

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crcBuf]);
}

export function writePNG(path, rgba, w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  let p = 0;
  for (let y = 0; y < h; y++) {
    raw[p++] = 0;
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      raw[p++] = rgba[o];
      raw[p++] = rgba[o + 1];
      raw[p++] = rgba[o + 2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  fs.writeFileSync(path, png);
}

function main() {
  const romPath = process.argv[2] || 'roms/kirby.gb';
  const frames = parseInt(process.argv[3] || '900', 10);
  const buf = fs.readFileSync(romPath);
  const gb = new GameBoy();
  const info = gb.loadROM(new Uint8Array(buf), null, 44100);
  console.log('卡带信息:', JSON.stringify(info, null, 2));

  const outDir = 'tools/out';
  fs.mkdirSync(outDir, { recursive: true });

  const snapshots = { 90: 'frame090', 200: 'frame200', 420: 'frame420' };
  const t0 = Date.now();
  for (let i = 1; i <= frames; i++) {
    gb.runFrame();
    if (snapshots[i]) {
      writePNG(`${outDir}/${snapshots[i]}.png`, gb.getFramebuffer(), SCREEN_W, SCREEN_H);
      console.log(`  导出 ${snapshots[i]}.png`);
    }
  }
  const dt = Date.now() - t0;
  console.log(`\n运行 ${frames} 帧耗时 ${dt}ms  →  ${(frames / (dt / 1000)).toFixed(1)} FPS (单线程 JS)`);
  writePNG(`${outDir}/final.png`, gb.getFramebuffer(), SCREEN_W, SCREEN_H);

  // 简单统计：画面是否非空白
  const fb = gb.getFramebuffer();
  const counts = new Map();
  for (let i = 0; i < fb.length; i += 4) {
    const key = `${fb[i]},${fb[i + 1]},${fb[i + 2]}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  console.log('画面颜色分布:', [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8));
  console.log('LY=', gb.ppu.ly, ' PC=', gb.cpu.pc.toString(16), ' IF=', gb.if_.toString(2));
}

main();
