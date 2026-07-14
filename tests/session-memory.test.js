import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const serverFile = path.join(root, 'ws-server', 'server.js');

function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
async function startServer(){
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaines-test-'));
  const port = 13000 + Math.floor(Math.random()*1000);
  const child = spawn(process.execPath, [serverFile], { cwd: path.join(root, 'ws-server'), env: { ...process.env, PORT:String(port), DB_PATH:path.join(dir,'test.db'), ADMIN_PASSWORD:'test-admin-secret' }, stdio: ['ignore','pipe','pipe'] });
  let output=''; child.stdout.on('data', d=> output+=d); child.stderr.on('data', d=> output+=d);
  const base = `http://127.0.0.1:${port}`;
  for(let i=0;i<60;i++){ try{ const r=await fetch(base+'/healthz'); if(r.ok) return { child, base, db:path.join(dir,'test.db'), output }; }catch{} await wait(100); }
  child.kill(); throw new Error('server did not start: '+output);
}
async function json(res){ return { status: res.status, headers: res.headers, body: await res.json().catch(()=>({})) }; }

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
  r = await json(await fetch(srv.base+'/api/memory/sync', { method:'POST', headers:{ cookie, 'Content-Type':'application/json' }, body:JSON.stringify({ items:[{ namespace:'marketplace-draft', schemaVersion:3, data:{ text:'listing draft', device:'mobile' } }, { namespace:'profile', schemaVersion:3, data:{ bio:'same on desktop' } }], remove:['feed-draft'] }) }));
  assert.equal(r.status, 200);
  assert.equal(r.body.saved.length, 2);
  r = await json(await fetch(srv.base+'/api/memory/marketplace-draft', { headers:{ cookie } }));
  assert.equal(r.body.data.text, 'listing draft');
  r = await json(await fetch(srv.base+'/api/memory/profile', { headers:{ cookie } }));
  assert.equal(r.body.data.bio, 'same on desktop');
  r = await json(await fetch(srv.base+'/api/memory/feed-draft', { headers:{ cookie } }));
  assert.equal(r.status, 404);
  r = await json(await fetch(srv.base+'/logout', { method:'POST', headers:{ cookie } }));
  assert.equal(r.status, 200);
  r = await json(await fetch(srv.base+'/api/session', { headers:{ cookie } }));
  assert.equal(r.status, 401);
});

test('source does not contain removed hardcoded credentials', ()=>{
  const wallet = fs.readFileSync(path.join(root,'static','wallet.js'),'utf8');
  const server = fs.readFileSync(serverFile,'utf8');
  assert(!wallet.includes('PASSWORD_OVERRIDE_SECRET'));
  assert(!server.includes('giraff'));
  assert(!server.includes('password: hash'));
});
