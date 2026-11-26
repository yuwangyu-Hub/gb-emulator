// 卡带封面匹配算法自测（Node 环境）
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.dirname(new URL(import.meta.url).pathname.replace(/\/$/, '') + '/..');

globalThis.fetch = async (u) => {
  const p = path.join(process.cwd(), String(u).replace(/^\.?\//, ''));
  const buf = fs.readFileSync(p);
  return { ok: true, json: async () => JSON.parse(buf.toString('utf-8')) };
};

const mod = await import('../src/cartart.js');
await mod.loadCartArtIndex();
console.log('图库条目:', mod.cartArtCount());

const cases = [
  ['KIRBY DREAM LAND', '星之卡比 (简).gb'],
  ['TETRIS', 'Tetris (World).gb'],
  ['SUPER MARIOLAND', 'Super Mario Land (USA, Europe).gb'],
  ['SUPER MARIOLAND 2', 'Super Mario Land 2 - 6 Golden Coins (USA, Europe).gb'],
  ['POKEMON RED', 'Pokemon - Red Version (USA, Europe).gb'],
  ['POKEMON BLUE', 'Pokemon - Blue Version (USA, Europe).gb'],
  ['POKEMON YELLOW', 'Pokemon - Yellow Version - Special Pikachu Edition (USA).gb'],
  ['ZELDA', "The Legend of Zelda - Link's Awakening (USA, Europe).gb"],
  ['MARIOS PICROSS', "Mario's Picross (USA, Europe).gb"],
  ['DONKEY KONGLAND', 'Donkey Kong Land (USA, Europe).gb'],
  ['WARIO LAND', 'Wario Land - Super Mario Land 3 (USA, Europe).gb'],
  ['METROID II', 'Metroid II - Return of Samus (USA, Europe).gb'],
  ['MORTAL KOMBAT', 'Mortal Kombat (USA, Europe).gb'],
  ['F1 RACE', 'F-1 Race (Japan, USA).gb'],
  ['GOLF', 'Golf (Japan, USA).gb'],
  ['TENNIS', 'Tennis (Japan, USA, Europe).gb'],
  ['DR MARIO', 'Dr. Mario (Japan, USA).gb'],
  ['YOSHI', 'Yoshi (USA, Europe).gb'],
  ['KID ICARUS', 'Kid Icarus - Of Myths and Monsters (USA, Europe).gb'],
  ['CASTLEVANIA II', 'Castlevania II - Belmonts Revenge (USA, Europe).gb'],
  ['FINAL FANTASY', 'Final Fantasy Adventure (USA).gb'],
  ['WAVY NAVY', null],
  ['BOMBERMAN GB', 'Bomberman GB (Japan).gb'],
];

let hit = 0;
for (const [title, file] of cases) {
  const r = mod.findCartArt(title, file);
  if (r) {
    console.log(`  ✓ ${title.padEnd(22)} -> ${r.item.t} (${r.item.r})  score=${r.score.toFixed(3)} ${r.exact ? '精确' : '模糊'} by=${r.matchedBy}`);
  } else {
    console.log(`  ✗ ${title.padEnd(22)} -> 未匹配`);
  }
}
for (const [title, file] of cases) if (mod.findCartArt(title, file)) hit++;
console.log(`命中 ${hit}/${cases.length}`);
