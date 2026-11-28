namespace Penny.Backend.Persistence.Schema.Entities;

// A Wallet card name and the personal ledger account its captured purchases are added
// to (MAZ-291). The account id is a reference the clients resolve; an account deleted
// since simply matches nothing.
public sealed class CardAccount
{
    public required string UserId { get; set; }
    public required string Card { get; set; }
    public required string AccountId { get; set; }
}
