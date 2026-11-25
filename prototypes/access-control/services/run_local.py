#!/usr/bin/env python3
"""Start every DCIAC service and the gateway on this machine, without Docker.

    python3 services/run_local.py            # gateway on http://127.0.0.1:8766/

Each service gets 127.0.0.1:880N (gateway.LOCAL_PORTS). DCIAC_DB picks the
database file, as it does for serve.py. Ctrl-C stops everything.
"""

import os
import secrets
import signal
import subprocess
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))

import gateway  # noqa: E402


def wait(url, seconds=30):
    end = time.time() + seconds
    while time.time() < end:
        try:
            with urllib.request.urlopen(url, timeout=1) as reply:
                if reply.status == 200:
                    return True
        except OSError:
            time.sleep(0.1)
    return False


def start(env_extra=None, gateway_port=None):
    """Start migrate, all services, and the gateway. Returns the processes."""
    env = dict(os.environ, **(env_extra or {}))
    # Only the gateway knows this, so services can tell its forwarded client address apart.
    env.setdefault("DCIAC_GATEWAY_SECRET", secrets.token_hex(16))
    subprocess.run([sys.executable, os.path.join(HERE, "migrate.py")], env=env, check=True)
    procs = []
    for name, port in gateway.LOCAL_PORTS.items():
        proc = subprocess.Popen([sys.executable, os.path.join(HERE, "service.py")],
                                env=dict(env, DCIAC_SERVICE=name, DCIAC_HOST="127.0.0.1", DCIAC_PORT=str(port)))
        proc.dciac_name = name
        procs.append(proc)
    gport = gateway_port or int(env.get("DCIAC_GATEWAY_PORT", "8766"))
    proc = subprocess.Popen([sys.executable, os.path.join(HERE, "gateway.py")],
                            env=dict(env, DCIAC_HOST="127.0.0.1", DCIAC_PORT=str(gport)))
    proc.dciac_name = "gateway"
    procs.append(proc)
    for name, port in gateway.LOCAL_PORTS.items():
        if not wait("http://127.0.0.1:%d/readyz" % port):
            stop(procs)
            raise SystemExit(name + " service did not start")
    if not wait("http://127.0.0.1:%d/healthz" % gport):
        stop(procs)
        raise SystemExit("gateway did not start")
    return procs


def stop(procs):
    for proc in procs:
        if proc.poll() is None:
            proc.terminate()
    for proc in procs:
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()


def main():
    procs = start()
    print("DCIAC services up. Gateway: http://127.0.0.1:%s/" % os.environ.get("DCIAC_GATEWAY_PORT", "8766"), flush=True)
    signal.signal(signal.SIGTERM, lambda *_: (stop(procs), sys.exit(0)))
    try:
        while all(proc.poll() is None for proc in procs):
            time.sleep(0.5)
        print("A service stopped; shutting the rest down.", flush=True)
    except KeyboardInterrupt:
        pass
    stop(procs)


if __name__ == "__main__":
    main()
