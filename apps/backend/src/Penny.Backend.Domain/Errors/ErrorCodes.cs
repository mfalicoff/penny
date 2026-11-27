namespace Penny.Backend.Domain.Errors;

// Stable machine-readable error codes (MAZ-187), sent as `code` next to the English
// `error` message. A code names one failure and never changes meaning: add a new code
// rather than reuse one. contracts/openapi.json lists every value; the API tests keep
// the two in step.
public static class ErrorCodes
{
    public const string AccountCreatorWithMembers = "account.creator_with_members";
    public const string AccountUnsettled = "account.unsettled";
    public const string AccountWrongPassword = "account.wrong_password";

    public const string AuthDuplicateEmail = "auth.duplicate_email";
    public const string AuthEmailInUse = "auth.email_in_use";
    public const string AuthEmailManaged = "auth.email_managed";
    public const string AuthInvalidCredentials = "auth.invalid_credentials";
    public const string AuthInvalidNewPassword = "auth.invalid_new_password";
    public const string AuthInvalidRegistration = "auth.invalid_registration";
    public const string AuthNoPassword = "auth.no_password";
    public const string AuthOidcAccountExists = "auth.oidc_account_exists";
    public const string AuthOidcEmailInUse = "auth.oidc_email_in_use";
    public const string AuthOidcRegistrationDisabled = "auth.oidc_registration_disabled";
    public const string AuthRegistrationDisabled = "auth.registration_disabled";
    public const string AuthSignInRequired = "auth.sign_in_required";
    public const string AuthWrongCurrentPassword = "auth.wrong_current_password";

    public const string EmailVerificationInvalidToken = "email_verification.invalid_token";
    public const string EmailVerificationUnknownEmail = "email_verification.unknown_email";

    public const string ExpenseAccountNotFound = "expense.account_not_found";
    public const string ExpenseAlreadyPaid = "expense.already_paid";
    public const string ExpenseChanged = "expense.changed";
    public const string ExpenseDestinationCurrency = "expense.destination_currency";
    public const string ExpenseInvalidYear = "expense.invalid_year";
    public const string ExpenseNotFound = "expense.not_found";
    public const string ExpensePaidDelete = "expense.paid_delete";
    public const string ExpensePaidLocked = "expense.paid_locked";
    public const string ExpensePaidShares = "expense.paid_shares";
    public const string ExpensePayerNotMember = "expense.payer_not_member";
    public const string ExpensePayerOnlyAccount = "expense.payer_only_account";
    public const string ExpensePayerOwnShare = "expense.payer_own_share";
    public const string ExpensePaymentForbidden = "expense.payment_forbidden";
    public const string ExpensePaymentsClosed = "expense.payments_closed";
    public const string ExpensePositiveShare = "expense.positive_share";
    public const string ExpenseReceiptUnavailable = "expense.receipt_unavailable";

    public const string HealthDatabaseUnavailable = "health.database_unavailable";
    public const string HealthDiskSpace = "health.disk_space";
    public const string HealthPermissions = "health.permissions";
    public const string HealthPostgresVersion = "health.postgres_version";
    public const string HealthReceiptStorage = "health.receipt_storage";
    public const string HealthSchema = "health.schema";
    public const string HealthSearchExtensions = "health.search_extensions";

    public const string HouseholdAlreadyMember = "household.already_member";
    public const string HouseholdCreatorCannotBeRemoved = "household.creator_cannot_be_removed";
    public const string HouseholdCreatorCannotLeave = "household.creator_cannot_leave";
    public const string HouseholdCreatorOnly = "household.creator_only";
    public const string HouseholdCurrency = "household.currency";
    public const string HouseholdInvalidData = "household.invalid_data";
    public const string HouseholdInvalidInvite = "household.invalid_invite";
    public const string HouseholdNotFound = "household.not_found";
    public const string HouseholdTripCurrency = "household.trip_currency";
    public const string HouseholdTripNotFound = "household.trip_not_found";
    public const string HouseholdUnsettledArchive = "household.unsettled_archive";
    public const string HouseholdUnsettledExit = "household.unsettled_exit";

    public const string InboundMailBadSignature = "inbound_mail.bad_signature";
    public const string InboundMailEmpty = "inbound_mail.empty";
    public const string InboundMailRateLimited = "inbound_mail.rate_limited";
    public const string InboundMailTooLarge = "inbound_mail.too_large";
    public const string InboundMailUnknownAddress = "inbound_mail.unknown_address";

    public const string InviteInvalidEmail = "invite.invalid_email";
    public const string InviteJoined = "invite.joined";
    public const string InviteNotFound = "invite.not_found";
    public const string InviteTooMany = "invite.too_many";

    public const string LedgerConflict = "ledger.conflict";
    public const string LedgerCurrencyMismatch = "ledger.currency_mismatch";
    public const string LedgerForeignReceipt = "ledger.foreign_receipt";
    public const string LedgerInvalid = "ledger.invalid";
    public const string LedgerLinkedAccount = "ledger.linked_account";

