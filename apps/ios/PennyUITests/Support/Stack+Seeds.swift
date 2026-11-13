import Foundation
import XCTest

/// The repository checkout the runner was built from (the simulator runner reads host files by
/// path, like `StackConfiguration.fromCheckout`).
enum Checkout {
    /// apps/ios/PennyUITests/Support/Stack+Seeds.swift -> repository root
    static let root = URL(filePath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()

    static func json(_ path: String) throws -> [String: Any] {
        let data = try Data(contentsOf: root.appending(path: path))
        guard let value = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw StackError.malformed(path)
        }
        return value
    }
}

/// What seeding a scenario produced: per alias, the account and a fresh session; the ids the
/// server gave households, shared expenses and shared rules (MAZ-62's seeder context).
struct SeedContext {
    struct User {
        let email: String
        let password: String
        var token: String
    }

    let scenario: String
    let today: String
    var users: [String: User] = [:]
    var userIDs: [String: String] = [:]
    var households: [String: String] = [:]
    var invites: [String: (code: String, household: String)] = [:]
    var expenseIDs: [String: String] = [:]
    var rules: [String: String] = [:]

    func user(_ alias: String) throws -> User {
        guard let user = users[alias] else { throw StackError.malformed("seed alias \(alias)") }
        return user
    }

    func household(_ ref: String) throws -> String {
        guard let id = households[ref] else { throw StackError.malformed("seed household \(ref)") }
        return id
    }

    func expense(_ ref: String) throws -> String {
        guard let id = expenseIDs[ref] else { throw StackError.malformed("seed expense \(ref)") }
        return id
    }

    /// Replaces `$user:x`, `$household:x`, `$expense:x`, `$rule:x`, `$email:x`, `$today` and
    /// `$month` anywhere in a JSON value, as scripts/test-env/seed.mjs `resolve` does.
    /// `resolve` for a JSON object (a request body).
    func resolveObject(_ value: Any) throws -> [String: Any] {
        guard let object = try resolve(value) as? [String: Any] else { throw StackError.malformed("seed body") }
        return object
    }

    func resolve(_ value: Any) throws -> Any {
        switch value {
        case let text as String: return try resolve(text)
        case let list as [Any]: return try list.map { try resolve($0) }
        case let object as [String: Any]: return try object.mapValues { try resolve($0) }
        default: return value
        }
    }

