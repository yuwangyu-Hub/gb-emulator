// ARM7TDMI 解释器（ARM + Thumb）
// 约定：执行地址为 addr 的指令时，r[15] = addr + 8（ARM）/ addr + 4（Thumb），
// 若指令未改写 PC，执行结束后自动 +4 / +2。

export const MODE_USER = 0x10;
export const MODE_FIQ = 0x11;
export const MODE_IRQ = 0x12;
export const MODE_SVC = 0x13;
export const MODE_ABORT = 0x17;
export const MODE_UNDEF = 0x1b;
export const MODE_SYS = 0x1f;

const BANK_INDEX = new Uint8Array(0x20);
{
  const map = { 0x10: 0, 0x1f: 0, 0x11: 1, 0x12: 2, 0x13: 3, 0x17: 4, 0x1b: 5 };
  for (const k in map) BANK_INDEX[k & 0x1f] = map[k];
}

const COND_TABLE = (cpsr, cond) => {
  const n = (cpsr >>> 31) & 1, z = (cpsr >>> 30) & 1, c = (cpsr >>> 29) & 1, v = (cpsr >>> 28) & 1;
  switch (cond) {
    case 0: return z === 1;
    case 1: return z === 0;
    case 2: return c === 1;
    case 3: return c === 0;
    case 4: return n === 1;
    case 5: return n === 0;
    case 6: return v === 1;
    case 7: return v === 0;
    case 8: return c === 1 && z === 0;
    case 9: return c === 0 || z === 1;
    case 10: return n === v;
    case 11: return n !== v;
    case 12: return z === 0 && n === v;
    case 13: return z === 1 || n !== v;
    default: return true;
  }
};

export class CPU {
  constructor(mmu) {
    this.m = mmu;
    this.r = new Uint32Array(16);
    // 分组寄存器：[r13, r14, spsr, r8..r12(fiq)]
    this.banks = [];
    for (let i = 0; i < 6; i++) this.banks.push(new Uint32Array(8));
    this.cpsr = MODE_SYS;
    this.spsrCached = 0;
    this.cycles = 0;
    this.halted = false;
    this.swiHook = null;      // (comment) => void，用于 BIOS HLE
    this.irqPending = false;
  }

  reset(skipBios) {
    this.cpsr = MODE_SYS;
    for (let i = 0; i < 16; i++) this.r[i] = 0;
    for (const b of this.banks) b.fill(0);
    if (skipBios) {
      // BIOS 跳过后各栈指针的通用初值（与 mGBA 等一致）
      this.banks[BANK_INDEX[MODE_SYS]][0] = 0x03007f00;
      this.banks[BANK_INDEX[MODE_SVC]][0] = 0x03007fe0;
      this.banks[BANK_INDEX[MODE_IRQ]][0] = 0x03007fa0;
      this.banks[BANK_INDEX[MODE_FIQ]][0] = 0x03007f00;
      this.cpsr = MODE_SYS;
      this.r[13] = 0x03007f00;
      this.r[15] = 0x08000008;
    } else {
      this.cpsr = MODE_SVC;
      this.r[13] = 0x03007fe0;
      this.r[15] = 0x00000008;
    }
    this.cycles = 0;
    this.halted = false;
  }

  // ---------- 模式切换 ----------
  swapRegs(oldMode, newMode) {
    const ob = this.banks[BANK_INDEX[oldMode & 0x1f]];
    ob[0] = this.r[13]; ob[1] = this.r[14];
    if ((oldMode & 0x1f) === MODE_FIQ) for (let i = 8; i <= 12; i++) ob[2 + i - 8] = this.r[i];
    const nb = this.banks[BANK_INDEX[newMode & 0x1f]];
    this.r[13] = nb[0]; this.r[14] = nb[1];
    if ((newMode & 0x1f) === MODE_FIQ) for (let i = 8; i <= 12; i++) this.r[i] = nb[2 + i - 8];
  }
  setMode(mode) {
    mode &= 0x1f;
    if (mode === (this.cpsr & 0x1f)) return;
    this.swapRegs(this.cpsr & 0x1f, mode);
    this.cpsr = (this.cpsr & ~0x1f) | mode;
  }
  get spsr() { return this.banks[BANK_INDEX[this.cpsr & 0x1f]][2]; }
  set spsr(v) { this.banks[BANK_INDEX[this.cpsr & 0x1f]][2] = v >>> 0; }

  // ---------- 标志位 ----------
  get flagN() { return (this.cpsr >>> 31) & 1; }
  get flagZ() { return (this.cpsr >>> 30) & 1; }
  get flagC() { return (this.cpsr >>> 29) & 1; }
  get flagV() { return (this.cpsr >>> 28) & 1; }
  setFlags(n, z, c, v) {
    let f = this.cpsr & ~(0xf0000000);
    if (n) f |= 0x80000000;
    if (z) f |= 0x40000000;
    if (c) f |= 0x20000000;
    if (v) f |= 0x10000000;
    this.cpsr = f;
  }
  setNZ(res) {
    let f = this.cpsr & ~0xc0000000;
    if (res & 0x80000000) f |= 0x80000000;
    if ((res >>> 0) === 0) f |= 0x40000000;
    this.cpsr = f;
  }
  addCycles(n) { this.cycles += n; }

