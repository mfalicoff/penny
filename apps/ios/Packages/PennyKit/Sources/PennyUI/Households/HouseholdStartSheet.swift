import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

/// Create or join a household (`iphone-household-create`, the redesign's `household-create` and
/// `join-group`). Join takes a typed code, a scanned QR code or a `penny://join` link.
///
/// Invite links name their server. A link for the server the person uses fills in the code; a
/// link for another server is never followed silently: the sheet names both servers, says the
/// current sign-in stays here, and offers to keep the invite for after signing out (then the
/// sign-in screen offers to connect to that server, which sends nothing but the server check).
/// A malformed link, or one that names a plain-HTTP server, is refused with the reason.
struct HouseholdStartSheet: View {
    @Environment(ShellModel.self) private var shell
    @Environment(InviteHandoff.self) private var handoff: InviteHandoff?
    @Environment(\.dismiss) private var dismiss

    let start: HouseholdStart
    /// Join a trip (MAZ-76, from the Trips tab): join only, in trip words.
    let joinsTrip: Bool
    /// Called instead of opening the household on the Shared tab, once this sheet is closing.
    let onOpened: ((WireHousehold) -> Void)?

    enum Mode: String, CaseIterable { case create, join }

    @State private var mode: Mode
    @State private var name = ""
    @State private var codeText: String
    @State private var linkProblem: InviteLink.Invalid?
    @State private var otherServer: ServerURL?
    @State private var failure: HouseholdFailure?
    @State private var working = false
    @State private var scanning = false
    @FocusState private var focused: Bool

