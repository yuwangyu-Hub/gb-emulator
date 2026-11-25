#!/usr/bin/env python3
"""部署前版本号递增：把 index.html 和 src/**/*.js 里的 ?v=<数字> 统一替换为当前时间戳。

背景：本地 serve.py 会按文件 mtime 重写版本号，但线上是静态托管，
URL 不变浏览器就命中旧缓存（新旧 HTML/JS/CSS 混合 → 各种诡异 bug）。
每次重新部署前运行本脚本，让所有资源 URL 变化，强制客户端全量拉新。

用法: python3 tools/bump_version.py
"""
import os
import re
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VERSION = str(int(time.time()))
RE_VER = re.compile(r'\?v=\d+')

def bump(path):
    with open(path, encoding='utf-8') as f:
        src = f.read()
    out, n = RE_VER.subn('?v=' + VERSION, src)
    if n:
        with open(path, 'w', encoding='utf-8') as f:
            f.write(out)
    return n

def main():
    total_files = 0
    total_refs = 0
    targets = [os.path.join(ROOT, 'index.html')]
    src_dir = os.path.join(ROOT, 'src')
    for dirpath, _, files in os.walk(src_dir):
        for name in files:
            if name.endswith('.js'):
                targets.append(os.path.join(dirpath, name))
    for path in targets:
        n = bump(path)
        if n:
            total_files += 1
            total_refs += n
            print('  %s: %d 处' % (os.path.relpath(path, ROOT), n))
    print('版本号已更新为 ?v=%s （%d 个文件，%d 处引用）' % (VERSION, total_files, total_refs))

if __name__ == '__main__':
    sys.exit(main())
