using System.Text;

namespace Penny.Backend.Application.Receipts;

// Splits cleaned receipt text into passages the embedding model reads whole
// (multilingual-e5-small: 512 tokens including the `passage: ` prefix). Receipts are
// line-oriented, so lines are packed greedily; a line that alone exceeds the budget is
// split into words, and a single word longer than the budget becomes its own passage
// (the model truncates it). Token counts come from the model's own tokenizer.
public static class ReceiptTextChunker
{
    public static IReadOnlyList<string> Split(
        string text,
        Func<string, int> passageTokens,
        int maxTokens,
        int maxChunks
    )
    {
        var chunks = new List<string>();
        var current = new StringBuilder();
        foreach (var unit in Units(text, passageTokens, maxTokens))
        {
            if (current.Length == 0)
            {
                current.Append(unit);
                continue;
            }
            var candidate = current + "\n" + unit;
            if (passageTokens(candidate) <= maxTokens)
            {
                current.Clear().Append(candidate);
                continue;
            }
            chunks.Add(current.ToString());
            if (chunks.Count == maxChunks)
                return chunks;
            current.Clear().Append(unit);
        }
        if (current.Length > 0 && chunks.Count < maxChunks)
            chunks.Add(current.ToString());
        return chunks;
    }

    private static IEnumerable<string> Units(
        string text,
        Func<string, int> passageTokens,
        int maxTokens
    )
    {
        foreach (var line in text.Split('\n', StringSplitOptions.RemoveEmptyEntries))
        {
            if (passageTokens(line) <= maxTokens)
            {
                yield return line;
                continue;
            }
            foreach (var word in line.Split(' ', StringSplitOptions.RemoveEmptyEntries))
                yield return word;
        }
    }
}
