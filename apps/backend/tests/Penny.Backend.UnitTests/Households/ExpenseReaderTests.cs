using System.Text.Json;
using Penny.Backend.Domain.Households;
using Shouldly;
using Xunit;

namespace Penny.Backend.UnitTests.Households;

public sealed class ExpenseReaderTests
{
    private const string Valid = """
        {"title":"  Groceries ","totalCents":9000,"date":"2026-09-28","payerUserId":"alex","splitMode":"equal",
         "category":{"name":" Food ","icon":"basket-outline","color":"#6C9C79"},"extra":true}
        """;

    [Fact]
    public void whenBodyIsMinimal_ReadInput_ShouldTrimAndDefault()
    {
        var input = ExpenseReader.ReadInput(Parse(Valid))!;
        input.Title.ShouldBe("Groceries");
        input.Category.ShouldBe(new ExpenseCategory("Food", "basket-outline", "#6C9C79"));
        input.Note.ShouldBe("");
        input.Allocations.ShouldBeNull();
        input.AccountId.ShouldBeNull();
        input.TimezoneOffsetMinutes.ShouldBeNull();
    }

    [Theory]
    [InlineData("\"note\":null")]
    [InlineData("\"accountId\":null")]
    [InlineData("\"receiptId\":\"\"")]
    [InlineData("\"totalCents\":0")]
    [InlineData("\"totalCents\":100000000000")]
    [InlineData("\"totalCents\":10.5")]
    [InlineData("\"date\":\"2026-02-30\"")]
    [InlineData("\"splitMode\":\"shares\"")]
    [InlineData("\"title\":\"   \"")]
    [InlineData("\"timezoneOffsetMinutes\":721")]
    [InlineData("\"category\":{\"name\":\"Food\",\"icon\":\"x\",\"color\":\"#6C9C7\"}")]
    [InlineData("\"allocations\":[{\"userId\":\"alex\"}]")]
    [InlineData("\"allocations\":[{\"userId\":\"alex\",\"percentBasisPoints\":10001}]")]
    [InlineData("\"allocations\":[{\"userId\":\"\",\"amountCents\":1}]")]
    public void whenFieldIsInvalid_ReadInput_ShouldReturnNull(string field) =>
        ExpenseReader.ReadInput(Parse(Valid.Replace("\"extra\":true", field))).ShouldBeNull();

    [Fact]
    public void whenAllocationMatchesBothShapes_ReadInput_ShouldPreferAmountLikeZodUnion()
    {
        var input = ExpenseReader.ReadInput(
            Parse(
                Valid.Replace(
                    "\"extra\":true",
                    "\"allocations\":[{\"userId\":\"alex\",\"amountCents\":5,\"percentBasisPoints\":100},{\"userId\":\"bea\",\"amountCents\":-1,\"percentBasisPoints\":9900}]"
                )
            )
        )!;
        input.Allocations.ShouldBe([new("alex", 5, null), new("bea", null, 9900)]);
    }

    [Fact]
    public void whenUpdateAndDeleteBodiesRead_Readers_ShouldRequireSafeRevision()
    {
        var update = ExpenseReader.ReadUpdate(
            Parse(Valid.Replace("\"extra\":true", "\"revision\":3,\"targetHouseholdId\":\"trip\""))
        )!;
        update.Revision.ShouldBe(3);
        update.TargetHouseholdId.ShouldBe("trip");
        ExpenseReader.ReadUpdate(Parse(Valid)).ShouldBeNull();
        ExpenseReader.ReadRevision(Parse("""{"revision":0}""")).ShouldBe(0);
        ExpenseReader.ReadRevision(Parse("""{"revision":-1}""")).ShouldBeNull();
        ExpenseReader.ReadRevision(Parse("""{"revision":9007199254740992}""")).ShouldBeNull();
        ExpenseReader.ReadRevision(null).ShouldBeNull();
        ExpenseReader
            .ReadPayment(Parse("""{"fromUserId":"bea","revision":1,"amountCents":1}"""))
            .ShouldBe(new PaymentRequest("bea", 1));
        ExpenseReader.ReadPayment(Parse("""{"fromUserId":"","revision":1}""")).ShouldBeNull();
    }

    [Theory]
    [InlineData("2026-09", true)]
    [InlineData("0000-12", true)]
    [InlineData("2026-13", false)]
    [InlineData("2026-9", false)]
    [InlineData("2026-09\n", false)]
    public void whenMonthQueryChecked_IsMonth_ShouldMatchLegacyPattern(string value, bool valid) =>
        ExpenseReader.IsMonth(value).ShouldBe(valid);

    [Theory]
    [InlineData("2026", true)]
    [InlineData("26", false)]
    [InlineData("2026\n", false)]
    public void whenYearQueryChecked_IsYear_ShouldMatchLegacyPattern(string value, bool valid) =>
        ExpenseReader.IsYear(value).ShouldBe(valid);

    private static JsonElement Parse(string json) => JsonDocument.Parse(json).RootElement;
}
