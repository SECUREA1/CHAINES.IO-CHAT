# CHAINeS Chat

Single-page chat client for chaines.io with optional WebSocket backend.

## Deploying on Render

1. **Static site**
   - Type: *Static Site*
   - Build Command: *(leave blank)*
   - Publish Directory: `.`

2. **WebSocket server** (optional)
   - Type: *Web Service*
   - Root Directory: `ws-server`
   - Build Command: `npm ci`
   - Start Command: `node server.js`
   - Health Check Path: `/healthz`

The WebSocket endpoint will be available at `wss://<service-name>.onrender.com/ws`.
Configure this URL in the client via the "configure" button on the welcome screen.
