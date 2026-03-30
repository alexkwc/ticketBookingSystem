import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

pool.on("error", (err: Error) => {
  console.error("Unexpected PostgreSQL error:", err);
});

export { pool };
