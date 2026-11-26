// LR35902 (Game Boy CPU) 解释器
// 标志位: Z=0x80 N=0x40 H=0x20 C=0x10

const Z = 0x80;
const N = 0x40;
const H = 0x20;
const C = 0x10;

export class CPU {
  constructor(gb) {
    this.gb = gb;
    this.reset();
  }

  reset() {
    this.a = 0x01; this.f = 0xb0;
    this.b = 0x00; this.c = 0x13;
    this.d = 0x00; this.e = 0xd8;
    this.h = 0x01; this.l = 0x4d;
    this.sp = 0xfffe;
    this.pc = 0x0100;
    this.ime = false;
    this.eiDelay = false;
    this.halted = false;
    this.stopped = false;
    this.haltBug = false;
    this.cycles = 0;
  }

  // ---- 内存访问转发 ----
  rb(addr) { return this.gb.mmu.read(addr & 0xffff); }
  wb(addr, v) { this.gb.mmu.write(addr & 0xffff, v & 0xff); }

  fetch8() {
    const v = this.rb(this.pc);
    this.pc = (this.pc + 1) & 0xffff;
    return v;
  }

  fetch16() {
    const lo = this.fetch8();
    const hi = this.fetch8();
    return (hi << 8) | lo;
  }

  push16(v) {
    this.sp = (this.sp - 2) & 0xffff;
    this.wb(this.sp, v & 0xff);
    this.wb((this.sp + 1) & 0xffff, (v >> 8) & 0xff);
  }

  pop16() {
    const lo = this.rb(this.sp);
    const hi = this.rb((this.sp + 1) & 0xffff);
    this.sp = (this.sp + 2) & 0xffff;
    return (hi << 8) | lo;
  }

  // ---- 16 位寄存器组 ----
  getBC() { return (this.b << 8) | this.c; }
  setBC(v) { this.b = (v >> 8) & 0xff; this.c = v & 0xff; }
  getDE() { return (this.d << 8) | this.e; }
  setDE(v) { this.d = (v >> 8) & 0xff; this.e = v & 0xff; }
  getHL() { return (this.h << 8) | this.l; }
  setHL(v) { this.h = (v >> 8) & 0xff; this.l = v & 0xff; }
  getAF() { return (this.a << 8) | this.f; }
  setAF(v) { this.a = (v >> 8) & 0xff; this.f = v & 0xf0; }

  getRP(i) {
    switch (i) {
      case 0: return this.getBC();
      case 1: return this.getDE();
      case 2: return this.getHL();
      default: return this.sp;
    }
  }
  setRP(i, v) {
    switch (i) {
      case 0: this.setBC(v); break;
      case 1: this.setDE(v); break;
      case 2: this.setHL(v); break;
      default: this.sp = v & 0xffff; break;
    }
  }

  // ---- 8 位寄存器（索引编码） ----
  readR8(i) {
    switch (i) {
      case 0: return this.b;
      case 1: return this.c;
      case 2: return this.d;
      case 3: return this.e;
      case 4: return this.h;
      case 5: return this.l;
      case 6: return this.rb(this.getHL());
      default: return this.a;
    }
  }

  writeR8(i, v) {
    v &= 0xff;
    switch (i) {
      case 0: this.b = v; break;
      case 1: this.c = v; break;
      case 2: this.d = v; break;
      case 3: this.e = v; break;
      case 4: this.h = v; break;
      case 5: this.l = v; break;
      case 6: this.wb(this.getHL(), v); break;
      default: this.a = v; break;
    }
  }

  // ---- 条件 ----
  cond(cc) {
    switch (cc) {
      case 0: return (this.f & Z) === 0; // NZ
      case 1: return (this.f & Z) !== 0; // Z
      case 2: return (this.f & C) === 0; // NC
      default: return (this.f & C) !== 0; // C
    }
  }

