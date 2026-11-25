// 卡带封面识别：用 ROM 标题 / 文件名去匹配 Libretro 卡带图库

const NOISE = new Set([
  'usa', 'europe', 'japan', 'world', 'germany', 'france', 'spain', 'italy',
  'netherlands', 'sweden', 'australia', 'brazil', 'korea', 'china', 'canada',
  'en', 'fr', 'de', 'es', 'it', 'nl', 'sv', 'da', 'no', 'fi', 'pt', 'ja', 'ca',
  'rev', 'beta', 'proto', 'prototype', 'sample', 'demo', 'kiosk',
  'gb', 'compatible', 'rumble', 'version', 'srgb', 'cgb', 'dmg',
  'the', 'a', 'of', 'and', 'in', 'to',
]);

// 与 tools/fetch_carts.py 的 normalize() 保持一致
export function normalize(s) {
  const toks = String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t && !NOISE.has(t));
  return toks.join('');
}

export function tokens(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t && !NOISE.has(t));
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array(b.length + 1);
  let cur = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

function charSim(a, b) {
  if (!a.length || !b.length) return 0;
  const d = levenshtein(a, b);
  return 1 - d / Math.max(a.length, b.length);
}

function tokenDice(a, b) {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let common = 0;
  for (const t of A) if (B.has(t)) common++;
  return (2 * common) / (A.size + B.size);
}

// 地区优先级（并列时优先选）
function regionBonus(r) {
  const s = String(r || '').toLowerCase();
  if (s.includes('usa') || s.includes('world')) return 0.03;
  if (s.includes('europe')) return 0.02;
  if (s.includes('japan')) return 0.01;
  return 0;
}

const state = {
  loading: null,
  items: [],
  byK: new Map(),
  byN: new Map(),
  ready: false,
};

export function loadCartArtIndex() {
  if (state.ready || state.loading) return state.loading || Promise.resolve(true);
  state.loading = fetch('assets/carts/index.json', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : { items: [] }))
    .then((json) => {
      state.items = json.items || [];
      for (const it of state.items) {
        if (!state.byK.has(it.k)) state.byK.set(it.k, []);
        state.byK.get(it.k).push(it);
        if (!state.byN.has(it.n)) state.byN.set(it.n, []);
        state.byN.get(it.n).push(it);
      }
      state.ready = true;
      return true;
    })
    .catch(() => {
      state.ready = true; // 图库缺失时降级到程序化标签
      return false;
    });
  return state.loading;
}

export function cartArtCount() {
  return state.items.length;
}

function pick(cands) {
  if (!cands || !cands.length) return null;
  return cands.slice().sort((a, b) => regionBonus(b.r) - regionBonus(a.r))[0];
}

/**
 * 查找卡带封面。
 * @param {string} romTitle ROM 内部标题（如 "KIRBY DREAM LAND"）
 * @param {string} fileName 上传的文件名（可选，优先级更高）
 * @returns {{item:object, score:number, exact:boolean}|null}
 */
export function findCartArt(romTitle, fileName) {
  if (!state.items.length) return null;
  const queries = [];
  if (fileName) queries.push({ raw: fileName.replace(/\.[^.]+$/, ''), prio: 1 });
  if (romTitle) queries.push({ raw: romTitle, prio: 0 });

  for (const { raw, prio } of queries) {
    const q = normalize(raw);
    if (!q) continue;
    // 1) 全名精确（含地区）
    const hitK = pick(state.byK.get(q));
    if (hitK) return { item: hitK, score: 1, exact: true, matchedBy: prio ? 'file' : 'title' };
    // 2) 标题精确
    const hitN = pick(state.byN.get(q));
    if (hitN) return { item: hitN, score: 0.99, exact: true, matchedBy: prio ? 'file' : 'title' };
  }

  // 3) 模糊匹配
  let best = null;
  for (const { raw, prio } of queries) {
    const q = normalize(raw);
    if (!q) continue;
    const qFull = String(raw).toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const it of state.items) {
      const td = tokenDice(raw, it.t);
      let s;
      if (td > 0) {
        // 至少共享一个实义词才认为相关
        s = Math.max(charSim(q, it.n), charSim(qFull, it.k), td);
      } else if (q.length >= 4 && it.n.includes(q)) {
        // 单标题是候选的子串（如 ROM 标题 "ZELDA" → "Legend of Zelda..."）
        s = 0.72;
      } else {
        continue;
      }
      const total = s + regionBonus(it.r) + (prio ? 0.005 : 0);
      if (!best || total > best.score) best = { item: it, score: total, exact: false, matchedBy: prio ? 'file' : 'title' };
    }
    if (best && best.score >= 0.9) break;
  }
  if (best && best.score >= 0.7) return best;
  return null;
}

const imgCache = new Map();

export function loadCartArtImage(item) {
  const url = `assets/carts/${item.f}`;
  if (imgCache.has(url)) return imgCache.get(url);
  const p = new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('load fail ' + url));
    img.src = url;
  });
  imgCache.set(url, p);
  return p;
}

export function cartArtUrl(item) {
  return `assets/carts/${item.f}`;
}
