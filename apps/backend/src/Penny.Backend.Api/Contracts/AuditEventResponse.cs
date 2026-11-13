using System.Text.Json;
using System.Text.Json.Serialization;
using Penny.Backend.Application.Households;

namespace Penny.Backend.Api.Contracts;

// Contract schema `AuditEvent`. `before` and `after` are the stored JSON snapshots, or
// null; `expenseId` is omitted for household events.
public sealed record AuditEventResponse(
    string Id,
    string HouseholdId,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? ExpenseId,
    string ActorId,
    string Action,
    JsonElement? Before,
    JsonElement? After,
    long CreatedAt
)
{
    public static AuditEventResponse From(AuditEventView audit) =>
        new(
            audit.Id,
            audit.HouseholdId,
            audit.ExpenseId,
            audit.ActorId,
            audit.Action,
            Snapshot(audit.BeforeJson),
            Snapshot(audit.AfterJson),
            audit.CreatedAt
        );

    private static JsonElement? Snapshot(string? json)
    {
        if (json is null)
            return null;
        using var document = JsonDocument.Parse(json);
        return document.RootElement.Clone();
    }
}
