import AppIntents
import Foundation

/// Launches Keysmith directly into global vault search (`keysmith://search`).
struct QuickSearchIntent: AppIntent {
    static let title: LocalizedStringResource = "Quick Search"
    static let description = IntentDescription("Open Keysmith and focus global vault search.")
    static let openAppWhenRun: Bool = true

    func perform() async throws -> some IntentResult {
        guard let url = URL(string: "keysmith://search") else {
            return .result()
        }
        return .result(opensIntent: OpenURLIntent(url))
    }
}

/// Launches Keysmith directly into the TOTP QR code scanner (`keysmith://scan-totp`).
struct ScanTotpIntent: AppIntent {
    static let title: LocalizedStringResource = "Scan 2FA QR"
    static let description = IntentDescription("Open Keysmith camera or photo picker to scan a TOTP QR code.")
    static let openAppWhenRun: Bool = true

    func perform() async throws -> some IntentResult {
        guard let url = URL(string: "keysmith://scan-totp") else {
            return .result()
        }
        return .result(opensIntent: OpenURLIntent(url))
    }
}

/// Triggers an immediate vault lock via Keysmith (`keysmith://lock`).
struct LockVaultIntent: AppIntent {
    static let title: LocalizedStringResource = "Lock Vault Now"
    static let description = IntentDescription("Immediately lock Keysmith and wipe decrypted keys from memory.")
    static let openAppWhenRun: Bool = true

    func perform() async throws -> some IntentResult {
        guard let url = URL(string: "keysmith://lock") else {
            return .result()
        }
        return .result(opensIntent: OpenURLIntent(url))
    }
}
