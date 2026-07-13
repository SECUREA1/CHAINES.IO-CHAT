(function(){
  const deny=/password|passcode|token|secret|private|key|payment|card|confirm/i;
  const page=(location.pathname.split('/').pop()||'index.html').replace('.html','')||'index';
  const nsMap={index:'feed-draft',marketplace:'marketplace-draft',profile:'profile', 'delivery-services':'delivery-draft','private-chat':'private-chat-drafts','rewards-program':'rewards',secure:'broadcast-preferences','chaines-ar-collectibles':'collectibles-preferences'};
  const ns=nsMap[page]||'ui-state'; let t;
  const selector='input:not([type=password]):not([type=file]), textarea, select';
  function id(el){ return el.name||el.id||el.getAttribute('aria-label'); }
  function collect(){ const data={}; document.querySelectorAll(selector).forEach(el=>{ const k=id(el); if(!k||deny.test(k)||deny.test(el.type)) return; data[k]=el.type==='checkbox'?!!el.checked:el.value; }); return data; }
  function restore(data={}){ document.querySelectorAll(selector).forEach(el=>{ const k=id(el); if(!k||!(k in data)||deny.test(k)||deny.test(el.type)) return; if(el.type==='checkbox') el.checked=!!data[k]; else el.value=data[k]; el.dispatchEvent(new Event('change',{bubbles:true})); }); }
  document.addEventListener('DOMContentLoaded', async()=>{ await window.SessionClient?.initialize?.(); await window.MemoryBank?.initialize?.(); if(window.SessionClient?.isAuthenticated?.()) restore(window.MemoryBank.get(ns,{})); document.addEventListener('input',()=>{ clearTimeout(t); t=setTimeout(()=>window.MemoryBank.patch(ns,collect()),500); },true); document.addEventListener('change',()=>{ clearTimeout(t); t=setTimeout(()=>window.MemoryBank.patch(ns,collect()),500); },true); });
})();
