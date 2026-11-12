{
  description = "Penny: development environment, packages and a NixOS module for self-hosting";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";

  outputs = { self, nixpkgs, ... }:
    let
      lib = nixpkgs.lib;
      systems = [ "aarch64-darwin" "x86_64-darwin" "aarch64-linux" "x86_64-linux" ];
      linuxSystems = [ "aarch64-linux" "x86_64-linux" ];
      forSystems = list: f: lib.genAttrs list (system: f nixpkgs.legacyPackages.${system});
    in
    {
      overlays.default = final: _prev: {
        penny-api = final.callPackage ./nix/packages/api.nix { };
        penny-web = final.callPackage ./nix/packages/web.nix { };
        penny-search-model = final.callPackage ./nix/packages/model.nix { };
      };

      packages = forSystems systems (pkgs:
        let
          penny = self.overlays.default pkgs pkgs;
          selfHosting = lib.optionalAttrs (lib.elem pkgs.stdenv.hostPlatform.system linuxSystems)
            (penny // { default = penny.penny-api; });
        in
        selfHosting // {
          # PostgreSQL 18 with pgvector for disposable test environments without a container
          # runtime (`PENNY_POSTGRES=native`, scripts/test-env). Build it on demand with
          # `nix build .#test-postgres` and point PENNY_POSTGRES_BIN at its bin. Deliberately
          # not in the dev shell: entering the project should not fetch or provide a database.
          # pgvector is pinned to the backend's reference image (apps/backend/compose.yaml,
          # DatabaseSchema.cs), since nixpkgs' can trail it; change the three together.
          test-postgres = pkgs.postgresql_18.withPackages (ps: [
            (ps.pgvector.overrideAttrs (_: rec {
              version = "0.8.7";
              src = pkgs.fetchFromGitHub {
                owner = "pgvector";
                repo = "pgvector";
                tag = "v${version}";
                hash = "sha256-YYXz8zqiuqYWpJwImAhMry/QTLHKOP5MzuY0Of+aflc=";
              };
            }))
          ]);
        });

      nixosModules = {
        penny = import ./nix/module.nix { inherit self; };
        default = self.nixosModules.penny;
      };

      checks = forSystems [ "x86_64-linux" ] (pkgs: {
        nixos = import ./nix/test.nix { inherit self pkgs; };
      });

      devShells = forSystems systems (pkgs: {
        default = pkgs.mkShell ({
          packages = with pkgs; [
            nodejs_24
            sqlite
            # Receipt OCR (MAZ-125): the API's text extraction and its tests need
            # Tesseract with English and French data and poppler's pdftotext/pdftoppm.
            (tesseract.override { enableLanguages = [ "eng" "fra" ]; })
            poppler-utils
          ];
        } // lib.optionalAttrs pkgs.stdenv.hostPlatform.isLinux {
          # The Aspire dashboard (apps/backend/src/Penny.Backend.AppHost, MAZ-138) is a
          # prebuilt native binary that loads libicu from the library path, which NixOS
          # does not provide globally.
          LD_LIBRARY_PATH = lib.makeLibraryPath [ pkgs.icu ];
        });
      });
    };
}
