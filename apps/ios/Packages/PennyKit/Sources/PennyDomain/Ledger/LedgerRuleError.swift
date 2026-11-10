/// A rule refused a change. `message` is the legacy user-facing sentence, word for word, so
/// the Expo app, the web client and this one explain the same failure the same way. A caller
/// shows `message`, keeps the user's draft and offers the next step.
///
/// Four cases have no legacy command check and so no legacy sentence: `invalidCategoryName`
/// (the legacy form refused an empty name and capped input at 50), `tooManyCategories` and
/// `categoryKindInUse` (the legacy server refused both as "Invalid ledger data." only after
/// sync) follow the wording of their account and trip counterparts; `scheduleAfterLedgerRange`
/// (a new schedule whose next date is after 2100, which the server also refused only after
/// sync) follows the date message (docs/ios-ledger-domain.md, "Compatibility decisions").
public enum LedgerRuleError: Error, Hashable, Sendable, CustomStringConvertible {
    case invalidAmount
    case invalidSplitPeople
    case invalidPercentage
    case shareExceedsTotal
    case zeroAmount
    case invalidDate
    case missingTitle
    case chooseCategory
    case chooseRepeat
    case scheduleAfterLedgerRange

    case entryChangedOnAnotherDevice
    case entryChangedBeforeDelete
    case scheduleChangedOnAnotherDevice
    case tripChangedOnAnotherDevice
    case accountChangedOnAnotherDevice
    case categoryChangedOnAnotherDevice

    case accountRemoved
    case categoryRemoved
    case tripUnavailable

    case tripHasEntries
    case categoryHasEntries
    case accountHasEntries

    case invalidTripName
    case invalidTripDates
    case duplicateTripName
    case tooManyTrips
    case invalidAccountName
    case duplicateAccountName
    case tooManyAccounts
    case invalidCategoryName
    case duplicateCategoryName
    case tooManyCategories
    case categoryKindInUse
    case currencyLocked

    public var message: String {
        switch self {
        case .invalidAmount: "Enter an amount with up to two decimal places."
        case .invalidSplitPeople: "Split between 2 and 100 people."
        case .invalidPercentage: "Your percentage must be between 0 and 100."
        case .shareExceedsTotal: "Your share cannot exceed the receipt total."
        case .zeroAmount: "Enter an amount greater than zero."
        case .invalidDate: "Use a valid date between 2000 and 2100, in YYYY-MM-DD format."
        case .missingTitle: "Add a name for this entry."
        case .chooseCategory: "Choose a category."
        case .chooseRepeat: "Choose a repeat schedule."
        case .scheduleAfterLedgerRange:
            "This schedule would repeat after 2100. Choose an earlier date, or choose Does not repeat."
        case .entryChangedOnAnotherDevice:
            "This entry changed on another device. Close this form and reopen the entry to review the latest version."
        case .entryChangedBeforeDelete: "This entry changed on another device. Reopen it before deleting."
        case .scheduleChangedOnAnotherDevice:
            "This schedule changed on another device. Close this form and reopen it to review the latest version."
        case .tripChangedOnAnotherDevice: "This trip changed on another device. Reopen it before editing."
        case .accountChangedOnAnotherDevice: "This account changed on another device. Reopen it before editing."
        case .categoryChangedOnAnotherDevice: "This category changed on another device. Reopen it before editing."
        case .accountRemoved: "This payment account was removed on another device. Choose another account."
        case .categoryRemoved: "This category was removed on another device. Choose another category."
        case .tripUnavailable: "This trip is no longer available. Choose another trip."
        case .tripHasEntries: "This trip has expenses. Reassign them before deleting it."
        case .categoryHasEntries: "This category has entries. Keep it to preserve your history."
        case .accountHasEntries: "This account has entries or schedules. Reassign them before deleting it."
        case .invalidTripName: "Give your trip a name of up to 80 characters."
        case .invalidTripDates: "Choose valid trip dates, with the end on or after the start."
        case .duplicateTripName: "You already have a trip with this name."
        case .tooManyTrips: "You can add up to 300 trips."
        case .invalidAccountName: "Give your account a name of up to 50 characters."
        case .duplicateAccountName: "You already have an account with this name."
        case .tooManyAccounts: "You can add up to 300 accounts."
        case .invalidCategoryName: "Give your category a name of up to 50 characters."
        case .duplicateCategoryName: "You already have a category with this name."
        case .tooManyCategories: "You can add up to 300 categories."
        case .categoryKindInUse: "This category has entries. Keep its type to preserve your history."
        case .currencyLocked: "Currency can only be changed before adding entries."
        }
    }

    public var description: String { message }
}
