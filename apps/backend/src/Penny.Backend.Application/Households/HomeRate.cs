using Penny.Backend.Domain.Ledgers;

namespace Penny.Backend.Application.Households;

// A home rate for a date: home units per unit of what was paid, and the publication it
// comes from.
public sealed record HomeRate(string Rate, RatePublication Publication);
