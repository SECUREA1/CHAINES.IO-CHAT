(function(){
  let chatSocket = null;
  function createBox(){
    const ctx = window.APP_CONTEXT || {};
    const box = document.createElement('div');
    box.id = 'chat-box';
      Object.assign(box.style, {
        position: 'fixed',
        top: '0',
        bottom: '0',
        left: '0',
        width: '50%',
        background: '#1a1a1a',
        color: '#ffd700',
        borderRight: '2px solid #ffd700',
        padding: '10px',
        fontSize: '14px',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box'
      });
      if(window.innerWidth < 600){
        box.style.width = '100%';
      }
      box.innerHTML =
      '<div id="chat-users" style="margin-bottom:4px;font-weight:bold;"></div>' +
      '<div style="margin-bottom:4px;">' +
      '<input id="chat-search" placeholder="Search..." style="width:100%;padding:4px;background:#222;border:1px solid #555;color:#ffd700;" />' +
      '</div>' +
      '<div id="chat-feed" style="overflow-y:auto;flex:1;margin-bottom:4px;background:#111;padding:4px;"></div>' +
      '<form id="chat-form" style="display:flex;gap:4px;align-items:center;">' +
      '<input id="chat-input" style="flex:1;padding:4px;background:#222;border:1px solid #555;color:#ffd700;" />' +
      '<input id="chat-file" type="file" style="width:110px;padding:4px;background:#222;border:1px solid #555;color:#ffd700;" />' +
      '<button style="padding:4px 8px;background:#b30000;color:#ffd700;border:1px solid #ffd700;">Send</button>' +
      '</form>';
    document.body.appendChild(box);

    const usersBox = box.querySelector('#chat-users');
    const feed = box.querySelector('#chat-feed');
    const form = box.querySelector('#chat-form');
    const input = box.querySelector('#chat-input');
    const fileInput = box.querySelector('#chat-file');
    const search = box.querySelector('#chat-search');
    const sendAllowed = !!ctx.username;
    const socket = io();
    chatSocket = socket;
    socket.on('connect', () => {
      socket.emit('get_chat_history');
    });
    function appendMsg(data){
      const msg = document.createElement('div');
      msg.style.marginBottom = '6px';
      const header = document.createElement('div');
      const text = data.message ? ` ${data.message}` : '';
      header.textContent = `${data.user}:${text}`;
      header.style.color = '#00a0ff';
      header.style.textShadow = '0 0 4px gold';
      msg.appendChild(header);
      const fileName = data.file_name || data.fileName;
      const fileType = data.file_type || data.fileType || '';
      if(data.image){
        const img = document.createElement('img');
        img.src = data.image;
        img.alt = fileName || data.message || 'image';
        img.style.maxWidth = '100%';
        msg.appendChild(img);
      } else if(data.file){
        const type = fileType;
        if(type.startsWith('video/')){
          const vid = document.createElement('video');
          vid.src = data.file;
          vid.controls = true;
          vid.style.maxWidth = '100%';
          msg.appendChild(vid);
        } else if(type.startsWith('audio/')){
          const aud = document.createElement('audio');
          aud.src = data.file;
          aud.controls = true;
          msg.appendChild(aud);
        } else {
          const link = document.createElement('a');
          link.href = data.file;
          const name = fileName || 'download';
          link.textContent = name;
          link.download = name;
          link.style.color = '#ffd700';
          msg.appendChild(link);
        }
      }
      feed.appendChild(msg);
      feed.scrollTop = feed.scrollHeight;
    }
    function renderMessages(list){
      feed.innerHTML = '';
      list.forEach(appendMsg);
    }
    socket.on('chat_history', renderMessages);
    socket.on('chat_search_results', renderMessages);
    socket.on('chat_message', appendMsg);
    socket.on('chat_error', msg => {
      alert(msg);
    });
    socket.on('active_user_update', data => {
      usersBox.textContent = `Active users (${data.count}): ${data.users.join(', ')}`;
    });
    if(!sendAllowed){
      input.disabled = true;
      input.placeholder = 'Login required to chat';
    }
    let searchTimer = null;
    search.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        const q = search.value.trim();
        if(q){
          socket.emit('search_chat', {query: q});
        } else {
          socket.emit('get_chat_history');
        }
      }, 300);
    });
    form.addEventListener('submit', e => {
      e.preventDefault();
      if(!sendAllowed){
        alert('Login required to chat');
        return;
      }
      const txt = input.value.trim();
      const file = fileInput.files[0];
      if(file){
        const reader = new FileReader();
        reader.onload = () => {
          const payload = { message: txt };
          if(file.type.startsWith('image/')){
            payload.image = reader.result;
          } else {
            payload.file = reader.result;
          }
            payload.file_name = file.name;
            payload.file_type = file.type;
            payload.fileName = file.name;
            payload.fileType = file.type;
          socket.emit('chat_message', payload);
        };
        reader.readAsDataURL(file);
        fileInput.value = '';
        input.value = '';
      } else if(txt){
        socket.emit('chat_message', { message: txt });
        input.value = '';
      }
    });
    return box;
  }

  window.initChatBox = function(){
    let box = document.getElementById('chat-box');
    if(box){
      const showing = box.style.display === 'none';
      box.style.display = showing ? 'block' : 'none';
      if(showing && chatSocket){
        chatSocket.emit('get_chat_history');
      }
      return;
    }
    createBox();
  };
})();
