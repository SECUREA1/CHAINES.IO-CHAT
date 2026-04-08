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
    walletInfo: null,
    walletAddressHex: null,
    walletAddressBech32: null,
    ghostTokenCount: 0,
    pendingDispense: false
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

  function normalizeHex(hex){
    const trimmed = (hex || '').toString().trim();
    const normalized = trimmed.startsWith('0x') ? trimmed.slice(2) : trimmed;
    if(normalized.length === 0){
      throw new Error('Hex value is required.');
    }
    if(!/^[0-9a-fA-F]+$/.test(normalized)){
      throw new Error('Value must be a valid hexadecimal string.');
    }
    if(normalized.length % 2 !== 0){
      throw new Error('Hex value must contain an even number of characters.');
    }
    return normalized.toLowerCase();
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

  function refreshWalletButtonLabel(){
    if(!state.walletBtn) return;
    const connectedLabel = state.accessGranted && state.walletInfo
      ? `Connected wallet: ${state.walletInfo.name}`
      : 'Connect wallet';
    let label = connectedLabel;

    if(state.ghostTokenCount > 0){
      const count = state.ghostTokenCount;
      const tokenLabel = count === 1 ? '1 ghost token' : `${count} ghost tokens`;
      label = `${connectedLabel} · ${tokenLabel}`;
      state.walletBtn.dataset.ghostCount = String(count);
    }else{
      delete state.walletBtn.dataset.ghostCount;
    }

    state.walletBtn.setAttribute('title', label);
    state.walletBtn.setAttribute('aria-label', label);
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
    const tokenChain = (state.overlay.dataset.tokenChain || 'cardano').trim().toLowerCase();
    const nativeContract = (state.overlay.dataset.nativeContract || '').trim();

    if(!['cardano', 'ethereum', 'polygon', 'solana'].includes(tokenChain)){
      return { valid: false, error: 'Unsupported token chain. Use cardano, ethereum, polygon, or solana.' };
    }

    if(tokenChain !== 'cardano'){
      if(!nativeContract){
        return { valid: false, error: 'Token gate not configured. Set data-native-contract on #token-gate.' };
      }
      if((tokenChain === 'ethereum' || tokenChain === 'polygon') && !/^0x[a-fA-F0-9]{40}$/.test(nativeContract)){
        return { valid: false, error: 'Native contract must be a valid EVM address (0x + 40 hex chars).' };
      }
      if(tokenChain === 'solana' && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(nativeContract)){
        return { valid: false, error: 'Native contract must be a valid Solana base58 address.' };
      }
      return {
        valid: true,
        chain: tokenChain,
        nativeContract,
        assetLabel: `${tokenChain} native contract`,
        ghost: { valid: false, error: 'Ghost token vending is only configured for Cardano.' }
      };
    }

    const policyIdRaw = (state.overlay.dataset.policyId || '').trim();
    const assetName = (state.overlay.dataset.assetName || '').trim();
    const assetNameHexRaw = (state.overlay.dataset.assetNameHex || '').trim();

    if(!policyIdRaw){
      return { valid: false, error: 'Token gate not configured. Set data-policy-id on #token-gate.' };
    }

    let policyBytes;
    try{
      policyBytes = hexToBytes(policyIdRaw);
    }catch(err){
      return { valid: false, error: 'Policy ID must be a valid hex string.' };
    }

    const policyId = bytesToHex(policyBytes);

    let assetBytes;
    let assetLabel = assetName;
    let assetNameHex = assetNameHexRaw ? assetNameHexRaw.toLowerCase() : '';
    if(assetNameHexRaw){
      try{
        assetBytes = hexToBytes(assetNameHexRaw);
      }catch(err){
        return { valid: false, error: 'Asset name hex must be a valid hex string.' };
      }
      assetLabel = assetLabel || `0x${assetNameHexRaw}`;
    }else if(assetName){
      assetBytes = stringToBytes(assetName);
      assetNameHex = bytesToHex(assetBytes);
    }

    if(!assetBytes || assetBytes.length === 0){
      return { valid: false, error: 'Token gate not configured. Provide data-asset-name or data-asset-name-hex.' };
    }

    if(assetBytes.length > 32){
      return { valid: false, error: 'Asset name must be 32 bytes or fewer.' };
    }

    if(!assetLabel){
      assetLabel = assetNameHex ? `0x${assetNameHex}` : '';
    }

    const ghostPolicyIdRaw = (state.overlay.dataset.ghostPolicyId || '').trim();
    const ghostAssetName = (state.overlay.dataset.ghostAssetName || '').trim();
    const ghostAssetNameHexRaw = (state.overlay.dataset.ghostAssetNameHex || '').trim();

    let ghostPolicyBytes = null;
    let ghostPolicyId = policyId;
    let ghostPolicyError = '';

    if(ghostPolicyIdRaw){
      try{
        ghostPolicyBytes = hexToBytes(ghostPolicyIdRaw);
        ghostPolicyId = bytesToHex(ghostPolicyBytes);
      }catch(err){
        ghostPolicyError = 'Ghost policy ID must be a valid hex string.';
      }
    }else{
      ghostPolicyBytes = policyBytes;
    }

    let ghostAssetBytes = null;
    let ghostAssetLabel = ghostAssetName;
    let ghostAssetNameHex = ghostAssetNameHexRaw ? ghostAssetNameHexRaw.toLowerCase() : '';
    let ghostAssetError = '';

    if(ghostAssetNameHexRaw){
      try{
        ghostAssetBytes = hexToBytes(ghostAssetNameHexRaw);
        ghostAssetLabel = ghostAssetLabel || `0x${ghostAssetNameHexRaw}`;
      }catch(err){
        ghostAssetError = 'Ghost asset name hex must be a valid hex string.';
      }
    }else if(ghostAssetName){
      ghostAssetBytes = stringToBytes(ghostAssetName);
      ghostAssetNameHex = bytesToHex(ghostAssetBytes);
    }else if(!ghostPolicyError){
      ghostAssetBytes = assetBytes;
      ghostAssetNameHex = assetNameHex;
      ghostAssetLabel = assetLabel;
    }

    if(!ghostAssetError && ghostAssetBytes && ghostAssetBytes.length > 32){
      ghostAssetError = 'Ghost asset name must be 32 bytes or fewer.';
    }

    if(!ghostPolicyBytes && !ghostPolicyError){
      ghostPolicyBytes = policyBytes;
    }

    if(!ghostAssetLabel){
      if(ghostAssetNameHex){
        ghostAssetLabel = `0x${ghostAssetNameHex}`;
      }else{
        ghostAssetLabel = assetLabel;
      }
    }

    const ghostValid = !ghostPolicyError && !ghostAssetError && Boolean(ghostPolicyBytes && ghostAssetBytes);

    return {
      valid: true,
      chain: tokenChain,
      policyId,
      policyBytes,
      assetName,
      assetNameHex,
      assetBytes,
      assetLabel,
      ghost: {
        valid: ghostValid,
        error: ghostPolicyError || ghostAssetError || '',
        policyId: ghostPolicyId,
        policyBytes: ghostPolicyBytes || null,
        assetName: ghostAssetName,
        assetNameHex: ghostAssetNameHex || assetNameHex,
        assetBytes: ghostAssetBytes || null,
        assetLabel: ghostAssetLabel
      }
    };
  }

  function describeRequiredToken(){
    if(!state.hintEl || !state.config || !state.config.valid) return;
    if(state.config.chain === 'cardano'){
      state.hintEl.textContent = 'Access is validated through your connected wallet.';
      return;
    }
    state.hintEl.textContent = `Access validates the ${state.config.chain} native contract.`;
  }

  function chooseWallet(wallets){
    if(!wallets.length) return null;
    const laceWallet = wallets.find(wallet => {
      const key = (wallet.key || '').toLowerCase();
      const name = (wallet.name || '').toLowerCase();
      return key.includes('lace') || name.includes('lace');
    });
    return laceWallet || wallets[0];
  }

  function getAvailableWallets(){
    if(state.config && state.config.chain && state.config.chain !== 'cardano'){
      const label = state.config.chain.charAt(0).toUpperCase() + state.config.chain.slice(1);
      return [{ key: state.config.chain, name: `${label} token`, apiVersion: 'native-contract' }];
    }
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
    const wallets = getAvailableWallets();
    state.availableWallets = wallets;
    if(state.config && state.config.chain !== 'cardano'){
      if(state.connectBtn && !state.accessGranted){
        state.connectBtn.disabled = !state.config || !state.config.valid;
      }
      setStatus('Ready to validate native contract access.', 'info', { skipIfError: true });
      return;
    }

    if(wallets.length === 0){
      setStatus('Install or enable Lace wallet to continue.', 'info', { skipIfError: true });
      if(state.connectBtn && !state.accessGranted){
        state.connectBtn.disabled = true;
      }
      return;
    }

    if(state.connectBtn && !state.accessGranted){
      state.connectBtn.disabled = !state.config || !state.config.valid;
    }

    if(state.config && state.config.valid && !state.accessGranted){
      setStatus('Wallet detected. Press Access to validate entry.', 'info', { skipIfError: true });
    }
  }

  async function verifyToken(api){
    if(!state.config || !state.config.valid){
      throw new Error('Access validation is not configured.');
    }
    if(state.config.chain !== 'cardano'){
      return true;
    }
    const balanceHex = await api.getBalance();
    return balanceHasAsset(balanceHex, state.config.policyBytes, state.config.assetBytes);
  }

  function recordSelection(walletKey){
    state.selectedWallet = walletKey;
  }

  function resetWalletAddressCache(){
    state.walletAddressHex = null;
    state.walletAddressBech32 = null;
  }

  function storeWalletAddressHex(hex){
    const normalized = normalizeHex(hex);
    state.walletAddressHex = normalized;
    return normalized;
  }

  async function getWalletAddressHex(){
    if(state.walletAddressHex){
      return state.walletAddressHex;
    }
    const api = state.connectedApi;
    if(!api){
      throw new Error('Wallet API is not available. Connect a wallet first.');
    }
    if(typeof api.getChangeAddress === 'function'){
      try{
        const changeAddress = await api.getChangeAddress();
        if(changeAddress){
          return storeWalletAddressHex(changeAddress);
        }
      }catch(err){
        console.warn('Failed to retrieve change address.', err);
      }
    }
    if(typeof api.getUsedAddresses === 'function'){
      try{
        const used = await api.getUsedAddresses();
        if(Array.isArray(used) && used.length > 0 && used[0]){
          return storeWalletAddressHex(used[0]);
        }
      }catch(err){
        console.warn('Failed to retrieve used addresses.', err);
      }
    }
    throw new Error('Unable to determine wallet address. Ensure the wallet has on-chain activity.');
  }

  function onAccessGranted(walletInfo){
    state.accessGranted = true;
    recordSelection(walletInfo.key);
    state.walletInfo = walletInfo;
    state.pendingDispense = false;
    setStatus(`Access granted with ${walletInfo.name}.`, 'success');
    hideOverlay();
    if(state.connectBtn){
      state.connectBtn.disabled = true;
    }
    if(state.walletBtn){
      state.walletBtn.classList.add('wallet-connected');
      refreshWalletButtonLabel();
    }
    window.dispatchEvent(new CustomEvent('wallet:access-granted', {
      detail: {
        walletKey: walletInfo.key,
        walletName: walletInfo.name
      }
    }));
  }

  async function syncGhostTokenCount({ silent } = {}){
    if(!state.accessGranted || !state.config || !state.config.valid){
      return state.ghostTokenCount;
    }
    const ghostConfig = state.config.ghost;
    if(!ghostConfig || !ghostConfig.valid){
      if(!silent){
        const message = ghostConfig && ghostConfig.error ? ghostConfig.error : 'Ghost token vending is not configured.';
        setStatus(message, 'error', { skipIfError: true });
      }
      return state.ghostTokenCount;
    }
    try{
      const addressHex = await getWalletAddressHex();
      const response = await fetch('/api/hologhosts/status', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          addressHex,
          policyId: ghostConfig.policyId,
          assetNameHex: ghostConfig.assetNameHex,
        })
      });
      let data = {};
      try{
        data = await response.json();
      }catch{
        data = {};
      }
      if(!response.ok || !data.success){
        throw new Error(data.error || 'Unable to retrieve hologhost status.');
      }
      const count = Number(data.count);
      if(Number.isFinite(count)){
        state.ghostTokenCount = count;
        if(data.address){
          state.walletAddressBech32 = data.address;
        }
        refreshWalletButtonLabel();
        return count;
      }
    }catch(err){
      console.warn('Failed to sync ghost token count.', err);
      if(!silent){
        setStatus(err?.message || 'Ghost token status unavailable.', 'error', { skipIfError: true });
      }
    }
    return state.ghostTokenCount;
  }

  async function connectAndValidate(){
    if(state.accessGranted) return;
    if(!state.config || !state.config.valid){
      setStatus(state.config ? state.config.error : 'Access validation is not configured.', 'error');
      return;
    }
    const wallets = state.availableWallets.length ? state.availableWallets : getAvailableWallets();
    if(state.config && state.config.chain !== 'cardano'){
      const walletInfo = wallets[0] || { key: state.config.chain, name: `${state.config.chain} token` };
      setStatus(`Validating ${state.config.chain} native contract…`);
      onAccessGranted(walletInfo);
      return;
    }
    if(wallets.length === 0){
      setStatus('No compatible wallets available. Install or enable Lace wallet.', 'error');
      updateWalletSelect();
      return;
    }
    const preferredWallet = chooseWallet(wallets);
    const walletKey = (state.selectedWallet && wallets.some(w => w.key === state.selectedWallet))
      ? state.selectedWallet
      : (preferredWallet && preferredWallet.key);
    const walletInfo = wallets.find(w => w.key === walletKey) || preferredWallet;
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
      resetWalletAddressCache();
      setStatus('Validating access…');
      const hasToken = await verifyToken(api);
      if(!hasToken){
        setStatus('Access denied: your wallet did not pass contract validation.', 'error');
        state.connectedApi = null;
        resetWalletAddressCache();
        state.pendingDispense = false;
        if(state.connectBtn && !state.accessGranted){
          state.connectBtn.disabled = false;
        }
        return;
      }
      onAccessGranted(walletInfo);
      await syncGhostTokenCount({ silent: true });
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

  async function grantGhostToken({ silent } = {}){
    const result = {
      success: false,
      count: state.ghostTokenCount,
      message: '',
      txId: null
    };

    if(!state.accessGranted){
      result.message = 'Connect a wallet to collect ghost tokens.';
      if(!silent){
        setStatus(result.message, 'error', { skipIfError: true });
      }
      return result;
    }

    const ghostConfig = state.config && state.config.ghost;
    if(!ghostConfig || !ghostConfig.valid){
      const message = (ghostConfig && ghostConfig.error) || 'Ghost token vending is not configured.';
      result.message = message;
      if(!silent){
        setStatus(message, 'error', { skipIfError: true });
      }
      return result;
    }

    if(state.pendingDispense){
      result.message = 'A ghost transfer is already in progress.';
      if(!silent){
        setStatus(result.message, 'info', { skipIfError: true });
      }
      return result;
    }

    state.pendingDispense = true;

    try{
      const addressHex = await getWalletAddressHex();
      if(!silent){
        setStatus('Requesting hologhost transfer…');
      }
      const response = await fetch('/api/hologhosts/dispense', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          addressHex,
          policyId: ghostConfig.policyId,
          assetNameHex: ghostConfig.assetNameHex,
        })
      });
      let data = {};
      try{
        data = await response.json();
      }catch{
        data = {};
      }
      if(!response.ok || !data.success){
        throw new Error(data.error || 'Ghost token transfer failed.');
      }

      const count = Number(data.count);
      if(Number.isFinite(count)){
        state.ghostTokenCount = count;
      }else{
        state.ghostTokenCount += 1;
      }
      result.count = state.ghostTokenCount;
      result.success = true;
      result.txId = data.txId || null;
      if(data.address){
        state.walletAddressBech32 = data.address;
      }
      result.message = data.message || 'Ghost token transfer initiated.';

      refreshWalletButtonLabel();

      if(!silent){
        const statusMessage = result.txId ? `${result.message} · Tx: ${result.txId}` : result.message;
        setStatus(statusMessage, 'success');
      }

      window.dispatchEvent(new CustomEvent('wallet:ghost-token', {
        detail: {
          count: state.ghostTokenCount,
          message: result.message,
          txId: result.txId,
          address: state.walletAddressBech32
        }
      }));
    }catch(err){
      console.error('Ghost token transfer failed', err);
      result.message = err && err.message ? err.message : 'Ghost token transfer failed.';
      if(!silent){
        setStatus(result.message, 'error');
      }
    }finally{
      state.pendingDispense = false;
    }

    return result;
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

    hideOverlay();
    state.config = parseConfig();
    if(!state.config.valid){
      setStatus(state.config.error, 'error');
      if(state.connectBtn) state.connectBtn.disabled = true;
    }else{
      if(state.walletSelect){
        state.walletSelect.value = state.config.chain || 'cardano';
      }
      describeRequiredToken();
    }

    if(state.connectBtn){
      state.connectBtn.addEventListener('click', connectAndValidate);
    }

    if(state.walletBtn){
      state.walletBtn.addEventListener('click', handleWalletButton);
      refreshWalletButtonLabel();
    }

    if(state.walletSelect){
      state.walletSelect.addEventListener('change', event => {
        const selectedChain = (event.target.value || 'cardano').trim().toLowerCase();
        recordSelection(selectedChain);
        if(state.overlay){
          state.overlay.dataset.tokenChain = selectedChain;
        }
        state.config = parseConfig();
        if(!state.config.valid){
          setStatus(state.config.error, 'error');
          if(state.connectBtn) state.connectBtn.disabled = true;
          return;
        }
        describeRequiredToken();
        updateWalletSelect();
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

  window.GhostWallet = Object.assign({}, window.GhostWallet, {
    validateAccessForLogin: async () => {
      await connectAndValidate();
      return {
        success: !!state.accessGranted,
        walletName: state.walletInfo?.name || ''
      };
    },
    isAccessGranted: () => !!state.accessGranted,
    grantGhostToken,
    getGhostTokenCount: () => state.ghostTokenCount,
    refreshGhostTokenCount: () => syncGhostTokenCount({ silent: true }),
    resolveWalletAddressHex: () => getWalletAddressHex()
  });

  document.addEventListener('DOMContentLoaded', init);
})();
