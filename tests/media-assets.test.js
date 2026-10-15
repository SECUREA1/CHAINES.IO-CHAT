import test from 'node:test';
import assert from 'node:assert/strict';
import {inferMediaType, publicMediaName, publicMediaText} from '../ws-server/mediaAssets.js';

test('missing MIME types are inferred without exposing original filenames',()=>{
  for(const [name,type] of [['private.mov','video/quicktime'],['private.heic','image/heic'],['private.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document'],['private.anything','application/octet-stream']]){
    assert.equal(inferMediaType('',name),type);
    assert(!publicMediaName(type).includes('private'));
  }
  assert.equal(inferMediaType(null,'legacy.mp4'),'video/mp4');
  assert.equal(publicMediaText('Attachment: secret.pdf','secret.pdf'),'Attachment');
});
test('unrecognized formats retain a safe extension without retaining a basename',()=>{
  assert.equal(publicMediaName('application/octet-stream','private-design.blend'),'attachment.blend');
  assert.equal(publicMediaName('application/octet-stream','untrusted.bad/name'),'attachment.bin');
  assert.equal(publicMediaText('Attachment: secret.pdf\n\n— author','secret.pdf'),'Attachment\n\n— author');
});

test('browser-style WebM without a duration header is validated from packet timestamps',async()=>{
  const {execFileSync}=await import('node:child_process');
  const fs=await import('node:fs');
  const os=await import('node:os');
  const path=await import('node:path');
  const {validateVideo}=await import('../ws-server/mediaAssets.js');
  const file=path.join(os.tmpdir(),'chaines-stream-'+Date.now()+'.webm');
  try {
    const bytes=execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=size=16x16:rate=2','-t','2','-c:v','libvpx','-f','webm','pipe:1']);
    fs.writeFileSync(file,bytes);
    const duration=await validateVideo(file);
    assert(duration>=1.5 && duration<=2.1);
  } finally {fs.rmSync(file,{force:true});}
});
