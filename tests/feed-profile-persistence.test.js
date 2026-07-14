import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

function startServer(dbPath, port){
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve('.'),
    env: { ...process.env, PORT: String(port), DB_PATH: dbPath, PROFILE_MEMORY_PATH: path.join(path.dirname(dbPath), 'profiles.json'), UPLOAD_DIR: path.join(path.dirname(dbPath), 'uploads') },
    stdio: ['ignore','pipe','pipe']
  });
  let logs = '';
  child.stdout.on('data', d => logs += d);
  child.stderr.on('data', d => logs += d);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`server did not start: ${logs}`)), 10000);
    child.stdout.on('data', () => { if (logs.includes('listening on')) { clearTimeout(timeout); resolve(child); } });
    child.on('exit', code => reject(new Error(`server exited ${code}: ${logs}`)));
  });
}

async function request(base, path, { cookie = '', ...opts } = {}){
  const res = await fetch(base + path, { ...opts, headers: { ...(opts.headers || {}), ...(cookie ? { Cookie: cookie } : {}) } });
  const setCookie = res.headers.get('set-cookie') || '';
  const body = await res.json().catch(() => ({}));
  return { res, body, cookie: setCookie.split(';')[0] };
}

async function register(base, username){
  const r = await request(base, '/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'pass12345' }) });
  assert.equal(r.res.status, 200, JSON.stringify(r.body));
  return r.cookie;
}

test('server-backed posts, profile, comments, reactions, metadata and migration persist', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'chaines-feed-'));
  const dbPath = path.join(dir, 'chaines.db');
  const port = 12300 + Math.floor(Math.random() * 1000);
  const base = `http://127.0.0.1:${port}`;
  let server = await startServer(dbPath, port);
  try {
    const aliceCookie = await register(base, 'alice');
    const bobCookie = await register(base, 'bob');
    await request(base, '/api/users/me/profile', { cookie: aliceCookie, method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ description: 'Alice bio', profilePic: '/uploads/alice.png' }) });
    await request(base, '/api/users/me/profile', { cookie: bobCookie, method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ description: 'Bob bio', profilePic: '/uploads/bob.png' }) });

    const textPost = await request(base, '/api/posts', { cookie: aliceCookie, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: 'hello world', clientMutationId: 'same-id' }) });
    assert.equal(textPost.res.status, 201);
    const duplicate = await request(base, '/api/posts', { cookie: aliceCookie, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: 'hello world again', clientMutationId: 'same-id' }) });
    assert.equal(duplicate.body.post.id, textPost.body.post.id);
    const mediaPost = await request(base, '/api/posts', { cookie: bobCookie, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: 'media', clientMutationId: 'media-id', metadata: { image: 'data:image/png;base64,abc', file: 'data:image/png;base64,abc', fileName: 'pic.png', fileType: 'image/png', category: 'marketplace', listing: { title: 'Item' }, rewardHighlight: true } }) });
    assert.equal(mediaPost.res.status, 201);

    const feed = await request(base, '/api/feeds/global');
    assert.equal(feed.body.posts.length, 2);
    assert.equal(feed.body.posts.find(p => p.username === 'alice').profilePic, '/uploads/alice.png');
    assert.equal(feed.body.posts.find(p => p.username === 'bob').image, 'data:image/png;base64,abc');

    const aliceProfile = await request(base, '/profile/alice');
    assert.deepEqual(aliceProfile.body.posts.map(p => p.id), [textPost.body.post.id]);
    assert.equal(aliceProfile.body.stats.posts, 1);

    const comment = await request(base, `/api/posts/${textPost.body.post.id}/comments`, { cookie: bobCookie, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'nice' }) });
    assert.equal(comment.res.status, 201);
    let reaction = await request(base, `/api/posts/${textPost.body.post.id}/reactions`, { cookie: bobCookie, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reactionType: 'like' }) });
    assert.equal(reaction.body.post.likeCount, 1);
    reaction = await request(base, `/api/posts/${textPost.body.post.id}/reactions`, { cookie: bobCookie, method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reactionType: 'like' }) });
    assert.equal(reaction.body.post.likeCount, 0);

    const denied = await request(base, `/api/posts/${textPost.body.post.id}`, { cookie: bobCookie, method: 'DELETE' });
    assert.equal(denied.res.status, 403);

    server.kill('SIGTERM'); await new Promise(r => server.once('exit', r));
    server = await startServer(dbPath, port);
    const persisted = await request(base, '/profile/alice');
    assert.equal(persisted.body.posts[0].comments[0].text, 'nice');
    assert.equal(persisted.body.posts[0].body, 'hello world');
    const persistedFeed = await request(base, '/api/feeds/global');
    assert.equal(persistedFeed.body.posts.find(p => p.username === 'bob').metadata.listing.title, 'Item');
  } finally {
    server?.kill('SIGTERM');
    rmSync(dir, { recursive: true, force: true });
  }
});
