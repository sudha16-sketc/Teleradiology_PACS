import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (path) => JSON.parse(readFileSync(resolve(root, path), "utf8"));
const expected = readJson("package.json").version;
const versions = [
  ["apps/api/package.json", readJson("apps/api/package.json").version],
  ["apps/web/package.json", readJson("apps/web/package.json").version],
  ["apps/desktop/package.json", readJson("apps/desktop/package.json").version],
  ["packages/types/package.json", readJson("packages/types/package.json").version],
  [
    "apps/desktop/src-tauri/tauri.conf.json",
    readJson("apps/desktop/src-tauri/tauri.conf.json").version,
  ],
];

const cargo = spawnSync(
  "cargo",
  [
    "metadata",
    "--no-deps",
    "--format-version",
    "1",
    "--manifest-path",
    resolve(root, "apps/desktop/src-tauri/Cargo.toml"),
  ],
  { cwd: root, encoding: "utf8" },
);

if (cargo.error || cargo.status !== 0) {
  console.error(cargo.stderr || cargo.error?.message || "cargo metadata failed");
  process.exit(1);
}

const desktopCrate = JSON.parse(cargo.stdout).packages.find(
  (item) => item.name === "axis-desktop",
);
if (!desktopCrate) {
  console.error("Could not find axis-desktop in Cargo metadata.");
  process.exit(1);
}
versions.push(["apps/desktop/src-tauri/Cargo.toml", desktopCrate.version]);

const mismatches = versions.filter(([, version]) => version !== expected);
if (mismatches.length) {
  console.error(`Release version ${expected} does not match:`);
  for (const [source, version] of mismatches) {
    console.error(`  ${source}: ${version}`);
  }
  process.exit(1);
}

console.log(`Axis release version ${expected} is consistent across manifests.`);