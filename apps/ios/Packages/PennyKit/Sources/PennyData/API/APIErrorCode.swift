/// A stable, machine-readable failure name the API sends next to its `error` message (contract
/// 2.1.0, MAZ-187), for example `receipt.too_large`. Branch on these instead of the English text.
///
/// A server from before 2.1.0 sends no code, and a newer one may send a code missing here: both
/// fall back to the status (see `APIError`), so callers match a code first and keep their
/// status-and-message handling as the fallback. `all` lists every code of
/// `contracts/openapi.json` (`Error.code`); `APIErrorCodeTests` keeps the two equal.
public struct APIErrorCode: RawRepresentable, Hashable, Sendable, Codable, CustomStringConvertible {
    public let rawValue: String

    public init(rawValue: String) { self.rawValue = rawValue }

    public var description: String { rawValue }
    public static let accountCreatorWithMembers = APIErrorCode(rawValue: "account.creator_with_members")
    public static let accountUnsettled = APIErrorCode(rawValue: "account.unsettled")
    public static let accountWrongPassword = APIErrorCode(rawValue: "account.wrong_password")
    public static let authDuplicateEmail = APIErrorCode(rawValue: "auth.duplicate_email")
    public static let authEmailInUse = APIErrorCode(rawValue: "auth.email_in_use")
    public static let authEmailManaged = APIErrorCode(rawValue: "auth.email_managed")
    public static let authInvalidCredentials = APIErrorCode(rawValue: "auth.invalid_credentials")
    public static let authInvalidNewPassword = APIErrorCode(rawValue: "auth.invalid_new_password")
    public static let authInvalidRegistration = APIErrorCode(rawValue: "auth.invalid_registration")
    public static let authNoPassword = APIErrorCode(rawValue: "auth.no_password")
    public static let authOidcAccountExists = APIErrorCode(rawValue: "auth.oidc_account_exists")
    public static let authOidcEmailInUse = APIErrorCode(rawValue: "auth.oidc_email_in_use")
    public static let authOidcRegistrationDisabled = APIErrorCode(rawValue: "auth.oidc_registration_disabled")
    public static let authRegistrationDisabled = APIErrorCode(rawValue: "auth.registration_disabled")
    public static let authSignInRequired = APIErrorCode(rawValue: "auth.sign_in_required")
    public static let authWrongCurrentPassword = APIErrorCode(rawValue: "auth.wrong_current_password")
    public static let emailVerificationInvalidToken = APIErrorCode(rawValue: "email_verification.invalid_token")
    public static let emailVerificationUnknownEmail = APIErrorCode(rawValue: "email_verification.unknown_email")
    public static let expenseAccountNotFound = APIErrorCode(rawValue: "expense.account_not_found")
    public static let expenseAlreadyPaid = APIErrorCode(rawValue: "expense.already_paid")
    public static let expenseChanged = APIErrorCode(rawValue: "expense.changed")
    public static let expenseDestinationCurrency = APIErrorCode(rawValue: "expense.destination_currency")
    public static let expenseInvalidYear = APIErrorCode(rawValue: "expense.invalid_year")
    public static let expenseNotFound = APIErrorCode(rawValue: "expense.not_found")
    public static let expensePaidDelete = APIErrorCode(rawValue: "expense.paid_delete")
    public static let expensePaidLocked = APIErrorCode(rawValue: "expense.paid_locked")
    public static let expensePaidShares = APIErrorCode(rawValue: "expense.paid_shares")
    public static let expensePayerNotMember = APIErrorCode(rawValue: "expense.payer_not_member")
    public static let expensePayerOnlyAccount = APIErrorCode(rawValue: "expense.payer_only_account")
    public static let expensePayerOwnShare = APIErrorCode(rawValue: "expense.payer_own_share")
    public static let expensePaymentForbidden = APIErrorCode(rawValue: "expense.payment_forbidden")
    public static let expensePaymentsClosed = APIErrorCode(rawValue: "expense.payments_closed")
    public static let expensePositiveShare = APIErrorCode(rawValue: "expense.positive_share")
    public static let expenseReceiptUnavailable = APIErrorCode(rawValue: "expense.receipt_unavailable")
    public static let healthDatabaseUnavailable = APIErrorCode(rawValue: "health.database_unavailable")
    public static let healthDiskSpace = APIErrorCode(rawValue: "health.disk_space")
    public static let healthPermissions = APIErrorCode(rawValue: "health.permissions")
    public static let healthPostgresVersion = APIErrorCode(rawValue: "health.postgres_version")
    public static let healthReceiptStorage = APIErrorCode(rawValue: "health.receipt_storage")
    public static let healthSchema = APIErrorCode(rawValue: "health.schema")
    public static let healthSearchExtensions = APIErrorCode(rawValue: "health.search_extensions")
    public static let householdAlreadyMember = APIErrorCode(rawValue: "household.already_member")
    public static let householdCreatorCannotBeRemoved = APIErrorCode(rawValue: "household.creator_cannot_be_removed")
    public static let householdCreatorCannotLeave = APIErrorCode(rawValue: "household.creator_cannot_leave")
    public static let householdCreatorOnly = APIErrorCode(rawValue: "household.creator_only")
    public static let householdCurrency = APIErrorCode(rawValue: "household.currency")
    public static let householdInvalidData = APIErrorCode(rawValue: "household.invalid_data")
    public static let householdInvalidInvite = APIErrorCode(rawValue: "household.invalid_invite")
    public static let householdNotFound = APIErrorCode(rawValue: "household.not_found")
    public static let householdTripCurrency = APIErrorCode(rawValue: "household.trip_currency")
    public static let householdTripNotFound = APIErrorCode(rawValue: "household.trip_not_found")
    public static let householdUnsettledArchive = APIErrorCode(rawValue: "household.unsettled_archive")
    public static let householdUnsettledExit = APIErrorCode(rawValue: "household.unsettled_exit")
    public static let inboundMailBadSignature = APIErrorCode(rawValue: "inbound_mail.bad_signature")
    public static let inboundMailEmpty = APIErrorCode(rawValue: "inbound_mail.empty")
    public static let inboundMailRateLimited = APIErrorCode(rawValue: "inbound_mail.rate_limited")
    public static let inboundMailTooLarge = APIErrorCode(rawValue: "inbound_mail.too_large")
    public static let inboundMailUnknownAddress = APIErrorCode(rawValue: "inbound_mail.unknown_address")
    public static let inviteInvalidEmail = APIErrorCode(rawValue: "invite.invalid_email")
    public static let inviteJoined = APIErrorCode(rawValue: "invite.joined")
    public static let inviteNotFound = APIErrorCode(rawValue: "invite.not_found")
    public static let inviteTooMany = APIErrorCode(rawValue: "invite.too_many")
    public static let ledgerConflict = APIErrorCode(rawValue: "ledger.conflict")
    public static let ledgerCurrencyMismatch = APIErrorCode(rawValue: "ledger.currency_mismatch")
    public static let ledgerForeignReceipt = APIErrorCode(rawValue: "ledger.foreign_receipt")
    public static let ledgerInvalid = APIErrorCode(rawValue: "ledger.invalid")
    public static let ledgerLinkedAccount = APIErrorCode(rawValue: "ledger.linked_account")
    public static let mailDisabled = APIErrorCode(rawValue: "mail.disabled")
    public static let oidcExpired = APIErrorCode(rawValue: "oidc.expired")
    public static let oidcInvalidResponse = APIErrorCode(rawValue: "oidc.invalid_response")
    public static let oidcNativeNotConfigured = APIErrorCode(rawValue: "oidc.native_not_configured")
    public static let oidcNotConfigured = APIErrorCode(rawValue: "oidc.not_configured")
    public static let oidcNotVerified = APIErrorCode(rawValue: "oidc.not_verified")
    public static let oidcProviderNotConfigured = APIErrorCode(rawValue: "oidc.provider_not_configured")
    public static let oidcProviderUnavailable = APIErrorCode(rawValue: "oidc.provider_unavailable")
    public static let oidcRedirectNotConfigured = APIErrorCode(rawValue: "oidc.redirect_not_configured")
    public static let oidcTooManyAttempts = APIErrorCode(rawValue: "oidc.too_many_attempts")
    public static let originForbidden = APIErrorCode(rawValue: "origin.forbidden")
    public static let passwordResetInvalidEmail = APIErrorCode(rawValue: "password_reset.invalid_email")
    public static let passwordResetInvalidPassword = APIErrorCode(rawValue: "password_reset.invalid_password")
    public static let passwordResetInvalidToken = APIErrorCode(rawValue: "password_reset.invalid_token")
    public static let passwordResetUnknownEmail = APIErrorCode(rawValue: "password_reset.unknown_email")
    public static let profileAvatarManaged = APIErrorCode(rawValue: "profile.avatar_managed")
    public static let profileInvalidBody = APIErrorCode(rawValue: "profile.invalid_body")
    public static let profileInvalidName = APIErrorCode(rawValue: "profile.invalid_name")
    public static let profileInvalidPicture = APIErrorCode(rawValue: "profile.invalid_picture")
    public static let profileNameManaged = APIErrorCode(rawValue: "profile.name_managed")
    public static let profilePictureNotFound = APIErrorCode(rawValue: "profile.picture_not_found")
    public static let profileUnreadablePicture = APIErrorCode(rawValue: "profile.unreadable_picture")
    public static let pushInvalidDevice = APIErrorCode(rawValue: "push.invalid_device")
    public static let rateLimitAuth = APIErrorCode(rawValue: "rate_limit.auth")
    public static let rateLimitInboundMail = APIErrorCode(rawValue: "rate_limit.inbound_mail")
    public static let rateLimitInvite = APIErrorCode(rawValue: "rate_limit.invite")
    public static let rateLimitSearch = APIErrorCode(rawValue: "rate_limit.search")
    public static let rateLimitTelemetry = APIErrorCode(rawValue: "rate_limit.telemetry")
    public static let receiptChanged = APIErrorCode(rawValue: "receipt.changed")
    public static let receiptInvalidName = APIErrorCode(rawValue: "receipt.invalid_name")
    public static let receiptNotFound = APIErrorCode(rawValue: "receipt.not_found")
    public static let receiptOutdatedClient = APIErrorCode(rawValue: "receipt.outdated_client")
    public static let receiptTooLarge = APIErrorCode(rawValue: "receipt.too_large")
    public static let receiptUnsupportedFile = APIErrorCode(rawValue: "receipt.unsupported_file")
    public static let receiptUnsupportedType = APIErrorCode(rawValue: "receipt.unsupported_type")
    public static let receiptEmailInvalidSenders = APIErrorCode(rawValue: "receipt_email.invalid_senders")
    public static let receiptEmailInvalidUpdate = APIErrorCode(rawValue: "receipt_email.invalid_update")
    public static let receiptEmailNoAddress = APIErrorCode(rawValue: "receipt_email.no_address")
    public static let receiptEmailNotEnabled = APIErrorCode(rawValue: "receipt_email.not_enabled")
    public static let receiptEmailTooManyAddresses = APIErrorCode(rawValue: "receipt_email.too_many_addresses")
    public static let receiptInboxInvalidFilter = APIErrorCode(rawValue: "receipt_inbox.invalid_filter")
    public static let receiptInboxNotFound = APIErrorCode(rawValue: "receipt_inbox.not_found")
    public static let recurringPayerNotCurrent = APIErrorCode(rawValue: "recurring.payer_not_current")
    public static let recurringRuleChanged = APIErrorCode(rawValue: "recurring.rule_changed")
    public static let recurringRuleNotFound = APIErrorCode(rawValue: "recurring.rule_not_found")
    public static let requestFailed = APIErrorCode(rawValue: "request.failed")
    public static let requestInvalid = APIErrorCode(rawValue: "request.invalid")
    public static let requestInvalidJson = APIErrorCode(rawValue: "request.invalid_json")
    public static let requestTimedOut = APIErrorCode(rawValue: "request.timed_out")
    public static let requestTooLarge = APIErrorCode(rawValue: "request.too_large")
    public static let routeNotFound = APIErrorCode(rawValue: "route.not_found")
    public static let searchInvalidCursor = APIErrorCode(rawValue: "search.invalid_cursor")
    public static let searchInvalidRequest = APIErrorCode(rawValue: "search.invalid_request")
    public static let searchTimedOut = APIErrorCode(rawValue: "search.timed_out")
    public static let serverBusy = APIErrorCode(rawValue: "server.busy")
    public static let serverError = APIErrorCode(rawValue: "server.error")
    public static let settlementMonthNotFound = APIErrorCode(rawValue: "settlement.month_not_found")
    public static let settlementMonthOpen = APIErrorCode(rawValue: "settlement.month_open")
    public static let settlementNotInvolved = APIErrorCode(rawValue: "settlement.not_involved")
    public static let settlementNotSuggested = APIErrorCode(rawValue: "settlement.not_suggested")
    public static let settlementSameMember = APIErrorCode(rawValue: "settlement.same_member")
    public static let splitDistinctMembers = APIErrorCode(rawValue: "split.distinct_members")
    public static let splitEveryMember = APIErrorCode(rawValue: "split.every_member")
    public static let splitExactAmounts = APIErrorCode(rawValue: "split.exact_amounts")
    public static let splitPercentAmounts = APIErrorCode(rawValue: "split.percent_amounts")
    public static let splitTotalMismatch = APIErrorCode(rawValue: "split.total_mismatch")
    public static let telemetryInvalid = APIErrorCode(rawValue: "telemetry.invalid")
    public static let telemetryMediaType = APIErrorCode(rawValue: "telemetry.media_type")
    public static let telemetryOff = APIErrorCode(rawValue: "telemetry.off")
    public static let telemetryTooLarge = APIErrorCode(rawValue: "telemetry.too_large")

