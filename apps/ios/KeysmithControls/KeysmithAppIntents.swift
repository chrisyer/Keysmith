import AppIntents
import Foundation

/// Launches Keysmith directly into global vault search (`keysmith://search`).
struct QuickSearchIntent: AppIntent {
    static let title: LocalizedStringResource = "快速搜索"
    static let description = IntentDescription("打开 Keysmith 并聚焦全局搜索")
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
    static let title: LocalizedStringResource = "扫一扫导入 2FA"
    static let description = IntentDescription("打开 Keysmith 相机或相册扫描 TOTP 二维码")
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
    static let title: LocalizedStringResource = "立即锁定保险库"
    static let description = IntentDescription("立即锁定 Keysmith 保险库并擦除内存密钥")
    static let openAppWhenRun: Bool = true

    func perform() async throws -> some IntentResult {
        guard let url = URL(string: "keysmith://lock") else {
            return .result()
        }
        return .result(opensIntent: OpenURLIntent(url))
    }
}
