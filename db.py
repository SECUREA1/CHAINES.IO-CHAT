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
              timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        conn.commit()

if __name__ == "__main__":
    init_db()