    public const string MailDisabled = "mail.disabled";

    public const string OidcExpired = "oidc.expired";
    public const string OidcInvalidResponse = "oidc.invalid_response";
    public const string OidcNativeNotConfigured = "oidc.native_not_configured";
    public const string OidcNotConfigured = "oidc.not_configured";
    public const string OidcNotVerified = "oidc.not_verified";
    public const string OidcProviderNotConfigured = "oidc.provider_not_configured";
    public const string OidcProviderUnavailable = "oidc.provider_unavailable";
    public const string OidcRedirectNotConfigured = "oidc.redirect_not_configured";
    public const string OidcTooManyAttempts = "oidc.too_many_attempts";

    public const string OriginForbidden = "origin.forbidden";

    public const string PasswordResetInvalidEmail = "password_reset.invalid_email";
    public const string PasswordResetInvalidPassword = "password_reset.invalid_password";
    public const string PasswordResetInvalidToken = "password_reset.invalid_token";
    public const string PasswordResetUnknownEmail = "password_reset.unknown_email";

    public const string ProfileAvatarManaged = "profile.avatar_managed";
    public const string ProfileInvalidBody = "profile.invalid_body";
    public const string ProfileInvalidName = "profile.invalid_name";
    public const string ProfileInvalidPicture = "profile.invalid_picture";
    public const string ProfileNameManaged = "profile.name_managed";
    public const string ProfilePictureNotFound = "profile.picture_not_found";
    public const string ProfileUnreadablePicture = "profile.unreadable_picture";

    public const string PushInvalidDevice = "push.invalid_device";

    public const string RateLimitAuth = "rate_limit.auth";
    public const string RateLimitInboundMail = "rate_limit.inbound_mail";
    public const string RateLimitInvite = "rate_limit.invite";
    public const string RateLimitSearch = "rate_limit.search";
    public const string RateLimitTelemetry = "rate_limit.telemetry";

    public const string RatesInvalidRequest = "rates.invalid_request";

    public const string ReceiptChanged = "receipt.changed";
    public const string ReceiptInvalidName = "receipt.invalid_name";
    public const string ReceiptNotFound = "receipt.not_found";
    public const string ReceiptOutdatedClient = "receipt.outdated_client";
    public const string ReceiptTooLarge = "receipt.too_large";
    public const string ReceiptUnsupportedFile = "receipt.unsupported_file";
    public const string ReceiptUnsupportedType = "receipt.unsupported_type";

    public const string ReceiptEmailInvalidSenders = "receipt_email.invalid_senders";
    public const string ReceiptEmailInvalidUpdate = "receipt_email.invalid_update";
    public const string ReceiptEmailNoAddress = "receipt_email.no_address";
    public const string ReceiptEmailNotEnabled = "receipt_email.not_enabled";
    public const string ReceiptEmailTooManyAddresses = "receipt_email.too_many_addresses";

    public const string ReceiptInboxInvalidFilter = "receipt_inbox.invalid_filter";
    public const string ReceiptInboxNotFound = "receipt_inbox.not_found";

    public const string RecurringPayerNotCurrent = "recurring.payer_not_current";
    public const string RecurringRuleChanged = "recurring.rule_changed";
    public const string RecurringRuleNotFound = "recurring.rule_not_found";

    public const string RequestFailed = "request.failed";
    public const string RequestInvalid = "request.invalid";
    public const string RequestInvalidJson = "request.invalid_json";
    public const string RequestTimedOut = "request.timed_out";
    public const string RequestTooLarge = "request.too_large";

    public const string RouteNotFound = "route.not_found";

    public const string SearchInvalidCursor = "search.invalid_cursor";
    public const string SearchInvalidRequest = "search.invalid_request";
    public const string SearchTimedOut = "search.timed_out";

    public const string ServerBusy = "server.busy";
    public const string ServerError = "server.error";

    public const string SettlementMonthNotFound = "settlement.month_not_found";
    public const string SettlementMonthOpen = "settlement.month_open";
    public const string SettlementNotInvolved = "settlement.not_involved";
    public const string SettlementNotSuggested = "settlement.not_suggested";
    public const string SettlementSameMember = "settlement.same_member";

    public const string SplitDistinctMembers = "split.distinct_members";
    public const string SplitEveryMember = "split.every_member";
    public const string SplitExactAmounts = "split.exact_amounts";
    public const string SplitPercentAmounts = "split.percent_amounts";
    public const string SplitTotalMismatch = "split.total_mismatch";

    public const string TelemetryInvalid = "telemetry.invalid";
    public const string TelemetryMediaType = "telemetry.media_type";
    public const string TelemetryOff = "telemetry.off";
    public const string TelemetryTooLarge = "telemetry.too_large";
}
