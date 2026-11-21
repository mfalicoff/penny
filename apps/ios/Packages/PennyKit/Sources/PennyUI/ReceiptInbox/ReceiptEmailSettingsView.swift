import Foundation
import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

#if os(iOS)
    import UIKit
#endif

/// Settings › Receipt email (`receipt-email-settings` card): the private address in a
/// monospaced field with Copy and Share, its expiry with Extend, New address and Turn off (each
/// confirmed), the allowed senders, and how to use it. Creates the address when there is none.
struct ReceiptEmailSettingsView: View {
    @Environment(ShellModel.self) private var shell
    @State private var problem: String?
    @State private var copied = false
    @State private var confirm: Confirm?
    @State private var newSender = ""
    @State private var senderInvalid = false

    enum Confirm: String, Identifiable {
        case rotate, turnOff
        var id: String { rawValue }
    }

    var body: some View {
        let inbox = shell.receiptInbox
        Group {
            if !inbox.isSupported {
                PennyStateView(
                    .unavailable, title: "No receipt email in the demo",
                    message: "Emailed receipts are kept on your server. Sign in to get a receipt address.")
            } else if inbox.email == nil {
                switch inbox.emailLoad {
                case .failed(let message):
                    PennyStateView(
                        .error, title: "Couldn't load your receipt email", message: message, actionTitle: "Try again"
                    ) {
                        Task { await inbox.refreshEmail() }
                    }
                default:
                    if inbox.isAvailable {
                        PennyStateView(.loading, title: "Loading your receipt email…")
                    } else {
                        PennyStateView(.offline, title: "You're offline", message: InboxText.offline)
                    }
                }
            } else if !inbox.isEnabled {
                PennyStateView(
                    .unavailable, title: "Emailed receipts are off",
                    message: "This server doesn't accept emailed receipts.")
            } else {
                form(inbox)
            }
        }
        .background(PennyColor.background)
        .navigationTitle("Receipt email")
        .task { await inbox.refreshEmail() }
        .accessibilityIdentifier("screen.receiptEmail")
    }

    private func form(_ inbox: ReceiptInboxModel) -> some View {
        List {
            if !inbox.isAvailable {
                Section { StatusBanner(tone: .offline, title: "You're offline", message: InboxText.offline) }
            }
            if let problem {
                Section {
                    StatusBanner(tone: .error, title: "Something went wrong", message: problem)
                        .accessibilityIdentifier("receiptEmail.error")
                }
            }
            if let address = inbox.address {
                addressSection(address, inbox)
                sendersSection(address, inbox)
                Section {
                    Button("New address") { confirm = .rotate }
                        .disabled(!inbox.isAvailable || inbox.isWorking)
                        .frame(minHeight: Metrics.minTouchTarget)
                        .accessibilityIdentifier("receiptEmail.rotate")
                    Button("Turn off", role: .destructive) { confirm = .turnOff }
                        .disabled(!inbox.isAvailable || inbox.isWorking)
                        .frame(minHeight: Metrics.minTouchTarget)
                        .accessibilityIdentifier("receiptEmail.turnOff")
                }
            } else {
                Section {
                    Text(
                        "Get a private address to send receipts to. Penny turns each email into a receipt you can attach to an expense."
                    )
                    PennyButton("Get a receipt address", systemImage: "envelope") {
                        act { await inbox.createAddress() }
                    }
                    .disabled(!inbox.isAvailable || inbox.isWorking)
                    .accessibilityIdentifier("receiptEmail.create")
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                }
            }
            CardSection("How it works") {
                Text(
                    "Forward a receipt email to this address, or send a photo of a paper receipt to it. It shows up in Receipts to attach within a minute."
                )
                .accessibilityIdentifier("receiptEmail.howTo")
                if inbox.address != nil || inbox.toAttachCount > 0 {
                    NavigationLink(value: SettingsRoute.receiptInbox) {
                        Text("Receipts to attach")
                    }
                    .disabled(!inbox.isAvailable)
                }
            }
        }
        .insetGroupedList()
        .confirmationDialog(
            confirm == .rotate ? "Make a new address?" : "Turn off your receipt address?",
            isPresented: Binding(get: { confirm != nil }, set: { if !$0 { confirm = nil } }),
            titleVisibility: .visible, presenting: confirm
        ) { kind in
            switch kind {
            case .rotate:
                Button("New address") { act { await inbox.createAddress() } }
                    .accessibilityIdentifier("receiptEmail.confirmRotate")
            case .turnOff:
                Button("Turn off", role: .destructive) { act { await inbox.turnOff() } }
                    .accessibilityIdentifier("receiptEmail.confirmTurnOff")
            }
            Button("Cancel", role: .cancel) {}
        } message: { kind in
            switch kind {
            case .rotate: Text("Your current address stops working right away.")
            case .turnOff: Text("Mail sent to this address will be refused. Receipts already in your inbox stay there.")
            }
        }
    }