  // ---------- 异常 / 中断 ----------
  raiseException(mode, addr, lrAdjust, vector = 0x00000008) {
    const oldCpsr = this.cpsr;
    this.setMode(mode);
    this.r[14] = (addr + lrAdjust) >>> 0;   // 返回地址
    this.spsr = oldCpsr;
    this.cpsr = (this.cpsr & ~0x20) | 0x80; // 清 T、置 I(禁 IRQ)
    // 向量入口：SWI=0x08，IRQ=0x18（原来 IRQ 也被写死到 0x08，等于跳错向量）
    this.r[15] = (vector + 8) >>> 0;
  }
  tryIRQ(ime, ie, if_) {
    if (!ime || (ie & if_) === 0 || (this.cpsr & 0x80)) return false;
    this.raiseException(MODE_IRQ, this.r[15] - 8, 4, 0x00000018);
    return true;
  }

  // ---------- 桶形移位 ----------
  // type: 0 LSL 1 LSR 2 ASR 3 ROR/RRX
  shift(v, amt, type) {
    switch (type) {
      case 0: { // LSL
        if (amt === 0) return v;
        if (amt >= 32) return amt === 32 ? ((v & 1) << 29 | (this.flagC)) >>> 0 & 0 : 0;
        const c = amt > 32 ? 0 : (v >>> (32 - amt)) & 1;
        return ((v << amt) >>> 0) | 0;
      }
      case 1: { // LSR
        if (amt === 0) amt = 32;
        if (amt >= 32) return 0;
        return (v >>> amt) >>> 0;
      }
      case 2: { // ASR
        if (amt === 0) amt = 32;
        if (amt >= 32) return (v & 0x80000000) ? 0xffffffff : 0;
        return (v >> amt) >>> 0;
      }
      default: { // ROR
        if (amt === 0) amt = 32;
        amt &= 31;
        if (amt === 0) return v >>> 0;
        return (((v >>> amt) | (v << (32 - amt))) >>> 0);
      }
    }
  }
  shiftCarry(v, amt, type) {
    if (amt === 0 && type !== 3) return this.flagC;
    switch (type) {
      case 0: return amt > 32 ? 0 : (v >>> (32 - amt)) & 1;
      case 1: return amt >= 32 ? ((v >>> 31) & 1) : ((v >>> (amt - 1)) & 1);
      case 2: return amt >= 32 ? ((v >>> 31) & 1) : ((v >> (amt - 1)) & 1);
      default: { const a = amt === 32 ? 0 : amt & 31; return a === 0 ? (v >>> 31) & 1 : (v >>> (a - 1)) & 1; }
    }
  }

  // ================= ARM =================
  stepARM() {
    const addr = (this.r[15] - 8) >>> 0;
    const op = this.m.read32(addr & ~3);
    this.r[15] = (addr + 8) >>> 0;
    this.addCycles(1);
    const cond = op >>> 28;
    // 条件不成立时指令等同 NOP，但 PC 必须继续前进 ——
    // 原来直接 return，r15 停在 addr+8，下一条又取到同一地址，任何
    // 「条件不成立」的指令都会变成死循环（真机 ROM 就卡在这上面）。
    if (!COND_TABLE(this.cpsr, cond)) { this.r[15] = (addr + 12) >>> 0; return; }

    const pcModified = this.execARM(op, addr);
    if (!pcModified) this.r[15] = (addr + 12) >>> 0;
  }

  execARM(op, addr) {
    // ARM 指令分类看 27-25 位（不是 31-26，那会带上条件码）
    const bits = (op >>> 25) & 7;
    switch (bits) {
      case 0:
        // 半字/有符号传输也落在 000 空间（bit7=bit4=1、bit22=1）
        if ((op & 0x90) === 0x90 && ((op >>> 22) & 1)) return this.armMem(op);
        return this.armDataProc(op, addr);
      case 1: return this.armDataProc(op, addr);
      case 2: return this.armMem(op);
      case 3: return false;                 // 未定义（媒体指令）
      case 4: return this.armBlock(op);
      case 5: return this.armBranch(op);
      case 6: return false;                 // 协处理器
      default: return this.armSWI(op);
    }
  }

