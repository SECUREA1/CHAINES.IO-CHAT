(function(){
  function escapeHTML(s){
    return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
  }
  function createCopywriterDoc(content, filename, mime, user){
    const date = new Date().toLocaleString();
    let body = '';
    if(mime.startsWith('text/')){
      body = `<pre>${escapeHTML(content)}</pre>`;
    } else if(mime.startsWith('image/')){
      body = `<img src="${content}" alt="${escapeHTML(filename)}" style="max-width:100%;"/>`;
    } else if(mime.startsWith('audio/')){
      body = `<audio controls src="${content}"></audio>`;
    } else if(mime.startsWith('video/')){
      body = `<video controls src="${content}" style="max-width:100%;"></video>`;
    } else {
      body = `<a href="${content}" download="${escapeHTML(filename)}">Download original file</a>`;
    }
    return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHTML(filename || 'download')}</title></head><body><header style="text-align:center;margin-bottom:20px;"><h1>Written on the CHAINeS Copywriters</h1><p>${escapeHTML(user)} | ${date}</p></header>${body}<footer style="text-align:center;margin-top:20px;"><p>${escapeHTML(user)} | ${date}</p><p>CHAINeS Copywriters</p></footer></body></html>`;
  }
  function downloadCopywriter(content, filename, mime, user){
    const html = createCopywriterDoc(content, filename, mime, user);
    const blob = new Blob([html], {type:'text/html'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const name = (filename || 'download').replace(/\.[^.]+$/, '') + '.html';
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  function createDownloadLink(content, filename, mime, user){
    const link = document.createElement('a');
    const name = filename || 'download';
    link.href = '#';
    link.textContent = `Download ${name}`;
    link.addEventListener('click', e => {
      e.preventDefault();
      downloadCopywriter(content, name, mime || 'application/octet-stream', user);
    });
    return link;
  }
  window.Copywriter = {
    createDoc: createCopywriterDoc,
    download: downloadCopywriter,
    createDownloadLink
  };
})();
