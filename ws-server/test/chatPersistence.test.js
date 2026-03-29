import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildStableRoomMeta,
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
    { id: 11, ts: 2000 },
    { id: 9, ts: 1000 },
    { id: 10, ts: 1000 },
  ]);
  assert.deepEqual(sorted.map((m) => m.id), [9, 10, 11]);
});
