namespace Penny.Backend.IntegrationTests.Infrastructure;

// What the fake provider asserts about the signed-in person, plus deliberate faults.
// A claim override set to null removes the claim from the ID token.
public sealed record FakeOidcGrant
{
    public string Subject { get; init; } = "subject-01";
    public string Email { get; init; } = "person@example.test";
    public IReadOnlyDictionary<string, object?> Claims { get; init; } =
        new Dictionary<string, object?>();
    public bool WrongSigningKey { get; init; }
    public string? UserInfoSubject { get; init; }
    public object? UserInfoEmailVerified { get; init; } = true;
}
