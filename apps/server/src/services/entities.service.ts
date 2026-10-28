import type { EntitiesRepository } from "../database/repositories/entities.repository.js";
import type { Entities } from "../types/entities.type.js";

export class EntitiesService {
  constructor(private readonly repo: EntitiesRepository) {}

  /** Campaigns, ad sets and ads with their settings, for filters and labels. */
  async list(): Promise<Entities> {
    const [campaigns, adsets, ads] = await Promise.all([this.repo.campaigns(), this.repo.adsets(), this.repo.ads()]);
    return { campaigns, adsets, ads };
  }
}
