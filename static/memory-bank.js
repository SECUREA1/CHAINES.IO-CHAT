(function(){
  const CACHE_KEY='chaines_memory_v2', MIGRATION_VERSION=3;
  const LEGACY_NS='legacy-storage';
  const safeLegacyKeys=['chaines_profile_pic','chaines_messages','chaines_rewards_v1','chaines_marketplace_likes','chaines_marketplace_contacts','chaines_marketplace_dating_matches','chaines_theme','chaines_ws_url','chaines_autodelete','chaines_verified_users','mixer_current_chain','mixer_current_currency','chaines_delivery_requests','chaines_profile_calendar_v1','chaines_profile_calendar_reminders_v1','chaines_profile_entry_wallets_v1','chaines_profile_airdrop_wallets_v1','captionLanguage'];
  const sensitiveLegacyKeys=['chaines_obs_key','chaines_session_validation','mixer_password'];
  let user=null, namespaces={}, subscribers=new Map(), pending=new Set(), timer=null, initialized=false, channel=null, hydratingLegacy=false;
  const nativeSetItem=Storage.prototype.setItem;
  const nativeRemoveItem=Storage.prototype.removeItem;
  const nativeGetItem=Storage.prototype.getItem;
  const readCache=()=>{ try{return JSON.parse(nativeGetItem.call(localStorage,CACHE_KEY)||'{"version":3,"users":{}}');}catch{return {version:3,users:{}};} };
  const writeCache=(cache)=>{ nativeSetItem.call(localStorage,CACHE_KEY, JSON.stringify(cache)); };
  const legacyAllowed=(key)=>safeLegacyKeys.includes(String(key||''));
  const legacyData=()=>{ const data=window.MemoryBank?.get?.(LEGACY_NS,{}) || {}; return data && typeof data==='object' && !Array.isArray(data) ? data : {}; };
  function userCache(){ const c=readCache(); c.version=3; c.users=c.users||{}; if(user){ c.lastAuthenticatedUserId=String(user.id); c.users[user.id]=c.users[user.id]||{username:user.username,cachedAt:0,namespaces:{}}; } return c; }
  function saveLocal(){ if(!user) return; const c=userCache(); c.users[user.id]={username:user.username,cachedAt:Date.now(),namespaces}; writeCache(c); }
  function emit(ns){ (subscribers.get(ns)||[]).forEach(fn=>{ try{fn(namespaces[ns]);}catch(e){console.error('[MemoryBank] subscriber failed', e);} }); try{channel?.postMessage({userId:user?.id,namespace:ns,value:namespaces[ns]});}catch{} }
  async function syncOne(ns){ const value=namespaces[ns] || {}; const payload=JSON.stringify({schemaVersion:value.schemaVersion||3,data:value.data!==undefined?value.data:value}); const res=await fetch(`/api/memory/${encodeURIComponent(ns)}`,{method:'PUT',credentials:'include',keepalive:payload.length<60000,headers:{'Content-Type':'application/json'},body:payload}); if(!res.ok) throw new Error(`memory sync ${ns} ${res.status}`); return res.json(); }
  function schedule(ns){ if(!user) return; pending.add(ns); saveLocal(); clearTimeout(timer); timer=setTimeout(()=>window.MemoryBank.flush(),25); window.MemoryBank.flush(); }
  function setLegacyValue(key,value){ if(!user || hydratingLegacy || !legacyAllowed(key)) return; const data={...legacyData()}; data[key]=String(value); window.MemoryBank.set(LEGACY_NS,data); }
  function removeLegacyValue(key){ if(!user || hydratingLegacy || !legacyAllowed(key)) return; const data={...legacyData()}; delete data[key]; window.MemoryBank.set(LEGACY_NS,data); }
  function installStorageBridge(){ if(Storage.prototype.__chainesMemoryBridge) return; Object.defineProperty(Storage.prototype,'__chainesMemoryBridge',{value:true}); Storage.prototype.setItem=function(key,value){ const out=nativeSetItem.call(this,key,value); if(this===localStorage) setLegacyValue(key,value); return out; }; Storage.prototype.removeItem=function(key){ const out=nativeRemoveItem.call(this,key); if(this===localStorage) removeLegacyValue(key); return out; }; }
  function hydrateLegacyStorage(){ if(!user) return; const data=legacyData(); hydratingLegacy=true; try{ for(const key of safeLegacyKeys){ if(Object.prototype.hasOwnProperty.call(data,key)){ nativeSetItem.call(localStorage,key,String(data[key])); } } } finally { hydratingLegacy=false; } }
  async function migrateLegacy(){ if(!user) return; const marker=`legacy-migration-v${MIGRATION_VERSION}`; if(namespaces[marker]){ hydrateLegacyStorage(); return; } const backup={}; const preferences={}, wallet={}, legacy={...legacyData()}; for(const key of safeLegacyKeys){ const v=nativeGetItem.call(localStorage,key); if(v==null) continue; backup[key]=v; legacy[key]=v; if(key==='chaines_theme') preferences.theme=v; else if(key==='chaines_ws_url') preferences.wsUrl=v; else if(key==='chaines_autodelete') preferences.autodelete=v==='1'; else if(key==='captionLanguage') preferences.captionLanguage=v; else if(key==='mixer_current_chain') wallet.selectedChain=v; else if(key==='mixer_current_currency') wallet.selectedCurrency=v; }
    if(Object.keys(legacy).length) window.MemoryBank.set(LEGACY_NS, legacy);
    if(Object.keys(preferences).length) window.MemoryBank.patch('preferences', preferences);
    if(Object.keys(wallet).length) window.MemoryBank.patch('wallet-preferences', wallet);
    if(legacy.chaines_rewards_v1) { try{ window.MemoryBank.set('rewards', JSON.parse(legacy.chaines_rewards_v1)); }catch{} }
    nativeSetItem.call(localStorage,`${CACHE_KEY}_legacy_backup_${user.id}`, JSON.stringify({at:Date.now(),backup,sensitiveSkipped:sensitiveLegacyKeys}));
    window.MemoryBank.set(marker,{completedAt:Date.now(),safeKeys:safeLegacyKeys,sensitiveSkipped:sensitiveLegacyKeys});
    hydrateLegacyStorage();
  }
  installStorageBridge();
  window.MemoryBank={
    async initialize(){ if(initialized) return namespaces; initialized=true; await window.SessionClient?.initialize?.(); user=window.SessionClient?.getUser?.()||null; if(!user) return namespaces; const c=userCache(); namespaces={...(c.users[user.id]?.namespaces||{})}; try{ const res=await fetch('/api/memory',{credentials:'include'}); if(res.ok){ const data=await res.json(); for(const [ns,rec] of Object.entries(data.namespaces||{})) namespaces[ns]=rec; saveLocal(); } }catch(e){ console.warn('[MemoryBank] using local cache; server unavailable', e); } channel = 'BroadcastChannel' in window ? new BroadcastChannel('chaines-memory-bank') : null; if(channel) channel.onmessage=(ev)=>{ if(ev.data?.userId===user.id){ namespaces[ev.data.namespace]=ev.data.value; if(ev.data.namespace===LEGACY_NS) hydrateLegacyStorage(); emit(ev.data.namespace); } }; await migrateLegacy(); return namespaces; },
    get(ns,fallbackValue=null){ const rec=namespaces[ns]; return rec && rec.data!==undefined ? rec.data : (rec ?? fallbackValue); },
    set(ns,value){ namespaces[ns]={schemaVersion:3,updatedAt:Date.now(),data:value}; schedule(ns); emit(ns); },
    patch(ns,partial){ const cur=this.get(ns,{}); this.set(ns,{...(cur&&typeof cur==='object'?cur:{}),...(partial||{})}); },
    remove(ns){ delete namespaces[ns]; pending.add(ns); saveLocal(); emit(ns); },
    subscribe(ns,cb){ const arr=subscribers.get(ns)||[]; arr.push(cb); subscribers.set(ns,arr); return()=>subscribers.set(ns,(subscribers.get(ns)||[]).filter(x=>x!==cb)); },
    async flush(){ if(!user) return; const todo=[...pending]; pending.clear(); for(const ns of todo){ try{ if(namespaces[ns]) await syncOne(ns); else await fetch(`/api/memory/${encodeURIComponent(ns)}`,{method:'DELETE',credentials:'include'}); }catch(e){ console.warn('[MemoryBank] sync failed; queued', ns, e); pending.add(ns); } } saveLocal(); },
    async clearLocalUser(){ if(!user) return; const c=readCache(); delete c.lastAuthenticatedUserId; writeCache(c); },
    hydrateLegacyStorage,
    legacyKeys:[...safeLegacyKeys]
  };
  window.addEventListener('online',()=>window.MemoryBank.flush());
  window.addEventListener('pagehide',()=>window.MemoryBank.flush());
  window.addEventListener('beforeunload',()=>window.MemoryBank.flush());
  document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='hidden') window.MemoryBank.flush(); });
})();
