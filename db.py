import os
import sqlite3

DB_PATH = os.environ.get("DB_PATH", "app.db")

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
              video     TEXT,
              broadcast TEXT,
              file      TEXT,
              file_name TEXT,
              file_type TEXT,
              timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        # ensure new columns exist for older databases
        c.execute("PRAGMA table_info(chat_messages)")
        cols = [row[1] for row in c.fetchall()]
        if "video" not in cols:
            c.execute("ALTER TABLE chat_messages ADD COLUMN video TEXT")
        if "broadcast" not in cols:
            c.execute("ALTER TABLE chat_messages ADD COLUMN broadcast TEXT")
        conn.commit()

if __name__ == "__main__":
    init_db()
