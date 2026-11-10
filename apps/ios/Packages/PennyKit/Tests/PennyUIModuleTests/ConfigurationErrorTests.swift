import PennyData
import Testing

@testable import PennyUI

@Suite("Configuration error")
struct ConfigurationErrorTests {
    @Test("whenConfigurationInvalid_ConfigurationErrorView_ShouldNameTheSettingAndNextStep")
    func message() {
        let missing = ConfigurationErrorView.message(for: .missing("PennyAppGroup"))
        #expect(missing.contains("PennyAppGroup"))
        #expect(missing.contains("Rebuild"))
        #expect(
            ConfigurationErrorView.message(for: .invalidValue("PennyEnvironment")).contains("invalid PennyEnvironment"))
    }
}
