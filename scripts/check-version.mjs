import { readFileSync } from "node:fs";

// The release version lives in apps/ios/Configuration/Version.xcconfig, the one file that ships
// it (the native app's marketing version). Release Please updates the line marked
// x-release-please-version; the container images take their version from the release tag.
const xcconfig = readFileSync(new URL("../apps/ios/Configuration/Version.xcconfig", import.meta.url), "utf8");
const version = xcconfig.match(/^MARKETING_VERSION = (\S+) \/\/ x-release-please-version$/m)?.[1];

// Store releases use three numeric components; prerelease suffixes are not valid on iOS.
if (typeof version !== "string" || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
  throw new Error("apps/ios/Configuration/Version.xcconfig MARKETING_VERSION must be MAJOR.MINOR.PATCH without leading zeros or prerelease/build suffixes, marked // x-release-please-version.");
}

const ref = process.env.GITHUB_REF;
if (ref?.startsWith("refs/tags/") && ref !== `refs/tags/v${version}`) {
  throw new Error(`Release tag must be v${version}; received ${ref.slice("refs/tags/".length)}.`);
}

console.log(`Release version ${version} is consistent${ref?.startsWith("refs/tags/") ? ` with tag v${version}` : ""}.`);
