#!/usr/bin/env python3
"""SPA-aware static server: отдает index.html для неизвестных путей.

Используется только для локального тестирования BrowserRouter на GH Pages.
Production deploy сделает то же самое через dist/404.html на GH Pages.
"""
import http.server, os, sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 4173
DIST = sys.argv[2] if len(sys.argv) > 2 else "dist"

class SPAHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=DIST, **kw)
    def send_error(self, code, message=None, explain=None):
        # Вместо 404 на неизвестных путях — отдать index.html (как GH Pages 404.html)
        if code == 404:
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            try:
                with open(os.path.join(DIST, "404.html"), "rb") as f:
                    self.wfile.write(f.read())
            except FileNotFoundError:
                with open(os.path.join(DIST, "index.html"), "rb") as f:
                    self.wfile.write(f.read())
            return
        super().send_error(code, message, explain)
    def log_message(self, *a, **kw):
        pass

print(f"SPA server: http://127.0.0.1:{PORT}/  (dir={DIST})")
http.server.HTTPServer(("127.0.0.1", PORT), SPAHandler).serve_forever()
