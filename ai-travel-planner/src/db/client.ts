/**
 * SQLite 连接(Drizzle)
 * 单例模式,避免 Next.js 开发模式热重载时重复打开数据库。
 */

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { getDatabaseUrl } from "@/lib/env";
import * as schema from "./schema";

type DB = BetterSQLite3Database<typeof schema>;

const globalForDb = globalThis as unknown as {
  __travelDb?: DB;
  __travelSqlite?: Database.Database;
};

function createDb(): { db: DB; sqlite: Database.Database } {
  const url = getDatabaseUrl();
  const file = path.isAbsolute(url) ? url : path.join(process.cwd(), url);
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");

  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}

function getOrCreate(): { db: DB; sqlite: Database.Database } {
  if (!globalForDb.__travelDb || !globalForDb.__travelSqlite) {
    const created = createDb();
    globalForDb.__travelDb = created.db;
    globalForDb.__travelSqlite = created.sqlite;
  }
  return { db: globalForDb.__travelDb!, sqlite: globalForDb.__travelSqlite! };
}

/** Drizzle 实例 */
export const db: DB = new Proxy({} as DB, {
  get(_t, prop) {
    const real = getOrCreate().db as unknown as Record<string | symbol, unknown>;
    const value = real[prop];
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(real) : value;
  },
});

/** 原始 better-sqlite3 句柄,用于执行 DDL / 手写 SQL */
export function rawDb(): Database.Database {
  return getOrCreate().sqlite;
}

export function dbFilePath(): string {
  const url = getDatabaseUrl();
  return path.isAbsolute(url) ? url : path.join(process.cwd(), url);
}

export { schema };
