using Penny.Backend.Application.Households;
using Penny.Backend.Domain.Ledgers;

namespace Penny.Backend.Application.Search;

// One result: `Entry` for a personal entry, `Shared` for a shared expense. `Match` is
// the best tier (title, text, typo or meaning), null for an empty query.
public sealed record SearchItemView(
    string Key,
    string Source,
    string? Match,
    Entry? Entry,
    ProjectedExpenseView? Shared
);
