import Foundation
import LocalAuthentication
import Security

public enum KSBiometricError: Error, LocalizedError, Sendable {
    case unavailable(String)
    case authenticationFailed(String)
    case keychainError(OSStatus)
    case invalidKeyData

    public var errorDescription: String? {
        switch self {
        case .unavailable(let msg): return msg
        case .authenticationFailed(let msg): return msg
        case .keychainError(let status):
            if let msg = SecCopyErrorMessageString(status, nil) as String? {
                return "\(msg) (\(status))"
            }
            return "Keychain error (\(status))"
        case .invalidKeyData:
            return "Invalid biometric unlock key length"
        }
    }
}

/// Manages hardware-bound biometric unlock key storage in Apple Data Protection Keychain.
/// Falls back gracefully to Application Support / non-access-group Keychain on unsigned Simulators (-34018).
public final class AppleBiometricKeyStore: @unchecked Sendable {
    public static let shared = AppleBiometricKeyStore()

    private let service = AppConfig.keychainService
    private let fallbackLock = NSLock()

    public init() {}

    public func isAvailable() -> Bool {
        let context = LAContext()
        var error: NSError?
        return context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error)
    }

    public func currentBiometryKind() -> KSBiometryKind {
        let context = LAContext()
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) else {
            return .passcode
        }
        switch context.biometryType {
        case .faceID:
            return .faceID
        case .touchID:
            return .touchID
        case .opticID:
            return .opticID
        case .none:
            return .passcode
        @unknown default:
            return .passcode
        }
    }

    public func saveUnlockKey(accountId: String, key: Data) throws {
        guard !key.isEmpty else {
            throw KSBiometricError.invalidKeyData
        }

        // Remove any prior item first so ACL updates cleanly.
        try? deleteUnlockKey(accountId: accountId)

        var query = baseKeychainQuery(accountId: accountId)
        query[kSecValueData as String] = key

        var cfError: Unmanaged<CFError>?
        if let accessControl = SecAccessControlCreateWithFlags(
            kCFAllocatorDefault,
            kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
            [.biometryCurrentSet],
            &cfError
        ) {
            query[kSecAttrAccessControl as String] = accessControl
        } else {
            query[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        }

        var status = SecItemAdd(query as CFDictionary, nil)
        if status == errSecMissingEntitlement, query[kSecAttrAccessGroup as String] != nil {
            // Retry without shared Access Group first so private hardware Keychain + BiometryCurrentSet still works on Personal Team devices.
            query.removeValue(forKey: kSecAttrAccessGroup as String)
            SecItemDelete([
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: service,
                kSecAttrAccount as String: accountId,
            ] as CFDictionary)
            status = SecItemAdd(query as CFDictionary, nil)
        }
        #if targetEnvironment(simulator)
        if status == errSecMissingEntitlement {
            // Unsigned Simulator (-34018): retry without Access Group / AccessControl ACL.
            var simQuery: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: service,
                kSecAttrAccount as String: accountId,
                kSecValueData as String: key,
                kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
            ]
            SecItemDelete(simQuery as CFDictionary)
            simQuery[kSecValueData as String] = key
            status = SecItemAdd(simQuery as CFDictionary, nil)
            if status == errSecMissingEntitlement {
                saveSimulatorFallbackKey(accountId: accountId, key: key)
                return
            }
        }
        #endif

        guard status == errSecSuccess else {
            throw KSBiometricError.keychainError(status)
        }
    }

    public func loadUnlockKey(accountId: String, reason: String) throws -> Data {
        let context = LAContext()
        context.localizedReason = reason
        context.localizedFallbackTitle = ""

        var query = baseKeychainQuery(accountId: accountId)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        query[kSecUseAuthenticationContext as String] = context

        var result: CFTypeRef?
        var status = SecItemCopyMatching(query as CFDictionary, &result)
        if (status == errSecMissingEntitlement || status == errSecItemNotFound),
           query[kSecAttrAccessGroup as String] != nil {
            query.removeValue(forKey: kSecAttrAccessGroup as String)
            status = SecItemCopyMatching(query as CFDictionary, &result)
        }
        #if targetEnvironment(simulator)
        if status == errSecMissingEntitlement || status == errSecItemNotFound {
            try verifyUserSync(context: context, reason: reason)
            let simQuery: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: service,
                kSecAttrAccount as String: accountId,
                kSecReturnData as String: true,
                kSecMatchLimit as String: kSecMatchLimitOne,
            ]
            status = SecItemCopyMatching(simQuery as CFDictionary, &result)
            if status == errSecMissingEntitlement || status == errSecItemNotFound {
                if let fallback = loadSimulatorFallbackKey(accountId: accountId) {
                    return fallback
                }
            }
        }
        #endif

        if status == errSecUserCanceled {
            throw KSBiometricError.authenticationFailed("Biometric verification cancelled")
        }
        if status == errSecAuthFailed {
            throw KSBiometricError.authenticationFailed("Biometric verification failed")
        }
        guard status == errSecSuccess, let data = result as? Data else {
            throw KSBiometricError.keychainError(status)
        }
        return data
    }

    public func deleteUnlockKey(accountId: String) throws {
        let query = baseKeychainQuery(accountId: accountId)
        let status = SecItemDelete(query as CFDictionary)
        let simQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: accountId,
        ]
        SecItemDelete(simQuery as CFDictionary)
        #if targetEnvironment(simulator)
        deleteSimulatorFallbackKey(accountId: accountId)
        #endif

        if status != errSecSuccess && status != errSecItemNotFound && status != errSecMissingEntitlement {
            throw KSBiometricError.keychainError(status)
        }
    }

    public func verifyUser(reason: String) throws {
        let context = LAContext()
        try verifyUserSync(context: context, reason: reason)
    }

    private func verifyUserSync(context: LAContext, reason: String) throws {
        var authError: NSError?
        let policy: LAPolicy = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &authError)
            ? .deviceOwnerAuthenticationWithBiometrics
            : .deviceOwnerAuthentication

        guard context.canEvaluatePolicy(policy, error: &authError) else {
            #if targetEnvironment(simulator)
            // Simulator without enrolled biometrics: allow local test unlock after check.
            return
            #else
            throw KSBiometricError.unavailable(authError?.localizedDescription ?? "Biometrics unavailable")
            #endif
        }

        let semaphore = DispatchSemaphore(value: 0)
        nonisolated(unsafe) var evalSuccess = false
        nonisolated(unsafe) var evalErrorMessage: String?

        context.evaluatePolicy(policy, localizedReason: reason) { success, error in
            evalSuccess = success
            evalErrorMessage = error?.localizedDescription
            semaphore.signal()
        }
        semaphore.wait()

        if !evalSuccess {
            throw KSBiometricError.authenticationFailed(evalErrorMessage ?? "Biometric verification cancelled")
        }
    }

    private func baseKeychainQuery(accountId: String) -> [String: Any] {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: accountId,
        ]
        if let group = AppConfig.resolvedKeychainAccessGroup() {
            query[kSecAttrAccessGroup as String] = group
        }
        return query
    }

    #if targetEnvironment(simulator)
    // MARK: - Unsigned Simulator Fallback (-34018)

    private func fallbackURL(accountId: String) -> URL {
        let safeId = accountId.replacingOccurrences(of: "/", with: "_")
        return AppConfig.sharedContainerDirectory().appendingPathComponent(".sim_bio_\(safeId).bin")
    }

    private func saveSimulatorFallbackKey(accountId: String, key: Data) {
        fallbackLock.lock()
        defer { fallbackLock.unlock() }
        let url = fallbackURL(accountId: accountId)
        try? key.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    private func loadSimulatorFallbackKey(accountId: String) -> Data? {
        fallbackLock.lock()
        defer { fallbackLock.unlock() }
        return try? Data(contentsOf: fallbackURL(accountId: accountId))
    }

    private func deleteSimulatorFallbackKey(accountId: String) {
        fallbackLock.lock()
        defer { fallbackLock.unlock() }
        try? FileManager.default.removeItem(at: fallbackURL(accountId: accountId))
    }
    #endif
}
