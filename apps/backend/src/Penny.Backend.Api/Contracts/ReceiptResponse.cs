using Penny.Backend.Domain.Ledgers;

namespace Penny.Backend.Api.Contracts;

public sealed record ReceiptResponse(string Id, string Name, string Mime, string Uri)
{
    public static ReceiptResponse From(ReceiptLink receipt) =>
        new(receipt.Id, receipt.Name, receipt.Mime, receipt.Uri);
}