  // ---- ALU ----
  alu(op, v) {
    const a = this.a;
    let r;
    switch (op) {
      case 0: { // ADD
        r = a + v;
        this.f = 0;
        if ((r & 0xff) === 0) this.f |= Z;
        if (((a & 0xf) + (v & 0xf)) > 0xf) this.f |= H;
        if (r > 0xff) this.f |= C;
        this.a = r & 0xff;
        break;
      }
      case 1: { // ADC
        const c = (this.f & C) ? 1 : 0;
        r = a + v + c;
        this.f = 0;
        if ((r & 0xff) === 0) this.f |= Z;
        if (((a & 0xf) + (v & 0xf) + c) > 0xf) this.f |= H;
        if (r > 0xff) this.f |= C;
        this.a = r & 0xff;
        break;
      }
      case 2: { // SUB
        r = a - v;
        this.f = N;
        if ((r & 0xff) === 0) this.f |= Z;
        if ((a & 0xf) < (v & 0xf)) this.f |= H;
        if (r < 0) this.f |= C;
        this.a = r & 0xff;
        break;
      }
      case 3: { // SBC
        const c = (this.f & C) ? 1 : 0;
        r = a - v - c;
        this.f = N;
        if ((r & 0xff) === 0) this.f |= Z;
        if ((a & 0xf) < ((v & 0xf) + c)) this.f |= H;
        if (r < 0) this.f |= C;
        this.a = r & 0xff;
        break;
      }
      case 4: { // AND
        r = a & v;
        this.f = H;
        if (r === 0) this.f |= Z;
        this.a = r & 0xff;
        break;
      }
      case 5: { // XOR
        r = a ^ v;
        this.f = 0;
        if (r === 0) this.f |= Z;
        this.a = r & 0xff;
        break;
      }
      case 6: { // OR
        r = a | v;
        this.f = 0;
        if (r === 0) this.f |= Z;
        this.a = r & 0xff;
        break;
      }
      default: { // CP
        r = a - v;
        this.f = N;
        if ((r & 0xff) === 0) this.f |= Z;
        if ((a & 0xf) < (v & 0xf)) this.f |= H;
        if (r < 0) this.f |= C;
        break;
      }
    }
  }

  inc8(v) {
    const r = (v + 1) & 0xff;
    this.f = (this.f & C) | (((r === 0) ? Z : 0)) | ((((v & 0xf) + 1) > 0xf) ? H : 0);
    return r;
  }

  dec8(v) {
    const r = (v - 1) & 0xff;
    this.f = (this.f & C) | N | (((r === 0) ? Z : 0)) | (((v & 0xf) === 0) ? H : 0);
    return r;
  }

  addHL(v) {
    const hl = this.getHL();
    const r = hl + v;
    this.f = (this.f & Z) | ((((hl & 0xfff) + (v & 0xfff)) > 0xfff) ? H : 0) | ((r > 0xffff) ? C : 0);
    this.setHL(r & 0xffff);
  }

  addSP(v) { // v 为有符号 8 位
    const sp = this.sp;
    const r = (sp + v) & 0xffff;
    this.f = 0;
    if (((sp & 0xf) + (v & 0xf)) > 0xf) this.f |= H;
    if (((sp & 0xff) + (v & 0xff)) > 0xff) this.f |= C;
    this.sp = r;
    return r;
  }

  daa() {
    let a = this.a;
    let adjust = 0;
    const carry = (this.f & C) !== 0;
    if (this.f & N) {
      if (this.f & H) adjust |= 0x06;
      if (carry) adjust |= 0x60;
      a = (a - adjust) & 0xff;
    } else {
      if ((this.f & H) || (a & 0x0f) > 0x09) adjust |= 0x06;
      if (carry || a > 0x99) adjust |= 0x60;
      a = (a + adjust) & 0xff;
    }
    this.a = a;
    this.f &= N;
    if (a === 0) this.f |= Z;
    if (adjust & 0x60) this.f |= C;
  }

