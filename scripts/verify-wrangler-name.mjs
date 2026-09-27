import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const raw = readFileSync(join(root, "wrangler.jsonc"), "utf8");
const cleaned = raw.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
const cfg = JSON.parse(cleaned);
console.log("wrangler name:", cfg.name);
if (cfg.name !== "fx-analysis-v2") {
  console.error("REFUSING DEPLOY: name must be exactly fx-analysis-v2, got:", cfg.name);
  process.exit(1);
}
if (cfg.triggers?.crons?.length) {
  console.error("REFUSING DEPLOY: v2 must have no cron triggers");
  process.exit(1);
}
console.log("OK — deploying Worker fx-analysis-v2 only");
