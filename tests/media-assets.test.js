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