    private func addressSection(_ address: WireReceiptEmailAddress, _ inbox: ReceiptInboxModel) -> some View {
        Section {
            Text(verbatim: address.address)
                .font(.body.monospaced())
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.vertical, 4)
                .accessibilityLabel("Receipt address, \(address.address)")
                .accessibilityIdentifier("receiptEmail.address")
            HStack(spacing: 0) {
                Button {
                    copy(address.address)
                } label: {
                    Label(copied ? "Copied" : "Copy", systemImage: copied ? "checkmark" : "doc.on.doc")
                        .frame(maxWidth: .infinity, minHeight: Metrics.minTouchTarget)
                }
                .accessibilityLabel(copied ? "Copied" : "Copy address")
                .accessibilityIdentifier("receiptEmail.copy")
                Divider()
                ShareLink(item: address.address, subject: Text("Penny receipt address")) {
                    Label("Share", systemImage: "square.and.arrow.up")
                        .frame(maxWidth: .infinity, minHeight: Metrics.minTouchTarget)
                }
                .accessibilityLabel("Share address")
                .accessibilityIdentifier("receiptEmail.share")
            }
            .buttonStyle(.borderless)
            .font(.body.weight(.semibold))
            .foregroundStyle(PennyColor.tintText)
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Works until").foregroundStyle(PennyColor.secondaryLabel).font(.subheadline)
                    Text(Date(milliseconds: address.expiresAt).formatted(date: .long, time: .omitted))
                }
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("receiptEmail.expiry")
                Spacer()
                Button("Extend") { act { await inbox.extend() } }
                    .buttonStyle(.bordered)
                    .frame(minHeight: Metrics.minTouchTarget)
                    .disabled(!inbox.isAvailable || inbox.isWorking)
                    .accessibilityHint("Keeps this address working for longer")
                    .accessibilityIdentifier("receiptEmail.extend")
            }
        } header: {
            Text("Your receipt address").cardSectionHeader()
        } footer: {
            Text("Anyone with this address can send you receipts. Nothing is attached until you choose to.")
        }
    }

    private func sendersSection(_ address: WireReceiptEmailAddress, _ inbox: ReceiptInboxModel) -> some View {
        Section {
            if address.allowedSenders.isEmpty {
                Text("Any sender").foregroundStyle(PennyColor.secondaryLabel)
            }
            ForEach(address.allowedSenders, id: \.self) { sender in
                Text(verbatim: sender)
                    .accessibilityIdentifier("receiptEmail.sender")
            }
            .onDelete { offsets in
                var next = address.allowedSenders
                next.remove(atOffsets: offsets)
                act { await inbox.setAllowedSenders(next) }
            }
            .deleteDisabled(!inbox.isAvailable)
            HStack {
                TextField("name@example.com or example.com", text: $newSender)
                    .textContentType(.emailAddress)
                    .autocorrectionDisabled()
                    #if os(iOS)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.emailAddress)
                    #endif
                    .onSubmit(addSender)
                    .accessibilityLabel("Allowed sender")
                    .accessibilityIdentifier("receiptEmail.senderField")
                Button("Add", action: addSender)
                    .disabled(newSender.isEmpty || !inbox.isAvailable || inbox.isWorking)
                    .frame(minHeight: Metrics.minTouchTarget)
                    .accessibilityIdentifier("receiptEmail.addSender")
            }
        } header: {
            Text("Allowed senders").cardSectionHeader()
        } footer: {
            VStack(alignment: .leading, spacing: 4) {
                if senderInvalid { Text("Enter an email address or a domain.").foregroundStyle(PennyColor.danger) }
                Text(
                    "Only email that passes sender verification from these addresses reaches your inbox. If you forward receipts, add the address you forward from."
                )
            }
        }
    }

    private func addSender() {
        guard let inbox = Optional(shell.receiptInbox), let address = inbox.address else { return }
        guard let sender = ReceiptInboxModel.normalizedSender(newSender) else {
            senderInvalid = true
            return
        }
        senderInvalid = false
        newSender = ""
        act { await inbox.setAllowedSenders(address.allowedSenders + [sender]) }
    }

    private func act(_ action: @escaping @MainActor () async -> String?) {
        Task {
            problem = await action()
            copied = false
        }
    }

    private func copy(_ text: String) {
        #if os(iOS)
            UIPasteboard.general.string = text
        #endif
        copied = true
    }
}
