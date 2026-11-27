import CryptoKit
import Foundation

/// Swift 6 actor wrapping `KeysmithCoreHandle` (UniFFI) + JSON DTO encoding/decoding.
/// Safe to instantiate from both `KeysmithApp` (`isExtension: false`) and `KeysmithAutoFill` (`isExtension: true`).
public actor KeysmithCoreAdapter {
    private var handle: KeysmithCoreHandle?
    private let isExtension: Bool
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    public init(isExtension: Bool = false) {
        self.isExtension = isExtension
        self.encoder = JSONEncoder()
        self.decoder = JSONDecoder()
    }

    public func initializeIfNeeded() throws {
        if handle != nil { return }
        let dbPath = AppConfig.databaseURL().path
        let userAgent = AppConfig.userAgent(isExtension: isExtension)
        handle = try KeysmithCoreHandle(
            dbPath: dbPath,
            biometric: FfiBiometricBridge(store: AppleBiometricKeyStore.shared),
            clipboard: FfiClipboardBridge(manager: AppleClipboardManager.shared),
            isExtension: isExtension,
            userAgent: userAgent
        )
    }

    private func requireHandle() throws -> KeysmithCoreHandle {
        if handle == nil {
            try initializeIfNeeded()
        }
        guard let handle else {
            throw KSCoreAdapterError.notInitialized
        }
        return handle
    }

    // MARK: - Auth

    public func authCheckServer(serverUrl: String, allowInsecureHttp: Bool) throws -> KSServerCheckResult {
        let json = try requireHandle().authCheckServerJson(serverUrl: serverUrl, allowInsecureHttp: allowInsecureHttp)
        return try decodeJSON(json)
    }

    public func authPrelogin(serverUrl: String, email: String, allowInsecureHttp: Bool) throws -> KSKdfConfig {
        let json = try requireHandle().authPreloginJson(
            serverUrl: serverUrl,
            email: email,
            allowInsecureHttp: allowInsecureHttp
        )
        return try decodeJSON(json)
    }

    public func authLogin(
        serverUrl: String,
        email: String,
        masterPassword: String,
        twoFactorProvider: UInt8?,
        twoFactorToken: String?,
        twoFactorRemember: Bool,
        allowInsecureHttp: Bool
    ) throws -> KSSessionState {
        let json = try requireHandle().authLoginJson(
            serverUrl: serverUrl,
            email: email,
            masterPassword: masterPassword,
            twoFactorProvider: twoFactorProvider,
            twoFactorToken: twoFactorToken,
            twoFactorRemember: twoFactorRemember,
            allowInsecureHttp: allowInsecureHttp
        )
        return try decodeJSON(json)
    }

    public func authRegister(
        serverUrl: String,
        email: String,
        displayName: String,
        masterPassword: String,
        hint: String?,
        allowInsecureHttp: Bool
    ) throws -> KSSessionState {
        let json = try requireHandle().authRegisterJson(
            serverUrl: serverUrl,
            email: email,
            displayName: displayName,
            masterPassword: masterPassword,
            hint: hint,
            allowInsecureHttp: allowInsecureHttp
        )
        return try decodeJSON(json)
    }

    public func authLogout(clearLocalCache: Bool) throws {
        try requireHandle().authLogout(clearLocalCache: clearLocalCache)
    }

    // MARK: - Account & Session

    public func accountList() throws -> [KSAccountSummary] {
        let json = try requireHandle().accountListJson()
        return try decodeJSON(json)
    }

    public func accountSwitch(accountId: String) throws -> KSSessionState {
        let json = try requireHandle().accountSwitchJson(accountId: accountId)
        return try decodeJSON(json)
    }

    public func accountUpdateProfile(displayName: String) throws -> KSAccountSummary {
        let json = try requireHandle().accountUpdateProfileJson(displayName: displayName)
        return try decodeJSON(json)
    }

    public func sessionGetState() throws -> KSSessionState {
        let json = try requireHandle().sessionGetStateJson()
        return try decodeJSON(json)
    }

    public func sessionUpdatePreferences(_ patch: KSSessionPreferencesPatch) throws -> KSSessionState {
        let patchJSON = try encodeJSON(patch)
        let json = try requireHandle().sessionUpdatePreferencesJson(patchJson: patchJSON)
        return try decodeJSON(json)
    }

    public func sessionUnlockPassword(_ password: String) throws -> KSSessionState {
        let json = try requireHandle().sessionUnlockPasswordJson(password: password)
        return try decodeJSON(json)
    }

    public func sessionUnlockBiometric() throws -> KSSessionState {
        let json = try requireHandle().sessionUnlockBiometricJson()
        return try decodeJSON(json)
    }

    public func sessionVerifyUserPresence(reason: String) throws {
        try requireHandle().sessionVerifyUserPresence(reason: reason)
    }

    public func sessionLock(reason: String) throws {
        try requireHandle().sessionLock(reason: reason)
    }

    public func sessionTouchActivity() throws {
        try requireHandle().sessionTouchActivity()
    }

    public func checkAutoLock() throws -> Bool {
        try requireHandle().checkAutoLock()
    }

    // MARK: - Vaults & Items

    public func vaultList() throws -> [KSVault] {
        let json = try requireHandle().vaultListJson()
        return try decodeJSON(json)
    }

    public func vaultCreate(name: String, icon: String, color: String) throws -> KSVault {
        let json = try requireHandle().vaultCreateJson(name: name, icon: icon, color: color)
        return try decodeJSON(json)
    }

    public func vaultRename(id: String, name: String) throws -> KSVault {
        let json = try requireHandle().vaultRenameJson(id: id, name: name)
        return try decodeJSON(json)
    }

    public func vaultSetTravelSafe(id: String, travelSafe: Bool) throws -> KSVault {
        let json = try requireHandle().vaultSetTravelSafeJson(id: id, travelSafe: travelSafe)
        return try decodeJSON(json)
    }

    public func vaultDelete(id: String) throws {
        try requireHandle().vaultDelete(id: id)
    }

    public func itemList(filter: KSItemFilter = KSItemFilter()) throws -> [KSItemSummary] {
        let filterJSON = try encodeJSON(filter)
        let json = try requireHandle().itemListJson(filterJson: filterJSON)
        return try decodeJSON(json)
    }

    public func itemGet(id: String) throws -> KSItemDetail? {
        let json = try requireHandle().itemGetJson(id: id)
        if json == "null" || json.isEmpty { return nil }
        return try decodeJSON(json)
    }

    public func itemCreate(_ draft: KSItemDraft) throws -> KSItemDetail {
        let draftJSON = try encodeJSON(draft)
        let json = try requireHandle().itemCreateJson(draftJson: draftJSON)
        return try decodeJSON(json)
    }

    public func itemUpdate(id: String, draft: KSItemDraft) throws -> KSItemDetail {
        let draftJSON = try encodeJSON(draft)
        let json = try requireHandle().itemUpdateJson(id: id, draftJson: draftJSON)
        return try decodeJSON(json)
    }

    public func itemToggleFavorite(id: String) throws -> KSItemDetail {
        let json = try requireHandle().itemToggleFavoriteJson(id: id)
        return try decodeJSON(json)
    }

    public func itemTrash(id: String) throws {
        try requireHandle().itemTrash(id: id)
    }

    public func itemRestore(id: String) throws {
        try requireHandle().itemRestore(id: id)
    }

    public func itemDeletePermanent(id: String) throws {
        try requireHandle().itemDeletePermanent(id: id)
    }

    public func itemEmptyTrash() throws -> UInt32 {
        try requireHandle().itemEmptyTrash()
    }

    // MARK: - Sync & Tools

    public func syncGetStatus() throws -> KSSyncStatus {
        let json = try requireHandle().syncGetStatusJson()
        return try decodeJSON(json)
    }

    public func syncNow() throws -> KSSyncStatus {
        let json = try requireHandle().syncNowJson()
        return try decodeJSON(json)
    }

    public func checkAndSyncIfChanged(syncOnUnknown: Bool) throws -> KSSyncStatus {
        let json = try requireHandle().checkAndSyncIfChangedJson(syncOnUnknown: syncOnUnknown)
        return try decodeJSON(json)
    }

    public func totpCompute(secretOrUri: String) throws -> KSTotpCode {
        let json = try requireHandle().totpComputeJson(secretOrUri: secretOrUri)
        return try decodeJSON(json)
    }

    public func totpParseQrImage(data: Data) throws -> String {
        let b64 = data.base64EncodedString()
        return try requireHandle().totpParseQrImage(imageBase64: b64)
    }

    public func generatorGenerate(options: KSGeneratorOptions) throws -> KSGeneratorResult {
        let optsJSON = try encodeJSON(options)
        let json = try requireHandle().generatorGenerateJson(optionsJson: optsJSON)
        return try decodeJSON(json)
    }

    public func generatorHistoryList() throws -> [KSGeneratorHistoryEntry] {
        let json = try requireHandle().generatorHistoryListJson()
        return try decodeJSON(json)
    }

    public func generatorHistoryClear() throws {
        try requireHandle().generatorHistoryClear()
    }

    public func watchtowerScan(checkHibp: Bool) throws -> KSWatchtowerReport {
        let json = try requireHandle().watchtowerScanJson(checkHibp: checkHibp)
        return try decodeJSON(json)
    }

    public func sendList() throws -> [KSSendItem] {
        let json = try requireHandle().sendListJson()
        return try decodeJSON(json)
    }

    public func sendCreateText(_ input: KSSendCreateTextInput) throws -> KSSendItem {
        let inputJSON = try encodeJSON(input)
        let json = try requireHandle().sendCreateTextJson(inputJson: inputJSON)
        return try decodeJSON(json)
    }

    public func sendDelete(id: String) throws {
        try requireHandle().sendDelete(id: id)
    }

    public func vaultExportEmergencyKit() throws -> KSExportResult {
        let json = try requireHandle().vaultExportEmergencyKitJson()
        return try decodeJSON(json)
    }

    public func snapshotList() throws -> [KSLocalSnapshotInfo] {
        let json = try requireHandle().snapshotListJson()
        return try decodeJSON(json)
    }

    public func snapshotCreate() throws -> KSLocalSnapshotInfo {
        let json = try requireHandle().snapshotCreateJson()
        return try decodeJSON(json)
    }

    public func snapshotDelete(id: String) throws {
        try requireHandle().snapshotDelete(id: id)
    }

    public func appSettingsGet() throws -> KSAppSettings {
        let json = try requireHandle().appSettingsGetJson()
        return try decodeJSON(json)
    }

    public func appSettingsUpdate(_ patch: KSAppSettingsPatch) throws -> KSAppSettings {
        let patchJSON = try encodeJSON(patch)
        let json = try requireHandle().appSettingsUpdateJson(patchJson: patchJSON)
        return try decodeJSON(json)
    }

    public func faviconFetch(host: String) throws -> String? {
        try requireHandle().faviconFetch(host: host)
    }

    public func clipboardCopySecret(text: String, label: String, isSensitive: Bool, clearAfterSecs: UInt64) throws {
        try requireHandle().clipboardCopySecret(
            text: text,
            label: label,
            isSensitive: isSensitive,
            clearAfterSecs: clearAfterSecs
        )
    }

    public func clipboardClearNow() throws {
        try requireHandle().clipboardClearNow()
    }

    public func checkpointStorage() throws {
        try requireHandle().checkpointStorage()
    }

    // MARK: - Apple AutoFill / Passkey / TextToInsert / CXF

    public func passkeyListForRp(rpId: String, allowCredentialIdsB64u: [String]) throws -> [KSPasskeyListCandidate] {
        let json = try requireHandle().passkeyListForRpJson(
            rpId: rpId,
            allowCredentialIdsB64u: allowCredentialIdsB64u
        )
        return try decodeJSON(json)
    }

    public func passkeyCreateApple(
        clientDataHash: Data,
        rpId: String,
        rpName: String,
        userId: Data,
        userName: String,
        userDisplayName: String,
        targetItemId: String?
    ) throws -> KSApplePasskeyRegistration {
        let reg = try requireHandle().passkeyCreateApple(
            clientDataHash: clientDataHash,
            rpId: rpId,
            rpName: rpName,
            userId: userId,
            userName: userName,
            userDisplayName: userDisplayName,
            targetItemId: targetItemId
        )
        return KSApplePasskeyRegistration(
            credentialId: reg.credentialId,
            attestationObject: reg.attestationObject,
            clientDataHash: reg.clientDataHash,
            itemId: reg.itemId
        )
    }

    public func passkeyAssertApple(
        clientDataHash: Data,
        rpId: String,
        credentialId: Data
    ) throws -> KSApplePasskeyAssertion {
        let res = try requireHandle().passkeyAssertApple(
            clientDataHash: clientDataHash,
            rpId: rpId,
            credentialId: credentialId
        )
        return KSApplePasskeyAssertion(
            credentialId: res.credentialId,
            userHandle: res.userHandle,
            authenticatorData: res.authenticatorData,
            signature: res.signature,
            clientDataHash: res.clientDataHash
        )
    }

    public func textInsertCandidates(query: String) throws -> [KSTextInsertCandidate] {
        let json = try requireHandle().textInsertCandidatesJson(query: query)
        return try decodeJSON(json)
    }

    public func cxfExportBundleJson() throws -> String {
        try requireHandle().cxfExportBundleJson()
    }

    public func cxfImportBundleJson(_ bundleJson: String) throws -> KSImportSummary {
        let json = try requireHandle().cxfImportBundleJson(bundleJson: bundleJson)
        return try decodeJSON(json)
    }

    // MARK: - Helpers

    private func encodeJSON<T: Encodable>(_ value: T) throws -> String {
        let data = try encoder.encode(value)
        return String(data: data, encoding: .utf8) ?? "{}"
    }

    private func decodeJSON<T: Decodable>(_ json: String) throws -> T {
        guard let data = json.data(using: .utf8) else {
            throw KSCoreAdapterError.backend("Invalid UTF-8 JSON payload")
        }
        return try decoder.decode(T.self, from: data)
    }
}

