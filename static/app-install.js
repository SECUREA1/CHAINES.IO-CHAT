/* Native install prompt where supported; explicit Apple/browser instructions elsewhere. */
(() => {
  let promptEvent = null;
  const isAppleMobile = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isMac = !isAppleMobile && /Mac/.test(navigator.platform);
  const appDisplay = matchMedia('(display-mode: standalone), (display-mode: window-controls-overlay)');
  const standalone = () => appDisplay.matches || navigator.standalone === true;
  let dialog;
  function buttons() { return [...document.querySelectorAll('#install-app-btn, #auth-install-app-btn, [data-install-app]')]; }
  function update() {
    document.documentElement.dataset.appMode = standalone() ? 'installed' : 'browser';
    document.documentElement.dataset.windowControls = navigator.windowControlsOverlay?.visible ? 'visible' : 'hidden';
    buttons().forEach(button => {
      button.hidden = standalone();
      const label = isAppleMobile ? 'Add to Home Screen' : isMac ? 'Install on Mac' : 'Download app';
      button.replaceChildren();
      const icon = document.createElement('img'); icon.src = '/static/brand/v2/logo.svg'; icon.alt = ''; icon.width = 24; icon.height = 24;
      const copy = document.createElement('span'); copy.textContent = label;
      button.append(icon, copy); button.title = `${label} · CHAINeS POST`; button.setAttribute('aria-label', `${label} · CHAINeS POST`);
    });
    document.querySelector('#app-download-card')?.classList.toggle('is-installed', standalone());
    const appCopy = document.querySelector('#app-download-card .app-download-card__copy span');
    if(appCopy) appCopy.textContent = standalone() ? 'Your CHAINeS app is ready. Create, share, stream, and discover.' : 'Install the full CHAINeS experience with the new logo in its own app window.';
  }
  function showGuide() {
    if (!dialog) {
      dialog = document.createElement('dialog'); dialog.className = 'brand-dialog'; dialog.setAttribute('aria-labelledby', 'install-guide-title');
      const heading = document.createElement('div'); heading.className = 'brand-dialog__heading';
      const title = document.createElement('h2'); title.id = 'install-guide-title'; title.textContent = 'Install CHAINeS POST';
      const close = document.createElement('button'); close.type = 'button'; close.textContent = 'Close'; close.addEventListener('click', () => dialog.close());
      const mark = document.createElement('img'); mark.src = '/static/brand/v2/logo.svg'; mark.alt = ''; mark.width = 36; mark.height = 36;
      heading.append(mark, title, close); dialog.append(heading);
      const identity = document.createElement('div'); identity.className = 'install-preview';
      const artwork = document.createElement('img'); artwork.src = '/static/brand/v2/logo.svg'; artwork.alt = 'CHAINeS POST app icon'; artwork.width = 72; artwork.height = 72;
      const intro = document.createElement('div'); const name = document.createElement('strong'); name.textContent = 'CHAINeS POST';
      const tagline = document.createElement('p'); tagline.textContent = 'Create. Share. Stream. Discover.'; intro.append(name, tagline); identity.append(artwork, intro); dialog.append(identity);
      const features = document.createElement('p'); features.className = 'install-features'; features.textContent = 'Community feed · Live broadcasts · Marketplace · Wallets'; dialog.append(features);
      const note = document.createElement('p'); note.textContent = 'Add the CHAINeS web app with its new logo to your device. Installation requires a secure HTTPS connection.'; dialog.append(note);
      const steps = document.createElement('ol');
      const instructions = isAppleMobile ? ['Open this site in Safari on your iPhone or iPad.', 'Tap Share (the square with an arrow), then Add to Home Screen. You may need to scroll the Share menu.', 'Keep Open as Web App enabled if shown, then tap Add. Launch CHAINeS from its home screen icon.'] : isMac ? ['Open this site in Safari on macOS Sonoma or later.', 'Choose File → Add to Dock, then click Add.', 'Open CHAINeS from the Dock. In Chrome or Edge, use the browser’s Install app option instead.'] : ['Open this site in Chrome or Edge.', 'Choose Install app or Add to Home screen from the browser menu or address bar.', 'Confirm installation and open CHAINeS from your device’s apps.'];
      instructions.forEach(text => { const li = document.createElement('li'); li.textContent = text; steps.append(li); }); dialog.append(steps); document.body.append(dialog);
    }
    dialog.showModal();
  }
  async function install() {
    if (!promptEvent) { showGuide(); return; }
    const event = promptEvent; promptEvent = null;
    try { await event.prompt(); const choice = await event.userChoice; if (choice.outcome === 'accepted') buttons().forEach(button => button.hidden = true); else update(); } catch { showGuide(); }
  }
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); promptEvent = event; update(); });
  window.addEventListener('appinstalled', () => { promptEvent = null; buttons().forEach(button => button.hidden = true); document.querySelector('#app-download-card')?.classList.add('is-installed'); });
  appDisplay.addEventListener?.('change', update);
  navigator.windowControlsOverlay?.addEventListener('geometrychange', update);
  function init() {
    // A title bar for the existing desktop app when native window controls are overlaid.
    const titlebar = document.createElement('div'); titlebar.className = 'app-titlebar';
    const mark = document.createElement('img'); mark.src = '/static/brand/v2/logo.svg'; mark.alt = ''; mark.width = 22; mark.height = 22;
    const name = document.createElement('span'); name.textContent = 'CHAINeS POST';
    const nav = document.createElement('nav'); nav.setAttribute('aria-label', 'App panels');
    [['Feed', '/'], ['Marketplace', '/marketplace.html'], ['OMConsole', '/omconsole_render_single.html']].forEach(([label, href]) => { const link = document.createElement('a'); link.href = href; link.textContent = label; nav.append(link); });
    titlebar.append(mark, name, nav); document.body.prepend(titlebar);
    // Pages without a toolbar install button still expose the same guide.
    if (!buttons().length) {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.installApp = ''; button.className = 'install-app-btn';
      const host = document.querySelector('header .brand')?.parentElement || document.querySelector('header') || document.querySelector('footer');
      if (host) host.append(button);
    }
    buttons().forEach(button => button.addEventListener('click', install)); update();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then(registration => registration.update()).catch(() => {});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once:true}); else init();
})();
