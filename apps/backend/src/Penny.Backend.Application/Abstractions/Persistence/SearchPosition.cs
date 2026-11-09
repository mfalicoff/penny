namespace Penny.Backend.Application.Abstractions.Persistence;

// The sort tuple of the last result on a page (keyset pagination). Relevance uses
// Tier, Score (similarity in millionths), Date and Key; date sorts use Date and Key;
// amount sorts use Amount (the viewer's share in cents), Date and Key.
public sealed record SearchPosition(int Tier, long Score, long Amount, DateOnly Date, string Key);
