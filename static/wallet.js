(function(){
  const CARDANO_EVENT = 'cardano#initialized';

  const state = {
    overlay: null,
    appShell: null,
    walletSelect: null,
    statusEl: null,
    connectBtn: null,
    hintEl: null,
    walletBtn: null,
    config: null,
    accessGranted: false,
    availableWallets: [],
    selectedWallet: null,
    connectedApi: null,
    walletInfo: null
  };

  function hexToBytes(hex){
    const normalized = (hex || '').replace(/^0x/i, '').trim();
    if(normalized.length === 0) return new Uint8Array();
    if(normalized.length % 2 !== 0) throw new Error('Hex string has an invalid length.');
    const bytes = new Uint8Array(normalized.length / 2);
    for(let i = 0; i < normalized.length; i += 2){
      const byte = parseInt(normalized.slice(i, i + 2), 16);
      if(Number.isNaN(byte)) throw new Error('Hex string contains invalid characters.');
      bytes[i / 2] = byte;
    }
    return bytes;
  }

  function bytesToHex(bytes){
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function stringToBytes(str){
    return new TextEncoder().encode(str);
  }

  function createCborReader(bytes){
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 0;

    function ensure(length){
      if(offset + length > bytes.length){
        throw new Error('Unexpected end of CBOR data.');
      }
    }

    function readUint(additional){
      if(additional < 24) return BigInt(additional);
      if(additional === 24){
        ensure(1);
        const value = bytes[offset];
        offset += 1;
        return BigInt(value);
      }
      if(additional === 25){
        ensure(2);
        const value = view.getUint16(offset);
        offset += 2;
        return BigInt(value);
      }
      if(additional === 26){
        ensure(4);
        const value = view.getUint32(offset);
        offset += 4;
        return BigInt(value);
      }
      if(additional === 27){
        ensure(8);
        const high = view.getUint32(offset);
        const low = view.getUint32(offset + 4);
        offset += 8;
        return (BigInt(high) << 32n) + BigInt(low);
      }
      throw new Error(`Unsupported integer additional info: ${additional}`);
    }

    function readLength(additional){
      if(additional === 31) return null;
      const length = readUint(additional);
      if(length > Number.MAX_SAFE_INTEGER){
        throw new Error('CBOR length exceeds supported range.');
      }
      return Number(length);
    }

    function readBytes(additional){
      const length = readLength(additional);
      if(length === null){
        throw new Error('Indefinite byte strings are not supported.');
      }
      ensure(length);
      const slice = bytes.slice(offset, offset + length);
      offset += length;
      return slice;
    }

    function readArray(additional){
      const length = readLength(additional);
      const result = [];
      if(length === null){
        while(true){
          if(offset >= bytes.length) throw new Error('Unexpected end while reading indefinite array.');
          if(bytes[offset] === 0xff){
            offset += 1;
            break;
          }
          result.push(readValue());
        }
        return result;
      }
      for(let index = 0; index < length; index += 1){
        result.push(readValue());
      }
      return result;
    }

    function readMap(additional){
      const length = readLength(additional);
      const map = new Map();
      if(length === null){
        while(true){
          if(offset >= bytes.length) throw new Error('Unexpected end while reading indefinite map.');
          if(bytes[offset] === 0xff){
            offset += 1;
            break;
          }
          const key = readValue();
          const value = readValue();
          map.set(key, value);
        }
        return map;
      }
      for(let index = 0; index < length; index += 1){
        const key = readValue();
        const value = readValue();
        map.set(key, value);
      }
      return map;
    }

    function readTag(additional){
      const tag = readUint(additional);
      const value = readValue();
      return { tag, value };
    }

    function readSimple(additional){
      if(additional === 20) return false;
      if(additional === 21) return true;
      if(additional === 22) return null;
      if(additional === 23) return undefined;
      if(additional === 24){
        ensure(1);
        const value = bytes[offset];
        offset += 1;
        return { simple: value };
      }
      if(additional === 25){
        ensure(2);
        const value = view.getUint16(offset);
        offset += 2;
        return value;
      }
      if(additional === 26){
        ensure(4);
        const value = view.getFloat32(offset);
        offset += 4;
        return value;
      }
      if(additional === 27){
        ensure(8);
        const value = view.getFloat64(offset);
        offset += 8;
        return value;
      }
      if(additional === 31){
        throw new Error('Invalid use of CBOR break code.');
      }
      return { simple: additional };
    }

    function readValue(){
      ensure(1);
      const initial = bytes[offset];
      offset += 1;
      const major = initial >> 5;
      const additional = initial & 0x1f;
      switch(major){
        case 0:
          return readUint(additional);
        case 1:
          return -1n - readUint(additional);
        case 2:
          return readBytes(additional);
        case 3:{
          const chunk = readBytes(additional);
          return new TextDecoder().decode(chunk);
        }
        case 4:
          return readArray(additional);
        case 5:
          return readMap(additional);
        case 6:
          return readTag(additional);
        case 7:
          return readSimple(additional);
        default:
          throw new Error(`Unsupported CBOR major type: ${major}`);
      }
    }

    function finish(){
      const value = readValue();
      if(offset !== bytes.length){
        throw new Error('Unexpected trailing data after CBOR decode.');
      }
      return value;
    }

    return { finish };
  }

  function decodeCbor(bytes){
    return createCborReader(bytes).finish();
  }

  function toHexLike(value){
    if(value instanceof Uint8Array){
      return bytesToHex(value);
    }
    if(typeof value === 'string'){
      return bytesToHex(stringToBytes(value));
    }
    return null;
  }

  function toBigInt(value){
    if(typeof value === 'bigint') return value;
    if(typeof value === 'number') return BigInt(value);
    return null;
  }

  function extractMultiAsset(decoded){
    if(decoded instanceof Map) return decoded;
    if(Array.isArray(decoded)){
      if(decoded.length === 0) return null;
      if(decoded.length === 1 && decoded[0] instanceof Map) return decoded[0];
      if(decoded.length >= 2 && decoded[1] instanceof Map) return decoded[1];
    }
    if(decoded && typeof decoded === 'object' && decoded.value instanceof Map){
      return decoded.value;
    }
    return null;
  }

  function balanceHasAsset(balanceHex, policyBytes, assetBytes){
    if(typeof balanceHex !== 'string' || balanceHex.length === 0) return false;
    let decoded;
    try{
      decoded = decodeCbor(hexToBytes(balanceHex));
    }catch(err){
      console.warn('Failed to decode balance CBOR payload.', err);
      return false;
    }

    const multiAsset = extractMultiAsset(decoded);
    if(!multiAsset) return false;

    const targetPolicy = bytesToHex(policyBytes);
    const targetAsset = bytesToHex(assetBytes);

    for(const [policyKey, assets] of multiAsset.entries()){
      const policyHex = toHexLike(policyKey);
      if(policyHex !== targetPolicy) continue;
      if(!(assets instanceof Map)) continue;
      for(const [assetKey, amount] of assets.entries()){
        const assetHex = toHexLike(assetKey);
        if(assetHex !== targetAsset) continue;
        const quantity = toBigInt(amount);
        if(quantity !== null && quantity > 0n){
          return true;
        }
      }
    }

    return false;
  }

  function setStatus(message, tone = 'info', opts = {}){
    if(!state.statusEl) return;
    if(opts.skipIfError && state.statusEl.dataset.tone === 'error') return;
    state.statusEl.textContent = message || '';
    if(tone === 'info' || !message){
      delete state.statusEl.dataset.tone;
    }else{
      state.statusEl.dataset.tone = tone;
    }
  }

  function lockApp(){
    document.body.classList.add('auth-lock');
    if(state.appShell){
      state.appShell.setAttribute('aria-hidden', 'true');
      state.appShell.setAttribute('inert', '');
    }
  }

  function unlockApp(){
    document.body.classList.remove('auth-lock');
    if(state.appShell){
      state.appShell.removeAttribute('aria-hidden');
      state.appShell.removeAttribute('inert');
    }
  }

  function hideOverlay(){
    if(!state.overlay) return;
    state.overlay.classList.add('token-gate--hidden');
    state.overlay.setAttribute('aria-hidden', 'true');
    unlockApp();
  }

  function showOverlay(){
    if(!state.overlay) return;
    state.overlay.classList.remove('token-gate--hidden');
    state.overlay.removeAttribute('aria-hidden');
    lockApp();
  }

  function parseConfig(){
    if(!state.overlay) return { valid: false, error: 'Token gate element not found.' };
    const policyId = (state.overlay.dataset.policyId || '').trim();
    const assetName = (state.overlay.dataset.assetName || '').trim();
    const assetNameHex = (state.overlay.dataset.assetNameHex || '').trim();

    if(!policyId){
      return { valid: false, error: 'Token gate not configured. Set data-policy-id on #token-gate.' };
    }

    let policyBytes;
    try{
      policyBytes = hexToBytes(policyId);
    }catch(err){
      return { valid: false, error: 'Policy ID must be a valid hex string.' };
    }

    let assetBytes;
    let assetLabel = assetName;
    if(assetNameHex){
      try{
        assetBytes = hexToBytes(assetNameHex);
      }catch(err){
        return { valid: false, error: 'Asset name hex must be a valid hex string.' };
      }
      assetLabel = assetLabel || `0x${assetNameHex}`;
    }else if(assetName){
      assetBytes = stringToBytes(assetName);
    }

    if(!assetBytes || assetBytes.length === 0){
      return { valid: false, error: 'Token gate not configured. Provide data-asset-name or data-asset-name-hex.' };
    }

    if(assetBytes.length > 32){
      return { valid: false, error: 'Asset name must be 32 bytes or fewer.' };
    }

    return {
      valid: true,
      policyId,
      policyBytes,
      assetName,
      assetNameHex,
      assetBytes,
      assetLabel: assetLabel || `0x${bytesToHex(assetBytes)}`
    };
  }

  function describeRequiredToken(){
    if(!state.hintEl || !state.config || !state.config.valid) return;
    const parts = [];
    if(state.config.policyId){
      parts.push(`Policy ID: ${state.config.policyId}`);
    }
    if(state.config.assetLabel){
      parts.push(`Asset: ${state.config.assetLabel}`);
    }
    state.hintEl.textContent = parts.length ? `Required token → ${parts.join(' · ')}` : state.hintEl.textContent;
  }

  function getAvailableWallets(){
    const provider = window.cardano;
    if(!provider) return [];
    return Object.entries(provider)
      .filter(([key, wallet]) => {
        if(key === 'hw' || key === 'namiObject' || key === '__zone_symbol__state') return false;
        return wallet && typeof wallet === 'object' && typeof wallet.enable === 'function';
      })
      .map(([key, wallet]) => ({
        key,
        name: wallet.name || key,
        icon: wallet.icon || null,
        apiVersion: wallet.apiVersion || '1.0'
      }));
  }

  function updateWalletSelect(){
    if(!state.walletSelect) return;
    const wallets = getAvailableWallets();
    const previous = state.walletSelect.value;
    state.walletSelect.innerHTML = '';
    state.availableWallets = wallets;

    if(wallets.length === 0){
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No CIP-30 wallets detected';
      option.disabled = true;
      option.selected = true;
      state.walletSelect.appendChild(option);
      setStatus('Install or enable a Cardano CIP-30 wallet extension to continue.', 'info', { skipIfError: true });
      if(state.connectBtn && !state.accessGranted){
        state.connectBtn.disabled = true;
      }
      return;
    }

    wallets.forEach(wallet => {
      const option = document.createElement('option');
      option.value = wallet.key;
      option.textContent = wallet.name;
      option.dataset.version = wallet.apiVersion;
      state.walletSelect.appendChild(option);
    });

    if(previous && wallets.some(w => w.key === previous)){
      state.walletSelect.value = previous;
    }

    if(!state.walletSelect.value && wallets[0]){
      state.walletSelect.value = wallets[0].key;
    }

    if(state.connectBtn && !state.accessGranted){
      state.connectBtn.disabled = !state.config || !state.config.valid;
    }

    if(state.config && state.config.valid && !state.accessGranted){
      setStatus('Wallet detected. Connect to verify token ownership.', 'info', { skipIfError: true });
    }
  }

  async function verifyToken(api){
    if(!state.config || !state.config.valid){
      throw new Error('Token gate is not configured.');
    }
    const balanceHex = await api.getBalance();
    return balanceHasAsset(balanceHex, state.config.policyBytes, state.config.assetBytes);
  }

  function recordSelection(walletKey){
    state.selectedWallet = walletKey;
  }

  function onAccessGranted(walletInfo){
    state.accessGranted = true;
    recordSelection(walletInfo.key);
    state.walletInfo = walletInfo;
    setStatus(`Access granted with ${walletInfo.name}.`, 'success');
    hideOverlay();
    if(state.connectBtn){
      state.connectBtn.disabled = true;
    }
    if(state.walletBtn){
      state.walletBtn.classList.add('wallet-connected');
      state.walletBtn.setAttribute('title', `Connected wallet: ${walletInfo.name}`);
      state.walletBtn.setAttribute('aria-label', `Connected wallet: ${walletInfo.name}`);
    }
  }

  async function connectAndValidate(){
    if(state.accessGranted) return;
    if(!state.config || !state.config.valid){
      setStatus(state.config ? state.config.error : 'Token gate is not configured.', 'error');
      return;
    }
    const wallets = state.availableWallets.length ? state.availableWallets : getAvailableWallets();
    if(wallets.length === 0){
      setStatus('No compatible wallets available. Install or enable a Cardano wallet.', 'error');
      updateWalletSelect();
      return;
    }
    const walletKey = (state.walletSelect && state.walletSelect.value) || wallets[0].key;
    const walletInfo = wallets.find(w => w.key === walletKey) || wallets[0];
    if(!walletInfo){
      setStatus('Select a wallet to continue.', 'error');
      return;
    }

    try{
      setStatus(`Connecting to ${walletInfo.name}…`);
      if(state.connectBtn) state.connectBtn.disabled = true;
      const wallet = window.cardano && window.cardano[walletInfo.key];
      if(!wallet || typeof wallet.enable !== 'function'){
        throw new Error('Selected wallet is no longer available.');
      }
      const api = await wallet.enable();
      state.connectedApi = api;
      setStatus('Checking token balance…');
      const hasToken = await verifyToken(api);
      if(!hasToken){
        setStatus('Wallet connected but required token was not found.', 'error');
        if(state.connectBtn && !state.accessGranted){
          state.connectBtn.disabled = false;
        }
        return;
      }
      onAccessGranted(walletInfo);
    }catch(err){
      console.error('Wallet connection failed', err);
      const message = err && err.message ? err.message : 'Wallet connection failed.';
      setStatus(`Wallet connection failed: ${message}`, 'error');
      if(state.connectBtn && !state.accessGranted){
        state.connectBtn.disabled = false;
      }
    }
  }

  function handleWalletButton(){
    if(state.accessGranted){
      const name = state.walletInfo ? state.walletInfo.name : 'your wallet';
      setStatus(`Access already granted with ${name}.`, 'success');
      return;
    }
    showOverlay();
  }

  function init(){
    state.overlay = document.getElementById('token-gate');
    state.appShell = document.querySelector('.wrap');
    state.walletSelect = document.getElementById('token-gate-wallet');
    state.statusEl = document.getElementById('token-gate-status');
    state.connectBtn = document.getElementById('token-gate-connect');
    state.hintEl = state.overlay ? state.overlay.querySelector('.token-gate__hint') : null;
    state.walletBtn = document.getElementById('wallet-btn');

    if(!state.overlay){
      return;
    }

    lockApp();
    state.config = parseConfig();
    if(!state.config.valid){
      setStatus(state.config.error, 'error');
      if(state.connectBtn) state.connectBtn.disabled = true;
    }else{
      describeRequiredToken();
    }

    if(state.connectBtn){
      state.connectBtn.addEventListener('click', connectAndValidate);
    }

    if(state.walletBtn){
      state.walletBtn.addEventListener('click', handleWalletButton);
    }

    if(state.walletSelect){
      state.walletSelect.addEventListener('change', event => {
        recordSelection(event.target.value);
      });
    }

    updateWalletSelect();
    window.addEventListener(CARDANO_EVENT, updateWalletSelect);

    let attempts = 0;
    const discoverInterval = setInterval(() => {
      if(state.accessGranted || attempts > 15){
        clearInterval(discoverInterval);
        return;
      }
      attempts += 1;
      updateWalletSelect();
      if(state.availableWallets.length > 0){
        clearInterval(discoverInterval);
      }
    }, 1500);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
