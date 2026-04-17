(function(){
  const ACCESS_SESSION_KEY = 'chaines_token_gate_session';
  const LOGIN_PAGE = '/index.html';

  function normalizePath(pathname){
    const value = (pathname || '/').trim();
    if(value === '/' || value === '') return '/index.html';
    return value.toLowerCase();
  }

  function hasAccess(){
    try{
      return sessionStorage.getItem(ACCESS_SESSION_KEY) === '1';
    }catch{
      return false;
    }
  }

  function markAccess(){
    try{
      sessionStorage.setItem(ACCESS_SESSION_KEY, '1');
    }catch{}
  }

  function clearAccess(){
    try{
      sessionStorage.removeItem(ACCESS_SESSION_KEY);
    }catch{}
  }

  function redirectToLogin(){
    const target = `${window.location.pathname || ''}${window.location.search || ''}${window.location.hash || ''}`;
    const encoded = encodeURIComponent(target);
    window.location.replace(`${LOGIN_PAGE}?returnTo=${encoded}`);
  }

  function maybeRestoreReturnRoute(){
    if(!hasAccess()) return;
    const params = new URLSearchParams(window.location.search || '');
    const returnTo = params.get('returnTo');
    if(!returnTo) return;
    let decoded = '';
    try{
      decoded = decodeURIComponent(returnTo);
    }catch{
      decoded = returnTo;
    }
    if(!decoded || decoded.startsWith('http://') || decoded.startsWith('https://')) return;
    const normalized = normalizePath(decoded.split('?')[0]);
    if(normalized === '/index.html') return;
    window.location.replace(decoded);
  }

  function enforceTokenGate(){
    const normalizedPath = normalizePath(window.location.pathname || '/');
    const isLoginPage = normalizedPath === '/index.html';

    if(isLoginPage){
      maybeRestoreReturnRoute();
      return;
    }

    if(!hasAccess()){
      redirectToLogin();
    }
  }

  window.CHAINES_TOKEN_GATE = Object.assign({}, window.CHAINES_TOKEN_GATE, {
    markAccess,
    clearAccess,
    hasAccess,
    key: ACCESS_SESSION_KEY,
  });

  window.addEventListener('wallet:access-granted', markAccess);
  window.addEventListener('wallet:access-revoked', clearAccess);

  document.addEventListener('DOMContentLoaded', enforceTokenGate);
})();
