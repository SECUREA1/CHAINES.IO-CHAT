import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const serverFile = path.join(root, 'ws-server', 'server.js');

function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
async function startServer(dbPath=null){
  const dir = dbPath ? path.dirname(dbPath) : fs.mkdtempSync(path.join(os.tmpdir(), 'chaines-test-'));
  const port = 13000 + Math.floor(Math.random()*1000);
  const child = spawn(process.execPath, [serverFile], { cwd: path.join(root, 'ws-server'), env: { ...process.env, PORT:String(port), DB_PATH:dbPath || path.join(dir,'test.db'), ADMIN_PASSWORD:'test-admin-secret' }, stdio: ['ignore','pipe','pipe'] });
  let output=''; child.stdout.on('data', d=> output+=d); child.stderr.on('data', d=> output+=d);
  const base = `http://127.0.0.1:${port}`;
  for(let i=0;i<60;i++){ try{ const r=await fetch(base+'/healthz'); if(r.ok) return { child, base, db:path.join(dir,'test.db'), output }; }catch{} await wait(100); }
  child.kill(); throw new Error('server did not start: '+output);
}
async function json(res){ return { status: res.status, headers: res.headers, body: await res.json().catch(()=>({})) }; }
async function register(base, username){
  const r = await json(await fetch(base+'/register', { method:'POST', body:new URLSearchParams({ username, password:'correct horse battery staple' }) }));
  assert.equal(r.status, 200);
  return r.headers.get('set-cookie');
}

