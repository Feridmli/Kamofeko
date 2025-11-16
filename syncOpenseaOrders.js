/**
 * syncOpenseaOrders.js — OpenSea v2 (orders) sync for ApeChain
 * Node.js ≥18 (global fetch)
 */

const BACKEND_URL = process.env.BACKEND_URL || "https://sənin-app.onrender.com";
const NFT_CONTRACT_ADDRESS = process.env.NFT_CONTRACT_ADDRESS;
const PROXY_CONTRACT_ADDRESS = process.env.PROXY_CONTRACT_ADDRESS;
const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY;

if (!OPENSEA_API_KEY) {
  console.error("OPENSEA_API_KEY is missing in env");
  process.exit(1);
}
if (!NFT_CONTRACT_ADDRESS) {
  console.error("NFT_CONTRACT_ADDRESS is missing in env");
  process.exit(1);
}

const CHAIN = "apechain"; // ApeChain
const ORDER_TYPE = "listings"; // listings (sell orders)
const PAGE_SIZE = 50;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchOrders(cursor = null) {
  let url = `https://api.opensea.io/api/v2/orders/${CHAIN}/${ORDER_TYPE}?limit=${PAGE_SIZE}&asset_contract_address=${NFT_CONTRACT_ADDRESS}`;
  if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;

  const res = await fetch(url, {
    headers: {
      "Accept": "application/json",
      "X-API-KEY": OPENSEA_API_KEY
    },
    // timeout handled by fetch implementation / runner
  });

  if (!res.ok) {
    const txt = await res.text().catch(()=>"");
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
      console.log("❌ Backend rejected response", res.status, await res.text().catch(()=>""));
      return false;
    }
    const data = await res.json().catch(()=>null);
    if (!data || !data.success) {
      console.log("⛔ Backend returned failure", data);
      return false;
    }
    return true;
  } catch (e) {
    console.log("❌ postOrderToBackend error", e.message || e);
    return false;
  }
}

function normalizeOrder(order) {
  // depending on OpenSea v2 shape, try to get protocol data & token identifier
  try {
    const protocol = order.protocol_data || order.protocolData || null;
    const maker = order.maker || {};
    const orderHash = order.order_hash || order.hash || null;
    // price attempt: order.price.current.value or order.current_price
    const price = (order.price && order.price.current && order.price.current.value) || order.current_price || null;
    return { protocol, maker, orderHash, price };
  } catch {
    return { protocol: null, maker: {}, orderHash: null, price: null };
  }
}

async function main() {
  console.log("🚀 OpenSea v2 Sync başladı...");
  let cursor = null;
  let totalScanned = 0;
  let totalSent = 0;
  while (true) {
    console.log(`📦 Fetching orders (cursor=${cursor || "null"})`);
    const data = await fetchOrders(cursor);
    if (!data || !data.orders || data.orders.length === 0) {
      console.log("⏹ No more orders or fetch failed.");
      break;
    }

    for (const ord of data.orders) {
      // In v2 response, order.criteria or order.asset may contain info
      // Attempt to get NFT identifier and image from criteria/asset/metadata
      const nftMeta = (ord?.criteria?.metadata) || (ord?.asset) || (ord?.assets && ord.assets[0]) || null;
      if (!nftMeta) continue;

      const tokenId = nftMeta?.identifier || nftMeta?.token_id || nftMeta?.tokenId || nftMeta?.tokenId ?? nftMeta?.token_id ?? nftMeta?.id ?? null;
      const image = nftMeta?.image_url || nftMeta?.image || nftMeta?.thumbnail || nftMeta?.metadata?.image || null;
      const { protocol, maker, orderHash, price } = normalizeOrder(ord);

      if (!tokenId) continue;

      const payload = {
        tokenId: tokenId,
        price: price ?? 0,
        sellerAddress: (maker?.address || "unknown").toLowerCase(),
        seaportOrder: protocol || ord,
        orderHash: orderHash || `${tokenId}-${maker?.address || 'unknown'}`,
        image: image || null,
        marketplaceContract: PROXY_CONTRACT_ADDRESS
      };

      totalScanned++;
      const ok = await postOrderToBackend(payload);
      if (ok) totalSent++;
      // small delay to avoid bursts
      await sleep(200);
    }

    cursor = data.next || data.cursor || null;
    if (!cursor) break;
    // be polite
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