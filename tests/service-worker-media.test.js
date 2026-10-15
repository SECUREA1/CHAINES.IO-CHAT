import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('installed app leaves media and byte-range requests to native HTTP caching and streaming',()=>{
  const listeners={};
  vm.runInNewContext(fs.readFileSync(new URL('../sw.js',import.meta.url),'utf8'),{
    URL,
    self:{location:{origin:'https://chaines.io'},addEventListener:(name,fn)=>{listeners[name]=fn;}}
  });
  for(const [url,headers] of [['https://chaines.io/media/opaque-id',new Headers()],['https://chaines.io/static/legacy-video.mp4',new Headers({Range:'bytes=0-100'})]]){
    let intercepted=false;
    listeners.fetch({request:{method:'GET',url,headers},respondWith:()=>{intercepted=true;}});
    assert.equal(intercepted,false);
  }
});