  // ---- 循环/移位 ----
  rlc(v) {
    const r = ((v << 1) | (v >> 7)) & 0xff;
    this.f = 0;
    if (r === 0) this.f |= Z;
    if (v & 0x80) this.f |= C;
    return r;
  }
  rrc(v) {
    const r = ((v >> 1) | ((v & 1) << 7)) & 0xff;
    this.f = 0;
    if (r === 0) this.f |= Z;
    if (v & 0x01) this.f |= C;
    return r;
  }
  rl(v) {
    const c = (this.f & C) ? 1 : 0;
    const r = ((v << 1) | c) & 0xff;
    this.f = 0;
    if (r === 0) this.f |= Z;
    if (v & 0x80) this.f |= C;
    return r;
  }
  rr(v) {
    const c = (this.f & C) ? 0x80 : 0;
    const r = ((v >> 1) | c) & 0xff;
    this.f = 0;
    if (r === 0) this.f |= Z;
    if (v & 0x01) this.f |= C;
    return r;
  }
  sla(v) {
    const r = (v << 1) & 0xff;
    this.f = 0;
    if (r === 0) this.f |= Z;
    if (v & 0x80) this.f |= C;
    return r;
  }
  sra(v) {
    const r = ((v >> 1) | (v & 0x80)) & 0xff;
    this.f = 0;
    if (r === 0) this.f |= Z;
    if (v & 0x01) this.f |= C;
    return r;
  }
  swap(v) {
    const r = ((v & 0x0f) << 4) | ((v & 0xf0) >> 4);
    this.f = 0;
    if (r === 0) this.f |= Z;
    return r;
  }
  srl(v) {
    const r = v >> 1;
    this.f = 0;
    if (r === 0) this.f |= Z;
    if (v & 0x01) this.f |= C;
    return r;
  }

