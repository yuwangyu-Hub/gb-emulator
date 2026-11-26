// GAME BOY ADVANCE 网页模拟器 · 主逻辑
//
// 3D 展示层（three.js 程序化 AGB 机身）+ 模拟器内核 + 音频时钟 + 输入 + ROM 管理。
// 展示层与内核完全解耦：内核只吐 framebuffer / 收 setKey，场景只负责把它画到 LCD 贴图上。

import * as THREE from 'three';
import { GBA } from './emulator/gba.js?v=1795666799';
import { LCDScreen, makeLabelTexture } from './scene/textures.js?v=1795666799';
import { buildTestROM } from './demoRom.js?v=1795666799';
import { createScene } from './scene/scene.js?v=1795666799';

const $ = (id) => document.getElementById(id);

// ---------- DOM ----------
const canvas = $('scene');
const fileInput = $('fileInput');
const btnUpload = $('btnUpload');
const btnEject = $('btnEject');
const btnPause = $('btnPause');
const btnReset = $('btnReset');
const btnFull = $('btnFull');
const btnMute = $('btnMute');
const volumeSlider = $('volumeSlider');
const shellSel = $('shellSel');
const infoCard = $('infoCard');
const statusChip = $('statusChip');
const fpsChip = $('fpsChip');
const toast = $('toast');
const dropOverlay = $('dropOverlay');
const fsView = $('fsGameView');

// OrbitControls 会直接 setPointerCapture，合成事件下可能抛错，全局兜住
{
  const op = Element.prototype.setPointerCapture, rp = Element.prototype.releasePointerCapture;
  Element.prototype.setPointerCapture = function (id) { try { op.call(this, id); } catch (e) { /* 忽略 */ } };
  Element.prototype.releasePointerCapture = function (id) { try { rp.call(this, id); } catch (e) { /* 忽略 */ } };
}

// ---------- LCD 贴图 ----------
const lcdScreen = new LCDScreen();
const lcdTexture = new THREE.CanvasTexture(lcdScreen.canvas);
lcdTexture.magFilter = THREE.LinearFilter;
lcdTexture.minFilter = THREE.LinearFilter;
lcdTexture.generateMipmaps = false;
lcdTexture.colorSpace = THREE.SRGBColorSpace;

// ---------- 场景 ----------
const { renderer, scene, camera, controls, gba: model, cart, animator } = createScene(canvas, lcdTexture);

// ---------- 模拟器 ----------
const gba = new GBA();
let state = 'idle';          // idle | inserting | running | paused | ejecting
let paused = false;
let frameCount = 0;
let paintedFrame = -1;
let hasROM = false;
let bootFlash = 0;
let idleTime = 0;
const rgbaBuf = new Uint8ClampedArray(240 * 160 * 4);

gba.onFrame = () => { frameCount++; };

// ---------- 状态 / 提示 ----------
function setStatus(text, cls) {
  statusChip.textContent = text;
  statusChip.className = 'chip ' + (cls || '');
}

let toastTimer = 0;
function showToast(msg, isErr = false) {
  toast.textContent = msg;
  toast.className = 'toast show' + (isErr ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.className = 'toast'; }, 2400);
}

// ---------- 卡带信息卡 ----------
function updateInfoCard(info, fileName) {
  $('cartTitle').textContent = info.title || '未命名卡带';
  $('cartFile').textContent = fileName || '内置卡带';
  const rows = $('cartRows');
  rows.innerHTML = '';
  const add = (k, v) => {
    const d = document.createElement('div');
    d.className = 'row';
    const a = document.createElement('span'); a.textContent = k;
    const b = document.createElement('span'); b.textContent = v;
    d.appendChild(a); d.appendChild(b);
    rows.appendChild(d);
  };
  add('游戏代码', info.code || '—');
  add('容量', (info.size / 1024 / 1024).toFixed(2) + ' MB');
  add('存档类型', info.saveType || 'none');
  infoCard.classList.add('visible');
}

function clearInfoCard() {
  $('cartTitle').textContent = '—';
  $('cartFile').textContent = '未插入卡带';
  $('cartRows').innerHTML = '';
  infoCard.classList.remove('visible');
}

