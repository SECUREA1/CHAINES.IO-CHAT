import crypto from 'node:crypto';
import multer from 'multer';

const formats = {doc:'application/msword',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xls:'application/vnd.ms-excel',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',ppt:'application/vnd.ms-powerpoint',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',odt:'application/vnd.oasis.opendocument.text',ods:'application/vnd.oasis.opendocument.spreadsheet',rtf:'application/rtf',epub:'application/epub+zip',html:'text/html',md:'text/markdown',js:'text/javascript',xml:'application/xml',gz:'application/gzip',tar:'application/x-tar',rar:'application/vnd.rar','7z':'application/x-7z-compressed',mp4:'video/mp4',m4v:'video/mp4',mov:'video/quicktime',webm:'video/webm',mkv:'video/x-matroska',avi:'video/x-msvideo',ogv:'video/ogg',mpeg:'video/mpeg',mpg:'video/mpeg','3gp':'video/3gpp',mp3:'audio/mpeg',m4a:'audio/mp4',wav:'audio/wav',ogg:'audio/ogg',flac:'audio/flac',aac:'audio/aac',opus:'audio/ogg',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',jfif:'image/jpeg',gif:'image/gif',webp:'image/webp',avif:'image/avif',heic:'image/heic',heif:'image/heif',tif:'image/tiff',tiff:'image/tiff',bmp:'image/bmp',svg:'image/svg+xml',pdf:'application/pdf',txt:'text/plain',csv:'text/csv',json:'application/json',zip:'application/zip',glb:'model/gltf-binary',gltf:'model/gltf+json'};
export function inferMediaType(type='',name='') {
  const clean=String(type||'').split(';')[0].trim().toLowerCase();
  const inferred=formats[String(name).split('.').pop().toLowerCase()];
  if(!clean || clean==='application/octet-stream') return inferred || 'application/octet-stream';
  return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(clean)?clean:'application/octet-stream';
}
export function publicMediaName(type='',source='') {
  const mime=inferMediaType(type);
  const suffix=String(source).match(/\.([a-zA-Z0-9]{1,12})$/)?.[1]?.toLowerCase();
  const ext=Object.keys(formats).find(key=>formats[key]===mime)||suffix||'bin';
  const kind=mime.startsWith('image/')?'image':mime.startsWith('video/')?'video':mime.startsWith('audio/')?'audio':'attachment';
  return `${kind}.${ext}`;
}
export function publicMediaText(text='',originalName='') {
  const value=String(text);
  const prefix=`Attachment: ${originalName}`;
  return originalName && value.startsWith(prefix) ? 'Attachment'+value.slice(prefix.length) : value;
}
export function installMediaAssets(app,db,rateLimit) {
  db.exec('CREATE TABLE IF NOT EXISTS media_assets (id TEXT PRIMARY KEY, mime TEXT NOT NULL, bytes BLOB NOT NULL, extension TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)');
  try { db.exec('ALTER TABLE media_assets ADD COLUMN extension TEXT'); } catch {}
  app.use(['/api/media','/media'],(req,res,next)=>{
    const allowed=new Set(['https://chaines.io','https://www.chaines.io','https://chaines-chat-site.onrender.com',...(process.env.MEDIA_ALLOWED_ORIGINS||'').split(',').filter(Boolean)]);
    if(allowed.has(req.headers.origin)) res.set({'Access-Control-Allow-Origin':req.headers.origin,'Vary':'Origin','Access-Control-Expose-Headers':'Content-Length, Content-Range, Accept-Ranges'});
    next();
  });
  const uploader=multer({storage:multer.memoryStorage(),limits:{fileSize:100*1024*1024,files:1}}).single('file');
  let uploading=false;
  app.post('/api/media',rateLimit('media-upload',10),(req,res)=>{
    if(uploading) return res.status(503).json({error:'Another upload is finishing. Please retry shortly.'});
    uploading=true;
    res.once('close',()=>{uploading=false;});
    uploader(req,res,error=>{
      if(error) return res.status(error.code==='LIMIT_FILE_SIZE'?413:400).json({error:error.code==='LIMIT_FILE_SIZE'?'Files must be 100 MB or smaller.':'Unable to read attachment.'});
      if(!req.file?.buffer?.length) return res.status(400).json({error:'Choose a nonempty file.'});
      const id=crypto.randomUUID();
      const type=inferMediaType(req.file.mimetype,req.file.originalname);
      const name=publicMediaName(type,req.file.originalname);
      const extension=name.split('.').pop();
      try { db.prepare('INSERT INTO media_assets (id,mime,bytes,extension) VALUES (?,?,?,?)').run(id,type,req.file.buffer,extension); }
      catch { return res.status(503).json({error:'Cloud storage is unavailable. Please retry.'}); }
      res.status(201).json({url:`/media/${id}`,type,name,size:req.file.size});
    });
  });
  app.get('/media/:id',async(req,res)=>{
    try {
    const asset=db.prepare('SELECT mime,length(bytes) AS size,extension FROM media_assets WHERE id=?').get(req.params.id);
    if(!asset) return res.status(404).end();
    const size=asset.size;
    const safeInline=!req.query.download && (/^(video|audio)\//.test(asset.mime)||(/^image\//.test(asset.mime)&&asset.mime!=='image/svg+xml'));
    res.set({'Content-Type':asset.mime,'Content-Disposition':`${safeInline?'inline':'attachment'}; filename="${publicMediaName(asset.mime,'attachment.'+asset.extension)}"`,'X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'",'Accept-Ranges':'bytes','Cache-Control':'public, max-age=31536000, immutable'});
    let start=0,end=size-1;
    if(req.headers.range){
      const range=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if(!range || (!range[1]&&!range[2])) return res.status(416).set('Content-Range',`bytes */${size}`).end();
      if(!range[1]) start=Math.max(0,size-Number(range[2]));
      else { start=Number(range[1]); if(range[2]) end=Math.min(end,Number(range[2])); }
      if(start>=size || start>end) return res.status(416).set('Content-Range',`bytes */${size}`).end();
      res.status(206).set('Content-Range',`bytes ${start}-${end}/${size}`);
    }
    res.set('Content-Length',String(end-start+1));
    if(req.method==='HEAD') return res.end();
    const read=db.prepare('SELECT substr(bytes,?,?) AS chunk FROM media_assets WHERE id=?');
    for(let offset=start;offset<=end&&!res.destroyed;offset+=262144){
      const {chunk}=read.get(offset+1,Math.min(262144,end-offset+1),req.params.id);
      if(!res.write(chunk)) await new Promise(resolve=>{
        const done=()=>{res.off('drain',done);res.off('close',done);resolve();};
        res.once('drain',done);res.once('close',done);
      });
    }
    res.end();
    } catch { if(!res.headersSent) res.status(503).end(); else res.destroy(); }
  });
}