  // ---- 执行一条指令，返回消耗的周期数 ----
  step() {
    const mmu = this.gb.mmu;

    // 中断检测
    let fired = (mmu.read(0xffff) & mmu.read(0xff0f)) & 0x1f;
    if (fired) {
      if (this.halted && !this.ime) {
        // HALT bug: 退出 halt 但下一条指令的 pc 不自增
        this.halted = false;
        this.haltBug = true;
      } else if (this.ime) {
        this.ime = false;
        this.halted = false;
        let bit = 0;
        while (!((fired >> bit) & 1)) bit++;
        mmu.write(0xff0f, mmu.read(0xff0f) & ~(1 << bit) & 0xff);
        this.push16(this.pc);
        this.pc = 0x40 + bit * 8;
        return 20;
      }
    }

    if (this.halted || this.stopped) return 4;

    // EI 延迟一条指令生效
    if (this.eiDelay) {
      this.eiDelay = false;
      this.ime = true;
    }

    let op;
    if (this.haltBug) {
      op = this.rb(this.pc);
      this.haltBug = false;
    } else {
      op = this.fetch8();
    }

    let cycles = 4;
    const hi = op >> 6;
    const lo = op & 0x07;

    if (op === 0xcb) {
      cycles = this.execCB();
      return cycles;
    }

    switch (op) {
      // ---------- 0x0X ----------
      case 0x00: break; // NOP
      case 0x01: this.setBC(this.fetch16()); cycles = 12; break;
      case 0x02: this.wb(this.getBC(), this.a); cycles = 8; break;
      case 0x03: this.setBC((this.getBC() + 1) & 0xffff); cycles = 8; break;
      case 0x04: this.b = this.inc8(this.b); break;
      case 0x05: this.b = this.dec8(this.b); break;
      case 0x06: this.b = this.fetch8(); cycles = 8; break;
      case 0x07: {
        const r = this.rlc(this.a); this.a = r; this.f &= ~Z & 0xff; break;
      }
      case 0x08: {
        const addr = this.fetch16();
        this.wb(addr, this.sp & 0xff);
        this.wb((addr + 1) & 0xffff, (this.sp >> 8) & 0xff);
        cycles = 20; break;
      }
      case 0x09: this.addHL(this.getBC()); cycles = 8; break;
      case 0x0a: this.a = this.rb(this.getBC()); cycles = 8; break;
      case 0x0b: this.setBC((this.getBC() - 1) & 0xffff); cycles = 8; break;
      case 0x0c: this.c = this.inc8(this.c); break;
      case 0x0d: this.c = this.dec8(this.c); break;
      case 0x0e: this.c = this.fetch8(); cycles = 8; break;
      case 0x0f: {
        const r = this.rrc(this.a); this.a = r; this.f &= ~Z & 0xff; break;
      }

      // ---------- 0x1X ----------
      case 0x10: this.stopped = true; cycles = 4; break; // STOP
      case 0x11: this.setDE(this.fetch16()); cycles = 12; break;
      case 0x12: this.wb(this.getDE(), this.a); cycles = 8; break;
      case 0x13: this.setDE((this.getDE() + 1) & 0xffff); cycles = 8; break;
      case 0x14: this.d = this.inc8(this.d); break;
      case 0x15: this.d = this.dec8(this.d); break;
      case 0x16: this.d = this.fetch8(); cycles = 8; break;
      case 0x17: {
        const r = this.rl(this.a); this.a = r; this.f &= ~Z & 0xff; break;
      }
      case 0x18: {
        const n = this.fetch8();
        this.pc = (this.pc + ((n << 24 >> 24))) & 0xffff;
        cycles = 12; break;
      }
      case 0x19: this.addHL(this.getDE()); cycles = 8; break;
      case 0x1a: this.a = this.rb(this.getDE()); cycles = 8; break;
      case 0x1b: this.setDE((this.getDE() - 1) & 0xffff); cycles = 8; break;
      case 0x1c: this.e = this.inc8(this.e); break;
      case 0x1d: this.e = this.dec8(this.e); break;
      case 0x1e: this.e = this.fetch8(); cycles = 8; break;
      case 0x1f: {
        const r = this.rr(this.a); this.a = r; this.f &= ~Z & 0xff; break;
      }

      // ---------- 0x2X ----------
      case 0x20: cycles = this.jrCond(0); break;
      case 0x21: this.setHL(this.fetch16()); cycles = 12; break;
      case 0x22: {
        const hl = this.getHL();
        this.wb(hl, this.a);
        this.setHL((hl + 1) & 0xffff);
        cycles = 8; break;
      }
      case 0x23: this.setHL((this.getHL() + 1) & 0xffff); cycles = 8; break;
      case 0x24: this.h = this.inc8(this.h); break;
      case 0x25: this.h = this.dec8(this.h); break;
      case 0x26: this.h = this.fetch8(); cycles = 8; break;
      case 0x27: this.daa(); break;
      case 0x28: cycles = this.jrCond(1); break;
      case 0x29: this.addHL(this.getHL()); cycles = 8; break;
      case 0x2a: {
        const hl = this.getHL();
        this.a = this.rb(hl);
        this.setHL((hl + 1) & 0xffff);
        cycles = 8; break;
      }
      case 0x2b: this.setHL((this.getHL() - 1) & 0xffff); cycles = 8; break;
      case 0x2c: this.l = this.inc8(this.l); break;
      case 0x2d: this.l = this.dec8(this.l); break;
      case 0x2e: this.l = this.fetch8(); cycles = 8; break;
      case 0x2f: {
        this.a = (~this.a) & 0xff;
        this.f |= N | H;
        break;
      }

      // ---------- 0x3X ----------
      case 0x30: cycles = this.jrCond(2); break;
      case 0x31: this.sp = this.fetch16(); cycles = 12; break;
      case 0x32: {
        const hl = this.getHL();
        this.wb(hl, this.a);
        this.setHL((hl - 1) & 0xffff);
        cycles = 8; break;
      }
      case 0x33: this.sp = (this.sp + 1) & 0xffff; cycles = 8; break;
      case 0x34: {
        const hl = this.getHL();
        this.wb(hl, this.inc8(this.rb(hl)));
        cycles = 12; break;
      }
      case 0x35: {
        const hl = this.getHL();
        this.wb(hl, this.dec8(this.rb(hl)));
        cycles = 12; break;
      }
      case 0x36: {
        this.wb(this.getHL(), this.fetch8());
        cycles = 12; break;
      }
      case 0x37: {
        this.f = (this.f & Z) | C;
        break;
      }
      case 0x38: cycles = this.jrCond(3); break;
      case 0x39: this.addHL(this.sp); cycles = 8; break;
      case 0x3a: {
        const hl = this.getHL();
        this.a = this.rb(hl);
        this.setHL((hl - 1) & 0xffff);
        cycles = 8; break;
      }
      case 0x3b: this.sp = (this.sp - 1) & 0xffff; cycles = 8; break;
      case 0x3c: this.a = this.inc8(this.a); break;
      case 0x3d: this.a = this.dec8(this.a); break;
      case 0x3e: this.a = this.fetch8(); cycles = 8; break;
      case 0x3f: {
        this.f = (this.f & (Z | N)) | (((this.f & C) ? 0 : C));
        break;
      }

      // ---------- 0x4X - 0x7X: LD r,r' ----------
      default: {
        if (hi === 1) { // 0x40-0x7F
          if (op === 0x76) {
            this.halted = true;
          } else {
            this.writeR8((op >> 3) & 7, this.readR8(op & 7));
            if ((op & 7) === 6 || ((op >> 3) & 7) === 6) cycles = 8;
          }
          break;
        }
        if (hi === 2) { // 0x80-0xBF: ALU A,r
          this.alu((op >> 3) & 7, this.readR8(op & 7));
          if ((op & 7) === 6) cycles = 8;
          break;
        }
        // hi === 3: 0xC0-0xFF
        cycles = this.execHigh(op);
        break;
      }
    }
    return cycles;
  }

