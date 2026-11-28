namespace Penny.Backend.Api.Contracts;

// Contract schema `PurchaseInboxPage` (2.5.0): newest capture first; `next` is the
// `before` value for the following page, or null.
public sealed record PurchaseInboxPageResponse(
    IReadOnlyList<PurchaseInboxItemResponse> Items,
    string? Next
);
