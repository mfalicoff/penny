namespace Penny.Backend.Application.Abstractions.Persistence;

// `search-verify`: counts of documents that disagree with the source rows. All zero
// means stored text, visibility keys and embeddings are current. Receipt text
// (MAZ-125): `MissingReceiptText` counts receipts linked by a document without a text
// row (run `receipts-ocr`), `StaleReceiptText` done texts whose normalized text or
// chunks do not match their stored text, `PendingReceiptText` texts still queued for
// extraction. Receipt chunk embeddings count in `PendingEmbeddings` and `StaleModel`.
public sealed record SearchVerifyReport(
    long Documents,
    long Missing,
    long Orphaned,
    long StaleText,
    long PendingEmbeddings,
    long StaleModel,
    long ReceiptTexts,
    long MissingReceiptText,
    long StaleReceiptText,
    long PendingReceiptText
)
{
    public bool Clean =>
        Missing
            + Orphaned
            + StaleText
            + PendingEmbeddings
            + StaleModel
            + MissingReceiptText
            + StaleReceiptText
            + PendingReceiptText
        == 0;
}