  jrCond(cc) {
    const n = this.fetch8();
    if (this.cond(cc)) {
      this.pc = (this.pc + ((n << 24 >> 24))) & 0xffff;
      return 12;
    }
    return 8;
  }

  // 0xC0 - 0xFF
  execHigh(op) {
    let cycles = 4;
    switch (op) {
      case 0xc0: return this.retCond(0);
      case 0xc1: this.setBC(this.pop16()); return 12;
      case 0xc2: return this.jpCond(0);
      case 0xc3: this.pc = this.fetch16(); return 16;
      case 0xc4: return this.callCond(0);
      case 0xc5: this.push16(this.getBC()); return 16;
      case 0xc6: this.alu(0, this.fetch8()); return 8;
      case 0xc7: return this.rst(0x00);
      case 0xc8: return this.retCond(1);
      case 0xc9: this.pc = this.pop16(); return 16;
      case 0xca: return this.jpCond(1);
      case 0xcc: return this.callCond(1);
      case 0xcd: {
        const nn = this.fetch16();
        this.push16(this.pc);
        this.pc = nn;
        return 24;
      }
      case 0xce: this.alu(1, this.fetch8()); return 8;
      case 0xcf: return this.rst(0x08);

      case 0xd0: return this.retCond(2);
      case 0xd1: this.setDE(this.pop16()); return 12;
      case 0xd2: return this.jpCond(2);
      case 0xd4: return this.callCond(2);
      case 0xd5: this.push16(this.getDE()); return 16;
      case 0xd6: this.alu(2, this.fetch8()); return 8;
      case 0xd7: return this.rst(0x10);
      case 0xd8: return this.retCond(3);
      case 0xd9: {
        this.pc = this.pop16();
        this.ime = true;
        this.eiDelay = false;
        return 16;
      }
      case 0xda: return this.jpCond(3);
      case 0xdc: return this.callCond(3);
      case 0xde: this.alu(3, this.fetch8()); return 8;
      case 0xdf: return this.rst(0x18);

      case 0xe0: {
        this.wb(0xff00 + this.fetch8(), this.a);
        return 12;
      }
      case 0xe1: this.setHL(this.pop16()); return 12;
      case 0xe2: this.wb(0xff00 + this.c, this.a); return 8;
      case 0xe5: this.push16(this.getHL()); return 16;
      case 0xe6: this.alu(4, this.fetch8()); return 8;
      case 0xe7: return this.rst(0x20);
      case 0xe8: {
        const n = this.fetch8();
        this.addSP((n << 24 >> 24));
        return 16;
      }
      case 0xe9: this.pc = this.getHL(); return 4;
      case 0xea: {
        this.wb(this.fetch16(), this.a);
        return 16;
      }
      case 0xee: this.alu(5, this.fetch8()); return 8;
      case 0xef: return this.rst(0x28);

      case 0xf0: {
        this.a = this.rb(0xff00 + this.fetch8());
        return 12;
      }
      case 0xf1: {
        const v = this.pop16();
        this.setAF(v);
        return 12;
      }
      case 0xf2: this.a = this.rb(0xff00 + this.c); return 8;
      case 0xf3: this.ime = false; this.eiDelay = false; return 4; // DI
      case 0xf5: this.push16(this.getAF()); return 16;
      case 0xf6: this.alu(6, this.fetch8()); return 8;
      case 0xf7: return this.rst(0x30);
      case 0xf8: {
        const n = this.fetch8();
        const r = this.addSP((n << 24 >> 24));
        this.setHL(r);
        return 12;
      }
      case 0xf9: this.sp = this.getHL(); return 8;
      case 0xfa: {
        this.a = this.rb(this.fetch16());
        return 16;
      }
      case 0xfb: this.eiDelay = true; return 4; // EI
      case 0xfe: this.alu(7, this.fetch8()); return 8;
      case 0xff: return this.rst(0x38);

      default:
        // 未定义的非法指令（如 0xD3/0xE3 等），按 NOP 处理
        return 4;
    }
    return cycles;
  }

