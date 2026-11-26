// Game Boy Advance（AGB-001）3D 机身
//
// 使用 Sketchfab 上的 CC-BY 模型：
//   "GameBoy Advance" by N4B1L Nassir
//   https://sketchfab.com/3d-models/gameboy-advance-1f0cec299147469f8f856c6fb8867c30
//   体素风格，6726 三角面，单网格 + 256×1 调色板贴图。
//
// 模型原始单位约 1cm（14.7 × 8.1 × 2.3），正面朝 +Z。这里把它缩放到真机
// 144.5mm 宽，再用「按渲染图测出来的坐标」贴 LCD、按键代理、指示灯和卡带槽。
//
// 关键坐标（模型局部单位，居中后）都是在正交正面渲染图上按像素量出来的，
// 换算关系：1 单位 ≈ 9.83mm（144.5 / 14.7）。

import * as THREE from 'three';
import { GLTFLoader } from '../../vendor/GLTFLoader.js';
import { loadGLBWithProgress } from './modelLoader.js';

const BODY_W = 14.7;              // 模型原始宽度（单位）
const TARGET_W = 144.5;           // 真机宽度（mm）
const FRONT_Z = 1.15;             // 正面 z（居中后，模型厚 2.3）

// 测量值（模型局部单位）
const LCD = { cx: 0.09, cy: 0.40, w: 6.49, h: 4.29 };
const DPAD = { x: -5.21, y: 0.71, size: 1.69 };
const BTN_A = { x: 6.20, y: 0.91, r: 0.45 };
const BTN_B = { x: 4.89, y: 0.41, r: 0.45 };
const BTN_SELECT = { x: -4.30, y: -1.30, size: 0.55 };
const BTN_START = { x: -4.30, y: -2.09, size: 0.55 };
const SHOULDER_L = { x: -5.65, y: 3.01, w: 2.6, h: 1.3 };
const SHOULDER_R = { x: 5.64, y: 3.01, w: 2.6, h: 1.3 };
const LED = { x: 4.84, y: 2.66, r: 0.12 };
const SLOT_Y = 4.05;              // 顶部卡槽

export const SHELL_COLORS = {
  indigo: { name: '原色（靛紫）', tint: 0xffffff },
  glacier: { name: '冰川蓝', tint: 0xa9c9ff },
  black: { name: '午夜黑', tint: 0x77778a },
  white: { name: '雪白', tint: 0xffe6ee },
  orange: { name: '珊瑚橙', tint: 0xffb182 },
};

function invisibleProxy(geometry) {
  return new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
  );
}