    init(start: HouseholdStart, joinsTrip: Bool = false, onOpened: ((WireHousehold) -> Void)? = nil) {
        self.start = start
        self.joinsTrip = joinsTrip
        self.onOpened = onOpened
        switch start {
        case .create:
            _mode = State(initialValue: .create)
            _codeText = State(initialValue: "")
        case .join(let code, _):
            _mode = State(initialValue: .join)
            _codeText = State(initialValue: code.flatMap(InviteCode.init(typed:))?.grouped ?? "")
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                if let failure {
                    Section {
                        StatusBanner(
                            tone: failure.kind == .offline ? .offline : .error,
                            title: HouseholdFailureBanner.title(failure.kind), message: failure.message)
                    }
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                    .accessibilityIdentifier("householdStart.error")
                }

                switch mode {
                case .create: createSection
                case .join: joinSection
                }
            }
            .scrollContentBackground(.hidden)
            // `iphone-join-code` is drawn on the sheet's surface, with the code in a raised group.
            .background(mode == .join ? PennyColor.surface : PennyColor.background)
            .safeAreaInset(edge: .bottom) {
                if mode == .create {
                    createButton
                } else if otherServer == nil {
                    joinButton
                }
            }
            .navigationTitle(joinsTrip ? "Join a trip" : mode == .create ? "New household" : "Join a household")
            .inlineNavigationTitle()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close", systemImage: "xmark") { dismiss() }
                        .neutralToolbarGlyph()
                        .accessibilityIdentifier("householdStart.close")
                }
                if !joinsTrip {
                    // Create or Join in the bar, as on the card; the header below names the mode.
                    ToolbarItem(placement: .principal) {
                        Picker("Create or join", selection: $mode) {
                            Text("Create").tag(Mode.create)
                            Text("Join").tag(Mode.join)
                        }
                        .pickerStyle(.segmented)
                        .frame(maxWidth: 220)
                        .accessibilityIdentifier("householdStart.mode")
                    }
                }
            }
            .sheet(isPresented: $scanning) {
                InviteScannerView(
                    allowsLoopbackHTTP: allowsLoopbackHTTP,
                    onScan: { link in
                        scanning = false
                        use(link)
                    },
                    onTypeCode: {
                        scanning = false
                        focused = true
                    })
            }
            .pennySolidBars()
        }
        .onAppear {
            // On screen: the invite that asked for this sheet is used up (`InviteHandoff`).
            if case .join(let code, let server) = start { handoff?.shown(code: code, server: server) }
            readLink()
        }
        .interactiveDismissDisabled(working)
        .accessibilityIdentifier("screen.householdStart")
    }

    private var allowsLoopbackHTTP: Bool { handoff?.allowsLoopbackHTTP ?? false }
    private var currentServer: ServerURL? { shell.account?.server }
    private var ledgerCurrency: Currency { shell.workspace.load.ledger?.currency ?? .cad }

    // MARK: Create

    @ViewBuilder private var createSection: some View {
        Section {
            VStack(spacing: 10) {
                // The card's neutral tile: copper is for the Create household action only.
                Image(systemName: "house")
                    .font(.largeTitle)
                    .foregroundStyle(PennyColor.label)
                    .frame(width: 72, height: 72)
                    .background(PennyColor.fill, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                    .accessibilityHidden(true)
                Text("New household").font(.title2.weight(.bold))
                    .accessibilityAddTraits(.isHeader)
                Text(
                    "Share rent, bills and groceries. Everyone sees the full expense; your reports count only your "
                        + "share."
                )
                .font(.subheadline)
                .foregroundStyle(PennyColor.secondaryLabel)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity)
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("householdStart.intro")
        }
        .listRowBackground(Color.clear)
        .listRowInsets(EdgeInsets(top: 8, leading: 0, bottom: 0, trailing: 0))
        CardSection("Name") {
            TextField("Apartment", text: $name)
                .submitLabel(.done)
                .accessibilityIdentifier("householdStart.name")
        }
        Section {
            LabeledContent {
                HStack(spacing: 4) {
                    Text(ledgerCurrency.rawValue)
                    Image(systemName: "lock.fill").font(.footnote).accessibilityHidden(true)
                }
                .foregroundStyle(PennyColor.secondaryLabel)
            } label: {
                Label {
                    Text("Currency")
                } icon: {
                    Image(systemName: "banknote").foregroundStyle(PennyColor.label)
                }
            }
            .accessibilityValue("\(ledgerCurrency.rawValue), fixed")
            .accessibilityIdentifier("householdStart.currency")
            LabeledContent {
                Text("After creating")
            } label: {
                Label {
                    Text("Invite people")
                } icon: {
                    Image(systemName: "person.badge.plus").foregroundStyle(PennyColor.label)
                }
            }
        } header: {
            Text("Details").cardSectionHeader()
        } footer: {
            // The card says only this; the online requirement is on the Shared list, and a failed
            // save says itself that what was typed is kept.
            Text("Uses your ledger currency. Everyone who joins must use \(ledgerCurrency.rawValue) too.")
        }
    }

    /// Create household, pinned to the bottom of the sheet as on the card.
    private var createButton: some View {
        Button {
            Task { await create() }
        } label: {
            HStack(spacing: 8) {
                Text(working ? "Creating…" : "Create household")
                if working { ProgressView().tint(.white) }
            }
            .font(.body.weight(.semibold))
            .frame(maxWidth: .infinity, minHeight: ControlSize.button)
            .foregroundStyle(.white)
            .background(PennyColor.tint, in: Capsule())
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .disabled(!canCreate)
        .opacity(canCreate ? 1 : 0.45)
        .padding(.horizontal, Metrics.gutter)
        .padding(.vertical, 8)
        .background(PennyColor.background)
        .accessibilityIdentifier("householdStart.create")
    }

    private var canCreate: Bool { !working && SharedText.required(name, maxLength: 80) != nil }

    private func create() async {
        working = true
        defer { working = false }
        failure = nil
        switch await shell.households.create(name: name, currency: ledgerCurrency) {
        case .success(let household):
            opened(household)
        case .failure(let refused):
            failure = refused
        }
    }

    // MARK: Join

    @ViewBuilder private var joinSection: some View {
        if let otherServer {
            Section {
                VStack(alignment: .leading, spacing: 8) {
                    Label("This invite is for another server", systemImage: "server.rack")
                        .font(.headline)
                    Text(
                        "The invite is for \(otherServer.description). You're signed in to "
                            + "\(currentServer?.description ?? "another server"). Penny never sends your "
                            + "sign-in to a different server. To join, sign out here, then connect to "
                            + "\(ServerText.host(otherServer)) and sign in there; the invite waits for you."
                    )
                    .font(.subheadline)
                    .foregroundStyle(PennyColor.secondaryLabel)
                    .fixedSize(horizontal: false, vertical: true)
                }
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("householdStart.otherServer")
                Button("Sign out to join on \(ServerText.host(otherServer))") {
                    handoff?.keepForSignIn(code: InviteCode(typed: codeText)?.value, server: otherServer.description)
                    // Settings opens once this sheet has gone, never in the same update.
                    shell.closeHouseholdStart { $0.openSettings() }
                }
                .accessibilityIdentifier("householdStart.useOtherServer")
                Button("Use a code for \(currentServer.map(ServerText.host) ?? "this server") instead") {
                    self.otherServer = nil
                    codeText = ""
                }
            }
        }
        if let linkProblem {
            Section {
                StatusBanner(tone: .error, title: "This invite link can't be used", message: Self.message(linkProblem))
            }
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets())
            .accessibilityIdentifier("householdStart.error")
        }
        if otherServer == nil {
            // `iphone-join-code`: the key tile and the title, then the code and Scan a QR code in
            // one group, the hint, and Join household pinned to the bottom.
            Section {
                VStack(spacing: 14) {
                    Image(systemName: "key")
                        .font(.largeTitle)
                        .foregroundStyle(PennyColor.label)
                        .frame(width: 72, height: 72)
                        .background(PennyColor.fill, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                        .accessibilityHidden(true)
                    Text(joinsTrip ? "Join a trip" : "Join a household").font(.title2.weight(.bold))
                        .accessibilityAddTraits(.isHeader)
                }
                .frame(maxWidth: .infinity)
                .padding(.top, 14)
                .accessibilityIdentifier("householdStart.intro")
            }
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets(top: 8, leading: 0, bottom: 0, trailing: 0))
            Section {
                TextField("10-character code", text: $codeText)
                    .font(.title2.weight(.semibold).monospacedDigit())
                    .tracking(3)
                    .codeEntry()
                    .focused($focused)
                    .submitLabel(.join)
                    .onSubmit { Task { await join() } }
                    .frame(minHeight: 54)
                    .listRowBackground(PennyColor.secondarySurface)
                    .accessibilityIdentifier("householdStart.code")
                Button {
                    scanning = true
                } label: {
                    Label("Scan a QR code", systemImage: "qrcode.viewfinder")
                        .font(.body.weight(.medium))
                        .foregroundStyle(PennyColor.tintText)
                }
                .listRowBackground(PennyColor.secondarySurface)
                .accessibilityIdentifier("householdStart.scan")
            } header: {
                Text("Invite code").cardSectionHeader()
            } footer: {
                Text(
                    joinsTrip
                        ? "Codes last 10 minutes and work for everyone they're shared with. Your ledger currency must "
                            + "match the trip's. Expenses added before you join keep the people they were split with."
                        : "Codes last 10 minutes and work for everyone they're shared with. Your ledger currency must "
                            + "match the household's. You only share expenses dated from the day you join.")
            }
        }
    }

    /// Join household, pinned to the bottom of the sheet as on the card.
    private var joinButton: some View {
        PinnedSheetButton(
            title: working ? "Joining…" : joinsTrip ? "Join trip" : "Join household", working: working,
            enabled: !working && InviteCode(typed: codeText) != nil, background: PennyColor.surface
        ) {
            Task { await join() }
        }
        .accessibilityIdentifier("householdStart.joinButton")
    }

    private func readLink() {
        guard case .join(let code, let server) = start, code != nil || server != nil else { return }
        do {
            use(try InviteLink(code: code, server: server, allowsLoopbackHTTP: allowsLoopbackHTTP))
        } catch {
            linkProblem = error
        }
    }

    private func use(_ link: InviteLink) {
        linkProblem = nil
        failure = nil
        codeText = link.code.grouped
        switch link.target(current: currentServer) {
        case .current: otherServer = nil
        case .other(let server): otherServer = server
        }
    }

    private func join() async {
        guard let code = InviteCode(typed: codeText), !working else { return }
        working = true
        defer { working = false }
        failure = nil
        switch await shell.households.join(code) {
        case .success(let household):
            opened(household)
        case .failure(let refused):
            failure = refused
        }
    }

    /// Created or joined: show the household, and refresh Home's shared shares.
    private func opened(_ household: WireHousehold) {
        dismiss()
        if let onOpened {
            onOpened(household)
            Task { await shell.refreshShared() }
            return
        }
        shell.navigate { route in
            route.householdStart = nil
            route.open(.household(id: household.id))
        }
        Task { await shell.refreshShared() }
    }

    static func message(_ problem: InviteLink.Invalid) -> String {
        switch problem {
        case .invalidCode:
            "The link doesn't have a valid 10-character code. Ask for a new invite, or type the code."
        case .invalidServer:
            "The link names a server Penny can't use. Ask for a new invite, or type the code."
        case .insecureServer:
            "The link names a server without HTTPS, so Penny won't connect to it. Ask for a new invite."
        }
    }
}

/// A button title with a spinner while its action runs.
struct ProgressLabel: View {
    let title: String
    let working: Bool

    var body: some View {
        HStack {
            Text(title).font(.body.weight(.semibold))
            if working {
                Spacer()
                ProgressView()
            }
        }
    }
}

extension View {
    /// An invite code field: upper-case letters, no autocorrection.
    func codeEntry() -> some View {
        #if os(iOS)
            textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
                .keyboardType(.asciiCapable)
        #else
            autocorrectionDisabled()
        #endif
    }
}

/// The copper capsule pinned to the bottom of a sheet: Create household, Join household.
struct PinnedSheetButton: View {
    let title: String
    let working: Bool
    let enabled: Bool
    var background: Color = PennyColor.background
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Text(title)
                if working { ProgressView().tint(.white) }
            }
            .font(.body.weight(.semibold))
            .frame(maxWidth: .infinity, minHeight: ControlSize.button)
            .foregroundStyle(.white)
            .background(PennyColor.tint, in: Capsule())
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.45)
        .padding(.horizontal, Metrics.gutter)
        .padding(.vertical, 8)
        .background(background)
    }
}
