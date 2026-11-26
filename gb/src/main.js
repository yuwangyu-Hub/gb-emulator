// 主程序：场景 + 模拟器 + 交互串联

import * as THREE from 'three';
import { GameBoy, parseROMHeader } from './emulator/gameboy.js?v=1795668937';
import {
  LCDScreen, makeLabelTexture, makeLabelTextureFromImage,
} from './scene/textures.js?v=1795668937';
import { createScene } from './scene/scene.js?v=1795668937';
import { updateCartridgeLabel } from './scene/cartridgeModel.js?v=1795668937';
import { AudioDriver } from './audio.js?v=1795668937';
import { loadCartArtIndex, findCartArt, loadCartArtImage, cartArtCount } from './cartart.js?v=1795668937';
import { listROMs, addROM, ensureDemoROM } from './collection.js?v=1795668937';

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);

// OrbitControls 在 pointerdown/up 时直接 setPointerCapture/releasePointerCapture，
// 某些边缘情况（合成事件、已被 cancel 的触摸指针）会抛 NotFoundError，全局兜住
{
  const origSet = Element.prototype.setPointerCapture;
  Element.prototype.setPointerCapture = function (id) {
    try { origSet.call(this, id); } catch (e) { /* 忽略 */ }
  };
  const origRel = Element.prototype.releasePointerCapture;
  Element.prototype.releasePointerCapture = function (id) {
    try { origRel.call(this, id); } catch (e) { /* 忽略 */ }
  };
}
const canvas = $('scene');
const fileInput = $('fileInput');
const btnUpload = $('btnUpload');
const btnDemo = $('btnDemo');
const btnEject = $('btnEject');
const btnPause = $('btnPause');
const btnReset = $('btnReset');
const btnMute = $('btnMute');
const paletteSel = $('paletteSel');
const volumeSlider = $('volumeSlider');
const infoCard = $('infoCard');
const statusChip = $('statusChip');
const fpsChip = $('fpsChip');
const toast = $('toast');
const dropOverlay = $('dropOverlay');

// ---------- 纹理 ----------
const lcdScreen = new LCDScreen();
const lcdTexture = new THREE.CanvasTexture(lcdScreen.canvas);
lcdTexture.magFilter = THREE.LinearFilter;
lcdTexture.minFilter = THREE.LinearFilter;
lcdTexture.generateMipmaps = false;
lcdTexture.colorSpace = THREE.SRGBColorSpace;

// ---------- 启动遮罩（模型下载进度） ----------
const bootScreen = $('bootScreen');
const bootBar = $('bootBar');
const bootMeta = $('bootMeta');

function setBootProgress(p) {
  if (!bootScreen || bootScreen.classList.contains('is-done')) return;
  const pct = Math.max(0, Math.min(100, Math.round(p * 100)));
  if (bootBar) bootBar.style.width = pct + '%';
  if (bootMeta) bootMeta.textContent = pct < 100 ? `${pct}%` : '渲染中…';
}

function finishBoot() {
  if (!bootScreen) return;
  setBootProgress(1);
  // 让最后一帧 3D 先上屏，再淡出遮罩，避免闪白
  requestAnimationFrame(() => {
    setTimeout(() => {
      bootScreen.classList.add('is-done');
      setTimeout(() => { bootScreen.hidden = true; }, 600);
    }, 120);
  });
}

// ---------- 场景与模拟器 ----------
const bootBundle = await (async () => {
  try {
    return await createScene(canvas, lcdTexture, { onProgress: setBootProgress });
  } catch (e) {
    // 模型加载失败时别让遮罩盖住错误提示框
    if (bootScreen) { bootScreen.classList.add('is-done'); bootScreen.hidden = true; }
    throw e;
  }
})();
const { renderer, scene, camera, controls, gb: model, cart, animator, drawer } = bootBundle;
const gb = new GameBoy();
gb.ppu.onFrame = () => { gb.frameCount++; };
const audio = new AudioDriver(gb);
audio.volume = 0.8;

let state = 'idle'; // idle | inserting | running | paused | ejecting
let bootFlash = 0;
let idleTime = 0;

// ---------- 卡带收藏（抽屉） ----------
let collection = [];       // [{id,name,data,ts,demo}]
let insertedCartId = null; // 当前插在主机里的收藏条目 id

// 启动时预加载卡带封面图库索引
loadCartArtIndex().then((ok) => {
  if (ok) console.log(`[cartart] 卡带图库就绪，共 ${cartArtCount()} 张`);
});

