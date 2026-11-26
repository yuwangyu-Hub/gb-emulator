// GBA 三维场景：渲染器 / 灯光 / 相机 / 交互 / 展台
//
// 与 gb/src/scene/scene.js 保持同一套打光与相机手感，只是机身换成程序化 AGB。

import * as THREE from 'three';
import { OrbitControls } from '../../vendor/OrbitControls.js?v=1795666799';
import { RoomEnvironment } from '../../vendor/RoomEnvironment.js?v=1795666799';
import { createGBA } from './gbaModel.js?v=1795666799';
import { createCartridge } from './cartridgeModel.js?v=1795666799';
import { Animator } from './animator.js?v=1795666799';

export function createScene(canvasEl, lcdTexture) {
  const renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  // 机身 144.5mm 宽，比 GB 宽不少，相机要退远一点
  const camera = new THREE.PerspectiveCamera(32, 1, 1, 3000);
  camera.position.set(78, 52, 300);

  const controls = new OrbitControls(camera, canvasEl);
  controls.target.set(0, 4, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.minDistance = 150;
  controls.maxDistance = 900;
  controls.maxPolarAngle = Math.PI * 0.72;
  controls.enableZoom = true;
  controls.touches.ONE = THREE.TOUCH.ROTATE;
  controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
  controls.autoRotate = false;
  // iOS 旧版会把双指捏合当成页面缩放
  canvasEl.addEventListener('gesturestart', (e) => e.preventDefault());
  canvasEl.addEventListener('gesturechange', (e) => e.preventDefault());

  // ---------- 灯光 ----------
  const key = new THREE.DirectionalLight(0xffffff, 2.5);
  key.position.set(150, 220, 190);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -200;
  key.shadow.camera.right = 200;
  key.shadow.camera.top = 200;
  key.shadow.camera.bottom = -200;
  key.shadow.camera.far = 900;
  key.shadow.radius = 6;
  key.shadow.bias = -0.0004;
  scene.add(key);

  const fill = new THREE.DirectionalLight(0xdfe8ff, 0.75);
  fill.position.set(-170, 70, 130);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(0xffffff, 0.55);
  rim.position.set(0, 90, -220);
  scene.add(rim);

  scene.add(new THREE.AmbientLight(0xffffff, 0.36));

  // ---------- 地面（柔和阴影） ----------
  const floorY = -41;
  const shadowFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(1600, 1600),
    new THREE.ShadowMaterial({ opacity: 0.16 })
  );
  shadowFloor.rotation.x = -Math.PI / 2;
  shadowFloor.position.y = floorY;
  shadowFloor.receiveShadow = true;
  scene.add(shadowFloor);

  // ---------- 模型 ----------
  const gba = createGBA({ lcdTexture });
  scene.add(gba.group);

  const cart = createCartridge({ labelTexture: null });
  scene.add(cart.group);

  const animator = new Animator();

  // ---------- 尺寸自适应 ----------
  // 竖屏时手机右侧有竖排控制栏，机身要缩小并左移一点，别被挡住
  let framing = '';
  function resize() {
    const w = canvasEl.clientWidth || window.innerWidth;
    const h = canvasEl.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;

    const aspect = w / h;
    const next = aspect < 0.75 ? 'portrait' : aspect < 1.1 ? 'square' : 'wide';
    if (next === framing) { camera.updateProjectionMatrix(); return; }
    framing = next;

    if (next === 'portrait') {
      camera.fov = 62;
      camera.position.set(6, 30, 360);
      controls.target.set(16, 2, 0);
    } else if (next === 'square') {
      camera.fov = 46;
      camera.position.set(58, 44, 320);
      controls.target.set(0, 4, 0);
    } else {
      camera.fov = 32;
      camera.position.set(78, 52, 300);
      controls.target.set(0, 4, 0);
    }
    camera.updateProjectionMatrix();
    controls.update();
  }
  resize();
  window.addEventListener('resize', resize);

  return { renderer, scene, camera, controls, gba, cart, animator };
}
