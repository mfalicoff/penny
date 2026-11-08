# Test patterns

Contents: 1. Conventions · 2. Create + persistence · 3. Get and not-found · 4. Validation · 5. Auth · 6. Domain-rule mapping · 7. Concurrency · 8. Time · 9. Outbound HTTP · 10. OpenAPI and Scalar contract tests · 11. Snapshots with Verify · 12. Data builders · 13. Theories

## 1. Conventions

- One test class per endpoint or use case (`CreateOrderTests`, `GetOrderTests`), deriving from `IntegrationTestBase`.
- Arrange / Act / Assert, with the act being a single HTTP call.
- Always pass `TestContext.Current.CancellationToken` (xUnit v3).
- Prefer `HttpClient` JSON helpers (`PostAsJsonAsync`, `ReadFromJsonAsync`) with the same DTO types the API exposes.
- Usings assumed: `System.Net`, `System.Net.Http.Json`, `Shouldly`, `Microsoft.EntityFrameworkCore`.

## 2. Create + persistence

```csharp
public sealed class CreateOrderTests(ApiFixture fixture) : IntegrationTestBase(fixture)
{
    [Fact]
    public async Task Post_orders_with_valid_body_returns_201_and_persists_the_aggregate()
    {
        var ct = TestContext.Current.CancellationToken;
        var client = CreateClientFor("user-1", "customer");
        var request = new CreateOrderRequest(Guid.NewGuid(), [new("SKU-1", 2, 9.99m)]);

        var response = await client.PostAsJsonAsync("/api/orders", request, ct);

        response.StatusCode.ShouldBe(HttpStatusCode.Created);
        var body = await response.Content.ReadFromJsonAsync<OrderResponse>(ct);
        body.ShouldNotBeNull();
        response.Headers.Location!.ToString().ShouldBe($"/api/orders/{body.Id}");

        var stored = await WithDbAsync(db =>
            db.Orders.Include(o => o.Lines).SingleAsync(o => o.Id == new OrderId(body.Id), ct));
        stored.CustomerId.Value.ShouldBe(request.CustomerId);
        stored.Lines.ShouldHaveSingleItem().Quantity.ShouldBe(2);
        stored.CreatedAt.ShouldBe(Fixture.Time.GetUtcNow());
    }
}
```

## 3. Get and not-found

Seed through the domain model, not raw SQL, so seeded data is always valid:

```csharp
[Fact]
public async Task Get_order_returns_200_with_lines()
{
    var ct = TestContext.Current.CancellationToken;
    var order = new OrderBuilder().WithLine("SKU-1", 3).Build(Fixture.Time.GetUtcNow());
    await WithDbAsync(async db => { db.Orders.Add(order); await db.SaveChangesAsync(ct); });

    var response = await CreateClientFor("user-1").GetAsync($"/api/orders/{order.Id.Value}", ct);

    response.StatusCode.ShouldBe(HttpStatusCode.OK);
    var body = await response.Content.ReadFromJsonAsync<OrderResponse>(ct);
    body!.Lines.ShouldHaveSingleItem().Sku.ShouldBe("SKU-1");
}

[Fact]
public async Task Get_unknown_order_returns_404()
{
    var response = await CreateClientFor("user-1")
        .GetAsync($"/api/orders/{Guid.NewGuid()}", TestContext.Current.CancellationToken);

    response.StatusCode.ShouldBe(HttpStatusCode.NotFound);
}
```

## 4. Validation

```csharp
[Fact]
public async Task Post_orders_without_lines_returns_400_validation_problem()
{
    var ct = TestContext.Current.CancellationToken;
    var client = CreateClientFor("user-1");

    var response = await client.PostAsJsonAsync("/api/orders", new { customerId = Guid.NewGuid(), lines = Array.Empty<object>() }, ct);

    response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    var problem = await response.Content.ReadFromJsonAsync<HttpValidationProblemDetails>(ct);
    problem!.Errors.Keys.ShouldContain("Lines");   // key casing follows the app's configuration; assert what the API really emits
}
```

Assert error keys, not message strings, which tend to change with wording and localization.

## 5. Auth

```csharp
[Fact]
public async Task Anonymous_request_returns_401()
{
    var response = await Client.GetAsync($"/api/orders/{Guid.NewGuid()}", TestContext.Current.CancellationToken);
    response.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
}

[Fact]
public async Task User_without_required_role_returns_403()
{
    var client = CreateClientFor("user-1", "viewer");
    var response = await client.DeleteAsync($"/api/orders/{Guid.NewGuid()}", TestContext.Current.CancellationToken);
    response.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
}
```

For ownership rules ("a customer can only see their own orders"), seed an order for user A and request it as user B; expect 404 or 403 per the API's policy.

## 6. Domain-rule mapping

```csharp
[Fact]
public async Task Adding_a_line_to_a_submitted_order_returns_409_problem_details()
{
    var ct = TestContext.Current.CancellationToken;
    var order = new OrderBuilder().WithLine("SKU-1", 1).Submitted().Build(Fixture.Time.GetUtcNow());
    await WithDbAsync(async db => { db.Orders.Add(order); await db.SaveChangesAsync(ct); });

    var response = await CreateClientFor("user-1")
        .PostAsJsonAsync($"/api/orders/{order.Id.Value}/lines", new AddLineRequest("SKU-2", 1, 5m), ct);

    response.StatusCode.ShouldBe(HttpStatusCode.Conflict);
    var problem = await response.Content.ReadFromJsonAsync<ProblemDetails>(ct);
    problem!.Extensions["code"]!.ToString().ShouldBe("order.not_editable");
}
```

The invariant itself is covered in the domain unit tests; this test proves the exception handler maps it correctly.

## 7. Concurrency