// MARK: - UniFFI Callback Bridges

private final class FfiBiometricBridge: FfiBiometricKeyStore, @unchecked Sendable {
    private let store: AppleBiometricKeyStore

    init(store: AppleBiometricKeyStore) {
        self.store = store
    }

    func isAvailable() -> Bool {
        store.isAvailable()
    }

    func saveUnlockKey(accountId: String, key: Data) throws {
        try store.saveUnlockKey(accountId: accountId, key: key)
    }

    func loadUnlockKey(accountId: String, reason: String) throws -> Data {
        try store.loadUnlockKey(accountId: accountId, reason: reason)
    }

    func deleteUnlockKey(accountId: String) throws {
        try store.deleteUnlockKey(accountId: accountId)
    }

    func verifyUser(reason: String) throws {
        try store.verifyUser(reason: reason)
    }
}

private final class FfiClipboardBridge: FfiClipboardManager, @unchecked Sendable {
    private let manager: AppleClipboardManager

    init(manager: AppleClipboardManager) {
        self.manager = manager
    }

    func copySecret(text: String, label: String, isSensitive: Bool, clearAfterSecs: UInt64) throws {
        try manager.copySecret(text: text, label: label, isSensitive: isSensitive, clearAfterSecs: clearAfterSecs)
    }

