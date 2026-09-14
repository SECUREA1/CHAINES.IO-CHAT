import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

test('member pages initialize from the server session and do not assert a websocket username', () => {
  const sessionClient = fs.readFileSync(path.join(root, 'static/session-client.js'), 'utf8');
  const profile = fs.readFileSync(path.join(root, 'profile.html'), 'utf8');
  const messenger = fs.readFileSync(path.join(root, 'private-chat.html'), 'utf8');

  assert.match(sessionClient, /client\.init = client\.initialize/);
  assert.match(profile, /SessionClient\?\.initialize\?\.\(\)/);
  assert.match(messenger, /SessionClient\?\.initialize\?\.\(\)/);
  assert.match(messenger, /type:'join' \}/);
  assert.doesNotMatch(messenger, /type:'join', user:/);
  assert.match(messenger, /api\/messages\/conversations/);
  assert.match(messenger, /api\/members/);
});

test('AR collector supports both ERC-721 and ERC-1155 metadata paths', () => {
  const collector = fs.readFileSync(path.join(root, 'chaines-ar-collectibles.html'), 'utf8');
  assert.match(collector, /function tokenURI\(uint256\)/);
  assert.match(collector, /function uri\(uint256\)/);
  assert.match(collector, /function totalSupply\(\)/);
  assert.match(collector, /data:application\\\/json/);
});
