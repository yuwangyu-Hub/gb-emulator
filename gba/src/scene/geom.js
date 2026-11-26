// 程序化建模共用几何工具：圆角板 / 圆角矩形路径 / 塑料材质

import * as THREE from 'three';

/** 圆角矩形路径（XY 平面） */
export function roundedRectShape(w, h, r) {
  const x = -w / 2, y = -h / 2;
  const rad = Math.min(r, Math.min(w, h) / 2);
  const s = new THREE.Shape();
  s.moveTo(x + rad, y);
  s.lineTo(x + w - rad, y);
  s.quadraticCurveTo(x + w, y, x + w, y + rad);
  s.lineTo(x + w, y + h - rad);
  s.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  s.lineTo(x + rad, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - rad);
  s.lineTo(x, y + rad);
  s.quadraticCurveTo(x, y, x + rad, y);
  return s;
}

/** 圆角「板」：厚度沿 z 方向，正面平整、边缘倒角 */
export function slab(w, h, thick, radius, bevel = 1.1) {
  const bt = Math.min(bevel, thick / 2 - 0.05);
  const depth = Math.max(0.1, thick - bt * 2);
  const geo = new THREE.ExtrudeGeometry(roundedRectShape(w, h, radius), {
    depth,
    bevelEnabled: true,
    bevelThickness: bt,
    bevelSize: bt,
    bevelSegments: 3,
    curveSegments: 14,
  });
  // ExtrudeGeometry 从 z=0 挤出到 z=depth，两端再加 bevelThickness，
  // 平移让整体以 z=0 为中心
  geo.translate(0, 0, -depth / 2);
  geo.computeVertexNormals();
  return geo;
}

/** 塑料质感（机身、按键统一用这套参数） */
export function plastic(color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: opts.roughness ?? 0.52,
    metalness: opts.metalness ?? 0.06,
    ...(opts.extra || {}),
  });
}

/**
 * 把任意二维轮廓挤出成带倒角的板（正面平整）
 * 与 slab() 的区别：外形由调用方给的 Shape 决定，不再局限于圆角矩形。
 */
export function extrude(shape, thick, bevel = 1.2, curveSegments = 24) {
  const bt = Math.min(bevel, thick / 2 - 0.05);
  const depth = Math.max(0.1, thick - bt * 2);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: bt,
    bevelSize: bt,
    bevelSegments: 3,
    curveSegments,
  });
  geo.translate(0, 0, -depth / 2);
  geo.computeVertexNormals();
  return geo;
}
