# Persistent feed media and broadcast replays

`POST /api/media` accepts one file of any format, up to 100 MB. Original bytes are stored in `media_assets` in the same SQLite database as chat history. Uploads and public URLs contain no original basename. Public labels, alternative text, download headers, message metadata and automatic attachment captions use generic names; a safe format extension is retained so downloads can be opened. This does not remove metadata embedded inside the uploaded file itself.

Media URLs use random identifiers. The download response uses `Content-Disposition: attachment` for active formats; HTML, SVG and unknown documents never execute as an inline feed preview. Image, audio and video previews depend on the browser's format/codec support. A download remains available when previewing is unsupported. Byte-range responses support media seeking and resume.

The client uploads to the same origin as its configured WebSocket server (`chaines_ws_url`), using the default cloud backend for the public website. Media CORS permits `chaines.io`, `www.chaines.io` and the repository's static Render hostname; additional frontend origins can be listed in `MEDIA_ALLOWED_ORIGINS`.

Broadcasts record locally while live, including microphone-only sessions. Ending a broadcast offers Save/Discard. Save uploads the recording and publishes a replay to the global index feed. Save failures retain the Blob in the page with retry and local-download buttons. Keep that page open until saved; closing/reloading a tab cannot preserve an unfinished in-memory recording. Files and saved replay posts do not receive the text-post five-minute self-destruct timer. Explicit post deletion is still available. Files larger than the upload limit must be downloaded locally and reduced before upload.

## Production retention requirement

**`DB_PATH` must point to a persistent, backed-up volume.** The code survives process restarts when the same database is retained; an ephemeral hosting filesystem cannot retain uploads or posts across redeployments. Existing Render configuration does not declare a persistent database disk. Configure one in the hosting service and point `DB_PATH` at it before claiming permanent production retention.

Back up and migrate the existing SQLite database (including committed WAL data using SQLite's backup facility) before changing `DB_PATH`; never switch a live service to a new empty database. This change deliberately does not automatically replace the production database path or provision a paid volume. Size the volume for recording retention, monitor capacity and keep backups. Applying and checking the live hosting configuration requires access to that service.

Tests use isolated databases, real multipart uploads and WebSocket posts; they verify original bytes, generic names, range playback, persisted media after process restart and no auto-expiry. Browser checks additionally cover native playback, file downloads, main-feed reloads, camera recording and a real two-user microphone approval/audio recording flow.
