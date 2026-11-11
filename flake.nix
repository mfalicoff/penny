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

      packages = forSystems linuxSystems (pkgs:
        let penny = self.overlays.default pkgs pkgs; in
        penny // { default = penny.penny-api; });

      nixosModules = {
        penny = import ./nix/module.nix { inherit self; };
        default = self.nixosModules.penny;
      };

      checks = forSystems [ "x86_64-linux" ] (pkgs: {
        nixos = import ./nix/test.nix { inherit self pkgs; };
      });

      devShells = forSystems systems (pkgs: {
        default = pkgs.mkShell {
          packages = with pkgs; [
            nodejs_24
            sqlite
          ];
        };
      });
    };
}
