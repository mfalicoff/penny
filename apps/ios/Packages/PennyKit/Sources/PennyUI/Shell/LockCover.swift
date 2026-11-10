import PennyData
import PennyDesign
import SwiftUI

#if os(iOS)
    import UIKit
#endif

/// The lock screen (`lock` card). Opaque: nothing of the app shows through, and no amount is
/// drawn on it. The app underneath stays mounted, so drafts survive.
struct LockScreen: View {
    let lock: AppLockController

    var body: some View {
        let name = lock.biometry == .none ? "Face ID" : lock.biometry.name
        VStack(spacing: 18) {
            Spacer()
            PennyMark(size: 64)
            VStack(spacing: 6) {
                Text(title).font(.title2.weight(.bold)).foregroundStyle(PennyColor.label)
                Text(subtitle(name)).font(.body).foregroundStyle(PennyColor.secondaryLabel)
                    .multilineTextAlignment(.center)
            }
            if let message = lock.message, lock.status != .loading {
                Text(message).font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
                    .multilineTextAlignment(.center)
                    .accessibilityIdentifier("lock.message")
            }
            Spacer()
            Group {
                switch lock.status {
                case .loading:
                    ProgressView().accessibilityLabel("Opening Penny")
                case .unreadable:
                    PennyButton("Try again", systemImage: "arrow.clockwise") { Task { await lock.start() } }
                        .accessibilityIdentifier("lock.retry")
                case .locked, .unlocked:
                    PennyButton("Unlock with \(name)", systemImage: "lock.open") { Task { await lock.unlock() } }
                        .disabled(lock.isBusy)
                        .accessibilityIdentifier("lock.unlock")
                }
            }
            .padding(.bottom, 24)
        }
        .padding(.horizontal, 32)
        .frame(maxWidth: 480)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(PennyColor.background.ignoresSafeArea())
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("screen.lock")
    }

    private var title: String {
        lock.status == .unreadable ? "Penny can't open yet" : "Penny is locked"
    }

    private func subtitle(_ name: String) -> String {
        switch lock.status {
        case .loading: "Checking your lock setting…"
        case .unreadable: "Penny stays locked until it can read its lock setting."
        case .locked, .unlocked: "Use \(name) to see your money."
        }
    }
}

/// Covers the whole app, sheets and alerts included, while the lock conceals it.
///
/// On iOS the cover is its own window above the app's windows, because a view inside the app
/// can't draw over a presented sheet. The focused field is resigned (its text stays), so
/// typing can't reach a hidden draft. Elsewhere (the macOS host for tests), an overlay.
struct LockCover: ViewModifier {
    let lock: AppLockController

    func body(content: Content) -> some View {
        content
            .overlay {
                if lock.conceals { LockScreen(lock: lock).transition(.identity) }
            }
            #if os(iOS)
                .background(CoverWindow(isPresented: lock.conceals) { LockScreen(lock: lock) })
            #endif
            .accessibilityHidden(lock.conceals)
    }
}

#if os(iOS)
    /// Presents `cover` in a window above everything in this scene while `isPresented`.
    private struct CoverWindow<Cover: View>: UIViewRepresentable {
        let isPresented: Bool
        @ViewBuilder let cover: () -> Cover

        func makeCoordinator() -> Coordinator { Coordinator() }

        func makeUIView(context: Context) -> ProbeView {
            let view = ProbeView()
            view.onWindow = { [weak coordinator = context.coordinator] scene in
                coordinator?.scene = scene
                coordinator?.update()
            }
            return view
        }

        func updateUIView(_ view: ProbeView, context: Context) {
            context.coordinator.isPresented = isPresented
            context.coordinator.content = AnyView(cover())
            context.coordinator.update()
        }

        static func dismantleUIView(_ view: ProbeView, coordinator: Coordinator) {
            coordinator.isPresented = false
            coordinator.update()
        }

        @MainActor
        final class Coordinator {
            weak var scene: UIWindowScene?
            var isPresented = false
            var content = AnyView(EmptyView())
            private var window: UIWindow?

            func update() {
                guard isPresented, let scene else {
                    window?.isHidden = true
                    window = nil
                    return
                }
                if let window {
                    (window.rootViewController as? UIHostingController<AnyView>)?.rootView = content
                    return
                }
                UIApplication.shared.sendAction(
                    #selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
                let window = UIWindow(windowScene: scene)
                window.windowLevel = .alert + 1
                let host = UIHostingController(rootView: content)
                host.view.backgroundColor = .clear
                window.rootViewController = host
                window.isHidden = false
                self.window = window
            }
        }

        final class ProbeView: UIView {
            var onWindow: ((UIWindowScene?) -> Void)?

            override func didMoveToWindow() {
                super.didMoveToWindow()
                onWindow?(window?.windowScene)
            }
        }
    }
#endif
