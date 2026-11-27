using System.Text.Json;

namespace Penny.Backend.UnitTests.Contracts;

// A whole v4 ledger and whether the TypeScript write schema accepts it.
public sealed record CurrencyLedgerCase(string Name, JsonElement Ledger, bool Valid);
