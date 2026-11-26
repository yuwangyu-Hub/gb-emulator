#!/usr/bin/env python3
"""批量下载 Game Boy 卡带封面图（Libretro Thumbnails），压缩后生成索引。

用法:
    python3 tools/fetch_carts.py                 # 下载 "Nintendo - Game Boy"
    python3 tools/fetch_carts.py "Nintendo - Game Boy Color"
"""
import io
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

try:
    from PIL import Image
except ImportError:
    sys.exit('需要 Pillow: pip install pillow')

BASE = 'https://thumbnails.libretro.com/'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, 'assets', 'carts')
MAX_SIDE = 320
QUALITY = 80

# 归一化时丢弃的噪音词
NOISE = {
    'usa', 'europe', 'japan', 'world', 'germany', 'france', 'spain', 'italy',
    'netherlands', 'sweden', 'australia', 'brazil', 'korea', 'china', 'canada',
    'en', 'fr', 'de', 'es', 'it', 'nl', 'sv', 'da', 'no', 'fi', 'pt', 'ja', 'ca',
    'rev', 'beta', 'proto', 'prototype', 'sample', 'demo', 'kiosk',
    'gb', 'compatible', 'rumble', 'version', 'srgb', 'cgb', 'dmg',
    'the', 'a', 'of', 'and', 'in', 'to',
}


def fetch(url, timeout=60):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (cart-fetcher)'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def listing(system, kind):
    url = BASE + urllib.parse.quote(system) + '/' + kind + '/'
    html = fetch(url).decode('utf-8', 'replace')
    rows = re.findall(
        r'<a href="([^"]+)">([^<]+)</a>\s*</td><td align="right">([^<]*)</td>', html)
    out = []
    for href, name, _date in rows:
        if name.endswith('/'):
            continue
        out.append(urllib.parse.unquote(name))
    return out


def normalize(s):
    s = s.lower()
    s = re.sub(r'[^a-z0-9]+', ' ', s)
    toks = [t for t in s.split() if t and t not in NOISE]
    return ''.join(toks)


def strip_ext(name):
    return re.sub(r'\.(png|jpg|jpeg)$', '', name, flags=re.I)


def main():
    systems = sys.argv[1:] or ['Nintendo - Game Boy']
    os.makedirs(OUT_DIR, exist_ok=True)
    meta = json.load(open(os.path.join(OUT_DIR, 'index.json'))) if os.path.exists(
        os.path.join(OUT_DIR, 'index.json')) else {'items': []}
    items = meta['items']
    have = {it['src'] for it in items}
    counter = len(items)

    for system in systems:
        print(f'== 列表 {system} / Named_Boxarts ...', flush=True)
        try:
            names = listing(system, 'Named_Boxarts')
        except Exception as e:
            print('  列表失败:', e)
            continue
        print(f'  共 {len(names)} 张', flush=True)

        todo = [n for n in names if n not in have]
        print(f'  待下载 {len(todo)} 张', flush=True)

        def work(name):
            url = BASE + urllib.parse.quote(system) + '/Named_Boxarts/' + urllib.parse.quote(name)
            try:
                data = fetch(url, timeout=90)
                im = Image.open(io.BytesIO(data))
                im = im.convert('RGB')
                w, h = im.size
                im.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
                return name, im, w, h, None
            except Exception as e:
                return name, None, 0, 0, str(e)

        ok = 0
        fail = 0
        with ThreadPoolExecutor(max_workers=12) as ex:
            futs = [ex.submit(work, n) for n in todo]
            for i, fu in enumerate(as_completed(futs), 1):
                name, im, w, h, err = fu.result()
                if err:
                    fail += 1
                    if fail <= 5:
                        print('  失败:', name, err, flush=True)
                    continue
                counter += 1
                fname = f'{counter:05d}.jpg'
                im.save(os.path.join(OUT_DIR, fname), 'JPEG', quality=QUALITY, optimize=True)
                base = strip_ext(name)
                m = re.match(r'^(.*?)\s*(\((?:[^()]*)\))?\s*$', base)
                title = base.split('(')[0].strip() if '(' in base else base
                region = ''
                mm = re.findall(r'\(([^()]*)\)', base)
                if mm:
                    region = mm[-1]
                items.append({
                    'f': fname,
                    't': title or base,
                    'r': region,
                    'k': re.sub(r'[^a-z0-9]', '', base.lower()),
                    'n': normalize(title or base),
                    's': system,
                })
                have.add(name)
                ok += 1
                if i % 100 == 0:
                    print(f'  {i}/{len(todo)} (ok={ok} fail={fail})', flush=True)
                    json.dump({'items': items}, open(os.path.join(OUT_DIR, 'index.json'), 'w'),
                              ensure_ascii=False)
        print(f'  {system}: ok={ok} fail={fail}', flush=True)

    json.dump({'items': items}, open(os.path.join(OUT_DIR, 'index.json'), 'w'), ensure_ascii=False)
    total = sum(os.path.getsize(os.path.join(OUT_DIR, it['f'])) for it in items)
    print(f'完成: {len(items)} 条, 图片共 {total/1024/1024:.1f} MB -> {OUT_DIR}')


if __name__ == '__main__':
    main()
