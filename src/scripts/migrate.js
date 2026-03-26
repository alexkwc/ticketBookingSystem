require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { pool } = require("../config/db");

async function migrate() {
  const migrationDir = path.join(__dirname, "../../migrations");
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

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
