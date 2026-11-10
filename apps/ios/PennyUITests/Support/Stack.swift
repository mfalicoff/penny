import Foundation
import XCTest

/// The full-stack test environment the UI tests run against (MAZ-62,
/// docs/migration/test-environment.md): the real .NET API on PostgreSQL, with its test
/// controls. Nothing here mocks the business API: tests arrange data through the same HTTP
/// API the app uses, and move the server clock or inject faults through `/api/test/*`.
struct StackConfiguration: Sendable {
    let apiURL: URL
    let controlToken: String
    let runID: String
    let oidcIssuer: URL?

    /// From the runner's environment (`scripts/ios.sh ui-test` passes `TEST_RUNNER_PENNY_*`,
    /// which xcodebuild hands to this process without the prefix), else from the environment
    /// `npm run test-env -- up` left running in this checkout (for Xcode ⌘U).
    static func load(environment: [String: String] = ProcessInfo.processInfo.environment) -> StackConfiguration? {
        if let api = environment["PENNY_API_URL"].flatMap(URL.init(string:)),
            let token = environment["PENNY_TEST_TOKEN"],
            !token.isEmpty
        {
            return StackConfiguration(
                apiURL: api, controlToken: token, runID: environment["PENNY_TEST_RUN"] ?? "local",
                oidcIssuer: environment["PENNY_OIDC_ISSUER"].flatMap(URL.init(string:)))
        }
        return fromCheckout()
    }

    private static func fromCheckout() -> StackConfiguration? {
        // apps/ios/PennyUITests/Support/Stack.swift -> repository root
        let root = URL(filePath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let states = root.appending(path: ".cache/test-env")
        guard let current = try? String(contentsOf: states.appending(path: "current"), encoding: .utf8),
            let data = try? Data(
                contentsOf: states.appending(path: current.trimmingCharacters(in: .whitespacesAndNewlines))
                    .appending(path: "env.json")),
            let state = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let api = (state["apiUrl"] as? String).flatMap(URL.init(string:)),
            let token = state["controlToken"] as? String, let runID = state["runId"] as? String
        else { return nil }
        let issuer = ((state["oidc"] as? [String: Any])?["issuer"] as? String).flatMap(URL.init(string:))
        return StackConfiguration(apiURL: api, controlToken: token, runID: runID, oidcIssuer: issuer)
    }
}

/// An account created for one test (`POST /api/test/users`): a unique `.test` email and a
/// random password, so tests never share data and can run in any order.
struct TestAccount: Sendable {
    let userID: String
    let email: String
    let password: String
    let token: String
}

/// A fault rule for `PUT /api/test/faults` (the API applies it before routing).
struct FaultRule: Sendable {
    var method: String?
    var pathPrefix: String?
    var status: Int?
    var abort = false
    var times: Int?

    /// Every request to `pathPrefix` fails as if the network dropped.
    static func offline(_ pathPrefix: String = "/api/") -> FaultRule {
        FaultRule(pathPrefix: pathPrefix, abort: true)
    }

    var json: [String: Any] {
        var rule: [String: Any] = [:]
        if let method { rule["method"] = method }
        if let pathPrefix { rule["pathPrefix"] = pathPrefix }
        if let status { rule["status"] = status }
        if abort { rule["abort"] = true }
        if let times { rule["times"] = times }
        return rule
    }
}

enum StackError: Error, CustomStringConvertible {
    case status(String, Int, String)
    case malformed(String)

    var description: String {
        switch self {
        case .status(let request, let status, let body): "\(request) answered \(status): \(body.prefix(300))"
        case .malformed(let request): "\(request) answered with an unexpected body"
        }
    }
}

/// HTTP client for the stack: test controls (token-guarded) and the product API (as a user).
/// The control token and passwords are never attached to results or logged.
@MainActor
struct Stack {
    let configuration: StackConfiguration
    /// The deterministic server instant every test starts at (the seeds' clock).
    static let defaultNow = "2026-10-15T12:00:00Z"
    /// The app's pinned "today" for `defaultNow`.
    static let defaultToday = "2026-10-15"

    // MARK: Test controls

    func createAccount(label: String) async throws -> TestAccount {
        let body = try await control("POST", "users", body: ["label": label])
        guard let id = body["userId"] as? String, let email = body["email"] as? String,
            let password = body["password"] as? String, let token = body["token"] as? String
        else { throw StackError.malformed("POST /api/test/users") }
        return TestAccount(userID: id, email: email, password: password, token: token)
    }

    func setClock(_ iso: String) async throws { _ = try await control("PUT", "clock", body: ["now": iso]) }

    /// Back to real time. Single sign-on needs it: the API's `Date` header is real time while
    /// the attempt's `expiresAt` follows the pinned clock, so a pinned past date makes the app
    /// see an already-expired attempt ("Sign-in expired").
    func unpinClock() async throws { _ = try await control("DELETE", "clock") }

