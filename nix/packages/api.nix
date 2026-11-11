# The Penny ASP.NET Core API (apps/backend). Produces `bin/penny-api`, which runs the HTTP
# host and the maintenance commands (`penny-api migrate --grant-runtime`, `reset-password`, …).
# Regenerate deps.json after a NuGet change: `nix build .#penny-api.fetch-deps && ./result nix/packages/api-deps.json`.
{ lib
, buildDotnetModule
, dotnetCorePackages
, stdenv
, version ? "0.0.0-nix"
}:

buildDotnetModule {
  pname = "penny-api";
  inherit version;

  src = lib.fileset.toSource {
    root = ../../apps/backend;
    fileset = lib.fileset.unions [
      ../../apps/backend/Directory.Build.props
      ../../apps/backend/Directory.Packages.props
      ../../apps/backend/NuGet.Config
      ../../apps/backend/.editorconfig
      ../../apps/backend/development/grant-runtime.sql
      (lib.fileset.difference ../../apps/backend/src
        (lib.fileset.fileFilter (f: f.name == "bin" || f.name == "obj") ../../apps/backend/src))
    ];
  };

  projectFile = "src/Penny.Backend.Api/Penny.Backend.Api.csproj";
  nugetDeps = ./api-deps.json;

  dotnet-sdk = dotnetCorePackages.sdk_10_0;
  dotnet-runtime = dotnetCorePackages.aspnetcore_10_0;

  # Lock files pin the portable restore graph; Nix restores for one runtime identifier.
  dotnetRestoreFlags = [ "-p:RestoreLockedMode=false" ];
  dotnetFlags = [
    "-p:Version=${lib.head (lib.splitString "-" version)}"
    "-p:InformationalVersion=${version}"
    "-p:GenerateDocumentationFile=false"
  ];

  executables = [ "Penny.Backend.Api" ];

  # Microsoft.ML.OnnxRuntime ships a prebuilt libonnxruntime.so that links libstdc++.
  runtimeDeps = [ stdenv.cc.cc.lib ];

  postFixup = ''
    mv $out/bin/Penny.Backend.Api $out/bin/penny-api
  '';

  meta = {
    description = "Penny household expense tracker API";
    homepage = "https://github.com/mfalicoff/penny";
    mainProgram = "penny-api";
    platforms = lib.platforms.linux;
  };
}
