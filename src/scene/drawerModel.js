// 卡带抽屉柜：多层结构，每层一个可拉出抽屉（4 列 × 2 排 = 8 格）。
// 卡带平躺（标签朝上）。某层放满后自动在上方新增一层；每层独立开合。
//
// 坐标：group 原点在柜体底层底面中心（落地），开口朝 local +z。

import * as THREE from 'three';

const CAB = { w: 300, h: 95, d: 220 };     // 单层外尺寸
const TRAY = { w: 280, d: 204, wallH: 26, floorT: 8, frontH: 75 };
const PULL = 130;                          // 拉出距离
const COLS = 4, ROWS = 2;
const PITCH_X = 64, PITCH_Z = 85;
export const CAPACITY = COLS * ROWS;       // 单层容量

// 柜体落地摆放（世界坐标）：机身左后侧，开口斜朝镜头，避开机身正前方视线
export const DRAWER_POS = { x: -255, y: -74, z: 55, rotY: 0.62 };

const WOOD = 0x5a4230;      // 深胡桃木
const WOOD_IN = 0x6b5140;   // 抽屉内侧略浅
const DARK = 0x2a2a2e;

function box(w, h, d, mat, x, y, z, parent) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

// 槽位（相对抽屉中心）：4 列 × 2 排
function slotPos(i) {
  const col = i % COLS, row = (i / COLS) | 0;
  const x = (col - (COLS - 1) / 2) * PITCH_X;
  const z = row === 0 ? 45 : -42;   // 前排靠近柜口
  return { x, z };
}