test('register/login/session/memory are user scoped and cookie backed', async (t)=>{
  const srv = await startServer(); t.after(()=>srv.child.kill());
  let r = await json(await fetch(srv.base+'/register', { method:'POST', body:new URLSearchParams({ username:'alice', password:'correct horse battery staple' }) }));
  assert.equal(r.status, 200);
  const cookie = r.headers.get('set-cookie');
  assert.match(cookie, /chaines_session=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  r = await json(await fetch(srv.base+'/api/session', { headers:{ cookie } }));
  assert.equal(r.status, 200); assert.equal(r.body.user.username, 'alice'); assert.equal(typeof r.body.user.id, 'number');
  r = await json(await fetch(srv.base+'/api/memory/feed-draft', { method:'PUT', headers:{ cookie, 'Content-Type':'application/json' }, body:JSON.stringify({ data:{ text:'draft A' } }) }));
  assert.equal(r.status, 200);
  r = await json(await fetch(srv.base+'/register', { method:'POST', body:new URLSearchParams({ username:'bob', password:'correct horse battery staple' }) }));
  const bobCookie = r.headers.get('set-cookie');
  r = await json(await fetch(srv.base+'/api/memory/feed-draft', { headers:{ cookie:bobCookie } }));
  assert.equal(r.status, 404);
  r = await json(await fetch(srv.base+'/api/memory/feed-draft', { headers:{ cookie } }));
  assert.equal(r.body.data.text, 'draft A');
  r = await json(await fetch(srv.base+'/logout', { method:'POST', headers:{ cookie } }));
  assert.equal(r.status, 200);
  r = await json(await fetch(srv.base+'/api/session', { headers:{ cookie } }));
  assert.equal(r.status, 401);
});

test('profiles posts reactions rewards and memory persist across sessions and restart', async (t)=>{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaines-persist-'));
  const dbPath = path.join(dir, 'persist.db');
  let srv = await startServer(dbPath);
  const aliceCookie = await register(srv.base, 'alice2');
  let r = await json(await fetch(srv.base+'/api/posts', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ body:'no auth' }) }));
  assert.equal(r.status, 401);
  r = await json(await fetch(srv.base+'/api/users/me/profile', { method:'PUT', headers:{ cookie:aliceCookie, 'Content-Type':'application/json' }, body:JSON.stringify({ description:'Permanent profile', profilePic:'/static/profiles/alice.png' }) }));
  assert.equal(r.status, 200);
  assert.equal(r.body.profile.description, 'Permanent profile');
  const mutation = 'test-mutation-1';
  r = await json(await fetch(srv.base+'/api/posts', { method:'POST', headers:{ cookie:aliceCookie, 'Content-Type':'application/json' }, body:JSON.stringify({ body:'Persistent hello', clientMutationId: mutation }) }));
  assert.equal(r.status, 201);
  const postId = r.body.post.id;
  assert.equal(r.body.post.profilePic, '/static/profiles/alice.png');
  assert.equal(r.body.rewards.points, 10);
  r = await json(await fetch(srv.base+'/api/posts', { method:'POST', headers:{ cookie:aliceCookie, 'Content-Type':'application/json' }, body:JSON.stringify({ body:'Persistent hello retry', clientMutationId: mutation }) }));
  assert.equal(r.status, 201);
  assert.equal(r.body.post.id, postId);
  assert.equal(r.body.rewards.points, 10);
  r = await json(await fetch(srv.base+'/api/posts/'+postId+'/comments', { method:'POST', headers:{ cookie:aliceCookie, 'Content-Type':'application/json' }, body:JSON.stringify({ text:'Durable comment' }) }));
  assert.equal(r.status, 201);
  r = await json(await fetch(srv.base+'/api/posts/'+postId+'/reactions', { method:'POST', headers:{ cookie:aliceCookie, 'Content-Type':'application/json' }, body:JSON.stringify({ reactionType:'like' }) }));
  assert.equal(r.status, 200);
  assert.equal(r.body.post.likeCount, 1);
  r = await json(await fetch(srv.base+'/api/posts/'+postId+'/reactions', { method:'POST', headers:{ cookie:aliceCookie, 'Content-Type':'application/json' }, body:JSON.stringify({ reactionType:'like' }) }));
  assert.equal(r.body.post.likeCount, 1);
  r = await json(await fetch(srv.base+'/api/memory/preferences', { method:'PUT', headers:{ cookie:aliceCookie, 'Content-Type':'application/json' }, body:JSON.stringify({ schemaVersion:2, data:{ theme:'neon' } }) }));
  assert.equal(r.status, 200);
  const bobCookie = await register(srv.base, 'bob2');
  r = await json(await fetch(srv.base+'/api/users/me/profile', { method:'PUT', headers:{ cookie:bobCookie, 'Content-Type':'application/json' }, body:JSON.stringify({ description:'hijack' }) }));
  assert.equal(r.status, 200);
  r = await json(await fetch(srv.base+'/profile/alice2', { headers:{ cookie:bobCookie } }));
  assert.equal(r.body.description, 'Permanent profile');
  assert.equal(r.body.posts[0].id, postId);
  assert.equal(r.body.posts[0].body, 'Persistent hello');
  assert.equal(r.body.posts[0].text, 'Persistent hello');
  assert.equal(r.body.posts[0].profilePic, '/static/profiles/alice.png');
  assert.equal(r.body.posts[0].comments[0].text, 'Durable comment');
  assert.equal(r.body.posts[0].likeCount, 1);
  assert.equal(r.body.stats.posts, 1);
  r = await json(await fetch(srv.base+'/api/memory/preferences', { headers:{ cookie:bobCookie } }));
  assert.equal(r.status, 404);
  srv.child.kill(); await wait(500);
  srv = await startServer(dbPath); t.after(()=>srv.child.kill());
  r = await json(await fetch(srv.base+'/login', { method:'POST', body:new URLSearchParams({ username:'alice2', password:'correct horse battery staple' }) }));
  assert.equal(r.status, 200);
  const cookie2 = r.headers.get('set-cookie');
  r = await json(await fetch(srv.base+'/api/feeds/global', { headers:{ cookie:cookie2 } }));
  assert.equal(r.status, 200);
  const post = r.body.posts.find(p=>p.id===postId);
  assert.equal(post.body, 'Persistent hello');
  assert.equal(post.likeCount, 1);
  assert.equal(post.comments[0].text, 'Durable comment');
  assert.equal(post.profilePic, '/static/profiles/alice.png');
  r = await json(await fetch(srv.base+'/profile/alice2', { headers:{ cookie:cookie2 } }));
  assert.equal(r.status, 200);
  assert.equal(r.body.posts.find(p=>p.id===postId).body, 'Persistent hello');
  assert.equal(r.body.stats.posts, 1);
  r = await json(await fetch(srv.base+'/api/rewards/account', { headers:{ cookie:cookie2 } }));
  assert.equal(r.body.account.points, 13);
  r = await json(await fetch(srv.base+'/api/memory/preferences', { headers:{ cookie:cookie2 } }));
  assert.equal(r.body.data.theme, 'neon');
});

test('source does not contain removed hardcoded credentials', ()=>{
  const wallet = fs.readFileSync(path.join(root,'static','wallet.js'),'utf8');
  const server = fs.readFileSync(serverFile,'utf8');
  assert(!wallet.includes('PASSWORD_OVERRIDE_SECRET'));
  assert(!server.includes('giraff'));
  assert(!server.includes('password: hash'));
});