  retCond(cc) {
    if (this.cond(cc)) {
      this.pc = this.pop16();
      return 20;
    }
    return 8;
  }

  jpCond(cc) {
    const nn = this.fetch16();
    if (this.cond(cc)) {
      this.pc = nn;
      return 16;
    }
    return 12;
  }

  callCond(cc) {
    const nn = this.fetch16();
    if (this.cond(cc)) {
      this.push16(this.pc);
      this.pc = nn;
      return 24;
    }
    return 12;
  }

  rst(addr) {
    this.push16(this.pc);
    this.pc = addr;
    return 16;
  }

  // CB 前缀指令
  execCB() {
    const op = this.fetch8();
    const reg = op & 7;
    let v = this.readR8(reg);
    const type = (op >> 3) & 7;
    const bit = (op >> 3) & 7;

    if (op < 0x40) {
      switch (type) {
        case 0: v = this.rlc(v); break;
        case 1: v = this.rrc(v); break;
        case 2: v = this.rl(v); break;
        case 3: v = this.rr(v); break;
        case 4: v = this.sla(v); break;
        case 5: v = this.sra(v); break;
        case 6: v = this.swap(v); break;
        default: v = this.srl(v); break;
      }
      this.writeR8(reg, v);
      return reg === 6 ? 16 : 8;
    }

    if (op < 0x80) { // BIT
      this.f = (this.f & C) | H | (((v & (1 << bit)) === 0) ? Z : 0);
      return reg === 6 ? 12 : 8;
    }
    if (op < 0xc0) { // RES
      v &= ~(1 << bit) & 0xff;
      this.writeR8(reg, v);
      return reg === 6 ? 16 : 8;
    }
    // SET
    v |= (1 << bit) & 0xff;
    this.writeR8(reg, v);
    return reg === 6 ? 16 : 8;
  }

  serialize() {
    return {
      a: this.a, f: this.f, b: this.b, c: this.c, d: this.d, e: this.e,
      h: this.h, l: this.l, sp: this.sp, pc: this.pc,
      ime: this.ime, eiDelay: this.eiDelay, halted: this.halted,
    };
  }

  deserialize(s) {
    this.a = s.a; this.f = s.f; this.b = s.b; this.c = s.c;
    this.d = s.d; this.e = s.e; this.h = s.h; this.l = s.l;
    this.sp = s.sp; this.pc = s.pc;
    this.ime = s.ime; this.eiDelay = s.eiDelay; this.halted = s.halted;
  }
}
