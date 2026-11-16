"""Yerel deneme sunucusu: python3 dev-server.py  ->  http://localhost:8000
/r/<salon> adresleri index.html'e yönlendirilir (müşteri randevu sayfası)."""
import http.server
import os

os.chdir(os.path.dirname(os.path.abspath(__file__)))


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.split('?')[0].startswith('/r/'):
            self.path = '/index.html'
        return super().do_GET()


port = int(os.environ.get('PORT', 8000))
print(f'http://localhost:{port}  (müşteri linki: http://localhost:{port}/r/lila)')
http.server.ThreadingHTTPServer(('', port), Handler).serve_forever()
