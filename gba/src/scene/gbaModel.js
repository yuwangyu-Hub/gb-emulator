// Game Boy Advance（AGB-001）程序化 3D 机身
//
// 没有现成的 AGB GLB 模型，这里用 three.js 几何体按真机尺寸搭：
// 144.5 × 82 × 24.5 mm，屏幕 61.2 × 40.8 mm（240×160，3:2）。
// 坐标单位 = 毫米，机身中心在原点，正面朝 +z。
//
// 轮廓按真机的辨识特征做，不是简单圆角矩形：
//   · 两端（握持区）最高，41mm 半高
//   · 中间收腰：上沿降到 39，下沿升到 33（下缘比上缘弯得多）
//   · 左肩 / 右肩向上外扩，L / R 键就藏在那两个鼓包上
//   · 顶部正中是卡带槽

import * as THREE from 'three';
import { slab, plastic, extrude } from './geom.js';

// 真机尺寸
const HW = 72.25;        // 半宽（144.5mm）
const HE = 41;           // 端部半高（82mm）
const TOP_MID = 38.5;    // 上沿中点（收腰）
const BOT_MID = 36.5;    // 下沿中点（比上沿收得更多）
const BODY_D = 24.5;     // 厚度
const FRONT = BODY_D / 2;
const SCREEN = { w: 61.2, h: 40.8, cy: 4 };
const DPAD = { x: -50, y: 3 };

export const SHELL_COLORS = {
  indigo: { name: '靛紫（原色）', body: 0x4a3f7a, dark: 0x2a2740, accent: 0x8e3a52 },
  glacier: { name: '冰川蓝', body: 0x7fa6c8, dark: 0x33495f, accent: 0x8e3a52 },
  black: { name: '午夜黑', body: 0x25262c, dark: 0x14151a, accent: 0x8e3a52 },
  white: { name: '雪白', body: 0xd2cfc4, dark: 0x43454c, accent: 0x9c4060 },
  orange: { name: '珊瑚橙', body: 0xc4713f, dark: 0x5e2c18, accent: 0x8e3a52 },
};

/**
 * AGB-001 正面轮廓：圆角矩形（r≈17mm）+ 轻微收腰
 *
 * 真机的上/下沿是平的，只有四角是大圆角；中间比两端矮约 3mm。
 * 之前试过"两端上翘的贝塞尔"（像花生）和超椭圆（像药丸），
 * 都不对 —— 圆角矩形 + 收腰才是 AGB-001 的轮廓。
 */
function outlinePoints(inset = 0) {
  const a = HW - inset;
  const b = HE - inset;
  const r = Math.max(6, 14 - inset);
  const dip = 3.2;          // 收腰幅度
  const seg = 12;           // 每个圆角的采样段数
  const pts = [];

  // 四个圆角，顺时针：右上 → 左上 → 左下 → 右下
  const corners = [
    [a - r, b - r, 0],
    [-a + r, b - r, 90],
    [-a + r, -b + r, 180],
    [a - r, -b + r, 270],
  ];
  for (const [cx, cy, deg] of corners) {
    for (let i = 0; i <= seg; i++) {
      const t = ((deg + (i / seg) * 90) * Math.PI) / 180;
      let x = cx + Math.cos(t) * r;
      let y = cy + Math.sin(t) * r;
      // 收腰：越靠中间收得越多，两端为 0
      const k = 1 - Math.pow(Math.abs(x) / a, 2);
      y -= Math.sign(y) * dip * k;
      pts.push([x, y]);
    }
  }
  return pts;
}

function gbaOutline(inset = 0) {
  const pts = outlinePoints(inset);
  const shape = new THREE.Shape();
  shape.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
  shape.closePath();
  return shape;
}

