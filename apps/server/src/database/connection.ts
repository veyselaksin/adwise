import { existsSync } from "node:fs";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../generated/prisma/client.js";

export type Database = PrismaClient;

/**
 * A Prisma client over the case's SQLite file, opened read-only: SQLite itself
 * rejects any write. Fails when the file is missing, rather than letting SQLite
 * create an empty one.
 */
export function openDatabase(path: string): Database {
  if (!existsSync(path)) {
    throw new Error(`DB_PATH does not exist: ${path}`);
  }
  const adapter = new PrismaBetterSqlite3({ url: `file:${path}`, readonly: true, fileMustExist: true });
  return new PrismaClient({ adapter });
}
