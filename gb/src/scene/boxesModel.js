// 包装盒装饰：从旧模型 gb-dmg-v1-backup.glb 提取 Nintendo 主机大盒网格
// （Cube_1_3；Cube_1_2 是 Tetris 小盒——会与抽屉柜穿插，已移除；Cube_1 是插在机身里的卡带，不用）
//
// 场景坐标约定与 gameboyModel.js 一致：机身 88.5×148×33，中心在原点，y∈[-74,74]。

import * as THREE from 'three';
import { GLTFLoader } from '../../vendor/GLTFLoader.js?v=1795665441';
import { loadGLBWithProgress } from './modelLoader.js?v=1795665441';

export async function createBoxes({ onProgress } = {}) {
  const group = new THREE.Group();
  let gltf;
  try {
    gltf = await loadGLBWithProgress(new GLTFLoader(), 'models/gb-dmg-v1-backup.glb', onProgress);
  } catch (e) {
    console.warn('[boxes] 旧模型加载失败，跳过包装盒', e);
    return { group };
  }

  gltf.scene.updateMatrixWorld(true);
  const meshes = [];
  gltf.scene.traverse((o) => {
    // 只保留 Nintendo 大盒（Cube_1_3），Tetris 小盒（Cube_1_2）与抽屉柜穿插，不取
    if (o.isMesh && /^Cube_1_3_Cube/i.test(o.name || '')) meshes.push(o);
  });
  if (!meshes.length) return { group };

  meshes.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  // 摆放布局：机身右侧，略微朝向镜头，落地（y=-74）
  const FLOOR = -74;
  const layout = [
    { x: 172, z: -26, rotY: -0.45, targetMax: 195 }, // Cube_1_3 大盒 → 右侧
  ];

  meshes.forEach((src, i) => {
    const cfg = layout[i % layout.length];
    const holder = new THREE.Group();
    const m = src.clone();

    // 烘焙原世界变换（matrixAutoUpdate=false 后 matrix 不被覆盖），
    // holder 无变换时 mesh 保持原模型里的姿态 → 贴图盒子的形状/UV 不乱
    m.matrixAutoUpdate = false;
    m.matrix.copy(src.matrixWorld);
    m.castShadow = true;
    m.receiveShadow = true;

    // 纸盒材质修正：glTF 默认 metalness=1 会渲染成黑色
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    mats.forEach((mat) => {
      if (mat.metalness !== undefined) mat.metalness = 0;
      if (mat.roughness !== undefined) mat.roughness = 0.8;
      if (mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
    });

    holder.add(m);
    group.add(holder);

    // 1) 等比缩放到目标最大边
    holder.updateMatrixWorld(true);
    let bb = new THREE.Box3().setFromObject(holder);
    const size = new THREE.Vector3(); bb.getSize(size);
    holder.scale.setScalar(cfg.targetMax / Math.max(size.x, size.y, size.z));

    // 2) 转向
    holder.rotation.y = cfg.rotY;

    // 3) 测中心后平移：目标点 = (cfg.x, 落地, cfg.z)
    holder.updateMatrixWorld(true);
    bb = new THREE.Box3().setFromObject(holder);
    const h = new THREE.Vector3(); bb.getSize(h);
    const c = new THREE.Vector3(); bb.getCenter(c);
    holder.position.x += cfg.x - c.x;
    holder.position.y += FLOOR + h.y / 2 - c.y;
    holder.position.z += cfg.z - c.z;
  });

  return { group };
}
