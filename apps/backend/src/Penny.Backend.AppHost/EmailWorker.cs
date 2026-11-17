namespace Penny.Backend.AppHost;

// The local Email Worker's fixed address and the receipt domain it accepts (MAZ-184).
public static class EmailWorker
{
    public const int Port = 8788;
    public const string Domain = "receipts.penny.test";
}