  armDataProc(op, addr = 0) {
    const imm = (op >>> 25) & 1;
    const opcode = (op >>> 21) & 0xf;
    const S = (op >>> 20) & 1;
    const rn = (op >>> 16) & 0xf;
    const rd = (op >>> 12) & 0xf;

    // MRS / MSR
    if ((op & 0x0fbf0fff) === 0x010f0000) { // MRS Rd, CPSR/SPSR
      const useSpsr = (op >>> 22) & 1;
      const v = useSpsr ? this.spsr : this.cpsr;
      this.r[rd] = v >>> 0;
      return false;
    }
    // BX / BLX(imm) 前缀
    // 必须先于 MSR 判定：两者都落在 bits27-23=00010 空间，
    // 只按 0x0fb0f000 匹配会把 BX 误判成 MSR
    if ((op & 0x0ffffff0) === 0x012fff10) { // BX Rn
      const t = this.r[op & 0xf];
      if (t & 1) { this.cpsr |= 0x20; this.r[15] = ((t & ~1) + 4) >>> 0; }
      else this.r[15] = (t + 8) >>> 0;
      return true;
    }
    if ((op & 0x0ffffff0) === 0x012fff30) { // BLX Rn
      const t = this.r[op & 0xf];
      this.r[14] = (this.r[15] - 4) >>> 0;
      if (t & 1) { this.cpsr |= 0x20; this.r[15] = ((t & ~1) + 4) >>> 0; }
      else this.r[15] = (t + 8) >>> 0;
      return true;
    }

    // MSR —— 两种形式：
    //   寄存器：bits27-23=00010，field_mask 在 bits19-16，bits15-12=1111
    //   立即数：bits27-23=00110，field_mask 在 bits19-16，rot/imm 在 bits11-0
    // 旧实现只按 0x0129f000 / 0x0121f000 两个定值匹配（等于只认 field_mask=9/1 的
    // 寄存器形式），却按"立即数"取 op&0xff，于是 `msr CPSR_cf, r0` 会把 0 写进 CPSR，
    // 模式位被清零 → banked 寄存器全错位 → 卡带启动前 52 条指令就跳飞。
    if ((op & 0x0fb0f000) === 0x0120f000) { // MSR CPSR/SPSR, Rm
      this.writeStatus((op >>> 22) & 1, this.r[op & 0xf] >>> 0, op);
      return false;
    }
    if ((op & 0x0fb0f000) === 0x0320f000) { // MSR CPSR/SPSR, #imm
      const imm8 = op & 0xff;
      const rot = ((op >>> 8) & 0xf) * 2;
      const v = rot === 0 ? imm8 : (((imm8 >>> rot) | (imm8 << (32 - rot))) >>> 0);
      this.writeStatus((op >>> 22) & 1, v, op);
      return false;
    }

    // 乘法 / 长乘法
    if (((op >>> 24) & 0xf) === 0 && ((op >>> 4) & 0xf) === 9) {
      const rdHi = (op >>> 16) & 0xf, rdLo = (op >>> 12) & 0xf;
      const rs = (op >>> 8) & 0xf, rm = op & 0xf;
      const s = (op >>> 20) & 1;
      const kind = (op >>> 21) & 0x7;
      const a = this.r[rdHi], b = this.r[rm], c = this.r[rs];
      let res, resHi = 0;
      if (kind === 0) { // MUL
        res = (b * c) >>> 0;
        if (s) this.setNZ(res);
        this.r[rdLo] = res >>> 0;
      } else if (kind === 1) { // MLA
        res = (b * c + a) >>> 0;
        if (s) this.setNZ(res);
        this.r[rdLo] = res >>> 0;
      } else {
        const wide = (b >>> 0) * (c >>> 0);
        let lo = wide >>> 0, hi = Math.floor(wide / 4294967296) >>> 0;
        if ((kind & 2) && s) { /* 有符号长乘：按补码重算 */ }
        if (kind === 4) { // UMULL
          this.r[rdLo] = lo >>> 0; this.r[rdHi] = hi >>> 0;
        } else if (kind === 5) { // UMLAL
          const add = (a >>> 0) + lo;
          this.r[rdLo] = add >>> 0;
          this.r[rdHi] = (hi + (add > 0xffffffff ? 1 : 0)) >>> 0;
        } else if (kind === 6) { // SMULL
          const x = b | 0, y = c | 0;
          const w = x * y;
          this.r[rdLo] = (w & 0xffffffff) >>> 0;
          this.r[rdHi] = Math.floor(w / 4294967296) >>> 0;
        } else { // SMLAL
          const x = b | 0, y = c | 0;
          let w = x * y;
          let lo2 = (w & 0xffffffff) >>> 0;
          let hi2 = Math.floor(w / 4294967296) >>> 0;
          const add = (a >>> 0) + lo2;
          this.r[rdLo] = add >>> 0;
          this.r[rdHi] = (hi2 + (add > 0xffffffff ? 1 : 0)) >>> 0;
        }
      }
      return false;
    }

    // 半字 / 有符号传输（P=0/U=1 等布局由 armMem 处理，此处跳过）
    let op2 = 0, carry = this.flagC, shiftUsed = false;
    if (imm) {
      const v = op & 0xff;
      const rot = (op >>> 8) & 0xf;
      if (rot !== 0) { op2 = ((v >>> (rot * 2)) | (v << (32 - rot * 2))) >>> 0; carry = (op2 >>> 31) & 1; }
      else { op2 = v >>> 0; carry = this.flagC; }
    } else {
      const rm = op & 0xf;
      let amt, type = (op >>> 5) & 3;
      if ((op >>> 4) & 1) {
        amt = this.r[(op >>> 8) & 0xf] & 0xff;
        this.addCycles(1);
      } else {
        amt = (op >>> 7) & 0x1f;
      }
      op2 = this.shift(this.r[rm], amt, type);
      carry = this.shiftCarry(this.r[rm], amt, type);
      shiftUsed = true;
    }

    if (rn === 15 && !imm && ((op >>> 4) & 1)) op2 = (op2 + 4) >>> 0; // PC 作寄存器偏移
    let a = this.r[rn];
    if (rn === 15) a = (addr !== undefined ? addr + 8 : a);
    let res = 0, writeBack = true;
    const setC = S === 1 && shiftUsed;

    switch (opcode) {
      case 0: res = a & op2; break;
      case 1: res = a ^ op2; break;
      case 2: res = this.doSub(a, op2, S); break;
      case 3: res = this.doSub(op2, a, S); break;
      case 4: res = this.doAdd(a, op2, S); break;
      case 5: res = this.doAddC(a, op2, this.flagC, S); break;
      case 6: res = this.doSubC(a, op2, this.flagC, S); break;
      case 7: res = this.doSubC(op2, a, this.flagC, S); break;
      case 8: res = a & op2; writeBack = false; break;
      case 9: res = a ^ op2; writeBack = false; break;
      case 10: res = this.doSub(a, op2, 1); writeBack = false; break;
      case 11: res = this.doAdd(a, op2, 1); writeBack = false; break;
      case 12: res = a | op2; break;
      case 13: res = op2 >>> 0; break;
      case 14: res = a & ~op2; break;
      default: res = (~op2) >>> 0; break;
    }
    if (writeBack && rd !== 15) this.r[rd] = res >>> 0;
    if (writeBack && rd === 15) {
      if (S) { // 恢复 CPSR（SPSR→CPSR）
        const newCpsr = this.spsr;
        this.setMode((newCpsr & 0x1f) | ((newCpsr & 0x20) ? 0 : 0));
        this.cpsr = newCpsr;
      }
      this.r[15] = (res + 8) >>> 0;
      return true;
    }
    // 标志位：TST(8)/TEQ(9) 的 S 位隐含为 1，之前漏了处理，
    // 导致 `tst r1,#xxx` 之后条件码用的还是上一条指令的旧标志 → 死循环。
    // CMP(10)/CMN(11) 的 doSub/doAdd 里已经算好，不重复设置。
    if (S && opcode !== 10 && opcode !== 11) {
      this.setNZ(res);
      if (setC) {
        let f = this.cpsr & ~0x20000000;
        if (carry) f |= 0x20000000;
        this.cpsr = f;
      }
    }
    return false;
  }