export function createGBA({ lcdTexture } = {}) {
  const group = new THREE.Group();

  const bodyMats = [];
  const darkMats = [];
  const accentMats = [];

  // ===== 机身 =====
  const bodyMat = plastic(SHELL_COLORS.indigo.body, { roughness: 0.44 });
  const darkMat = plastic(SHELL_COLORS.indigo.dark, { roughness: 0.58 });
  const accentMat = plastic(SHELL_COLORS.indigo.accent, { roughness: 0.42 });
  bodyMats.push(bodyMat);
  darkMats.push(darkMat);
  accentMats.push(accentMat);

  const body = new THREE.Mesh(extrude(gbaOutline(0.8), BODY_D, 1.2, 28), bodyMat);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // 顶部卡带槽（开口，位于上沿中点）
  const slotHole = new THREE.Mesh(
    new THREE.BoxGeometry(60, 2.6, 9),
    new THREE.MeshStandardMaterial({ color: 0x0a0a0e, roughness: 0.95 })
  );
  slotHole.position.set(0, TOP_MID - 1.2, -1.5);
  group.add(slotHole);

  // ===== 屏幕 =====
  // 黑色屏幕面板（真机是整块深色塑料）
  const bezel = new THREE.Mesh(slab(72, 52, 2.4, 5, 0.7), darkMat);
  bezel.position.set(0, SCREEN.cy, FRONT - 0.8);   // 前表面 ≈ FRONT+0.4
  group.add(bezel);

  // 屏幕内框（再深一层，做出凹槽感）
  const window_ = new THREE.Mesh(
    new THREE.PlaneGeometry(SCREEN.w + 3.2, SCREEN.h + 3.2),
    new THREE.MeshStandardMaterial({ color: 0x08080c, roughness: 0.85 })
  );
  window_.position.set(0, SCREEN.cy, FRONT + 0.45);
  group.add(window_);

  const lcd = new THREE.Mesh(
    new THREE.PlaneGeometry(SCREEN.w, SCREEN.h),
    new THREE.MeshBasicMaterial({ map: lcdTexture, toneMapped: false })
  );
  lcd.position.set(0, SCREEN.cy, FRONT + 0.52);
  lcd.renderOrder = 2;
  group.add(lcd);

  // 屏幕玻璃反光
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(SCREEN.w, SCREEN.h),
    new THREE.MeshBasicMaterial({
      color: 0xbfd8ff, transparent: true, opacity: 0.04,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    })
  );
  glass.position.set(0, SCREEN.cy, FRONT + 0.58);
  glass.renderOrder = 3;
  group.add(glass);

  // ===== 按键 =====
  const buttons = {};
  const hitMeshes = [];
  function addPressable(name, mesh, depth) {
    mesh.userData.btn = name;
    mesh.userData.baseZ = mesh.position.z;
    mesh.userData.pressDepth = depth;
    group.add(mesh);
    buttons[name] = mesh;
    hitMeshes.push(mesh);
    return mesh;
  }

  // 十字键
  const dpadMat = plastic(SHELL_COLORS.indigo.dark, { roughness: 0.52 });
  darkMats.push(dpadMat);
  const dpadH = new THREE.Mesh(slab(27, 9.5, 4.2, 2.2), dpadMat);
  dpadH.position.set(DPAD.x, DPAD.y, FRONT + 0.9);
  const dpadV = new THREE.Mesh(slab(9.5, 27, 4.2, 2.2), dpadMat);
  dpadV.position.set(DPAD.x, DPAD.y, FRONT + 0.9);
  addPressable('dpad', dpadH, 1.1);
  addPressable('dpad', dpadV, 1.1);
  const dpadDot = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 0.6, 16), darkMat);
  dpadDot.rotation.x = Math.PI / 2;
  dpadDot.position.set(DPAD.x, DPAD.y, FRONT + 3.2);
  group.add(dpadDot);

  // A / B（A 右上、B 左下斜排）
  function roundButton(cx, cy, r, mat, name) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 4, 28), mat);
    m.rotation.x = Math.PI / 2;
    m.position.set(cx, cy, FRONT + 1.6);
    m.castShadow = true;
    return addPressable(name, m, 1.2);
  }
  roundButton(51, 7, 5.4, accentMat, 'a');
  roundButton(43, -5.5, 5.4, accentMat, 'b');

  // START / SELECT（屏幕下方，斜排）
  const startSelMat = plastic(0x4c4660, { roughness: 0.55 });
  const sel = new THREE.Mesh(slab(11, 4, 2.6, 2), startSelMat);
  sel.position.set(-7, -24, FRONT + 0.5);
  sel.rotation.z = -0.32;
  addPressable('select', sel, 0.9);

  const sta = new THREE.Mesh(slab(11, 4, 2.6, 2), startSelMat);
  sta.position.set(7, -26, FRONT + 0.5);
  sta.rotation.z = -0.32;
  addPressable('start', sta, 0.9);

  // L / R 肩键：藏在两端肩部的顶面
  function shoulder(cx, mat, name) {
    const m = new THREE.Mesh(slab(30, 5.5, 9, 2.6, 1.2), mat);
    m.position.set(cx, HE - 6.5, -7);
    m.rotation.x = -0.12;
    m.castShadow = true;
    return addPressable(name, m, 2);
  }
  const shoulderMat = plastic(SHELL_COLORS.indigo.body, { roughness: 0.5 });
  bodyMats.push(shoulderMat);
  shoulder(-53, shoulderMat, 'l');
  shoulder(53, shoulderMat, 'r');

  // 指示灯
  const ledMat = new THREE.MeshStandardMaterial({
    color: 0x3a1020, emissive: 0x000000, emissiveIntensity: 0, roughness: 0.3,
  });
  const led = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 0.8, 16), ledMat);
  led.rotation.x = Math.PI / 2;
  led.position.set(-31, SCREEN.cy + 8, FRONT + 0.2);
  group.add(led);

  // 扬声器孔：右下角 3×2
  const holeMat = new THREE.MeshStandardMaterial({ color: 0x14141a, roughness: 0.9 });
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 2; j++) {
      const h = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 0.8, 12), holeMat);
      h.rotation.x = Math.PI / 2;
      h.position.set(49 + i * 5.4, -22 - j * 5.4, FRONT + 0.2);
      group.add(h);
    }
  }

  // ===== 卡带槽锚点 =====
  const slot = {
    center: new THREE.Vector3(0, TOP_MID, -2),
    insertedPos: new THREE.Vector3(0, 18, -2),
    hoverPos: new THREE.Vector3(0, TOP_MID + 40, -2),
    spawnPos: new THREE.Vector3(0, TOP_MID + 95, -2),
  };

  // ===== 换壳 =====
  function setShellColor(key) {
    const c = SHELL_COLORS[key];
    if (!c) return false;
    bodyMats.forEach((m) => m.color.setHex(c.body));
    for (const m of darkMats) m.color.setHex(c.dark);
    accentMats.forEach((m) => m.color.setHex(c.accent));
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
      bodyTop: TOP_MID,
      dpad: DPAD,
      screen: { w: SCREEN.w, h: SCREEN.h, cy: SCREEN.cy },
    },
  };
}