export function createDrawer() {
  const group = new THREE.Group();

  const woodMat = new THREE.MeshStandardMaterial({ color: WOOD, roughness: 0.85, metalness: 0.02 });
  const inMat = new THREE.MeshStandardMaterial({ color: WOOD_IN, roughness: 0.9, metalness: 0.02 });
  const darkMat = new THREE.MeshStandardMaterial({ color: DARK, roughness: 0.6, metalness: 0.1 });
  const dividerMat = new THREE.MeshStandardMaterial({ color: WOOD_IN, roughness: 0.9 });

  // 柜体下沿装饰条（只在最底部一条）
  box(CAB.w + 6, 5, CAB.d + 6, darkMat, 0, 2.5, 0, group);

  const layers = [];   // { layer, tray, front, handle, carts:Map, isOpen }
  const t = 8;         // 板厚

  function makeLayer(idx) {
    const layer = new THREE.Group();
    layer.position.y = idx * CAB.h;
    group.add(layer);
    const { w, h, d } = CAB;

    // ---------- 柜壳（前面开口） ----------
    const cab = new THREE.Group();
    layer.add(cab);
    box(w, t, d, woodMat, 0, t / 2, 0, cab);                 // 底板
    box(w, t, d, woodMat, 0, h - t / 2, 0, cab);             // 顶板
    box(t, h, d, woodMat, -w / 2 + t / 2, h / 2, 0, cab);    // 左侧板
    box(t, h, d, woodMat, w / 2 - t / 2, h / 2, 0, cab);     // 右侧板
    box(w, h, t, woodMat, 0, h / 2, -d / 2 + t / 2, cab);    // 背板

    // ---------- 抽屉盒 ----------
    const tray = new THREE.Group();
    layer.add(tray);
    const tw = TRAY.w, td = TRAY.d;
    const baseY = t + 2;                       // 抽屉底在柜底板上
    box(tw, TRAY.floorT, td, inMat, 0, baseY + TRAY.floorT / 2, 0, tray);           // 底板
    box(tw, TRAY.wallH, t, inMat, 0, baseY + TRAY.wallH / 2, -td / 2 + t / 2, tray); // 后壁
    box(t, TRAY.wallH, td, inMat, -tw / 2 + t / 2, baseY + TRAY.wallH / 2, 0, tray); // 左壁
    box(t, TRAY.wallH, td, inMat, tw / 2 - t / 2, baseY + TRAY.wallH / 2, 0, tray);  // 右壁
    // 前板（盖住柜口，高一点）
    const front = box(tw + 2, TRAY.frontH, t, woodMat, 0, baseY + TRAY.frontH / 2 - 2, td / 2 + t / 2, tray);
    front.userData.drawerToggle = true;
    front.userData.layerIdx = idx;
    // 把手
    const handle = box(70, 8, 6, darkMat, 0, baseY + TRAY.frontH - 22, td / 2 + t + 2, tray);
    handle.userData.drawerToggle = true;
    handle.userData.layerIdx = idx;

    // ---------- 槽分隔（矮格条，别挡卡带标签） ----------
    for (let c = 1; c < COLS; c++) {
      const x = (c - COLS / 2) * PITCH_X;
      box(4, 9, td - 30, dividerMat, x, baseY + TRAY.floorT + 4.5, -2, tray);
    }
    // 前后排之间
    box(tw - 20, 9, 4, dividerMat, 0, baseY + TRAY.floorT + 4.5, 2, tray);

    const L = { layer, tray, front, handle, baseY, carts: new Map(), isOpen: false, idx };
    layers.push(L);
    group.updateMatrixWorld(true);
    return L;
  }

  function freeSlot(L) {
    const used = new Set([...L.carts.values()].map((c) => c.slotIdx));
    for (let i = 0; i < CAPACITY; i++) if (!used.has(i)) return i;
    return -1;
  }

  function addCart(id, texture, opts = {}) {
    // 已存在直接返回
    for (const L of layers) {
      if (L.carts.has(id)) return L.carts.get(id);
    }
    // 找有富余槽位的层；都满了就在上方新增一层
    let L = layers.find((l) => l.carts.size < CAPACITY);
    if (!L) L = makeLayer(layers.length);
    const slotIdx = freeSlot(L);
    if (slotIdx < 0) return null;

    const g = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xcfccc4, roughness: 0.5, metalness: 0.03 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(57, 65, 8.5), bodyMat);
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(46, 40),
      new THREE.MeshStandardMaterial({ map: texture, roughness: 0.55 })
    );
    label.position.set(0, 2, 4.31);
    g.add(label);
    const { x, z } = slotPos(slotIdx);
    // 平躺：绕 X 转 -90°，卡带的 65mm 长边躺到 z 轴、8.5mm 厚度朝上，
    // 标签面（local +z）正好转到正上方
    g.rotation.x = -Math.PI / 2;
    const cy = L.baseY + TRAY.floorT + 8.5 / 2 + 0.8;   // 平放在抽屉底板上
    g.position.set(x, cy, z);
    g.userData.cartId = id;
    g.userData.bodyMat = bodyMat;
    g.userData.label = label;
    L.tray.add(g);
    const rec = { group: g, baseY: cy, slotIdx, layerIdx: L.idx };
    L.carts.set(id, rec);
    return rec;
  }

  function findLayer(id) {
    for (const L of layers) if (L.carts.has(id)) return L;
    return null;
  }

  function removeCart(id) {
    const L = findLayer(id);
    if (!L) return;
    L.tray.remove(L.carts.get(id).group);
    L.carts.delete(id);
  }

  function setLayerOpen(L, open, animator) {
    L.isOpen = open;
    const from = L.tray.position.z;
    const to = open ? PULL : 0;
    if (!animator) { L.tray.position.z = to; return; }
    animator.add({
      duration: 0.55, ease: open ? 'outCubic' : 'inOutQuad',
      onUpdate: (e) => { L.tray.position.z = from + (to - from) * e; },
    });
  }

  // ---------- 位置 ----------
  group.position.set(DRAWER_POS.x, DRAWER_POS.y, DRAWER_POS.z);
  group.rotation.y = DRAWER_POS.rotY;
  makeLayer(0);   // 初始一层
  group.updateMatrixWorld(true);

  return {
    group,
    get isOpen() { return layers.some((l) => l.isOpen); },
    get layerCount() { return layers.length; },
    // 单层开合
    openLayer: (idx, animator) => { const L = layers[idx]; if (L) setLayerOpen(L, true, animator); },
    closeLayer: (idx, animator) => { const L = layers[idx]; if (L) setLayerOpen(L, false, animator); },
    toggleLayer: (idx, animator) => { const L = layers[idx]; if (L) setLayerOpen(L, !L.isOpen, animator); },
    // 全部开合（选中卡带后统一关上 / 调试用）
    open: (animator) => layers.forEach((L) => setLayerOpen(L, true, animator)),
    close: (animator) => layers.forEach((L) => setLayerOpen(L, false, animator)),
    toggle: (animator) => {
      const anyOpen = layers.some((l) => l.isOpen);
      layers.forEach((L) => setLayerOpen(L, !anyOpen, animator));
    },
    getHitTargets: () => layers.map((l) => [l.front, l.handle]).flat(),
    get trays() { return layers.map((l) => l.tray); },
    layerStates: () => layers.map((l) => ({ open: l.isOpen, carts: l.carts.size, z: +l.tray.position.z.toFixed(1) })),
    layerOf: (id) => { const L = findLayer(id); return L ? L.idx : -1; },
    addCart,
    removeCart,
    getCart: (id) => { const L = findLayer(id); return L ? L.carts.get(id) : undefined; },
    hideCart: (id) => { const r = layers.reduce((acc, L) => acc || L.carts.get(id), null); if (r) r.group.visible = false; },
    showCart: (id) => { const r = layers.reduce((acc, L) => acc || L.carts.get(id), null); if (r) r.group.visible = true; },
    cartIds: () => layers.map((l) => [...l.carts.keys()]).flat(),
    get count() { return layers.reduce((n, l) => n + l.carts.size, 0); },
    capacity: CAPACITY,   // 单层容量（总容量随层数动态增长）
    // 悬停高亮（返回被高亮的 id，null = 取消全部）
    setHover(id) {
      for (const L of layers) {
        for (const [cid, rec] of L.carts) {
          const on = cid === id && rec.group.visible;
          rec.group.position.y = rec.baseY + (on ? 5 : 0);
          rec.group.userData.bodyMat.emissive.setHex(on ? 0x33302a : 0x000000);
        }
      }
    },
    // 新卡带高亮（上浮 + 左右摇摆）
    highlight(id, animator) {
      const L = findLayer(id);
      const rec = L && L.carts.get(id);
      if (!rec || !animator) return;
      const g = rec.group;
      animator.add({
        duration: 0.9, ease: 'outCubic',
        onUpdate: (e, p) => {
          g.position.y = rec.baseY + Math.sin(p * Math.PI) * 14;
          g.rotation.z = Math.sin(p * Math.PI * 3) * 0.05 * (1 - p);
        },
        onComplete: () => { g.position.y = rec.baseY; g.rotation.z = 0; },
      });
    },
  };
}
