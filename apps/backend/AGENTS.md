# .NET API

This directory owns the separate ASP.NET Core service. Read `README.md` and `docs/migration/architecture.md` before adding endpoints. Keep the legacy Expo and Node app running until the explicit cutover gates pass. Preserve `contracts/openapi.json`, existing SQLite data, and wire behavior. Keep one active database writer.

Put pure rules in Domain, use cases and ports in Application, adapters in Persistence, and HTTP/configuration in Api. Pass request cancellation through all async work. Add real HTTP and temporary SQLite integration tests when implementing auth, ownership, revisions, migrations, and rollback. Do not copy the root Expo instructions into .NET code.

Run `dotnet restore Penny.Backend.sln --locked-mode`, `dotnet format Penny.Backend.sln --verify-no-changes --no-restore`, `dotnet build Penny.Backend.sln --no-restore`, and `dotnet run --project Penny.Backend.Tests --no-build --no-restore` from this directory. Update lock files when adding packages; never add secrets or personal data to test fixtures.
