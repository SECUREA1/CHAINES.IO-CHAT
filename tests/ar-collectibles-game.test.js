import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const page = fs.readFileSync(path.join(root, 'chaines-ar-collectibles.html'), 'utf8');

test('AR placement keeps platform fallbacks and preserves MediaPipe state', () => {
  assert.match(page, /viewer\.setAttribute\('ar-modes', DEFAULT_AR_MODES\)/);
  assert.match(page, /googleArBtn\.hidden = false/);
  assert.match(page, /prepareHandTrackingForAR\(\)/);
  assert.match(page, /handTrackingSuspendedForAR = handTrackingRequested/);
  assert.match(page, /resumeHandTrackingAfterAR\(\)/);
  assert.match(page, /slot="hotspot-ioncore-fire"/);
});

test('both Place NFT in AR controls release the MediaPipe camera', () => {
  assert.match(page, /id="viewerArButton"/);
  assert.match(page, /viewerArButton\.addEventListener\('click', prepareHandTrackingForAR, \{capture:true\}\)/);
  assert.match(page, /async function launchActiveCollectibleAR[\s\S]*?prepareHandTrackingForAR\(\)/);
  assert.match(page, /function prepareHandTrackingForAR\(\)[\s\S]*?if \(handStream\) suspendHandTrackingForAR\(\)/);
});
