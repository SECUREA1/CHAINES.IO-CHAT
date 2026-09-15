(function(){
  const listeners = new Set();
  let user = null, expiresAt = null, initialized = false, initializePromise = null;
  async function request(path, options={}){
    const res = await fetch(path, { credentials:'include', headers:{ 'Accept':'application/json', ...(options.body && !(options.body instanceof FormData) ? {'Content-Type':'application/json'} : {}) }, ...options });
    const data = await res.json().catch(() => ({}));
    if(!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status, response: res, data });
    return data;
  }
  function notify(){ listeners.forEach(fn => { try{ fn(user); }catch(e){ console.error('[SessionClient] listener failed', e); } }); }
  function applySession(session){
    user = session?.user || null;
    expiresAt = session?.expiresAt || null;
    initialized = true;
    notify();
    return user;
  }
  window.SessionClient = {
    async initialize(){
      if(initialized) return user;
      if(initializePromise) return initializePromise;
      initializePromise = request('/api/session')
        .then(applySession)
        .catch((e) => { if(e.status !== 401) console.warn('[SessionClient] session lookup failed', e); return applySession(null); })
        .finally(() => { initializePromise = null; });
      return initializePromise;
    },
    getUser(){ return user; },
    getExpiration(){ return expiresAt; },
    isAuthenticated(){ return !!user; },
    subscribe(fn){ listeners.add(fn); return () => listeners.delete(fn); },
    accept(session){ return applySession(session); },
    updateUser(patch){ if(!user) return null; user = { ...user, ...(patch || {}) }; notify(); return user; },
    async refresh(){ return applySession(await request('/api/session/refresh', { method:'POST' })); },
    async logout({ redirect = '/' } = {}){
      try{ await request('/logout', { method:'POST' }); }
      finally {
        try{ await window.MemoryBank?.clearLocalUser?.(); }catch{}
        ['chaines_username', 'chaines_profile_pic', 'session_user', 'mixer_username', 'mixer_password'].forEach((key) => { try{ localStorage.removeItem(key); }catch{} });
        try{ sessionStorage.removeItem('chaines_session_validation'); }catch{}
        applySession(null);
        if(redirect) location.assign(redirect);
      }
    }
  };
})();
