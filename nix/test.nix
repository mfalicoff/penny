# End-to-end check of the NixOS module: `nix flake check` (or `nix build .#checks.x86_64-linux.nixos`).
# Boots PostgreSQL, the migration, the API and nginx, then signs up and reads the session
# through the same origin a browser would use.
{ self, pkgs }:

pkgs.testers.runNixOSTest {
  name = "penny";

  nodes.machine = { pkgs, ... }: {
    imports = [ self.nixosModules.penny ];
    virtualisation.memorySize = 3072;
    virtualisation.diskSize = 4096;
    environment.systemPackages = [ pkgs.curl pkgs.jq ];

    # The alias the module provides; services.penny works the same.
    programs.penny = {
      enable = true;
      hostName = "localhost";
      publicOrigins = [ "http://localhost" ];
      settings.Logging.LogLevel.Default = "Information";
    };
  };

  testScript = ''
    machine.wait_for_unit("penny.service")
    machine.wait_for_unit("nginx.service")
    machine.wait_until_succeeds("curl -fsS http://localhost/api/ready | jq -e '.ok == true'", timeout=180)

    # Static app and SPA fallback.
    machine.succeed("curl -fsS http://localhost/ | grep -qi '<html'")
    machine.succeed("curl -fsS http://localhost/some/deep/link | grep -qi '<html'")

    # The generated receipt key is private to the service user.
    machine.succeed("test \"$(stat -c '%U %a' /var/lib/penny/receipt-master-key)\" = 'penny 600'")

    # Sign up and use the session cookie through nginx.
    machine.succeed(
      "curl -fsS -c /tmp/jar -H 'Origin: http://localhost' -H 'Content-Type: application/json' "
      "-d '{\"email\":\"nix@example.com\",\"password\":\"correct horse battery staple\"}' "
      "http://localhost/api/auth/register"
    )
    machine.succeed("curl -fsS -b /tmp/jar http://localhost/api/auth/me | grep -q nix@example.com")

    # Cross-origin writes are rejected.
    machine.fail(
      "curl -fsS -H 'Origin: http://evil.example' -H 'Content-Type: application/json' "
      "-d '{\"email\":\"x@example.com\",\"password\":\"correct horse battery staple\"}' "
      "http://localhost/api/auth/register"
    )

    # Restarting re-runs nothing destructive and the API comes back ready.
    machine.succeed("systemctl restart penny-migrate.service penny.service")
    machine.wait_until_succeeds("curl -fsS http://localhost/api/ready | jq -e '.ok == true'", timeout=120)

    # Maintenance commands run with the service's configuration.
    machine.succeed("penny-manage reset-password nix@example.com")
  '';
}
