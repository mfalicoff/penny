namespace Penny.Backend.Application.Push;

// An Expo push receipt (`getReceipts`); a ticket without a receipt yet is absent.
public enum PushReceiptStatus
{
    Ok,
    DeviceNotRegistered,
    RateExceeded,
    Error,
}
