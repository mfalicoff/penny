public import PennyData
import PennyDesign
public import PennyDomain
public import SwiftUI

/// The app's root. A placeholder for the MAZ-69 shell (tab bar on iPhone, split view on
/// iPad); it already owns deep-link handling so the shell only has to present `link`.
public struct RootView: View {
    private let configuration: Result<AppConfiguration, AppConfiguration.Invalid>
    @State private var link: DeepLink?

    public init(configuration: Result<AppConfiguration, AppConfiguration.Invalid>) {
        self.configuration = configuration
    }

    public var body: some View {
        Group {
            switch configuration {
            case .success(let configuration): LaunchView(configuration: configuration, link: link)
            case .failure(let error): ConfigurationErrorView(error: error)
            }
        }
        .tint(PennyColor.tint)
        .onOpenURL { url in link = DeepLink(url: url) ?? .home }
    }
}

struct LaunchView: View {
    let configuration: AppConfiguration
    let link: DeepLink?

    var body: some View {
        VStack(spacing: Metrics.gutter) {
            Image(systemName: "leaf")
                .font(.system(size: 34, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 64, height: 64)
                .background(PennyColor.tint, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                .accessibilityHidden(true)
            Text("penny.")
                .font(PennyFont.style(.largeTitle))
                .foregroundStyle(PennyColor.label)
                .accessibilityAddTraits(.isHeader)
            Text("The native app is being built.")
                .font(PennyFont.style(.subhead))
                .foregroundStyle(PennyColor.secondaryLabel)
            if let link {
                Text(String(describing: link))
                    .font(PennyFont.style(.footnote))
                    .foregroundStyle(PennyColor.tertiaryLabel)
                    .accessibilityIdentifier("root.deepLink")
            }
        }
        .padding(Metrics.gutter)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(PennyColor.background)
        .accessibilityIdentifier("root.launch")
    }
}

struct ConfigurationErrorView: View {
    let error: AppConfiguration.Invalid

    var body: some View {
        ContentUnavailableView {
            Label("Penny can't start", systemImage: "exclamationmark.triangle")
        } description: {
            Text(Self.message(for: error))
        }
        .accessibilityIdentifier("root.configurationError")
    }

    static func message(for error: AppConfiguration.Invalid) -> String {
        switch error {
        case .missing(let key): "This build is missing the \(key) setting. Rebuild it from apps/ios."
        case .invalidValue(let key): "This build has an invalid \(key) setting. Rebuild it from apps/ios."
        }
    }
}

#Preview("Launch") {
    RootView(
        configuration: .success(
            AppConfiguration(environment: .development, defaultServerURL: nil, appGroup: AppIdentity.appGroup)))
}

#Preview("Configuration error") {
    RootView(configuration: .failure(.missing(AppConfiguration.Key.appGroup)))
}
