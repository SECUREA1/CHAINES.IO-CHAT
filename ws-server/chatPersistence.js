export const MASTER_HISTORY_KEY = "chat-history-master";
export const CLOUD_ROOM_KEY = "cloud";

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
  return "broadcast";
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
    const tsA = Number(a?.createdAt || a?.ts || 0);
    const tsB = Number(b?.createdAt || b?.ts || 0);
    if (tsA !== tsB) return tsA - tsB;
    return Number(a?.messageId || a?.id || 0) - Number(b?.messageId || b?.id || 0);
  });
}