    func clearNow() throws {
        try manager.clearNow()
    }
}

// MARK: - Local RFC 6238 TOTP & Generator Helpers (for instant Demo Mode & offline UI)

public enum LocalTotpEngine {
    public static func compute(secretOrUri: String, at date: Date = Date()) -> KSTotpCode? {
        var secret = secretOrUri.trimmingCharacters(in: .whitespacesAndNewlines)
        var period = 30
        var digits = 6
        var algorithm = "SHA1"

        if secret.lowercased().hasPrefix("otpauth://"), let comps = URLComponents(string: secret) {
            let items = comps.queryItems ?? []
            if let s = items.first(where: { $0.name.lowercased() == "secret" })?.value {
                secret = s
            }
            if let p = items.first(where: { $0.name.lowercased() == "period" })?.value, let pv = Int(p), pv > 0 {
                period = pv
            }
            if let d = items.first(where: { $0.name.lowercased() == "digits" })?.value, let dv = Int(d), (6...8).contains(dv) {
                digits = dv
            }
            if let alg = items.first(where: { $0.name.lowercased() == "algorithm" })?.value {
                algorithm = alg.uppercased()
            }
        }

        guard let keyData = base32Decode(secret), !keyData.isEmpty else {
            return nil
        }

        let epoch = Int(date.timeIntervalSince1970)
        let counter = UInt64(epoch / period)
        var bigEndianCounter = counter.bigEndian
        let counterData = Data(bytes: &bigEndianCounter, count: MemoryLayout<UInt64>.size)

        let hmacBytes: [UInt8]
        let symKey = SymmetricKey(data: keyData)
        switch algorithm {
        case "SHA256":
            hmacBytes = Array(HMAC<SHA256>.authenticationCode(for: counterData, using: symKey))
        case "SHA512":
            hmacBytes = Array(HMAC<SHA512>.authenticationCode(for: counterData, using: symKey))
        default:
            hmacBytes = Array(HMAC<Insecure.SHA1>.authenticationCode(for: counterData, using: symKey))
        }

        let offset = Int(hmacBytes[hmacBytes.count - 1] & 0x0f)
        let truncated =
            ((UInt32(hmacBytes[offset]) & 0x7f) << 24) |
            ((UInt32(hmacBytes[offset + 1]) & 0xff) << 16) |
            ((UInt32(hmacBytes[offset + 2]) & 0xff) << 8) |
            (UInt32(hmacBytes[offset + 3]) & 0xff)

        let mod = UInt32(pow(10.0, Double(digits)))
        let otpInt = truncated % mod
        let code = String(format: "%0*u", digits, otpInt)
        let formatted: String
        if digits == 6 {
            let idx = code.index(code.startIndex, offsetBy: 3)
            formatted = "\(code[..<idx]) \(code[idx...])"
        } else {
            formatted = code
        }
        let remaining = period - (epoch % period)
        return KSTotpCode(code: code, formattedCode: formatted, remainingSeconds: remaining, period: period)
    }

