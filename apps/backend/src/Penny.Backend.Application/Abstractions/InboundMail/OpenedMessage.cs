namespace Penny.Backend.Application.Abstractions.InboundMail;

// A claimed message's raw MIME (decrypted) and its address' allowed senders. MAZ-184.
public sealed record OpenedMessage(byte[] Raw, IReadOnlyList<string> AllowedSenders);