// ---------- 音频（GBA 音频时钟驱动主循环） ----------
let audioCtx = null;
let audioNode = null;
let audioGain = null;
let usingAudioClock = false;
let muted = false;

function initAudio() {
  if (audioCtx) {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  try {
    audioCtx = new AC();
    audioGain = audioCtx.createGain();
    audioGain.gain.value = muted ? 0 : parseFloat(volumeSlider.value);
    audioGain.connect(audioCtx.destination);

    audioNode = audioCtx.createScriptProcessor(2048, 0, 2);
    audioNode.onaudioprocess = (e) => {
      const L = e.outputBuffer.getChannelData(0);
      const R = e.outputBuffer.getChannelData(1);
      if (state !== 'running' || paused) { L.fill(0); R.fill(0); return; }
      const need = L.length;
      let left = gba.apu.readSamples();       // [L,R,L,R,...]
      let guard = 0;
      while (left.length < need * 2 && guard++ < 8) {
        gba.runFrame();
        left = left.concat(gba.apu.readSamples());
      }
      for (let i = 0; i < need; i++) {
        L[i] = left[i * 2] || 0;
        R[i] = left[i * 2 + 1] || 0;
      }
      usingAudioClock = true;
    };
    audioNode.connect(audioGain);
    // 无手势时 resume() 可能永远 pending，绝不能 await
    audioCtx.resume().catch(() => {});
  } catch (err) {
    console.warn('[audio] 初始化失败，退回 rAF 驱动', err);
    usingAudioClock = false;
  }
}

// ---------- 插卡 / 退卡 ----------
function prepareCart(bytes, fileName) {
  gba.loadROM(bytes);                      // 解析头部 + reset
  const info = {
    title: gba.romTitle,
    code: gba.romCode,
    saveType: gba.saveType,
    size: bytes.length,
  };
  updateInfoCard(info, fileName);
  cart.setLabel(makeLabelTexture(info));
  insertAnimation(fileName);
}

function insertAnimation(fileName) {
  state = 'inserting';
  setStatus('识别卡带…', 'warn');
  controls.autoRotate = false;

  const slot = model.parts.slot;
  cart.group.visible = true;
  cart.group.scale.setScalar(1);
  cart.group.position.copy(slot.spawnPos);
  cart.group.rotation.set(-0.35, 0.12, 0);

  animator.sequence([
    { // 从画面上方飞到槽口上方
      duration: 0.62, ease: 'outCubic',
      onUpdate: (e) => {
        cart.group.position.lerpVectors(slot.spawnPos, slot.hoverPos, e);
        cart.group.rotation.x = -0.35 * (1 - e);
        cart.group.rotation.y = 0.12 * (1 - e);
      },
    },
    { duration: 0.12, ease: 'linear', onUpdate: () => {} },   // 停顿
    { // 插进机身
      duration: 0.3, ease: 'inQuad',
      onUpdate: (e) => {
        cart.group.position.lerpVectors(slot.hoverPos, slot.insertedPos, e);
        cart.group.rotation.x = 0;
        cart.group.rotation.y = 0;
      },
      onComplete: () => {
        cart.group.visible = false;
        model.parts.ledMat.emissive.setHex(0xff2a3c);
        model.parts.ledMat.emissiveIntensity = 1.4;
        model.parts.ledMat.color.setHex(0xff5a64);
        bootFlash = 1;
      },
    },
    { duration: 0.34, ease: 'linear', onUpdate: () => {},
      onComplete: () => bootROM(fileName),
    },
  ]);
}

function bootROM(fileName) {
  hasROM = true;
  paused = false;
  state = 'running';
  setStatus('运行中', 'ok');
  paintedFrame = -1;
  initAudio();
  if (gba.saveType && gba.saveType !== 'none') {
    showToast('已插入卡带，检测到存档类型：' + gba.saveType);
  } else {
    showToast('已插入 ' + (gba.romTitle || fileName || '卡带'));
  }
}

function ejectROM() {
  if (state !== 'running' && state !== 'paused') return;
  hasROM = false;
  paused = false;
  state = 'ejecting';
  setStatus('弹出卡带…', 'warn');
  model.parts.ledMat.emissive.setHex(0x000000);
  model.parts.ledMat.emissiveIntensity = 0;

  const slot = model.parts.slot;
  cart.group.visible = true;
  cart.group.position.copy(slot.insertedPos);

  animator.add({
    duration: 0.55, ease: 'outCubic',
    onUpdate: (e) => {
      cart.group.position.lerpVectors(slot.insertedPos, slot.spawnPos, e);
      cart.group.rotation.x = -0.35 * e;
      cart.group.rotation.y = 0.12 * e;
    },
    onComplete: () => {
      cart.group.visible = false;
      state = 'idle';
      setStatus('待机中');
      clearInfoCard();
      showToast('已弹出卡带');
    },
  });
}

// ---------- 3D 按键拾取 ----------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const btnBit = { a: 0, b: 1, select: 2, start: 3, l: 9, r: 8 };
const dpadBit = { up: 6, down: 7, left: 5, right: 4 };
let pressing = null;     // { btn, dir }

function bindBit(name) {
  if (name in dpadBit) return dpadBit[name];
  return btnBit[name];
}

function hitTest(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(model.parts.hitMeshes, false);
  return hits.length ? hits[0] : null;
}

function pressMesh(mesh) {
  mesh.position.z = mesh.userData.baseZ - mesh.userData.pressDepth;
}

function releaseMesh(mesh) {
  mesh.position.z = mesh.userData.baseZ;
}

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
  const hit = hitTest(e.clientX, e.clientY);
  if (!hit) return;

  const name = hit.object.userData.btn;
  let dir = null;
  if (name === 'dpad') {
    // 按在十字键的哪一瓣：比较相对中心点的偏移
    const slot = model.parts.slot;
    const local = model.group.worldToLocal(hit.point.clone());
    const cx = -47, cy = 2;   // 与 gbaModel 里 DPAD 常量保持一致
    const dx = local.x - cx, dy = local.y - cy;
    dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'up' : 'down');
  }

  const bit = dir ? dpadBit[dir] : bindBit(name);
  if (bit === undefined) return;

  e.preventDefault();
  controls.enabled = false;
  pressing = { mesh: hit.object, bit };
  pressMesh(hit.object);
  gba.setKey(bit, true);
}, { passive: false });

