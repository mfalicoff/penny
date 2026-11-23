import PennyAccessibility
import XCTest

extension Penny {
    /// Taps an action that is a toolbar button on some cards and inside the … menu on others
    /// (MAZ-256: a household's History, Invite and Trip expense; Leave and Archive are always in
    /// the menu on iPhone and under People on the iPad household).
    func tap(_ id: String, orIn menu: String, timeout: TimeInterval = Penny.timeout) throws {
        let direct = element(id)
        if direct.waitForExistence(timeout: 2), direct.isHittable {
            direct.tap()
            return
        }
        let more = element(menu)
        if more.waitForExistence(timeout: 2), more.isHittable {
            more.tap()
        }
        try tap(id, timeout: timeout)
    }

    /// `tap(_:orIn:)`, then waits for the screen it opens.
    func tap(_ id: String, orIn menu: String, opening screen: String, timeout: TimeInterval = Penny.timeout) throws {
        try tap(id, orIn: menu, timeout: timeout)
        try wait(for: screen, timeout: timeout)
    }
}
