// ROM 收藏：多份卡带存 IndexedDB（键 'roms'），供 3D 抽屉展示与选择插入。
// 条目结构: { id, name, data(Uint8Array), ts, demo? }
// id = `${title}::${globalChecksum}::${size}` —— 同一游戏重复上传会被视为同一张卡带。

import { parseROMHeader } from './emulator/gameboy.js?v=1795680034';

const KEY = 'roms';
const DEMO_ID = 'DEMO::KIRBY';

function idb() {
  return new Promise((res, rej) => {
    const req = indexedDB.open('gbsim', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
async function idbPut(key, val) {
  const db = await idb();
  await new Promise((res, rej) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(val, key);
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
  });
}
async function idbGet(key) {
  try {
    const db = await idb();
    return await new Promise((res, rej) => {
      const tx = db.transaction('kv', 'readonly');
      const r = tx.objectStore('kv').get(key);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  } catch (e) { return undefined; }
}

export function romId(info, size) {
  return `${info.title || 'UNKNOWN'}::${info.globalChecksum}::${size}`;
}

// 读取收藏（按加入时间排序，试玩卡带在最前）
export async function listROMs() {
  const arr = (await idbGet(KEY)) || [];
  return arr.slice().sort((a, b) => (a.demo === b.demo ? a.ts - b.ts : a.demo ? -1 : 1));
}

async function saveAll(list) {
  await idbPut(KEY, list);
}

// 加入收藏；若已存在返回已存在的条目并标记 dup=true
export async function addROM(name, bytes, opts = {}) {
  const info = parseROMHeader(bytes);
  const id = opts.id || romId(info, bytes.length);
  const list = await listROMs();
  const existing = list.find((r) => r.id === id);
  if (existing) return { entry: existing, dup: true, info };
  const entry = { id, name, data: bytes, ts: Date.now(), demo: !!opts.demo };
  list.push(entry);
  await saveAll(list);
  return { entry, dup: false, info };
}

// 移除（试玩卡带不允许删）
export async function removeROM(id) {
  const list = (await listROMs()).filter((r) => r.id !== id || r.demo);
  await saveAll(list);
}

// 确保试玩卡带（Kirby）在收藏里；收藏为空时自动添加。返回该条目（可能为 null）
export async function ensureDemoROM() {
  const list = await listROMs();
  let demo = list.find((r) => r.id === DEMO_ID);
  if (demo) return demo;
  try {
    const res = await fetch('roms/kirby.gb');
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const { entry } = await addROM('星之卡比 (试玩).gb', bytes, { id: DEMO_ID, demo: true });
    return entry;
  } catch (e) {
    return null;
  }
}