function endPress() {
  if (!pressing) return;
  gba.setKey(pressing.bit, false);
  releaseMesh(pressing.mesh);
  pressing = null;
  controls.enabled = true;
}
canvas.addEventListener('pointerup', endPress);
canvas.addEventListener('pointercancel', endPress);
window.addEventListener('pointerup', endPress);
window.addEventListener('blur', endPress);

// ---------- 键盘 ----------
const KEYMAP = {
  ArrowUp: 6, ArrowDown: 7, ArrowLeft: 5, ArrowRight: 4,
  x: 0, X: 0, z: 1, Z: 1,          // X = A，Z = B
  a: 9, A: 9, s: 8, S: 8,          // A = L，S = R
  Enter: 3, Shift: 2,              // START / SELECT
};
window.addEventListener('keydown', (e) => {
  if (e.key === ' ') { e.preventDefault(); togglePause(); return; }
  const bit = KEYMAP[e.key];
  if (bit === undefined) return;
  e.preventDefault();
  gba.setKey(bit, true);
});
window.addEventListener('keyup', (e) => {
  const bit = KEYMAP[e.key];
  if (bit === undefined) return;
  e.preventDefault();
  gba.setKey(bit, false);
});

// ---------- 触屏虚拟按键 ----------
const TOUCHMAP = { tUp: 6, tDown: 7, tLeft: 5, tRight: 4, tA: 0, tB: 1, tStart: 3, tSelect: 2, tL: 9, tR: 8 };
for (const id of Object.keys(TOUCHMAP)) {
  const el = $(id);
  if (!el) continue;
  const bit = TOUCHMAP[id];
  const down = (e) => { e.preventDefault(); initAudio(); gba.setKey(bit, true); el.classList.add('active'); };
  const up = (e) => { e.preventDefault(); gba.setKey(bit, false); el.classList.remove('active'); };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointerleave', up);
  el.addEventListener('pointercancel', up);
}
const touchWrap = document.querySelector('.touch');
if (touchWrap) touchWrap.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------- ROM 载入 ----------
function handleFile(file) {
  if (!file) return;
  const name = file.name.toLowerCase();
  if (name.endsWith('.zip')) {
    showToast('请先解压 zip，再上传 .gba 文件', true);
    return;
  }
  if (state === 'inserting' || state === 'ejecting') return;
  file.arrayBuffer().then((buf) => {
    const bytes = new Uint8Array(buf);
    if (bytes.length < 0xc0) {
      showToast('文件太小，不像 GBA 卡带', true);
      return;
    }
    if (hasROM) {
      // 已插卡：先退卡再插新卡
      ejectROM();
      setTimeout(() => prepareCart(bytes, file.name), 900);
    } else {
      prepareCart(bytes, file.name);
    }
  });
}

