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
  const child = spawn(process.execPath, [serverFile], { cwd: path.join(root, 'ws-server'), env: { ...process.env, PORT:String(port), DB_PATH:path.join(dir,'test.db'), ADMIN_PASSWORD:'test-admin-secret', RESEND_API_KEY:'', TWILIO_ACCOUNT_SID:'', TWILIO_AUTH_TOKEN:'', TWILIO_FROM_PHONE:'' }, stdio: ['ignore','pipe','pipe'] });
  let output=''; child.stdout.on('data', d=> output+=d); child.stderr.on('data', d=> output+=d);
  const base = `http://127.0.0.1:${port}`;
  for(let i=0;i<60;i++){ try{ const r=await fetch(base+'/healthz'); if(r.ok) return { child, base, db:path.join(dir,'test.db'), output }; }catch{} await wait(100); }
  child.kill(); throw new Error('server did not start: '+output);
}
async function json(res){ return { status: res.status, headers: res.headers, body: await res.json().catch(()=>({})) }; }
const faceDescriptor = JSON.stringify(Array.from({ length: 128 }, (_, index) => Number((index / 1000).toFixed(6))));
const faceScanImage = 'data:image/jpeg;base64,' + Buffer.from('mock scanned facial recognition image').toString('base64');

test('register/login/session/memory are user scoped and cookie backed', async (t)=>{
  const srv = await startServer(); t.after(()=>srv.child.kill());
  let r = await json(await fetch(srv.base+'/register', { method:'POST', body:new URLSearchParams({ username:'alice', password:'correct horse battery staple', faceDescriptor, faceScanImage }) }));
  assert.equal(r.status, 200);
  const cookie = r.headers.get('set-cookie');
  assert.match(cookie, /chaines_session=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  r = await json(await fetch(srv.base+'/api/session', { headers:{ cookie } }));
  assert.equal(r.status, 200); assert.equal(r.body.user.username, 'alice'); assert.equal(typeof r.body.user.id, 'number');
  r = await json(await fetch(srv.base+'/profile/alice', {
    method:'POST', headers:{ cookie, 'Content-Type':'application/x-www-form-urlencoded' }, body:new URLSearchParams({ description:'Alice profile' })
  }));
  assert.equal(r.status, 200);
  assert.equal(r.body.user.description, 'Alice profile');
  r = await json(await fetch(srv.base+'/api/members'));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.members.map(member => member.username), ['alice']);
  assert.equal(r.body.members[0].profileUrl, '/profile.html?user=alice');
  r = await json(await fetch(srv.base+'/api/memory/feed-draft', { method:'PUT', headers:{ cookie, 'Content-Type':'application/json' }, body:JSON.stringify({ data:{ text:'draft A' } }) }));
  assert.equal(r.status, 200);
  r = await json(await fetch(srv.base+'/register', { method:'POST', body:new URLSearchParams({ username:'bob', password:'correct horse battery staple', faceDescriptor, faceScanImage }) }));
  const bobCookie = r.headers.get('set-cookie');
  r = await json(await fetch(srv.base+'/api/memory/feed-draft', { headers:{ cookie:bobCookie } }));
  assert.equal(r.status, 404);
  r = await json(await fetch(srv.base+'/api/memory/feed-draft', { headers:{ cookie } }));
  assert.equal(r.body.data.text, 'draft A');
  r = await json(await fetch(srv.base+'/logout', { method:'POST', headers:{ cookie } }));
  assert.equal(r.status, 200);
  assert.match(r.headers.get('set-cookie'), /chaines_session=;/);
  r = await json(await fetch(srv.base+'/api/session', { headers:{ cookie } }));
  assert.equal(r.status, 401);

  r = await json(await fetch(srv.base+'/api/admin/faces'));
  assert.equal(r.status, 401);
  r = await json(await fetch(srv.base+'/api/admin/faces', { headers:{ cookie:bobCookie } }));
  assert.equal(r.status, 403);
  r = await json(await fetch(srv.base+'/login', { method:'POST', body:new URLSearchParams({ username:'admin', password:'test-admin-secret', faceDescriptor, faceScanImage }) }));
  assert.equal(r.status, 200);
  const adminCookie = r.headers.get('set-cookie');
  r = await json(await fetch(srv.base+'/api/admin/faces', { headers:{ cookie:adminCookie } }));
  assert.equal(r.status, 200);
  const aliceFace = r.body.faces.find((face) => face.username === 'alice');
  assert(aliceFace);
  assert.equal(aliceFace.enrolled, true);
  assert.equal(aliceFace.faceScanImage, faceScanImage);
});

test('source does not contain removed hardcoded credentials', ()=>{
  const wallet = fs.readFileSync(path.join(root,'static','wallet.js'),'utf8');
  const server = fs.readFileSync(serverFile,'utf8');
  assert(!wallet.includes('PASSWORD_OVERRIDE_SECRET'));
  assert(!server.includes('giraff'));
  assert(!server.includes('password: hash'));
  assert.match(server, /Account: \$\{username \|\| "not signed in"\}/);
  assert.match(server, /IP address: \$\{req\.ip/);
  assert(!server.includes('req.headers.cookie}`'));
  assert(!server.includes('session.tokenHash'));
});

test('site-open reports are accepted and entry pages load the notifier', async (t)=>{
  const srv = await startServer(); t.after(()=>srv.child.kill());
  const report = await fetch(srv.base+'/api/site-opened?page=%2Fmarketplace', {
    method:'POST', headers:{ 'Content-Type':'text/plain', 'User-Agent':'visit-notifier-test' }, body:'opened'
  });
  assert.equal(report.status, 202);
  assert.deepEqual(await report.json(), { accepted:true });

  const page = await (await fetch(srv.base+'/')).text();
  assert.match(page, /\/static\/visit-notifier\.js/);
});

test('production visit notifications target the deployed backend and configured recipients', ()=>{
  const notifier = fs.readFileSync(path.join(root, 'static', 'visit-notifier.js'), 'utf8');
  const blueprint = fs.readFileSync(path.join(root, 'render.yaml'), 'utf8');
  assert.match(notifier, /https:\/\/chaines-chat-ws\.onrender\.com/);
  assert.doesNotMatch(notifier, /https:\/\/chaines-io-chat\.onrender\.com/);
  assert.match(blueprint, /key: VISIT_NOTIFICATION_EMAIL\s+value: chadolthofedx@gmail\.com/);
  assert.match(blueprint, /key: VISIT_NOTIFICATION_PHONE\s+value: ["']?\+15194760080["']?/);
  for (const key of ['RESEND_API_KEY', 'RECEIPT_FROM_EMAIL', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_PHONE']) {
    assert.match(blueprint, new RegExp(`key: ${key}\\s+sync: false`));
  }
});

test('facial recognition is an explicit, reversible sign-in choice', async (t)=>{
  const srv = await startServer(); t.after(()=>srv.child.kill());
  let r = await json(await fetch(srv.base+'/register', {
    method:'POST',
    body:new URLSearchParams({ username:'privacy_user', password:'correct horse battery staple', useFacialRecognition:'false' })
  }));
  assert.equal(r.status, 200);

  r = await json(await fetch(srv.base+'/login', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({ username:'privacy_user', password:'correct horse battery staple', useFacialRecognition:false })
  }));
  assert.equal(r.status, 200);
  assert.equal(r.body.faceAuthEnabled, false);

  r = await json(await fetch(srv.base+'/login', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({ username:'privacy_user', password:'correct horse battery staple', useFacialRecognition:true })
  }));
  assert.equal(r.status, 401);
  assert.equal(r.body.faceRequired, true);
});
