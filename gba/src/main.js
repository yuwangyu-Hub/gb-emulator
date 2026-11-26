// GBA 网页模拟器主逻辑：渲染 / 音频时钟 / 输入 / ROM 管理
import { GBA, CYCLES_PER_FRAME } from './emulator/gba.js?v=1795665441';

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const screen = $('screen');
const ctx2d = screen.getContext('2d');
const statusChip = $('statusChip');
const fpsChip = $('fpsChip');
const infoCard = $('infoCard');

// 合成事件防护（自动化测试用）
try {
  const op = Element.prototype.setPointerCapture, rp = Element.prototype.releasePointerCapture;
  Element.prototype.setPointerCapture = function (id) { try { op.call(this, id); } catch {} };
  Element.prototype.releasePointerCapture = function (id) { try { rp.call(this, id); } catch {} };
} catch {}

// ---------- 模拟器 ----------
const gba = new GBA();
let hasROM = false;
let paused = false;
let frameCount = 0;
let fpsT0 = performance.now();
const imageData = ctx2d.createImageData(240, 160);

gba.onFrame = () => { /* 每帧回调（保留） */ };

function drawFrame() {
  gba.ppu.toRGBA(imageData.data);
  ctx2d.putImageData(imageData, 0, 0);
}

function updateStatus(text) { statusChip.textContent = text; }

function showInfo(rom) {
  $('cartTitle').textContent = gba.romTitle || '未命名卡带';
  $('cartFile').textContent = rom.name || '内置卡带';
  const rows = $('cartRows');
  rows.innerHTML = '';
  const add = (k, v) => {
    const d = document.createElement('div');
    d.className = 'row';
    d.innerHTML = `<span>${k}</span><span>${v}</span>`;
    rows.appendChild(d);
  };
  add('游戏代码', gba.romCode || '—');
  add('大小', (rom.data.length / 1024 / 1024).toFixed(2) + ' MB');
  add('存档类型', gba.saveType);
  infoCard.classList.add('visible');
}

function clearInfo() {
  $('cartTitle').textContent = '—';
  $('cartFile').textContent = '未插入卡带';
  $('cartRows').innerHTML = '';
  infoCard.classList.remove('visible');
}

// ---------- 音频时钟驱动 ----------
let audioCtx = null;
let audioNode = null;
let audioGain = null;
let usingAudioClock = false;
let audioToastShown = false;

