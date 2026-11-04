#!/usr/bin/env python3
"""Local preview for Access. Speaks HTTP and HTTPS on port 8766.

Serves the Vite build in dist/. Open / for local use, or /DCIAC/ the way GitHub Pages does.
Safari opens the HTTPS address. Chrome can keep using HTTP.
The certificate is created next to this file the first time the server starts.
"""

import os
import socket
import ssl
import subprocess
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlparse

ROOT = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(ROOT, "dist")
CERT_DIR = os.path.join(ROOT, "certs")
CA = os.path.join(CERT_DIR, "ca.pem")
CA_KEY = os.path.join(CERT_DIR, "ca-key.pem")
CERT = os.path.join(CERT_DIR, "localhost.pem")
KEY = os.path.join(CERT_DIR, "localhost-key.pem")
PORT = 8766
OPENSSL = "/opt/homebrew/bin/openssl"


def ensure_cert():
    os.makedirs(CERT_DIR, exist_ok=True)
    if os.path.exists(CERT) and os.path.exists(KEY) and os.path.exists(CA):
        return
    openssl = OPENSSL if os.path.exists(OPENSSL) else "openssl"
    subprocess.check_call([
        openssl, "req", "-x509", "-newkey", "rsa:2048", "-sha256", "-days", "825",
        "-nodes", "-keyout", CA_KEY, "-out", CA, "-subj", "/CN=Access Local Preview",
        "-addext", "basicConstraints=critical,CA:TRUE,pathlen:0",
        "-addext", "keyUsage=critical,keyCertSign,cRLSign",
    ])
    subprocess.check_call([
        openssl, "req", "-newkey", "rsa:2048", "-nodes", "-keyout", KEY,
        "-out", os.path.join(CERT_DIR, "localhost.csr"), "-subj", "/CN=localhost",
        "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1",
    ])
    subprocess.check_call([
        openssl, "x509", "-req", "-in", os.path.join(CERT_DIR, "localhost.csr"),
        "-CA", CA, "-CAkey", CA_KEY, "-CAcreateserial", "-out", CERT,
        "-days", "825", "-sha256", "-copy_extensions", "copy",
    ])
    os.chmod(CA_KEY, 0o600)
    os.chmod(KEY, 0o600)


class Handler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIST, **kwargs)

    def translate_path(self, path):
        raw = unquote(urlparse(path).path)
        if raw == "/DCIAC" or raw.startswith("/DCIAC/"):
            raw = raw[len("/DCIAC"):] or "/"
        rel = raw.lstrip("/") or "index.html"
        root = os.path.normpath(DIST)
        full = os.path.normpath(os.path.join(root, rel))
        if full != root and not full.startswith(root + os.sep):
            return os.path.join(root, "index.html")
        if os.path.isdir(full):
            return os.path.join(full, "index.html")
        return full

    def guess_type(self, path):
        ctype = super().guess_type(path)
        if ctype.startswith("text/") or "javascript" in ctype:
            if "charset" not in ctype:
                ctype += "; charset=utf-8"
        return ctype

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.close_connection = True
        super().end_headers()

    def handle(self):
        self.close_connection = True
        super().handle()


class Dual(ThreadingHTTPServer):
    address_family = socket.AF_INET6
    allow_reuse_address = True
    daemon_threads = True

    def server_bind(self):
        self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        super().server_bind()

    def get_request(self):
        conn, addr = self.socket.accept()
        conn.settimeout(8)
        try:
            peek = conn.recv(1, socket.MSG_PEEK)
        except Exception:
            conn.close()
            raise
        if peek == b"\x16":
            try:
                conn = self.ssl_context.wrap_socket(conn, server_side=True)
            except ssl.SSLError:
                try:
                    conn.close()
                except Exception:
                    pass
                raise
        return conn, addr


def main():
    os.chdir(ROOT)
    if not os.path.isfile(os.path.join(DIST, "index.html")):
        raise SystemExit("Build the prototype first: npm run build")
    ensure_cert()
    fullchain = os.path.join(CERT_DIR, "fullchain.pem")
    with open(fullchain, "w") as chain:
        chain.write(open(CERT).read())
        chain.write(open(CA).read())
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(fullchain, KEY)
    server = Dual(("::", PORT), Handler)
    server.ssl_context = ctx
    print("Access preview on http://127.0.0.1:%s/ and https://127.0.0.1:%s/" % (PORT, PORT), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
