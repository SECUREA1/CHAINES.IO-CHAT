const MODEL_EXTENSION = /\.(glb|gltf)(?:[?#].*)?$/i;
const IMAGE_EXTENSION = /\.(png|jpe?g|webp|gif|svg|avif)(?:[?#].*)?$/i;
const MODEL_MIME = /^(?:model\/gltf(?:\+json|-binary)?|application\/gltf(?:\+json|-binary)?)\b/i;

function assetValue(value) {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object') return '';
  return assetValue(value.uri || value.url || value.src || value.href);
}

export function resolveNftAsset(value, metadataUrl = '') {
  const asset = assetValue(value);
  if (!asset) return '';
  if (/^(?:ipfs:|https?:|data:|blob:)/i.test(asset)) return asset;
  try {
    return new URL(asset, metadataUrl).href;
  } catch {
    return asset;
  }
}

export function isModelAsset(value, type = '') {
  const url = assetValue(value);
  return Boolean(url) && (MODEL_EXTENSION.test(url.split('?')[0]) || MODEL_MIME.test(String(type).trim()));
}

export function isImageAsset(value, type = '') {
  const url = assetValue(value);
  return Boolean(url) && (IMAGE_EXTENSION.test(url.split('?')[0]) || /^image\//i.test(String(type).trim()));
}

export function nftMetadataAssets(metadata, metadataUrl = '') {
  const modelCandidates = [
    [metadata?.animation_url || metadata?.animationUrl, metadata?.animation_type || metadata?.animationType],
    [metadata?.model_url || metadata?.modelUrl, 'model/gltf-binary'],
    [metadata?.properties?.model, metadata?.properties?.model?.type],
    [metadata?.properties?.animation_url, metadata?.properties?.animation_url?.type]
  ];
  const files = [
    ...(Array.isArray(metadata?.properties?.files) ? metadata.properties.files : []),
    ...(Array.isArray(metadata?.files) ? metadata.files : []),
    ...(Array.isArray(metadata?.assets) ? metadata.assets : [])
  ];
  files.forEach((file) => modelCandidates.push([file, file?.type || file?.mimeType || file?.mediaType]));

  const imageValue = metadata?.image || metadata?.image_url || metadata?.imageUrl || metadata?.thumbnail;
  const imageType = metadata?.image_type || metadata?.imageType || imageValue?.type;
  // Some NFT platforms put the GLB in `image`, including extensionless IPFS
  // URLs. Treat it as a model only when its extension or declared MIME says so.
  modelCandidates.push([imageValue, imageType]);
  const model = modelCandidates.find(([value, type]) => isModelAsset(value, type));

  const imageCandidates = [[imageValue, imageType], ...files.map((file) => [file, file?.type || file?.mimeType || file?.mediaType])];
  const image = imageCandidates.find(([value, type]) => isImageAsset(value, type));
  return {
    modelUrl: resolveNftAsset(model?.[0], metadataUrl),
    imageUrl: resolveNftAsset(image?.[0], metadataUrl)
  };
}

export async function detectGlbAsset(url, fetcher = fetch) {
  if (!url) return false;
  if (isModelAsset(url)) return true;
  try {
    const response = await fetcher(url, {headers:{Range:'bytes=0-11'}, cache:'force-cache'});
    const type = response.headers?.get?.('content-type') || '';
    if (MODEL_MIME.test(type)) return true;
    let bytes;
    if (response.body?.getReader) {
      const reader = response.body.getReader();
      const first = await reader.read();
      bytes = first.value || new Uint8Array();
      await reader.cancel();
    } else {
      bytes = new Uint8Array(await response.arrayBuffer());
    }
    return bytes.length >= 4 && bytes[0] === 0x67 && bytes[1] === 0x6c && bytes[2] === 0x54 && bytes[3] === 0x46;
  } catch {
    return false;
  }
}