function initAudio() {
  if (audioCtx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  audioCtx = new AC();
  audioGain = audioCtx.createGain();
  audioGain.gain.value = parseFloat($('volumeSlider').value);
  audioGain.connect(audioCtx.destination);
  audioNode = audioCtx.createScriptProcessor(2048, 0, 2);
  audioNode.onaudioprocess = (e) => {
    const L = e.outputBuffer.getChannelData(0);
    const R = e.outputBuffer.getChannelData(1);
    const need = L.length;
    if (hasROM && !paused) {
      let samples = gba.apu.readSamples();
      while (samples.length < need * 2) {
        gba.runFrame();
        frameCount++;
        samples = samples.concat(gba.apu.readSamples());
      }
      for (let i = 0; i < need; i++) {
        L[i] = samples[i * 2] || 0;
        R[i] = samples[i * 2 + 1] || 0;
      }
      usingAudioClock = true;
    } else {
      L.fill(0); R.fill(0);
    }
  };
  audioNode.connect(audioGain);
  const resume = audioCtx.resume();
  if (resume && resume.then) resume.then(() => { if (!audioToastShown) { audioToastShown = true; } });
  // 画面走独立的 rAF 循环（音频只驱动采样）
  requestAnimationFrame(loop);
}

window.addEventListener('pointerdown', initAudio, { once: false });

// ---------- rAF 渲染循环 ----------
function loop() {
  if (hasROM && !paused && !usingAudioClock) {
    gba.runFrame();
    frameCount++;
  }
  drawFrame();
  if (performance.now() - fpsT0 > 500) {
    const fps = frameCount * 1000 / (performance.now() - fpsT0);
    fpsChip.textContent = fps.toFixed(0) + ' FPS';
    frameCount = 0;
    fpsT0 = performance.now();
  }
  requestAnimationFrame(loop);
}
// 无音频环境下也保持渲染（音频就绪前以 rAF 为钟）
requestAnimationFrame(loop);
// 音频时钟激活后 rAF 只负责画面（runFrame 由音频回调驱动）

// ---------- 输入 ----------
const KEYMAP = {
  ArrowUp: 6, ArrowDown: 7, ArrowLeft: 5, ArrowRight: 4,
  x: 0, X: 0, z: 1, Z: 1,           // B / A（GBA A 在右）
  Enter: 3, Shift: 2,               // START / SELECT
  a: 8, A: 8, s: 9, S: 9,           // R / L
};
window.addEventListener('keydown', (e) => {
  if (KEYMAP[e.key] === undefined) return;
  e.preventDefault();
  gba.setKey(KEYMAP[e.key], true);
});
window.addEventListener('keyup', (e) => {
  if (KEYMAP[e.key] === undefined) return;
  e.preventDefault();
  gba.setKey(KEYMAP[e.key], false);
});

const TOUCHMAP = { tUp: 6, tDown: 7, tLeft: 5, tRight: 4, tA: 0, tB: 1, tStart: 3, tSelect: 2, tR: 8, tL: 9 };
for (const id of Object.keys(TOUCHMAP)) {
  const el = $(id);
  if (!el) continue;
  const key = TOUCHMAP[id];
  const down = (e) => { e.preventDefault(); gba.setKey(key, true); el.classList.add('active'); };
  const up = (e) => { e.preventDefault(); gba.setKey(key, false); el.classList.remove('active'); };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointerleave', up);
  el.addEventListener('pointercancel', up);
}
document.querySelector('.touch').addEventListener('contextmenu', (e) => e.preventDefault());

// ---------- ROM 加载 ----------
function insertROM(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const data = new Uint8Array(reader.result);
    gba.loadROM(data);
    hasROM = true;
    paused = false;
    showInfo({ name: file.name, data });
    updateStatus('运行中');
    toast('已插入 ' + (gba.romTitle || file.name));
  };
  reader.readAsArrayBuffer(file);
}

$('btnUpload').addEventListener('click', () => $('fileInput').click());
$('fileInput').addEventListener('change', (e) => {
  if (e.target.files[0]) insertROM(e.target.files[0]);
  e.target.value = '';
});
$('btnEject').addEventListener('click', () => {
  if (!hasROM) return;
  hasROM = false;
  clearInfo();
  updateStatus('待机中');
  toast('已弹出卡带');
});
$('btnPause').addEventListener('click', (e) => {
  paused = !paused;
  updateStatus(paused ? '已暂停' : hasROM ? '运行中' : '待机中');
  e.currentTarget.querySelector('.bt').textContent = paused ? ' 继续' : ' 暂停';
});
$('btnReset').addEventListener('click', () => {
  if (!hasROM) return;
  gba.reset();
  toast('已重启');
});
$('btnFull').addEventListener('click', (e) => {
  e.preventDefault();
  toggleFullscreen();
});
function toggleFullscreen() {
  const fn = document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen;
  if (document.fullscreenElement) {
    const ex = document.exitFullscreen || document.webkitExitFullscreen;
    if (ex) ex.call(document);
  } else if (fn) {
    fn.call(document.documentElement).catch(() => {});
  }
}
$('volumeSlider').addEventListener('input', (e) => {
  if (audioGain) audioGain.gain.value = parseFloat(e.target.value);
});

// 拖放
const overlay = $('dropOverlay');
window.addEventListener('dragover', (e) => { e.preventDefault(); overlay.classList.add('on'); });
window.addEventListener('dragleave', (e) => {
  if (!e.relatedTarget) overlay.classList.remove('on');
});
window.addEventListener('drop', (e) => {
  e.preventDefault();
  overlay.classList.remove('on');
  if (e.dataTransfer.files[0]) insertROM(e.dataTransfer.files[0]);
});

// ---------- Toast ----------
let toastTimer = 0;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

clearInfo();
