import Foundation
public import PennyDomain

/// Shared trips (MAZ-56 on the server, MAZ-76 here): a shared trip is a household with a travel
/// range. `POST /api/households/trips` (`postApiHouseholdsTrips`, body `TripInput`) creates one
/// and `PATCH /api/households/{id}/trip` (`patchApiHouseholdsIdTrip`, body `TripUpdate`, creator
/// only) changes its name and dates. Everything else (members, invites, expenses, settlement)
/// uses the household routes. Changing the dates never moves an expense or a membership.
extension APIClient {
    private struct TripEnvelope: Decodable { var household: WireHousehold }

    private struct TripCreateBody: Encodable {
        var name: String
        var currency: String
        var startDate: String
        var endDate: String
        var timezoneOffsetMinutes: Int
    }

    private struct TripUpdateBody: Encodable {
        var name: String
        var startDate: String
        var endDate: String
    }

    /// The server's trip range rules (`400 Invalid household data.` otherwise): real days from
    /// 2000-01-01 to 2100-12-31, the end not before the start. Checked before sending.
    static func tripDates(start: PennyDomain.CalendarDate, end: PennyDomain.CalendarDate) throws(APIError) -> (
        String, String
    ) {
        guard start.isWithinLedgerRange else { throw .invalidRequest(.invalidField("startDate")) }
        guard end.isWithinLedgerRange, end >= start else { throw .invalidRequest(.invalidField("endDate")) }
        return (start.description, end.description)
    }

    /// Creates a shared trip in `currency`, which must be the caller's ledger currency (`400 Trip
    /// currency must match your ledger currency.`). The caller is its creator (the organizer).
    public func createTrip(
        name: String, currency: Currency, startDate: PennyDomain.CalendarDate, endDate: PennyDomain.CalendarDate,
        timezoneOffsetMinutes: Int
    ) async throws -> WireHousehold {
        let (start, end) = try Self.tripDates(start: startDate, end: endDate)
        let body = TripCreateBody(
            name: try Self.householdName(name), currency: currency.rawValue, startDate: start, endDate: end,
            timezoneOffsetMinutes: timezoneOffsetMinutes)
        let envelope: TripEnvelope = try await json(.post, "/api/households/trips", body: body)
        guard envelope.household.trip != nil else { throw APIError.malformedResponse }
        return envelope.household
    }

    /// Changes a shared trip's name and dates. Creator only (`403`); a regular household is
    /// `404 Trip not found.`
    public func updateTrip(
        id: String, name: String, startDate: PennyDomain.CalendarDate, endDate: PennyDomain.CalendarDate
    ) async throws
        -> WireHousehold
    {
        let (start, end) = try Self.tripDates(start: startDate, end: endDate)
        let body = TripUpdateBody(name: try Self.householdName(name), startDate: start, endDate: end)
        let path = "/api/households/\(try Self.segment(id, field: "householdId"))/trip"
        let envelope: TripEnvelope = try await json(.patch, path, body: body)
        return envelope.household
    }
}
