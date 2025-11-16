// server.js — BearHustle Backend 🦧
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { nanoid } from 'nanoid';
import postgres from 'postgres';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

// ---------- POSTGRES SETUP ----------
const connectionString =
  process.env.DATABASE_URL ||
  "postgresql://postgres:kamofeko123@db.bvrgcipytaivvnkvdwkf.supabase.co:5432/postgres";

// Note: postgres lib expects a valid URL; if your password contains special chars, use percent-encoding or set env via Render dashboard.
const sql = postgres(connectionString, { ssl: { rejectUnauthorized: false } });

// ---------- EXPRESS SETUP ----------
const app = express();
app.use(helmet());
app.use(express.json({ limit: '2mb' }));
app.use(cors({ origin: '*' }));

const PORT = process.env.PORT || 3000;

// ---------- PATH ----------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------- KONTRAKT ADRESSLƏRİ ----------
const NFT_CONTRACT_ADDRESS =
  process.env.NFT_CONTRACT_ADDRESS || "0x54a88333F6e7540eA982261301309048aC431eD5";
const PROXY_CONTRACT_ADDRESS =
  process.env.PROXY_CONTRACT_ADDRESS || "0x9656448941C76B79A39BC4ad68f6fb9F01181EC7";

// ---------- STATİK FAYLAR ----------
const distPath = path.join(__dirname, 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
} else {
  app.use(express.static(__dirname));
}

// ---------- ROOT ROUTE ----------
app.get('/', (req, res) => {
  const indexFile = fs.existsSync(path.join(distPath, 'index.html'))
    ? path.join(distPath, 'index.html')
    : path.join(__dirname, 'index.html');
  res.sendFile(indexFile);
});

// simple health check
app.get('/api/status', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// ---------- POST /order ----------
app.post('/order', async (req, res) => {
  try {
    const { tokenId, price, sellerAddress, seaportOrder, orderHash, image, marketplaceContract } = req.body;

    if (!tokenId || (!price && price !== 0) || !sellerAddress || !seaportOrder)
      return res.status(400).json({ success: false, error: 'Missing parameters' });

    const id = nanoid();
    const createdAt = new Date().toISOString();
    const seaportOrderString = typeof seaportOrder === 'string' ? seaportOrder : JSON.stringify(seaportOrder);

    await sql`
      INSERT INTO orders (
        id, tokenId, price, nftContract, marketplaceContract, seller, seaportOrder, orderHash, onChain, image, createdAt
      ) VALUES (
        ${id}, ${tokenId.toString()}, ${price.toString()}, ${NFT_CONTRACT_ADDRESS}, ${marketplaceContract || PROXY_CONTRACT_ADDRESS},
        ${sellerAddress.toLowerCase()}, ${seaportOrderString}, ${orderHash || null}, ${!!orderHash}, ${image || null}, ${createdAt}
      )
    `;

    res.json({ success: true, order: { id, tokenId, price, seller: sellerAddress, createdAt } });
  } catch (e) {
    console.error('POST /order error', e);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// ---------- GET /orders (pagination and optional address filter) ----------
app.get('/orders', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '12', 10)));
    const addr = req.query.address ? req.query.address.toLowerCase() : null;
    const offset = (page - 1) * limit;

    let rows;
    if (addr) {
      rows = await sql`
        SELECT * FROM orders WHERE seller = ${addr} ORDER BY "createdAt" DESC LIMIT ${limit} OFFSET ${offset}
      `;
    } else {
      rows = await sql`
        SELECT * FROM orders ORDER BY "createdAt" DESC LIMIT ${limit} OFFSET ${offset}
      `;
    }

    const orders = rows.map(r => {
      const copy = { ...r };
      if (copy.seaportOrder) {
        try { copy.seaportOrder = typeof copy.seaportOrder === 'string' ? JSON.parse(copy.seaportOrder) : copy.seaportOrder; } catch {}
      }
      return copy;
    });

    res.json({ success: true, orders });
  } catch (e) {
    console.error('GET /orders error', e);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// ---------- SERVER START ----------
app.listen(PORT, () => console.log(`🚀 Backend ${PORT}-də işləyir`));