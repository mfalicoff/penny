{
  description = "Penny development environment";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";

  outputs = { nixpkgs, ... }:
    let
      systems = [ "aarch64-darwin" "x86_64-darwin" "aarch64-linux" "x86_64-linux" ];
    in
    {
      # PostgreSQL 18 with pgvector for disposable test environments without a container
      # runtime (`PENNY_POSTGRES=native`, scripts/test-env). Build it on demand with
      # `nix build .#test-postgres` and point PENNY_POSTGRES_BIN at result/bin. Deliberately
      # not in the dev shell: entering the project should not fetch or provide a database.
      packages = nixpkgs.lib.genAttrs systems (system:
        let
          pkgs = import nixpkgs { inherit system; };
        in
        {
          test-postgres = pkgs.postgresql_18.withPackages (ps: [ ps.pgvector ]);
        });

      devShells = nixpkgs.lib.genAttrs systems (system:
        let
          pkgs = import nixpkgs { inherit system; };
        in
        {
          default = pkgs.mkShell {
            packages = with pkgs; [
              nodejs_24
              sqlite
            ];
          };
        });
    };
}
