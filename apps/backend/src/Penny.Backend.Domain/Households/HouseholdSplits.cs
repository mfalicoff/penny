using Penny.Backend.Domain.Ledgers;

namespace Penny.Backend.Domain.Households;

// Household split allocation: integer cents only, deterministic remainder allocation,
// shares ordered by member id. Every rule violation throws ArgumentException. Ids are
// compared ordinally, including in the percentage tie-break.
public static class HouseholdSplits
{
    public const long PercentWhole = 10_000;

    // Base share each; the remainder cents go one each to the lexically first members.
    public static IReadOnlyList<SplitShare> Equal(long totalCents, IEnumerable<string> memberIds)
    {
        Cents(totalCents, allowZero: false);
        var ids = SortedUnique(memberIds);
        var share = totalCents / ids.Count;
        var remainder = totalCents % ids.Count;
        return
        [
            .. ids.Select(
                (userId, index) => new SplitShare(userId, share + (index < remainder ? 1 : 0))
            ),
        ];
    }

    // Shares as given (zero allowed); they must add up to the total.
    public static IReadOnlyList<SplitShare> Exact(
        long totalCents,
        IReadOnlyCollection<SplitShare> allocations
    )
    {
        Cents(totalCents, allowZero: false);
        var ids = SortedUnique(allocations.Select(allocation => allocation.UserId));
        var byUser = allocations.ToDictionary(item => item.UserId, StringComparer.Ordinal);
        var shares = ids.Select(userId => byUser[userId]).ToList();
        long sum = 0;
        foreach (var share in shares)
        {
            Cents(share.AmountCents, allowZero: true);
            sum = checked(sum + share.AmountCents);
        }
        return sum == totalCents
            ? shares
            : throw new ArgumentException("Exact shares must add up to the expense total.");
    }

    // Basis points must add up to 100%. Each share is floor(total * points / 10000),
    // computed by dividing first so no intermediate exceeds the total; the cents left
    // over go one each to the largest fractional remainders, ties to the lower id.
    public static IReadOnlyList<SplitShare> Percent(
        long totalCents,
        IReadOnlyCollection<(string UserId, long PercentBasisPoints)> allocations
    )
    {
        Cents(totalCents, allowZero: false);
        var ids = SortedUnique(allocations.Select(allocation => allocation.UserId));
        var byUser = allocations.ToDictionary(item => item.UserId, StringComparer.Ordinal);
        var percents = ids.Select(userId => byUser[userId]).ToList();
        long points = 0;
        foreach (var (_, basisPoints) in percents)
        {
            if (basisPoints is < 0 or > PercentWhole)
                throw new ArgumentException(
                    "Percentages must be between 0 and 100 with at most two decimal places."
                );
            points += basisPoints;
        }
        if (points != PercentWhole)
            throw new ArgumentException("Percentages must add up to 100%.");
        var quotient = totalCents / PercentWhole;
        var remainder = totalCents % PercentWhole;
        var amounts = new long[percents.Count];
        var leftovers = new long[percents.Count];
        for (var index = 0; index < percents.Count; index++)
        {
            var minor = remainder * percents[index].PercentBasisPoints;
            amounts[index] = quotient * percents[index].PercentBasisPoints + minor / PercentWhole;
            leftovers[index] = minor % PercentWhole;
        }
        var centsLeft = totalCents - amounts.Sum();
        foreach (
            var index in Enumerable
                .Range(0, percents.Count)
                .OrderByDescending(index => leftovers[index])
                .ThenBy(index => percents[index].UserId, StringComparer.Ordinal)
        )
        {
            if (centsLeft-- <= 0)
                break;
            amounts[index]++;
        }
        return [.. percents.Select((item, index) => new SplitShare(item.UserId, amounts[index]))];
    }

    // `assertCents`: a JavaScript safe integer, positive unless zero is allowed.
    private static void Cents(long value, bool allowZero)
    {
        if (value < 0 || value > LedgerLimits.MaxSafeInteger || (!allowZero && value == 0))
            throw new ArgumentException("Amounts must be positive integer numbers of cents.");
    }

    // `sortedUniqueIds`: at least one id, none blank (JavaScript trim), no duplicates.
    private static List<string> SortedUnique(IEnumerable<string> ids)
    {
        var list = ids.ToList();
        if (
            list.Count == 0
            || list.Exists(id => LedgerText.TrimLikeJavaScript(id).Length == 0)
            || list.Distinct(StringComparer.Ordinal).Count() != list.Count
        )
            throw new ArgumentException("A split needs distinct members.");
        list.Sort(StringComparer.Ordinal);
        return list;
    }
}
