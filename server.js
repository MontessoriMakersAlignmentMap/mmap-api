import pkg from "pg";
const { Pool } = pkg;
const db = new Pool({ connectionString: process.env.DATABASE_URL });// server.js — super simple, NO LOCK, just to confirm it works
import Fastify from "fastify";

const app = Fastify({ logger: true });

// --- DEMO DATA ---
const demoStudents = [
  { id: "stu-001", first_name: "Artemisia", last_name: "Richardson-Hatcher", classroom_id: "primary-a", dob: "2015-09-22" },
  { id: "stu-002", first_name: "Macatee",    last_name: "Richardson-Hatcher", classroom_id: "primary-a", dob: "2020-06-17" },
  { id: "stu-003", first_name: "Jamal",      last_name: "Ortiz",              classroom_id: "lower-el-1", dob: "2014-02-08" },
  { id: "stu-004", first_name: "Sofia",      last_name: "Nguyen",             classroom_id: "lower-el-1", dob: "2013-11-30" }
];

// Health check
app.get("/", async () => ({ status: "ok", service: "MMAP API (no-lock test)" }));

// List students
app.get("/v1/students", async (req, reply) => {
  reply.send({ students: demoStudents });
});

// Simple assessment plan (demo)
app.post("/v1/assessments/:studentId/plan", async (req, reply) => {
  const { studentId } = req.params;
  const student = demoStudents.find(s => s.id === studentId);
  if (!student) return reply.code(404).send({ error: "Student not found" });
  reply.send({
    studentId,
    windowWeeks: 6,
    focus: "literacy",
    goals: [
      { skill: "phonemic awareness", suggested_lessons: ["Sound Sorting", "Phonogram 3-Part Cards"] },
      { skill: "decoding (CVC)",     suggested_lessons: ["Pink Box 1", "Moveable Alphabet — CVC"] }
    ]
  });
});

const start = async () => {
  try {
    await app.listen({ port: 4000, host: "0.0.0.0" });
    console.log("✅ MMAP API (no-lock) running at http://localhost:4000");
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};
start();// reads students from the database for a school
app.get(app.get("/v1/students-db", async (req, reply) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const schoolId =
    req.headers["x-school-id"] || url.searchParams.get("school_id"); // header OR ?school_id=…

  if (!schoolId) {
    return reply.code(400).send({ error: "Missing school_id (header or ?school_id=…)" });
  }

  const { rows } = await db.query(
    "SELECT id, first_name, last_name, classroom_id, dob FROM students WHERE school_id = $1 ORDER BY last_name LIMIT 500",
    [schoolId]
  );
  reply.send({ students: rows });
});, async (req, reply) => {
  const schoolId = req.headers["x-school-id"]; // simple for now
  if (!schoolId) return reply.code(400).send({ error: "Missing x-school-id header" });

  const { rows } = await db.query(
    "SELECT id, first_name, last_name, classroom_id, dob FROM students WHERE school_id = $1 ORDER BY last_name LIMIT 500",
    [schoolId]
  );
  reply.send({ students: rows });
});
import Fastify from "fastify";
import cors from "@fastify/cors";   // ← add this

const app = Fastify({ logger: true });
await app.register(cors, { origin: true }); // ← add this (lets browser call your API)