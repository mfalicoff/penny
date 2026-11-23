import Foundation
import PennyData
import PennyDesign
import SwiftUI

/// The privacy policy links (MAZ-169). Each opens the server's own policy in the browser; none
/// shows when the server publishes no policy. VoiceOver reads a link named "Privacy Policy".
enum PrivacyPolicyText {
    static let title = "Privacy Policy"

    /// "By creating an account you agree to the Privacy Policy." with the policy as a link.
    static func agreement(_ url: URL) -> AttributedString {
        var text = AttributedString("By creating an account you agree to the ")
        text.foregroundColor = PennyColor.secondaryLabel
        text.append(link(url, color: PennyColor.label, underline: true))
        var stop = AttributedString(".")
        stop.foregroundColor = PennyColor.secondaryLabel
        text.append(stop)
        return text
    }

    /// "Your account lives on penny.example.com. Privacy Policy" (the profile cards' footer).
    static func footer(host: String, policy: URL?) -> AttributedString {
        var text = AttributedString("Your account lives on \(host).")
        text.foregroundColor = PennyColor.secondaryLabel
        if let policy {
            text.append(AttributedString(" "))
            text.append(link(policy, color: PennyColor.tintText, underline: false))
        }
        return text
    }

    private static func link(_ url: URL, color: Color, underline: Bool) -> AttributedString {
        var link = AttributedString(title)
        link.link = url
        link.foregroundColor = color
        link.inlinePresentationIntent = .stronglyEmphasized
        if underline { link.underlineStyle = .single }
        return link
    }
}

/// Sign-in's "Privacy Policy" link, under the sample-data link (`iphone-sign-in` card).
struct PrivacyPolicyLink: View {
    let url: URL

    var body: some View {
        Link(destination: url) {
            Text(PrivacyPolicyText.title)
                .font(.footnote.weight(.semibold))
                .underline()
                .foregroundStyle(PennyColor.label)
                .frame(minHeight: Metrics.minTouchTarget)
        }
        .accessibilityHint("Opens in your browser")
        .accessibilityIdentifier("legal.privacyPolicy")
    }
}
