import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { db, sqlite } from "./index.js";

console.log("Running migrations...");

migrate(db, { migrationsFolder: "./drizzle" });

console.log("Migrations complete.");

sqlite.close();
