// GBA BIOS 的 HLE（High Level Emulation）
//
// 真机 BIOS 在 0x00000000，提供 SWI 系统调用。我们没有 BIOS 镜像，所以在这里
// 用 JS 直接实现这些调用的语义：参数走 r0-r2，返回值写回 r0-r1（个别写 r3）。
//
// 参考：GBATEK "BIOS Call Reference"。

const U32 = (v) => v >>> 0;

export function createBiosHle(gba) {
  const cpu = gba.cpu;
  const mmu = gba.mmu;

  // ---------- 内存读写小工具 ----------
  const rd8 = (a) => mmu.read8(a);
  const rd16 = (a) => mmu.read16(a);
  const rd32 = (a) => mmu.read32(a);
  const wr8 = (a, v) => mmu.write8(a, v);
  const wr16 = (a, v) => mmu.write16(a, v);
  const wr32 = (a, v) => mmu.write32(a, v);

  // ---------- 单个 SWI 的实现 ----------

  /** 0x00 SoftReset：重启到卡带入口 */
  function softReset() {
    gba.reset();
  }

  /** 0x01 RegisterRamReset(r0 = flags)：按位清零内存区 */
  function registerRamReset(flags) {
    if (flags & 0x01) mmu.wram.fill(0);                       // 256KB WRAM
    if (flags & 0x02) {                                       // 从 0x03007E00 起的 IWRAM
      mmu.iwram.fill(0, 0x7e00);
    }
    if (flags & 0x04) mmu.pal.fill(0);                        // 调色板
    if (flags & 0x08) mmu.vram.fill(0);                       // VRAM
    if (flags & 0x10) mmu.oam.fill(0);                        // OAM
    if (flags & 0x20) {                                       // IO 寄存器（保留关键位）
      for (let a = 0; a < 0x400; a++) {
        if (a >= 0x200 && a < 0x210) continue;                // IE/IF/IME 不动
        if (a >= 0x130 && a < 0x132) continue;                // 按键不动
        mmu.io[a] = 0;
        if (mmu.ioHook) mmu.ioHook.write(a, 0, 0);
      }
    }
    if (flags & 0x40) {
      for (let a = 0x04000060; a < 0x040000a8; a++) wr16(a, 0);  // 声音寄存器
    }
  }

  /** 0x02 Halt：等到任意中断（或不带中断的 HALT） */
  function halt() {
    gba.halted = true;
  }

  /** 0x04 IntrWait(flag, mask) / 0x05 VBlankIntrWait */
  function intrWait(flag, mask) {
    const if_ = rd16(0x04000202);
    // flag=1 时先清掉 mask 对应的挂起位，再等新的
    if (flag) wr16(0x04000202, if_ & ~mask);
    gba.waitForIrq(mask);
  }

  /** 0x06 Div(numer, denom) */
  function div(numer, denom) {
    const n = numer | 0, d = denom | 0;
    if (d === 0) {                       // BIOS 行为未定义，这里给 0 并保留被除数
      cpu.r[0] = U32(n);
      cpu.r[1] = 0;
      cpu.r[3] = 0;
      return;
    }
    const q = (n / d) | 0;
    const r = (n % d) | 0;
    cpu.r[0] = U32(q);
    cpu.r[1] = U32(r);
    cpu.r[3] = U32(Math.abs(q));
  }

  /** 0x07 DivArm(denom, numer)：参数顺序相反 */
  function divArm(denom, numer) {
    div(numer, denom);
  }

  /** 0x08 Sqrt(n) */
  function sqrt(n) {
    cpu.r[0] = U32(Math.floor(Math.sqrt(U32(n))));
  }

  /** 0x09 ArcTan(n)：返回 1/0x4000 圆的角（0x4000 = 90°） */
  function arcTan(n) {
    const x = (n | 0) / 0x10000;
    const a = Math.atan(x);
    cpu.r[0] = U32(Math.round(a * (0x8000 / Math.PI)) & 0xffff);
  }

  /** 0x0A ArcTan2(x, y) */
  function arcTan2(x, y) {
    const a = Math.atan2(y | 0, x | 0);
    cpu.r[0] = U32(Math.round(a * (0x8000 / Math.PI)) & 0xffff);
  }

  /** 0x0B CpuSet(src, dst, lenMode) */
  function cpuSet(src, dst, lenMode) {
    const count = lenMode & 0x1fffff;
    const word = !!(lenMode & 0x04000000);
    const fill = !!(lenMode & 0x01000000);
    if (word) {
      const v = rd32(src);
      for (let i = 0; i < count; i++) wr32((dst + i * 4) >>> 0, v);
    } else {
      const v = rd16(src);
      for (let i = 0; i < count; i++) wr16((dst + i * 2) >>> 0, v);
    }
  }

  /** 0x0B 的复制形式（CpuSet 的 bit26=0 时是拷贝，不是填充） */
  function cpuSetCopy(src, dst, lenMode) {
    const count = lenMode & 0x1fffff;
    const word = !!(lenMode & 0x04000000);
    const fill = !!(lenMode & 0x01000000);
    if (fill) { cpuSet(src, dst, lenMode); return; }
    if (word) {
      for (let i = 0; i < count; i++) {
        wr32((dst + i * 4) >>> 0, rd32((src + i * 4) >>> 0));
      }
    } else {
      for (let i = 0; i < count; i++) {
        wr16((dst + i * 2) >>> 0, rd16((src + i * 2) >>> 0));
      }
    }
  }

  /** 0x0C CpuFastSet(src, dst, lenMode)：长度按字算，必须是 8 的倍数 */
  function cpuFastSet(src, dst, lenMode) {
    const count = lenMode & 0x1fffff;
    if (lenMode & 0x01000000) {         // 填充
      const v = rd32(src);
      for (let i = 0; i < count; i++) wr32((dst + i * 4) >>> 0, v);
      return;
    }
    for (let i = 0; i < count; i++) {
      wr32((dst + i * 4) >>> 0, rd32((src + i * 4) >>> 0));
    }
  }

  /** 0x0D GetBiosChecksum：返回一个固定值（游戏只用来识别 BIOS） */
  function getBiosChecksum() {
    cpu.r[0] = 0xb84e5bc0;
  }

  /** 0x10 BitUnPack(src, dst, infoPtr) */
  function bitUnPack(src, dst, infoPtr) {
    const srcLen = rd16(infoPtr) & 0xffff;          // 源数据字节数
    const dstLen = rd8(infoPtr + 2) & 0xff;         // 目标每单元位宽
    const src0 = rd8(infoPtr + 3) & 0xff;           // 源位宽（0 表示无符号 1 位）
    const disp = rd16(infoPtr + 4);                  // 附加偏移
    const bitsPerSrc = src0 === 0 ? 1 : src0;
    const signed = src0 === 0;

    let srcBit = 0;
    let dstPtr = dst;
    const total = srcLen * 8;
    const perUnit = bitsPerSrc;

    outer:
    while (srcBit + perUnit <= total) {
      let v = 0;
      for (let b = 0; b < perUnit; b++) {
        const byte = rd8((src + ((srcBit + b) >> 3)) >>> 0);
        const bit = (byte >> (7 - ((srcBit + b) & 7))) & 1;
        v = (v << 1) | bit;
      }
      srcBit += perUnit;
      if (signed) v = (v << 1) - 1;                 // 1 位模式：0→-1, 1→0
      v = (v + disp) & 0xffff;
      if (dstLen <= 8) wr8(dstPtr, v);
      else wr16(dstPtr, v);
      dstPtr += dstLen >> 3;
      if (dstPtr >= dst + srcLen * 64) break outer; // 安全阀
    }
  }

  /** LZ77 解压：type=0x10 头 + 3 字节长度 */
  function lz77UnComp(src, dst, vram) {
    const header = rd32(src);
    if ((header & 0xff) !== 0x10) return 0;
    const size = header >>> 8;
    let sp = (src + 4) >>> 0;
    let write = 0;
    let word = 0, wordBits = 0;         // VRAM 模式下按 16 位写入：用缓冲攒
    let buffer = 0, bufCount = 0;

    const put = (byte) => {
      if (!vram) {
        wr8((dst + write) >>> 0, byte);
        write++;
        return;
      }
      buffer |= (byte << (8 * bufCount));
      bufCount++;
      if (bufCount === 2) {
        wr16((dst + write) >>> 0, buffer & 0xffff);
        write += 2;
        buffer = 0; bufCount = 0;
      }
    };

    while (write < size) {
      const flags = rd8(sp); sp = (sp + 1) >>> 0;
      for (let i = 0; i < 8 && write < size; i++) {
        if (flags & (0x80 >> i)) {
          const b1 = rd8(sp), b2 = rd8((sp + 1) >>> 0);
          sp = (sp + 2) >>> 0;
          const len = (b1 >> 4) + 3;
          const disp = (((b1 & 0xf) << 8) | b2) + 1;
          for (let k = 0; k < len && write < size; k++) {
            const back = (dst + write - disp) >>> 0;
            put(rd8(back));
          }
        } else {
          put(rd8(sp));
          sp = (sp + 1) >>> 0;
        }
      }
    }
    if (vram && bufCount === 1) wr16((dst + write) >>> 0, buffer & 0xffff);
    return size;
  }

  /** RL 解压 */
  function rlUnComp(src, dst, vram) {
    const header = rd32(src);
    if ((header & 0xff) !== 0x30) return 0;
    const size = header >>> 8;
    let sp = (src + 4) >>> 0;
    let write = 0;
    let buffer = 0, bufCount = 0;
    const put = (byte) => {
      if (!vram) { wr8((dst + write) >>> 0, byte); write++; return; }
      buffer |= byte << (8 * bufCount);
      bufCount++;
      if (bufCount === 2) { wr16((dst + write) >>> 0, buffer & 0xffff); write += 2; buffer = 0; bufCount = 0; }
    };
    while (write < size) {
      const flag = rd8(sp); sp = (sp + 1) >>> 0;
      if (flag & 0x80) {
        const len = (flag & 0x7f) + 3;
        const b = rd8(sp); sp = (sp + 1) >>> 0;
        for (let i = 0; i < len && write < size; i++) put(b);
      } else {
        const len = (flag & 0x7f) + 1;
        for (let i = 0; i < len && write < size; i++) { put(rd8(sp)); sp = (sp + 1) >>> 0; }
      }
    }
    if (vram && bufCount === 1) wr16((dst + write) >>> 0, buffer & 0xffff);
    return size;
  }

  // ---------- 分发 ----------
  const TABLE = {
    0x00: () => softReset(),
    0x01: (a) => registerRamReset(a),
    0x02: () => halt(),
    0x03: () => halt(),                       // Stop：电压处理，直接当 Halt
    0x04: (a, b) => intrWait(a, b),
    0x05: () => intrWait(1, 1),               // VBlankIntrWait
    0x06: (a, b) => div(a, b),
    0x07: (a, b) => divArm(a, b),
    0x08: (a) => sqrt(a),
    0x09: (a) => arcTan(a),
    0x0a: (a, b) => arcTan2(a, b),
    0x0b: (a, b, c) => cpuSetCopy(a, b, c),
    0x0c: (a, b, c) => cpuFastSet(a, b, c),
    0x0d: () => getBiosChecksum(),
    0x10: (a, b, c) => bitUnPack(a, b, c),
    0x11: (a, b) => lz77UnComp(a, b, false),
    0x12: (a, b) => lz77UnComp(a, b, true),
    0x14: (a, b) => rlUnComp(a, b, false),
    0x15: (a, b) => rlUnComp(a, b, true),
  };

  /** CPU 的 swiHook 入口 */
  return function callSwi(comment) {
    const fn = TABLE[comment];
    if (!fn) {
      gba.unimplementedSwi.add(comment);
      return;
    }
    fn(cpu.r[0], cpu.r[1], cpu.r[2]);
  };
}

