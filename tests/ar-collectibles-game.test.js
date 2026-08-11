import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const page = fs.readFileSync(path.join(root, 'chaines-ar-collectibles.html'), 'utf8');

test('IONCORE AR stays in-page and preserves MediaPipe state', () => {
  assert.match(page, /gameActive \? 'webxr' : DEFAULT_AR_MODES/);
  assert.match(page, /googleArBtn\.hidden = gameActive/);
  assert.match(page, /if \(handStream\) suspendHandTrackingForAR\(\)/);
  assert.match(page, /handTrackingSuspendedForAR = handTrackingRequested/);
  assert.match(page, /resumeHandTrackingAfterAR\(\)/);
  assert.match(page, /slot="hotspot-ioncore-fire"/);
});
