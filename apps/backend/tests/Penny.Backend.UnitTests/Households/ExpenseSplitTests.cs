using Penny.Backend.Domain.Errors;
using Penny.Backend.Domain.Households;
using Shouldly;
using Xunit;

namespace Penny.Backend.UnitTests.Households;

public sealed class ExpenseSplitTests
{
    private static readonly string[] Members = ["alex", "bea", "cam"];

    [Fact]
    public void whenEqualSplitHasAllocations_Allocate_ShouldIgnoreThem() =>
        ExpenseSplit
            .Allocate(10_000, ExpenseSplit.Equal, Members, [new("alex", 10_000, null)])
            .Select(share => share.AmountCents)
            .ShouldBe([3334L, 3333L, 3333L]);

    [Fact]
    public void whenAllocationsDoNotCoverEligibleMembers_Allocate_ShouldRejectInOrder()
    {
        Reject(ExpenseSplit.Equal, [], null).ShouldBe(ExpenseSplit.DistinctMembers);
        Reject(ExpenseSplit.Exact, Members, null).ShouldBe(ExpenseSplit.EveryMember);
        Reject(ExpenseSplit.Exact, Members, []).ShouldBe(ExpenseSplit.EveryMember);
        // An ineligible member (left, or joined after the expense date).
        Reject(
                ExpenseSplit.Exact,
                Members,
                [new("alex", 5000, null), new("bea", 5000, null), new("dan", 0, null)]
            )
            .ShouldBe(ExpenseSplit.EveryMember);
        Reject(
                ExpenseSplit.Exact,
                Members,
                [new("alex", 5000, null), new("alex", 5000, null), new("bea", 0, null)]
            )
            .ShouldBe(ExpenseSplit.EveryMember);
        Reject(
                ExpenseSplit.Exact,
                Members,
                [new("alex", 5000, null), new("bea", 5000, null), new("cam", null, 0)]
            )
            .ShouldBe(ExpenseSplit.ExactAmounts);
        Reject(
                ExpenseSplit.Percent,
                Members,
                [new("alex", null, 5000), new("bea", null, 5000), new("cam", 0, null)]
            )
            .ShouldBe(ExpenseSplit.PercentAmounts);
    }

    [Fact]
    public void whenSharesDoNotAddUp_Allocate_ShouldRejectWithTotalMessage()
    {
        Reject(
                ExpenseSplit.Exact,
                Members,
                [new("alex", 5000, null), new("bea", 2500, null), new("cam", 2499, null)]
            )
            .ShouldBe(ExpenseSplit.Total);
        Reject(
                ExpenseSplit.Percent,
                Members,
                [new("alex", null, 5000), new("bea", null, 2500), new("cam", null, 2499)]
            )
            .ShouldBe(ExpenseSplit.Total);
    }

    [Fact]
    public void whenSameMembersRemain_Recurring_ShouldKeepStoredSplit()
    {
        SplitAllocation[] exact = [new("alex", 6000, null), new("bea", 3000, null)];
        var (shares, mode) = ExpenseSplit.Recurring(
            9000,
            ExpenseSplit.Exact,
            exact,
            ["alex", "bea"]
        );
        mode.ShouldBe(ExpenseSplit.Exact);
        shares.Select(share => share.AmountCents).ShouldBe([6000L, 3000L]);

        // Someone joined: the occurrence falls back to an equal split.
        (shares, mode) = ExpenseSplit.Recurring(
            9000,
            ExpenseSplit.Exact,
            exact,
            ["alex", "bea", "cam"]
        );
        mode.ShouldBe(ExpenseSplit.Equal);
        shares.Select(share => share.AmountCents).ShouldBe([3000L, 3000L, 3000L]);

        (shares, _) = ExpenseSplit.Recurring(
            10_000,
            ExpenseSplit.Percent,
            [new("alex", null, 6000), new("cam", null, 4000)],
            ["alex", "cam"]
        );
        shares.Select(share => share.AmountCents).ShouldBe([6000L, 4000L]);
    }

    private static string Reject(
        string mode,
        IReadOnlyList<string> members,
        IReadOnlyList<SplitAllocation>? allocations
    )
    {
        var failure = Should.Throw<BackendFailure>(() =>
            ExpenseSplit.Allocate(10_000, mode, members, allocations)
        );
        failure.Kind.ShouldBe(FailureKind.Invalid);
        return failure.Message;
    }
}
