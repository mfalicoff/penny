# syntax=docker/dockerfile:1
# Penny .NET API (MAZ-63). Build context: apps/backend.
#   docker buildx build --platform linux/amd64,linux/arm64 -t penny-api apps/backend
# Every base image is pinned to a multi-platform index digest. The managed output is
# architecture independent, so the SDK and model stages run on the build machine's
# platform and only the runtime stage is per-architecture (no emulated compilation).

ARG SDK_IMAGE=mcr.microsoft.com/dotnet/sdk:10.0.403-noble@sha256:212fe4cb74627d5adf9817a4088906ae3edff1bd853bb27565d4b46731efe61e
ARG RUNTIME_IMAGE=mcr.microsoft.com/dotnet/aspnet:10.0.14-noble@sha256:1a48394b6f29d3a32c79d9edecd4abda0ecbe8776d567dbfc4590ed6979c740c
ARG NODE_IMAGE=docker.io/library/node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20

# The search embedding model is downloaded from its pinned revision and every file's
# SHA-256 is verified by the same script development and CI use.
FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS model
COPY development/download-model.mjs /src/download-model.mjs
RUN node /src/download-model.mjs /model

FROM --platform=$BUILDPLATFORM ${SDK_IMAGE} AS build
ENV DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1
WORKDIR /src
COPY global.json NuGet.Config Directory.Build.props Directory.Packages.props ./
COPY src/Penny.Backend.Domain/Penny.Backend.Domain.csproj src/Penny.Backend.Domain/packages.lock.json src/Penny.Backend.Domain/
COPY src/Penny.Backend.Application/Penny.Backend.Application.csproj src/Penny.Backend.Application/packages.lock.json src/Penny.Backend.Application/
COPY src/Penny.Backend.Persistence/Penny.Backend.Persistence.csproj src/Penny.Backend.Persistence/packages.lock.json src/Penny.Backend.Persistence/
COPY src/Penny.Backend.Api/Penny.Backend.Api.csproj src/Penny.Backend.Api/packages.lock.json src/Penny.Backend.Api/
RUN dotnet restore src/Penny.Backend.Api/Penny.Backend.Api.csproj --locked-mode
COPY src/ src/
COPY development/grant-runtime.sql development/
ARG PENNY_VERSION=0.0.0-local
RUN dotnet publish src/Penny.Backend.Api/Penny.Backend.Api.csproj \
      --configuration Release --no-restore --output /app \
      -p:Version="${PENNY_VERSION%%-*}" -p:InformationalVersion="${PENNY_VERSION}" \
      -p:UseAppHost=false -p:GenerateDocumentationFile=false \
    && rm -f /app/*.pdb

FROM ${RUNTIME_IMAGE}
ARG PENNY_VERSION=0.0.0-local
ARG PENNY_REVISION=unknown
LABEL org.opencontainers.image.title="penny-api" \
      org.opencontainers.image.description="Penny ASP.NET Core API" \
      org.opencontainers.image.source="https://github.com/mfalicoff/penny" \
      org.opencontainers.image.version="${PENNY_VERSION}" \
      org.opencontainers.image.revision="${PENNY_REVISION}"
# Production defaults; every secret (connection strings, receipt key, OIDC and APNs
# credentials) is supplied at run time and never baked into the image.
ENV ASPNETCORE_ENVIRONMENT=Production \
    ASPNETCORE_HTTP_PORTS=8080 \
    DOTNET_EnableDiagnostics=0 \
    DOTNET_CLI_TELEMETRY_OPTOUT=1 \
    Logging__Console__FormatterName=json \
    Logging__Console__FormatterOptions__TimestampFormat=yyyy-MM-ddTHH:mm:ss.fffZ \
    Search__ModelDirectory=/opt/penny/model \
    Receipts__Root=/var/lib/penny/receipts
COPY --from=model --chown=root:root --chmod=0644 /model/ /opt/penny/model/
COPY --from=build --chown=root:root /app/ /opt/penny/app/
# The receipt volume is the only writable application path; the app user owns it.
# /var/lib/penny/cutover is the mount point of the one-time cutover volume (MAZ-65,
# deploy/compose.cutover.yaml): an empty named volume takes this owner and mode.
RUN install -d -o "$APP_UID" -g "$APP_UID" -m 0700 /var/lib/penny/receipts /var/lib/penny/cutover
WORKDIR /opt/penny/app
USER $APP_UID
VOLUME ["/var/lib/penny/receipts"]
EXPOSE 8080
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=3 \
  CMD ["dotnet", "Penny.Backend.Api.dll", "health-probe"]
ENTRYPOINT ["dotnet", "Penny.Backend.Api.dll"]