// ---------- 工具 ----------
function u8ToB64(u8) {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) {
    s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
  }
  return btoa(s);
}
function b64ToU8(b64) {
  const s = atob(b64);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
}
function idb() {
  return new Promise((res, rej) => {
    const req = indexedDB.open('gbsim', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
async function idbPut(key, val) {
  try {
    const db = await idb();
    await new Promise((res, rej) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(val, key);
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
  } catch (e) { /* 忽略 */ }
}
async function idbGet(key) {
  try {
    const db = await idb();
    return await new Promise((res, rej) => {
      const tx = db.transaction('kv', 'readonly');
      const r = tx.objectStore('kv').get(key);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  } catch (e) { return undefined; }
}

function showToast(msg, isErr = false) {
  toast.textContent = msg;
  toast.className = 'toast show' + (isErr ? ' error' : '');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { toast.className = 'toast'; }, 2600);
}

function setStatus(text, cls) {
  statusChip.textContent = text;
  statusChip.className = 'chip ' + (cls || '');
}

// ---------- 卡带信息面板 ----------
function fmtSize(n) {
  if (n >= 1048576) return (n / 1048576).toFixed(n % 1048576 === 0 ? 0 : 1) + ' MB';
  return Math.round(n / 1024) + ' KB';
}
function updateInfoCard(info, fileName) {
  $('cartTitle').textContent = info.title;
  $('cartFile').textContent = fileName || '';
  const rows = [
    ['卡带类型', info.mbcName],
    ['容量', `${fmtSize(info.romSize)} · ${info.romBanks} banks`],
    ['存档', info.ramSize ? `${fmtSize(info.ramSize)}${info.hasBattery ? '（带电池）' : ''}` : '无'],
    ['厂商', info.licensee],
    ['区域', info.destination],
    ['兼容', info.cgbSupport],
    ['校验', info.headerChecksumOk ? '✓ 通过' : '⚠ 头校验不符'],
  ];
  const list = $('cartRows');
  list.innerHTML = '';
  for (const [k, v] of rows) {
    const div = document.createElement('div');
    div.className = 'row';
    const kEl = document.createElement('span');
    kEl.textContent = k;
    const vEl = document.createElement('span');
    vEl.textContent = v;
    div.append(kEl, vEl);
    list.appendChild(div);
  }
  infoCard.classList.add('visible');
  infoCard.classList.remove('open'); // 移动端默认保持收缩状态
}

// 弹出卡带后：信息卡恢复"未插入"状态并隐藏
function clearInfoCard() {
  $('cartTitle').textContent = '—';
  $('cartFile').textContent = '未插入卡带';
  $('cartRows').innerHTML = '';
  infoCard.classList.remove('visible', 'open');
}

// 移动端：点击信息卡在"收缩横条 / 展开详情"之间切换（桌面端无视觉效果）
infoCard.addEventListener('click', () => {
  infoCard.classList.toggle('open');
});

// ---------- 卡带封面识别 ----------
function appendInfoRow(k, v) {
  const list = $('cartRows');
  const div = document.createElement('div');
  div.className = 'row';
  const kEl = document.createElement('span');
  kEl.textContent = k;
  const vEl = document.createElement('span');
  vEl.textContent = v;
  div.append(kEl, vEl);
  list.appendChild(div);
}

// 用 ROM 标题 / 文件名去图库里找对应卡带封面，找到就替换 3D 卡带标签 + 信息卡缩略图
async function applyCartArt(info, fileName) {
  const iconEl = document.querySelector('#infoCard .cart-icon');
  try {
    await loadCartArtIndex();
    const hit = findCartArt(info && info.title, fileName);
    if (!hit) {
      appendInfoRow('卡带图', '未匹配 · 程序生成');
      return false;
    }
    const img = await loadCartArtImage(hit.item);
    updateCartridgeLabel(cart, makeLabelTextureFromImage(img, info));
    if (iconEl) {
      iconEl.innerHTML = '';
      const im = new Image();
      im.src = img.src;
      im.className = 'cart-art';
      im.alt = hit.item.t || '';
      iconEl.appendChild(im);
    }
    const pct = Math.round(hit.score * 100);
    appendInfoRow('卡带图', hit.item.t + (hit.item.r ? `（${hit.item.r}）` : ''));
    appendInfoRow('识别方式', `${pct}% · ${hit.exact ? '精确' : '模糊'} · ${hit.matchedBy === 'file' ? '文件名' : 'ROM 标题'}`);
    return true;
  } catch (e) {
    appendInfoRow('卡带图', '未匹配 · 程序生成');
    return false;
  }
}

// ---------- 抽屉渲染 ----------
// 把收藏里的 ROM 渲染成抽屉里的卡带（缺失的才补建）
function refreshDrawer() {
  const existing = new Set(drawer.cartIds());
  for (const entry of collection) {
    if (existing.has(entry.id)) continue;
    const info = parseROMHeader(entry.data);
    const rec = drawer.addCart(entry.id, makeLabelTexture(info));
    if (rec) applyArtToDrawer(entry, info); // 后台懒加载真实封面
  }
}

// 为抽屉里的卡带匹配真实封面并替换标签
async function applyArtToDrawer(entry, info) {
  try {
    await loadCartArtIndex();
    const hit = findCartArt(info && info.title, entry.name);
    if (!hit) return;
    const img = await loadCartArtImage(hit.item);
    const rec = drawer.getCart(entry.id);
    if (rec && rec.group.visible !== undefined) {
      const tex = makeLabelTextureFromImage(img, info);
      rec.group.userData.label.material.map = tex;
      rec.group.userData.label.material.needsUpdate = true;
    }
  } catch (e) { /* 保持程序生成标签 */ }
}

// 选中抽屉里的卡带 → 插入主机体验
async function selectCart(entry) {
  if (state === 'inserting' || state === 'ejecting') return;
  if (insertedCartId === entry.id && (state === 'running' || state === 'paused')) {
    showToast('这张卡带已经在主机里');
    return;
  }
  if (state === 'running' || state === 'paused') {
    ejectROM();
    await new Promise((r) => setTimeout(r, 850));
  }
  const info = parseROMHeader(entry.data);
  let ramData = null;
  try {
    const saved = localStorage.getItem(`gbsave:${info.title}:${info.globalChecksum}`);
    if (saved) ramData = b64ToU8(saved);
  } catch (e) { /* ignore */ }
  updateInfoCard(info, entry.name);
  updateCartridgeLabel(cart, makeLabelTexture(info));
  await Promise.race([
    applyCartArt(info, entry.name),
    new Promise((r) => setTimeout(r, 1200)),
  ]);
  insertedCartId = entry.id;
  drawer.hideCart(entry.id);          // 卡带从抽屉"装进"主机
  drawer.close(animator);
  insertROMAnimation(info, entry.data, ramData, entry.name);
}

// ---------- 插入 / 弹出动画 ----------
function insertROMAnimation(info, bytes, ramData, fileName) {
  state = 'inserting';
  setStatus('识别卡带…', 'warn');
  controls.autoRotate = false;

  cart.group.visible = true;
  cart.group.scale.setScalar(1);
  cart.group.position.copy(cart.spawnPos);
  cart.group.rotation.set(0.4, 0.25, 0.08);

  const finalPos = cart.insertedPos;
  const hoverPos = cart.hoverPos;

  animator.sequence([
    { // 飞向插槽上方
      duration: 0.55, ease: 'outCubic',
      onUpdate: (e) => {
        cart.group.position.lerpVectors(cart.spawnPos, hoverPos, e);
        cart.group.rotation.x = 0.4 * (1 - e) + 0.06 * e;
        cart.group.rotation.y = 0.25 * (1 - e);
        cart.group.rotation.z = 0.08 * (1 - e);
      },
    },
    { duration: 0.12, ease: 'linear', onUpdate: () => {} }, // 停顿
    { // 插入
      duration: 0.26, ease: 'inQuad',
      onUpdate: (e) => {
        cart.group.position.lerpVectors(hoverPos, finalPos, e);
        cart.group.rotation.x = 0.06 * (1 - e);
      },
      onComplete: () => {
        audio.click();
        // 机身轻震
        animator.add({
          duration: 0.22, ease: 'outQuad',
          onUpdate: (e, p) => {
            model.group.rotation.z = Math.sin(p * Math.PI * 4) * 0.012 * (1 - p);
          },
          onComplete: () => { model.group.rotation.z = 0; },
        });
        // 回弹
        animator.add({
          duration: 0.18, ease: 'outQuad',
          onUpdate: (e, p) => {
            cart.group.position.y = finalPos.y + Math.sin(p * Math.PI) * 1.6;
          },
          onComplete: () => { cart.group.position.copy(finalPos); },
        });
      },
    },
    { // 通电开机
      duration: 0.35, ease: 'linear', onUpdate: () => {},
      onComplete: () => {
        bootROM(bytes, ramData, info, fileName);
      },
    },
  ]);
}

function bootROM(bytes, ramData, info, fileName) {
  const sampleRate = audio.ctx ? audio.ctx.sampleRate : 44100;
  gb.loadROM(bytes, ramData, sampleRate);
  gb.apu.volume = audio.volume;
  // 没有用户手势时 AudioContext 会保持 suspended，start() 内部会退化成定时器驱动，
  // 保证"刷新页面自动恢复的卡带"也能跑起来（等用户点击后再切回声卡时钟）
  audio.start();
  model.parts.ledMat.emissive.setHex(0xff2a3c);
  model.parts.ledMat.emissiveIntensity = 1.6;
  model.parts.ledMat.color.setHex(0xff5a64);
  bootFlash = 1;
  state = 'running';
  setStatus('运行中', 'ok');
  audio.ding();
  if (info.ramSize && info.hasBattery) {
    showToast('已识别卡带，检测到存档芯片');
  } else {
    showToast('已识别卡带，开始运行');
  }
}

function ejectROM() {
  if (state !== 'running' && state !== 'paused') return;
  saveSRAM(true);
  gb.cartridge = null; // 停止模拟
  state = 'ejecting';
  setStatus('弹出卡带…', 'warn');
  model.parts.ledMat.emissive.setHex(0x000000);
  model.parts.ledMat.emissiveIntensity = 0;
  model.parts.ledMat.color.setHex(0x3a1015);
  setBtnLabel(btnPause, '⏸', ' 暂停');

  const start = cart.group.position.clone();
  animator.add({
    duration: 0.3, ease: 'outCubic',
    onUpdate: (e) => {
      cart.group.position.lerpVectors(start, new THREE.Vector3(start.x, 100, start.z), e);
      cart.group.rotation.x = -0.1 * e;
    },
  });
  animator.add({
    duration: 0.45, ease: 'inCubic',
    onUpdate: (e) => {
      cart.group.position.set(30 * e, 100 + 90 * e, start.z - 50 * e);
      cart.group.rotation.x = -0.1 - 0.5 * e;
      cart.group.scale.setScalar(1 - 0.4 * e);
    },
    onComplete: () => {
      cart.group.visible = false;
      cart.group.rotation.set(0, 0, 0);
      cart.group.scale.setScalar(1);
      state = 'idle';
      setStatus('待机中', '');
      idleTime = 0;
      clearInfoCard();   // 右侧卡带信息一并消失
      // 卡带回到抽屉
      if (insertedCartId) {
        drawer.showCart(insertedCartId);
        insertedCartId = null;
      }
    },
  });
  showToast('卡带已弹出');
}

// ---------- 存档 ----------
function saveKey() {
  if (!gb.info) return null;
  return `gbsave:${gb.info.title}:${gb.info.globalChecksum}`;
}
function saveSRAM(force = false) {
  const cartObj = gb.cartridge;
  if (!cartObj || !cartObj.info.ramSize || !cartObj.info.hasBattery) return;
  if (!cartObj._ramDirty && !force) return;
  try {
    localStorage.setItem(saveKey(), u8ToB64(cartObj.ram));
    cartObj._ramDirty = false;
    if (force) showToast('存档已保存');
  } catch (e) { /* 存储满 */ }
}
setInterval(() => saveSRAM(false), 3000);
window.addEventListener('beforeunload', () => saveSRAM(true));

// ---------- ROM 载入 ----------
// 上传 ROM：识别 → 加入抽屉收藏（自动拉开、高亮），由玩家点击卡带插入体验
async function handleROMData(buffer, fileName) {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 0x150) {
    showToast('文件太小，不像 GB 卡带', true);
    return;
  }
  const info = parseROMHeader(bytes);
  if (!info.logoOk) {
    showToast('⚠ Nintendo Logo 校验失败，可能不是有效卡带', true);
  }
  updateInfoCard(info, fileName);

  const { entry, dup } = await addROM(fileName, bytes);
  collection = await listROMs();
  const prevLayers = drawer.layerCount;
  refreshDrawer();   // 满了会自动在上方新增一层
  // 拉开新卡带所在的那一层
  const li = drawer.layerOf(entry.id);
  drawer.openLayer(li >= 0 ? li : 0, animator);
  if (drawer.layerCount > prevLayers) showToast('抽屉已满一层，自动新增一层');
  if (dup) {
    showToast('这张卡带已在抽屉中');
  } else {
    setTimeout(() => drawer.highlight(entry.id, animator), 450);
    showToast('已加入抽屉，点击卡带插入体验');
  }
}

function handleFile(file) {
  if (!file) return;
  const name = file.name.toLowerCase();
  if (name.endsWith('.zip')) {
    showToast('请先解压 zip，再上传 .gb 文件', true);
    return;
  }
  file.arrayBuffer().then((buf) => handleROMData(buf, file.name));
}

fileInput.addEventListener('change', () => {
  if (fileInput.files.length) handleFile(fileInput.files[0]);
  fileInput.value = '';
});
btnUpload.addEventListener('click', () => fileInput.click());
btnDemo.addEventListener('click', async () => {
  // 试玩 = 选中抽屉里的试玩卡带插入（与点击抽屉卡带同一流程）
  try {
    const demo = await ensureDemoROM();
    if (!demo) throw new Error();
    collection = await listROMs();
    refreshDrawer();
    selectCart(demo);
  } catch (e) {
    showToast('未内置示例 ROM，请点「上传 ROM」添加 .gb 文件', true);
  }
});
btnEject.addEventListener('click', ejectROM);

btnPause.addEventListener('click', () => {
  if (state === 'running') {
    state = 'paused';
    audio.setPaused(true);
    setBtnLabel(btnPause, '▶', ' 继续');
    setStatus('已暂停', 'warn');
  } else if (state === 'paused') {
    state = 'running';
    audio.setPaused(false);
    setBtnLabel(btnPause, '⏸', ' 暂停');
    setStatus('运行中', 'ok');
  }
});

btnReset.addEventListener('click', () => {
  if (state !== 'running' && state !== 'paused') return;
  gb.reset(true);
  bootFlash = 1;
  audio.ding();
  showToast('已重启');
});

// 按钮文字标签：只改 .bt 文本节点，保留前面的图标
function setBtnLabel(btn, icon, text) {
  btn.childNodes[0].textContent = icon;
  const bt = btn.querySelector('.bt');
  if (bt) bt.textContent = text;
}

btnMute.addEventListener('click', () => {
  const muted = !gb.apu.muted;
  gb.apu.muted = muted;
  btnMute.classList.toggle('off', muted);
});

volumeSlider.addEventListener('input', () => {
  audio.setVolume(parseFloat(volumeSlider.value));
});

paletteSel.addEventListener('change', () => {
  gb.setPalette(paletteSel.value);
  if (state === 'idle') idleTime = 0;
});

// ---------- 全屏 ----------
// 兼容不同浏览器的 Fullscreen API（含 webkit 前缀），并同步处理 Edge 老浏览
function fullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}
function requestFS(el) {
  const fn = el.requestFullscreen || el.webkitRequestFullscreen || el.webkitRequestFullScreen;
  if (!fn) return null;
  const p = fn.call(el);
  return p && typeof p.catch === 'function' ? p : Promise.resolve();
}
function exitFS() {
  const fn = document.exitFullscreen || document.webkitExitFullscreen || document.webkitCancelFullScreen;
  if (!fn) return Promise.resolve();
  const p = fn.call(document);
  return p && typeof p.catch === 'function' ? p : Promise.resolve();
}
const btnFull = $('btnFull');
const fsView = $('fsGameView');
const lcdCanvas = lcdScreen.canvas;   // 模拟器 LCD 画布（160×144），全屏时直接复用
let fsActive = false;
let fsTouchEl = null, fsTouchAnchor = null;   // 全屏期间被移入覆盖层的虚拟按键及其原位锚点

// 像素整数倍缩放（保持固定尺寸、不拉伸变形）
// 触屏设备（.touch 虚拟按键可见）时：画面在按键上方的可用区域内垂直居中
function layoutFsView() {
  if (!fsActive) return;
  const vw = window.innerWidth;
  const isPad = fsView.classList.contains('fs-pad');
  let availH = window.innerHeight;
  if (isPad) {
    const touchEl = document.querySelector('.touch');
    availH -= (touchEl ? touchEl.offsetHeight : 0) + 16;   // 底部按键区 + 间距
  }
  const scale = Math.max(1, Math.floor(Math.min(vw / lcdCanvas.width, availH / lcdCanvas.height)));
  lcdCanvas.style.width = lcdCanvas.width * scale + 'px';
  lcdCanvas.style.height = lcdCanvas.height * scale + 'px';
  // 可用区域内垂直居中：剩余空间上下均分
  lcdCanvas.style.marginTop = isPad
    ? Math.max(0, Math.floor((availH - lcdCanvas.height * scale) / 2)) + 'px'
    : '';
}

function enterFs() {
  if (fsActive) return;
  fsActive = true;
  // 触屏设备：全屏画面靠上显示，虚拟按键浮在覆盖层之上、位于画面下方
  const touchEl = document.querySelector('.touch');
  const touchVisible = touchEl && getComputedStyle(touchEl).display !== 'none';
  fsView.classList.toggle('fs-pad', !!touchVisible);
  document.body.classList.toggle('fs-on', !!touchVisible);
  fsView.hidden = false;
  fsView.appendChild(lcdCanvas);   // LCD 画布继续实时刷新，全屏显示游戏画面
  if (touchVisible) {
    // 原生全屏只渲染全屏元素本身，必须把虚拟按键移进覆盖层才能显示
    fsTouchEl = touchEl;
    fsTouchAnchor = document.createComment('touch-anchor');
    touchEl.parentNode.insertBefore(fsTouchAnchor, touchEl);
    fsView.appendChild(touchEl);
  }
  layoutFsView();
  // 优先原生全屏（独立浏览器窗口）；iframe/受限环境下静默失败，
  // 覆盖层本身已铺满视口，效果等同全屏
  const t = requestFS(fsView);
  if (t && t.catch) t.catch(() => {});
  syncFullBtn();
}
function exitFs() {
  if (!fsActive) return;
  fsActive = false;
  fsView.hidden = true;
  fsView.classList.remove('fs-pad');
  document.body.classList.remove('fs-on');
  if (fsTouchEl && fsTouchAnchor) {
    fsTouchAnchor.parentNode.insertBefore(fsTouchEl, fsTouchAnchor);   // 虚拟按键移回原位
    fsTouchAnchor.remove();
    fsTouchEl = null;
    fsTouchAnchor = null;
  }
  if (fullscreenElement()) {
    const t = exitFS();
    if (t && t.catch) t.catch(() => {});
  }
  syncFullBtn();
}
function syncFullBtn() {
  setBtnLabel(btnFull, fsActive ? '🗗' : '⛶', fsActive ? ' 退出全屏' : ' 全屏');
  btnFull.classList.toggle('active', fsActive);
}
btnFull.addEventListener('click', (e) => {
  e.preventDefault();
  if (fsActive) exitFs(); else enterFs();
});
// 全屏覆盖层左上角的退出按钮（手机端主要退出入口）
$('fsExit').addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  exitFs();
});
// 原生全屏被 Esc/手势退出时，同步收起覆盖层
function onFsChange() {
  if (!fullscreenElement() && fsActive) exitFs();
}
document.addEventListener('fullscreenchange', onFsChange);
document.addEventListener('webkitfullscreenchange', onFsChange);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && fsActive && !fullscreenElement()) exitFs();
});
window.addEventListener('resize', layoutFsView);
syncFullBtn();

