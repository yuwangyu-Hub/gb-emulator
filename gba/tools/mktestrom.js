// 生成最小 GBA 测试 ROM（ARM 手汇编——GBA 开机处于 ARM 状态）
// 功能：DISPCNT = mode3 + BG2 使能，用红色填满 240x160 帧缓冲后死循环
import fs from 'node:fs';

const code = [
  0xE3A00004, // mov  r0, #4
  0xE1A00C00, // mov  r0, r0, lsl #24     → 0x04000000 (IO)
  0xE3A01004, // mov  r1, #4
  0xE1A01401, // mov  r1, r1, lsl #8      → 0x400
  0xE2811003, // add  r1, r1, #3          → 0x0403 (mode3 + BG2)
  0xE1C010B0, // strh r1, [r0, #0]        → DISPCNT
  0xE3A02006, // mov  r2, #6
  0xE1A02C02, // mov  r2, r2, lsl #24     → 0x06000000 (VRAM)
  0xE3A03096, // mov  r3, #0x96
  0xE1A03403, // mov  r3, r3, lsl #8      → 38400
  0xE3A0401F, // mov  r4, #0x1f           → 红色 (BGR555)
  0xE1C240B0, // loop: strh r4, [r2, #0]
  0xE2822002, // add  r2, r2, #2
  0xE2533001, // subs r3, r3, #1
  0x1AFFFFFB, // bne  loop
  0xEAFFFFFE, // b    .
];

export function buildTestROM() {
  const rom = new Uint8Array(0x40000);
  code.forEach((w, i) => {
    rom[i * 4] = w & 0xff; rom[i * 4 + 1] = (w >>> 8) & 0xff;
    rom[i * 4 + 2] = (w >>> 16) & 0xff; rom[i * 4 + 3] = (w >>> 24) & 0xff;
  });
  // 卡带头（标题/游戏代码，仅用于展示）
  const title = 'GBA SELFTEST';
  for (let i = 0; i < title.length; i++) rom[0xa0 + i] = title.charCodeAt(i);
  const gc = 'ATST';
  for (let i = 0; i < 4; i++) rom[0xac + i] = gc.charCodeAt(i);
  rom[0xbd] = 0x00;    // 校验和占位
  return rom;
}

if (process.argv[1] && process.argv[1].endsWith('mktestrom.js')) {
  const rom = buildTestROM();
  fs.writeFileSync(new URL('./out/selftest.gba', import.meta.url), rom);
  console.log('已生成 tools/out/selftest.gba', rom.length, 'bytes');
}
