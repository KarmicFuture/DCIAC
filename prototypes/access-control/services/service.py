#!/usr/bin/env python3
"""Run one DCIAC microservice.

    DCIAC_SERVICE=power python3 services/service.py

The service answers only the routes the catalog gives it. Every other API path
gets 404 so a mis-routed call can never reach another service's tables.

Each request runs inside BEGIN IMMEDIATE, which takes SQLite's write lock across
processes. That keeps the audit log's hash chain linear when several services
append to it at once.

Extra endpoints: /healthz (process up), /readyz (database answers), and
/openapi.json (this service's contract).
"""

import hmac
import json
import os
import sqlite3
import sys
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(HERE)
sys.path.insert(0, APP)
sys.path.insert(0, HERE)

import catalog  # noqa: E402
from server import db  # noqa: E402
from server.api import respond  # noqa: E402

MAX_BODY = 10 * 1024 * 1024
# A request waits at most LOCK_WAIT for this process's turn, then at most BUSY_MS
# for SQLite's cross-process write lock. Both together stay well under the
# gateway's timeout, so a request either starts in time or is refused unchanged.
LOCK_WAIT = float(os.environ.get("DCIAC_LOCK_WAIT", "10"))
BUSY_MS = int(os.environ.get("DCIAC_BUSY_MS", "10000"))
SECRET = os.environ.get("DCIAC_GATEWAY_SECRET", "")
BUSY = {"error": "The database is busy. Nothing was changed; try again."}
# GETs that write (they create missing port rows) need the write lock too.
WRITING_GETS = (catalog._compile("/racks/{id}/ports"),)


def open_database():
    conn = db.connect()
    conn.execute("PRAGMA busy_timeout = %d" % BUSY_MS)
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def database_path():
    return os.environ.get("DCIAC_DB") or db.DEFAULT_PATH


def ready():
    """Cheap readiness probe on its own connection, so a busy service still answers."""
    conn = sqlite3.connect(database_path(), timeout=1)
    try:
        conn.execute("SELECT 1").fetchone()
    finally:
        conn.close()


def client_ip(headers, socket_peer):
    """Trust X-Forwarded-For only from the gateway, proven by the shared secret."""
    lowered = {str(k).lower(): v for k, v in headers.items()}
    if SECRET and hmac.compare_digest(str(lowered.get("x-dciac-gateway") or ""), SECRET):
        forwarded = (lowered.get("x-forwarded-for") or "").split(",")[0].strip()
        if forwarded:
            return forwarded
    return socket_peer


def handle(service, method, path, headers, raw, peer):
    """Answer one API request for `service`. Returns (status, payload)."""
    path = catalog.strip_mount(path)
    if catalog.owner(method, path) != service:
        return 404, {"error": "No such API route.", "service": service}
    writes = method != "GET" or any(regex.match(path) for regex in WRITING_GETS)
    if not db.LOCK.acquire(timeout=LOCK_WAIT):
        return 503, BUSY
    try:
        conn = db.db()
        if conn.in_transaction:
            conn.commit()
        try:
            # IMMEDIATE takes SQLite's write lock up front, across processes, so the
            # audit chain's "read last hash, append" step can never interleave.
            conn.execute("BEGIN IMMEDIATE" if writes else "BEGIN")
        except sqlite3.OperationalError:
            return 503, BUSY
        try:
            db.set_peer(peer)
            result = respond(method, path, headers, raw)
        except Exception:
            conn.rollback()
            traceback.print_exc()
            return 500, {"error": "The " + service + " service failed on that request. Nothing was changed."}
        if conn.in_transaction:
            # Same as the monolith: work a handler left uncommitted (for example an
            # audited refusal) is kept, not thrown away.
            conn.commit()
    finally:
        db.LOCK.release()
    if result is None:
        return 404, {"error": "No such API route.", "service": service}
    return result


def make_handler(service):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"
        server_version = "dciac-" + service

        def log_message(self, fmt, *args):
            if os.environ.get("DCIAC_ACCESS_LOG"):
                super().log_message(fmt, *args)

        def _send(self, status, payload):
            body = json.dumps(payload).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Dciac-Service", service)
            self.end_headers()
            self.wfile.write(body)

        def _route(self):
            path = unquote(urlparse(self.path).path)
            if self.command == "GET" and path == "/healthz":
                return self._send(200, {"service": service, "ok": True})
            if self.command == "GET" and path == "/readyz":
                try:
                    ready()
                    return self._send(200, {"service": service, "ready": True})
                except Exception as exc:  # pragma: no cover - only when the volume is gone
                    return self._send(503, {"service": service, "ready": False, "error": str(exc)})
            if self.command == "GET" and path == "/openapi.json":
                return self._send(200, catalog.openapi([service]))
            length = int(self.headers.get("Content-Length") or 0)
            if length > MAX_BODY:
                return self._send(413, {"error": "Request body is too large."})
            raw = self.rfile.read(length) if length else b""
            peer = client_ip(dict(self.headers.items()), self.client_address[0] if self.client_address else "")
            status, payload = handle(service, self.command, path, dict(self.headers.items()), raw, peer)
            return self._send(status, payload)

        do_GET = _route
        do_POST = _route
        do_PATCH = _route
        do_PUT = _route
        do_DELETE = _route

    return Handler


class Server(ThreadingHTTPServer):
    # The stdlib default backlog is 5. A burst of browser or API calls then gets
    # "connection reset" before a thread can accept it.
    request_queue_size = 256
    daemon_threads = True
    allow_reuse_address = True


def main():
    service = os.environ.get("DCIAC_SERVICE", "")
    if service not in catalog.SERVICES:
        raise SystemExit("Set DCIAC_SERVICE to one of: " + ", ".join(catalog.SERVICES))
    host = os.environ.get("DCIAC_HOST", "0.0.0.0")
    port = int(os.environ.get("DCIAC_PORT", "8080"))
    open_database()
    server = Server((host, port), make_handler(service))
    server.daemon_threads = True
    print("dciac %s service on %s:%d" % (service, host, port), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
