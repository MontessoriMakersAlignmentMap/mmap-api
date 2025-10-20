// server.cjs  (CommonJS, no ESM)
const Fastify = require('fastify');
const cors = require('@fastify/cors');
const { Pool } = require('pg');

const app = Fastify({ logger: true });

// Postgres pool (Railway DB often needs SSL)
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('railway.app')
    ? { rejectUnauthorized: false }
    : false,
});

// Tiny lock so randos can’t hit your API
app.addHook('preHandler', async (req, reply) => {
  const expected = process.env.DEMO_TOKEN || 'letmein';
  const got = req.headers['x-demo-token'];
  if (!got || got !== expected) {
    return reply.code(401).send({ error: 'Unauthorized. Add header x-demo-token: letmein' });
  }
});

// Health
app.get('/', async (_req, reply) => {
  reply.send({ status: 'ok', service: 'MMAP API (demo)' });
});

// Route list (debug helper)
app.get('/__routes', (_req, reply) => {
  reply.send({ routes: app.printRoutes() });
});

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

async function start() {
  await app.register(cors, { origin: true });
  const PORT = process.env.PORT || 4000; // Railway injects PORT
  try {
    await app.listen({ port: PORT, host: '0.0.0.0' });
    console.log(`✅ MMAP API (demo) running on port ${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}
start();

