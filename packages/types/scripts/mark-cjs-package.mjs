import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const outputDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../dist/cjs",
);

await mkdir(outputDirectory, { recursive: true });
await writeFile(
  resolve(outputDirectory, "package.json"),
  `${JSON.stringify({ type: "commonjs" })}\n`,
);
