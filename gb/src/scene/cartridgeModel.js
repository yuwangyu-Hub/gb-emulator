// 程序化建模 Game Boy 卡带

import * as THREE from 'three';

function roundedRectShape(w, h, r) {
  const s = new THREE.Shape();
  const x0 = -w / 2, x1 = w / 2, y0 = -h / 2, y1 = h / 2;
  s.moveTo(x0 + r, y1);
  s.lineTo(x1 - r, y1);
  s.quadraticCurveTo(x1, y1, x1, y1 - r);
  s.lineTo(x1, y0 + r);
  s.quadraticCurveTo(x1, y0, x1 - r, y0);
  s.lineTo(x0 + r, y0);
  s.quadraticCurveTo(x0, y0, x0, y0 + r);
  s.lineTo(x0, y1 - r);
  s.quadraticCurveTo(x0, y1, x0 + r, y1);
  return s;
}

function extrude(shape, depth, bevel, mat) {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: depth - bevel * 2,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: 14,
  });
  geo.center();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// 尺寸：57 宽 x 65 高 x 8.5 厚
export const CART_W = 57, CART_H = 65, CART_D = 8.5;

// 真机 DMG：卡带从机身**顶部**垂直插入，插到底后尾部露出约 5mm 便于拔出，
// 插入深度 therefore ≈ 60mm；且卡带标签面朝**背面**（-z，与屏幕相反方向）。
const EXPOSE = 5;   // 尾部露出机身顶面的高度 mm

export function createCartridge({ labelTexture, slot = null, bodyTop = 74 }) {
  const group = new THREE.Group();

  // 内部再包一层并绕 Y 转 180°：让标签朝 -z（机身背面），与真机一致。
  // 放内层是为了外层 group 的 rotation 可以自由做飞入动画而不被覆盖。
  const inner = new THREE.Group();
  inner.rotation.y = Math.PI;
  group.add(inner);

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xcfccc4, roughness: 0.5, metalness: 0.03 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x2c2c30, roughness: 0.6 });
  const connectorMat = new THREE.MeshStandardMaterial({ color: 0x3a4a3a, roughness: 0.5, metalness: 0.3 });

  const body = extrude(roundedRectShape(CART_W, CART_H, 3), CART_D, 0.7, bodyMat);
  inner.add(body);

  // 标签
  const label = new THREE.Mesh(
    new THREE.PlaneGeometry(CART_W - 11, 40),
    new THREE.MeshStandardMaterial({ map: labelTexture, roughness: 0.55 })
  );
  label.position.set(0, 2, CART_D / 2 + 0.05);
  inner.add(label);

  // 顶部防滑纹
  const ridgeGeo = new THREE.BoxGeometry(CART_W - 10, 0.9, 0.5);
  for (let i = 0; i < 3; i++) {
    const ridge = new THREE.Mesh(ridgeGeo, bodyMat);
    ridge.position.set(0, 26.5 + i * 2.2, 0);
    inner.add(ridge);
  }

  // 底部金手指
  const connector = new THREE.Mesh(new THREE.BoxGeometry(40, 4.5, CART_D - 3.5), connectorMat);
  connector.position.set(0, -CART_H / 2 + 1.6, 0);
  inner.add(connector);

  // 顶部三角标识（真机样式：在标签面顶部，箭头尖朝下指向插入方向，不超出卡带轮廓）
  const arrowShape = new THREE.Shape();
  arrowShape.moveTo(-2.5, 0);    // 底边（朝卡带顶端）
  arrowShape.lineTo(2.5, 0);
  arrowShape.lineTo(0, -3.5);    // 尖朝下（指向金手指 / 插入方向）
  arrowShape.closePath();
  const arrow = new THREE.Mesh(
    new THREE.ShapeGeometry(arrowShape),
    new THREE.MeshStandardMaterial({ color: 0x8f8b83, roughness: 0.6 })
  );
  arrow.position.set(0, CART_H / 2 - 1.5, CART_D / 2 + 0.06);
  inner.add(arrow);

  group.visible = false;

  // ---------- 位置：从模型自带卡带的槽位反推，而不是硬编码 ----------
  const slotZ = slot ? slot.center.z : -10;   // 插槽在厚度方向偏后（真机卡槽贴着背面）
  let insY = bodyTop + EXPOSE - CART_H / 2;   // 尾部露出机身顶面 EXPOSE
  if (slot) insY = Math.max(insY, slot.min.y + CART_H / 2); // 但不得浅于卡槽底
  const insertedPos = new THREE.Vector3(0, insY, slotZ);
  const hoverPos = new THREE.Vector3(0, insY + 52, slotZ);  // 槽口正上方悬停
  const spawnPos = new THREE.Vector3(0, bodyTop + 115, slotZ); // 从正上方飞入

  return {
    group,
    label,
    insertedPos,
    hoverPos,
    spawnPos,
  };
}

// 换卡带时更新标签贴图
export function updateCartridgeLabel(cart, labelTexture) {
  cart.label.material.map = labelTexture;
  cart.label.material.needsUpdate = true;
}
