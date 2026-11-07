const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { parse } = require("dotenv");

const databaseDirectory = path.resolve(__dirname, "..");
const envFile = path.resolve(databaseDirectory, "../../.env.production");

try {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== "--check")) {
    throw new Error("Usage: pnpm db:migrate:prod [--check]");
  }
  if (!fs.existsSync(envFile)) {
    throw new Error("Missing root .env.production; production migrations were not started.");
  }
  // Parse the selected file explicitly. Do not inherit another DATABASE_URL or
  // expand dollar signs that may be literal characters in a password.
  const { DATABASE_URL } = parse(fs.readFileSync(envFile));
  if (!DATABASE_URL?.trim()) {
    throw new Error("DATABASE_URL is missing from .env.production.");
  }
  let validUrl = false;
  try {
    validUrl = ["postgres:", "postgresql:"].includes(new URL(DATABASE_URL).protocol);
  } catch {
    // Avoid exposing the URL through a URL parser's diagnostic output.
  }
  if (!validUrl) throw new Error("DATABASE_URL must be a PostgreSQL connection URL.");

  if (args[0] === "--check") {
    console.log("Production migration configuration is valid. No database connection was opened.");
  } else {
    const result = spawnSync(
      process.execPath,
      [path.join(databaseDirectory, "node_modules/drizzle-kit/bin.cjs"), "migrate"],
      {
        cwd: databaseDirectory,
        env: { ...process.env, DATABASE_URL },
        stdio: "inherit",
      },
    );
    if (result.error) throw new Error("Could not start the Drizzle migration process.");
    process.exitCode = result.status ?? 1;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
