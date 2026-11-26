// 高精度 Game Boy DMG 模型集成
// 模型: "Game Boy High Poly SDS ready" by danielweinlein (Sketchfab, CC-BY)
//       https://sketchfab.com/3d-models/game-boy-high-poly-sds-ready-4e41c3f5079e4104a0a7f497ab05a087
// 29 个独立部件网格，89.9 万三角面，无卡带。
//
// 坐标约定：修正 + 归一化后，group 内坐标 ≈ 毫米，机身 88.5 x 148 x 33，
// 中心在原点（y ∈ [-74, 74]），正面朝 +z。

import * as THREE from 'three';
import { GLTFLoader } from '../../vendor/GLTFLoader.js?v=1795666799';
import { loadGLBWithProgress } from './modelLoader.js?v=1795666799';

const TARGET_H = 148;   // 真机高度 mm
const FLOOR_Y = -74;

// LCD 可视区（真机 47 x 43mm）。group 中心对齐（y ∈ [-74, 74]），
// 部件世界坐标 = 预览工具（底部对齐）测得值 - 74
const LCD = { cx: 0, cy: 32, w: 47, h: 43, z: 14.55 };

// 十字键中心与四方向热区
const DPAD = { cx: -26, cy: -27 };
const DPAD_ZONES = [
  { btn: 'up',    x: DPAD.cx,      y: DPAD.cy + 7.5, w: 10, h: 9 },
  { btn: 'down',  x: DPAD.cx,      y: DPAD.cy - 7.5, w: 10, h: 9 },
  { btn: 'left',  x: DPAD.cx - 7.5, y: DPAD.cy,      w: 9,  h: 10 },
  { btn: 'right', x: DPAD.cx + 7.5, y: DPAD.cy,      w: 9,  h: 10 },
];

// 真机 DMG 配色
const BODY_COLOR = 0xc9c4b8;   // 米灰机身
const BTN_AB     = 0x9b2b5c;   // A/B 品红
const BTN_SS     = 0x5d4a63;   // SELECT/START 暗紫灰
const DPAD_COLOR = 0x43454d;   // 十字键深灰
const DARK_PARTS = 0x4a4c52;   // 开关/音量轮等
const PLATE      = 0x1e2025;   // 屏幕黑板

// 可选外壳颜色（运行时可切换）
export const SHELL_COLORS = {
  dmg:    { name: '经典米灰', body: 0xc9c4b8, dark: 0x4a4c52 },
  black:  { name: '深邃黑',   body: 0x2e2f34, dark: 0x191a1e },
  purple: { name: '原子紫',   body: 0x7a5fa8, dark: 0x3d3350 },
  red:    { name: '樱桃红',   body: 0xb03a48, dark: 0x57222b },
  blue:   { name: '冰湖蓝',   body: 0x7fa8c9, dark: 0x3d5468 },
};

// mesh 名 → 材质方案
function matFor(name) {
  const n = (name || '').toLowerCase();
  if (/^a__|^b__/.test(n)) return { color: BTN_AB, roughness: 0.42 };
  if (/^select|^start/.test(n)) return { color: BTN_SS, roughness: 0.5 };
  if (/^control_cross|^arrows/.test(n)) return { color: DPAD_COLOR, roughness: 0.5 };
  if (/^on_off|contrast|volume|adjusting|headphone|ext_connector|connector_contact/.test(n))
    return { color: DARK_PARTS, roughness: 0.5 };
  if (/^lamp/.test(n)) return { led: true };
  if (/^glas_screen/.test(n)) return { glass: true };
  if (/^inner_plate|^screen_back/.test(n)) return { color: PLATE, roughness: 0.55 };
  if (/^sticker/.test(n)) return { color: 0x53555c, roughness: 0.5 };
  return { color: BODY_COLOR, roughness: 0.62 };
}

