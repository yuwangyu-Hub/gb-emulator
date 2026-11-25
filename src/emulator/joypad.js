// 手柄（JOYP 0xFF00）
// 方向键: 右 bit0 / 左 bit1 / 上 bit2 / 下 bit3
// 功能键: A bit0 / B bit1 / Select bit2 / Start bit3

export const KEYS = {
  right: 0, left: 1, up: 2, down: 3,
  a: 4, b: 5, select: 6, start: 7,
};

export class Joypad {
  constructor() {
    this.state = 0; // bit0-3 方向, bit4-7 功能键（1 = 按下）
    this.selectDir = true;
    this.selectBtn = true;
  }

  reset() {
    this.state = 0;
    this.selectDir = true;
    this.selectBtn = true;
  }

  press(key) {
    if (key in KEYS) this.state |= (1 << KEYS[key]);
  }

  release(key) {
    if (key in KEYS) this.state &= ~(1 << KEYS[key]) & 0xff;
  }

  set(key, down) {
    if (down) this.press(key); else this.release(key);
  }

  write(v) {
    this.selectDir = (v & 0x10) !== 0;
    this.selectBtn = (v & 0x20) !== 0;
  }

  read() {
    let v = 0x0f;
    const dir = this.state & 0x0f;
    const btn = (this.state >> 4) & 0x0f;
    if (!this.selectDir && !this.selectBtn) v = (~(dir | btn)) & 0x0f;
    else if (!this.selectDir) v = (~dir) & 0x0f;
    else if (!this.selectBtn) v = (~btn) & 0x0f;
    else v = 0x0f;
    return 0xc0 | (this.selectDir ? 0x10 : 0) | (this.selectBtn ? 0x20 : 0) | v;
  }
}
