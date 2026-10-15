(() => {
  const kind=type=>type?.startsWith('video/')?'video':type?.startsWith('audio/')?'audio':type?.startsWith('image/')?'image':'attachment';
  async function upload(blob){
    const video=String(blob.type).startsWith('video/') || /\.(mp4|m4v|mov|webm|mkv|avi|ogv|mpeg|mpg|3gp)$/i.test(blob.name||'');
    if(!video && blob.size>100*1024*1024) throw new Error('Non-video files must be 100 MB or smaller.');
    const body=new FormData();
    // Only a safe format extension leaves the browser, never the original basename.
    const type=String(blob.type||'application/octet-stream').split(';')[0].trim();
    const extension=String(blob.name||'').match(/\.([a-zA-Z0-9]{1,12})$/)?.[1]?.toLowerCase();
    body.append('file',new Blob([blob],{type}),kind(type)+(extension?'.'+extension:''));
    const configured=localStorage.getItem('chaines_ws_url');
    const local=/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
    const socketUrl=new URL(configured||(local?location.origin.replace(/^http/,'ws')+'/ws':'wss://chaines-io-chat.onrender.com/ws'));
    const base=socketUrl.origin.replace(/^ws/,'http');
    const response=await fetch(base+'/api/media',{method:'POST',body});
    const data=await response.json();
    if(!response.ok) throw new Error(data.error||'Upload failed. Please retry.');
    return {dataUrl:base===location.origin?data.url:new URL(data.url,base).href,type:data.type,name:data.name};
  }
  function downloadLink(content,type){
    const link=document.createElement('a');
    link.href=/\/media\/[a-f0-9-]+$/.test(content)?content+'?download=1':content;link.download=String(content).startsWith('/media/')?'':kind(type)+({ 'video/webm':'.webm','video/mp4':'.mp4','audio/webm':'.webm','audio/mp4':'.m4a','audio/ogg':'.ogg','image/jpeg':'.jpg','image/png':'.png'}[String(type).split(';')[0]]||'.bin');link.textContent=`Download ${kind(type)}`;
    link.className='media-download';
    return link;
  }
  function playbackFallback(element){
    element.preload='metadata';
    element.addEventListener('error',()=>{
      if(element.nextElementSibling?.classList.contains('media-playback-note')) return;
      const note=document.createElement('p');note.className='media-playback-note';
      note.textContent='This browser cannot preview this format. Download the original to open it in a compatible app.';
      element.after(note);
    },{once:true});
  }
  window.ChainesMedia={upload,downloadLink,playbackFallback};
})();