    private static func base32Decode(_ input: String) -> Data? {
        let alphabet = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567")
        var map: [Character: UInt8] = [:]
        for (i, c) in alphabet.enumerated() {
            map[c] = UInt8(i)
        }
        let clean = input.uppercased().filter { $0 != "=" && $0 != " " && $0 != "-" }
        guard !clean.isEmpty else { return nil }

        var buffer: UInt32 = 0
        var bitsLeft = 0
        var output = Data()

        for ch in clean {
            guard let val = map[ch] else { return nil }
            buffer = (buffer << 5) | UInt32(val)
            bitsLeft += 5
            if bitsLeft >= 8 {
                bitsLeft -= 8
                output.append(UInt8((buffer >> bitsLeft) & 0xff))
            }
        }
        return output
    }
}

public enum LocalGeneratorEngine {
    private static let words = [
        "aurora", "beacon", "cipher", "delta", "ember", "falcon", "glacier", "harbor",
        "indigo", "juniper", "keystone", "lantern", "meadow", "nebula", "obsidian", "prism",
        "quartz", "ripple", "summit", "timber", "umbra", "velvet", "willow", "zenith",
    ]

    public static func generate(options: KSGeneratorOptions) -> KSGeneratorResult {
        switch options.mode {
        case .password:
            let upper = options.excludeAmbiguous ? "ABCDEFGHJKLMNPQRSTUVWXYZ" : "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
            let lower = options.excludeAmbiguous ? "abcdefghijkmnpqrstuvwxyz" : "abcdefghijklmnopqrstuvwxyz"
            let digits = options.excludeAmbiguous ? "23456789" : "0123456789"
            let symbols = "!@#$%^&*-_=+?"
            var pool = upper + lower
            if options.includeDigits { pool += digits }
            if options.includeSymbols { pool += symbols }
            let chars = Array(pool)
            let len = max(8, min(64, options.length))
            var out = ""
            for _ in 0..<len {
                out.append(chars[randomIndex(upperBound: chars.count)])
            }
            let bits = Int(Double(len) * log2(Double(chars.count)))
            return KSGeneratorResult(
                value: out,
                strength: KSPasswordStrength(score: bits >= 80 ? 4 : 3, label: bits >= 80 ? "Strong" : "Good", entropyBits: bits)
            )

        case .passphrase:
            let count = max(3, min(10, options.wordCount))
            var parts: [String] = []
            for _ in 0..<count {
                var w = words[randomIndex(upperBound: words.count)]
                if options.capitalize {
                    w = w.capitalized
                }
                parts.append(w)
            }
            if options.includeNumberInPhrase, !parts.isEmpty {
                let idx = randomIndex(upperBound: parts.count)
                parts[idx] += String(randomIndex(upperBound: 90) + 10)
            }
            let value = parts.joined(separator: options.separator)
            let bits = count * 11
            return KSGeneratorResult(
                value: value,
                strength: KSPasswordStrength(score: 4, label: "Strong", entropyBits: bits)
            )

        case .pin:
            let len = max(4, min(12, options.pinLength))
            let digits = Array("0123456789")
            var out = ""
            for _ in 0..<len {
                out.append(digits[randomIndex(upperBound: digits.count)])
            }
            let bits = Int(Double(len) * log2(10.0))
            return KSGeneratorResult(
                value: out,
                strength: KSPasswordStrength(score: len >= 6 ? 3 : 2, label: "PIN", entropyBits: bits)
            )
        }
    }

    private static func randomIndex(upperBound: Int) -> Int {
        guard upperBound > 1 else { return 0 }
        var random: UInt32 = 0
        _ = SecRandomCopyBytes(kSecRandomDefault, MemoryLayout<UInt32>.size, &random)
        return Int(random % UInt32(upperBound))
    }
}
