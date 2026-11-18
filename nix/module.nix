# NixOS module for self-hosting Penny v2: PostgreSQL 18 (with pg_trgm and pgvector), the
# .NET API (it migrates the database on startup) and nginx serving the web app with a same-origin
# /api/ proxy. The same topology as deploy/compose.yaml, as native systemd services.
#
#   services.penny = {            # `programs.penny` is an alias
#     enable = true;
#     hostName = "penny.example.com";
#   };
#   services.nginx.virtualHosts."penny.example.com" = { enableACME = true; forceSSL = true; };
#
# See docs/self-hosting/nixos.md.
{ self }:

{ config, lib, pkgs, ... }:

let
  cfg = config.services.penny;
  db = cfg.database;
  mail = cfg.inboundMail;
  system = pkgs.stdenv.hostPlatform.system;
  pennyPackages = self.packages.${system} or (throw "penny: no packages for ${system}");

  inherit (lib) mkOption mkEnableOption mkIf types;

  # `settings` is written as nested attributes and becomes ASP.NET's double-underscore
  # environment names: { Auth.RateLimitPermits = 40; } -> Auth__RateLimitPermits=40.
  flatten = prefix: value:
    if builtins.isAttrs value then
      lib.concatMapAttrs (name: flatten (if prefix == "" then name else "${prefix}__${name}")) value
    else { ${prefix} = value; };
  render = value:
    if builtins.isBool value then lib.boolToString value
    else if builtins.isList value then lib.concatMapStringsSep "," toString value
    else toString value;

  localDatabase = db.createLocally;
  receiptKeyPath = if cfg.receiptKeyFile != null then cfg.receiptKeyFile else "${cfg.stateDir}/receipt-master-key";

  connectionString = user: lib.concatStringsSep ";" ([
    "Host=${db.host}"
    "Port=${toString db.port}"
    "Database=${db.name}"
    "Username=${user}"
  ] ++ lib.optional (!localDatabase) "SSL Mode=${db.sslMode}")
  + db.extraConnectionOptions;

  # `settings` wins over these, so any value can be overridden.
  apiEnvironment = {
    ASPNETCORE_ENVIRONMENT = "Production";
    ASPNETCORE_URLS = "http://${cfg.listenAddress}:${toString cfg.port}";
    DOTNET_EnableDiagnostics = "0";
    DOTNET_CLI_TELEMETRY_OPTOUT = "1";
    DOTNET_NOLOGO = "1";
    Logging__Console__FormatterName = "systemd";
    Search__ModelDirectory = "${cfg.searchModel}";
    Receipts__Root = "${cfg.stateDir}/receipts";
    # Receipt OCR (MAZ-125): local programs only; the language data comes with the
    # tesseract package (its wrapper sets TESSDATA_PREFIX).
    Ocr__Tesseract = lib.getExe' cfg.ocr.tesseract "tesseract";
    Ocr__PopplerDirectory = "${lib.getBin cfg.ocr.poppler}/bin";
    Ocr__VipsDirectory = "${lib.getBin cfg.ocr.vips}/bin";
    Ocr__Prlimit = lib.getExe' pkgs.util-linux "prlimit";
    Ocr__EngineMemoryMegabytes = toString cfg.ocr.engineMemoryMegabytes;
    Ocr__Languages = lib.concatStringsSep "+" cfg.ocr.languages;
    Auth__AllowedOrigins = lib.concatStringsSep "," cfg.publicOrigins;
    Auth__SecureCookies = lib.boolToString cfg.secureCookies;
    Auth__TrustedProxies = lib.concatStringsSep "," cfg.trustedProxies;
    Auth__AllowRegistration = lib.boolToString cfg.allowRegistration;
    Backend__ShutdownTimeoutSeconds = "30";
  } // lib.optionalAttrs mail.enable {
    # Emailed receipts (MAZ-184): penny-render on loopback; the webhook secret is a credential.
    InboundMail__Enabled = "true";
    InboundMail__Domain = mail.domain;
    InboundMail__RendererUrl = "http://127.0.0.1:${toString mail.renderer.port}";
  } // lib.mapAttrs (_: render) (flatten "" cfg.settings);

  # Secrets never enter the Nix store: they are read at start from systemd credentials
  # ($CREDENTIALS_DIRECTORY) in the services and from their source files in penny-manage.
  exportConnection = var: user: passwordFile:
    if passwordFile == null then
      "export ${var}=${lib.escapeShellArg (connectionString user)}"
    else
      "${var}=${lib.escapeShellArg "${connectionString user};Password="}\"$(< ${passwordFile})\"; export ${var}";
  exportReceiptKey = file: ''Receipts__MasterKey="$(< ${file})"; export Receipts__MasterKey'';
  exportWebhookSecret = file:
    lib.optionalString mail.enable ''InboundMail__WebhookSecret="$(< ${file})"; export InboundMail__WebhookSecret'';

  credential = name: "\"$CREDENTIALS_DIRECTORY/${name}\"";
  optionalCredential = name: file: if file == null then null else credential name;

  apiStart = pkgs.writeShellScript "penny-api-start" ''
    set -euo pipefail
    ${exportReceiptKey (credential "receipt-key")}
    ${exportWebhookSecret (credential "inbound-mail-secret")}
    ${exportConnection "ConnectionStrings__Postgres" db.user (optionalCredential "db-password" db.passwordFile)}
    exec ${lib.getExe cfg.package}
  '';

  optionalFile = file: if file == null then null else lib.escapeShellArg file;

  credentials =
    [ "receipt-key:${receiptKeyPath}" ]
    ++ lib.optional (db.passwordFile != null) "db-password:${db.passwordFile}"
    ++ lib.optional mail.enable "inbound-mail-secret:${mail.webhookSecretFile}";

  # Generates the receipt master key on first start when none is supplied. It is never
  # rotated: losing it makes every stored receipt unreadable, so back it up.
  generateReceiptKey = pkgs.writeShellScript "penny-receipt-key" ''
    set -euo pipefail
    key=${lib.escapeShellArg receiptKeyPath}
    if [ ! -s "$key" ]; then
      umask 0077
      ${pkgs.coreutils}/bin/head -c 32 /dev/urandom | ${pkgs.coreutils}/bin/base64 -w0 > "$key.tmp"
      chown ${cfg.user}:${cfg.group} "$key.tmp"
      mv "$key.tmp" "$key"
      echo "penny: generated a new receipt master key at $key; back it up" >&2
    fi
  '';

  # Run maintenance commands with the service's configuration, e.g.
  #   sudo penny-manage reset-password someone@example.com
  manage = pkgs.writeShellScriptBin "penny-manage" ''
    set -euo pipefail
    if [ "$(id -u)" -ne 0 ]; then
      echo "penny-manage: run as root (it reads the service secrets and drops to ${cfg.user})" >&2
      exit 1
    fi
    ${lib.concatStringsSep "\n" (lib.mapAttrsToList (n: v: "export ${n}=${lib.escapeShellArg v}") apiEnvironment)}
    ${lib.concatMapStringsSep "\n" (f: "set -a; . ${lib.escapeShellArg f}; set +a") cfg.environmentFiles}
    if [ -r ${lib.escapeShellArg receiptKeyPath} ]; then
      ${exportReceiptKey (lib.escapeShellArg receiptKeyPath)}
    fi
    ${lib.optionalString mail.enable (exportWebhookSecret (lib.escapeShellArg mail.webhookSecretFile))}
    ${exportConnection "ConnectionStrings__Postgres" db.user (optionalFile db.passwordFile)}
    cd ${lib.escapeShellArg cfg.stateDir}
    exec ${pkgs.util-linux}/bin/setpriv --reuid=${cfg.user} --regid=${cfg.group} --init-groups \
      ${lib.getExe cfg.package} "$@"
  '';

  # Idempotent setup of a local server, as the administrator: the database user without a
  # password (peer authentication over the Unix socket), the schema it owns and the search
  # extensions (vector is not a trusted extension). The API migrates the rest on startup.
  # Installs from before the single user (penny_migrator owned the schema, penny_runtime
  # served) are moved onto it: their objects are reassigned to the new user.
  databaseSetup = pkgs.writeText "penny-db-setup.sql" ''
    \set ON_ERROR_STOP 1
    SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE', :'user')
      WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'user') \gexec
    SELECT format('CREATE DATABASE %I', :'database')
      WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'database') \gexec
    \connect :"database"
    REVOKE CREATE ON SCHEMA public FROM PUBLIC;
    GRANT CONNECT, CREATE ON DATABASE :"database" TO :"user";
    SELECT format('REASSIGN OWNED BY %I TO %I', 'penny_migrator', :'user')
      WHERE :'user' <> 'penny_migrator'
        AND EXISTS (SELECT FROM pg_roles WHERE rolname = 'penny_migrator') \gexec
    CREATE SCHEMA IF NOT EXISTS penny AUTHORIZATION :"user";
    CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA public;
    CREATE EXTENSION IF NOT EXISTS vector SCHEMA public;
  '';

  hardening = {
    User = cfg.user;
    Group = cfg.group;
    WorkingDirectory = cfg.stateDir;
    LoadCredential = credentials;
    EnvironmentFile = cfg.environmentFiles;
    UMask = "0077";
    NoNewPrivileges = true;
    PrivateTmp = true;
    PrivateDevices = true;
    ProtectSystem = "strict";
    ProtectHome = true;
    ReadWritePaths = [ cfg.stateDir ];
    ProtectKernelTunables = true;
    ProtectKernelModules = true;
    ProtectKernelLogs = true;
    ProtectControlGroups = true;
    ProtectClock = true;
    ProtectHostname = true;
    ProtectProc = "invisible";
    RestrictAddressFamilies = [ "AF_UNIX" "AF_INET" "AF_INET6" ];
    RestrictNamespaces = true;
    RestrictRealtime = true;
    RestrictSUIDSGID = true;
    LockPersonality = true;
    CapabilityBoundingSet = "";
    SystemCallArchitectures = "native";
    # The .NET JIT needs writable+executable memory, so MemoryDenyWriteExecute stays off.
  };

  databaseUnits = lib.optionals localDatabase [ "postgresql.service" "penny-db-setup.service" ];
