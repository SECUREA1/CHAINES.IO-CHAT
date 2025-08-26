import time
import sqlite3
from flask import Flask, request
from flask_socketio import SocketIO, emit
from flask_login import current_user

from db import DB_PATH

app = Flask(__name__)
socketio = SocketIO(app)
active_users = {}
sid_to_user = {}


def get_active_users():
    now = time.time()
    return [u for u, t in active_users.items() if now - t < 30]


def safe_emit(event, data=None, to=None):
    socketio.emit(event, data, to=to)


@socketio.on('connect')
def chat_connect():
    with sqlite3.connect(DB_PATH) as conn:
        c = conn.cursor()
        c.execute(
            """
            SELECT user, message, image, file, file_name, file_type, timestamp FROM chat_messages
            ORDER BY timestamp
            """
        )
        rows = c.fetchall()
        history = [
            {
                "user": r[0],
                "message": r[1],
                "image": r[2],
                "file": r[3],
                "file_name": r[4],
                "file_type": r[5],
                "fileName": r[4],
                "fileType": r[5],
                "timestamp": r[6],
            }
            for r in rows
        ]
    safe_emit('chat_history', history, to=request.sid)
    safe_emit(
        'active_user_update',
        {'users': get_active_users(), 'count': len(get_active_users())},
        to=request.sid,
    )


@socketio.on('get_chat_history')
def get_chat_history():
    with sqlite3.connect(DB_PATH) as conn:
        c = conn.cursor()
        c.execute(
            """
            SELECT user, message, image, file, file_name, file_type, timestamp FROM chat_messages
            ORDER BY timestamp
            """
        )
        rows = c.fetchall()
        history = [
            {
                "user": r[0],
                "message": r[1],
                "image": r[2],
                "file": r[3],
                "file_name": r[4],
                "file_type": r[5],
                "fileName": r[4],
                "fileType": r[5],
                "timestamp": r[6],
            }
            for r in rows
        ]
    emit('chat_history', history)


@socketio.on('chat_message')
def handle_chat_message(data):
    msg = (data.get('message') or '').strip()
    img = data.get('image')
    file = data.get('file')
    file_name = data.get('file_name') or data.get('fileName')
    file_type = data.get('file_type') or data.get('fileType')
    if not msg and not img and not file:
        return
    if not current_user.is_authenticated:
        emit('chat_error', 'Login required to send messages.')
        return
    username = current_user.username
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            'INSERT INTO chat_messages (user, message, image, file, file_name, file_type) VALUES (?, ?, ?, ?, ?, ?)',
            (username, msg, img, file, file_name, file_type),
        )
        conn.commit()
    safe_emit(
        'chat_message',
        {
            'user': username,
            'message': msg,
            'image': img,
            'file': file,
            'file_name': file_name,
            'file_type': file_type,
            'fileName': file_name,
            'fileType': file_type,
        },
    )


@socketio.on('search_chat')
def search_chat(data):
    query = (data.get('query') or '').strip()
    if not query:
        emit('chat_search_results', [])
        return
    with sqlite3.connect(DB_PATH) as conn:
        c = conn.cursor()
        c.execute(
            """
            SELECT user, message, image, file, file_name, file_type, timestamp FROM chat_messages
            WHERE message LIKE ? OR user LIKE ?
            ORDER BY timestamp
            """,
            (f'%{query}%', f'%{query}%'),
        )
        rows = c.fetchall()
        results = [
            {
                "user": r[0],
                "message": r[1],
                "image": r[2],
                "file": r[3],
                "file_name": r[4],
                "file_type": r[5],
                "fileName": r[4],
                "fileType": r[5],
                "timestamp": r[6],
            }
            for r in rows
        ]
    emit('chat_search_results', results)


@socketio.on('user_ping')
def handle_user_ping():
    if current_user.is_authenticated:
        active_users[current_user.username] = time.time()
        sid_to_user[request.sid] = current_user.username
        safe_emit('active_user_update', {
            'users': get_active_users(),
            'count': len(get_active_users())
        })


@socketio.event
def disconnect():
    sid = request.sid
    print(f"Client {sid} disconnected")
    user = sid_to_user.pop(sid, None)
    if user and user in active_users:
        active_users.pop(user, None)
        safe_emit('active_user_update', {
            'users': get_active_users(),
            'count': len(get_active_users())
        })


if __name__ == '__main__':
    socketio.run(app)
