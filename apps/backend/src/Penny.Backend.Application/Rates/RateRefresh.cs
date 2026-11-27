namespace Penny.Backend.Application.Rates;

// One refresh: whether the full history was fetched, how many quotes the source sent and
// how many rows changed. Counts only; rates are never logged.
public sealed record RateRefresh(bool History, int Quotes, int Changed);
