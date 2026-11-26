// Game Boy Advance（AGB-001）程序化 3D 机身
//
// 没有现成的 AGB GLB 模型，这里用 three.js 几何体按真机尺寸搭：
// 144.5 × 82 × 24.5 mm，屏幕 61.2 × 40.8 mm（240×160 像素，3:2）。
// 坐标单位 = 毫米，机身中心在原点，正面朝 +z。
//
// 结构：机身（圆角挤出板）→ 屏幕凹槽 → LCD 贴图 → 十字键 / A / B /
// START / SELECT / L / R → 指示灯 → 扬声器孔 → 顶部卡带槽。

import * as THREE from 'three';
import { slab, plastic } from './geom.js?v=1795668139';

// 真机尺寸
const BODY = { w: 144.5, h: 82, d: 22, r: 13 };
const FRONT = BODY.d / 2;   // 正面 z
const SCREEN = { w: 61.2, h: 40.8, cy: 4 };

export const SHELL_COLORS = {
  indigo: { name: '靛紫（原色）', body: 0x5b4d8e, dark: 0x2f2b45, accent: 0x8e3a52 },
  glacier: { name: '冰川蓝', body: 0x86aed0, dark: 0x35506a, accent: 0x8e3a52 },
  black: { name: '午夜黑', body: 0x2b2c33, dark: 0x17181d, accent: 0x9c3a4d },
  white: { name: '雪白', body: 0xd6d3c8, dark: 0x4a4c52, accent: 0xc2357a },
  orange: { name: '珊瑚橙', body: 0xd07a4e, dark: 0x6b3320, accent: 0xf0e6d2 },
};

// ---------- 主构建 ----------

