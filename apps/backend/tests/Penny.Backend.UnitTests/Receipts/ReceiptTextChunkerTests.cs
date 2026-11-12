using Penny.Backend.Application.Receipts;
using Shouldly;
using Xunit;

namespace Penny.Backend.UnitTests.Receipts;

public sealed class ReceiptTextChunkerTests
{
    // One token per word plus four for the prefix and special tokens.
    private static int Tokens(string passage) =>
        passage.Split([' ', '\n'], StringSplitOptions.RemoveEmptyEntries).Length + 4;

    [Fact]
    public void whenTextFits_Split_ShouldKeepOnePassage()
    {
        ReceiptTextChunker
            .Split("STORE\nMilk 2.99\nTOTAL 2.99", Tokens, 512, 32)
            .ShouldBe(["STORE\nMilk 2.99\nTOTAL 2.99"]);
        ReceiptTextChunker.Split("", Tokens, 512, 32).ShouldBeEmpty();
    }

    [Fact]
    public void whenTextIsLong_Split_ShouldPackWholeLinesUnderTheBudget()
    {
        var text = string.Join('\n', Enumerable.Range(1, 30).Select(line => $"item {line} 1.00"));
        var chunks = ReceiptTextChunker.Split(text, Tokens, 20, 32);
        chunks.ShouldAllBe(chunk => Tokens(chunk) <= 20);
        string.Join('\n', chunks).ShouldBe(text);
        chunks.Count.ShouldBe(6);
    }

    [Fact]
    public void whenLineExceedsBudget_Split_ShouldBreakItIntoWords()
    {
        var line = string.Join(' ', Enumerable.Range(1, 25).Select(word => "w" + word));
        var chunks = ReceiptTextChunker.Split(line, Tokens, 10, 32);
        chunks.ShouldAllBe(chunk => Tokens(chunk) <= 10);
        string.Join(' ', chunks.SelectMany(chunk => chunk.Split('\n'))).ShouldBe(line);
        // A single word longer than the budget still becomes its own passage.
        ReceiptTextChunker.Split("supercalifragilistic", _ => 600, 512, 32).Count.ShouldBe(1);
    }

    [Fact]
    public void whenManyChunks_Split_ShouldStopAtTheLimit()
    {
        var text = string.Join('\n', Enumerable.Range(1, 100).Select(line => $"line {line}"));
        ReceiptTextChunker.Split(text, Tokens, 6, 3).Count.ShouldBe(3);
    }
}
