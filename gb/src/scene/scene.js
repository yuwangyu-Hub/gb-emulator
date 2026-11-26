// 三维场景：渲染器 / 灯光 / 相机 / 交互

import * as THREE from 'three';
import { OrbitControls } from '../../vendor/OrbitControls.js?v=1795665441';
import { RoomEnvironment } from '../../vendor/RoomEnvironment.js?v=1795665441';
import { createGameBoy } from './gameboyModel.js?v=1795665441';
import { createCartridge } from './cartridgeModel.js?v=1795665441';
import { createBoxes } from './boxesModel.js?v=1795665441';
import { createDrawer } from './drawerModel.js?v=1795665441';
import { Animator } from './animator.js?v=1795665441';

export async function createScene(canvasEl, lcdTexture, opts = {}) {
  // 模型加载进度：机身占大头（0~85%），包装盒（85~100%）
  const report = opts.onProgress || null;
  const stage = (from, to) => (loaded, total) => {
    if (!report) return;
    const ratio = total > 0 ? Math.min(1, loaded / total) : 0;
    report(from + (to - from) * ratio);
  };

  const renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(32, 1, 1, 2000);
  camera.position.set(95, 55, 330);

  const controls = new OrbitControls(camera, canvasEl);
  controls.target.set(0, 14, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.minDistance = 150;
  controls.maxDistance = 1200;
  controls.maxPolarAngle = Math.PI * 0.72;
  // 触摸手势显式声明：单指旋转、双指捏合缩放 + 平移
  controls.enableZoom = true;
  controls.touches.ONE = THREE.TOUCH.ROTATE;
  controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
  // iOS Safari 旧版会把双指捏合当成页面缩放，拦截 gesture 事件防止被浏览器接管
  canvasEl.addEventListener('gesturestart', (e) => e.preventDefault());
  canvasEl.addEventListener('gesturechange', (e) => e.preventDefault());
  // 默认不自动旋转：只在用户手动拖拽时才转动
  controls.autoRotate = false;

  // 灯光
  const key = new THREE.DirectionalLight(0xffffff, 2.6);
  key.position.set(140, 220, 180);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -180;
  key.shadow.camera.right = 180;
  key.shadow.camera.top = 180;
  key.shadow.camera.bottom = -180;
  key.shadow.camera.far = 800;
  key.shadow.radius = 6;
  key.shadow.bias = -0.0004;
  scene.add(key);

  const fill = new THREE.DirectionalLight(0xdfe8ff, 0.7);
  fill.position.set(-160, 60, 120);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(0xffffff, 0.5);
  rim.position.set(0, 80, -200);
  scene.add(rim);

  scene.add(new THREE.AmbientLight(0xffffff, 0.35));

  // 地面（柔和阴影）
  const floorY = -74;
  const shadowFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(1200, 1200),
    new THREE.ShadowMaterial({ opacity: 0.16 })
  );
  shadowFloor.rotation.x = -Math.PI / 2;
  shadowFloor.position.y = floorY;
  shadowFloor.receiveShadow = true;
  scene.add(shadowFloor);

  // ---------- 模型 ----------
  const gb = await createGameBoy({ lcdTexture, onProgress: stage(0, 0.85) });
  scene.add(gb.group);

  const cart = createCartridge({
    labelTexture: null,
    slot: gb.parts.slot,
    bodyTop: gb.parts.bodyTop,
  });
  scene.add(cart.group);

  // 两个 Game Boy 包装盒（从旧模型提取），摆在机身两侧落地
  const boxes = await createBoxes({ onProgress: stage(0.85, 1) });
  scene.add(boxes.group);

  // 卡带抽屉柜（机身左前方，可拉出展示卡带收藏）
  const drawer = createDrawer();
  scene.add(drawer.group);

  const animator = new Animator();

  // ---------- 尺寸自适应 ----------
  function resize() {
    const w = canvasEl.clientWidth || window.innerWidth;
    const h = canvasEl.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- 交互：只在用户手动拖拽时转动（不做闲置后自动旋转） ----------
  controls.addEventListener('start', () => { controls.autoRotate = false; });

  return { renderer, scene, camera, controls, gb, cart, animator, floorY, drawer };
}
