using Penny.Backend.Domain.Errors;

namespace Penny.Backend.Domain.Households;

// Port of the legacy server `split` (server/infrastructure/households.ts): checks a
// requested split against the eligible members, then allocates integer cents with
// HouseholdSplits. Messages and their order are part of the client contract.
public static class ExpenseSplit
{
    public const string Equal = "equal";
    public const string Exact = "exact";
    public const string Percent = "percent";
    public const string DistinctMembers = "Select distinct members.";
    public const string EveryMember = "Provide one split for every eligible member.";
    public const string ExactAmounts = "Exact splits need amounts.";
    public const string PercentAmounts = "Percentage splits need percentages.";
    public const string Total = "Split shares must add up to the expense total.";

    public static readonly IReadOnlyList<string> Modes = [Equal, Exact, Percent];

    // `memberIds` are the members eligible on the expense date. Equal splits ignore
    // `allocations`; exact and percentage splits need one allocation per eligible
    // member, each of the right kind, adding up to the total.
    public static IReadOnlyList<SplitShare> Allocate(
        long totalCents,
        string mode,
        IReadOnlyList<string> memberIds,
        IReadOnlyList<SplitAllocation>? allocations
    )
    {
        if (
            memberIds.Count == 0
            || memberIds.Distinct(StringComparer.Ordinal).Count() != memberIds.Count
        )
            throw new BackendFailure(FailureKind.Invalid, DistinctMembers);
        if (string.Equals(mode, Equal, StringComparison.Ordinal))
            return Calculate(() => HouseholdSplits.Equal(totalCents, memberIds));
        if (
            allocations is null
            || allocations.Count == 0
            || allocations.Count != memberIds.Count
            || allocations.Any(item => !memberIds.Contains(item.UserId, StringComparer.Ordinal))
            || allocations.Select(item => item.UserId).Distinct(StringComparer.Ordinal).Count()
                != memberIds.Count
        )
            throw new BackendFailure(FailureKind.Invalid, EveryMember);
        if (string.Equals(mode, Exact, StringComparison.Ordinal))
        {
            if (allocations.Any(item => item.AmountCents is null))
                throw new BackendFailure(FailureKind.Invalid, ExactAmounts);
            return Calculate(() =>
                HouseholdSplits.Exact(
                    totalCents,
                    [
                        .. allocations.Select(item => new SplitShare(
                            item.UserId,
                            item.AmountCents!.Value
                        )),
                    ]
                )
            );
        }
        if (allocations.Any(item => item.PercentBasisPoints is null))
            throw new BackendFailure(FailureKind.Invalid, PercentAmounts);
        return Calculate(() =>
            HouseholdSplits.Percent(
                totalCents,
                [.. allocations.Select(item => (item.UserId, item.PercentBasisPoints!.Value))]
            )
        );
    }

    // Legacy `calculateRecurringSplits` for one occurrence: a rule's stored split
    // applies while exactly the same members are active; otherwise the occurrence is
    // split equally among the active members. `SplitMode` is the mode the occurrence
    // records.
    public static (IReadOnlyList<SplitShare> Shares, string SplitMode) Recurring(
        long totalCents,
        string mode,
        IReadOnlyList<SplitAllocation> allocations,
        IReadOnlyList<string> activeIds
    )
    {
        if (activeIds.Count == 0)
            throw new ArgumentException("A recurring expense needs an active household member.");
        var equal = string.Equals(mode, Equal, StringComparison.Ordinal);
        var templateIds = equal ? activeIds : [.. allocations.Select(item => item.UserId)];
        var sameMembers =
            templateIds.Count == activeIds.Count
            && activeIds.All(id => templateIds.Contains(id, StringComparer.Ordinal));
        if (!sameMembers || equal)
            return (HouseholdSplits.Equal(totalCents, activeIds), sameMembers ? mode : Equal);
        var shares = string.Equals(mode, Exact, StringComparison.Ordinal)
            ? HouseholdSplits.Exact(
                totalCents,
                [
                    .. allocations.Select(item => new SplitShare(
                        item.UserId,
                        item.AmountCents ?? throw new ArgumentException("Exact rules need amounts.")
                    )),
                ]
            )
            : HouseholdSplits.Percent(
                totalCents,
                [
                    .. allocations.Select(item =>
                        (
                            item.UserId,
                            item.PercentBasisPoints
                                ?? throw new ArgumentException("Percentage rules need percentages.")
                        )
                    ),
                ]
            );
        return (shares, mode);
    }

    private static IReadOnlyList<SplitShare> Calculate(Func<IReadOnlyList<SplitShare>> calculate)
    {
        try
        {
            return calculate();
        }
        catch (ArgumentException)
        {
            throw new BackendFailure(FailureKind.Invalid, Total);
        }
    }
}
