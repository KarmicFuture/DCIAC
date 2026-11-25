#!/usr/bin/env python3
"""DCIAC API gateway.

Serves the built web app from dist/ (same paths as serve.py, including /DCIAC/)
and forwards each /api/v1 request to the service the catalog names as its owner.

Upstreams come from DCIAC_<SERVICE>_URL, for example
DCIAC_POWER_URL=http://power:8080. Without one, a service is looked for on
127.0.0.1 at its local port (see LOCAL_PORTS), which is what run_local.py uses.

TLS ends in front of the gateway (a load balancer or Kubernetes ingress).
"""

import http.client
import json
import os
import socket
import sys
from http.server import ThreadingHTTPServer
from urllib.parse import unquote, urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(HERE)
sys.path.insert(0, APP)
sys.path.insert(0, HERE)

import catalog  # noqa: E402
import serve  # noqa: E402  (static file handling for dist/)

PORT_BASE = int(os.environ.get("DCIAC_PORT_BASE", "8801"))
LOCAL_PORTS = {name: PORT_BASE + index for index, name in enumerate(catalog.SERVICES)}
HOP = {"connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailers", "transfer-encoding", "upgrade", "host", "content-length"}
# Longer than a service's whole budget (lock wait + SQLite busy wait, see
# service.py), so a write the service accepted is never reported as timed out
# while it is still about to happen.
TIMEOUT = float(os.environ.get("DCIAC_UPSTREAM_TIMEOUT", "45"))
SECRET = os.environ.get("DCIAC_GATEWAY_SECRET", "")
# Today's web app signs requests with X-Dciac-User / X-Dciac-Role (demo identity).
# Set DCIAC_DEMO_HEADERS=0 to drop them so only bearer tokens count.
DEMO_HEADERS = os.environ.get("DCIAC_DEMO_HEADERS", "1") != "0"
STRIP = {"x-forwarded-for", "x-real-ip", "forwarded", "x-dciac-gateway"}
DEMO = {"x-dciac-user", "x-dciac-role"}
MAX_BODY = 10 * 1024 * 1024


def upstream(name):
    url = os.environ.get("DCIAC_" + name.upper() + "_URL") or "http://127.0.0.1:%d" % LOCAL_PORTS[name]
    parsed = urlparse(url)
    return parsed.hostname, parsed.port or 80


class Gateway(serve.Handler):
    def log_message(self, fmt, *args):
        if os.environ.get("DCIAC_ACCESS_LOG"):
            super().log_message(fmt, *args)

    def _json(self, status, payload, extra=None):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)
        return True

    def _serve_api(self):
        path = self._api_path()
        if self.command == "GET" and path == "/healthz":
            return self._json(200, {"service": "gateway", "ok": True})
        if not path.startswith("/api/"):
            return False
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            return self._json(413, {"error": "Request body is too large."})
        raw = self.rfile.read(length) if length else b""
        if self.command == "GET" and path == catalog.PREFIX + "/openapi.json":
            return self._json(200, catalog.openapi())
        name = catalog.owner(self.command, path)
        if not name:
            return self._json(404, {"error": "No such API route."})
        host, port = upstream(name)
        headers = {}
        for key, value in self.headers.items():
            low = key.lower()
            if low in HOP or low in STRIP or (low in DEMO and not DEMO_HEADERS):
                continue  # compared case-insensitively, so a client cannot slip one past
            headers[key] = value
        # The gateway is the only door in, so it states the client address itself.
        headers["X-Forwarded-For"] = self.client_address[0] if self.client_address else ""
        if SECRET:
            headers["X-Dciac-Gateway"] = SECRET
        headers["Content-Length"] = str(len(raw))
        # Forward the path as the client sent it (still percent-encoded). Routing
        # used the decoded path; the service decodes once, like serve.py does.
        raw_path = urlparse(self.path).path
        if raw_path == "/DCIAC" or raw_path.startswith("/DCIAC/"):
            raw_path = raw_path[len("/DCIAC"):] or "/"
        query = urlparse(self.path).query
        target = raw_path + ("?" + query if query else "")
        if not target.isascii() or any(ord(ch) <= 32 or ord(ch) == 127 for ch in target):
            return self._json(404, {"error": "No such API route."})  # the monolith finds no such route either
        conn = http.client.HTTPConnection(host, port, timeout=TIMEOUT)
        try:
            conn.request(self.command, target, body=raw, headers=headers)
            reply = conn.getresponse()
            data = reply.read()
        except socket.timeout:
            if self.command == "GET":
                return self._json(504, {"error": "The " + name + " service did not answer in time.", "service": name})
            return self._json(504, {"error": "The " + name + " service did not answer in time. The change may still have been made: check Audit before trying again.", "service": name, "outcome": "unknown"})
        except ConnectionRefusedError:
            return self._json(503, {"error": "The " + name + " service is unavailable. Nothing was changed.", "service": name})
        except OSError:
            if self.command == "GET":
                return self._json(502, {"error": "The " + name + " service dropped the request.", "service": name})
            return self._json(502, {"error": "The " + name + " service dropped the request. The change may still have been made: check Audit before trying again.", "service": name, "outcome": "unknown"})
        except (http.client.HTTPException, ValueError, UnicodeError):
            if self.command == "GET":
                return self._json(502, {"error": "The " + name + " service gave a broken answer.", "service": name})
            return self._json(502, {"error": "The " + name + " service gave a broken answer. The change may still have been made: check Audit before trying again.", "service": name, "outcome": "unknown"})
        finally:
            conn.close()
        self.send_response(reply.status)
        for key, value in reply.getheaders():
            if key.lower() not in HOP and key.lower() not in ("server", "date", "cache-control"):
                self.send_header(key, value)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)
        return True

    def do_PUT(self):
        if not self._serve_api():
            self.send_error(404)

    def do_DELETE(self):
        if not self._serve_api():
            self.send_error(404)


class Server(ThreadingHTTPServer):
    # The stdlib default backlog is 5. A burst of browser or API calls then gets
    # "connection reset" before a thread can accept it.
    request_queue_size = 256
    daemon_threads = True
    allow_reuse_address = True


def main():
    os.chdir(APP)
    if not os.path.isfile(os.path.join(serve.DIST, "index.html")):
        raise SystemExit("Build the web app first: npm run build")
    host = os.environ.get("DCIAC_HOST", "0.0.0.0")
    port = int(os.environ.get("DCIAC_PORT", "8766"))
    server = Server((host, port), Gateway)
    server.daemon_threads = True
    print("dciac gateway on http://%s:%d/" % (host, port), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