  doAdd(a, b, s) {
    const r = (a + b) >>> 0;
    if (s) {
      const c = (a >>> 0) + (b >>> 0) > 0xffffffff ? 1 : 0;
      const v = (((a ^ r) & (b ^ r)) >>> 31) & 1;
      this.setFlags((r >>> 31) & 1, r === 0 ? 1 : 0, c, v);
    }
    return r;
  }
  doAddC(a, b, carryIn, s) {
    const r = (a + b + carryIn) >>> 0;
    if (s) {
      const c = ((a >>> 0) + (b >>> 0) + carryIn) > 0xffffffff ? 1 : 0;
      const v = (((a ^ r) & (b ^ r)) >>> 31) & 1;
      this.setFlags((r >>> 31) & 1, r === 0 ? 1 : 0, c, v);
    }
    return r;
  }
  doSub(a, b, s) {
    const r = (a - b) >>> 0;
    if (s) {
      const c = (a >>> 0) >= (b >>> 0) ? 1 : 0;
      const v = (((a ^ b) & (a ^ r)) >>> 31) & 1;
      this.setFlags((r >>> 31) & 1, r === 0 ? 1 : 0, c, v);
    }
    return r;
  }
  doSubC(a, b, carryIn, s) {
    const r = (a - b - (1 - carryIn)) >>> 0;
    if (s) {
      const c = (a >>> 0) >= ((b >>> 0) + (1 - carryIn)) ? 1 : 0;
      const v = (((a ^ b) & (a ^ r)) >>> 31) & 1;
      this.setFlags((r >>> 31) & 1, r === 0 ? 1 : 0, c, v);
    }
    return r;
  }

  writeStatus(useSpsr, v, op) {
    if (useSpsr) { this.spsr = v; return; }
    // 只更新可写字段（用户模式不能改控制位）
    let mask = 0;
    const f = (op >>> 19) & 1, s = (op >>> 18) & 1, x = (op >>> 17) & 1, c = (op >>> 16) & 1;
    if (c && (this.cpsr & 0x1f) !== MODE_USER) mask |= 0xff;
    if (x) mask |= 0x0000ff00;
    if (s) mask |= 0x00ff0000;
    if (f) mask |= 0xff000000;
    const newVal = (this.cpsr & ~mask) | (v & mask);
    if (((newVal & 0x1f) !== (this.cpsr & 0x1f))) this.setMode(newVal & 0x1f);
    this.cpsr = newVal;
  }