// ---------- 外壳颜色 ----------
const shellSel = $('shellSel');
{
  const saved = localStorage.getItem('gbshell');
  if (saved) {
    shellSel.value = saved;
    model.setShellColor(saved);
  }
}
shellSel.addEventListener('change', () => {
  if (model.setShellColor(shellSel.value)) {
    localStorage.setItem('gbshell', shellSel.value);
  }
});

// ---------- 拖拽上传 ----------
let dragCount = 0;
window.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragCount++;
  dropOverlay.classList.add('visible');
});
window.addEventListener('dragleave', (e) => {
  e.preventDefault();
  dragCount--;
  if (dragCount <= 0) { dragCount = 0; dropOverlay.classList.remove('visible'); }
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragCount = 0;
  dropOverlay.classList.remove('visible');
  if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
});

// ---------- 键盘 ----------
const KEYMAP = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  KeyX: 'a', KeyK: 'a', KeyZ: 'b', KeyJ: 'b',
  Enter: 'start', ShiftRight: 'select', ShiftLeft: 'select',
};

function pressVisual(btn, down) {
  const map = model.parts.buttons || {};
  const m = map[btn];
  if (!m) return;
  const u = m.userData;
  if (!u.basePos) return;
  m.position.copy(u.basePos);
  if (down && u.pressLocal) m.position.add(u.pressLocal);
}

