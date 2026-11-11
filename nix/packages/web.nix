# The v2 browser app (apps/web: React, Vite, TanStack). The output is a static document
# root: serve it with SPA fallback to index.html and /api/ proxied to the API. The bundle
# contains no server URL; the browser calls /api/ on its own origin.
#
# After a lockfile change, set npmDepsHash to "", build, and paste the hash Nix reports.
{ lib
, buildNpmPackage
, nodejs_24
}:

buildNpmPackage {
  pname = "penny-web";
  version = "0.0.0-nix";

  # apps/web imports ../../design-kit (fonts, icons, styles), so the source is the
  # repository root narrowed to those two directories.
  src = lib.fileset.toSource {
    root = ../..;
    fileset = lib.fileset.difference
      (lib.fileset.unions [ ../../apps/web ../../design-kit ])
      (lib.fileset.unions (map lib.fileset.maybeMissing [
        ../../apps/web/node_modules
        ../../apps/web/dist
        ../../apps/web/test-results
        ../../apps/web/playwright-report
        ../../design-kit/node_modules
      ]));
  };
  sourceRoot = "source/apps/web";

  npmDepsHash = "sha256-GxxRByRAIa5ksbuvQeu7VeiKnFi+5ylJ943e9jxTCOg=";
  npmDepsFetcherVersion = 2;
  makeCacheWritable = true;
  nodejs = nodejs_24;

  env.CI = "1";

  installPhase = ''
    runHook preInstall
    cp -r dist $out
    runHook postInstall
  '';

  meta = {
    description = "Penny v2 web app";
    homepage = "https://github.com/mfalicoff/penny";
    platforms = lib.platforms.all;
  };
}