/**
 * 最小 BIOS 桩：只填 IRQ 入口和一段分发代码，让真机 ROM 的中断能跑起来。
 *
 * 0x18  b 0x1C0
 * 0x1C0 stmfd sp!, {r0-r3,r12,lr}
 * 0x1C4 ldr   r0, [pc,#0x10]     ; → 0x1DC 的字面量
 * 0x1C8 ldr   r0, [r0]           ; 游戏在 IWRAM 末尾注册的处理函数
 * 0x1CC mov   lr, pc
 * 0x1D0 bx    r0                 ; 调用；返回落到 0x1D4
 * 0x1D4 ldmfd sp!, {r0-r3,r12,lr}
 * 0x1D8 subs  pc, lr, #4         ; 恢复 CPSR 并返回被打断的指令
 * 0x1DC .word 0x03007FFC
 */
export function createBiosStub() {
  const bios = new Uint8Array(0x4000).fill(0xff);
  const put = (addr, word) => {
    bios[addr] = word & 0xff;
    bios[addr + 1] = (word >>> 8) & 0xff;
    bios[addr + 2] = (word >>> 16) & 0xff;
    bios[addr + 3] = (word >>> 24) & 0xff;
  };

  put(0x18, 0xea000068);   // b 0x1C0
  put(0x1c0, 0xe92d500f);  // stmfd sp!, {r0-r3,r12,lr}
  put(0x1c4, 0xe59f0010);  // ldr   r0, [pc,#0x10]
  put(0x1c8, 0xe5900000);  // ldr   r0, [r0]
  put(0x1cc, 0xe1a0e00f);  // mov   lr, pc
  put(0x1d0, 0xe12fff10);  // bx    r0
  put(0x1d4, 0xe8bd500f);  // ldmfd sp!, {r0-r3,r12,lr}
  put(0x1d8, 0xe25ef004);  // subs  pc, lr, #4
  put(0x1dc, 0x03007ffc);  // .word 游戏的中断处理函数指针

  return bios;
}
