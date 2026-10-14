import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
const cfg = JSON.parse(readFileSync("wrangler.preview.jsonc", "utf8").replace(/\/\/.*$/gm, ""));
if (cfg.name !== "fx-analysis-v2-preview" || cfg.routes || cfg.triggers) {
  console.error("REFUSING: preview config must be name fx-analysis-v2-preview, no routes, no crons");
  process.exit(1);
}
console.log("OK — deploying", cfg.name);
execSync("npx wrangler deploy -c wrangler.preview.jsonc", { stdio: "inherit" });
