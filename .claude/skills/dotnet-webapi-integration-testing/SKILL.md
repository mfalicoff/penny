---
name: dotnet-webapi-integration-testing
description: Write and structure modern integration tests for ASP.NET Core Web APIs on .NET 10 using xUnit v3, WebApplicationFactory, shared test fixtures and Testcontainers (real PostgreSQL / SQL Server), for Minimal API endpoints with built-in OpenAPI + Scalar and a domain-driven (DDD / clean architecture) solution layout. Use this skill whenever the user wants to add, fix, scaffold or review integration or API tests in a .NET web project, mentions WebApplicationFactory, Testcontainers, xUnit fixtures, Respawn, test auth handlers, Minimal API testing, Scalar/OpenAPI document testing, or asks how to test a DDD-style ASP.NET Core API end to end, even if they do not name these libraries.
---

# .NET Web API integration testing (.NET 10)

Integration tests are the highest-value tests for a Web API: one test exercises routing, binding, validation, auth, handlers, EF Core mappings and real SQL in a single pass. This skill sets up and writes them so they are fast, deterministic and honest about production behavior.

## Stack (and why)

| Concern | Choice | Why |
|---|---|---|
| Framework | **xUnit v3** (`xunit.v3`) | Async fixtures return `ValueTask`, assembly fixtures, `TestContext.Current.CancellationToken` |
| Host | `WebApplicationFactory<Program>` (`Microsoft.AspNetCore.Mvc.Testing`) | Runs the real pipeline in-process, no ports |
| Database | **Testcontainers** (`Testcontainers.PostgreSql` or `.MsSql`) | The in-memory EF provider hides constraint, transaction and SQL-translation bugs |
| Reset | **Respawn** | Wipes data between tests in milliseconds; far cheaper than a container per test |
| Assertions | **Shouldly** or AwesomeAssertions | FluentAssertions 8+ needs a commercial license for commercial use |
| Time | `TimeProvider` + `FakeTimeProvider` (`Microsoft.Extensions.TimeProvider.Testing`) | Deterministic expiry/clock logic |
| Contracts | Built-in `Microsoft.AspNetCore.OpenApi` + **Scalar.AspNetCore** | Swashbuckle is out of the templates; test that the doc and UI are served |
| Optional | Verify (`Verify.XunitV3`), Bogus, WireMock.Net, NetArchTest | Snapshots, fake data, outbound HTTP stubs, layer rules |

Do not hardcode package versions from memory. Use `dotnet add package <name>` (or Central Package Management) so the latest compatible version is resolved, and keep `Microsoft.AspNetCore.Mvc.Testing` on the same major version as the app's target framework.

## Workflow

1. **Orient.** Find the API project (`Program.cs`), the `DbContext`, the database provider, how auth is configured, and which external services the app calls. Check whether a test project and fixtures already exist, and extend them rather than adding a second harness.
2. **Make the app testable** (only if needed, see `references/architecture-and-endpoints.md`): `public partial class Program;`, connection string read lazily from `IConfiguration`, `TimeProvider` injected rather than `DateTime.UtcNow`, migrations not auto-run inside the app under test.
3. **Scaffold the harness** if absent (see `references/fixtures.md`): one container for the whole test run, a factory that points the app at it, a Respawn reset before each test, a test auth handler, a base class.
4. **Write tests per endpoint** using the checklist below and the patterns in `references/test-patterns.md`.
5. **Run them** with `dotnet test`. Docker (or a compatible runtime) must be available; if it is not in the current environment, say so plainly, still write the tests, and tell the user how to run them.
6. **Review** against the pitfalls list before finishing.

## Per-endpoint checklist

Cover what the endpoint can actually do, not everything mechanically:

- Happy path: status code, `Location` header on creates, response body shape.
- Persistence: assert the aggregate was stored correctly by reading through a fresh `DbContext` scope, not by trusting the response.
- Validation failure: 400 with `ValidationProblemDetails` and the right field keys.
- Not found: 404 (and that it does not leak whether other tenants' resources exist).
- Auth: 401 when anonymous, 403 for the wrong role/policy, success for the right one.
- Domain rule violation: the status the API maps it to (commonly 409 or 422) with a ProblemDetails body. Exhaustive invariant testing belongs in fast domain unit tests; the integration test proves the mapping from domain exception/result to HTTP.
- Concurrency/idempotency where the endpoint promises it (ETag, `Idempotency-Key`, optimistic concurrency token).
- Side effects: outbox rows, published events, calls to external services (stubbed at the HTTP boundary).

Plus a small set of **contract tests** per API: `/openapi/v1.json` is served and lists the operations, and `/scalar/v1` responds (see `references/test-patterns.md`).

## Principles that matter

- **Black-box through HTTP.** Arrange via the API when it is cheap and reads like a user story; arrange via a `DbContext` scope using domain factory methods/builders when it is not. Never reach into handlers or mock the repository in an integration test, because that defeats the point of the test.
- **One container per test run, one reset per test.** Container start costs seconds, Respawn costs milliseconds. Tests in a shared collection run serially, which is what makes a shared database safe.
- **Replace only the boundaries**: clock, auth, outbound HTTP/message brokers, email. Everything inside the app stays real.
- **Override configuration with `UseSetting`**, not `ConfigureAppConfiguration`, so values are visible to code in `Program.cs` that reads configuration eagerly.
- **Pass `TestContext.Current.CancellationToken`** to async calls in xUnit v3 so cancelled runs stop promptly (the xUnit1051 analyzer enforces this).
- **Assert on contracts, not incidental detail**: status codes, ProblemDetails `title`/`errors` keys, stable fields; avoid asserting full exception messages or generated IDs.
- **Name tests by behavior**: `Post_orders_with_empty_lines_returns_400_validation_problem`.

## Pitfalls to avoid

- `UseInMemoryDatabase` / SQLite-as-a-stand-in for a Postgres/SQL Server app. Use the real engine in a container.
- One container (or one factory) per test class: slow and flaky. Share via a collection or assembly fixture.
- Disabling parallelism wholesale when a single shared collection would do, or enabling it while sharing a database without per-test isolation.
- Order-dependent tests, or tests reading data another test created.
- Reusing a `HttpClient` across tests when the test mutates default headers; create the client per test.
- Using real `DateTime.UtcNow`/`Task.Delay` in assertions; use `FakeTimeProvider.Advance`.
- Running `Database.MigrateAsync()` in the app's startup path and again in the fixture.
- Container image tags like `latest`; pin the major version that production runs.
- Forgetting CI needs Docker. GitHub-hosted `ubuntu-latest` runners have it; some locked-down runners need `TESTCONTAINERS_RYUK_DISABLED=true` or a configured `DOCKER_HOST` (Podman).
- Version skew between `Scalar.AspNetCore`, `Microsoft.AspNetCore.OpenApi` and `Microsoft.OpenApi`: a reported .NET 10 case failed at startup after a transitive `Microsoft.OpenApi` bump. If the app fails to start in tests with `IOpenApi*` errors, align or pin those three packages.

## Reference files

Read the one that matches the task; each has copy-ready code.

- `references/fixtures.md`: test project csproj, `ApiFixture` (Testcontainers + Respawn + migrations), `TestApiFactory`, test auth handler, collection/assembly fixtures, base class, SQL Server variant, CI notes. Read when scaffolding or debugging the harness.
- `references/architecture-and-endpoints.md`: DDD solution layout, what each layer's tests look like, a testable `Program.cs`, Minimal API endpoint modules with `TypedResults`, ProblemDetails and .NET 10 validation, OpenAPI + Scalar wiring, architecture tests. Read when the user is designing or refactoring the API for testability.
- `references/test-patterns.md`: concrete test examples (create/get/validation/auth/domain-rule/concurrency/time/outbound HTTP), OpenAPI and Scalar contract tests, Verify snapshots, data builders, theories. Read when writing the tests themselves.