  armMem(op) {
    const p = (op >>> 24) & 1, u = (op >>> 23) & 1, b = (op >>> 22) & 1;
    const w = (op >>> 21) & 1, l = (op >>> 20) & 1;
    const rn = (op >>> 16) & 0xf, rd = (op >>> 12) & 0xf;
    const regOff = (op >>> 25) & 1;
    let off = 0;
    if (regOff) {
      const rm = op & 0xf;
      const amt = (op >>> 7) & 0x1f, type = (op >>> 5) & 3;
      off = this.shift(this.r[rm], amt, type);
    } else {
      off = op & 0xfff;
    }
    // 半字/有符号：bits27-25=000、bit22=1、bits7&4=1
    if (((op >>> 22) & 1) === 1 && (op & 0x90) === 0x90) {
      const kind = (op >>> 5) & 3; // 1:H 2:SB 3:SH
      off = ((op >>> 8) & 0xf) << 4 | (op & 0xf);   // 半字专用 8 位偏移
      let base = this.r[rn];
      const addr = (base + (u ? off : -off)) >>> 0;
      if (l) {
        let v;
        if (kind === 1) { v = this.m.read16(addr); this.addCycles(this.m.wait(addr)); }
        else if (kind === 2) { v = this.m.read8(addr) | 0; if (v & 0x80) v |= 0xffffff00; this.addCycles(this.m.wait(addr)); }
        else { v = this.m.read16(addr); if (v & 0x8000) v |= 0xffff0000; this.addCycles(this.m.wait(addr)); }
        this.r[rd] = v >>> 0;
      } else {
        this.m.write16(addr, this.r[rd] & 0xffff);
        this.addCycles(this.m.wait(addr));
      }
      if (!p || w) this.r[rn] = addr >>> 0;
      return false;
    }
    let base = this.r[rn];
    if (rn === 15) base = this.r[15];
    const eff = (base + (u ? off : -off)) >>> 0;
    const addr = p ? eff : base;
    if (l) {
      if (b) { this.r[rd] = this.m.read8(addr); }
      else {
        let v = this.m.read32(addr);
        if (addr & 3) { // 未对齐字加载：ROR
          const ror = (addr & 3) * 8;
          v = ((v >>> ror) | (v << (32 - ror))) >>> 0;
        }
        this.r[rd] = v >>> 0;
      }
      this.addCycles(this.m.wait(addr));
      if (rd === 15) { this.r[15] = (this.r[rd] + 8) >>> 0; return true; }
    } else {
      let v = this.r[rd];
      if (rd === 15) v = (this.r[15] + 4) >>> 0;
      if (b) this.m.write8(addr, v & 0xff); else this.m.write32(addr, v >>> 0);
      this.addCycles(this.m.wait(addr));
    }
    if (!p || w) {
      if (rn !== 15) this.r[rn] = eff >>> 0;
    }
    return false;
  }

  armBlock(op) {
    const p = (op >>> 24) & 1, u = (op >>> 23) & 1, s = (op >>> 22) & 1;
    const w = (op >>> 21) & 1, l = (op >>> 20) & 1;
    const rn = (op >>> 16) & 0xf;
    const list = op & 0xffff;
    let base = this.r[rn];
    const oldMode = this.cpsr & 0x1f;
    if (s && (list & 0x8000) === 0 && l) this.setMode(MODE_USER);
    let addr = base;
    let first = true;
    for (let i = 0; i < 16; i++) {
      const bit = u ? i : 15 - i;
      if (!((list >>> bit) & 1)) continue;
      if (p) addr = (addr + (u ? 4 : -4)) >>> 0;
      if (l) {
        const v = this.m.read32(addr);
        this.addCycles(this.m.wait(addr));
        if (bit === 15 && s) {
          const nv = v;
          this.setMode((nv & 0x1f) | 0);
          this.cpsr = nv;
        }
        if (bit === 15) { this.r[15] = (v + 8) >>> 0; }
        else this.r[bit] = v >>> 0;
      } else {
        let v = this.r[bit];
        if (bit === 15) v = (this.r[15] + 4) >>> 0;
        this.m.write32(addr, v >>> 0);
        this.addCycles(this.m.wait(addr));
      }
      if (!p) addr = (addr + (u ? 4 : -4)) >>> 0;
      first = false;
    }
    if (w && l === 0) this.r[rn] = addr >>> 0;
    if (w && l === 1 && !s) this.r[rn] = addr >>> 0;
    if (s && (this.cpsr & 0x1f) !== oldMode) this.setMode(oldMode);
    if (l && ((list >>> 15) & 1)) return true;
    return false;
  }

  armBranch(op) {
    const link = (op >>> 24) & 1;
    let off = op & 0xffffff;
    if (off & 0x800000) off |= 0xff000000;
    off = off << 2;
    if (link) this.r[14] = (this.r[15] - 4) >>> 0;
    // 目标地址 = PC(addr+8) + off；本实现中 r15 恒等于「下条取指地址 + 8」，故再 +8
    this.r[15] = (this.r[15] + off + 8) >>> 0;
    this.addCycles(2);
    return true;
  }

  armSWI(op) {
    if (this.swiHook) {
      this.swiHook(op & 0xffffff);
      // HLE 不切 SVC 模式、也不改 PC 的话，返回 false 交给 stepARM 自增，
      // 否则会在同一条 SWI 上原地死循环（早期真机 ROM 就卡在这里）
      return false;
    }
    this.raiseException(MODE_SVC, this.r[15] - 8, 0);
    return true;
  }

  // ================= Thumb =================
  stepThumb() {
    const addr = (this.r[15] - 4) >>> 0;
    const op = this.m.read16(addr & ~1);
    this.r[15] = (addr + 4) >>> 0;
    this.addCycles(1);
    const mod = this.execThumb(op, addr);
    if (!mod) this.r[15] = (addr + 6) >>> 0;
  }

