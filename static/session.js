(function(){
  const CHAIN_KEY = 'mixer_current_chain';
  const CURRENCY_KEY = 'mixer_current_currency';
  const WALLET_KEY = 'mixer_current_wallet';
  const USER_KEY   = 'mixer_username';
  const PASS_KEY   = 'mixer_password';
  const USER_DATA_KEY = 'session_user';
  document.addEventListener('DOMContentLoaded', () => {
    const context = window.APP_CONTEXT = {};
    const saved = localStorage.getItem(USER_DATA_KEY);
    if(saved){
      try{ Object.assign(context, JSON.parse(saved)); } catch {}
    }
    if(context.username){
      const chatBtn = createIconButton('chat-toggle-btn', '/static/chat.svg');
      container.appendChild(chatBtn);
      // Inject live chat for logged-in users
      const sio = document.createElement('script');
      // Load Socket.IO client from the official CDN
      sio.src = 'https://cdn.socket.io/4.7.5/socket.io.min.js';
      document.body.appendChild(sio);
      const script = document.createElement('script');
      script.src = '/static/chat.js';
      document.body.appendChild(script);
      chatBtn.addEventListener('click', () => {
        if(window.initChatBox){
          window.initChatBox();
        }
      });
      // keep socket connection alive for active user tracking
      sio.onload = () => {
        const socket = io();
        socket.on('connect', () => {
          socket.emit('user_ping');
          setInterval(() => socket.emit('user_ping'), 10000);
        });
      };
    } else {
      const chatBtn = document.getElementById('chat-toggle-btn');
      if(chatBtn) chatBtn.style.display = 'none';
    }
  });
})();
