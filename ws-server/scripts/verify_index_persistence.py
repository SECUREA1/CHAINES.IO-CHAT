#!/usr/bin/env python3
import os
import sqlite3
from pathlib import Path


def main() -> None:
    db_path = os.environ.get("DB_PATH") or str(Path.cwd() / "app.db")
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    columns = cur.execute("PRAGMA table_info(chat_messages)").fetchall()
    has_public_index = any(
        str(col["name"]).lower() == "is_public_index" for col in columns
    )
    if not has_public_index:
        print(
            "[verify] chat_messages.is_public_index is missing. Start ws-server once so migration can add it."
        )
        return

    totals = cur.execute(
        """
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN is_public_index = 1 THEN 1 ELSE 0 END) as publicIndex,
          SUM(CASE WHEN room IS NOT NULL THEN 1 ELSE 0 END) as roomPosts
        FROM chat_messages
        """
    ).fetchone()

    latest_index = cur.execute(
        """
        SELECT id, user, room, is_public_index, message, timestamp as ts
        FROM chat_messages
        WHERE is_public_index = 1
        ORDER BY id DESC
        LIMIT 10
        """
    ).fetchall()

    print(f"[verify] DB_PATH={db_path}")
    print(
        f"[verify] totals total={totals['total'] or 0} publicIndex={totals['publicIndex'] or 0} roomPosts={totals['roomPosts'] or 0}"
    )
    print("[verify] latest public index posts:")
    for row in latest_index:
        room = row["room"] if row["room"] is not None else "null"
        print(
            f"  - id={row['id']} user={row['user'] or ''} room={room} is_public_index={row['is_public_index']} ts={row['ts']}"
        )


if __name__ == "__main__":
    main()
