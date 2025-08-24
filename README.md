# CHAINeS Chat

Single-page chat client for chaines.io with optional WebSocket backend and
persistent chat history.

## Deploying on Render

1. **Static site**
   - Type: *Static Site*
   - Build Command: *(leave blank)*
   - Publish Directory: `.`

2. **WebSocket server** (optional)
   - Type: *Web Service*
   - Build Command: `npm ci`
   - Start Command: `node server.js`
   - Health Check Path: `/healthz`

The WebSocket endpoint will be available at `wss://<service-name>.onrender.com/ws`.
Configure this URL in the client via the "configure" button on the welcome screen.

### Persistent chat history

The WebSocket server stores the last 200 messages in `chat-history.json` at the
repository root and automatically sends this history to new connections. It
also broadcasts the number of currently connected users so the client can
display a live online count.

### File-type backups

Run `python backup.py` to copy repository files into the `backups/` directory.
The script uses the same backup process for every file type, storing each
extension in its own subdirectory and preserving metadata so all files retain
their information.