fileInput.addEventListener('change', () => {
  if (fileInput.files.length) handleFile(fileInput.files[0]);
  fileInput.value = '';
});
btnUpload.addEventListener('click', () => fileInput.click());

// 自检卡带：浏览器内现生成一张最小 GBA ROM，用来验证内核 → 3D 屏幕的链路
$('btnDemo').addEventListener('click', () => {
  if (state === 'inserting' || state === 'ejecting') return;
  const rom = buildTestROM();
  if (hasROM) {
    ejectROM();
    setTimeout(() => prepareCart(rom, 'selftest.gba'), 900);
  } else {
    prepareCart(rom, 'selftest.gba');
  }
});

// 拖放
window.addEventListener('dragover', (e) => { e.preventDefault(); dropOverlay.classList.add('on'); });
window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) dropOverlay.classList.remove('on'); });
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dropOverlay.classList.remove('on');
  if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
});

// ---------- 控制按钮 ----------
btnEject.addEventListener('click', () => {
  if (state !== 'running' && state !== 'paused') { showToast('还没有卡带', true); return; }
  ejectROM();
});

function togglePause() {
  if (state !== 'running' && state !== 'paused') return;
  paused = !paused;
  state = paused ? 'paused' : 'running';
  setStatus(paused ? '已暂停' : '运行中', paused ? 'warn' : 'ok');
  const label = btnPause.querySelector('.bt');
  if (label) label.textContent = paused ? ' 继续' : ' 暂停';
}
btnPause.addEventListener('click', togglePause);

btnReset.addEventListener('click', () => {
  if (state !== 'running' && state !== 'paused') return;
  gba.reset();
  frameCount = 0;
  paintedFrame = -1;
  bootFlash = 1;
  paused = false;
  state = 'running';
  setStatus('运行中', 'ok');
  showToast('已重启');
});

btnMute.addEventListener('click', () => {
  muted = !muted;
  btnMute.classList.toggle('off', muted);
  if (audioGain) audioGain.gain.value = muted ? 0 : parseFloat(volumeSlider.value);
  showToast(muted ? '已静音' : '声音已开启');
});

volumeSlider.addEventListener('input', () => {
  if (audioGain && !muted) audioGain.gain.value = parseFloat(volumeSlider.value);
});

// 外壳换色
{
  const saved = localStorage.getItem('gbashell');
  if (saved && model.setShellColor(saved)) shellSel.value = saved;
}
shellSel.addEventListener('change', () => {
  if (model.setShellColor(shellSel.value)) {
    localStorage.setItem('gbashell', shellSel.value);
    showToast('外壳：' + shellSel.options[shellSel.selectedIndex].textContent);
  }
});

// ---------- 全屏（整数倍缩放，不拉伸） ----------
let fsActive = false;

function layoutFs() {
  if (!fsActive) return;
  const scale = Math.max(1, Math.floor(Math.min(window.innerWidth / 240, (window.innerHeight - 8) / 160)));
  const c = lcdScreen.canvas;
  c.style.width = 240 * scale + 'px';
  c.style.height = 160 * scale + 'px';
  c.style.imageRendering = 'pixelated';
  c.style.display = 'block';
}

