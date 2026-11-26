// GBA 卡带（57.5 × 35 × 5 mm，正面贴标签）
//
// 插入动作用两个位置：spawnPos（画面上方飞入起点）→ hoverPos（槽口上方）
// → insertedPos（沉进机身），到位后由 main.js 隐藏。

import * as THREE from 'three';
import { slab, plastic } from './geom.js?v=1795668937';

export function createCartridge({ labelTexture = null } = {}) {
  const group = new THREE.Group();

  const shellMat = plastic(0x8d8d9c, { roughness: 0.62, metalness: 0.02 });
  const shell = new THREE.Mesh(slab(57.5, 35, 5, 3, 0.9), shellMat);
  shell.castShadow = true;
  group.add(shell);

  // 顶部防呆缺口（两侧的斜角用两块深色小板示意）
  const notchMat = plastic(0x3a3a46, { roughness: 0.7 });
  for (const sx of [-1, 1]) {
    const n = new THREE.Mesh(slab(6, 3, 4.4, 1), notchMat);
    n.position.set(sx * 25.5, 16.2, 0);
    group.add(n);
  }

  // 金手指（底部一排竖条）
  const pinMat = new THREE.MeshStandardMaterial({
    color: 0xc9a24a, roughness: 0.35, metalness: 0.75,
  });
  for (let i = 0; i < 11; i++) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(3.2, 5.5, 0.6), pinMat);
    p.position.set(-25 + i * 5, -16.5, 1.6);
    group.add(p);
  }

  // 标签（可由 ROM 信息生成）
  const labelMat = new THREE.MeshBasicMaterial({
    map: labelTexture || null,
    color: labelTexture ? 0xffffff : 0x6d6d80,
    toneMapped: false,
  });
  const label = new THREE.Mesh(new THREE.PlaneGeometry(46, 23), labelMat);
  label.position.set(0, 1.5, 2.62);
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