function pressBtn(btn, down) {
  gb.joypad.set(btn, down);
  pressVisual(btn, down);
}

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const btn = KEYMAP[e.code];
  if (btn) {
    e.preventDefault();
    pressBtn(btn, true);
    unlockAudio();
  }
  if (e.code === 'Space' && (state === 'running' || state === 'paused')) {
    e.preventDefault();
    btnPause.click();
  }
});
window.addEventListener('keyup', (e) => {
  const btn = KEYMAP[e.code];
  if (btn) { e.preventDefault(); pressBtn(btn, false); }
});

// ---------- 3D 模型上的按钮点击 ----------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let hitButton = null;
let hitPointerId = null;

function releaseHitButton() {
  if (hitButton) pressBtn(hitButton.userData.btn, false);
  hitButton = null;
  hitPointerId = null;
}

function pickButton(e) {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  // 按键被 wrapper(Group) 包裹，必须递归检测；命中后向上找带 btn 标记的对象
  const hits = raycaster.intersectObjects(model.parts.hitZones, true);
  for (const h of hits) {
    let o = h.object;
    while (o) {
      if (o.userData.btn) return o;
      o = o.parent;
    }
  }
  return null;
}

canvas.addEventListener('pointerdown', (e) => {
  unlockAudio();
  // 多指手势（捏合缩放/平移）优先于 3D 按键：第二根手指落下时释放按住中的按键，
  // 且不再拦截事件，让轨道控制器完整收到两个指针对
  const isExtraTouch = e.pointerType === 'touch' && !e.isPrimary;
  if (isExtraTouch && hitButton) releaseHitButton();
  const obj = pickButton(e);
  if (obj && obj.userData.btn && !isExtraTouch) {
    e.stopImmediatePropagation(); // 阻止轨道控制器旋转
    hitButton = obj;
    hitPointerId = e.pointerId;
    pressBtn(obj.userData.btn, true);
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 合成事件无活跃指针 */ }
  }
});
canvas.addEventListener('pointerup', (e) => {
  if (hitButton && e.pointerId === hitPointerId) releaseHitButton();
});
canvas.addEventListener('pointercancel', (e) => {
  if (hitButton && e.pointerId === hitPointerId) releaseHitButton();
});
canvas.addEventListener('pointermove', (e) => {
  if (hitButton && e.pointerId === hitPointerId) e.stopImmediatePropagation();
});

