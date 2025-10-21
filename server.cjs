// server.cjs  (CommonJS, no ESM)
const Fastify = require('fastify');
const cors = require('@fastify/cors');
const { Pool } = require('pg');
const crypto = require('crypto');

const app = Fastify({ logger: true });

// Postgres pool (Railway DB often needs SSL)
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('railway.app')
    ? { rejectUnauthorized: false }
    : false,
});

// keep raw body for HMAC signature verification (needed by the webhook)
app.addContentTypeParser('*', { parseAs: 'buffer' }, function (req, body, done) {
  req.rawBody = body || Buffer.from('');
  try {
    const parsed = body && body.length ? JSON.parse(body.toString()) : {};
    done(null, parsed);
  } catch (_err) {
    // If not valid JSON, provide empty parsed body but keep rawBody
    done(null, {});
  }
});

function verifySignature(rawBody, signatureHeader, secret) {
  if (!secret || !signatureHeader) return false;
  // signatureHeader may be like "sha256=<hex>" or just "<hex>"
  const sent = signatureHeader.startsWith('sha256=') ? signatureHeader.split('=')[1] : signatureHeader;
  const digestHex = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(digestHex, 'hex'), Buffer.from(sent, 'hex'));
  } catch {
    return false;
  }
}

/* --------------------------- PUBLIC HEALTH ROUTE --------------------------- */
// This MUST stay public so external checkers (and your Supabase proxy test) get 200.
app.get('/health', async (_req, reply) => {
  return reply.code(200).send({
    ok: true,
    service: 'mmap-api',
    timestamp: new Date().toISOString(),
  });
});

/* -------------------------- AUTH GATE FOR OTHER ROUTES --------------------- */
app.addHook('preHandler', async (req, reply) => {
  const rawUrl = (req.raw && req.raw.url) ? req.raw.url : req.url || '';

  // Allow these unauthenticated:
  if (rawUrl.startsWith('/lovable-webhook')) return;
  if (rawUrl === '/health') return; // health is intentionally public

  // Accept either demo header OR bearer token:
  const expectedDemo = process.env.DEMO_TOKEN || 'letmein';
  const gotDemo = req.headers['x-demo-token'];

  const authHeader = req.headers['authorization'] || '';
  const gotBearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const expectedBearer = process.env.MMAP_API_TOKEN;

  if (gotDemo === expectedDemo) return;
  if (expectedBearer && gotBearer === expectedBearer) return;

  return reply.code(401).send({ error: 'Unauthorized. Provide x-demo-token or Authorization: Bearer.' });
});

/* ------------------------------- ROOT STATUS ------------------------------- */
app.get('/', async (_req, reply) => {
  reply.send({ status: 'ok', service: 'MMAP API (demo)' });
});

/* ------------------------------ ROUTE INSPECTOR ---------------------------- */
app.get('/__routes', (_req, reply) => {
  reply.send({ routes: app.printRoutes() });
});

/* ------------------------------ STUDENTS (DB) ------------------------------ */
// Students from DB (query param OR header for school_id)
app.get('/v1/students-db', async (req, reply) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const schoolId = req.headers['x-school-id'] || url.searchParams.get('school_id');
  if (!schoolId) return reply.code(400).send({ error: 'Missing school_id' });

  const { rows } = await db.query(
    `SELECT id, first_name, last_name, classroom_id, dob
     FROM students
     WHERE school_id = $1
     ORDER BY last_name
     LIMIT 500`,
    [schoolId]
  );
  reply.send({ students: rows });
});

/* ------------------------------ LOVABLE WEBHOOK ---------------------------- */
app.post('/lovable-webhook', async (request, reply) => {
  // Accept common signature header names; adjust if Lovable uses a different header
  const sig = request.headers['x-lovable-signature']
    || request.headers['x-hub-signature-256']
    || request.headers['x-hub-signature']
    || '';
  const secret = process.env.LOVABLE_WEBHOOK_SECRET;
  if (!verifySignature(request.rawBody || Buffer.from(''), sig, secret)) {
    app.log.warn('Invalid webhook signature');
    return reply.code(401).send({ error: 'Invalid signature' });
  }

  const payload = request.body || {};
  app.log.info({ payload }, 'received lovable webhook');

  // Example: respond to an event key if present
  // if (payload && payload.event === 'something') { ... }

  return reply.code(200).send({ ok: true });
});

/* --------------------------------- STARTUP --------------------------------- */
async function start() {
  await app.register(cors, { origin: true });
  const PORT = process.env.PORT || 4000; // Railway injects PORT
  try {
    await app.listen({ port: PORT, host: '0.0.0.0' });
    console.log(`✅ MMAP API running on port ${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}
start();