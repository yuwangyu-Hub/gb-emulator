#!/usr/bin/env python3
"""静态开发服务器（防缓存终极版）。

1. 所有响应带 Cache-Control: no-store
2. 返回 .js / .html 前重写其中的相对 import / src 引用，追加 ?v=<目标文件mtime>
   → 任何文件一被修改，引用它的 URL 自动变化，浏览器必然重新拉取
   → 彻底杜绝"改了代码刷新还是旧的"这类问题

用法: python3 tools/serve.py [端口]  (默认 8123)
"""
import io
import os
import re
import socketserver
import sys
import http.server

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RE_JS_IMPORT = re.compile(r"(from\s+)'([^']+)'")
RE_HTML_REF = re.compile(r'((?:src|href)\s*=\s*")([^"]+)(")')


def mtime_of(path):
    try:
        return int(os.stat(path).st_mtime)
    except OSError:
        return 0


def transform_js(path, src):
    base = os.path.dirname(path)

    def repl(m):
        pre, spec = m.group(1), m.group(2)
        if not (spec.startswith('./') or spec.startswith('../')):
            return m.group(0)
        clean = spec.split('?')[0]
        target = os.path.normpath(os.path.join(base, clean))
        return "%s'%s?v=%d'" % (pre, clean, mtime_of(target))

    return RE_JS_IMPORT.sub(repl, src)


def transform_html(path, src):
    base = os.path.dirname(path)

    def repl(m):
        pre, ref, post = m.group(1), m.group(2), m.group(3)
        if not (ref.startswith('./') or ref.startswith('../')) or '?' in ref:
            if not ref.startswith('/') or '?' in ref:
                return m.group(0)
        clean = ref.split('?')[0]
        target = os.path.normpath(os.path.join(base, clean.lstrip('/')))
        if not os.path.isfile(target):
            return m.group(0)
        return '%s%s?v=%d%s' % (pre, clean, mtime_of(target), post)

    return RE_HTML_REF.sub(repl, src)


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def send_head(self):
        path = self.translate_path(self.path)
        if os.path.isfile(path) and path.endswith(('.js', '.html')):
            with open(path, encoding='utf-8') as f:
                src = f.read()
            if path.endswith('.js'):
                out = transform_js(path, src)
                ctype = 'text/javascript; charset=utf-8'
            else:
                out = transform_html(path, src)
                ctype = 'text/html; charset=utf-8'
            body = out.encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            return io.BytesIO(body)
        return super().send_head()

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
    with Server(('127.0.0.1', port), NoCacheHandler) as httpd:
        print(f'服务中: http://127.0.0.1:{port}  (目录 {ROOT}, mtime 版本号防缓存)')
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