```csharp
[Fact]
public async Task Updating_with_a_stale_row_version_returns_409()
{
    // Arrange: create order, fetch it twice (both clients hold the same version)
    // Act: first update succeeds; second update with the old version/ETag
    // Assert: 409 or 412, depending on the API's contract
}
```

Fire genuinely concurrent requests with `Task.WhenAll` only when testing a locking or idempotency guarantee, and assert the invariant (exactly one succeeded), not timing.

## 8. Time

```csharp
[Fact]
public async Task Draft_orders_expire_after_24_hours()
{
    var ct = TestContext.Current.CancellationToken;
    var id = await CreateDraftOrderAsync(ct);

    Fixture.Time.Advance(TimeSpan.FromHours(25));
    await RunExpirySweepAsync(ct);   // call the real job/handler through DI, or trigger its endpoint

    var status = await WithDbAsync(db => db.Orders.Where(o => o.Id == id).Select(o => o.Status).SingleAsync(ct));
    status.ShouldBe(OrderStatus.Expired);
}
```

`ResetDatabaseAsync`/the base class resets the clock each test, so tests cannot leak time changes.

## 9. Outbound HTTP

With WireMock.Net started in the fixture (see `fixtures.md`):

```csharp
Fixture.Payments.Given(Request.Create().WithPath("/charges").UsingPost())
    .RespondWith(Response.Create().WithStatusCode(201).WithBodyAsJson(new { id = "ch_1", status = "succeeded" }));

var response = await client.PostAsync($"/api/orders/{id}/pay", null, ct);
response.StatusCode.ShouldBe(HttpStatusCode.OK);
Fixture.Payments.LogEntries.ShouldHaveSingleItem();
```

Also test the failure path (502/timeout from the dependency) because that is where retry and circuit-breaker configuration lives.

## 10. OpenAPI and Scalar contract tests

These catch accidental breaking changes and broken documentation wiring (which otherwise only shows up when someone opens the docs).

```csharp
public sealed class OpenApiContractTests(ApiFixture fixture) : IntegrationTestBase(fixture)
{
    [Fact]
    public async Task OpenApi_document_is_served_and_describes_the_orders_operations()
    {
        var ct = TestContext.Current.CancellationToken;

        var response = await Client.GetAsync("/openapi/v1.json", ct);

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
        var paths = doc.RootElement.GetProperty("paths");
        paths.TryGetProperty("/api/orders", out var orders).ShouldBeTrue();
        orders.GetProperty("post").GetProperty("operationId").GetString().ShouldBe("CreateOrder");
        paths.TryGetProperty("/api/orders/{id}", out _).ShouldBeTrue();
    }

    [Fact]
    public async Task Scalar_reference_is_served()
    {
        var response = await Client.GetAsync("/scalar/v1", TestContext.Current.CancellationToken);
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task Every_operation_has_an_operationId()
    {
        var ct = TestContext.Current.CancellationToken;
        using var doc = JsonDocument.Parse(await Client.GetStringAsync("/openapi/v1.json", ct));

        var missing = doc.RootElement.GetProperty("paths").EnumerateObject()
            .SelectMany(p => p.Value.EnumerateObject().Select(op => (path: p.Name, op)))
            .Where(x => !x.op.Value.TryGetProperty("operationId", out _))
            .Select(x => $"{x.op.Name.ToUpperInvariant()} {x.path}");

        missing.ShouldBeEmpty();
    }
}
```

These rely on the factory running in `Development` (the default) where the app maps the documentation endpoints. If the app maps them in other environments or behind a flag, set that in the factory.

## 11. Snapshots with Verify

A snapshot of the OpenAPI document makes every public contract change an explicit, reviewable diff.

```csharp
[Fact]
public async Task OpenApi_document_matches_snapshot()
{
    var json = await Client.GetStringAsync("/openapi/v1.json", TestContext.Current.CancellationToken);
    await VerifyJson(json);   // Verify.XunitV3
}
```

Scrub volatile parts (servers URL, generated version strings) with Verify's scrubbers. Commit the `.verified.json` files. Use snapshots for large, stable response shapes too, but keep behavioral assertions (status codes, persistence) as explicit asserts.

## 12. Data builders

```csharp
public sealed class OrderBuilder
{
    private CustomerId _customer = new(Guid.NewGuid());
    private readonly List<(string Sku, int Qty)> _lines = [];
    private bool _submit;

    public OrderBuilder ForCustomer(Guid id) { _customer = new(id); return this; }
    public OrderBuilder WithLine(string sku, int qty) { _lines.Add((sku, qty)); return this; }
    public OrderBuilder Submitted() { _submit = true; return this; }

    public Order Build(DateTimeOffset now)
    {
        var order = Order.Create(_customer, now);
        foreach (var (sku, qty) in _lines) order.AddLine(sku, qty, new Money(10m, "EUR"));
        if (_submit) order.Submit(now);
        return order;
    }
}
```

Builders use public domain methods, so tests cannot create states the domain forbids. Use Bogus for bulk/random data where the specific values do not matter, with a fixed seed so failures reproduce.

## 13. Theories

```csharp
public static TheoryData<string, int> InvalidLines => new()
{
    { "", 1 },          // empty SKU
    { "SKU-1", 0 },     // zero quantity
    { "SKU-1", -5 },    // negative quantity
};

[Theory]
[MemberData(nameof(InvalidLines))]
public async Task Post_orders_with_invalid_line_returns_400(string sku, int quantity)
{
    var ct = TestContext.Current.CancellationToken;
    var response = await CreateClientFor("user-1")
        .PostAsJsonAsync("/api/orders", new CreateOrderRequest(Guid.NewGuid(), [new(sku, quantity, 5m)]), ct);

    response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
}
```

Theories are good for input-validation matrices; keep each case small, because each one pays the Respawn cost.
