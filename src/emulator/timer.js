// 计时器：DIV / TIMA / TMA / TAC

const TAC_THRESHOLDS = [1024, 16, 64, 256]; // 4096Hz / 262144Hz / 65536Hz / 16384Hz

export class Timer {
  constructor(gb) {
    this.gb = gb;
    this.reset();
  }

  reset() {
    this.div = 0;
    this.tima = 0;
    this.tma = 0;
    this.tac = 0;
    this.divCounter = 0;
    this.timaCounter = 0;
  }

  step(cycles) {
    // DIV 每 256 周期递增（16384 Hz）
    this.divCounter += cycles;
    while (this.divCounter >= 256) {
      this.divCounter -= 256;
      this.div = (this.div + 1) & 0xff;
    }

    if (this.tac & 0x04) {
      this.timaCounter += cycles;
      const threshold = TAC_THRESHOLDS[this.tac & 0x03];
      while (this.timaCounter >= threshold) {
        this.timaCounter -= threshold;
        this.tima = (this.tima + 1) & 0xff;
        if (this.tima === 0) {
          this.tima = this.tma;
          this.gb.requestInterrupt(2); // Timer 中断
        }
      }
    }
  }

  serialize() {
    return {
      div: this.div, tima: this.tima, tma: this.tma, tac: this.tac,
      divCounter: this.divCounter, timaCounter: this.timaCounter,
    };
  }

  deserialize(s) {
    this.div = s.div; this.tima = s.tima; this.tma = s.tma; this.tac = s.tac;
    this.divCounter = s.divCounter; this.timaCounter = s.timaCounter;
  }
}