// 把 mesh 包进轴对齐 wrapper（wrap 的局部旋转 = 原 mesh 世界旋转），
// 这样按按下时只需沿"世界 -z 方向对应的局部向量"平移 wrap。
function wrapButton(mesh, depth) {
  const parent = mesh.parent;
  mesh.updateWorldMatrix(true, false);
  const wrap = new THREE.Group();
  const parentInv = new THREE.Matrix4().copy(parent.matrixWorld).invert();
  const local = new THREE.Matrix4().multiplyMatrices(parentInv, mesh.matrixWorld);
  local.decompose(wrap.position, wrap.quaternion, wrap.scale);
  parent.add(wrap);
  wrap.add(mesh);
  mesh.position.set(0, 0, 0);
  mesh.quaternion.identity();
  mesh.scale.set(1, 1, 1);
  mesh.updateMatrix();
  // 世界 -z 的按压方向 → wrap 父空间
  const rotInv = new THREE.Matrix4().extractRotation(parentInv);
  const scale = parent.getWorldScale(new THREE.Vector3()).x || 1;
  wrap.userData.pressLocal = new THREE.Vector3(0, 0, -1)
    .applyMatrix4(rotInv).normalize().multiplyScalar(depth / scale);
  wrap.userData.basePos = wrap.position.clone();
  return wrap;
}

