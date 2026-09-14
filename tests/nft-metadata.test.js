import test from 'node:test';
import assert from 'node:assert/strict';
import {detectGlbAsset, nftMetadataAssets, resolveNftAsset} from '../static/nft-metadata.js';

test('finds a GLB in thirdweb-style nested metadata', () => {
  const assets = nftMetadataAssets({
    image: 'cover.png',
    properties: {files: [{uri:'ipfs://bafy/model', type:'model/gltf-binary'}]}
  }, 'https://example.com/ipfs/meta/1.json');
  assert.equal(assets.modelUrl, 'ipfs://bafy/model');
  assert.equal(assets.imageUrl, 'https://example.com/ipfs/meta/cover.png');
});

test('recognizes model URLs in standard metadata fields', () => {
  const assets = nftMetadataAssets({animation_url:{url:'model.glb'}, image:{uri:'poster.webp', type:'image/webp'}}, 'https://example.com/nft/metadata.json');
  assert.equal(assets.modelUrl, 'https://example.com/nft/model.glb');
  assert.equal(assets.imageUrl, 'https://example.com/nft/poster.webp');
});

test('detects an extensionless GLB from its binary header', async () => {
  const glb = Uint8Array.from([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0]);
  const found = await detectGlbAsset('https://example.com/ipfs/bafy', async () => new Response(glb));
  assert.equal(found, true);
});

test('keeps absolute decentralized asset URLs unchanged', () => {
  assert.equal(resolveNftAsset('ipfs://bafy/model.glb', 'https://example.com/meta.json'), 'ipfs://bafy/model.glb');
});
