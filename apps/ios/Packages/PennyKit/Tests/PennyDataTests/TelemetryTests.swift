import Foundation
import PennyDomain
import Synchronization
import Testing

@testable import PennyData

/// MAZ-129: opt-in crash and performance reports. Synthetic financial text only.
@Suite("Client telemetry")
struct TelemetryTests {
    static let resource = TelemetryResource(
        version: "1.2.0", build: "42", osVersion: "26.1.0", deviceModel: "iPhone18,1", sessionID: "0123456789abcdef")
    static let now = Date(timeIntervalSince1970: 1_800_000_000)

    /// Answers telemetry posts with `status` and everything else with 200, recording both.
    static func transport(status: Int = 202, headers: [String: String] = [:]) -> StubTransport {
        StubTransport { request in
            let path = request.url?.path ?? ""
            if path.hasPrefix("/api/telemetry") {
                return HTTPResult(status: status, headers: headers, body: Data(#"{"ok":true}"#.utf8))
            }
            return HTTPResult(status: 200, body: Data("{}".utf8))
        }
    }

    static func recorder(pending: PendingReports = PendingReports(file: nil)) -> TelemetryRecorder {
        TelemetryRecorder(resource: resource, pending: pending, flushDelay: nil, now: { now })
    }

    static func configuration(
        crashes: Bool = true, performance: Bool = true, transport: StubTransport?, offered: Bool = true,
        demo: Bool = false
    ) throws -> TelemetryRecorder.Configuration {
        TelemetryRecorder.Configuration(
            choices: TelemetryChoices(crashes: crashes, performance: performance, decided: true),
            destination: try transport.map { try APIFixtures.client(transport: $0) }, offered: offered, demo: demo)
    }

    static func span(_ name: String = "GET /api/ledger") -> TelemetrySpan {
        TelemetrySpan(name: name, kind: .client, start: now, end: now.addingTimeInterval(0.25))
    }

    static func log(_ body: String = "Crash: EXC_BAD_ACCESS (SIGSEGV)") -> TelemetryLog {
        TelemetryLog(time: now, severity: .fatal, body: body, attributes: ["exception.type": "EXC_BAD_ACCESS"])
    }

    static func telemetryPosts(_ transport: StubTransport) -> [URLRequest] {
        transport.sent.filter { $0.url?.path.hasPrefix("/api/telemetry") == true }
    }

    // MARK: Scrubbing

    @Test("whenScrubbingURLs_TelemetryScrubber_ShouldKeepOnlyTheOriginAndPathShape")
    func scrubURLs() {
        #expect(
            TelemetryScrubber.url("/api/households/7f3c2a91-0b1d/expenses?month=2026-11")
                == "/api/households/:id/expenses")
        #expect(
            TelemetryScrubber.url("https://Penny.Example.test:8443/api/v1/search/transactions?q=rent#x")
                == "https://penny.example.test:8443/api/v1/search/transactions")
        #expect(TelemetryScrubber.url("/api/receipts/deadbeefcafe") == "/api/receipts/:id")
        #expect(TelemetryScrubber.url("penny://entries/new") == "penny://entries/new")
    }

    @Test("whenScrubbingText_TelemetryScrubber_ShouldRedactEmailsQuotesAndAmountsButKeepAddresses")
    func scrubText() {
        let text = TelemetryScrubber.text(
            #"Saving "Groceries at Corner Market" for 84.20 by bea@example.test failed at https://penny.example.test/api/entries/e-91?token=abc"#
        )
        #expect(!text.contains("Groceries"))
        #expect(!text.contains("84.20"))
        #expect(!text.contains("bea@example.test"))
        #expect(!text.contains("token=abc"))
        #expect(text.contains("<text>") && text.contains("<n>") && text.contains("<email>"))
        #expect(text.contains("https://penny.example.test/api/entries/:id"))
        let frame = "Penny 0x0000000102a4c8f4 1f0c3a5bd2e94c7f8a6b0c1d2e3f4a5b + 0x248f4"
        #expect(TelemetryScrubber.text(frame) == frame)
    }

    // MARK: Encoding