    func setFaults(_ rules: [FaultRule]) async throws {
        _ = try await control("PUT", "faults", body: ["rules": rules.map(\.json)])
    }

    func clearFaults() async throws { _ = try await control("DELETE", "faults") }

    /// The local OIDC provider's own controls (`--oidc`), guarded by the same token.
    func setSingleSignOnProvider(_ settings: [String: Any]) async throws {
        guard let issuer = configuration.oidcIssuer else { throw XCTSkip("The stack runs without --oidc.") }
        _ = try await send("PUT", issuer.appending(path: "control"), body: settings, control: true)
    }

    // MARK: Product API (what a second device would do)

    func signIn(email: String, password: String) async throws -> String {
        let body = try await send(
            "POST", configuration.apiURL.appending(path: "api/auth/login"),
            body: ["email": email, "password": password])
        guard let token = body["token"] as? String else { throw StackError.malformed("POST /api/auth/login") }
        return token
    }

    /// `GET /api/ledger`: the revision and the ledger as JSON.
    func ledger(token: String) async throws -> (revision: Int, ledger: [String: Any]) {
        let body = try await send("GET", configuration.apiURL.appending(path: "api/ledger"), token: token)
        guard let revision = body["revision"] as? Int, let ledger = body["ledger"] as? [String: Any] else {
            throw StackError.malformed("GET /api/ledger")
        }
        return (revision, ledger)
    }

    /// Adds a transaction from "another device" with a stable, test-chosen id.
    func addTransaction(
        token: String, id: String, title: String, cents: Int, date: String = Stack.defaultToday,
        categoryID: String = "groceries"
    ) async throws {
        let current = try await ledger(token: token)
        var ledger = current.ledger
        var transactions = ledger["transactions"] as? [[String: Any]] ?? []
        transactions.append([
            "id": id, "title": title, "kind": "expense", "total": cents, "share": cents, "categoryId": categoryID,
            "date": date, "note": "",
        ])
        ledger["transactions"] = transactions
        _ = try await send(
            "PUT", configuration.apiURL.appending(path: "api/ledger"),
            body: ["revision": current.revision, "ledger": ledger], token: token)
    }

    /// Polls the server until `condition` holds for the account's ledger (the app syncs in
    /// the background, so its writes arrive shortly after the UI shows them).
    @discardableResult
    func waitForLedger(
        token: String, timeout: TimeInterval = 20, _ condition: ([String: Any]) -> Bool
    ) async throws -> [String: Any] {
        let deadline = Date().addingTimeInterval(timeout)
        while true {
            let ledger = try await ledger(token: token).ledger
            if condition(ledger) { return ledger }
            guard Date() < deadline else {
                throw UIExpectationFailed(
                    description: "The server ledger did not reach the expected state in \(Int(timeout))s")
            }
            try await Task.sleep(for: .milliseconds(500))
        }
    }

    // MARK: Transport

    private func control(_ method: String, _ path: String, body: [String: Any]? = nil) async throws -> [String: Any] {
        try await send(method, configuration.apiURL.appending(path: "api/test/\(path)"), body: body, control: true)
    }

    private func send(
        _ method: String, _ url: URL, body: [String: Any]? = nil, token: String? = nil, control: Bool = false
    ) async throws -> [String: Any] {
        var request = URLRequest(url: url, timeoutInterval: 30)
        request.httpMethod = method
        if control { request.setValue(configuration.controlToken, forHTTPHeaderField: "X-Penny-Test-Token") }
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, response) = try await Self.session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        let name = "\(method) \(url.path())"
        guard (200..<300).contains(status) else {
            throw StackError.status(name, status, String(decoding: data, as: UTF8.self))
        }
        if data.isEmpty { return [:] }
        return (try JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
    }

    /// Trusts the local OIDC provider's throwaway certificate (loopback only), like the
    /// browser runners' `ignoreHTTPSErrors`; every other host gets normal validation.
    private static let session = URLSession(
        configuration: .ephemeral, delegate: LoopbackTrust(), delegateQueue: nil)
}

private final class LoopbackTrust: NSObject, URLSessionDelegate, Sendable {
    func urlSession(
        _ session: URLSession, didReceive challenge: URLAuthenticationChallenge
    ) async -> (URLSession.AuthChallengeDisposition, URLCredential?) {
        let space = challenge.protectionSpace
        guard space.authenticationMethod == NSURLAuthenticationMethodServerTrust,
            ["127.0.0.1", "localhost"].contains(space.host), let trust = space.serverTrust
        else { return (.performDefaultHandling, nil) }
        return (.useCredential, URLCredential(trust: trust))
    }
}
