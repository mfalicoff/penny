# .NET API

This directory owns the separate ASP.NET Core service. Read `README.md` and `docs/migration/architecture.md` before adding endpoints. Keep the legacy Expo and Node app running until the explicit cutover gates pass. Preserve `contracts/openapi.json`, existing SQLite data, and wire behavior. Keep one active database writer.

Put pure rules in Domain, use cases and ports in Application, adapters in Persistence, and HTTP/configuration in Api. Pass request cancellation through all async work. Add real HTTP and temporary SQLite integration tests when implementing auth, ownership, revisions, migrations, and rollback. Do not copy the root Expo instructions into .NET code.

Put HTTP endpoints in `Penny.Backend.Api/Controllers` and register them through MVC. Keep the `Program.cs` startup flow and `BackendApp` test host composition aligned by using the shared service and middleware methods. Test controller behavior over loopback HTTP, including JSON error responses.

Run `dotnet tool restore`, `dotnet restore Penny.Backend.slnx --locked-mode`, `dotnet csharpier check .`, `dotnet format analyzers Penny.Backend.slnx --verify-no-changes --no-restore`, `dotnet build Penny.Backend.slnx --no-restore`, and `dotnet test Penny.Backend.IntegrationTests/Penny.Backend.IntegrationTests.csproj --no-build --no-restore` from this directory. Keep package versions in `Directory.Packages.props`, update lock files when changing references, and format with `dotnet csharpier format .`. Never add secrets or personal data to test fixtures.
