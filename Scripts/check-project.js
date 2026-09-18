import { readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const required = [
  "package.json",
  "render.yaml",
  "Dockerfile",
  ".env.example",
  "src/index.js",
  "src/commands/limitedowners.js",
  "src/commands/roblox.js",
];

for (const file of required) {
  await readFile(path.join(root, file));
}

const jsFiles = await walk(path.join(root, "src"));
for (const file of jsFiles) {
  const result = spawnSync(process.execPath, ["--check", file], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status ?? 1);
  }
}

console.log(`Static check passed: ${jsFiles.length} source files checked.`);

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const output = [];
  for (const entry of entries) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) output.push(...(await walk(target)));
    else if (entry.isFile() && entry.name.endsWith(".js")) output.push(target);
  }
  return output;
}