// ---------- 抽屉交互：点击开合 / 选中卡带（与拖拽转视角区分：位移 <6px 视为点击） ----------
let dDownX = 0, dDownY = 0, dWasButton = false;
canvas.addEventListener('pointerdown', (e) => {
  dDownX = e.clientX; dDownY = e.clientY;
  dWasButton = !!hitButton; // GB 按键的 pointerdown 先注册，此时已标记
});
canvas.addEventListener('pointerup', (e) => {
  if (dWasButton) return; // 刚才是在按 GB 按键
  if (Math.hypot(e.clientX - dDownX, e.clientY - dDownY) > 6) return; // 是拖拽转视角
  handleDrawerClick(e);
});

function raycastDrawer(e) {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects([...drawer.getHitTargets(), ...drawer.trays], true);
  for (const h of hits) {
    // 手动过滤隐藏对象（Raycaster 不会跳过 visible=false）
    let vis = true;
    for (let o = h.object; o; o = o.parent) if (o.visible === false) { vis = false; break; }
    if (!vis) continue;
    let o = h.object;
    while (o) {
      if (o.userData.cartId) return { cartId: o.userData.cartId };
      if (o.userData.drawerToggle) return { toggle: true, layer: o.userData.layerIdx };
      o = o.parent;
    }
  }
  return null;
}