  execThumb(op, addr) {
    // Thumb 指令分组（按 bits15-12）：
    //   0x0-0x1  LSL/LSR/ASR、ADD/SUB（寄存器或 3 位立即数）
    //   0x2-0x3  MOV/CMP/ADD/SUB 8 位立即数
    //   0x4      ALU 运算 + 高寄存器/BX（0x4000-0x47FF）、LDR Rd,[PC]（0x4800-0x4FFF）
    // 原来这一组整体错位两档：0x2 被派去 thumbMisc，0x4 被派去 load/store，
    // 于是 `movs r3,#0x80` 被当成 BX 执行，PC 直接跳到 r0 的值（真机 ROM 就崩在这）。
    switch (op >>> 12) {
      case 0x0: case 0x1: return this.thumbShiftAddSub(op);
      case 0x2: case 0x3: return this.thumbImm(op);
      case 0x4: return ((op >>> 11) & 1) ? this.thumbLdPc(op, addr) : this.thumbMisc(op, addr);
      case 0x5: return this.thumbLdStReg(op);
      case 0x6: case 0x7: return this.thumbLdStImm(op);
      case 0x8: return this.thumbLdStHw(op);
      case 0x9: return this.thumbSpRel(op);
      case 0xa: return this.thumbAddr(op, addr);
      case 0xb: return this.thumbMisc2(op);
      case 0xc: return this.thumbStmLdm(op);
      case 0xd: return this.thumbCondBranch(op);
      default: return this.thumbLongBranch(op);
    }
  }

  thumbShiftAddSub(op) {
    const kind = (op >>> 11) & 3;
    const rd = op & 7, rs = (op >>> 3) & 7;
    if (kind < 3) {
      const amt = (op >>> 6) & 0x1f;
      const v = this.r[rs];
      let res = 0, c;
      if (kind === 0) { res = amt === 0 ? v : (v << amt) >>> 0; c = amt === 0 ? this.flagC : (amt > 32 ? 0 : (v >>> (32 - amt)) & 1); }
      else if (kind === 1) { res = (amt === 0 ? 0 : (v >>> amt)) >>> 0; c = amt === 0 ? ((v >>> 31) & 1) : ((v >>> (amt - 1)) & 1); }
      else { const a = amt === 0 ? 32 : amt; res = (v >> a) >>> 0; c = amt === 0 ? ((v >>> 31) & 1) : ((v >> (amt - 1)) & 1); }
      this.r[rd] = res >>> 0;
      this.setFlags((res >>> 31) & 1, res === 0 ? 1 : 0, c ? 1 : 0, this.flagV);
      return false;
    }
    const sub = (op >>> 10) & 1;
    const imm = (op >>> 9) & 1;
    const b = imm ? ((op >>> 6) & 7) : this.r[(op >>> 6) & 7];
    const res = sub ? this.doSub(this.r[rs], b, 1) : this.doAdd(this.r[rs], b, 1);
    this.r[rd] = res >>> 0;
    return false;
  }

  thumbImm(op) {
    const kind = (op >>> 11) & 3;
    const rd = (op >>> 8) & 7;
    const imm = op & 0xff;
    if (kind === 0) { this.r[rd] = imm; this.setNZ(imm); }
    else if (kind === 1) { this.doSub(this.r[rd], imm, 1); }
    else if (kind === 2) { this.r[rd] = this.doAdd(this.r[rd], imm, 1) >>> 0; }
    else { this.r[rd] = this.doSub(this.r[rd], imm, 1) >>> 0; }
    return false;
  }

