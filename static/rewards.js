(function(){
  const STORAGE_KEY = 'chaines_rewards_v1';
  const DEFAULT_RULES = {
    post: { points: 2, label: 'Post to feed' },
    listing: { points: 5, label: 'Publish marketplace listing' },
    streamMinute: { points: 1, label: 'Stream live (per minute)' },
    walletConnected: { points: 1, label: 'Verified wallet connected' },
    ghostCoin: { points: 1, label: 'Ghost coin collected' }
  };

  function safeParse(value, fallback){
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : fallback;
    } catch {
      return fallback;
    }
  }

  function readStore(){
    return safeParse(localStorage.getItem(STORAGE_KEY) || '{}', {});
  }

  function writeStore(store){
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  }

  function normalizeUserRecord(userRecord){
    const base = userRecord && typeof userRecord === 'object' ? userRecord : {};
    return {
      totalPoints: Number.isFinite(base.totalPoints) ? base.totalPoints : 0,
      actions: base.actions && typeof base.actions === 'object' ? base.actions : {},
      walletConnections: Array.isArray(base.walletConnections) ? base.walletConnections : [],
      ghostTokenCount: Number.isFinite(base.ghostTokenCount) ? base.ghostTokenCount : 0,
      updatedAt: base.updatedAt || null
    };
  }

  function readUser(username){
    if(!username) return normalizeUserRecord({});
    const store = readStore();
    return normalizeUserRecord(store[username]);
  }

  function writeUser(username, userRecord){
    if(!username) return;
    const store = readStore();
    store[username] = normalizeUserRecord(userRecord);
    writeStore(store);
  }

  function addActionCount(userRecord, action, amount){
    const current = Number.isFinite(userRecord.actions[action]) ? userRecord.actions[action] : 0;
    userRecord.actions[action] = Math.max(0, current + amount);
  }

  function grantPoints(username, action, points){
    if(!username || !action) return null;
    const amount = Number(points);
    if(!Number.isFinite(amount) || amount <= 0) return null;
    const record = readUser(username);
    record.totalPoints += amount;
    addActionCount(record, action, amount);
    record.updatedAt = new Date().toISOString();
    writeUser(username, record);
    return { totalPoints: record.totalPoints, amount, action };
  }

  function grantWalletConnection(username, chain, address){
    if(!username) return { awarded: false, reason: 'no-user', totalPoints: 0 };
    const cleanChain = String(chain || '').trim().toLowerCase();
    const cleanAddress = String(address || '').trim().toLowerCase();
    if(!cleanChain || !cleanAddress) return { awarded: false, reason: 'missing-wallet', totalPoints: readUser(username).totalPoints };
    const key = `${cleanChain}:${cleanAddress}`;
    const record = readUser(username);
    if(record.walletConnections.includes(key)){
      return { awarded: false, reason: 'already-counted', totalPoints: record.totalPoints };
    }
    record.walletConnections.push(key);
    record.totalPoints += DEFAULT_RULES.walletConnected.points;
    addActionCount(record, 'walletConnected', DEFAULT_RULES.walletConnected.points);
    record.updatedAt = new Date().toISOString();
    writeUser(username, record);
    return { awarded: true, points: DEFAULT_RULES.walletConnected.points, totalPoints: record.totalPoints };
  }

  function grantGhostCoins(username, absoluteGhostTokenCount){
    if(!username) return { awarded: false, delta: 0, totalPoints: 0 };
    const nextCount = Number(absoluteGhostTokenCount);
    if(!Number.isFinite(nextCount) || nextCount < 0){
      return { awarded: false, delta: 0, totalPoints: readUser(username).totalPoints };
    }
    const record = readUser(username);
    const previous = Number.isFinite(record.ghostTokenCount) ? record.ghostTokenCount : 0;
    const delta = Math.max(0, Math.floor(nextCount) - Math.floor(previous));
    record.ghostTokenCount = Math.floor(nextCount);
    if(delta > 0){
      const points = delta * DEFAULT_RULES.ghostCoin.points;
      record.totalPoints += points;
      addActionCount(record, 'ghostCoin', points);
      record.updatedAt = new Date().toISOString();
    }
    writeUser(username, record);
    return { awarded: delta > 0, delta, points: delta * DEFAULT_RULES.ghostCoin.points, totalPoints: record.totalPoints };
  }

  function getSummary(username){
    const record = readUser(username);
    return {
      username: username || '',
      totalPoints: record.totalPoints,
      actions: record.actions,
      walletConnections: record.walletConnections.slice(),
      ghostTokenCount: record.ghostTokenCount,
      rules: DEFAULT_RULES,
      updatedAt: record.updatedAt
    };
  }

  window.CHAINESRewards = {
    key: STORAGE_KEY,
    rules: DEFAULT_RULES,
    getSummary,
    grantPoints,
    grantWalletConnection,
    grantGhostCoins
  };
})();
