import os
import sqlite3

DB_PATH = os.environ.get("DB_PATH", "app.db")

def ensure_columns(conn, table, columns):
    c = conn.cursor()
    c.execute(f"PRAGMA table_info({table})")
    existing = {row[1] for row in c.fetchall()}
    for name, definition in columns.items():
        if name not in existing:
            c.execute(f"ALTER TABLE {table} ADD COLUMN {name} {definition}")


def init_db():
    with sqlite3.connect(DB_PATH) as conn:
        c = conn.cursor()
        # chat log
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS chat_messages (
              id        INTEGER PRIMARY KEY AUTOINCREMENT,
              user      TEXT,
              message   TEXT,
              image     TEXT,
              file      TEXT,
              file_name TEXT,
              file_type TEXT,
              timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        ensure_columns(
            conn,
            "chat_messages",
            {
                "image": "TEXT",
                "file": "TEXT",
                "file_name": "TEXT",
                "file_type": "TEXT",
                "timestamp": "DATETIME DEFAULT CURRENT_TIMESTAMP",
            },
        )
        # migrate legacy video column
        c.execute("PRAGMA table_info(chat_messages)")
        cols = {row[1] for row in c.fetchall()}
        if "video" in cols and "file" in cols:
            c.execute(
                "UPDATE chat_messages SET file=video WHERE file IS NULL AND video IS NOT NULL"
            )
        # comments
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS comments (
              id         INTEGER PRIMARY KEY AUTOINCREMENT,
              message_id INTEGER,
              user       TEXT,
              comment    TEXT,
              timestamp  DATETIME DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        # likes
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS likes (
              id         INTEGER PRIMARY KEY AUTOINCREMENT,
              message_id INTEGER,
              user       TEXT,
              timestamp  DATETIME DEFAULT CURRENT_TIMESTAMP,
              UNIQUE(message_id, user)
            )
            """
        )
        conn.commit()

if __name__ == "__main__":
    init_db()