export function createGBA({ lcdTexture } = {}) {
  const group = new THREE.Group();

  // 材质集合（换壳时统一改色）
  const bodyMats = [];
  const darkMats = [];
  const accentMats = [];

  // ===== 机身 =====
  const bodyMat = plastic(SHELL_COLORS.indigo.body, { roughness: 0.46 });
  const darkMat = plastic(SHELL_COLORS.indigo.dark, { roughness: 0.6 });
  const accentMat = plastic(SHELL_COLORS.indigo.accent, { roughness: 0.4 });
  bodyMats.push(bodyMat);
  darkMats.push(darkMat);
  accentMats.push(accentMat);

  const body = new THREE.Mesh(slab(BODY.w, BODY.h, BODY.d, BODY.r, 3.2), bodyMat);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // 顶部卡带槽（开口）
  const slotHole = new THREE.Mesh(
    new THREE.BoxGeometry(62, 2.4, 9),
    new THREE.MeshStandardMaterial({ color: 0x0a0a0e, roughness: 0.95 })
  );
  slotHole.position.set(0, BODY.h / 2 - 0.6, -1);
  group.add(slotHole);

  // ===== 屏幕 =====
  const bezel = new THREE.Mesh(slab(72, 50, 2.2, 4, 0.6), darkMat);
  bezel.position.set(0, SCREEN.cy, FRONT - 0.4);
  group.add(bezel);

  const lcd = new THREE.Mesh(
    new THREE.PlaneGeometry(SCREEN.w, SCREEN.h),
    new THREE.MeshBasicMaterial({ map: lcdTexture, toneMapped: false })
  );
  lcd.position.set(0, SCREEN.cy, FRONT + 0.75);
  lcd.renderOrder = 2;
  group.add(lcd);

  // 屏幕反光：只在 LCD 上盖一层极淡的斜向高光，模拟玻璃面板
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(SCREEN.w, SCREEN.h),
    new THREE.MeshBasicMaterial({
      color: 0xbfd8ff, transparent: true, opacity: 0.04,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    })
  );
  glass.position.set(0, SCREEN.cy, FRONT + 0.9);
  glass.renderOrder = 3;
  group.add(glass);

  // 屏幕下方的小铭牌
  const badge = new THREE.Mesh(slab(34, 2.2, 0.6, 1, 0.2), darkMat);
  badge.position.set(0, SCREEN.cy - 30.5, FRONT);
  group.add(badge);

  // ===== 按键 =====
  const buttons = {};        // name → mesh（同名按键取最后一个，供查表）
  const hitMeshes = [];      // 所有可点按键（同名按键会有多个，射线检测用这个）

  function addPressable(name, mesh, depth) {
    mesh.userData.btn = name;
    mesh.userData.baseZ = mesh.position.z;
    mesh.userData.pressDepth = depth;
    group.add(mesh);
    buttons[name] = mesh;
    hitMeshes.push(mesh);
    return mesh;
  }

  // 十字键：两条圆角板交叉
  const dpadMat = plastic(SHELL_COLORS.indigo.dark, { roughness: 0.55 });
  darkMats.push(dpadMat);
  const DPAD = { x: -47, y: 2 };
  const dpadH = new THREE.Mesh(slab(27, 9.5, 4.2, 2.2), dpadMat);
  dpadH.position.set(DPAD.x, DPAD.y, FRONT + 0.9);
  const dpadV = new THREE.Mesh(slab(9.5, 27, 4.2, 2.2), dpadMat);
  dpadV.position.set(DPAD.x, DPAD.y, FRONT + 0.9);
  addPressable('dpad', dpadH, 1.1);
  addPressable('dpad', dpadV, 1.1);
  // 十字键中心的小凹点
  const dpadDot = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.6, 16), darkMat);
  dpadDot.rotation.x = Math.PI / 2;
  dpadDot.position.set(DPAD.x, DPAD.y, FRONT + 3.2);
  group.add(dpadDot);

  // A / B：右上 / 左下斜排
  function roundButton(cx, cy, r, mat, name) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 3.8, 28), mat);
    m.rotation.x = Math.PI / 2;
    m.position.set(cx, cy, FRONT + 1.5);
    m.castShadow = true;
    return addPressable(name, m, 1.2);
  }
  roundButton(49, 6.5, 5.6, accentMat, 'a');
  roundButton(37.5, -6.5, 5.6, accentMat, 'b');

  // START / SELECT：屏幕下方，略倾斜
  const startSelMat = plastic(0x4c4660, { roughness: 0.55 });
  darkMats.push(startSelMat);
  const sel = new THREE.Mesh(slab(12, 4.4, 2.6, 2.2), startSelMat);
  sel.position.set(-11, -31, FRONT + 0.5);
  sel.rotation.z = -0.32;
  addPressable('select', sel, 0.9);

  const sta = new THREE.Mesh(slab(12, 4.4, 2.6, 2.2), startSelMat);
  sta.position.set(3, -31, FRONT + 0.5);
  sta.rotation.z = -0.32;
  addPressable('start', sta, 0.9);

  // L / R 肩键：从顶部两端露出
  function shoulder(cx, mat, name) {
    const m = new THREE.Mesh(slab(30, 6, 9, 3, 1.4), mat);
    m.position.set(cx, BODY.h / 2 - 1.6, -6);
    m.rotation.x = -0.2;
    m.castShadow = true;
    return addPressable(name, m, 2.2);
  }
  shoulder(-50, plastic(SHELL_COLORS.indigo.dark, { roughness: 0.55 }), 'l');
  const rBtn = shoulder(50, plastic(SHELL_COLORS.indigo.dark, { roughness: 0.55 }), 'r');
  darkMats.push(rBtn.material);

  // 指示灯
  const ledMat = new THREE.MeshStandardMaterial({
    color: 0x3a1020, emissive: 0x000000, emissiveIntensity: 0, roughness: 0.3,
  });
  const led = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 0.8, 16), ledMat);
  led.rotation.x = Math.PI / 2;
  led.position.set(-40, 26.5, FRONT + 0.3);
  group.add(led);

  // 扬声器孔：右下角 3×2 排列
  const holeMat = new THREE.MeshStandardMaterial({ color: 0x14141a, roughness: 0.9 });
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 2; j++) {
      const h = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.8, 12), holeMat);
      h.rotation.x = Math.PI / 2;
      h.position.set(48 + i * 6, -26 - j * 6, FRONT + 0.2);
      group.add(h);
    }
  }

  // ===== 卡带槽锚点（插入动画用） =====
  const slot = {
    center: new THREE.Vector3(0, BODY.h / 2, -2),
    // 插入到位时卡带中心的位置（卡带主体沉进机身里）
    insertedPos: new THREE.Vector3(0, 22, -2),
    hoverPos: new THREE.Vector3(0, 78, -2),
    spawnPos: new THREE.Vector3(0, 132, -2),
  };

  // ===== 换壳 =====
  function setShellColor(key) {
    const c = SHELL_COLORS[key];
    if (!c) return false;
    bodyMats.forEach((m) => m.color.setHex(c.body));
    for (const m of darkMats) m.color.setHex(c.dark);
    // A/B 键在深色外壳上要亮一点才看得清
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
      bodyTop: BODY.h / 2,
      screen: { w: SCREEN.w, h: SCREEN.h, cy: SCREEN.cy },
    },
  };
}