    @Test("whenEncodingTraces_OTLPJSON_ShouldMatchWhatTheAPIAccepts")
    func encodeTraces() throws {
        var span = Self.span()
        span.attributes = ["http.response.status_code": .int(200), "url.path": .string("/api/ledger")]
        let body = try APIFixtures.object(try OTLPJSON.traces([span], resource: Self.resource))
        #expect(body.keys.sorted() == ["resourceSpans"])
        let resource = try #require((body["resourceSpans"] as? [[String: Any]])?.first)
        let attributes = try #require((resource["resource"] as? [String: Any])?["attributes"] as? [[String: Any]])
        let service = attributes.first { $0["key"] as? String == "service.name" }
        #expect((service?["value"] as? [String: Any])?["stringValue"] as? String == "penny-ios")
        #expect(attributes.contains { $0["key"] as? String == "service.version" })
        let scope = try #require((resource["scopeSpans"] as? [[String: Any]])?.first)
        let encoded = try #require((scope["spans"] as? [[String: Any]])?.first)
        #expect(encoded["traceId"] as? String == span.traceID)
        #expect((encoded["traceId"] as? String)?.count == 32)
        #expect(encoded["startTimeUnixNano"] as? String == "1800000000000000000")
        #expect(encoded["endTimeUnixNano"] as? String == "1800000000250000000")
        let status = (encoded["attributes"] as? [[String: Any]])?.first {
            $0["key"] as? String == "http.response.status_code"
        }
        #expect((status?["value"] as? [String: Any])?["intValue"] as? String == "200")
    }

    @Test("whenEncodingLogs_OTLPJSON_ShouldUseTheContractsSeverities")
    func encodeLogs() throws {
        let body = try APIFixtures.object(try OTLPJSON.logs([Self.log()], resource: Self.resource))
        let resource = try #require((body["resourceLogs"] as? [[String: Any]])?.first)
        let scope = try #require((resource["scopeLogs"] as? [[String: Any]])?.first)
        let record = try #require((scope["logRecords"] as? [[String: Any]])?.first)
        #expect(record["severityNumber"] as? Int == 21)
        #expect(record["severityText"] as? String == "FATAL")
        #expect((record["body"] as? [String: Any])?["stringValue"] as? String == "Crash: EXC_BAD_ACCESS (SIGSEGV)")
    }

    @Test("whenMakingIds_TraceIDs_ShouldBeValidW3CAndIdempotencyKeys")
    func ids() {
        let trace = TraceIDs.traceID()
        let span = TraceIDs.spanID()
        #expect(trace.count == 32 && span.count == 16)
        #expect(trace.allSatisfy { $0.isHexDigit && !$0.isUppercase })
        #expect(TraceIDs.traceparent(traceID: trace, spanID: span) == "00-\(trace)-\(span)-01")
        #expect(TraceIDs.idempotencyKey().wholeMatch(of: /[A-Za-z0-9_-]{8,64}/) != nil)
    }

    // MARK: Choices

