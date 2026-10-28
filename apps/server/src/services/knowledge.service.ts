import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** The team's own documents, given to the agent verbatim on every question. */
export class KnowledgeService {
  private constructor(
    readonly glossary: string,
    readonly teamNotes: string,
  ) {}

  static async load(caseDir: string): Promise<KnowledgeService> {
    const read = (name: string) =>
      readFile(join(caseDir, name), "utf8").catch(() => {
        throw new Error(`CASE_DIR has no ${name}: ${caseDir}`);
      });
    const [glossary, teamNotes] = await Promise.all([read("glossary.md"), read("team-notes.md")]);
    return new KnowledgeService(glossary.trim(), teamNotes.trim());
  }
}
