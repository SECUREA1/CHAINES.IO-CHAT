(function(){
  const json = async (url, opts={}) => { const res = await fetch(url, { credentials:'include', headers:{'Content-Type':'application/json', ...(opts.headers||{})}, ...opts }); const data = await res.json().catch(()=>({})); if(!res.ok) throw new Error(data.error || `Request failed: ${res.status}`); return data; };
  const qsUser = () => new URLSearchParams(location.search).get('user') || '';
  const identity = { async resolveCurrentUser(){ const data = await json(`/api/rewards/account${qsUser()?`?user=${encodeURIComponent(qsUser())}`:''}`); return data.user; }, session(){ return json('/api/session'); } };
  const profiles = { get:(id)=>json(`/api/users/${encodeURIComponent(id)}`), update:(id,data)=>json(`/api/users/${encodeURIComponent(id)}/profile`,{method:'PATCH',body:JSON.stringify(data)}) };
  const posts = { list:(p={})=>json('/api/posts?'+new URLSearchParams(p)), create:(d)=>json('/api/posts',{method:'POST',body:JSON.stringify(d)}), get:(id)=>json(`/api/posts/${id}`), update:(id,d)=>json(`/api/posts/${id}`,{method:'PATCH',body:JSON.stringify(d)}), delete:(id)=>json(`/api/posts/${id}`,{method:'DELETE'}) };
  const feeds = { global:(p={})=>json('/api/feeds/global?'+new URLSearchParams(p)), following:(p={})=>json('/api/feeds/following?'+new URLSearchParams(p)), profile:(id,p={})=>json(`/api/feeds/profile/${id}?`+new URLSearchParams(p)) };
  const rewards = { account:()=>json(`/api/rewards/account${qsUser()?`?user=${encodeURIComponent(qsUser())}`:''}`), history:(p={})=>json('/api/rewards/history?'+new URLSearchParams(p)), recordAction:(d)=>json('/api/rewards/actions',{method:'POST',body:JSON.stringify(d)}), redeem:(d)=>json('/api/rewards/redeem',{method:'POST',body:JSON.stringify(d)}), leaderboard:()=>json('/api/rewards/leaderboard'), migrateLegacy:(legacy)=>json('/api/rewards/migrate-legacy',{method:'POST',body:JSON.stringify({legacy})}) };
  const reactions = { toggle:(postId,type='like')=>json(`/api/posts/${postId}/reactions`,{method:'POST',body:JSON.stringify({type})}), remove:(postId)=>json(`/api/posts/${postId}/reactions`,{method:'DELETE'}) };
  const follows = { toggle:(targetUserId)=>json(`/api/users/${targetUserId}/follow`,{method:'POST'}), remove:(targetUserId)=>json(`/api/users/${targetUserId}/follow`,{method:'DELETE'}) };
  const memoryNs = (ns) => ({ get:()=>json(`/api/memory/${ns}`), set:(data)=>json(`/api/memory/${ns}`,{method:'PUT',body:JSON.stringify({data})}), patch:(data)=>json(`/api/memory/${ns}`,{method:'PATCH',body:JSON.stringify({data})}) });
  window.CHAINeSIdentity = identity;
  window.CHAINeSMemory = { identity, profiles, posts, feeds, rewards, reactions, follows, marketplace:memoryNs('marketplace'), live:memoryNs('live'), preferences:memoryNs('preferences'), notifications:memoryNs('notifications') };
})();
