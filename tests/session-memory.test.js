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

test('marketplace sync keeps active listings from every seller', async (t)=>{
  const srv = await startServer(); t.after(()=>srv.child.kill());
  const listing = (id, user, text) => ({
    id, user, text, ts: Date.now(), category:'for-sale',
    listing:{ category:'for-sale', price:'10' }
  });

  let r = await json(await fetch(srv.base+'/api/marketplace/listings', {
    method:'PUT', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({ items:[listing('alice-item', 'alice', 'Alice listing')] })
  }));
  assert.equal(r.status, 200);

  r = await json(await fetch(srv.base+'/api/marketplace/listings', {
    method:'PUT', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({ items:[listing('bob-item', 'bob', 'Bob listing')] })
  }));
  assert.equal(r.status, 200);

  r = await json(await fetch(srv.base+'/api/marketplace/listings'));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.items.map(item=>item.id).sort(), ['alice-item', 'bob-item']);
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

test('delivery receipts use server totals, persist once, and report unavailable email honestly', async (t)=>{
  const srv = await startServer(); t.after(()=>srv.child.kill());
  const registered = await json(await fetch(srv.base+'/register', {method:'POST',body:new URLSearchParams({username:'delivery_customer',password:'correct horse battery staple',useFacialRecognition:'false'})}));
  assert.equal(registered.status,200);
  const headers={'Content-Type':'application/json',cookie:registered.headers.get('set-cookie')};
  const order={id:'DLV-test-1',customer:{name:'Test Customer',phone:'555-0100'},route:{pickup:'Toronto',dropoff:'Toronto'},service:{deliveryType:'meal'},items:[{name:'Lunch',group:'lunch',qty:1,basePrice:12.99}],budget:20,total:999};
  let result=await json(await fetch(srv.base+'/delivery-orders',{method:'POST',headers,body:JSON.stringify(order)}));
  assert.equal(result.status,200);assert.equal(result.body.pricing.total,14.68);
  assert.equal(result.body.receiptDelivery.admin.success,false);assert.equal(result.body.receiptDelivery.admin.queued,false);
  assert.equal(result.body.pricing.paymentStatus,'not-collected');
  result=await json(await fetch(srv.base+'/delivery-orders',{method:'POST',headers,body:JSON.stringify(order)}));
  assert.equal(result.body.duplicate,true);assert.equal(result.body.pricing.total,14.68);
  const Database=(await import('better-sqlite3')).default;
  const database=new Database(srv.db);t.after(()=>database.close());
  assert.equal(database.prepare('SELECT COUNT(*) AS n FROM delivery_orders').get().n,1);
  const saved=JSON.parse(database.prepare('SELECT request_json FROM delivery_orders').get().request_json);
  assert.equal(saved.total,14.68);assert.equal(saved.currency,'CAD');
  const history=await json(await fetch(srv.base+'/delivery-orders',{headers}));
  assert.equal(history.body.items.length,1);assert.equal(history.body.items[0].total,14.68);
  const other=await json(await fetch(srv.base+'/register',{method:'POST',body:new URLSearchParams({username:'other_delivery_user',password:'correct horse battery staple',useFacialRecognition:'false'})}));
  const privateHistory=await json(await fetch(srv.base+'/delivery-orders',{headers:{cookie:other.headers.get('set-cookie')}}));
  assert.deepEqual(privateHistory.body.items,[]);

  const rejected=await fetch(srv.base+'/delivery-orders',{method:'POST',headers,body:JSON.stringify({...order,id:'DLV-over',budget:1})});
  assert.equal(rejected.status,400);
});

test('cloud media preserves original bytes and supports seeking without exposing source filenames',async(t)=>{
  const srv=await startServer();t.after(()=>srv.child.kill());
  const bytes=Buffer.from('0123456789abcdef');
  const form=new FormData();form.append('file',new Blob([bytes],{type:'video/mp4'}),'private-source-name.mp4');
  const uploaded=await json(await fetch(srv.base+'/api/media',{method:'POST',body:form,headers:{Origin:'https://www.chaines.io'}}));
  assert.equal(uploaded.status,201);assert.equal(uploaded.headers.get('access-control-allow-origin'),'https://www.chaines.io');
  assert.equal(uploaded.body.name,'video.mp4');assert(!JSON.stringify(uploaded.body).includes('private-source-name'));
  const url=srv.base+uploaded.body.url;
  const otherForm=new FormData();otherForm.append('file',new Blob(['format-specific bytes'],{type:'application/octet-stream'}),'private-design.blend');
  const other=await json(await fetch(srv.base+'/api/media',{method:'POST',body:otherForm}));
  assert.equal(other.body.name,'attachment.blend');
  const otherDownload=await fetch(srv.base+other.body.url);
  assert.match(otherDownload.headers.get('content-disposition'),/filename="attachment.blend"/);
  assert.equal(await otherDownload.text(),'format-specific bytes');

  const full=await fetch(url);assert.deepEqual(Buffer.from(await full.arrayBuffer()),bytes);
  const ranged=await fetch(url,{headers:{Range:'bytes=2-5'}});assert.equal(ranged.status,206);assert.equal(ranged.headers.get('content-range'),'bytes 2-5/16');assert.equal(await ranged.text(),'2345');
  assert(!ranged.headers.get('content-disposition').includes('private-source-name'));
  assert.equal((await fetch(url,{headers:{Range:'bytes=999-'}})).status,416);
  const suffix=await fetch(url,{headers:{Range:'bytes=-3'}});assert.equal(await suffix.text(),'def');
  const download=await fetch(url+'?download=1');assert.match(download.headers.get('content-disposition'),/^attachment/);
  const WebSocket=(await import('ws')).default;
  const socket=new WebSocket(srv.base.replace('http','ws')+'/ws');t.after(()=>socket.close());
  const events=[];socket.on('message',raw=>events.push(JSON.parse(raw)));
  await new Promise(resolve=>socket.on('open',resolve));
  socket.send(JSON.stringify({type:'join',user:'mediaposter'}));
  socket.send(JSON.stringify({type:'chat',user:'mediaposter',file:uploaded.body.url,fileType:'video/mp4',fileName:'private-source-name.mp4',name:'private-source-name.mp4',text:'Attachment: private-source-name.mp4',selfDestruct:10}));
  for(let i=0;i<80&&!events.some(e=>e.type==='chat'&&e.file===uploaded.body.url);i++)await wait(25);
  const posted=events.find(e=>e.type==='chat'&&e.file===uploaded.body.url);assert(posted);
  assert(!JSON.stringify(posted).includes('private-source-name'));assert.equal(posted.selfDestruct,undefined);
  await wait(30);
  const Database=(await import('better-sqlite3')).default;const database=new Database(srv.db);t.after(()=>database.close());
  assert.equal(database.prepare('SELECT COUNT(*) AS n FROM chat_messages WHERE file=?').get(uploaded.body.url).n,1);
  const stored=database.prepare('SELECT bytes FROM media_assets WHERE id=?').get(uploaded.body.url.split('/').pop());assert.deepEqual(stored.bytes,bytes);
  socket.close();srv.child.kill();
  const restarted=spawn(process.execPath,[serverFile],{cwd:path.join(root,'ws-server'),env:{...process.env,PORT:new URL(srv.base).port,DB_PATH:srv.db,RESEND_API_KEY:'',TWILIO_ACCOUNT_SID:'',TWILIO_AUTH_TOKEN:'',TWILIO_FROM_PHONE:''},stdio:'ignore'});t.after(()=>restarted.kill());
  let recovered;for(let i=0;i<80;i++){try{const r=await fetch(url);if(r.ok){recovered=Buffer.from(await r.arrayBuffer());break;}}catch{}await wait(50);}
  assert.deepEqual(recovered,bytes);
});