async function handleDrawerClick(e) {
  const hit = raycastDrawer(e);
  if (!hit) return;
  if (hit.toggle) {
    drawer.toggleLayer(hit.layer, animator);
    audio.click();
    return;
  }
  if (hit.cartId) {
    const entry = collection.find((r) => r.id === hit.cartId);
    if (entry) selectCart(entry);
  }
}

// 悬停高亮抽屉卡带（rAF 节流）
let hoverPending = false;
canvas.addEventListener('pointermove', (e) => {
  if (hitButton || hoverPending) return;
  hoverPending = true;
  const cx = e.clientX, cy = e.clientY;
  requestAnimationFrame(() => {
    hoverPending = false;
    const hit = raycastDrawer({ clientX: cx, clientY: cy });
    const id = hit && hit.cartId ? hit.cartId : null;
    drawer.setHover(id);
    canvas.style.cursor = hit ? 'pointer' : '';
  });
});

// ---------- 触屏虚拟按键 ----------
function bindTouch(id, btn) {
  const el = $(id);
  if (!el) return;
  const down = (e) => { e.preventDefault(); unlockAudio(); pressBtn(btn, true); el.classList.add('active'); };
  const up = (e) => { e.preventDefault(); pressBtn(btn, false); el.classList.remove('active'); };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointerleave', up);
  el.addEventListener('pointercancel', up);
}
bindTouch('tUp', 'up'); bindTouch('tDown', 'down');
bindTouch('tLeft', 'left'); bindTouch('tRight', 'right');
bindTouch('tA', 'a'); bindTouch('tB', 'b');
bindTouch('tStart', 'start'); bindTouch('tSelect', 'select');
// 安卓 Chrome 长按会弹上下文菜单（复制/分享），直接拦掉
document.querySelector('.touch').addEventListener('contextmenu', (e) => e.preventDefault());
$('fsExit').addEventListener('contextmenu', (e) => e.preventDefault());

// ---------- 音频解锁 ----------
let audioToastShown = false;   // "声音已开启" 只提示一次，避免每次点击都弹
function unlockAudio() {
  audio.resume().then(() => {
    if (!audioToastShown && audio.ctx && audio.ctx.state === 'running' && !audio.usingTimer) {
      audioToastShown = true;
      showToast('声音已开启');
    }
  });
}
window.addEventListener('pointerdown', unlockAudio, { once: false });
window.addEventListener('keydown', unlockAudio, { once: false });

