import crypto from 'node:crypto';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import {execFile,spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
let probePath=process.env.FFPROBE_PATH || 'ffprobe';
try { if(!process.env.FFPROBE_PATH) probePath=require('ffprobe-static').path; } catch {}
export function validateVideo(file){
  return new Promise((resolve,reject)=>execFile(probePath,['-v','error','-show_entries','format=duration:stream=codec_type,duration','-of','json',file],{timeout:120000,maxBuffer:1024*1024},(error,stdout)=>{
    if(error) return reject(new Error(error.code==='ENOENT'?'Video validation is unavailable. Please retry later.':'Unable to read video duration. Choose a valid video.'));
    try {
      const data=JSON.parse(stdout);
      const durations=[data.format?.duration,...(data.streams||[]).map(s=>s.duration)].map(Number).filter(Number.isFinite);
      if(!data.streams?.some(s=>s.codec_type==='video')) throw new Error('Unable to read video duration.');
      if(!durations.length || Math.max(...durations)<=0) {
        const child=spawn(probePath,['-v','error','-select_streams','v:0','-show_entries','packet=pts_time,duration_time','-of','csv=p=0',file],{stdio:['ignore','pipe','ignore']});
        let duration=0,over=false;
        const lines=createInterface({input:child.stdout});
        const timer=setTimeout(()=>{child.kill();reject(new Error('Video validation timed out.'));},120000);
        lines.on('line',line=>{
          const [pts,length]=line.split(',').map(Number);
          if(Number.isFinite(pts)) duration=Math.max(duration,pts+(Number.isFinite(length)?length:0));
          if(duration>60.05){over=true;child.kill();}
        });
        child.on('error',error=>{clearTimeout(timer);reject(error);});
        child.on('close',code=>{
          clearTimeout(timer);
          if(over) reject(new Error('Videos must be 60 seconds or shorter.'));
          else if(code!==0 || duration<=0) reject(new Error('Unable to read video duration.'));
          else resolve(duration);
        });
        return;
      }
      if(Math.max(...durations)>60.05) throw new Error('Videos must be 60 seconds or shorter.');
      resolve(Math.max(...durations));
    } catch(error){reject(error);}
  }));
}

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
  try { db.exec('ALTER TABLE media_assets ADD COLUMN disk_id TEXT'); } catch {}
  try { db.exec('ALTER TABLE media_assets ADD COLUMN file_size INTEGER'); } catch {}
  const directory=process.env.MEDIA_STORAGE_DIR || path.resolve(path.dirname(process.env.DB_PATH || 'app.db'),'media-assets');
  fs.mkdirSync(directory,{recursive:true});
  app.use(['/api/media','/media'],(req,res,next)=>{
    const allowed=new Set(['https://chaines.io','https://www.chaines.io','https://chaines-chat-site.onrender.com',...(process.env.MEDIA_ALLOWED_ORIGINS||'').split(',').filter(Boolean)]);
    if(allowed.has(req.headers.origin)) res.set({'Access-Control-Allow-Origin':req.headers.origin,'Vary':'Origin','Access-Control-Expose-Headers':'Content-Length, Content-Range, Accept-Ranges'});
    next();
  });
  const uploader=multer({storage:multer.diskStorage({destination:directory,filename:(_req,_file,done)=>done(null,crypto.randomUUID())}),limits:{files:1,fields:0}}).single('file');
  let uploading=false;
  app.post('/api/media',rateLimit('media-upload',10),(req,res)=>{
    if(uploading) return res.status(503).json({error:'Another upload is finishing. Please retry shortly.'});
    uploading=true;
    res.once('close',()=>{uploading=false;});
    uploader(req,res,async error=>{
      const cleanup=()=>{if(req.file?.path) try{fs.unlinkSync(req.file.path);}catch{}};
      if(error){cleanup();return res.status(400).json({error:'Unable to read attachment.'});}
      if(!req.file?.size){cleanup();return res.status(400).json({error:'Choose a nonempty file.'});}
      const id=crypto.randomUUID();
      const type=inferMediaType(req.file.mimetype,req.file.originalname);
      const isVideo=type.startsWith('video/') || inferMediaType('',req.file.originalname).startsWith('video/');
      const name=publicMediaName(type,req.file.originalname);
      if(!isVideo && req.file.size>100*1024*1024){cleanup();return res.status(413).json({error:'Non-video files must be 100 MB or smaller.'});}
      if(isVideo) try {await validateVideo(req.file.path);} catch(error){cleanup();return res.status(422).json({error:error.message});}
      if(res.destroyed){cleanup();return;}
      try { db.prepare('INSERT INTO media_assets (id,mime,bytes,extension,disk_id,file_size) VALUES (?,?,?,?,?,?)').run(id,type,Buffer.alloc(0),name.split('.').pop(),req.file.filename,req.file.size); }
      catch {cleanup();return res.status(503).json({error:'Cloud storage is unavailable. Please retry.'});}
      res.status(201).json({url:`/media/${id}`,type,name,size:req.file.size});
    });
  });
  app.get('/media/:id',async(req,res)=>{
    try {
    const asset=db.prepare('SELECT mime,COALESCE(file_size,length(bytes)) AS size,extension,disk_id FROM media_assets WHERE id=?').get(req.params.id);
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
    if(asset.disk_id){
      const stream=fs.createReadStream(path.join(directory,asset.disk_id),{start,end});
      stream.on('error',()=>res.destroy());res.once('close',()=>stream.destroy());stream.pipe(res);return;
    }
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
