using Penny.Backend.Domain.Ledgers;
using Shouldly;
using Xunit;

namespace Penny.Backend.UnitTests.Ledgers;

// The parts of the MAZ-151 currency rules the golden fixture doesn't spell out: stored
// rate syntax, source quote canonicalization and the reference error messages.
public sealed class CurrenciesTests
{
    [Theory]
    [InlineData("1", true)]
    [InlineData("0.5", true)]
    [InlineData("1.4612", true)]
    [InlineData("999999999.99999999", true)]
    [InlineData("0.00000001", true)]
    [InlineData("0", false)]
    [InlineData("0.0", false)]
    [InlineData("1.20", false)]
    [InlineData("01.2", false)]
    [InlineData("1.", false)]
    [InlineData(".5", false)]
    [InlineData("1000000000", false)]
    [InlineData("0.000000001", false)]
    [InlineData("-1", false)]
    [InlineData("1e3", false)]
    [InlineData("1,5", false)]
    [InlineData("١", false)]
    [InlineData("", false)]
    public void whenRateChecked_ValidRate_ShouldAcceptOnlyCanonicalPositiveRates(
        string rate,
        bool valid
    )
    {
        Currencies.ValidRate(rate).ShouldBe(valid, rate);
    }

    [Theory]
    [InlineData("158.4500", "158.45")]
    [InlineData("1.0000", "1")]
    [InlineData("0.86200", "0.862")]
    [InlineData("17000", "17000")]
    [InlineData("007.5", "7.5")]
    [InlineData("N/A", null)]
    [InlineData("", null)]
    [InlineData("0.0000", null)]
    [InlineData("1.123456789", null)]
    [InlineData(" 1.2", null)]
    public void whenSourceQuoteRead_Canonicalize_ShouldReturnTheStoredForm(
        string value,
        string? rate
    )
    {
        Currencies.Canonicalize(value).ShouldBe(rate, value);
    }

    [Theory]
    [InlineData(12420L, null, null, null, null, false, null)]
    [InlineData(12420L, null, null, null, null, true, "Invalid original amount")]
    [InlineData(12420L, 8500L, "EUR", null, null, false, "Invalid original amount")]
    [InlineData(8500L, 8500L, "CAD", "1", "published", true, "Invalid original currency")]
    [InlineData(12420L, 8500L, "EUR", "1.46120", "published", true, "Invalid exchange rate")]
    [InlineData(12420L, 8500L, "EUR", "1.4612", "manual", true, "Invalid exchange rate")]
    [InlineData(12420L, 8500L, "EUR", "1.4612", "edited", true, "Invalid exchange rate")]
    [InlineData(12420L, 8500L, "EUR", "1.4612", "published", false, "Invalid exchange rate")]
    [InlineData(12421L, 8500L, "EUR", "1.4612", "published", true, "Invalid converted amount")]
    [InlineData(12420L, 8500L, "EUR", "1.4612", "provisional", true, null)]
    [InlineData(12665L, 8500L, "EUR", "1.49", "edited", false, null)]
    public void whenFieldsChecked_ForeignAmountProblem_ShouldNameTheReferenceProblem(
        long total,
        long? amount,
        string? currency,
        string? rate,
        string? status,
        bool dated,
        string? problem
    )
    {
        Currencies
            .ForeignAmountProblem(
                total,
                amount,
                currency,
                rate,
                status,
                dated ? new DateOnly(2026, 11, 3) : null,
                "CAD"
            )
            .ShouldBe(problem);
    }

    [Theory]
    [InlineData(763, 1526, 2230, 1115)]
    [InlineData(1, 3, 1, 0)]
    [InlineData(1, 2, 1, 1)]
    [InlineData(0, 56400, 82380, 0)]
    [InlineData(56400, 56400, 82380, 82380)]
    [InlineData(
        9_007_199_254_740_990,
        9_007_199_254_740_991,
        9_007_199_254_740_991,
        9_007_199_254_740_990
    )]
    public void whenShareCarried_ProportionHalfUp_ShouldRoundHalfUpAndKeepWholeShares(
        long part,
        long whole,
        long of,
        long expected
    )
    {
        Currencies.ProportionHalfUp(part, whole, of).ShouldBe(expected);
    }

    [Fact]
    public void whenShareExceedsTotal_ProportionHalfUp_ShouldRefuseIt()
    {
        Should
            .Throw<ArgumentException>(() => Currencies.ProportionHalfUp(2, 1, 5))
            .Message.ShouldStartWith("A share cannot exceed its total.");
        Should.Throw<ArgumentException>(() => Currencies.ProportionHalfUp(0, 0, 5));
        Should.Throw<ArgumentException>(() => Currencies.ProportionHalfUp(-1, 1, 5));
    }

    [Fact]
    public void whenCurrencyUnknown_MinorUnits_ShouldRefuseIt()
    {
        Should.Throw<ArgumentException>(() => Currencies.MinorUnits("XXX"));
        Should.Throw<ArgumentException>(() => Currencies.ConvertAmount(1, "EUR", "0", "CAD"));
    }
}