    func resolve(_ text: String) throws -> String {
        let reference = try NSRegularExpression(
            pattern: #"\$(user|household|expense|rule|email):([a-z0-9-]+)|\$(today|month)\b"#)
        let source = text as NSString
        var result = ""
        var cursor = 0
        for match in reference.matches(in: text, range: NSRange(location: 0, length: source.length)) {
            result += source.substring(with: NSRange(location: cursor, length: match.range.location - cursor))
            cursor = match.range.location + match.range.length
            if match.range(at: 3).location != NSNotFound {
                result += source.substring(with: match.range(at: 3)) == "today" ? today : String(today.prefix(7))
                continue
            }
            let kind = source.substring(with: match.range(at: 1))
            let ref = source.substring(with: match.range(at: 2))
            let table: [String: String] =
                switch kind {
                case "user": userIDs
                case "household": households
                case "expense": expenseIDs
                case "rule": rules
                default: users.mapValues(\.email)
                }
            guard let resolved = table[ref] else {
                throw StackError.malformed("seed reference \(source.substring(with: match.range))")
            }
            result += resolved
        }
        return result + source.substring(from: cursor)
    }
}

/// Seeds a scenario of contracts/fixtures/full-stack-seeds.json through the public API, step for
/// step like scripts/test-env/seed.mjs (the web runner's and `npm run test-env -- seed`'s seeder),
/// so the UI tests can seed from Xcode as well as under `ios.sh`. Every call registers new users
/// (`<alias>.<tag>@penny.test`), so seeded data is never shared with another test. Ends with the
/// server clock pinned at the scenario's clock and fresh sessions.
extension Stack {
    func seed(_ name: String) async throws -> SeedContext {
        let file = try Checkout.json("contracts/fixtures/full-stack-seeds.json")
        guard
            let definition = (file["scenarios"] as? [[String: Any]])?.first(where: { $0["name"] as? String == name }),
            let finalClock = definition["clock"] as? String, finalClock != "$now",
            let aliases = definition["users"] as? [String], let steps = definition["steps"] as? [[String: Any]]
        else { throw StackError.malformed("seed scenario \(name)") }
        let tag = UUID().uuidString.prefix(8).lowercased()
        var context = SeedContext(scenario: name, today: String(finalClock.prefix(10)))
        let firstClock = steps.lazy.compactMap { $0["clock"] as? String }.first ?? finalClock
        try await setClock(firstClock)

        for alias in aliases {
            let email = "\(alias).\(tag)@penny.test"
            let password = UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(24).lowercased()
            let body = try await api("POST", "/api/auth/register", body: ["email": email, "password": password])
            guard let token = body["token"] as? String else { throw StackError.malformed("POST /api/auth/register") }
            context.users[alias] = .init(email: (body["email"] as? String) ?? email, password: password, token: token)
        }

        for step in steps {
            let token = (step["as"] as? String).flatMap { context.users[$0]?.token }
            if let clock = step["clock"] as? String {
                try await setClock(clock)
                try await refreshSessions(&context)
            } else if let ledger = step["ledger"] {
                let current = try await self.ledger(token: token ?? "")
                _ = try await api(
                    "PUT", "/api/ledger", body: ["revision": current.revision, "ledger": try context.resolve(ledger)],
                    token: token)
            } else if let rename = step["rename"] as? [String: [String: String]] {
                let current = try await self.ledger(token: token ?? "")
                var ledger = current.ledger
                for (kind, names) in rename {
                    ledger[kind] = (ledger[kind] as? [[String: Any]] ?? []).map { item in
                        var item = item
                        if let id = item["id"] as? String, let name = names[id] { item["name"] = name }
                        return item
                    }
                }
                _ = try await api(
                    "PUT", "/api/ledger", body: ["revision": current.revision, "ledger": ledger], token: token)
            } else if var create = step["createHousehold"] as? [String: Any] ?? step["createTrip"] as? [String: Any] {
                let ref = create.removeValue(forKey: "ref") as? String ?? ""
                let path = step["createTrip"] != nil ? "/api/households/trips" : "/api/households"
                let created = try await api("POST", path, body: create, token: token)
                guard let id = (created["household"] as? [String: Any])?["id"] as? String else {
                    throw StackError.malformed("POST \(path)")
                }
                context.households[ref] = id
                if step["createHousehold"] != nil { try await learnMembers(&context, household: id, token: token) }
            } else if let invite = step["invite"] as? [String: String] {
                let household = try context.household(invite["household"] ?? "")
                let body = try await api("POST", "/api/households/\(household)/invites", body: [:], token: token)
                guard let code = body["code"] as? String else { throw StackError.malformed("POST invites") }
                context.invites[invite["ref"] ?? ""] = (code, household)
            } else if var join = step["join"] as? [String: Any] {
                guard let ref = join.removeValue(forKey: "invite") as? String, let invite = context.invites[ref] else {
                    throw StackError.malformed("seed join")
                }
                join["code"] = invite.code
                _ = try await api("POST", "/api/households/join", body: join, token: token)
                try await learnMembers(&context, household: invite.household, token: token)
            } else if let expense = step["expense"] as? [String: Any] {
                let household = try context.household(expense["household"] as? String ?? "")
                let created = try await api(
                    "POST", "/api/households/\(household)/expenses",
                    body: try context.resolveObject(expense["body"] ?? [:]),
                    token: token)
                guard let id = (created["expense"] as? [String: Any])?["id"] as? String else {
                    throw StackError.malformed("POST expenses")
                }
                context.expenseIDs[expense["ref"] as? String ?? ""] = id
            } else if var reimburse = step["reimburse"] as? [String: Any] {
                let household = try context.household(reimburse.removeValue(forKey: "household") as? String ?? "")
                let month = reimburse.removeValue(forKey: "month") as? String ?? ""
                _ = try await api(
                    "POST", "/api/households/\(household)/months/\(month)/reimbursements",
                    body: try context.resolveObject(reimburse), token: token)
            } else if let leave = step["leave"] as? [String: String] {
                let household = try context.household(leave["household"] ?? "")
                _ = try await api("POST", "/api/households/\(household)/leave", token: token)
            } else if let recurring = step["sharedRecurring"] as? [String: Any] {
                let household = try context.household(recurring["household"] as? String ?? "")
                let created = try await api(
                    "POST", "/api/households/\(household)/recurring",
                    body: try context.resolveObject(recurring["body"] ?? [:]),
                    token: token)
                let id = (created["rule"] as? [String: Any])?["id"] as? String ?? created["id"] as? String
                context.rules[recurring["ref"] as? String ?? ""] = id
            } else {
                throw StackError.malformed("unknown seed step \(step.keys.sorted())")
            }
        }
        try await setClock(finalClock)
        try await refreshSessions(&context)
        return context
    }

    /// Sessions last 30 days of server time: signing in again after a clock move keeps every
    /// alias usable at the new time.
    private func refreshSessions(_ context: inout SeedContext) async throws {
        for (alias, user) in context.users {
            context.users[alias]?.token = try await signIn(email: user.email, password: user.password)
        }
    }

    /// User ids come from household member lists (the API exposes no id for self).
    private func learnMembers(_ context: inout SeedContext, household: String, token: String?) async throws {
        let body = try await api("GET", "/api/households/\(household)", token: token)
        for member in body["members"] as? [[String: Any]] ?? [] {
            guard let email = member["email"] as? String, let id = member["userId"] as? String,
                let alias = context.users.first(where: { $0.value.email == email })?.key
            else { continue }
            context.userIDs[alias] = id
        }
    }

    /// A product API call (`path` starts with `/api/`).
    func api(_ method: String, _ path: String, body: [String: Any]? = nil, token: String? = nil) async throws
        -> [String: Any]
    {
        guard let url = URL(string: configuration.apiURL.absoluteString + path) else {
            throw StackError.malformed(path)
        }
        return try await send(method, url, body: body, token: token)
    }
}
