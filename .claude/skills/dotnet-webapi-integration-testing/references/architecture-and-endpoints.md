# Architecture, Minimal API endpoints, OpenAPI and Scalar

Contents: 1. Solution layout · 2. What gets tested where · 3. Domain model shape · 4. Application layer · 5. Endpoint modules · 6. Program.cs · 7. Errors and validation · 8. OpenAPI + Scalar · 9. Architecture tests

## 1. Solution layout (DDD / clean architecture)

```
src/
  Ordering.Domain/          aggregates, entities, value objects, domain events, domain exceptions. No package dependencies on frameworks.
  Ordering.Application/     use cases (commands/queries + handlers), ports (interfaces), DTOs
  Ordering.Infrastructure/  EF Core DbContext + configurations, repositories, outbox, external clients
  Ordering.Api/             Minimal API endpoint modules, composition root (Program.cs), OpenAPI/Scalar
tests/
  Ordering.Domain.UnitTests/        pure, instant, exhaustive invariants
  Ordering.Application.UnitTests/   only where orchestration logic is non-trivial
  Ordering.Api.IntegrationTests/    this skill's focus: HTTP -> real DB
  Ordering.ArchitectureTests/       dependency rules
```

Dependencies point inward: Api -> Application, Infrastructure -> Application -> Domain; Domain references nothing. A feature-folder layout inside each project (Orders/, Customers/) scales better than technical folders.

## 2. What gets tested where

| Layer | Test type | Examples |
|---|---|---|
| Domain | Unit, no I/O | `Order.AddLine` rejects negative quantity, totals computed, status transitions, domain events raised |
| API + Application + Infrastructure | **Integration (HTTP + real DB)** | routing, binding, validation, auth, mapping to status codes, persistence, outbox rows |
| Boundaries | Integration with stubs | outbound HTTP with WireMock.Net |
| Structure | Architecture tests | Domain does not reference Infrastructure |

Rule of thumb: enumerate every invariant in domain unit tests; in integration tests prove one representative failure per mapping (rule violation -> 409/422 ProblemDetails) rather than re-testing every rule over HTTP.

## 3. Domain model shape (what makes it testable)

- Aggregates enforce invariants through methods and factories; no public setters.
- Strongly-typed IDs (`readonly record struct OrderId(Guid Value)`) with EF value converters.
- Value objects as records (`Money`, `Address`).
- Domain events collected on the aggregate and dispatched after `SaveChanges` (or written to an outbox in the same transaction). Integration tests assert the outbox row or resulting state change, not that a mock was called.
- Time and IDs come in as parameters or via `TimeProvider`, never from `DateTime.UtcNow` / `Guid.NewGuid()` inside the aggregate.

```csharp
public sealed class Order : AggregateRoot<OrderId>
{
    private readonly List<OrderLine> _lines = [];
    public CustomerId CustomerId { get; private set; }
    public OrderStatus Status { get; private set; }
    public DateTimeOffset CreatedAt { get; private set; }
    public IReadOnlyList<OrderLine> Lines => _lines;

    private Order() { }   // EF

    public static Order Create(CustomerId customerId, DateTimeOffset now)
    {
        var order = new Order { Id = OrderId.New(), CustomerId = customerId, Status = OrderStatus.Draft, CreatedAt = now };
        order.Raise(new OrderCreated(order.Id));
        return order;
    }

    public void AddLine(string sku, int quantity, Money unitPrice)
    {
        if (Status != OrderStatus.Draft) throw new DomainException("order.not_editable", "Only draft orders can be edited.");
        if (quantity <= 0) throw new DomainException("order.invalid_quantity", "Quantity must be positive.");
        _lines.Add(new OrderLine(sku, quantity, unitPrice));
    }
}
```

## 4. Application layer

Plain handler classes (or a source-generated mediator) keep things simple and testable. MediatR is now commercially licensed, so do not introduce it by default into a new codebase.

```csharp
public sealed class CreateOrderHandler(IOrderRepository orders, IUnitOfWork uow, TimeProvider time)
{
    public async Task<OrderId> HandleAsync(CreateOrderCommand cmd, CancellationToken ct)
    {
        var order = Order.Create(new CustomerId(cmd.CustomerId), time.GetUtcNow());
        foreach (var l in cmd.Lines) order.AddLine(l.Sku, l.Quantity, new Money(l.UnitPrice, "EUR"));
        await orders.AddAsync(order, ct);
        await uow.SaveChangesAsync(ct);
        return order.Id;
    }
}
```