// ---------- 渲染循环 ----------
window.__gbDebug = (act) => {
  const bm = model.bodyMesh;
  const mats = Array.isArray(bm.material) ? bm.material : [bm.material];
  if (act === 'doubleside') for (const m of mats) m.side = THREE.DoubleSide;
  if (act === 'flipside') for (const m of mats) m.side = m.side === THREE.FrontSide ? THREE.BackSide : THREE.FrontSide;
  if (act === 'view') {
    camera.position.set(95, 55, 330);
    controls.target.set(0, 14, 0);
    controls.autoRotate = false;
    controls.update();
    return 'view reset';
  }
  if (act === 'cartview') {
    camera.position.set(6, 215, 235);
    controls.target.set(0, 58, 0);
    controls.autoRotate = false;
    controls.update();
    return 'cart view';
  }
  if (act === 'fs') {
    if (fsActive) exitFs(); else enterFs();
    return fsActive ? 'fs on' : 'fs off';
  }
  if (act === 'backview') {
    camera.position.set(60, 40, -330);
    controls.target.set(0, 10, 0);
    controls.autoRotate = false;
    controls.update();
    return 'back view';
  }
  if (act === 'drawerview') {
    // 视角随层数上移/拉远，保证多层抽屉都能入画
    const n = Math.max(1, drawer.layerCount);
    camera.position.set(-75, 170 + (n - 1) * 70, 310 + (n - 1) * 45);
    controls.target.set(-180, -74 + (n * 95) / 2 - 15, 160);
    controls.autoRotate = false;
    controls.update();
    return 'drawer view';
  }
  if (act === 'boxes') {
    const out = [];
    scene.traverse((o) => {
      if (o.isMesh && /^Cube/.test(o.name)) {
        const b = new THREE.Box3().setFromObject(o);
        const s = new THREE.Vector3(); b.getSize(s);
        const c = new THREE.Vector3(); b.getCenter(c);
        out.push({ name: o.name, size: s.toArray().map((v) => +v.toFixed(1)), center: c.toArray().map((v) => +v.toFixed(1)) });
      }
    });
    return out;
  }
  if (act === 'slot') {
    const v = (x) => x ? x.toArray().map((n) => +n.toFixed(1)) : null;
    return {
      hasSlot: !!model.parts.slot,
      slotCenter: v(model.parts.slot && model.parts.slot.center),
      slotSize: v(model.parts.slot && model.parts.slot.size),
      slotMinY: model.parts.slot ? +model.parts.slot.min.y.toFixed(1) : null,
      slotMaxY: model.parts.slot ? +model.parts.slot.max.y.toFixed(1) : null,
      bodyTop: model.parts.bodyTop,
      inserted: v(cart.insertedPos), hover: v(cart.hoverPos), spawn: v(cart.spawnPos),
      cartNow: v(cart.group.position),
    };
  }
  if (act === 'drawer') {
    return { open: drawer.isOpen, count: drawer.count, layers: drawer.layerStates(), ids: drawer.cartIds(), inserted: insertedCartId };
  }
  if (act === 'drawer:open') { drawer.open(animator); return 'opening'; }
  if (act === 'drawer:close') { drawer.close(animator); return 'closing'; }
  if (act === 'emu') {
    return {
      audioRunning: audio.running,
      usingTimer: audio.usingTimer,
      ctxState: audio.ctx ? audio.ctx.state : 'none',
      ctxRate: audio.ctx ? audio.ctx.sampleRate : 0,
      apuRate: gb.apu.sampleRate,
      apuAvailable: gb.apu.available(),
      frames: gb.frameCount,
      hasCart: !!gb.cartridge,
    };
  }
  if (act === 'bbox') {
    const out = [];
    model.group.updateMatrixWorld(true);
    model.group.traverse((o) => {
      if (o.isMesh) {
        const b = new THREE.Box3().setFromObject(o);
        const s = new THREE.Vector3(); b.getSize(s);
        const c = new THREE.Vector3(); b.getCenter(c);
        out.push({ n: (o.name || '?').slice(0, 14), c: c.toArray().map((v) => +v.toFixed(0)), s: s.toArray().map((v) => +v.toFixed(0)), vis: o.visible });
      }
    });
    return { cam: camera.position.toArray(), groupPos: model.group.position.toArray(), scale: model.group.scale.x, meshes: out.slice(0, 10), total: out.length };
  }
  if (act === 'probe') {
    const lp = model.parts.lcd;
    return {
      cartPos: cart.group.position.toArray(),
      cartVis: cart.group.visible,
      lcdPos: lp.position.toArray(),
      lcdVis: lp.visible,
      lcdW: lp.geometry.parameters.width,
      lcdH: lp.geometry.parameters.height,
      emu: window.__gbDebug('emu'),
    };
  }
  if (act === 'glass') {
    let n = 0;
    model.group.traverse((o) => {
      if (o.isMesh && /^glas_screen/.test(o.name || '')) { o.visible = o.visible === false; n++; }
    });
    return 'glass toggled x' + n;
  }
  if (act === 'cartprobe') {
    cart.group.updateWorldMatrix(true, true);
    const b = new THREE.Box3().setFromObject(cart.label);
    const c = new THREE.Vector3(); b.getCenter(c);
    const s = new THREE.Vector3(); b.getSize(s);
    return {
      groupPos: cart.group.position.toArray(),
      groupQuat: cart.group.quaternion.toArray().map((v) => +v.toFixed(2)),
      groupScale: cart.group.scale.x,
      labelWorldCenter: c.toArray().map((v) => +v.toFixed(1)),
      labelWorldSize: s.toArray().map((v) => +v.toFixed(1)),
      labelVisible: cart.label.visible,
      parentIsScene: cart.group.parent === scene,
    };
  }
  if (act === 'debugview') {
    camera.position.set(0, 0, 420);
    controls.target.set(0, 0, 0);
    controls.autoRotate = false;
    controls.update();
    if (!window.__grid) {
      const grid = new THREE.GridHelper(400, 40, 0xff0000, 0x888888);
      grid.rotation.x = Math.PI / 2; // 竖直网格面（YZ 平面 → 面向相机）
      window.__grid = grid;
      scene.add(grid);
      const axes = new THREE.AxesHelper(60);
      scene.add(axes);
      // 标记球：LCD 中心 / 十字键 / A 键 / 卡带标签顶
      const spots = [[0, 106, 20, 0xff0000], [-26, 47, 20, 0x00ff00], [33, 52, 20, 0x0000ff], [0, 74.5, 5, 0xffff00]];
      window.__markers = spots.map(([x, y, z, c]) => {
        const m = new THREE.Mesh(new THREE.SphereGeometry(3.2, 16, 12),
          new THREE.MeshBasicMaterial({ color: c, depthTest: false }));
        m.position.set(x, y, z);
        m.renderOrder = 99;
        scene.add(m);
        return m;
      });
    }
    window.__grid.visible = true;
    window.__markers.forEach((m) => { m.visible = true; });
    return 'debug view on';
  }
  if (act === 'proj') {
    const proj = (x, y, z) => {
      const p = new THREE.Vector3(x, y, z).project(camera);
      return [+((p.x * 0.5 + 0.5) * canvas.clientWidth).toFixed(0), +((-p.y * 0.5 + 0.5) * canvas.clientHeight).toFixed(0)];
    };
    return {
      origin: proj(0, 0, 0),
      y74: proj(0, 74, 0),
      y106: proj(0, 106, 20),
      dpad: proj(-26, 47, 20),
      btnA: proj(33, 52, 20),
      cartLabelTop: proj(0, 74.5, 4.3),
      cam: camera.position.toArray().map((v) => +v.toFixed(0)),
      canvasSize: [canvas.clientWidth, canvas.clientHeight],
    };
  }
  if (act === 'joy') {
    const j = gb.joypad;
    return { a: j.a ?? j.state, keys: Object.keys(j), sel: j.selectBits ?? j._state ?? null };
  }
  if (typeof act === 'string' && act.startsWith('pick:')) {
    const [fx, fy] = act.slice(5).split(',').map(Number);
    pointer.set(fx * 2 - 1, -(fy * 2 - 1));
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(model.parts.hitZones, true);
    const out = [];
    for (const h of hits.slice(0, 4)) {
      let o = h.object;
      while (o && !o.userData.btn) o = o.parent;
      out.push({ btn: o ? o.userData.btn : null, name: (h.object.name || '').slice(0, 12), d: +h.distance.toFixed(0) });
    }
    return { out, zoneCount: model.parts.hitZones.length,
      btnInfo: (() => {
        const w = model.parts.buttons.a;
        if (!w) return 'no wrapper';
        w.updateWorldMatrix(true, true);
        const b = new THREE.Box3().setFromObject(w);
        const c = new THREE.Vector3(); b.getCenter(c);
        const p = c.clone().project(camera);
        return { world: c.toArray().map((v) => +v.toFixed(1)),
          ndc: [+p.x.toFixed(2), +p.y.toFixed(2)],
          px: [+((p.x * 0.5 + 0.5) * canvas.clientWidth).toFixed(0), +((-p.y * 0.5 + 0.5) * canvas.clientHeight).toFixed(0)],
          visible: w.visible };
      })() };
  }
  if (act === 'spin') { controls.autoRotate = !controls.autoRotate; return controls.autoRotate; }
  const g = bm.geometry;
  const idx = g.index;
  const p = g.attributes.position;
  const A = new THREE.Vector3().fromBufferAttribute(p, idx.getX(0));
  const B = new THREE.Vector3().fromBufferAttribute(p, idx.getX(1));
  const C = new THREE.Vector3().fromBufferAttribute(p, idx.getX(2));
  const geoN = new THREE.Vector3().subVectors(B, A).cross(new THREE.Vector3().subVectors(C, A));
  return {
    front: new THREE.Vector3(0, 0, 1).transformDirection(bm.matrixWorld).toArray(),
    up: new THREE.Vector3(0, 1, 0).transformDirection(bm.matrixWorld).toArray(),
    side: mats.map((m) => m.side),
    firstTriGeoNormal: geoN.toArray(),
    attNormal: g.attributes.normal ? new THREE.Vector3().fromBufferAttribute(g.attributes.normal, idx.getX(0)).toArray() : null,
  };
};

