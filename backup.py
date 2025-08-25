#!/usr/bin/env python3
import os
import shutil

BACKUP_ROOT = 'backups'
EXCLUDE_DIRS = {'.git', 'node_modules', BACKUP_ROOT}

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

if __name__ == '__main__':
    backup()
