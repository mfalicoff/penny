import PennyDomain
import Testing

@Suite("Server URL")
struct ServerURLTests {
    @Test(
        "whenValidAddress_ServerURL_ShouldNormalizeLikeTheLegacyApp",
        arguments: [
            ("https://penny.example.com", "https://penny.example.com"),
            ("  https://Penny.Example.com/  ", "https://penny.example.com"),
            ("HTTPS://penny.example.com:443//", "https://penny.example.com"),
            ("http://localhost:3001", "http://localhost:3001"),
            ("http://127.0.0.1:80/", "http://127.0.0.1"),
            ("https://example.com/penny/", "https://example.com/penny"),
        ])
    func normalizes(input: String, expected: String) throws {
        #expect(try ServerURL(input).description == expected)
    }

    @Test(
        "whenNotAbsolute_ServerURL_ShouldThrowNotAbsolute",
        arguments: ["", "penny.example.com", "/api", "https://"])
    func notAbsolute(input: String) {
        #expect(throws: ServerURL.Invalid.notAbsolute) { try ServerURL(input) }
    }

    @Test(
        "whenCredentialsQueryFragmentOrOtherScheme_ServerURL_ShouldThrowUnsupported",
        arguments: [
            "ftp://penny.example.com",
            "https://user:secret@penny.example.com",
            "https://penny.example.com/?token=1",
            "https://penny.example.com/#top",
            "penny://penny.example.com",
        ])
    func unsupported(input: String) {
        #expect(throws: ServerURL.Invalid.unsupported) { try ServerURL(input) }
    }
}