  thumbMisc(op, addr) {
    const sub = op & 0x0200;
    if (sub) { // 0b010001：高位寄存器 / BX / BLX
      const kind = (op >>> 8) & 3;
      // 高位标志的位置：bit7 = Rd 的高位，bit6 = Rm 的高位。
      // 原来两个标志接反了，`bx lr`(0x4770) 会被解成 `bx r6`，
      // `mov r7,r10`(0x4657) 会被解成 `mov pc,r2` 直接跳飞。
      const hd = (op >>> 7) & 1;    // Rd 高位
      const hs = (op >>> 6) & 1;    // Rm 高位
      const rs = ((op >>> 3) & 7) | (hs ? 8 : 0);
      const rd = (op & 7) | (hd ? 8 : 0);
      if (kind === 0) { this.r[rd] = (this.r[rd] + this.r[rs]) >>> 0; if (rd === 15) { this.r[15] = (this.r[15] + 4) >>> 0; return true; } }
      else if (kind === 1) { this.doSub(this.r[rd], this.r[rs], 1); }
      else if (kind === 2) { this.r[rd] = this.r[rs] >>> 0; if (rd === 15) { this.r[15] = (this.r[15] + 4) >>> 0; return true; } }
      else {
        const t = this.r[rs];
        if ((op >>> 7) & 1) { // BLX Rs
          this.r[14] = (this.r[15] - 2) >>> 0;
        }
        if (t & 1) { this.cpsr |= 0x20; this.r[15] = ((t & ~1) + 4) >>> 0; }
        else { this.cpsr &= ~0x20; this.r[15] = (t + 8) >>> 0; }
        return true;
      }
      return false;
    }
    // 0b010000：寄存器运算
    const opc = (op >>> 6) & 0xf;
    const rs = (op >>> 3) & 7, rd = op & 7;
    const a = this.r[rd], b = this.r[rs];
    switch (opc) {
      case 0: { const r = a & b; this.r[rd] = r; this.setNZ(r); break; }
      case 1: { const r = a ^ b; this.r[rd] = r; this.setNZ(r); break; }
      case 2: { const amt = b & 0xff; const r = amt >= 32 ? 0 : (a << amt) >>> 0; const c = amt > 32 ? 0 : (a >>> (32 - amt)) & 1; this.r[rd] = r; this.setFlags((r >>> 31) & 1, r === 0 ? 1 : 0, c, this.flagV); break; }
      case 3: { const amt = b & 0xff; const r = amt >= 32 ? 0 : (a >>> amt) >>> 0; const c = amt >= 32 ? ((a >>> 31) & 1) : ((a >>> (amt - 1)) & 1); this.r[rd] = r; this.setFlags((r >>> 31) & 1, r === 0 ? 1 : 0, c, this.flagV); break; }
      case 4: { const amt = b & 0xff; const a2 = amt === 0 ? 32 : amt; const r = (a >> a2) >>> 0; const c = amt === 0 ? ((a >>> 31) & 1) : ((a >> (amt - 1)) & 1); this.r[rd] = r; this.setFlags((r >>> 31) & 1, r === 0 ? 1 : 0, c, this.flagV); break; }
      case 5: this.r[rd] = this.doAddC(a, b, this.flagC, 1) >>> 0; break;
      case 6: this.r[rd] = this.doSubC(a, b, this.flagC, 1) >>> 0; break;
      case 7: { const amt = b & 0x1f; const r = amt === 0 ? a : ((a >>> amt) | (a << (32 - amt))) >>> 0; const c = amt === 0 ? ((a >>> 31) & 1) : ((a >>> (amt - 1)) & 1); this.r[rd] = r; this.setFlags((r >>> 31) & 1, r === 0 ? 1 : 0, c, this.flagV); break; }
      case 8: { const r = a & b; this.setNZ(r); break; }
      case 9: { this.doSub(0, b, 1); this.r[rd] = (0 - b) >>> 0; break; }
      case 10: this.doSub(a, b, 1); break;
      case 11: this.doAdd(a, b, 1); break;
      case 12: { const r = a | b; this.r[rd] = r; this.setNZ(r); break; }
      case 13: { const r = (a * b) >>> 0; this.r[rd] = r; this.setNZ(r); break; }
      case 14: { const r = a & ~b; this.r[rd] = r; this.setNZ(r); break; }
      default: { const r = (~b) >>> 0; this.r[rd] = r; this.setNZ(r); break; }
    }
    return false;
  }

  thumbLdStImm(op) {
    // 0x6000-0x7FFF：bit12 = B（1=字节），bit11 = L（1=读），imm5 按单位缩放。
    // 原实现拿 bits15-12 当类别，把 0x6800-0x6FFF 的 LDR 当成了 STR ——
    // 于是 `ldr r0,[r1,#8]` 变成不停往 DMA 控制寄存器写值，
    // 触发几万次 DMA 传输，游戏永远等不到完成。
    const b = (op >>> 12) & 1;
    const l = (op >>> 11) & 1;
    const rd = op & 7, rb = (op >>> 3) & 7;
    const off = ((op >>> 6) & 0x1f) * (b ? 1 : 4);
    const addr = (this.r[rb] + off) >>> 0;
    if (b) {
      if (l) this.r[rd] = this.m.read8(addr);
      else this.m.write8(addr, this.r[rd] & 0xff);
    } else {
      if (l) this.r[rd] = this.m.read32(addr);
      else this.m.write32(addr, this.r[rd]);
    }
    this.addCycles(this.m.wait(addr));
    return false;
  }

  thumbLdStReg(op) {
    const kind = (op >>> 9) & 7;
    const rd = op & 7, rb = (op >>> 3) & 7, ro = (op >>> 6) & 7;
    const addr = (this.r[rb] + this.r[ro]) >>> 0;
    switch (kind) {
      case 0: this.m.write32(addr, this.r[rd]); break;
      case 1: this.m.write16(addr, this.r[rd] & 0xffff); break;
      case 2: this.m.write8(addr, this.r[rd] & 0xff); break;
      case 3: { const v = this.m.read8(addr); this.r[rd] = (v & 0x80) ? (v | 0xffffff00) >>> 0 : v; break; }
      case 4: this.r[rd] = this.m.read32(addr); break;
      case 5: this.r[rd] = this.m.read16(addr); break;
      case 6: this.r[rd] = this.m.read8(addr); break;
      case 7: { const v = this.m.read16(addr); this.r[rd] = (v & 0x8000) ? (v | 0xffff0000) >>> 0 : v; break; }
    }
    this.addCycles(this.m.wait(addr));
    return false;
  }

  thumbLdStHw(op) {
    const sub = (op >>> 11) & 1;
    const rd = op & 7, rb = (op >>> 3) & 7;
    const off = ((op >>> 6) & 0x1f) << 1;
    const addr = (this.r[rb] + off) >>> 0;
    if (sub) this.r[rd] = this.m.read16(addr);
    else this.m.write16(addr, this.r[rd] & 0xffff);
    this.addCycles(this.m.wait(addr));
    return false;
  }

  thumbSpRel(op) {
    const l = (op >>> 11) & 1;
    const rd = (op >>> 8) & 7;
    const addr = (this.r[13] + ((op & 0xff) * 4)) >>> 0;
    if (l) this.r[rd] = this.m.read32(addr); else this.m.write32(addr, this.r[rd]);
    this.addCycles(this.m.wait(addr));
    return false;
  }