    /// Every code contract 2.1.0 defines.
    public static let all: [APIErrorCode] = [
        .accountCreatorWithMembers,
        .accountUnsettled,
        .accountWrongPassword,
        .authDuplicateEmail,
        .authEmailInUse,
        .authEmailManaged,
        .authInvalidCredentials,
        .authInvalidNewPassword,
        .authInvalidRegistration,
        .authNoPassword,
        .authOidcAccountExists,
        .authOidcEmailInUse,
        .authOidcRegistrationDisabled,
        .authRegistrationDisabled,
        .authSignInRequired,
        .authWrongCurrentPassword,
        .emailVerificationInvalidToken,
        .emailVerificationUnknownEmail,
        .expenseAccountNotFound,
        .expenseAlreadyPaid,
        .expenseChanged,
        .expenseDestinationCurrency,
        .expenseInvalidYear,
        .expenseNotFound,
        .expensePaidDelete,
        .expensePaidLocked,
        .expensePaidShares,
        .expensePayerNotMember,
        .expensePayerOnlyAccount,
        .expensePayerOwnShare,
        .expensePaymentForbidden,
        .expensePaymentsClosed,
        .expensePositiveShare,
        .expenseReceiptUnavailable,
        .healthDatabaseUnavailable,
        .healthDiskSpace,
        .healthPermissions,
        .healthPostgresVersion,
        .healthReceiptStorage,
        .healthSchema,
        .healthSearchExtensions,
        .householdAlreadyMember,
        .householdCreatorCannotBeRemoved,
        .householdCreatorCannotLeave,
        .householdCreatorOnly,
        .householdCurrency,
        .householdInvalidData,
        .householdInvalidInvite,
        .householdNotFound,
        .householdTripCurrency,
        .householdTripNotFound,
        .householdUnsettledArchive,
        .householdUnsettledExit,
        .inboundMailBadSignature,
        .inboundMailEmpty,
        .inboundMailRateLimited,
        .inboundMailTooLarge,
        .inboundMailUnknownAddress,
        .inviteInvalidEmail,
        .inviteJoined,
        .inviteNotFound,
        .inviteTooMany,
        .ledgerConflict,
        .ledgerCurrencyMismatch,
        .ledgerForeignReceipt,
        .ledgerInvalid,
        .ledgerLinkedAccount,
        .mailDisabled,
        .oidcExpired,
        .oidcInvalidResponse,
        .oidcNativeNotConfigured,
        .oidcNotConfigured,
        .oidcNotVerified,
        .oidcProviderNotConfigured,
        .oidcProviderUnavailable,
        .oidcRedirectNotConfigured,
        .oidcTooManyAttempts,
        .originForbidden,
        .passwordResetInvalidEmail,
        .passwordResetInvalidPassword,
        .passwordResetInvalidToken,
        .passwordResetUnknownEmail,
        .profileAvatarManaged,
        .profileInvalidBody,
        .profileInvalidName,
        .profileInvalidPicture,
        .profileNameManaged,
        .profilePictureNotFound,
        .profileUnreadablePicture,
        .pushInvalidDevice,
        .rateLimitAuth,
        .rateLimitInboundMail,
        .rateLimitInvite,
        .rateLimitSearch,
        .rateLimitTelemetry,
        .receiptChanged,
        .receiptInvalidName,
        .receiptNotFound,
        .receiptOutdatedClient,
        .receiptTooLarge,
        .receiptUnsupportedFile,
        .receiptUnsupportedType,
        .receiptEmailInvalidSenders,
        .receiptEmailInvalidUpdate,
        .receiptEmailNoAddress,
        .receiptEmailNotEnabled,
        .receiptEmailTooManyAddresses,
        .receiptInboxInvalidFilter,
        .receiptInboxNotFound,
        .recurringPayerNotCurrent,
        .recurringRuleChanged,
        .recurringRuleNotFound,
        .requestFailed,
        .requestInvalid,
        .requestInvalidJson,
        .requestTimedOut,
        .requestTooLarge,
        .routeNotFound,
        .searchInvalidCursor,
        .searchInvalidRequest,
        .searchTimedOut,
        .serverBusy,
        .serverError,
        .settlementMonthNotFound,
        .settlementMonthOpen,
        .settlementNotInvolved,
        .settlementNotSuggested,
        .settlementSameMember,
        .splitDistinctMembers,
        .splitEveryMember,
        .splitExactAmounts,
        .splitPercentAmounts,
        .splitTotalMismatch,
        .telemetryInvalid,
        .telemetryMediaType,
        .telemetryOff,
        .telemetryTooLarge,
    ]
}
