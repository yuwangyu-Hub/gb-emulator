#!/usr/bin/env python3
"""部署前版本号递增：把各个模拟器的 index.html 和 src/**/*.js 里的 ?v=<数字> 统一替换为当前时间戳。

背景：本地 serve.py 会按文件 mtime 重写版本号，但线上是静态托管，
URL 不变浏览器就命中旧缓存（新旧 HTML/JS/CSS 混合 → 各种诡异 bug）。
每次重新部署前运行本脚本，让所有资源 URL 变化，强制客户端全量拉新。

站点结构：根目录是展厅首页，每个模拟器在各自的子目录里（gb/、gba/），
所以这里按 APPS 列表遍历，新增机器时只加一行。

用法: python3 tools/bump_version.py
"""
import os
import re
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VERSION = str(int(time.time()))
RE_VER = re.compile(r'\?v=\d+')

# 站点根下的页面（展厅首页 + 各模拟器目录）
APPS = ['', 'gb', 'gba']


def bump(path):
    with open(path, encoding='utf-8') as f:
        src = f.read()
    out, n = RE_VER.subn('?v=' + VERSION, src)
    if n:
        with open(path, 'w', encoding='utf-8') as f:
            f.write(out)
    return n


def targets_for(app_dir):
    base = os.path.join(ROOT, app_dir) if app_dir else ROOT
    found = []
    index = os.path.join(base, 'index.html')
    if os.path.isfile(index):
        found.append(index)
    src_dir = os.path.join(base, 'src')
    for dirpath, _, files in os.walk(src_dir):
        for name in files:
            if name.endswith('.js'):
                found.append(os.path.join(dirpath, name))
    css_dir = os.path.join(base, 'css')
    for dirpath, _, files in os.walk(css_dir):
        for name in files:
            if name.endswith('.css'):
                found.append(os.path.join(dirpath, name))
    return found


def main():
    total_files = 0
    total_refs = 0
    for app in APPS:
        for path in targets_for(app):
            n = bump(path)
            if n:
                total_files += 1
                total_refs += n
                print('  %s: %d 处' % (os.path.relpath(path, ROOT), n))
    print('版本号已更新为 ?v=%s （%d 个文件，%d 处引用）' % (VERSION, total_files, total_refs))


if __name__ == '__main__':
    sys.exit(main())
