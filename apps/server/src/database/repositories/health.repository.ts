import type { Database } from "../connection.js";

/** Connectivity check against the case data: a trivial read, nothing else. */
export class HealthRepository {
  constructor(private readonly db: Database) {}

  async ping(): Promise<void> {
    await this.db.$queryRaw`SELECT 1`;
  }
}
