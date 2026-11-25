// 校验模块导入路径与导出符号是否匹配（无需浏览器的静态检查）
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const files = [
  'src/main.js',
  'src/audio.js',
  'src/scene/scene.js',
  'src/scene/gameboyModel.js',
  'src/scene/cartridgeModel.js',
  'src/scene/textures.js',
  'src/scene/animator.js',
  'src/emulator/gameboy.js',
  'src/emulator/cpu.js',
  'src/emulator/ppu.js',
  'src/emulator/mmu.js',
  'src/emulator/apu.js',
  'src/emulator/timer.js',
  'src/emulator/joypad.js',
  'src/emulator/cartridge.js',
];

const cache = new Map();
function read(f) {
  if (!cache.has(f)) cache.set(f, fs.readFileSync(path.join(root, f), 'utf8'));
  return cache.get(f);
}

let problems = 0;
for (const file of files) {
  const src = read(file);
  const re = /import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src))) {
    const clause = m[1];
    const spec = m[2];
    if (!spec.startsWith('.')) continue; // 仅检查本地模块
    const clean = spec.split('?')[0];
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), clean));
    if (!fs.existsSync(path.join(root, target))) {
      console.log(`✗ ${file}: 找不到模块 ${spec} -> ${target}`);
      problems++;
      continue;
    }
    // 解析具名导入
    const named = clause.match(/\{([\s\S]*?)\}/);
    if (named) {
      const names = named[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
      const tsrc = read(target);
      for (const n of names) {
        const patterns = [
          new RegExp(`export\\s+class\\s+${n}\\b`),
          new RegExp(`export\\s+function\\s+${n}\\b`),
          new RegExp(`export\\s+const\\s+${n}\\b`),
          new RegExp(`export\\s+let\\s+${n}\\b`),
          new RegExp(`export\\s*\\{[^}]*\\b${n}\\b`),
          new RegExp(`export\\s+async\\s+function\\s+${n}\\b`),
        ];
        if (!patterns.some((p) => p.test(tsrc))) {
          console.log(`✗ ${file}: ${target} 未导出 ${n}`);
          problems++;
        }
      }
    }
  }
}

// 检查 index.html 引用的资源
const html = read('index.html');
const refs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((x) => x[1])
  .filter((u) => !u.startsWith('http') && !u.startsWith('data:') && !u.startsWith('#'));
for (const r of refs) {
  const clean = r.split('?')[0];
  if (!fs.existsSync(path.join(root, clean))) {
    console.log(`✗ index.html: 缺失资源 ${r}`);
    problems++;
  }
}

console.log(problems === 0 ? '✓ 所有模块导入与资源引用均正确' : `发现 ${problems} 个问题`);