## 5. Endpoint modules

One static class per feature, mapped from `Program.cs`. Use route groups, `TypedResults` and union return types so the OpenAPI document is generated accurately from the signature and tests can rely on exact status codes.

```csharp
public static class OrderEndpoints
{
    public static IEndpointRouteBuilder MapOrderEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/orders")
            .WithTags("Orders")
            .RequireAuthorization();

        group.MapPost("/", CreateOrder).WithName("CreateOrder");
        group.MapGet("/{id:guid}", GetOrder).WithName("GetOrder");
        return app;
    }

    private static async Task<Created<OrderResponse>> CreateOrder(
        CreateOrderRequest request, CreateOrderHandler handler, OrderQueries queries, CancellationToken ct)
    {
        var id = await handler.HandleAsync(request.ToCommand(), ct);
        var order = await queries.GetAsync(id, ct);
        return TypedResults.Created($"/api/orders/{id.Value}", order);
    }

    private static async Task<Results<Ok<OrderResponse>, NotFound>> GetOrder(
        Guid id, OrderQueries queries, CancellationToken ct) =>
        await queries.GetAsync(new OrderId(id), ct) is { } order
            ? TypedResults.Ok(order)
            : TypedResults.NotFound();
}
```

Request/response DTOs are separate from domain types; never serialize aggregates directly.

## 6. Program.cs

```csharp
var builder = WebApplication.CreateBuilder(args);

builder.Services
    .AddProblemDetails()
    .AddExceptionHandler<DomainExceptionHandler>()   // maps DomainException -> 409/422 ProblemDetails
    .AddValidation()                                 // .NET 10 built-in Minimal API validation (DataAnnotations)
    .AddOpenApi()
    .AddApplication()
    .AddInfrastructure(builder.Configuration);

builder.Services.AddAuthentication().AddJwtBearer();
builder.Services.AddAuthorization();

var app = builder.Build();

app.UseExceptionHandler();
app.UseStatusCodePages();
app.UseAuthentication();
app.UseAuthorization();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();               // /openapi/v1.json
    app.MapScalarApiReference();    // /scalar/v1
}

app.MapOrderEndpoints();
app.Run();

public partial class Program;
```

## 7. Errors and validation

- Return RFC 9457 ProblemDetails for every non-2xx. Validation failures produce `HttpValidationProblemDetails` with an `errors` dictionary; tests assert on keys, not on message text.
- Map domain exceptions in one `IExceptionHandler`, so the mapping is tested once per category and endpoints stay free of try/catch.
- Annotate request DTOs (`[Required]`, `[Range]`, `[MaxLength]`) for `AddValidation()`, or use endpoint filters with FluentValidation if the codebase already does.

## 8. OpenAPI + Scalar

- `builder.Services.AddOpenApi()` + `app.MapOpenApi()` generate the document from endpoint metadata. `WithName`, `WithTags`, `WithSummary`, and `TypedResults` union types are what make the document useful.
- `Scalar.AspNetCore` provides the UI: `app.MapScalarApiReference()`. Gate both behind `IsDevelopment()` (or an explicit flag) unless the API docs are meant to be public.
- Declare security schemes with a document transformer, otherwise Scalar shows no auth UI; set a preferred scheme only after that.
- Disable the Scalar proxy for APIs with sensitive data (`options.WithProxy(null)`) if the installed version exposes it, since it relays requests through a third party.
- Keep `Scalar.AspNetCore`, `Microsoft.AspNetCore.OpenApi` and `Microsoft.OpenApi` versions aligned; a transitive bump of `Microsoft.OpenApi` has caused startup failures on .NET 10, which then surface as every integration test failing at once.

## 9. Architecture tests

A few lines prevent the layering from rotting, which keeps integration tests meaningful (they assume the Domain has no infrastructure leaks).

```csharp
[Fact]
public void Domain_does_not_depend_on_outer_layers()
{
    var result = Types.InAssembly(typeof(Order).Assembly)
        .ShouldNot().HaveDependencyOnAny("Ordering.Application", "Ordering.Infrastructure", "Ordering.Api")
        .GetResult();

    result.IsSuccessful.ShouldBeTrue();
}
```

(`NetArchTest.Rules`; ArchUnitNET is an alternative.)