  thumbLdPc(op, addr) {
    const rd = (op >>> 8) & 7;
    const a = (((addr + 4) & ~3) + ((op & 0xff) * 4)) >>> 0;
    this.r[rd] = this.m.read32(a);
    this.addCycles(this.m.wait(a));
    return false;
  }

  thumbAddr(op, addr) {
    const sp = (op >>> 11) & 1;
    const rd = (op >>> 8) & 7;
    const base = sp ? this.r[13] : ((addr + 4) & ~3);
    this.r[rd] = (base + ((op & 0xff) * 4)) >>> 0;
    return false;
  }

  thumbMisc2(op) {
    const kind = (op >>> 8) & 0xf;
    if (kind === 0) { this.r[13] = (this.r[13] + ((op & 0x7f) * 4)) >>> 0; return false; }
    if (kind === 1) { this.r[13] = (this.r[13] - ((op & 0x7f) * 4)) >>> 0; return false; }
    const pop = (op >>> 11) & 1;
    const list = op & 0xff;
    let sp = this.r[13];
    if (!pop) {
      if (op & 0x100) sp = (sp - 4) >>> 0;
      for (let i = 0; i < 8; i++) if ((list >>> i) & 1) { sp = (sp - 4) >>> 0; this.m.write32(sp, this.r[i]); }
      if (op & 0x100) { sp = (sp - 4) >>> 0; this.m.write32(sp, this.r[14]); }
    } else {
      for (let i = 0; i < 8; i++) if ((list >>> i) & 1) { this.r[i] = this.m.read32(sp); sp = (sp + 4) >>> 0; }
      if (op & 0x100) { this.r[15] = (this.m.read32(sp) + 4) >>> 0; sp = (sp + 4) >>> 0; }
    }
    this.r[13] = sp >>> 0;
    return !!(pop && (op & 0x100));
  }

  thumbStmLdm(op) {
    const l = (op >>> 11) & 1;
    const rb = (op >>> 8) & 7;
    const list = op & 0xff;
    let addr = this.r[rb];
    if (list === 0) { // 空列表：STM 存 R15，LDM 读 R15
      if (l) { this.r[15] = (this.m.read32(addr) + 4) >>> 0; this.r[rb] = (addr + 0x40) >>> 0; return true; }
      this.m.write32(addr, this.r[15] + 2);
      this.r[rb] = (addr + 0x40) >>> 0;
      return false;
    }
    for (let i = 0; i < 8; i++) {
      if (!((list >>> i) & 1)) continue;
      if (l) { this.r[i] = this.m.read32(addr); this.addCycles(this.m.wait(addr)); }
      else { this.m.write32(addr, this.r[i]); this.addCycles(this.m.wait(addr)); }
      addr = (addr + 4) >>> 0;
    }
    if (!l || !((list >>> rb) & 1)) this.r[rb] = addr >>> 0;
    return false;
  }

  thumbCondBranch(op) {
    if (((op >>> 8) & 0xf) === 0xf) { // SWI
      if (this.swiHook) { this.swiHook(op & 0xff); return false; }
      this.raiseException(MODE_SVC, this.r[15] - 4, 0);
      return true;
    }
    const cond = (op >>> 8) & 0xf;
    if (!COND_TABLE(this.cpsr, cond)) return false;
    let off = op & 0xff;
    if (off & 0x80) off |= 0xffffff00;
    this.r[15] = (this.r[15] + (off << 1) + 4) >>> 0;   // +4：r15 恒等于取指地址 +4
    this.addCycles(2);
    return true;
  }

  thumbLongBranch(op) {
    // Thumb 的长跳转占两条半字，按 bits15-11 区分：
    //   11100 → h=0  B（无条件）
    //   11110 → h=2  BL/BLX 前半（存 LR = PC + off<<12）
    //   11111 → h=3  BL 后半
    //   11101 → h=1  BLX 后半
    // 旧实现把 h=2 当"后半"、h=1 当"前半"，于是执行到 BL 前半时会拿上一次
    // 残留的 LR 去算目标，直接跳进 ROM 数据区（PC 变成奇数地址）。
    const h = (op >>> 11) & 3;
    if (h === 0) {
      let off = op & 0x7ff;
      if (off & 0x400) off |= 0xfffff800;
      this.r[15] = (this.r[15] + (off << 1) + 4) >>> 0;
      this.addCycles(2);
      return true;
    }
    if (h === 2) { // 前半：LR = PC + off<<12（执行期 r15 = 本条地址 + 4）
      let off = op & 0x7ff;
      if (off & 0x400) off |= 0xfffff800;
      this.r[14] = (this.r[15] + (off << 12)) >>> 0;
      return false;
    }
    // 后半（h=3 BL / h=1 BLX）：target = LR + off<<1
    const target = (this.r[14] + ((op & 0x7ff) << 1)) >>> 0;
    this.r[14] = ((this.r[15] - 2) | 1) >>> 0;
    if (h === 3) {                       // BL：保持 Thumb
      this.r[15] = (target + 4) >>> 0;
    } else {                             // BLX：切到 ARM
      this.cpsr &= ~0x20;
      this.r[15] = (((target & ~3) >>> 0) + 8) >>> 0;
    }
    this.addCycles(2);
    return true;
  }

  step() {
    if (this.cpsr & 0x20) this.stepThumb(); else this.stepARM();
  }
}
