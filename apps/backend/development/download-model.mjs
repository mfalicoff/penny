// Downloads the pinned search embedding model (MAZ-121) into the ignored model cache
// and verifies every file's SHA-256. The model is never committed to git. Re-running
// is cheap: files whose hash already matches are kept. Usage (from the repository
// root): node apps/backend/development/download-model.mjs [TARGET_DIRECTORY]
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

// intfloat/multilingual-e5-small (MIT), pinned to one Hugging Face commit. These hashes
// must match `EmbeddingModelFiles` in Penny.Backend.Persistence/Search.
const repository = "intfloat/multilingual-e5-small";
const revision = "614241f622f53c4eeff9890bdc4f31cfecc418b3";
const files = [
  { source: "onnx/model.onnx", target: "model.onnx", sha256: "ca456c06b3a9505ddfd9131408916dd79290368331e7d76bb621f1cba6bc8665" },
  { source: "onnx/sentencepiece.bpe.model", target: "sentencepiece.bpe.model", sha256: "cfc8146abe2a0488e9e2a0c56de7952f7c11ab059eca145a0a727afce0db2865" },
];

const target = path.resolve(
  process.argv[2] ?? fileURLToPath(new URL("../../../.cache/backend/models/multilingual-e5-small", import.meta.url)),
);
mkdirSync(target, { recursive: true });

async function sha256(file) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(file), hash);
  return hash.digest("hex");
}

for (const file of files) {
  const destination = path.join(target, file.target);
  if (existsSync(destination) && (await sha256(destination)) === file.sha256) {
    console.log(`ok ${file.target}`);
    continue;
  }
  const url = `https://huggingface.co/${repository}/resolve/${revision}/${file.source}`;
  console.log(`downloading ${file.target}`);
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}) for ${file.source}`);
  const partial = `${destination}.partial`;
  await pipeline(Readable.fromWeb(response.body), createWriteStream(partial, { mode: 0o644 }));
  const actual = await sha256(partial);
  if (actual !== file.sha256) {
    rmSync(partial, { force: true });
    throw new Error(`SHA-256 mismatch for ${file.source}: expected ${file.sha256}, got ${actual}`);
  }
  renameSync(partial, destination);
  console.log(`verified ${file.target}`);
}
console.log(`Model files are in ${target}`);
