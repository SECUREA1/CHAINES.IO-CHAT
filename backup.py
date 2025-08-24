#!/usr/bin/env python3
import os
import shutil
import sqlite3
import json

from db import DB_PATH

BACKUP_ROOT = 'backups'
EXCLUDE_DIRS = {'.git', 'node_modules', BACKUP_ROOT}


def backup_chat():
    if not os.path.exists(DB_PATH):
        return
    with sqlite3.connect(DB_PATH) as conn:
        c = conn.cursor()
        c.execute(
            """
            SELECT user, message, image, video, broadcast, file, file_name, file_type, timestamp
            FROM chat_messages
            ORDER BY timestamp
            """
        )
        rows = [
            {
                'user': r[0],
                'message': r[1],
                'image': r[2],
                'video': r[3],
                'broadcast': r[4],
                'file': r[5],
                'file_name': r[6],
                'file_type': r[7],
                'timestamp': r[8],
            }
            for r in c.fetchall()
        ]
    dest_dir = os.path.join(BACKUP_ROOT, 'json')
    os.makedirs(dest_dir, exist_ok=True)
    with open(os.path.join(dest_dir, 'chat_messages.json'), 'w', encoding='utf-8') as f:
        json.dump(rows, f, indent=2)


def backup():
    for root, dirs, files in os.walk('.', topdown=True):
        dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS and not d.startswith('.')]
        for filename in files:
            src_path = os.path.join(root, filename)
            ext = os.path.splitext(filename)[1].lstrip('.')
            if not ext:
                ext = 'no_ext'
            rel_dir = os.path.relpath(root, '.')
            if rel_dir == '.':
                rel_dir = ''
            dest_dir = os.path.join(BACKUP_ROOT, ext, rel_dir)
            os.makedirs(dest_dir, exist_ok=True)
            shutil.copy2(src_path, os.path.join(dest_dir, filename))
    backup_chat()


if __name__ == '__main__':
    backup()
