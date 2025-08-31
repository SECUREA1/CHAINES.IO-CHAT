(function(){
  document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('wallet-btn');
    if(!btn) return;
    btn.addEventListener('click', async () => {
      try{
        const cardano = window.cardano;
        if(!cardano || !cardano.nami){
          alert('No Cardano CIP-30 wallet found.');
          return;
        }
        const api = await cardano.nami.enable();
        const addr = await api.getChangeAddress();
        console.log('Connected to wallet:', addr);
        alert('Wallet connected');
      }catch(err){
        console.error('Wallet connection failed', err);
        alert('Wallet connection failed');
      }
    });
  });
})();
