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

Chat messages, including attachments, are stored in the `app.db` SQLite
database. The server sends the full history to new connections and broadcasts
the number of currently connected users so the client can display a live online
count.

### Attachments

Chat messages can include images, videos, or other files. Uploads are stored in
the database along with the original filename and MIME type so the full post and
its metadata are available to other users and when reloading the chat.

### Captions

Video broadcasts and uploads now include a **CC** button by default. Users can
customize caption appearance with adjustable fonts and colors to suit personal
readability preferences. Caption tracks ship in multiple languages including
English, Portuguese/English bilingual, Korean, and Arabic/English bilingual for
improved accuracy.

### Voice-to-text captions

Live video broadcasts automatically generate captions using the browser's
SpeechRecognition API. When you start broadcasting, your spoken audio is
transcribed into caption cues shown on the stream, adapting to the language
configured for the page.

### File-type backups

Run `python backup.py` to copy repository files into the `backups/` directory.
The script uses the same backup process for every file type, storing each
extension in its own subdirectory and preserving metadata so all files retain
their information.