export async function createGBA({ lcdTexture, onProgress } = {}) {
  const group = new THREE.Group();

  // ---------- 加载模型 ----------
  const gltf = await loadGLBWithProgress(new GLTFLoader(), 'models/gba.glb', onProgress);
  const body = gltf.scene;
  body.updateMatrixWorld(true);

  // 居中（此时 group 还没缩放，世界坐标 == group 局部坐标）
  const box = new THREE.Box3().setFromObject(body);
  const center = box.getCenter(new THREE.Vector3());
  body.position.sub(center);
  body.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      // 体素模型的调色板贴图要用最近邻，否则颜色会互相串
      const m = o.material;
      if (m && m.map) {
        m.map.magFilter = THREE.NearestFilter;
        m.map.minFilter = THREE.NearestFilter;
        m.map.generateMipmaps = false;
        m.map.needsUpdate = true;
      }
      if (m) { m.roughness = Math.min(1, (m.roughness ?? 0.7) + 0.1); m.metalness = 0.05; }
    }
  });
  group.add(body);

  // 缩放到真机宽度
  const S = TARGET_W / BODY_W;
  group.scale.setScalar(S);

  const baseMaterials = [];
  body.traverse((o) => { if (o.isMesh && o.material) baseMaterials.push(o.material); });

  // ---------- LCD ----------
  const lcd = new THREE.Mesh(
    new THREE.PlaneGeometry(LCD.w, LCD.h),
    new THREE.MeshBasicMaterial({ map: lcdTexture, toneMapped: false })
  );
  lcd.position.set(LCD.cx, LCD.cy, FRONT_Z + 0.02);
  lcd.renderOrder = 2;
  group.add(lcd);

  // ---------- 按键射线代理（不可见） ----------
  const hitMeshes = [];
  const buttons = {};

  function addProxy(name, mesh) {
    mesh.userData.btn = name;
    mesh.position.z = FRONT_Z + 0.05;
    group.add(mesh);
    hitMeshes.push(mesh);
    buttons[name] = mesh;
    return mesh;
  }

  addProxy('dpad', (() => {
    const m = invisibleProxy(new THREE.PlaneGeometry(DPAD.size, DPAD.size));
    m.position.set(DPAD.x, DPAD.y, 0);
    return m;
  })());

  for (const [name, b] of [['a', BTN_A], ['b', BTN_B]]) {
    const m = invisibleProxy(new THREE.CircleGeometry(b.r, 20));
    m.position.set(b.x, b.y, 0);
    addProxy(name, m);
  }

  for (const [name, b] of [['select', BTN_SELECT], ['start', BTN_START]]) {
    const m = invisibleProxy(new THREE.PlaneGeometry(b.size, b.size));
    m.position.set(b.x, b.y, 0);
    addProxy(name, m);
  }

  for (const [name, b] of [['l', SHOULDER_L], ['r', SHOULDER_R]]) {
    const m = invisibleProxy(new THREE.PlaneGeometry(b.w, b.h));
    m.position.set(b.x, b.y, 0);
    addProxy(name, m);
  }

  // ---------- 指示灯（盖住模型自带的绿灯，运行时变红） ----------
  const ledMat = new THREE.MeshBasicMaterial({ color: 0x2a0d14, toneMapped: false });
  const led = new THREE.Mesh(new THREE.CircleGeometry(LED.r, 16), ledMat);
  led.position.set(LED.x, LED.y, FRONT_Z + 0.06);
  led.renderOrder = 3;
  group.add(led);

  // ---------- 卡带槽锚点 ----------
  const slot = {
    center: new THREE.Vector3(0, SLOT_Y, -0.3),
    insertedPos: new THREE.Vector3(0, SLOT_Y - 1.6, -0.3),
    hoverPos: new THREE.Vector3(0, SLOT_Y + 3.2, -0.3),
    spawnPos: new THREE.Vector3(0, SLOT_Y + 12, -0.3),
  };

  // ---------- 换壳：整体染色（模型是单材质调色板贴图） ----------
  function setShellColor(key) {
    const c = SHELL_COLORS[key];
    if (!c) return false;
    baseMaterials.forEach((m) => m.color.setHex(c.tint));
    return true;
  }

  return {
    group,
    setShellColor,
    parts: {
      slot,
      buttons,
      hitMeshes,
      ledMat,
      bodyTop: SLOT_Y,
      dpad: { x: DPAD.x, y: DPAD.y },
      screen: { w: LCD.w, h: LCD.h, cy: LCD.cy },
      scale: S,
    },
  };
}

/** 体素风格卡带（模型里没有，按真机 57.5×35×5mm 做一个同色系的） */
export function createVoxelCartridge({ labelTexture = null } = {}) {
  const group = new THREE.Group();
  const shellMat = new THREE.MeshStandardMaterial({ color: 0x8b93a8, roughness: 0.65, metalness: 0.05 });
  const W = 5.85, H = 3.56, D = 0.5;    // 模型单位（≈57.5 × 35 × 5 mm）
  const shell = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), shellMat);
  shell.castShadow = true;
  group.add(shell);

  // 顶部凹口
  const notchMat = new THREE.MeshStandardMaterial({ color: 0x5a6070, roughness: 0.7 });
  const notch = new THREE.Mesh(new THREE.BoxGeometry(W * 0.86, 0.16, D * 0.9), notchMat);
  notch.position.set(0, H / 2 - 0.1, 0);
  group.add(notch);

  const labelMat = new THREE.MeshBasicMaterial({
    map: labelTexture || null,
    color: labelTexture ? 0xffffff : 0x6d6d80,
  });
  const label = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.82, H * 0.62), labelMat);
  label.position.set(0, 0, D / 2 + 0.01);
  label.renderOrder = 2;
  group.add(label);

  group.visible = false;
  return {
    group,
    setLabel(tex) {
      labelMat.map = tex;
      labelMat.color.setHex(0xffffff);
      labelMat.needsUpdate = true;
    },
  };
}
