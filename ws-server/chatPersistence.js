export const MASTER_HISTORY_KEY = "chat-history-master";
export const CLOUD_ROOM_KEY = "cloud";
export const CLOUD_ROOM_TYPE = "broadcast";

export function isLikelyTransientRoomId(value = "") {
  const room = (value || "").toString().trim();
  if (!room) return false;
  if (room === CLOUD_ROOM_KEY) return false;
  if (/^(room-|dm-|channel-|cloud$)/i.test(room)) return false;
  return /^[a-z0-9]{6,12}$/i.test(room);
}

export function normalizeRoomType(value = "") {
  const roomType = (value || "").toString().trim().toLowerCase();
  if (["broadcast", "room", "dm"].includes(roomType)) return roomType;
  return CLOUD_ROOM_TYPE;
}

export function buildStableRoomMeta(message = {}) {
  const explicitRoomKey = (message.roomKey || "").toString().trim();
  const explicitRoomType = normalizeRoomType(message.roomType || "");
  const transportRoomId =
    (message.transportRoomId || message.room || "").toString().trim() || null;

  if (explicitRoomKey) {
    return {
      roomKey: explicitRoomKey,
      roomType: explicitRoomType,
      transportRoomId,
      legacyRoomId: message.legacyRoomId || null,
    };
  }

  if (transportRoomId && !isLikelyTransientRoomId(transportRoomId)) {
    return {
      roomKey: transportRoomId,
      roomType: "room",
      transportRoomId,
      legacyRoomId: message.legacyRoomId || null,
    };
  }

  return {
    roomKey: CLOUD_ROOM_KEY,
    roomType: "broadcast",
    transportRoomId,
    legacyRoomId: transportRoomId || message.legacyRoomId || null,
  };
}

export function shouldIncludeMessageInHistory(message = {}, filters = {}) {
  const roomKey = (filters.roomKey || "").toString().trim();
  const transportRoomId = (filters.transportRoomId || "").toString().trim();

  if (roomKey && message.roomKey !== roomKey) return false;
  if (!transportRoomId) return true;
  return (
    message.transportRoomId === transportRoomId ||
    message.legacyRoomId === transportRoomId
  );
}

export function sortMessagesStable(messages = []) {
  return [...messages].sort((a, b) => {
    const createdA = Number(a?.createdAt || 0);
    const createdB = Number(b?.createdAt || 0);
    if (createdA !== createdB) return createdA - createdB;
    const tsA = Number(a?.ts || 0);
    const tsB = Number(b?.ts || 0);
    if (tsA !== tsB) return tsA - tsB;
    const idA = Number(a?.id || a?.messageId || 0);
    const idB = Number(b?.id || b?.messageId || 0);
    return idA - idB;
  });
}

export function dedupeMessagesById(messages = []) {
  const byId = new Map();
  for (const message of messages) {
    const messageId = Number(message?.id ?? message?.messageId);
    if (!Number.isFinite(messageId)) continue;
    byId.set(messageId, { ...message, id: messageId, messageId });
  }
  return Array.from(byId.values());
}

export function buildRestoreHistoryBundle({
  canonicalMessages = [],
  legacyMessages = [],
} = {}) {
  return sortMessagesStable(
    dedupeMessagesById([...(canonicalMessages || []), ...(legacyMessages || [])])
  );
}

export function resolveActiveRoomForRestore({
  persistedSession = null,
  requested = {},
  aliasMaps = {},
} = {}) {
  const keyToTransport = aliasMaps.keyToTransport || new Map();
  const transportToKey = aliasMaps.transportToKey || new Map();
  const legacyToKey = aliasMaps.legacyToKey || new Map();
  const persistedKey = (persistedSession?.active_room_key || "").toString().trim();
  const requestedKey = (requested?.lastKnownActiveRoomKey || "").toString().trim();
  const requestedTransport =
    (requested?.lastKnownTransportRoomId || "").toString().trim();
  const persistedTransport =
    (persistedSession?.active_transport_room_id || "").toString().trim();

  const durableRoomKey =
    persistedKey ||
    requestedKey ||
    legacyToKey.get(requestedTransport) ||
    transportToKey.get(requestedTransport) ||
    legacyToKey.get(persistedTransport) ||
    transportToKey.get(persistedTransport) ||
    CLOUD_ROOM_KEY;

  const roomType = normalizeRoomType(
    persistedSession?.active_room_type || requested?.lastKnownRoomType || ""
  );
  const transportRoomId =
    keyToTransport.get(durableRoomKey) ||
    persistedTransport ||
    requestedTransport ||
    null;

  return {
    resolvedRoomKey: durableRoomKey,
    resolvedRoomType: roomType,
    resolvedTransportRoomId: transportRoomId || null,
  };
}
