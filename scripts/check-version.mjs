import { readFileSync } from "node:fs";

const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const { version } = readJson("../package.json");
const lock = readJson("../package-lock.json");

// Store releases use three numeric components; prerelease suffixes are not valid on iOS.
if (typeof version !== "string" || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
  throw new Error("package.json version must be MAJOR.MINOR.PATCH without leading zeros or prerelease/build suffixes.");
}

if (lock.version !== version || lock.packages?.[""]?.version !== version) {
  throw new Error("package-lock.json version must match package.json. Use npm version to update both files.");
}

const ref = process.env.GITHUB_REF;
if (ref?.startsWith("refs/tags/") && ref !== `refs/tags/v${version}`) {
  throw new Error(`Release tag must be v${version}; received ${ref.slice("refs/tags/".length)}.`);
}

console.log(`Release version ${version} is consistent${ref?.startsWith("refs/tags/") ? ` with tag v${version}` : ""}.`);
