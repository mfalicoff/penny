using System.Text.Json.Nodes;

namespace Penny.Backend.Application.Households;

// Audit snapshots are written without the payer's private `accountId` and without the
// receipt's filename (encrypted at rest). Rows imported from SQLite, or written by an
// older legacy version, may still carry them, so every snapshot is redacted again when
// it is read: the response never depends on how a row was written.
public static class AuditRedaction
{
    public static string? Redact(string? json)
    {
        if (json is null)
            return null;
        if (JsonNode.Parse(json) is not JsonObject snapshot)
            return json;
        var changed = snapshot.Remove("accountId");
        if (snapshot["receipt"] is JsonObject receipt)
            changed |= receipt.Remove("name");
        return changed ? snapshot.ToJsonString() : json;
    }
}
