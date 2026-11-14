using System.Text.Json;
using Penny.Backend.Domain.Households;
using Shouldly;
using Xunit;

namespace Penny.Backend.UnitTests.Households;

public sealed class RecurringReaderTests
{
    private const string Valid = """
        {"title":" Rent ","totalCents":120000,"nextDate":"2027-01-31","frequency":"monthly",
         "payerUserId":"alex","splitMode":"equal","date":"not-a-date",
         "category":{"name":"Home","icon":"home","color":"#ABCDEF"},"extra":true}
        """;

    [Fact]
    public void whenBodyIsValid_ReadRecurring_ShouldReadNextDateAndIgnoreExpenseDate()
    {
        var input = ExpenseReader.ReadRecurring(Parse(Valid))!;
        input.Template.Title.ShouldBe("Rent");
        input.NextDate.ShouldBe(new DateOnly(2027, 1, 31));
        input.Frequency.ShouldBe("monthly");
        input.Template.Note.ShouldBe("");
    }

    [Theory]
    [InlineData("\"frequency\":\"daily\"")]
    [InlineData("\"nextDate\":\"2027-02-29\"")]
    [InlineData("\"nextDate\":null")]
    [InlineData("\"accountId\":null")]
    [InlineData("\"totalCents\":0")]
    public void whenFieldIsInvalid_ReadRecurring_ShouldReturnNull(string field) =>
        ExpenseReader.ReadRecurring(Parse(Valid.Replace("\"extra\":true", field))).ShouldBeNull();

    [Fact]
    public void whenFrequencyMissing_ReadRecurring_ShouldReturnNull() =>
        ExpenseReader
            .ReadRecurring(Parse(Valid.Replace("\"frequency\":\"monthly\",", "")))
            .ShouldBeNull();

    [Fact]
    public void whenUpdateIsValid_ReadRecurringUpdate_ShouldReadActiveAndRevision()
    {
        var update = ExpenseReader.ReadRecurringUpdate(
            Parse(Valid.Replace("\"extra\":true", "\"active\":false,\"revision\":3"))
        )!;
        update.Active.ShouldBeFalse();
        update.Revision.ShouldBe(3);
        update.Input.NextDate.ShouldBe(new DateOnly(2027, 1, 31));
    }

    [Theory]
    [InlineData("\"revision\":3")]
    [InlineData("\"active\":\"true\",\"revision\":3")]
    [InlineData("\"active\":true,\"revision\":-1")]
    [InlineData("\"active\":true")]
    public void whenUpdateFieldIsInvalid_ReadRecurringUpdate_ShouldReturnNull(string field) =>
        ExpenseReader
            .ReadRecurringUpdate(Parse(Valid.Replace("\"extra\":true", field)))
            .ShouldBeNull();

    [Fact]
    public void whenStoredRuleCannotApply_Occurrence_ShouldSplitEquallyAmongActiveMembers()
    {
        // Stored exact allocations that no longer add up to the total.
        var (shares, mode) = ExpenseSplit.Occurrence(
            9000,
            ExpenseSplit.Exact,
            [new("alex", 1000, null), new("bea", 1000, null)],
            ["alex", "bea"]
        );
        mode.ShouldBe(ExpenseSplit.Equal);
        shares.Select(share => share.AmountCents).ShouldBe([4500L, 4500L]);
    }

    private static JsonElement Parse(string json) => JsonDocument.Parse(json).RootElement.Clone();
}
