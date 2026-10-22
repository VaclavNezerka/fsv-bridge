#!/usr/bin/env python3
"""Lokální náhled FSv Bridge bez mezipaměti prohlížeče (změny se projeví hned po obnovení).

Použití (z kořene projektu):  python tools/serve.py [port] [složka]
Výchozí: port 8765, složka src → http://127.0.0.1:8765/
"""
import functools
import http.server
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
                      ".json": "application/json", ".svg": "image/svg+xml", ".webp": "image/webp",
                      ".webm": "video/webm", ".mp4": "video/mp4"}

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):  # méně výpisů
        if not str(args[1]).startswith(("2", "3")):
            super().log_message(fmt, *args)


def main():
    port = int(os.environ.get("PORT") or (sys.argv[1] if len(sys.argv) > 1 else 8765))
    folder = ROOT / (sys.argv[2] if len(sys.argv) > 2 else "src")
    handler = functools.partial(NoCacheHandler, directory=str(folder))
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), handler) as httpd:
        print(f"Náhled: http://127.0.0.1:{port}/  (složka {folder.name}, ukončení Ctrl+C)")
        httpd.serve_forever()


if __name__ == "__main__":
    main()
