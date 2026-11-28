import Foundation

public enum AppConfig {
    public static let appBundleID = "dev.keysmith.app"
    public static let autofillBundleID = "dev.keysmith.app.autofill"
    public static let controlsBundleID = "dev.keysmith.app.controls"

    public static let appGroupID = "group.dev.keysmith.app"
    public static let keychainAccessGroup = "dev.keysmith.shared"
    public static let keychainService = "dev.keysmith.biometric.unlock"
    public static let urlScheme = "keysmith"
    public static let appVersion = "0.1.4"

    public static func userAgent(isExtension: Bool) -> String {
        #if os(iOS)
        let platform = isExtension ? "iOS-AutoFill" : "iOS"
        return "Keysmith/\(appVersion) (\(platform); SwiftUI)"
        #else
        return "Keysmith/\(appVersion) (Apple; SwiftUI)"
        #endif
    }

    public static func resolvedKeychainAccessGroup() -> String? {
        #if KEYSMITH_PERSONAL_BUILD
        return nil
        #else
        if let prefix = Bundle.main.infoDictionary?["AppIdentifierPrefix"] as? String, !prefix.isEmpty {
            return "\(prefix)\(keychainAccessGroup)"
        }
        return nil
        #endif
    }

    public static func sharedContainerDirectory() -> URL {
        let fm = FileManager.default
        if let groupURL = fm.containerURL(forSecurityApplicationGroupIdentifier: appGroupID) {
            let dir = groupURL.appendingPathComponent("Keysmith", isDirectory: true)
            ensureProtectedDirectory(dir)
            return dir
        }
        // Unsigned Simulator fallback when App Group entitlement container is nil.
        let appSupport = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? fm.temporaryDirectory
        let dir = appSupport.appendingPathComponent("dev.keysmith.app", isDirectory: true)
        ensureProtectedDirectory(dir)
        return dir
    }

    public static func databaseURL() -> URL {
        let dir = sharedContainerDirectory()
        let dbURL = dir.appendingPathComponent("keysmith.db", isDirectory: false)
        excludeFromBackup(dbURL)
        return dbURL
    }

    private static func ensureProtectedDirectory(_ url: URL) {
        let fm = FileManager.default
        if !fm.fileExists(atPath: url.path) {
            try? fm.createDirectory(
                at: url,
                withIntermediateDirectories: true,
                attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]
            )
        }
        excludeFromBackup(url)
    }

    private static func excludeFromBackup(_ url: URL) {
        var mutableURL = url
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? mutableURL.setResourceValues(values)
    }
}

public enum KSDeepLink: Sendable, Equatable {
    case search
    case scanTotp
    case lock
    case settings
    case item(String)

    public init?(url: URL) {
        guard url.scheme?.lowercased() == AppConfig.urlScheme else {
            return nil
        }
        let host = (url.host ?? "").lowercased()
        let pathParts = url.pathComponents.filter { $0 != "/" }
        switch host {
        case "search":
            self = .search
        case "scan-totp", "scantotp", "totp-scan":
            self = .scanTotp
        case "lock":
            self = .lock
        case "settings":
            self = .settings
        case "item":
            if let id = pathParts.first, !id.isEmpty {
                self = .item(id)
            } else {
                return nil
            }
        default:
            switch pathParts.first?.lowercased() {
            case "search":
                self = .search
            case "scan-totp":
                self = .scanTotp
            case "lock":
                self = .lock
            case "settings":
                self = .settings
            default:
                return nil
            }
        }
    }
}
