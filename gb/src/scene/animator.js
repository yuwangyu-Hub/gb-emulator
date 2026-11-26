// 轻量补间动画系统

const EASE = {
  linear: (t) => t,
  inQuad: (t) => t * t,
  outQuad: (t) => t * (2 - t),
  inOutQuad: (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inCubic: (t) => t * t * t,
  outBack: (t) => {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  outElastic: (t) => {
    const c4 = (2 * Math.PI) / 3;
    if (t === 0 || t === 1) return t;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  },
};

export class Animator {
  constructor() {
    this.tweens = [];
  }

  add({ duration = 1, delay = 0, ease = 'outCubic', onUpdate, onComplete }) {
    const tw = {
      duration, delay, ease: EASE[ease] || EASE.outCubic,
      onUpdate, onComplete, t: -delay, done: false,
    };
    this.tweens.push(tw);
    return tw;
  }

  sequence(steps) {
    // steps: [{duration, ease, onUpdate}] 依次执行
    const play = (i) => {
      if (i >= steps.length) return;
      const s = steps[i];
      this.add({
        duration: s.duration, delay: s.delay || 0, ease: s.ease,
        onUpdate: s.onUpdate,
        onComplete: () => {
          if (s.onComplete) s.onComplete();
          play(i + 1);
        },
      });
    };
    play(0);
  }

  update(dt) {
    for (const tw of this.tweens) {
      if (tw.done) continue;
      tw.t += dt;
      if (tw.t < 0) continue;
      const p = Math.min(1, tw.t / tw.duration);
      tw.onUpdate && tw.onUpdate(tw.ease(p), p);
      if (p >= 1) {
        tw.done = true;
        tw.onComplete && tw.onComplete();
      }
    }
    this.tweens = this.tweens.filter((t) => !t.done);
  }

  clear() {
    this.tweens = [];
  }
}
