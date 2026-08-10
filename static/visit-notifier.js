(() => {
  const isLocal = /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);
  // The public pages are hosted by the static Render service, while this API is
  // owned by the WebSocket service declared in render.yaml.
  const backend = isLocal ? window.location.origin : "https://chaines-chat-ws.onrender.com";
  const page = encodeURIComponent(`${location.pathname}${location.search}`);
  const endpoint = `${backend}/api/site-opened?page=${page}`;

  fetch(endpoint, { method: "POST", mode: "no-cors", keepalive: true, body: "opened" }).catch(() => {});
})();
