/**
 * syncOpenseaOrders.js — OpenSea v2 (orders) sync for ApeChain
 * Node.js ≥18 (global fetch)
 */

const BACKEND_URL = process.env.BACKEND_URL || "https://sənin-app.onrender.com";
const NFT_CONTRACT_ADDRESS = process.env.NFT_CONTRACT_ADDRESS;
const PROXY_CONTRACT_ADDRESS = process.env.PROXY_CONTRACT_ADDRESS;
const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY;

if (!OPENSEA_API_KEY) {
  console.error("❌ OPENSEA_API_KEY is missing in env");
  process.exit(1);
}
if (!NFT_CONTRACT_ADDRESS) {
  console.error("❌ NFT_CONTRACT_ADDRESS is missing in env");
  process.exit(1);
}

const CHAIN = "apechain";        // ApeChain
const ORDER_TYPE = "listings";   // sell orders
const PAGE_SIZE = 50;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchOrders(cursor = null) {
  let url = `https://api.opensea.io/api/v2/orders/${CHAIN}/${ORDER_TYPE}?limit=${PAGE_SIZE}&asset_contract_address=${NFT_CONTRACT_ADDRESS}`;
  if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;

  const res = await fetch(url, {
    headers: {
      "Accept": "application/json",
      "X-API-KEY": OPENSEA_API_KEY
    }
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    console.log("❌ OpenSea error:", res.status, txt);
    return null;
  }

  return res.json();
}

async function postOrderToBackend(orderPayload) {
  try {
    const res = await fetch(`${BACKEND_URL}/order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(orderPayload)
    });

    if (!res.ok) {
      console.log("❌ Backend rejected", res.status, await res.text());
      return false;
    }

    const data = await res.json().catch(() => null);
    if (!data?.success) {
      console.log("⛔ Backend returned failure", data);
      return false;
    }

    return true;
  } catch (e) {
    console.log("❌ postOrderToBackend error:", e.message);
    return false;
  }
}

/** Normalize OpenSea v2 order shape */
function normalizeOrder(order) {
  try {
    const protocol =
      order.protocol_data ||
      order.protocolData ||
      order.protocol ||
      null;

    const maker = order.maker || order.maker_address || {};
    const orderHash = order.order_hash || order.hash || null;

    const price =
      order.price?.current?.value ||
      order.price?.value ||
      order.current_price ||
      order.starting_price ||
      null;

    return { protocol, maker, orderHash, price };
  } catch {
    return { protocol: null, maker: {}, orderHash: null, price: null };
  }
}

/** Extract NFT metadata from various OpenSea v2 shapes */
function extractNftMeta(ord) {
  return (
    ord?.criteria?.metadata ||
    ord?.asset ||
    (ord?.assets ? ord.assets[0] : null) ||
    ord?.item ||
    ord?.items?.[0] ||
    null
  );
}

function extractTokenId(nftMeta) {
  return (
    nftMeta?.identifier ||
    nftMeta?.token_id ||
    nftMeta?.tokenId ||
    nftMeta?.id ||
    null
  );
}

function extractImage(nftMeta) {
  return (
    nftMeta?.image_url ||
    nftMeta?.image ||
    nftMeta?.thumbnail ||
    nftMeta?.metadata?.image ||
    null
  );
}

async function main() {
  console.log("🚀 OpenSea v2 Sync başladı...");

  let cursor = null;
  let totalScanned = 0;
  let totalSent = 0;

  while (true) {
    console.log(`📦 Fetching orders (cursor=${cursor || "null"})`);

    const data = await fetchOrders(cursor);
    if (!data?.orders?.length) {
      console.log("⏹ No more orders or fetch failed.");
      break;
    }

    for (const ord of data.orders) {
      const nftMeta = extractNftMeta(ord);
      if (!nftMeta) continue;

      const tokenId = extractTokenId(nftMeta);
      const image = extractImage(nftMeta);

      if (!tokenId) continue;

      const { protocol, maker, orderHash, price } = normalizeOrder(ord);

      const payload = {
        tokenId,
        price: price ?? 0,
        sellerAddress: (maker?.address || maker || "unknown").toLowerCase(),
        seaportOrder: protocol || ord,  // full order fallback
        orderHash: orderHash || `${tokenId}-${maker?.address || "unknown"}`,
        image: image || null,
        marketplaceContract: PROXY_CONTRACT_ADDRESS
      };

      totalScanned++;

      const ok = await postOrderToBackend(payload);
      if (ok) totalSent++;

      await sleep(200); // anti-rate limit
    }

    cursor = data.next || data.cursor || null;
    if (!cursor) break;

    await sleep(500);
  }

  console.log("\n🎉 SYNC TAMAMLANDI");
  console.log("📌 Total orders scanned:", totalScanned);
  console.log("📌 Total orders sent:", totalSent);
}

main().catch(err => {
  console.error("💀 FATAL ERROR:", err);
  process.exit(1);
});
