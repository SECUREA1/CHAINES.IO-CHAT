(function(){
  const CSL_SCRIPT_URL = 'https://unpkg.com/@emurgo/cardano-serialization-lib-browser@11.4.0/cardano_serialization_lib.js';
  const CSL_MODULE_URL = `${CSL_SCRIPT_URL}?module`;
  const CARDANO_EVENT = 'cardano#initialized';
  let serializationLibPromise = null;

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

  const CSL_WASM_URL = CSL_SCRIPT_URL.replace(/cardano_serialization_lib\.js(?:\?.*)?$/, 'cardano_serialization_lib_bg.wasm');

  function normalizeSerializationLib(candidate){
    if(!candidate || typeof candidate !== 'object') return null;
    const lib = candidate.CardanoWasm || candidate.default || candidate;
    if(
      lib && typeof lib === 'object' &&
      typeof lib.Value === 'function' &&
      typeof lib.MultiAsset === 'function' &&
      typeof lib.AssetName === 'function'
    ){
      return lib;
    }
    return null;
  }

  function isPromiseLike(value){
    return value && (typeof value === 'object' || typeof value === 'function') && typeof value.then === 'function';
  }

  async function resolveSerializationLibCandidate(candidate, seen = new Set()){
    if(!candidate || seen.has(candidate)) return null;
    seen.add(candidate);

    const normalized = normalizeSerializationLib(candidate);
    if(normalized) return normalized;

    if(candidate && typeof candidate === 'object'){
      if(candidate.CardanoWasm && !seen.has(candidate.CardanoWasm)){
        const lib = await resolveSerializationLibCandidate(candidate.CardanoWasm, seen);
        if(lib) return lib;
      }
      if(candidate.default && !seen.has(candidate.default)){
        const lib = await resolveSerializationLibCandidate(candidate.default, seen);
        if(lib) return lib;
      }
      if(typeof candidate.load === 'function'){
        try{
          const loaded = await candidate.load();
          const lib = await resolveSerializationLibCandidate(loaded, seen);
          if(lib) return lib;
        }catch(err){
          console.warn('Failed to load Cardano serialization library via load() helper.', err);
        }
      }
    }

    if(typeof candidate === 'function'){
      try{
        const result = candidate();
        const lib = await resolveSerializationLibCandidate(result, seen);
        if(lib) return lib;
      }catch(err){
        console.warn('Cardano serialization library function invocation without arguments failed.', err);
      }

      try{
        const resultWithUrl = candidate(CSL_WASM_URL);
        const lib = await resolveSerializationLibCandidate(resultWithUrl, seen);
        if(lib) return lib;
      }catch(err){
        console.warn('Cardano serialization library function invocation with WASM URL failed.', err);
      }
    }

    if(isPromiseLike(candidate)){
      try{
        const resolved = await candidate;
        return await resolveSerializationLibCandidate(resolved, seen);
      }catch(err){
        console.warn('Cardano serialization library promise rejected.', err);
      }
    }

    return null;
  }

  function loadViaScriptTag(){
    const attemptResolve = () => resolveSerializationLibCandidate(window.CardanoWasm || window.Cardano || window.CardanoSerializationLib);

    return attemptResolve().then(existingLib => {
      if(existingLib){
        window.CardanoWasm = existingLib;
        return existingLib;
      }

      return new Promise((resolve, reject) => {
        const handleScript = scriptEl => {
          let settled = false;

          const cleanup = () => {
            scriptEl.removeEventListener('load', onLoad);
            scriptEl.removeEventListener('error', onError);
          };

          async function onLoad(){
            if(settled) return;
            try{
              const lib = await attemptResolve();
              if(lib){
                settled = true;
                cleanup();
                scriptEl.dataset.cslLoaded = 'true';
                window.CardanoWasm = lib;
                resolve(lib);
                return;
              }
              settled = true;
              cleanup();
              reject(new Error('Cardano serialization library loaded but did not expose the expected API.'));
            }catch(err){
              settled = true;
              cleanup();
              reject(err);
            }
          }

          function onError(){
            if(settled) return;
            settled = true;
            cleanup();
            reject(new Error('Cardano serialization library script failed to load.'));
          }

          scriptEl.addEventListener('load', onLoad);
          scriptEl.addEventListener('error', onError);

          if(scriptEl.readyState === 'complete' || scriptEl.dataset.cslLoaded === 'true'){
            onLoad();
          }
        };

        const existingScript = document.querySelector('script[data-csl-loader="true"]');
        if(existingScript){
          handleScript(existingScript);
          return;
        }

        const script = document.createElement('script');
        script.src = CSL_SCRIPT_URL;
        script.async = true;
        script.dataset.cslLoader = 'true';
        handleScript(script);
        document.head.appendChild(script);
      });
    });
  }

  async function importSerializationLib(){
    const existingLib = await resolveSerializationLibCandidate(window.CardanoWasm || window.Cardano || window.CardanoSerializationLib);
    if(existingLib){
      window.CardanoWasm = existingLib;
      return existingLib;
    }

    try{
      const module = await import(/* @vite-ignore */ CSL_MODULE_URL);
      const lib = await resolveSerializationLibCandidate(module);
      if(lib){
        window.CardanoWasm = lib;
        return lib;
      }
      console.warn('Cardano serialization library module loaded without the expected exports. Falling back to script tag.');
    }catch(err){
      console.warn('Failed to import Cardano serialization library as an ES module. Falling back to script tag.', err);
    }

    return loadViaScriptTag();
  }

  function loadSerializationLib(){
    if(serializationLibPromise) return serializationLibPromise;
    serializationLibPromise = importSerializationLib().catch(err => {
      serializationLibPromise = null;
      throw err;
    });
    return serializationLibPromise;
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
    const CSL = await loadSerializationLib();
    const balanceHex = await api.getBalance();
    if(typeof balanceHex !== 'string' || balanceHex.length === 0){
      return false;
    }
    const balance = CSL.Value.from_bytes(hexToBytes(balanceHex));
    const multiAsset = balance.multiasset();
    if(!multiAsset) return false;

    const policyHash = CSL.ScriptHash.from_bytes(state.config.policyBytes);
    const assets = multiAsset.get(policyHash);
    if(!assets) return false;

    const assetName = CSL.AssetName.new(state.config.assetBytes);
    const amount = assets.get(assetName);
    if(!amount) return false;

    const zero = CSL.BigNum.from_str('0');
    return amount.compare(zero) > 0;
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
