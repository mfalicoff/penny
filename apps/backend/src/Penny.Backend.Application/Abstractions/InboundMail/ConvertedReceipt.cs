namespace Penny.Backend.Application.Abstractions.InboundMail;

// One file an emailed receipt becomes (MAZ-184): the rendered email (`email`) or an
// imported attachment (`attachment`). Content already passed ReceiptFormat.
public sealed record ConvertedReceipt(string Kind, string Name, string Mime, byte[] Content)
{
    public const string Email = "email";
    public const string Attachment = "attachment";
}
