import { Lucid, Blockfrost } from "lucid-cardano";

const NETWORK = (process.env.CARDANO_NETWORK || "Mainnet").trim().toLowerCase();
const BLOCKFROST_PROJECT_ID = (process.env.BLOCKFROST_PROJECT_ID || "").trim();
const PAYMENT_SKEY = (process.env.HOLOGHOST_VENDING_PAYMENT_SKEY || "").trim();
const MIN_ADA_DEFAULT = 2_000_000n;

function parseMinAda() {
  const raw = (process.env.HOLOGHOST_VENDING_MIN_ADA || "").trim();
  if (!raw) return MIN_ADA_DEFAULT;
  try {
    const value = BigInt(raw);
    if (value <= 0n) return MIN_ADA_DEFAULT;
    return value;
  } catch {
    return MIN_ADA_DEFAULT;
  }
}

const MIN_ADA = parseMinAda();
const WAIT_FOR_CONFIRMATION = /^true$/i.test(
  (process.env.HOLOGHOST_VENDING_AWAIT_CONFIRMATION || "").trim()
);

function resolveNetworkName() {
  switch (NETWORK) {
    case "mainnet":
      return "Mainnet";
    case "preprod":
      return "Preprod";
    case "preview":
      return "Preview";
    case "testnet":
      return "Preprod";
    default:
      return "Mainnet";
  }
}

function resolveBlockfrostUrl(network) {
  switch (network) {
    case "Mainnet":
      return "https://cardano-mainnet.blockfrost.io/api/v0";
    case "Preprod":
      return "https://cardano-preprod.blockfrost.io/api/v0";
    case "Preview":
      return "https://cardano-preview.blockfrost.io/api/v0";
    default:
      return "https://cardano-mainnet.blockfrost.io/api/v0";
  }
}

let lucidPromise = null;

function directVendorConfigured() {
  return Boolean(BLOCKFROST_PROJECT_ID && PAYMENT_SKEY);
}

async function getLucid() {
  if (!directVendorConfigured()) {
    throw new Error(
      "Direct hologhost vending requires BLOCKFROST_PROJECT_ID and HOLOGHOST_VENDING_PAYMENT_SKEY."
    );
  }
  if (lucidPromise) return lucidPromise;

  const networkName = resolveNetworkName();
  const apiUrl = resolveBlockfrostUrl(networkName);

  lucidPromise = Lucid.new(new Blockfrost(apiUrl, BLOCKFROST_PROJECT_ID), networkName)
    .then(async (lucid) => {
      await lucid.selectWalletFromPrivateKey(PAYMENT_SKEY);
      return lucid;
    })
    .catch((err) => {
      lucidPromise = null;
      throw err;
    });

  return lucidPromise;
}

export function isDirectVendorEnabled() {
  return directVendorConfigured();
}

export async function vendGhostTokenDirect({ address, policyId, assetNameHex }) {
  if (!address) throw new Error("address is required for vending.");
  if (!policyId) throw new Error("policyId is required for vending.");
  if (!assetNameHex) throw new Error("assetNameHex is required for vending.");

  const lucid = await getLucid();
  const networkName = resolveNetworkName();

  const unit = `${policyId}${assetNameHex}`.toLowerCase();
  const assets = { [unit]: 1n };
  if (MIN_ADA > 0n) {
    assets.lovelace = MIN_ADA;
  }

  const tx = await lucid.newTx().payToAddress(address, assets).complete();
  const signedTx = await tx.sign().complete();
  const txId = await signedTx.submit();

  if (WAIT_FOR_CONFIRMATION) {
    await lucid.awaitTx(txId);
  }

  return {
    txId,
    vendorStatus: 200,
    vendorResponse: {
      provider: "direct",
      network: networkName,
      minAda: MIN_ADA.toString(),
    },
    message: "Ghost token transfer submitted to the Cardano network.",
  };
}
