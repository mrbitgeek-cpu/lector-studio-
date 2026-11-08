# -*- coding: utf-8 -*-
"""Servidor local de LectorStudio: sirve la PWA y nada mas.

La app es 100% estatica y funciona en el navegador. Este servidor solo entrega
los archivos (y es necesario para instalar la PWA y usar el service worker,
porque file:// no permite ninguna de las dos cosas).

Uso:
  python server.py                 # 127.0.0.1:8840 y abre el navegador
  python server.py --lan           # accesible desde el celular en la red local
  python server.py --no-browser    # sin abrir ventana
"""
from __future__ import annotations

import argparse
import mimetypes
import os
import socket
import subprocess
import sys
import threading
import webbrowser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DEFAULT_PORT = 8840

mimetypes.add_type("text/javascript", ".mjs")
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("application/wasm", ".wasm")
mimetypes.add_type("application/epub+zip", ".epub")
mimetypes.add_type("application/manifest+json", ".webmanifest")
mimetypes.add_type("application/pdf", ".pdf")
mimetypes.add_type("image/svg+xml", ".svg")

sys.stdout.reconfigure(encoding="utf-8", errors="replace")


class Handler(SimpleHTTPRequestHandler):
    server_version = "LectorStudio/1.0"

    def end_headers(self):
        # La app se actualiza por el service worker; el HTML no debe quedarse
        # pegado en la cache del navegador mientras se desarrolla.
        if self.path.endswith((".html", "/")) or self.path == "/":
            self.send_header("Cache-Control", "no-cache")
        self.send_header("Service-Worker-Allowed", "/")
        super().end_headers()

    def log_message(self, fmt, *args):
        if os.environ.get("LECTOR_QUIET") == "1":
            return
        print(f"{self.log_date_time_string()}  {fmt % args}", flush=True)


def local_ip() -> str:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"


def open_url(url: str, browser: str = "default") -> None:
    """Abre la app. En Windows, Edge expone las voces neuronales del sistema."""
    if browser == "edge":
        candidates = [
            Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")) / "Microsoft/Edge/Application/msedge.exe",
            Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "Microsoft/Edge/Application/msedge.exe",
            Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft/Edge/Application/msedge.exe",
        ]
        for exe in candidates:
            if exe.is_file():
                try:
                    subprocess.Popen([str(exe), url], close_fds=True)
                    return
                except OSError:
                    break
    webbrowser.open(url)


def main() -> int:
    ap = argparse.ArgumentParser(description="Servidor de LectorStudio")
    ap.add_argument("--port", type=int, default=DEFAULT_PORT)
    ap.add_argument("--host", default=None, help="por defecto 127.0.0.1, o 0.0.0.0 con --lan")
    ap.add_argument("--lan", action="store_true", help="accesible desde otros dispositivos de la red")
    ap.add_argument("--root", default=str(ROOT), help="carpeta a servir (por defecto, la del proyecto)")
    ap.add_argument("--browser", choices=["default", "edge"], default="default",
                    help="navegador con el que abrir la app (edge = voces neuronales en Windows)")
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()

    host = args.host or ("0.0.0.0" if args.lan else "127.0.0.1")
    root = Path(args.root).resolve()
    if not (root / "index.html").exists() and not (root / "lector-studio" / "index.html").exists():
        print(f"La carpeta {root} no contiene LectorStudio.")
        return 1
    handler = partial(Handler, directory=str(root))
    try:
        server = ThreadingHTTPServer((host, args.port), handler)
    except OSError as exc:
        print(f"No pude escuchar en {host}:{args.port} -> {exc}")
        print("Puede que ya haya otra instancia abierta: prueba http://127.0.0.1:%d/" % args.port)
        return 1

    url_path = "/" if (root / "index.html").exists() else "/lector-studio/"
    url = f"http://127.0.0.1:{args.port}{url_path}"
    print("=" * 60)
    print("  LECTORSTUDIO  ·  biblioteca y lectura en voz alta")
    print("=" * 60)
    print(f"  En esta PC:  {url}")
    if args.lan:
        print(f"  En el movil: http://{local_ip()}:{args.port}{url_path}")
        print("  (misma red wifi; para instalarla, abrela en el navegador del telefono)")
    print("  Cierra esta ventana para apagar el servidor.")
    print("=" * 60)
    if not args.no_browser:
        threading.Timer(0.8, lambda: open_url(url, args.browser)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
