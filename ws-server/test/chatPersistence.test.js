import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildStableRoomMeta,
  buildRestoreHistoryBundle,
  dedupeMessagesById,
  resolveActiveRoomForRestore,
  shouldIncludeMessageInHistory,
  sortMessagesStable,
  CLOUD_ROOM_KEY,
} from '../chatPersistence.js';

test('maps transient websocket room ids to durable cloud room', () => {
  const meta = buildStableRoomMeta({ room: 'abc1234' });
  assert.equal(meta.roomKey, CLOUD_ROOM_KEY);
  assert.equal(meta.roomType, 'broadcast');
  assert.equal(meta.transportRoomId, 'abc1234');
  assert.equal(meta.legacyRoomId, 'abc1234');
});

test('keeps stable semantic room keys unchanged', () => {
  const meta = buildStableRoomMeta({ room: 'room-123' });
  assert.equal(meta.roomKey, 'room-123');
  assert.equal(meta.roomType, 'room');
});

test('legacy room ids are replayable through transportRoomId filter', () => {
  const include = shouldIncludeMessageInHistory(
    { roomKey: 'cloud', legacyRoomId: 'abc1234' },
    { transportRoomId: 'abc1234' }
  );
  assert.equal(include, true);
});

test('sort is deterministic by timestamp then message id', () => {
  const sorted = sortMessagesStable([
    { id: 11, createdAt: 2000, ts: 1000 },
    { id: 9, createdAt: 1000, ts: 2000 },
    { id: 10, createdAt: 1000, ts: 1000 },
  ]);
  assert.deepEqual(sorted.map((m) => m.id), [10, 9, 11]);
});

test('restore chooses durable room over transient websocket id', () => {
  const resolved = resolveActiveRoomForRestore({
    persistedSession: { active_room_key: 'room-alpha', active_room_type: 'room' },
    requested: { lastKnownTransportRoomId: 'abc1234', lastKnownActiveRoomKey: 'room-beta' },
    aliasMaps: {
      keyToTransport: new Map([['room-alpha', 'live-9']]),
      transportToKey: new Map([['abc1234', 'room-gamma']]),
      legacyToKey: new Map(),
    },
  });
  assert.equal(resolved.resolvedRoomKey, 'room-alpha');
  assert.equal(resolved.resolvedTransportRoomId, 'live-9');
});

test('active room resolves with new transport room id after reconnect', () => {
  const resolved = resolveActiveRoomForRestore({
    persistedSession: { active_room_key: 'room-1', active_transport_room_id: 'old-transport' },
    requested: {},
    aliasMaps: {
      keyToTransport: new Map([['room-1', 'new-transport']]),
      transportToKey: new Map(),
      legacyToKey: new Map(),
    },
  });
  assert.equal(resolved.resolvedRoomKey, 'room-1');
  assert.equal(resolved.resolvedTransportRoomId, 'new-transport');
});

test('stable room and legacy room messages merge without duplication', () => {
  const merged = buildRestoreHistoryBundle({
    canonicalMessages: [{ id: 1, messageId: 1, createdAt: 1, ts: 1 }, { id: 2, messageId: 2, createdAt: 2, ts: 2 }],
    legacyMessages: [{ id: 2, messageId: 2, createdAt: 2, ts: 2 }, { id: 3, messageId: 3, createdAt: 3, ts: 3 }],
  });
  assert.deepEqual(merged.map((m) => m.id), [1, 2, 3]);
});

test('dedupe protects against duplicate replay after restore then live', () => {
  const deduped = dedupeMessagesById([
    { id: 22, ts: 1000 },
    { id: 22, ts: 1000 },
    { messageId: 23, ts: 1001 },
  ]);
  assert.deepEqual(deduped.map((m) => m.id), [22, 23]);
});

test('dedupe keeps the newest copy for matching ids from live post feed', () => {
  const deduped = dedupeMessagesById([
    { id: 10, createdAt: 100, ts: 100, text: 'old' },
    { id: 10, createdAt: 200, ts: 200, text: 'latest' },
  ]);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].text, 'latest');
});

test('dedupe supports non-numeric message ids', () => {
  const deduped = dedupeMessagesById([
    { messageId: 'post-aa11', createdAt: 1, ts: 1, text: 'first' },
    { messageId: 'post-aa11', createdAt: 2, ts: 2, text: 'updated' },
    { messageId: 'post-bb22', createdAt: 3, ts: 3, text: 'other' },
  ]);
  assert.deepEqual(deduped.map((m) => m.messageId), ['post-aa11', 'post-bb22']);
  assert.equal(deduped[0].text, 'updated');
});

test('anonymous/browser-scoped restore falls back to cloud room', () => {
  const resolved = resolveActiveRoomForRestore({
    persistedSession: null,
    requested: { userKey: 'browser-123' },
    aliasMaps: { keyToTransport: new Map(), transportToKey: new Map(), legacyToKey: new Map() },
  });
  assert.equal(resolved.resolvedRoomKey, CLOUD_ROOM_KEY);
});
