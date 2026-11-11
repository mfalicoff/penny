# Self-hosting on NixOS

[App showcase](../README.md) · [Documentation](README.md) · [Self-hosting with Compose](deployment.md) · [Operations runbook](operations.md)

The repository's flake ships Penny as Nix packages and a NixOS module. One option turns on the same stack as [`deploy/compose.yaml`](deployment.md#topology), as native systemd services:

| Unit | Role |
| --- | --- |
| `postgresql.service` | PostgreSQL 18 with `pg_trgm` and pgvector (skipped with an [external database](#external-postgresql)) |
| `penny-db-setup.service` | One-shot, as `postgres`: creates the database, the `penny_migrator` and `penny_runtime` roles, the `penny` schema and the extensions. Idempotent; the Nix equivalent of `apps/backend/development/init-roles.sh` |
| `penny-migrate.service` | One-shot, as `penny`: `migrate --grant-runtime`. Generates the receipt master key on first start if you don't supply one |
| `penny.service` | The .NET API and its background workers, on `127.0.0.1:5080` |
| `nginx.service` | A virtual host that serves the web app, falls back to `index.html`, and proxies `/api/` to the API on the same origin |

The API connects to the local PostgreSQL over its Unix socket with peer authentication: the `penny` system user may log in as the two Penny roles, and no database passwords exist. Receipts and ASP.NET data-protection keys live in `/var/lib/penny`.

## Quick start

Add the flake to your system flake and import the module:

```nix
{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";
    penny.url = "github:mfalicoff/penny/v2";
  };

  outputs = { nixpkgs, penny, ... }: {
    nixosConfigurations.server = nixpkgs.lib.nixosSystem {
      system = "x86_64-linux";
      modules = [
        penny.nixosModules.default
        ./configuration.nix
      ];
    };
  };
}
```

Then in `configuration.nix`:

```nix
{
  programs.penny = {                # alias of services.penny
    enable = true;
    hostName = "penny.example.com";
  };

  # TLS for the virtual host the module creates.
  services.nginx.virtualHosts."penny.example.com" = {
    enableACME = true;
    forceSSL = true;
  };
  security.acme = {
    acceptTerms = true;
    defaults.email = "you@example.com";
  };
  networking.firewall.allowedTCPPorts = [ 80 443 ];
}
```

`services.penny` and `programs.penny` are the same options. NixOS calls system daemons `services.*`, so the module defines `services.penny`; `programs.penny` is an alias for it.

After `nixos-rebuild switch`, open `https://penny.example.com`, create your account, and turn off open registration:

```nix
programs.penny.allowRegistration = false;
```

Check that `https://penny.example.com/api/ready` returns `{"ok":true}`. Mobile users choose that HTTPS origin on the sign-in screen.

**Back up the receipt master key.** Unless you set `receiptKeyFile`, it's generated on first start at `/var/lib/penny/receipt-master-key`. Without it, stored receipts can't be decrypted. Keep it apart from your database backups ([backups](operations.md#back-up)).

## Options

All options live under `services.penny` (or `programs.penny`).

| Option | Default | Purpose |
| --- | --- | --- |
| `enable` | `false` | Turn the stack on |
| `hostName` | (required) | nginx virtual host name |
| `publicOrigins` | `[ "https://<hostName>" ]` | Exact browser origins (`Auth__AllowedOrigins`). Use `http://` only for localhost |
| `secureCookies` | `true` if every origin is `https://` | `Auth__SecureCookies` |
| `allowRegistration` | `true` | Password sign-up (`Auth__AllowRegistration`) |
| `receiptKeyFile` | `null` (generated in `stateDir`) | Base64 of 32 random bytes. Read through systemd credentials, so a root-owned secret (agenix, sops-nix) works |
| `environmentFiles` | `[ ]` | systemd environment files for secrets such as `Oidc__ClientSecret` or `Push__Apns__PrivateKey` |
| `settings` | `{ }` | Any API setting from the [configuration table](deployment.md#deployapienv-optional-api-settings), as nested attributes |
| `listenAddress` / `port` | `127.0.0.1` / `5080` | API listener; nginx proxies to it |
| `trustedProxies` | `[ "127.0.0.1/32" "::1/128" ]` | `Auth__TrustedProxies`: the local nginx |
| `stateDir` | `/var/lib/penny` | Receipts (`receipts/`), generated key, data-protection keys |
| `user` / `group` | `penny` / `penny` | Service account |
| `package` / `webPackage` / `searchModel` | the flake's `penny-api` / `penny-web` / `penny-search-model` | Override to pin or patch builds |
| `database.createLocally` | `true` | Run and configure PostgreSQL 18 on this host |
| `database.name` / `host` / `port` | `penny` / `/run/postgresql` / `5432` | Database location; `host` may be a socket directory |
| `database.migrationUser` / `runtimeUser` | `penny_migrator` / `penny_runtime` | Role names |
| `database.migrationPasswordFile` / `runtimePasswordFile` | `null` | External databases only |
| `database.sslMode` | `VerifyFull` | Npgsql `SSL Mode` for an external database |
| `database.extraConnectionOptions` | `""` | Appended to both connection strings, starting with `;` |
| `nginx.enable` | `true` | Create the nginx virtual host. Turn it off to use another front end (see below) |
| `nginx.maxBodySize` | `21m` | `client_max_body_size`, just above the API's 20 MiB limit |
| `nginx.realIpFrom` | `[ ]` | CIDRs of outer proxies (a CDN or load balancer) whose `X-Forwarded-For` nginx trusts |

### `settings`

Nested attributes become ASP.NET's double-underscore names, and lists are joined with commas. Values in `settings` take precedence over the ones the module derives from the options above.

```nix
programs.penny.settings = {
  Oidc = {
    Issuer = "https://identity.example.com/realms/penny";
    ClientId = "penny";
    RedirectUris = [ "https://penny.example.com/auth/callback" "penny://auth/callback" ];
    Label = "Single sign-on";
  };
  Push.Apns = { TeamId = "ABCDE12345"; KeyId = "XYZ987"; Topic = "com.example.penny"; };
  Database.MaxPoolSize = 20;
  Logging.LogLevel.Default = "Warning";
  OTEL_EXPORTER_OTLP_ENDPOINT = "http://127.0.0.1:4317";
};

# Secrets stay out of the Nix store:
programs.penny.environmentFiles = [ "/run/secrets/penny.env" ];
# /run/secrets/penny.env:
#   Oidc__ClientSecret=...
#   Push__Apns__PrivateKey=-----BEGIN PRIVATE KEY-----\n...
```

`settings` ends up in the Nix store, which is world-readable. Put anything secret in `environmentFiles`.

## Maintenance commands

`penny-manage` runs the API's maintenance commands with the service's configuration and secrets, as the `penny` user:

```sh
sudo penny-manage reset-password someone@example.com
sudo penny-manage search-verify
sudo penny-manage receipts-verify
```

## Upgrades

Update the flake input (`nix flake update penny`) and run `nixos-rebuild switch`. A new package restarts `penny-migrate.service`, which applies any new migrations under the migration lock, and then `penny.service`. Read the release notes and take a backup first, as described in [Upgrade](deployment.md#upgrade). The [roll-back rules](deployment.md#roll-back) apply unchanged: after a migration, the previous build refuses the newer schema.

## PostgreSQL version

Penny needs PostgreSQL 18, and its readiness check rejects other majors. The module sets `services.postgresql.package` to `postgresql_18`. That's stronger than the `system.stateVersion` default but weaker than a plain definition, and evaluation fails if the result isn't version 18. If this host already runs an older PostgreSQL cluster for other services, upgrade that cluster first (see the NixOS manual, "Upgrading PostgreSQL"), or run Penny against an [external PostgreSQL](#external-postgresql).

## External PostgreSQL

Prepare the database as in [External PostgreSQL](deployment.md#external-postgresql): the two roles with passwords, the `penny` schema owned by `penny_migrator`, and `pg_trgm` and `vector` created by an administrator. Then:

```nix
programs.penny.database = {
  createLocally = false;
  host = "db.internal.example.com";
  sslMode = "VerifyFull";
  migrationPasswordFile = "/run/secrets/penny-migrator-password";
  runtimePasswordFile = "/run/secrets/penny-runtime-password";
  # extraConnectionOptions = ";Root Certificate=/run/secrets/db-ca.pem";
};
```

The password files are read through systemd credentials, so they may be owned by root. Passwords must not contain `;`. A connection pooler must run in session mode.

## Another front end

With `nginx.enable = false`, the module only runs the API. Serve `webPackage` (a static document root) from your own server, with the same rules as [`deploy/web/default.conf.template`](../deploy/web/default.conf.template):

- SPA fallback: unknown paths return `index.html`, sent with `Cache-Control: no-cache`.
- `/api/` goes to `http://127.0.0.1:5080`. Replace `X-Forwarded-For` with the peer address rather than appending to it, don't buffer request bodies, and allow bodies of at least 21 MB and reads of at least 60 seconds.

For example, with Caddy:

```nix
services.caddy.virtualHosts."penny.example.com".extraConfig = ''
  request_body { max_size 21MB }
  handle /api/* {
    reverse_proxy 127.0.0.1:5080 {
      header_up X-Forwarded-For {remote_host}
    }
  }
  handle {
    root * ${config.services.penny.webPackage}
    try_files {path} /index.html
    file_server
  }
'';
```

## Packages

| Package | Contents |
| --- | --- |
| `penny-api` | The API (`bin/penny-api`). Its NuGet dependencies are locked in `nix/packages/api-deps.json` |
| `penny-web` | The v2 web app in `apps/web` |
| `penny-search-model` | The pinned multilingual-e5-small embedding model, hash-checked |

`nix build github:mfalicoff/penny/v2#penny-api` builds them outside NixOS. They're also available as `overlays.default`.

When dependencies change, refresh the locks:

- **NuGet:** `nix build .#penny-api.fetch-deps && ./result nix/packages/api-deps.json`
- **npm:** set `npmDepsHash` in `nix/packages/web.nix` to `""`, build, and copy the hash that Nix reports.

## Testing the module

`nix flake check` runs a NixOS VM test (`nix/test.nix`). It boots the whole stack, waits for `/api/ready`, loads the app and a deep link, signs up and reads the session through nginx, checks that a cross-origin write gets a 403, restarts the services, and issues a password reset with `penny-manage`. It needs KVM on x86_64-linux.
