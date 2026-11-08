using Penny.Backend.Domain.Ledgers;

namespace Penny.Backend.Api.Contracts;

public sealed record AccountResponse(string Id, string Name, string Type)
{
    public static AccountResponse From(PaymentAccount account) =>
        new(account.Id, account.Name, account.Type);
}