let last = performance.now();
let fpsCount = 0, fpsTime = 0, lastFrameCount = 0;

function loop(now) {
  requestAnimationFrame(loop);
  // 首帧的 rAF 时间戳可能早于模块执行完的时刻（负 dt），必须夹到 [0, 0.05]
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
  last = now;

  animator.update(dt);
  controls.update();

  // LCD 内容
  if (state === 'running') {
    if (gb.frameCount !== lastFrameCount) {
      lastFrameCount = gb.frameCount;
      lcdScreen.drawFramebuffer(gb.ppu.framebuffer);
      if (bootFlash > 0) {
        lcdScreen.drawBootFlash(bootFlash);
        bootFlash -= dt / 0.6;
      }
      lcdTexture.needsUpdate = true;
    } else if (bootFlash > 0) {
      lcdScreen.drawBootFlash(bootFlash);
      bootFlash -= dt / 0.6;
      lcdTexture.needsUpdate = true;
    }
  } else if (state === 'idle' || state === 'inserting' || state === 'ejecting') {
    idleTime += dt;
    lcdScreen.drawIdle(idleTime);
    lcdTexture.needsUpdate = true;
  }

  renderer.render(scene, camera);

  // FPS
  fpsCount++;
  fpsTime += dt;
  if (fpsTime >= 1) {
    fpsChip.textContent = `${fpsCount} FPS`;
    fpsCount = 0; fpsTime = 0;
  }
}
requestAnimationFrame(loop);
// 首帧真正画出来之后再收启动遮罩（避免露出空白画布）
requestAnimationFrame(() => requestAnimationFrame(finishBoot));

// ---------- 启动：初始化抽屉收藏 ----------
(async () => {
  await ensureDemoROM();            // 默认提供试玩卡带（Kirby）
  collection = await listROMs();
  refreshDrawer();
  setTimeout(() => showToast('点击左侧抽屉查看卡带收藏，点卡带插入体验'), 1400);
})();