    @Test("whenStoredChoicesAreMissingOrMalformed_TelemetryChoices_ShouldReadAsOff")
    func choicesDefaultOff() throws {
        let suite = "penny.tests.telemetry.\(UUID().uuidString)"
        let store = UserDefaultsTelemetryChoiceStore(suiteName: suite)
        #expect(store.load() == .none)
        UserDefaults(suiteName: suite)?.set(Data(#"{"crashes":"yes"}"#.utf8), forKey: "penny.telemetry")
        #expect(store.load() == .none)
        store.save(TelemetryChoices(crashes: true, performance: false, decided: true))
        #expect(store.load() == TelemetryChoices(crashes: true, performance: false, decided: true))
        UserDefaults().removePersistentDomain(forName: suite)
    }

    @MainActor
    @Test("whenAnsweringThePrompt_ClientTelemetry_ShouldAskOnceAndSaveTheAnswer")
    func prompt() {
        let store = EphemeralTelemetryChoiceStore()
        let telemetry = ClientTelemetry(store: store, recorder: Self.recorder(), processStart: nil)
        #expect(telemetry.shouldAsk(offered: true, demo: false))
        #expect(!telemetry.shouldAsk(offered: false, demo: false))
        #expect(!telemetry.shouldAsk(offered: true, demo: true))
        telemetry.answerPrompt(share: false)
        #expect(!telemetry.shouldAsk(offered: true, demo: false))
        #expect(store.load() == TelemetryChoices(crashes: false, performance: false, decided: true))
        telemetry.setPerformance(true)
        #expect(store.load() == TelemetryChoices(crashes: false, performance: true, decided: true))
    }

    // MARK: Recorder

    @Test("whenNothingIsShared_TelemetryRecorder_ShouldRecordAndSendNothing")
    func optInRespected() async throws {
        let transport = Self.transport()
        let recorder = Self.recorder()
        recorder.configure(try Self.configuration(crashes: false, performance: false, transport: transport))
        #expect(!recorder.tracesRequests && !recorder.reportsErrors)
        recorder.record(Self.span())
        recorder.record(Self.log())
        recorder.receiveDiagnostics([Self.log()])
        await recorder.flush()
        #expect(transport.sent.isEmpty)
    }

    @Test("whenInTheDemoOrTheServerDoesNotOfferIt_TelemetryRecorder_ShouldStaySilent")
    func demoSilent() async throws {
        for configuration in [
            try Self.configuration(transport: Self.transport(), demo: true),
            try Self.configuration(transport: Self.transport(), offered: false),
        ] {
            let recorder = Self.recorder()
            recorder.configure(configuration)
            recorder.record(Self.span())
            recorder.receiveDiagnostics([Self.log()])
            await recorder.flush()
            #expect(!recorder.tracesRequests)
        }
        let transport = Self.transport()
        let recorder = Self.recorder()
        recorder.configure(try Self.configuration(transport: transport, demo: true))
        recorder.record(Self.span())
        await recorder.flush()
        #expect(transport.sent.isEmpty)
    }

    @Test("whenShared_TelemetryRecorder_ShouldPostOTLPJSONWithTheSessionAndAnIdempotencyKey")
    func sends() async throws {
        let transport = Self.transport()
        let recorder = Self.recorder()
        recorder.configure(try Self.configuration(transport: transport))
        recorder.record(Self.span())
        recorder.record(Self.log("Server error on GET /api/ledger"))
        await recorder.flush()
        let posts = Self.telemetryPosts(transport)
        #expect(posts.map { $0.url?.path } == ["/api/telemetry/otlp/v1/traces", "/api/telemetry/otlp/v1/logs"])
        for post in posts {
            #expect(post.value(forHTTPHeaderField: "Authorization") == "Bearer \(APIFixtures.token)")
            #expect(post.value(forHTTPHeaderField: "Content-Type") == "application/json")
            #expect(post.value(forHTTPHeaderField: "Idempotency-Key")?.count == 32)
        }
        await recorder.flush()
        #expect(Self.telemetryPosts(transport).count == 2)
    }

    @Test("whenACrashArrivesSignedOut_TelemetryRecorder_ShouldKeepItUntilSignIn")
    func buffersUntilSignIn() async throws {
        let pending = PendingReports(file: nil)
        let recorder = Self.recorder(pending: pending)
        recorder.configure(try Self.configuration(transport: nil))
        recorder.receiveDiagnostics([Self.log()])
        await recorder.flush()
        #expect(pending.count == 1)
        let transport = Self.transport()
        recorder.configure(try Self.configuration(transport: transport))
        await recorder.flush()
        #expect(Self.telemetryPosts(transport).map { $0.url?.path } == ["/api/telemetry/otlp/v1/logs"])
        #expect(pending.count == 0)
    }

    @Test("whenCrashReportsAreTurnedOff_TelemetryRecorder_ShouldDropWaitingCrashes")
    func turningOffClears() throws {
        let pending = PendingReports(file: nil)
        let recorder = Self.recorder(pending: pending)
        recorder.configure(try Self.configuration(transport: nil))
        recorder.receiveDiagnostics([Self.log()])
        #expect(pending.count == 1)
        recorder.configure(try Self.configuration(crashes: false, transport: nil))
        #expect(pending.count == 0)
    }

    @Test("whenTheServerTurnedTelemetryOff_TelemetryRecorder_ShouldStopSendingThisLaunch")
    func notFoundStops() async throws {
        let transport = Self.transport(status: 404)
        let recorder = Self.recorder()
        recorder.configure(try Self.configuration(transport: transport))
        recorder.record(Self.span())
        await recorder.flush()
        #expect(Self.telemetryPosts(transport).count == 1)
        #expect(!recorder.tracesRequests)
        recorder.record(Self.span())
        await recorder.flush()
        #expect(Self.telemetryPosts(transport).count == 1)
    }

    @Test("whenRateLimited_TelemetryRecorder_ShouldWaitForRetryAfterAndKeepCrashes")
    func rateLimited() async throws {
        let pending = PendingReports(file: nil)
        let transport = Self.transport(status: 429, headers: ["retry-after": "30"])
        let recorder = Self.recorder(pending: pending)
        recorder.configure(try Self.configuration(performance: false, transport: transport))
        recorder.receiveDiagnostics([Self.log()])
        await recorder.flush()
        #expect(Self.telemetryPosts(transport).count == 1)
        #expect(pending.count == 1)
        await recorder.flush()
        #expect(Self.telemetryPosts(transport).count == 1)
    }

    @Test("whenTheServerIsUnreachable_TelemetryRecorder_ShouldNeverThrowAndKeepCrashes")
    func unreachable() async throws {
        let pending = PendingReports(file: nil)
        let transport = StubTransport { _ in throw URLError(.cannotConnectToHost) }
        let recorder = Self.recorder(pending: pending)
        recorder.configure(try Self.configuration(transport: transport))
        recorder.record(Self.span())
        recorder.receiveDiagnostics([Self.log()])
        await recorder.flush()
        #expect(pending.count == 1)
    }

    @Test("whenABatchIsTooBig_TelemetryRecorder_ShouldSplitItUnderTheLimit")
    func splitsBatches() async throws {
        let transport = Self.transport()
        let recorder = Self.recorder()
        recorder.configure(try Self.configuration(performance: false, transport: transport))
        let frames = String(
            repeating: "Penny 0x0000000102a4c8f4 1f0c3a5bd2e94c7f8a6b0c1d2e3f4a5b + 0x248f4\n", count: 200)
        recorder.receiveDiagnostics(
            (0..<PendingReports.capacity).map { _ in
                TelemetryLog(
                    time: Self.now, severity: .fatal, body: "Crash", attributes: ["exception.stacktrace": frames])
            })
        await recorder.flush()
        let posts = Self.telemetryPosts(transport)
        #expect(posts.count > 1)
        #expect(posts.allSatisfy { ($0.httpBody?.count ?? 0) <= APIClient.maxTelemetryBody })
    }

    // MARK: Pending reports

    @Test("whenReportsWait_PendingReports_ShouldPersistBoundAndExpireThem")
    func pendingReports() throws {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent(
            "penny-\(UUID().uuidString)/pending.json")
        defer { try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) }
        let reports = PendingReports(file: file)
        reports.add((0..<(PendingReports.capacity + 5)).map { _ in Self.log() }, now: Self.now)
        #expect(PendingReports(file: file).count == PendingReports.capacity)
        let later = Self.now.addingTimeInterval(PendingReports.maxAge + 1)
        #expect(PendingReports(file: file).take(now: later).isEmpty)
    }

    // MARK: Crash reports

    static let diagnostics = #"""
        {
          "timeStampBegin": "2026-11-24 10:00:00",
          "timeStampEnd": "2026-11-24 11:00:00",
          "crashDiagnostics": [{
            "version": "1.0.0",
            "diagnosticMetaData": {
              "appVersion": "1.2.0", "appBuildVersion": "41", "osVersion": "iPhone OS 26.1 (23B85)",
              "deviceType": "iPhone18,1", "platformArchitecture": "arm64e", "regionFormat": "CA",
              "exceptionType": 1, "exceptionCode": 0, "signal": 11,
              "terminationReason": "Namespace SIGNAL, Code 11 Segmentation fault: 11",
              "virtualMemoryRegionInfo": "0 is not in any region.",
              "objectiveCexceptionReason": {"composedMessage": "Groceries at Corner Market 84.20"}
            },
            "callStackTree": {
              "callStackPerThread": true,
              "callStacks": [
                {"threadAttributed": false, "callStackRootFrames": [{"binaryName": "libsystem_kernel.dylib", "binaryUUID": "AAAAAAAA-0000-0000-0000-000000000000", "address": 1, "offsetIntoBinaryTextSegment": 1}]},
                {"threadAttributed": true, "callStackRootFrames": [{
                  "binaryName": "Penny", "binaryUUID": "1F0C3A5B-D2E9-4C7F-8A6B-0C1D2E3F4A5B",
                  "address": 4339320052, "offsetIntoBinaryTextSegment": 149748, "sampleCount": 1,
                  "subFrames": [{"binaryName": "/private/var/containers/Bundle/Application/X/Penny.app/Frameworks/PennyKit", "binaryUUID": "2A2A2A2A-1111-2222-3333-444444444444", "address": 4339000000, "offsetIntoBinaryTextSegment": 4096}]
                }]}
              ]
            }
          }],
          "hangDiagnostics": [{
            "diagnosticMetaData": {"appVersion": "1.2.0", "hangDuration": "2.5 sec"},
            "callStackTree": {"callStacks": []}
          }]
        }
        """#

    @Test("whenMetricKitDeliversACrash_CrashReports_ShouldMakeAFatalRecordWithSymbolicatableFrames")
    func crashRecord() throws {
        let logs = CrashReports.logs(fromDiagnosticJSON: Data(Self.diagnostics.utf8), receivedAt: Self.now)
        #expect(logs.count == 2)
        let crash = try #require(logs.first)
        #expect(crash.severity == .fatal)
        #expect(crash.body == "Crash: EXC_BAD_ACCESS (SIGSEGV)")
        #expect(crash.attributes["exception.type"] == "EXC_BAD_ACCESS (SIGSEGV)")
        #expect(crash.attributes["penny.crash.app_version"] == "1.2.0")
        let frames = try #require(crash.attributes["exception.stacktrace"]).split(separator: "\n")
        #expect(
            frames == [
                "Penny 0x0000000102a4c4f4 1f0c3a5bd2e94c7f8a6b0c1d2e3f4a5b + 0x248f4",
                "PennyKit 0x00000001029fe2c0 2a2a2a2a111122223333444444444444 + 0x1000",
            ])
        let everything = crash.attributes.values.joined(separator: " ") + crash.body
        #expect(!everything.contains("Groceries"))
        #expect(!everything.contains("84.20"))
        #expect(!everything.contains("CA"))
        #expect(!everything.contains("/private/var"))
        #expect(crash.time == Date(timeIntervalSince1970: 1_795_518_000))
        let hang = try #require(logs.last)
        #expect(hang.severity == .warn)
        #expect(hang.attributes["exception.type"] == "hang")
        // Scrubbed: the scrubber redacts the number, keeping the unit.
        #expect(hang.attributes["penny.hang.duration"] == "<n> sec")
    }

    @Test("whenTheDiagnosticIsMalformed_CrashReports_ShouldReturnNothing")
    func malformedDiagnostics() {
        #expect(CrashReports.logs(fromDiagnosticJSON: Data("not json".utf8), receivedAt: Self.now).isEmpty)
        #expect(CrashReports.logs(fromDiagnosticJSON: Data("{}".utf8), receivedAt: Self.now).isEmpty)
    }

    // MARK: Tracing transport

    @Test("whenPerformanceIsShared_TracingTransport_ShouldSendTraceparentAndRecordAScrubbedSpan")
    func tracing() async throws {
        let telemetry = Self.transport()
        let recorder = Self.recorder()
        recorder.configure(try Self.configuration(crashes: false, transport: telemetry))
        let app = StubTransport(status: 200, json: "{}")
        let client = try APIFixtures.client(
            transport: TracingTransport(base: app, recorder: recorder, now: { Self.now }))
        let month = try #require(MonthKey(year: 2026, month: 11))
        _ = try? await client.householdProjection(month: month)
        let sent = try #require(app.sent.first)
        let traceparent = try #require(sent.value(forHTTPHeaderField: "traceparent"))
        #expect(traceparent.wholeMatch(of: /00-[0-9a-f]{32}-[0-9a-f]{16}-01/) != nil)
        await recorder.flush()
        let post = try #require(Self.telemetryPosts(telemetry).first)
        let body = String(decoding: try #require(post.httpBody), as: UTF8.self)
        #expect(body.contains(#""name":"GET /api/households/projection""#))
        #expect(!body.contains("month="))
        #expect(!body.contains("penny.example.test"))
        #expect(body.contains(String(traceparent.split(separator: "-")[1])))
    }

    @Test("whenNothingIsShared_TracingTransport_ShouldSendTheRequestUntouched")
    func untouched() async throws {
        let recorder = Self.recorder()
        recorder.configure(try Self.configuration(crashes: false, performance: false, transport: Self.transport()))
        let app = StubTransport(status: 200, json: #"{"name":"penny","version":"2.0.0"}"#)
        let client = try APIFixtures.client(transport: TracingTransport(base: app, recorder: recorder))
        _ = try await client.info()
        #expect(app.sent.first?.value(forHTTPHeaderField: "traceparent") == nil)
    }

    @Test("whenTheServerFails_TracingTransport_ShouldRecordAnErrorWithoutContent")
    func serverError() async throws {
        let telemetry = Self.transport()
        let recorder = Self.recorder()
        recorder.configure(try Self.configuration(performance: false, transport: telemetry))
        let app = StubTransport(status: 500, json: #"{"error":"Groceries at Corner Market"}"#)
        let client = try APIFixtures.client(
            transport: TracingTransport(base: app, recorder: recorder, now: { Self.now }))
        await #expect(throws: APIError.self) { _ = try await client.householdProjection(period: .allTime) }
        await recorder.flush()
        let post = try #require(Self.telemetryPosts(telemetry).first)
        #expect(post.url?.path == "/api/telemetry/otlp/v1/logs")
        let body = String(decoding: try #require(post.httpBody), as: UTF8.self)
        #expect(body.contains("http.server_error"))
        #expect(body.contains("/api/households/projection"))
        #expect(!body.contains("Groceries"))
    }

    // MARK: Server info

    @Test("whenTheServerOffersNativeTelemetry_ServerInfo_ShouldSaySoAndOlderServersShouldNot")
    func serverInfo() throws {
        let decoder = JSONDecoder()
        let offered = try decoder.decode(
            WireServerInfo.self,
            from: Data(
                #"{"name":"penny","version":"2.0.0","telemetry":{"web":true,"sessionReplay":false,"native":true}}"#.utf8
            ))
        #expect(offered.takesNativeTelemetry)
        let older = try decoder.decode(WireServerInfo.self, from: Data(#"{"name":"penny","version":"1.0.0"}"#.utf8))
        #expect(!older.takesNativeTelemetry)
        let malformed = try decoder.decode(
            WireServerInfo.self, from: Data(#"{"name":"penny","version":"2.0.0","telemetry":{"native":"yes"}}"#.utf8))
        #expect(!malformed.takesNativeTelemetry)
        let saved = SavedServer(server: APIFixtures.server, nativeTelemetry: true)
        #expect(try decoder.decode(SavedServer.self, from: JSONEncoder().encode(saved)).nativeTelemetry)
    }

    @MainActor
    @Test("whenRefreshingServerInfo_AuthController_ShouldFollowNativeTelemetry")
    func refreshFollowsTelemetry() async {
        let answer = Mutex(
            #"{"name":"penny","version":"2.0.0","telemetry":{"web":false,"sessionReplay":false,"native":true}}"#)
        let controller = AuthFixtures.controller(
            transport: Routes.transport([
                "GET /api/info": { _ in HTTPResult(status: 200, body: Data(answer.withLock { $0 }.utf8)) }
            ]))
        await controller.restore()
        await controller.refreshServerInfo()
        #expect(controller.server?.nativeTelemetry == true)
        answer.withLock { $0 = #"{"name":"penny","version":"2.0.0"}"# }
        await controller.refreshServerInfo()
        #expect(controller.server?.nativeTelemetry == false)
    }

    @MainActor
    @Test("whenSignedInWithReportsShared_ClientTelemetry_ShouldRecordTheLaunchOnce")
    func launch() async throws {
        let transport = Self.transport()
        let recorder = Self.recorder()
        let telemetry = ClientTelemetry(
            store: EphemeralTelemetryChoiceStore(TelemetryChoices(crashes: false, performance: true, decided: true)),
            recorder: recorder, processStart: Self.now.addingTimeInterval(-1.5), now: { Self.now })
        let account = SignedInAccount(session: APIFixtures.session(), generation: 1, isVerified: true)
        telemetry.update(account: account, offered: true, demo: false, transport: transport)
        telemetry.recordLaunch()
        telemetry.recordLaunch()
        await recorder.flush()
        let body = String(decoding: try #require(Self.telemetryPosts(transport).first?.httpBody), as: UTF8.self)
        #expect(body.components(separatedBy: "app.launch").count == 2)
        #expect(body.contains(#""startTimeUnixNano":"1799999998500000000""#))
    }
}
