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
        background: 'rgba(48,0,75,0.35)',
        color: '#ffd700',
        borderRight: '1px solid rgba(255,215,0,0.6)',
        padding: '10px',
        fontSize: '14px',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
        backdropFilter: 'blur(12px)',
        boxShadow: '0 0 20px rgba(255,215,0,0.4)'
      });
      if(window.innerWidth < 600){
        box.style.width = '100%';
      }
      box.innerHTML =
      '<div id="chat-users" style="margin-bottom:4px;font-weight:bold;"></div>' +
      '<div style="margin-bottom:4px;">' +
      '<input id="chat-search" placeholder="Search..." style="width:100%;padding:4px;background:rgba(64,0,128,0.3);border:1px solid rgba(255,215,0,0.4);color:#ffd700;backdrop-filter:blur(4px);" />' +
      '</div>' +
      '<div id="chat-feed" style="overflow-y:auto;flex:1;margin-bottom:4px;background:rgba(32,0,64,0.25);padding:4px;backdrop-filter:blur(4px);"></div>' +
      '<form id="chat-form" style="display:flex;gap:4px;align-items:center;">' +
      '<input id="chat-input" style="flex:1;padding:4px;background:rgba(64,0,128,0.3);border:1px solid rgba(255,215,0,0.4);color:#ffd700;backdrop-filter:blur(4px);" />' +
      '<input id="chat-file" type="file" style="width:110px;padding:4px;background:rgba(64,0,128,0.3);border:1px solid rgba(255,215,0,0.4);color:#ffd700;backdrop-filter:blur(4px);" />' +
      '<button style="padding:4px 8px;background:#b30000;color:#ffd700;border:1px solid #ffd700;box-shadow:0 0 10px rgba(255,215,0,0.4);">Send</button>' +
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

    function createDownloadLink(content, filename, mime, user){
      const link = Copywriter.createDownloadLink(content, filename, mime, user);
      link.style.color = '#ffd700';
      return link;
    }
    socket.on('connect', () => {
      socket.emit('get_chat_history');
    });
    function openUserProfile(username, openDm = false){
      if(!username) return;
      const target = `/profile.html?user=${encodeURIComponent(username)}${openDm ? '&openDm=1' : ''}`;
      window.location.href = target;
    }
    function appendMsg(data){
      const msg = document.createElement('div');
      msg.style.marginBottom = '6px';
      const header = document.createElement('div');
      header.style.color = '#00a0ff';
      header.style.textShadow = '0 0 6px gold';
      const userBtn = document.createElement('button');
      userBtn.type = 'button';
      userBtn.textContent = `@${data.user}`;
      Object.assign(userBtn.style, {
        background: 'transparent',
        border: '0',
        color: '#00a0ff',
        cursor: 'pointer',
        fontWeight: 'bold',
        padding: '0',
        textShadow: '0 0 6px gold'
      });
      userBtn.addEventListener('click', () => openUserProfile(data.user, true));
      header.appendChild(userBtn);
      if(data.message){
        const textNode = document.createElement('span');
        textNode.textContent = `: ${data.message}`;
        header.appendChild(textNode);
      }
      msg.appendChild(header);
      if(data.message){
        msg.appendChild(createDownloadLink(data.message, 'message', 'text/plain', data.user));
      }
      const fileName = data.file_name || data.fileName;
      const fileType = data.file_type || data.fileType || '';
      if(data.image){
        const img = document.createElement('img');
        img.src = data.image;
        img.alt = fileName || data.message || 'image';
        img.style.maxWidth = '100%';
        msg.appendChild(img);
        msg.appendChild(createDownloadLink(data.image, fileName || 'image', fileType || 'image/*', data.user));
      } else if(data.file){
        const type = fileType;
        if(type.startsWith('video/')){
          const vid = document.createElement('video');
          vid.src = data.file;
          vid.controls = true;
          vid.style.maxWidth = '100%';
          msg.appendChild(vid);
          msg.appendChild(createDownloadLink(data.file, fileName || 'video', type, data.user));
        } else if(type.startsWith('audio/')){
          const aud = document.createElement('audio');
          aud.src = data.file;
          aud.controls = true;
          msg.appendChild(aud);
          msg.appendChild(createDownloadLink(data.file, fileName || 'audio', type, data.user));
        } else {
          const link = createDownloadLink(data.file, fileName || 'download', type, data.user);
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
      usersBox.innerHTML = '';
      const label = document.createElement('span');
      label.textContent = `Active users (${data.count}): `;
      usersBox.appendChild(label);
      (data.users || []).forEach((name, idx) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = `@${name}`;
        Object.assign(btn.style, {
          background: 'transparent',
          border: '0',
          color: '#ffd700',
          cursor: 'pointer',
          padding: '0 2px',
          textDecoration: 'underline'
        });
        btn.addEventListener('click', () => openUserProfile(name, true));
        usersBox.appendChild(btn);
        if(idx < data.users.length - 1){
          usersBox.appendChild(document.createTextNode(', '));
        }
      });
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
