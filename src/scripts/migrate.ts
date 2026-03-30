import "dotenv/config";
import fs from "fs";
import path from "path";
import { pool } from "../config/db";

async function migrate(): Promise<void> {
  // Use process.cwd() so the path resolves correctly from both source and compiled output
  const migrationDir = path.join(process.cwd(), "migrations");
  const files = fs.readdirSync(migrationDir).sort();

  for (const file of files) {
    if (!file.endsWith(".sql")) continue;
    console.log(`Running migration: ${file}`);
    const sql = fs.readFileSync(path.join(migrationDir, file), "utf8");
    await pool.query(sql);
    console.log(`Done: ${file}`);
  }

  await pool.end();
}

migrate().catch((err: Error) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
