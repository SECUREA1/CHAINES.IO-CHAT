(function(){
  const listeners = new Set();
  let user = null, expiresAt = null, initialized = false;
  async function request(path, options={}){
    const res = await fetch(path, { credentials:'include', headers:{ 'Accept':'application/json', ...(options.body && !(options.body instanceof FormData) ? {'Content-Type':'application/json'} : {}) }, ...options });
    if(!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status, response: res });
    return res.json();
  }
  function notify(){ listeners.forEach(fn => { try{ fn(user); }catch(e){ console.error('[SessionClient] listener failed', e); } }); }
  window.SessionClient = {
    async initialize(){
      if(initialized) return user;
      initialized = true;
      try { const data = await request('/api/session'); user = data.user || null; expiresAt = data.expiresAt || null; }
      catch(e){ user = null; expiresAt = null; if(e.status !== 401) console.warn('[SessionClient] session lookup failed', e); }
      notify(); return user;
    },
    getUser(){ return user; },
    getExpiration(){ return expiresAt; },
    isAuthenticated(){ return !!user; },
    subscribe(fn){ listeners.add(fn); return () => listeners.delete(fn); },
    async refresh(){ const data = await request('/api/session/refresh', { method:'POST' }); user = data.user || user; expiresAt = data.expiresAt || expiresAt; notify(); return user; },
    async logout(){ try{ await request('/logout', { method:'POST' }); } finally { user = null; expiresAt = null; try{ await window.MemoryBank?.clearLocalUser?.(); }catch{} notify(); location.href = '/'; } }
  };
})();