in
{
  imports = [
    (lib.mkAliasOptionModule [ "programs" "penny" ] [ "services" "penny" ])
    # One database user since the API migrates on startup.
    (lib.mkRenamedOptionModule [ "services" "penny" "database" "migrationUser" ] [ "services" "penny" "database" "user" ])
    (lib.mkRenamedOptionModule [ "services" "penny" "database" "migrationPasswordFile" ] [ "services" "penny" "database" "passwordFile" ])
    (lib.mkRemovedOptionModule [ "services" "penny" "database" "runtimeUser" ] "The API now uses services.penny.database.user only.")
    (lib.mkRemovedOptionModule [ "services" "penny" "database" "runtimePasswordFile" ] "The API now uses services.penny.database.passwordFile only.")
  ];

  options.services.penny = {
    enable = mkEnableOption "Penny, the self-hosted household expense tracker";

    package = mkOption {
      type = types.package;
      default = pennyPackages.penny-api;
      defaultText = lib.literalExpression "penny.packages.\${system}.penny-api";
      description = "The Penny API package.";
    };

    webPackage = mkOption {
      type = types.package;
      default = pennyPackages.penny-web;
      defaultText = lib.literalExpression "penny.packages.\${system}.penny-web";
      description = "Static v2 web app (apps/web) served by nginx.";
    };

    webTelemetryUrl = mkOption {
      type = types.nullOr (types.strMatching "https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[A-Za-z0-9._~/-]*)?");
      default = null;
      example = "https://faro-collector-prod-us-east-0.grafana.net/collect/0123456789abcdef";
      description = ''
        Opt-in browser telemetry (MAZ-129): the Faro collector the web app sends errors,
        performance and traces to, such as Grafana Cloud Frontend Observability's URL. Published
        as /telemetry.json and allowed in the page's connect-src. null keeps it off.
        See docs/self-hosting/observability.md.
      '';
    };

    searchModel = mkOption {
      type = types.package;
      default = pennyPackages.penny-search-model;
      defaultText = lib.literalExpression "penny.packages.\${system}.penny-search-model";
      description = "Directory with the pinned search embedding model (`Search__ModelDirectory`).";
    };

    ocr = {
      languages = mkOption {
        type = types.nonEmptyListOf types.str;
        default = [ "eng" "fra" ];
        example = [ "eng" "fra" "deu" ];
        description = ''
          Tesseract languages for receipt text extraction (`Ocr__Languages`, MAZ-125). Their
          language data is added to `ocr.tesseract`; the API checks it at startup.
        '';
      };

      tesseract = mkOption {
        type = types.package;
        default = pkgs.tesseract.override { enableLanguages = cfg.ocr.languages; };
        defaultText = lib.literalExpression
          "pkgs.tesseract.override { enableLanguages = config.services.penny.ocr.languages; }";
        description = "Tesseract (with its language data) used for receipt OCR on this host.";
      };

      poppler = mkOption {
        type = types.package;
        default = pkgs.poppler-utils;
        defaultText = lib.literalExpression "pkgs.poppler-utils";
        description = "poppler's `pdftotext`, `pdfinfo` and `pdftoppm`, which read and render receipt PDFs.";
      };

      vips = mkOption {
        type = types.package;
        default = pkgs.vips;
        defaultText = lib.literalExpression "pkgs.vips";
        description = "libvips' `vipsheader` and `vipsthumbnail`, which decode receipt photos at a bounded size.";
      };

      engineMemoryMegabytes = mkOption {
        type = types.ints.between 256 16384;
        default = 1024;
        description = ''
          Address-space limit of each OCR engine process (`Ocr__EngineMemoryMegabytes`,
          applied with `prlimit`); an engine that needs more fails that attempt.
        '';
      };
    };

    memoryMax = mkOption {
      type = types.nullOr types.str;
      default = "3G";
      example = "2G";
      description = ''
        systemd `MemoryMax=` of the API service, which also runs the OCR engines: the
        API with the search model needs about 1 GiB, plus up to
        `ocr.engineMemoryMegabytes` per concurrent receipt (`Ocr__Concurrency`, default
        1). The kernel kills the service past it (systemd restarts it); null leaves it
        unlimited.
      '';
    };

    inboundMail = {
      enable = mkEnableOption ''
        emailed receipts (MAZ-184, docs/plans/email-receipts.md): a private receipt address per
        user, mail delivered by the Cloudflare Email Worker (apps/email-worker) and rendered to
        PDF by a hardened local Gotenberg (`penny-render`). The Worker must reach the API
        through a Cloudflare Tunnel or Cloudflare Access; nginx never routes /api/inbound-mail
      '';
      domain = mkOption {
        type = types.str;
        default = "";
        example = "receipts.example.com";
        description = "The receipts-only subdomain (`InboundMail__Domain`), whose MX is Cloudflare Email Routing.";
      };
      webhookSecretFile = mkOption {
        type = types.nullOr types.path;
        default = null;
        example = "/run/secrets/penny-inbound-mail-secret";
        description = ''
          File with the HMAC secret shared with the Email Worker (`InboundMail__WebhookSecret`,
          base64 of at least 32 random bytes: `openssl rand -base64 32`). Read through systemd
          credentials; the same value is the Worker's `PENNY_WEBHOOK_SECRET`.
        '';
      };
      renderer = {
        package = mkOption {
          type = types.package;
          default = pkgs.gotenberg;
          defaultText = lib.literalExpression "pkgs.gotenberg";
          description = "Gotenberg for `penny-render`.";
        };
        chromium = mkOption {
          type = types.package;
          default = pkgs.chromium;
          defaultText = lib.literalExpression "pkgs.chromium";
          description = "Chromium used by `penny-render` (JavaScript is always off).";
        };
        port = mkOption {
          type = types.port;
          default = 3011;
          description = "Loopback port of `penny-render`.";
        };
        memoryMax = mkOption {
          type = types.nullOr types.str;
          default = "1G";
          description = "systemd `MemoryMax=` of `penny-render`; null for unlimited.";
        };
      };
    };

    tasksMax = mkOption {
      type = types.nullOr types.ints.positive;
      default = 1024;
      description = "systemd `TasksMax=` of the API service (threads and OCR child processes); null for systemd's default.";
    };

    hostName = mkOption {
      type = types.str;
      example = "penny.example.com";
      description = "Host name of the nginx virtual host that serves Penny.";
    };

    publicOrigins = mkOption {
      type = types.nonEmptyListOf types.str;
      default = [ "https://${cfg.hostName}" ];
      defaultText = lib.literalExpression ''[ "https://''${config.services.penny.hostName}" ]'';
      example = [ "https://penny.example.com" ];
      description = ''
        Exact browser origins (scheme, host, non-default port, no path) allowed to make
        mutating requests (`Auth__AllowedOrigins`). Use `http://` only for localhost testing.
      '';
    };

    secureCookies = mkOption {
      type = types.bool;
      default = lib.all (lib.hasPrefix "https://") cfg.publicOrigins;
      defaultText = lib.literalMD "`true` when every public origin is `https://`";
      description = "Mark session cookies `Secure` (`Auth__SecureCookies`).";
    };

    allowRegistration = mkOption {
      type = types.bool;
      default = true;
      description = ''
        Allow password sign-up (`Auth__AllowRegistration`). Create your account, then set
        this to `false`.
      '';
    };

    listenAddress = mkOption {
      type = types.str;
      default = "127.0.0.1";
      description = "Address the API listens on. nginx proxies `/api/` to it.";
    };

    port = mkOption {
      type = types.port;
      default = 5080;
      description = "Port the API listens on.";
    };

    trustedProxies = mkOption {
      type = types.listOf types.str;
      default = [ "127.0.0.1/32" "::1/128" ];
      description = ''
        Addresses or CIDR ranges whose `X-Forwarded-For` the API trusts
        (`Auth__TrustedProxies`): the local nginx by default. Exactly one hop is trusted.
      '';
    };

    stateDir = mkOption {
      type = types.path;
      default = "/var/lib/penny";
      description = ''
        State directory. Encrypted receipts are stored in `receipts/`, and the generated
        receipt master key (when `receiptKeyFile` is null) in `receipt-master-key`.
      '';
    };

    receiptKeyFile = mkOption {
      type = types.nullOr types.path;
      default = null;
      example = "/run/secrets/penny-receipt-key";
      description = ''
        File with the receipt master key: base64 of 32 random bytes
        (`head -c 32 /dev/urandom | base64`). Read through systemd credentials, so it may be
        owned by root. When null, a key is generated on first start in
        `''${stateDir}/receipt-master-key`. It is never rotated; without it receipts can't be
        decrypted, so back it up separately from the database.
      '';
    };

    environmentFiles = mkOption {
      type = types.listOf types.path;
      default = [ ];
      example = [ "/run/secrets/penny.env" ];
      description = ''
        systemd environment files for the API, for secrets that must not enter the Nix
        store, for example `Oidc__ClientSecret=…` or `Push__Apns__PrivateKey=…`.
      '';
    };

    settings = mkOption {
      type = types.submodule { freeformType = (pkgs.formats.json { }).type; };
      default = { };
      example = lib.literalExpression ''
        {
          Oidc = {
            Issuer = "https://identity.example.com/realms/penny";
            ClientId = "penny";
            RedirectUris = [ "https://penny.example.com/auth/callback" "penny://auth/callback" ];
            Label = "Single sign-on";
          };
          Push.Apns = { TeamId = "ABCDE12345"; KeyId = "XYZ987"; Topic = "com.example.penny"; };
          Database.MaxPoolSize = 20;
          Logging.LogLevel.Default = "Warning";
        }
      '';
      description = ''
        API configuration (see the `deploy/api.env` table in docs/self-hosting/deployment.md). Nested
        attributes become ASP.NET double-underscore names, lists are joined with commas.
        Values land in the Nix store: put secrets in `environmentFiles`.
      '';
    };

    user = mkOption {
      type = types.str;
      default = "penny";
      description = "System user the API runs as.";
    };

    group = mkOption {
      type = types.str;
      default = "penny";
      description = "System group of the Penny user.";
    };

    database = {
      createLocally = mkOption {
        type = types.bool;
        default = true;
        description = ''
          Run PostgreSQL 18 on this host (`services.postgresql`) with pg_trgm and pgvector,
          and create the database, its user, schema and extensions. The service user connects
          over the Unix socket with peer authentication, so no passwords are involved.
        '';
      };

      name = mkOption {
        type = types.str;
        default = "penny";
        description = "Database name.";
      };

      host = mkOption {
        type = types.str;
        default = "/run/postgresql";
        description = "Database host, or a Unix socket directory (starting with `/`).";
      };

      port = mkOption {
        type = types.port;
        default = 5432;
        description = "Database port.";
      };

      user = mkOption {
        type = types.str;
        default = "penny";
        description = ''
          The one database user: it owns the `penny` schema, and the API migrates it on
          startup and serves with it.
        '';
      };

      passwordFile = mkOption {
        type = types.nullOr types.path;
        default = null;
        description = "Password file for the database user (external databases). Must not contain `;`.";
      };

      sslMode = mkOption {
        type = types.enum [ "Disable" "Allow" "Prefer" "Require" "VerifyCA" "VerifyFull" ];
        default = "VerifyFull";
        description = "Npgsql `SSL Mode` for an external database (ignored when `createLocally`).";
      };

      extraConnectionOptions = mkOption {
        type = types.str;
        default = "";
        example = ";Root Certificate=/run/secrets/db-ca.pem";
        description = "Appended to both connection strings; start it with `;`.";
      };
    };

    nginx = {
      enable = mkOption {
        type = types.bool;
        default = true;
        description = ''
          Configure an nginx virtual host for `hostName` that serves the web app and
          proxies `/api/` to the API. Add TLS through
          `services.nginx.virtualHosts.<hostName>` (for example `enableACME` and `forceSSL`).
        '';
      };

      maxBodySize = mkOption {
        type = types.str;
        default = "21m";
        description = "`client_max_body_size`, a little above the API's 20 MiB request limit.";
      };

      realIpFrom = mkOption {
        type = types.listOf types.str;
        default = [ ];
        example = [ "10.0.0.0/8" ];
        description = ''
          Outer proxies (CIDR) in front of nginx whose `X-Forwarded-For` nginx trusts, so
          per-client rate limits see the real client address.
        '';
      };
    };
  };

  config = mkIf cfg.enable {
    assertions = [
      {
        assertion = localDatabase -> lib.versions.major config.services.postgresql.package.version == "18";
        message = "Penny requires PostgreSQL 18; services.postgresql.package is ${config.services.postgresql.package.version}. See docs/self-hosting/operations.md for upgrading an existing cluster.";
      }
      {
        assertion = localDatabase -> lib.hasPrefix "/" db.host;
        message = "services.penny.database.host must be a Unix socket directory when createLocally is true.";
      }
      {
        assertion = localDatabase -> (db.passwordFile == null);
        message = "services.penny.database password files are only used with an external database (createLocally = false).";
      }
      {
        assertion = mail.enable -> (mail.domain != "" && mail.webhookSecretFile != null);
        message = "services.penny.inboundMail needs domain and webhookSecretFile when enabled.";
      }
      {
        assertion = lib.all (o: builtins.match "https?://[^/]+" o != null) cfg.publicOrigins;
        message = "services.penny.publicOrigins must be origins like https://penny.example.com (no path or trailing slash).";
      }
    ];

    warnings = lib.optional (!cfg.secureCookies && lib.any (lib.hasPrefix "https://") cfg.publicOrigins)
      "services.penny.secureCookies is false while serving an https:// origin.";

    users.users.${cfg.user} = {
      isSystemUser = true;
      group = cfg.group;
      home = cfg.stateDir;
    };
    users.groups.${cfg.group} = { };

    environment.systemPackages = [ manage ];

    systemd.tmpfiles.settings."10-penny" = {
      ${cfg.stateDir}.d = { user = cfg.user; group = cfg.group; mode = "0700"; };
      "${cfg.stateDir}/receipts".d = { user = cfg.user; group = cfg.group; mode = "0700"; };
    };

    services.postgresql = mkIf localDatabase {
      enable = true;
      # Stronger than the stateVersion default, weaker than a plain definition.
      package = lib.mkOverride 900 pkgs.postgresql_18;
      extensions = ps: [ ps.pgvector ];
      # The OS user `penny` may log in as the database user over the local socket.
      identMap = ''
        penny ${cfg.user} ${db.user}
      '';
      authentication = lib.mkBefore ''
        local ${db.name} ${db.user} peer map=penny
      '';
    };

    systemd.services.penny-db-setup = mkIf localDatabase {
      description = "Penny database user, schema and extensions";
      requires = [ "postgresql.service" ];
      after = [ "postgresql.service" "postgresql-setup.service" ];
      before = [ "penny.service" ];
      path = [ config.services.postgresql.package ];
      serviceConfig = {
        Type = "oneshot";
        RemainAfterExit = true;
        User = "postgres";
        Group = "postgres";
      };
      script = ''
        until pg_isready -q -h /run/postgresql -p ${toString config.services.postgresql.settings.port}; do sleep 1; done
        psql -h /run/postgresql -p ${toString config.services.postgresql.settings.port} -d postgres -X \
          --set=database=${lib.escapeShellArg db.name} \
          --set=user=${lib.escapeShellArg db.user} \
          -f ${databaseSetup}
      '';
    };

    # penny-render (MAZ-184): HTML-to-PDF for emailed receipts, Chromium with JavaScript off.
    # Gotenberg serves TCP, so instead of PrivateNetwork the unit may only use loopback
    # (IPAddressDeny/IPAddressAllow): Chromium can't reach the internet, and Gotenberg's
    # URL deny-list and private-IP denial block loopback and local files as well. Flags
    # match deploy/compose.yaml.
    systemd.services.penny-render = mkIf mail.enable {
      description = "Penny email receipt renderer (Gotenberg)";
      wantedBy = [ "multi-user.target" ];
      before = [ "penny.service" ];
      environment = {
        CHROMIUM_BIN_PATH = lib.getExe mail.renderer.chromium;
        FONTCONFIG_FILE = pkgs.makeFontsConf { fontDirectories = [ pkgs.liberation_ttf_v2 pkgs.dejavu_fonts pkgs.noto-fonts ]; };
        HOME = "/run/penny-render";
      };
      serviceConfig = {
        Type = "simple";
        ExecStart = lib.escapeShellArgs [
          (lib.getExe mail.renderer.package)
          "--api-port=${toString mail.renderer.port}"
          "--api-timeout=30s"
          "--api-disable-download-from"
          "--chromium-disable-javascript"
          "--chromium-deny-list=^(?!file:///tmp/).*"
          "--chromium-deny-private-ips"
          "--chromium-deny-public-ips"
          "--chromium-max-queue-size=4"
          "--chromium-restart-after=50"
          "--libreoffice-disable-routes"
          "--pdfengines-disable-routes"
          "--webhook-disable"
          "--prometheus-disable-collect"
          "--log-level=error"
        ];
        Restart = "on-failure";
        RestartSec = 5;
        DynamicUser = true;
        RuntimeDirectory = "penny-render";
        WorkingDirectory = "/run/penny-render";
        PrivateTmp = true;
        PrivateDevices = true;
        PrivateIPC = true;
        PrivateUsers = true;
        ProtectSystem = "strict";
        ProtectHome = true;
        ProtectClock = true;
        ProtectControlGroups = true;
        ProtectHostname = true;
        ProtectKernelLogs = true;
        ProtectKernelModules = true;
        ProtectKernelTunables = true;
        ProtectProc = "invisible";
        NoNewPrivileges = true;
        CapabilityBoundingSet = "";
        IPAddressDeny = "any";
        IPAddressAllow = "localhost";
        RestrictAddressFamilies = [ "AF_UNIX" "AF_INET" "AF_INET6" "AF_NETLINK" ];
        RestrictNamespaces = true;
        RestrictRealtime = true;
        RestrictSUIDSGID = true;
        LockPersonality = true;
        SystemCallFilter = [ "@sandbox" "@system-service" "@chown" "@pkey" "mincore" ];
        SystemCallArchitectures = "native";
        UMask = "0077";
        TasksMax = 512;
      } // lib.optionalAttrs (mail.renderer.memoryMax != null) {
        MemoryMax = mail.renderer.memoryMax;
      };
    };

    systemd.services.penny = {
      description = "Penny API";
      wantedBy = [ "multi-user.target" ];
      # Migrates the database on startup (under its advisory lock), then serves.
      requires = databaseUnits;
      wants = [ "network-online.target" ] ++ lib.optional mail.enable "penny-render.service";
      after = databaseUnits ++ [ "network-online.target" ] ++ lib.optional mail.enable "penny-render.service";
      environment = apiEnvironment;
      serviceConfig = hardening // {
        Type = "exec";
        ExecStartPre = lib.optional (cfg.receiptKeyFile == null) "+${generateReceiptKey}";
        ExecStart = apiStart;
        Restart = "on-failure";
        RestartSec = 5;
        # Above Backend__ShutdownTimeoutSeconds so requests and worker leases drain.
        TimeoutStopSec = 45;
      } // lib.optionalAttrs (cfg.memoryMax != null) {
        MemoryMax = cfg.memoryMax;
      } // lib.optionalAttrs (cfg.tasksMax != null) {
        TasksMax = cfg.tasksMax;
      };
    };

    services.nginx = mkIf cfg.nginx.enable {
      enable = true;
      virtualHosts.${cfg.hostName} = {
        root = cfg.webPackage;
        extraConfig = ''
          client_max_body_size ${cfg.nginx.maxBodySize};
          ${lib.concatMapStrings (cidr: "set_real_ip_from ${cidr};\n") cfg.nginx.realIpFrom}
          ${lib.optionalString (cfg.nginx.realIpFrom != [ ]) ''
            real_ip_header X-Forwarded-For;
            real_ip_recursive on;
          ''}
        '';
        locations = {
          "/api/" = {
            proxyPass = "http://${if lib.hasInfix ":" cfg.listenAddress then "[${cfg.listenAddress}]" else cfg.listenAddress}:${toString cfg.port}";
            # Penny sets its own headers: X-Forwarded-For is replaced, never appended, so a
            # client can't spoof its address for rate limiting.
            recommendedProxySettings = false;
            extraConfig = ''
              proxy_http_version 1.1;
              proxy_set_header Host $host;
              proxy_set_header X-Forwarded-For $remote_addr;
              proxy_set_header X-Forwarded-Proto $scheme;
              proxy_set_header X-Request-Id $request_id;
              proxy_request_buffering off;
              proxy_connect_timeout 5s;
              proxy_read_timeout 330s;
              proxy_send_timeout 330s;
            '';
          };
          # Fingerprinted Vite bundles never change. Without `always`, a 404 is not cached.
          # The Email Worker's endpoints (MAZ-184) are never public: it reaches the API
          # through a Cloudflare Tunnel or Cloudflare Access, not through this proxy.
          # Case-insensitive, because the API's routing is.
          "~* ^/api/inbound-mail(/|$)" = {
            extraConfig = ''
              default_type application/json;
              return 404 '{"error":"API route not found."}';
            '';
          };
          "/assets/" = {
            tryFiles = "$uri =404";
            extraConfig = ''
              add_header Cache-Control "public, max-age=31536000, immutable";
              add_header X-Content-Type-Options nosniff always;
            '';
          };
          # Browser telemetry settings (MAZ-129); an empty collectorUrl keeps telemetry off.
          "= /telemetry.json" = {
            extraConfig = ''
              add_header Cache-Control "no-store" always;
              add_header X-Content-Type-Options nosniff always;
              default_type application/json;
              return 200 '{"collectorUrl":"${toString cfg.webTelemetryUrl}"}\n';
            '';
          };
          # Single-page app: unknown paths render index.html, which is never cached.
          "/" = {
            tryFiles = "$uri /index.html";
            extraConfig = ''
              add_header Cache-Control "no-cache" always;
              add_header X-Content-Type-Options nosniff always;
              add_header X-Frame-Options DENY always;
              add_header Referrer-Policy same-origin always;
              # apps/web/scripts/security-headers.ts: same-origin scripts and the pdf.js worker.
              add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; font-src 'self'; connect-src 'self'${lib.optionalString (cfg.webTelemetryUrl != null) " ${cfg.webTelemetryUrl}"}; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'" always;
            '';
          };
        };
      };
    };
  };
}
