/* Native install prompt where supported; explicit Apple/browser instructions elsewhere. */
(() => {
  let promptEvent = null;
  const isAppleMobile = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isMac = !isAppleMobile && /Mac/.test(navigator.platform);
  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  let dialog;
  function buttons() { return [...document.querySelectorAll('#install-app-btn, #auth-install-app-btn, [data-install-app]')]; }
  function update() {
    buttons().forEach(button => { button.hidden = standalone(); button.textContent = isAppleMobile ? 'Add to Home Screen' : isMac ? 'Install on Mac' : 'Install CHAINeS app'; });
    document.querySelector('#app-download-card')?.classList.toggle('is-installed', standalone());
  }
  function showGuide() {
    if (!dialog) {
      dialog = document.createElement('dialog'); dialog.className = 'brand-dialog'; dialog.setAttribute('aria-labelledby', 'install-guide-title');
      const heading = document.createElement('div'); heading.className = 'brand-dialog__heading';
      const title = document.createElement('h2'); title.id = 'install-guide-title'; title.textContent = 'Install CHAINeS POST';
      const close = document.createElement('button'); close.type = 'button'; close.textContent = 'Close'; close.addEventListener('click', () => dialog.close());
      heading.append(title, close); dialog.append(heading);
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
  function init() {
    // Pages without a toolbar install button still expose the same guide.
    if (!buttons().length) {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.installApp = ''; button.className = 'install-app-btn';
      const host = document.querySelector('header .brand')?.parentElement || document.querySelector('header') || document.querySelector('footer');
      if (host) host.append(button);
    }
    buttons().forEach(button => button.addEventListener('click', install)); update();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once:true}); else init();
})();
