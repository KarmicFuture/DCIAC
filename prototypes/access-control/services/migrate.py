#!/usr/bin/env python3
"""One-shot job: create or upgrade the shared database and seed it once.

Run it before any service starts (Docker Compose does this with a
service_completed_successfully dependency) so services never race to seed.
"""

import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from server import db  # noqa: E402


def main():
    target = os.environ.get("DCIAC_DB")
    seed = os.environ.get("DCIAC_SEED_DB")
    if target and seed and not os.path.exists(target) and os.path.exists(seed):
        # First start on an empty volume: begin from the same data as the live site.
        os.makedirs(os.path.dirname(target), exist_ok=True)
        shutil.copyfile(seed, target)
        print("dciac database copied from " + seed, flush=True)
    conn = db.connect()
    conn.execute("PRAGMA journal_mode = WAL")
    tables = conn.execute("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table'").fetchone()[0]
    assets = conn.execute("SELECT COUNT(*) FROM asset").fetchone()[0]
    conn.commit()
    conn.close()
    print("dciac database ready: %d tables, %d assets" % (tables, assets), flush=True)


if __name__ == "__main__":
    main()
