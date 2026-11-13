namespace Penny.Backend.Application.Abstractions.Persistence;

public sealed record StoredReceipt(string Id, string Name, string Mime, byte[] Data);
