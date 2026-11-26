// Node 冒烟测试：跑合成测试 ROM（或指定 .gba），导出 PNG 校验画面
import fs from 'node:fs';
import zlib from 'node:zlib';
import { GBA } from '../src/emulator/gba.js';
import { buildTestROM } from './mktestrom.js';

const W = 240, H = 160;

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
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const c = Buffer.alloc(4); c.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, c]);
}
export function writePNG(path, rgba, w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  let p = 0;
  for (let y = 0; y < h; y++) {
    raw[p++] = 0;
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      raw[p++] = rgba[o]; raw[p++] = rgba[o + 1]; raw[p++] = rgba[o + 2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  fs.writeFileSync(path, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]));
}

function main() {
  const romPath = process.argv[2];
  const frames = parseInt(process.argv[3] || '10', 10);
  const gb = new GBA();
  const rom = romPath ? new Uint8Array(fs.readFileSync(romPath)) : buildTestROM();
  gb.loadROM(rom);
  console.log('ROM 标题:', gb.romTitle, '| 代码:', gb.romCode, '| 存档类型:', gb.saveType, '| 大小:', rom.length);

  const outDir = new URL('./out/', import.meta.url);
  fs.mkdirSync(outDir, { recursive: true });
  const t0 = Date.now();
  for (let i = 0; i < frames; i++) gb.runFrame();
  const dt = Date.now() - t0;
  const rgba = gb.ppu.toRGBA();
  writePNG(new URL('final.png', outDir), rgba, W, H);
  console.log(`运行 ${frames} 帧耗时 ${dt}ms → ${(frames / (dt / 1000)).toFixed(1)} FPS`);

  // 画面统计
  const counts = new Map();
  for (let i = 0; i < rgba.length; i += 4) {
    const key = `${rgba[i]},${rgba[i + 1]},${rgba[i + 2]}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  console.log('主要颜色:', top.map(([k, v]) => `rgb(${k})×${v}`).join('  '));
  const center = ((80 * W + 120) * 4);
  console.log('中心像素:', rgba[center], rgba[center + 1], rgba[center + 2]);
  console.log('PNG 已导出: tools/out/final.png');
}
main();
