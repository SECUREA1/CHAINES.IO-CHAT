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
              file      TEXT,
              file_name TEXT,
              file_type TEXT,
              timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
            """
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
