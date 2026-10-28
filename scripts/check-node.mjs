// pnpm checks `engines` only on install, not when running scripts. Without this,
// the wrong Node fails later with an unreadable error from better-sqlite3's native build.
import { readFileSync } from "node:fs";

const wanted = readFileSync(new URL("../.nvmrc", import.meta.url), "utf8").trim();
const current = process.versions.node;

if (current.split(".")[0] !== wanted.split(".")[0]) {
  console.error(
    `\nThis project needs Node ${wanted}, but this shell runs Node ${current}.\n` +
      `Run \`nvm use\` in the repo root (or \`nvm alias default ${wanted}\` to make it stick), then try again.\n`,
  );
  process.exit(1);
}
