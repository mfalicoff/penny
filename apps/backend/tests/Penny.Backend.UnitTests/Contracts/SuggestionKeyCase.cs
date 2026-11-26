namespace Penny.Backend.UnitTests.Contracts;

// A title and its normalised suggestion key (empty when the title has no usable words).
public sealed record SuggestionKeyCase(string Title, string Key);