export async function createGameBoy({ lcdTexture, onProgress } = {}) {
  const group = new THREE.Group();

  const loader = new GLTFLoader();
  const gltf = await loadGLBWithProgress(loader, 'models/gb-dmg-v2.glb', onProgress);
  const obj = gltf.scene;

  // ---------- 1. 重置 Sketchfab 摆拍姿势：清零所有无网格容器节点的旋转 ----------
  obj.traverse((o) => {
    if (!o.isMesh && !o.isScene) {
      o.rotation.set(0, 0, 0);
      o.quaternion.identity();
      o.updateMatrix();
    }
  });

  // ---------- 2. 收集 mesh，修正法线/金属度，按部件上色 ----------
  const meshes = [];
  const bodyMats = [];  // 外壳材质（换色用）
  const darkMats = [];  // 深色小零件材质（换色用）
  let ledMat = null;
  const ledMatInstance = new THREE.MeshStandardMaterial({
    color: 0x3a1015, roughness: 0.3, emissive: 0x000000, emissiveIntensity: 0,
  });
  obj.traverse((o) => {
    if (!o.isMesh) return;
    // 模型自带一根固定插在卡槽里的卡带（game_mesh）及其贴纸（sticker），
    // 一并隐藏，卡槽留给程序化卡带模型做插入/拔出动画
    if (/^(game_mesh|sticker)/i.test(o.name || '')) { o.visible = false; return; }
    o.castShadow = true;
    o.receiveShadow = true;
    const scheme = matFor(o.name);
    let mat;
    if (scheme.led) {
      mat = ledMatInstance;
      ledMat = ledMatInstance;
    } else if (scheme.glass) {
      mat = new THREE.MeshPhysicalMaterial({
        color: 0x39423f, roughness: 0.08, metalness: 0,
        transparent: true, opacity: 0.24, depthWrite: false,
        clearcoat: 1, clearcoatRoughness: 0.06,
      });
      o.renderOrder = 3;
    } else {
      mat = new THREE.MeshStandardMaterial({
        color: scheme.color, roughness: scheme.roughness, metalness: 0.02,
      });
      if (scheme.color === BODY_COLOR) bodyMats.push(mat);
      else if (scheme.color === DARK_PARTS) darkMats.push(mat);
    }
    o.material = mat;
    meshes.push(o);
  });

  // ---------- 3. 朝向修正（预览工具验证过的固定链） ----------
  // 长轴 z → y；屏幕在 -z 侧 → 绕 Y 转 180°；按键在屏幕上方 → 绕 Z 转 180°
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  q.premultiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI, 0)));
  q.premultiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI)));
  obj.quaternion.premultiply(q);
  group.add(obj);
  obj.updateMatrixWorld(true);

  // ---------- 4. 缩放与居中 ----------
  let bb = new THREE.Box3();
  meshes.forEach((m) => bb.expandByObject(m));
  const size = new THREE.Vector3(); bb.getSize(size);
  const s = TARGET_H / Math.max(size.x, size.y, size.z);
  obj.scale.setScalar(s);
  obj.updateMatrixWorld(true);

  bb = new THREE.Box3();
  meshes.forEach((m) => bb.expandByObject(m));
  const center = new THREE.Vector3(); bb.getCenter(center);
  obj.position.set(-center.x, -center.y, -center.z); // 机身几何中心 → 原点
  obj.updateMatrixWorld(true);

  // ---------- 4.5 卡槽基准：内置卡带 game_mesh 的位置就是建模者按真机摆的插槽，
  //            用它反推精确插槽坐标，避免硬编码带来的偏移 ----------
  let slot = null;
  {
    const slotMeshes = [];
    obj.traverse((o) => {
      if (o.isMesh && /^game_mesh/i.test(o.name || '')) slotMeshes.push(o);
    });
    if (slotMeshes.length) {
      const sb = new THREE.Box3();
      slotMeshes.forEach((m) => sb.expandByObject(m));
      const sz = new THREE.Vector3(); sb.getSize(sz);
      const c = new THREE.Vector3(); sb.getCenter(c);
      slot = { center: c, size: sz, min: sb.min.clone(), max: sb.max.clone() };
    }
  }
  bb = new THREE.Box3();
  meshes.forEach((m) => bb.expandByObject(m));
  const bodyTop = bb.max.y;   // 机身顶面（≈ +74）

  // ---------- 5. 找部件（按名字） ----------
  const byName = (re) => meshes.find((m) => re.test(m.name || ''));
  const bodyMesh = byName(/^back_mesh/) || meshes[0];
  const lampMesh = byName(/^lamp/);
  const glasMesh = byName(/^glas_screen/);
  const btnMeshes = {
    a: byName(/^a__/), b: byName(/^b__/),
    start: byName(/^start/), select: byName(/^select/),
  };
  const dpadMesh = byName(/^control_cross/);

  // ---------- 6. LCD 叠放层（模拟器画面，贴在黑板前、玻璃后） ----------
  const lcd = new THREE.Mesh(
    new THREE.PlaneGeometry(LCD.w, LCD.h),
    new THREE.MeshBasicMaterial({ map: lcdTexture, toneMapped: false })
  );
  lcd.position.set(LCD.cx, LCD.cy, LCD.z);
  lcd.renderOrder = 2;
  group.add(lcd);

  // ---------- 7. 按键 wrapper（供按压动画） ----------
  const buttons = {};
  const pressDepth = { a: 1.3, b: 1.3, start: 1.0, select: 1.0, dpad: 0.9 };
  for (const [k, m] of Object.entries(btnMeshes)) {
    if (!m) continue;
    const w = wrapButton(m, pressDepth[k]);
    w.userData.btn = k;
    buttons[k] = w;
  }
  let dpad = null;
  if (dpadMesh) {
    dpad = wrapButton(dpadMesh, pressDepth.dpad);
    dpad.userData.btn = 'dpad';
  }

  // ---------- 8. 十字键四方向热区（不可见，射线拾取） ----------
  const hitZones = [];
  for (const h of DPAD_ZONES) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(h.w, h.h, 6),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    m.position.set(h.x, h.y, 13);
    m.userData.btn = h.btn;
    group.add(m);
    hitZones.push(m);
  }
  // 真实按键也可点击
  for (const w of [...Object.values(buttons), dpad]) {
    if (w) hitZones.push(w);
  }

  return {
    group,
    // 切换外壳颜色（SHELL_COLORS 的键名）
    setShellColor(key) {
      const c = SHELL_COLORS[key];
      if (!c) return false;
      bodyMats.forEach((m) => m.color.setHex(c.body));
      darkMats.forEach((m) => m.color.setHex(c.dark));
      return true;
    },
    parts: {
      ledMat: ledMat || ledMatInstance,
      hitZones,
      buttons: {
        a: buttons.a, b: buttons.b, start: buttons.start, select: buttons.select,
        up: dpad, down: dpad, left: dpad, right: dpad, dpad,
      },
      lcd,
      lampMesh,
      slot,          // 内置卡带的槽位（已隐藏），用于定位插入坐标
      bodyTop,       // 机身顶面 y
    },
    bodyMesh,
  };
}