function enterFs() {
  fsActive = true;
  fsView.hidden = false;
  fsView.appendChild(lcdScreen.canvas);
  document.body.classList.add('fs-on');
  layoutFs();
  const el = document.documentElement;
  const fn = el.requestFullscreen || el.webkitRequestFullscreen;
  if (fn) fn.call(el).catch(() => {});
}

function exitFs() {
  fsActive = false;
  fsView.hidden = true;
  if (lcdScreen.canvas.parentElement === fsView) fsView.removeChild(lcdScreen.canvas);
  document.body.classList.remove('fs-on');
  const doc = document;
  if (doc.fullscreenElement || doc.webkitFullscreenElement) {
    const ex = doc.exitFullscreen || doc.webkitExitFullscreen;
    if (ex) ex.call(doc);
  }
}

function onFullscreenChange() {
  const el = document.fullscreenElement || document.webkitFullscreenElement;
  if (!el && fsActive) exitFs();
}
document.addEventListener('fullscreenchange', onFullscreenChange);
document.addEventListener('webkitfullscreenchange', onFullscreenChange);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && fsActive) exitFs();
});
window.addEventListener('resize', layoutFs);
$('fsExit').addEventListener('click', exitFs);
window.addEventListener('pointerdown', initAudio, { passive: true });

btnFull.addEventListener('click', () => {
  if (fsActive) exitFs(); else enterFs();
});

// ---------- 主循环 ----------
let last = performance.now();
let acc = 0;
let fpsCount = 0, fpsTime = 0;
let dbgTicks = 0, dbgDt = 0;

// 调试钩子（无头浏览器测试用）
window.__gbaScene = { camera, model };
window.__gbaDebug = () => ({
  ticks: dbgTicks, dt: dbgDt, fpsTime, idleTime, state, frameCount, paused,
  hasROM, usingAudioClock, audio: audioCtx ? audioCtx.state : 'none',
  pressing: pressing ? pressing.bit : null,
  shell: shellSel.value,
});

function loop(now) {
  requestAnimationFrame(loop);
  // 首帧的 rAF 时间戳可能早于模块执行完的时刻（负 dt），必须夹到 [0, 0.05]
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
  last = now;
  dbgTicks++; dbgDt = dt;

  animator.update(dt);
  controls.update();

  if (state === 'running' || state === 'paused') {
    if (state === 'running' && !usingAudioClock) {
      // 音频时钟就绪前用 rAF 按 60fps 补帧
      acc += dt;
      const step = 1 / 60;
      let n = 0;
      while (acc >= step && n < 4) { gba.runFrame(); acc -= step; n++; }
    }
    if (bootFlash > 0) {
      bootFlash -= dt / 0.55;
      lcdScreen.drawFramebuffer(gba.ppu.toRGBA(rgbaBuf));
      lcdScreen.drawFlash(Math.max(0, bootFlash));
      lcdTexture.needsUpdate = true;
      paintedFrame = frameCount;
    } else if (frameCount !== paintedFrame) {
      paintedFrame = frameCount;
      lcdScreen.drawFramebuffer(gba.ppu.toRGBA(rgbaBuf));
      lcdTexture.needsUpdate = true;
    }
  } else {
    idleTime += dt;
    lcdScreen.drawIdle(idleTime);
    lcdTexture.needsUpdate = true;
  }

  renderer.render(scene, camera);

  fpsCount++;
  fpsTime += dt;
  if (fpsTime >= 1) {
    fpsChip.textContent = Math.round(fpsCount / fpsTime) + ' FPS';
    fpsCount = 0;
    fpsTime = 0;
  }
}

clearInfoCard();
setStatus('待机中');
if (window.matchMedia('(max-width: 720px)').matches) {
  setTimeout(() => showToast('内核内测中：商业 ROM 会黑屏，可点 ⭐ 自检卡带验证链路'), 1200);
}
requestAnimationFrame(loop);
