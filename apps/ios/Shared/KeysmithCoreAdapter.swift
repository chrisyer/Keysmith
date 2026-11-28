import CryptoKit
import Foundation

/// Swift 6 thread-safe bridge wrapping `KeysmithCoreHandle` (UniFFI) + JSON DTO encoding/decoding.
/// Uses dedicated DispatchQueues so blocking Rust/SQLite/network calls (especially low-priority favicons)
/// never block MainActor or starve Swift Concurrency's cooperative thread pool.
public final class KeysmithCoreAdapter: @unchecked Sendable {
    private let handleLock = NSLock()
    private var handle: KeysmithCoreHandle?
    private let isExtension: Bool
    private let workQueue: DispatchQueue
    private let faviconQueue: DispatchQueue

    public init(isExtension: Bool = false) {
        self.isExtension = isExtension
        self.workQueue = DispatchQueue(
            label: isExtension ? "dev.keysmith.core.ext.work" : "dev.keysmith.core.work",
            qos: .userInitiated,
            attributes: .concurrent
        )
        self.faviconQueue = DispatchQueue(
            label: "dev.keysmith.core.favicon",
            qos: .utility
        )
    }

    public func initializeIfNeeded() async throws {
        try await runBlocking {
            _ = try self.requireHandleSync()
        }
    }

    private func requireHandleSync() throws -> KeysmithCoreHandle {
        handleLock.lock()
        defer { handleLock.unlock() }
        if let existing = handle {
            return existing
        }
        let dbPath = AppConfig.databaseURL().path
        let userAgent = AppConfig.userAgent(isExtension: isExtension)
        let created = try KeysmithCoreHandle(
            dbPath: dbPath,
            biometric: FfiBiometricBridge(store: AppleBiometricKeyStore.shared),
            clipboard: FfiClipboardBridge(manager: AppleClipboardManager.shared),
            isExtension: isExtension,
            userAgent: userAgent
        )
        handle = created
        return created
    }

    private func runBlocking<T: Sendable>(
        on queue: DispatchQueue? = nil,
        _ work: @escaping @Sendable () throws -> T
    ) async throws -> T {
        let targetQueue = queue ?? workQueue
        return try await withCheckedThrowingContinuation { continuation in
            targetQueue.async {
                do {
                    continuation.resume(returning: try work())
                } catch let ffiError as FfiError {
                    continuation.resume(throwing: Self.mapFfiError(ffiError))
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    // MARK: - Auth

    public func authCheckServer(serverUrl: String, allowInsecureHttp: Bool) async throws -> KSServerCheckResult {
        try await runBlocking {
            let json = try self.requireHandleSync().authCheckServerJson(serverUrl: serverUrl, allowInsecureHttp: allowInsecureHttp)
            return try self.decodeJSON(json)
        }
    }

    public func authPrelogin(serverUrl: String, email: String, allowInsecureHttp: Bool) async throws -> KSKdfConfig {
        try await runBlocking {
            let json = try self.requireHandleSync().authPreloginJson(
                serverUrl: serverUrl,
                email: email,
                allowInsecureHttp: allowInsecureHttp
            )
            return try self.decodeJSON(json)
        }
    }

    public func authLogin(
        serverUrl: String,
        email: String,
        masterPassword: String,
        twoFactorProvider: UInt8?,
        twoFactorToken: String?,
        twoFactorRemember: Bool,
        allowInsecureHttp: Bool
    ) async throws -> KSSessionState {
        try await runBlocking {
            let json = try self.requireHandleSync().authLoginJson(
                serverUrl: serverUrl,
                email: email,
                masterPassword: masterPassword,
                twoFactorProvider: twoFactorProvider,
                twoFactorToken: twoFactorToken,
                twoFactorRemember: twoFactorRemember,
                allowInsecureHttp: allowInsecureHttp
            )
            return try self.decodeJSON(json)
        }
    }

    private static func mapFfiError(_ error: FfiError) -> KSCoreAdapterError {
        switch error {
        case .TwoFactorRequired(let msg):
            return .twoFactorRequired(message: msg, providers: [])
        case .InvalidMasterPassword(let msg):
            return .invalidMasterPassword(msg)
        case .Locked(let msg):
            return .locked(msg)
        case .Network(let msg):
            return .network(msg)
        case .Validation(let msg):
            return .validation(msg)
        case .Biometric(let msg):
            return .biometric(msg)
        case .Authentication(let msg),
             .InvalidState(let msg),
             .Crypto(let msg),
             .Storage(let msg),
             .Internal(let msg):
            return .backend(msg)
        }
    }

    public func authRegister(
        serverUrl: String,
        email: String,
        displayName: String,
        masterPassword: String,
        hint: String?,
        allowInsecureHttp: Bool
    ) async throws -> KSSessionState {
        try await runBlocking {
            let json = try self.requireHandleSync().authRegisterJson(
                serverUrl: serverUrl,
                email: email,
                displayName: displayName,
                masterPassword: masterPassword,
                hint: hint,
                allowInsecureHttp: allowInsecureHttp
            )
            return try self.decodeJSON(json)
        }
    }

    public func authLogout(clearLocalCache: Bool) async throws {
        try await runBlocking {
            try self.requireHandleSync().authLogout(clearLocalCache: clearLocalCache)
        }
    }

    // MARK: - Account & Session

    public func accountList() async throws -> [KSAccountSummary] {
        try await runBlocking {
            let json = try self.requireHandleSync().accountListJson()
            return try self.decodeJSON(json)
        }
    }

    public func accountSwitch(accountId: String) async throws -> KSSessionState {
        try await runBlocking {
            let json = try self.requireHandleSync().accountSwitchJson(accountId: accountId)
            return try self.decodeJSON(json)
        }
    }

    public func accountUpdateProfile(displayName: String) async throws -> KSAccountSummary {
        try await runBlocking {
            let json = try self.requireHandleSync().accountUpdateProfileJson(displayName: displayName)
            return try self.decodeJSON(json)
        }
    }

    public func sessionGetState() async throws -> KSSessionState {
        try await runBlocking {
            let json = try self.requireHandleSync().sessionGetStateJson()
            return try self.decodeJSON(json)
        }
    }

    public func sessionUpdatePreferences(_ patch: KSSessionPreferencesPatch) async throws -> KSSessionState {
        try await runBlocking {
            let patchJSON = try self.encodeJSON(patch)
            let json = try self.requireHandleSync().sessionUpdatePreferencesJson(patchJson: patchJSON)
            return try self.decodeJSON(json)
        }
    }

    public func sessionUnlockPassword(_ password: String) async throws -> KSSessionState {
        try await runBlocking {
            let json = try self.requireHandleSync().sessionUnlockPasswordJson(password: password)
            return try self.decodeJSON(json)
        }
    }

    public func sessionUnlockBiometric() async throws -> KSSessionState {
        try await runBlocking {
            let json = try self.requireHandleSync().sessionUnlockBiometricJson()
            return try self.decodeJSON(json)
        }
    }

    public func sessionVerifyUserPresence(reason: String) async throws {
        try await runBlocking {
            try self.requireHandleSync().sessionVerifyUserPresence(reason: reason)
        }
    }

    public func sessionLock(reason: String) async throws {
        try await runBlocking {
            try self.requireHandleSync().sessionLock(reason: reason)
        }
    }

    public func sessionTouchActivity() async throws {
        try await runBlocking {
            try self.requireHandleSync().sessionTouchActivity()
        }
    }

    public func checkAutoLock() async throws -> Bool {
        try await runBlocking {
            try self.requireHandleSync().checkAutoLock()
        }
    }

    // MARK: - Vaults & Items

    public func vaultList() async throws -> [KSVault] {
        try await runBlocking {
            let json = try self.requireHandleSync().vaultListJson()
            return try self.decodeJSON(json)
        }
    }

    public func vaultCreate(name: String, icon: String, color: String) async throws -> KSVault {
        try await runBlocking {
            let json = try self.requireHandleSync().vaultCreateJson(name: name, icon: icon, color: color)
            return try self.decodeJSON(json)
        }
    }

    public func vaultRename(id: String, name: String) async throws -> KSVault {
        try await runBlocking {
            let json = try self.requireHandleSync().vaultRenameJson(id: id, name: name)
            return try self.decodeJSON(json)
        }
    }

    public func vaultSetTravelSafe(id: String, travelSafe: Bool) async throws -> KSVault {
        try await runBlocking {
            let json = try self.requireHandleSync().vaultSetTravelSafeJson(id: id, travelSafe: travelSafe)
            return try self.decodeJSON(json)
        }
    }

    public func vaultDelete(id: String) async throws {
        try await runBlocking {
            try self.requireHandleSync().vaultDelete(id: id)
        }
    }

    public func itemList(filter: KSItemFilter = KSItemFilter()) async throws -> [KSItemSummary] {
        try await runBlocking {
            let filterJSON = try self.encodeJSON(filter)
            let json = try self.requireHandleSync().itemListJson(filterJson: filterJSON)
            return try self.decodeJSON(json)
        }
    }

    public func itemGet(id: String) async throws -> KSItemDetail? {
        try await runBlocking {
            let json = try self.requireHandleSync().itemGetJson(id: id)
            if json == "null" || json.isEmpty { return nil }
            return try self.decodeJSON(json)
        }
    }

    public func itemCreate(_ draft: KSItemDraft) async throws -> KSItemDetail {
        try await runBlocking {
            let draftJSON = try self.encodeJSON(draft)
            let json = try self.requireHandleSync().itemCreateJson(draftJson: draftJSON)
            return try self.decodeJSON(json)
        }
    }

    public func itemUpdate(id: String, draft: KSItemDraft) async throws -> KSItemDetail {
        try await runBlocking {
            let draftJSON = try self.encodeJSON(draft)
            let json = try self.requireHandleSync().itemUpdateJson(id: id, draftJson: draftJSON)
            return try self.decodeJSON(json)
        }
    }

    public func itemToggleFavorite(id: String) async throws -> KSItemDetail {
        try await runBlocking {
            let json = try self.requireHandleSync().itemToggleFavoriteJson(id: id)
            return try self.decodeJSON(json)
        }
    }

    public func itemTrash(id: String) async throws {
        try await runBlocking {
            try self.requireHandleSync().itemTrash(id: id)
        }
    }

    public func itemRestore(id: String) async throws {
        try await runBlocking {
            try self.requireHandleSync().itemRestore(id: id)
        }
    }

    public func itemDeletePermanent(id: String) async throws {
        try await runBlocking {
            try self.requireHandleSync().itemDeletePermanent(id: id)
        }
    }

    public func itemEmptyTrash() async throws -> UInt32 {
        try await runBlocking {
            try self.requireHandleSync().itemEmptyTrash()
        }
    }

    // MARK: - Sync & Tools

    public func syncGetStatus() async throws -> KSSyncStatus {
        try await runBlocking {
            let json = try self.requireHandleSync().syncGetStatusJson()
            return try self.decodeJSON(json)
        }
    }

    public func syncNow() async throws -> KSSyncStatus {
        try await runBlocking {
            let json = try self.requireHandleSync().syncNowJson()
            return try self.decodeJSON(json)
        }
    }

    public func checkAndSyncIfChanged(syncOnUnknown: Bool) async throws -> KSSyncStatus {
        try await runBlocking {
            let json = try self.requireHandleSync().checkAndSyncIfChangedJson(syncOnUnknown: syncOnUnknown)
            return try self.decodeJSON(json)
        }
    }

    public func totpCompute(secretOrUri: String) async throws -> KSTotpCode {
        try await runBlocking {
            let json = try self.requireHandleSync().totpComputeJson(secretOrUri: secretOrUri)
            return try self.decodeJSON(json)
        }
    }

    public func totpParseQrImage(data: Data) async throws -> String {
        try await runBlocking {
            let b64 = data.base64EncodedString()
            return try self.requireHandleSync().totpParseQrImage(imageBase64: b64)
        }
    }

    public func generatorGenerate(options: KSGeneratorOptions) async throws -> KSGeneratorResult {
        try await runBlocking {
            let optsJSON = try self.encodeJSON(options)
            let json = try self.requireHandleSync().generatorGenerateJson(optionsJson: optsJSON)
            return try self.decodeJSON(json)
        }
    }

    public func generatorHistoryList() async throws -> [KSGeneratorHistoryEntry] {
        try await runBlocking {
            let json = try self.requireHandleSync().generatorHistoryListJson()
            return try self.decodeJSON(json)
        }
    }

    public func generatorHistoryClear() async throws {
        try await runBlocking {
            try self.requireHandleSync().generatorHistoryClear()
        }
    }

    public func watchtowerScan(checkHibp: Bool) async throws -> KSWatchtowerReport {
        try await runBlocking {
            let json = try self.requireHandleSync().watchtowerScanJson(checkHibp: checkHibp)
            return try self.decodeJSON(json)
        }
    }

    public func sendList() async throws -> [KSSendItem] {
        try await runBlocking {
            let json = try self.requireHandleSync().sendListJson()
            return try self.decodeJSON(json)
        }
    }

    public func sendCreateText(_ input: KSSendCreateTextInput) async throws -> KSSendItem {
        try await runBlocking {
            let inputJSON = try self.encodeJSON(input)
            let json = try self.requireHandleSync().sendCreateTextJson(inputJson: inputJSON)
            return try self.decodeJSON(json)
        }
    }

    public func sendDelete(id: String) async throws {
        try await runBlocking {
            try self.requireHandleSync().sendDelete(id: id)
        }
    }

    public func vaultExportEmergencyKit() async throws -> KSExportResult {
        try await runBlocking {
            let json = try self.requireHandleSync().vaultExportEmergencyKitJson()
            return try self.decodeJSON(json)
        }
    }

    public func snapshotList() async throws -> [KSLocalSnapshotInfo] {
        try await runBlocking {
            let json = try self.requireHandleSync().snapshotListJson()
            return try self.decodeJSON(json)
        }
    }

    public func snapshotCreate() async throws -> KSLocalSnapshotInfo {
        try await runBlocking {
            let json = try self.requireHandleSync().snapshotCreateJson()
            return try self.decodeJSON(json)
        }
    }

    public func snapshotDelete(id: String) async throws {
        try await runBlocking {
            try self.requireHandleSync().snapshotDelete(id: id)
        }
    }

    public func appSettingsGet() async throws -> KSAppSettings {
        try await runBlocking {
            let json = try self.requireHandleSync().appSettingsGetJson()
            return try self.decodeJSON(json)
        }
    }

    public func appSettingsUpdate(_ patch: KSAppSettingsPatch) async throws -> KSAppSettings {
        try await runBlocking {
            let patchJSON = try self.encodeJSON(patch)
            let json = try self.requireHandleSync().appSettingsUpdateJson(patchJson: patchJSON)
            return try self.decodeJSON(json)
        }
    }

    public func faviconFetch(host: String) async throws -> String? {
        try await runBlocking(on: faviconQueue) {
            try self.requireHandleSync().faviconFetch(host: host)
        }
    }

    public func clipboardCopySecret(text: String, label: String, isSensitive: Bool, clearAfterSecs: UInt64) async throws {
        try await runBlocking {
            try self.requireHandleSync().clipboardCopySecret(
                text: text,
                label: label,
                isSensitive: isSensitive,
                clearAfterSecs: clearAfterSecs
            )
        }
    }

    public func clipboardClearNow() async throws {
        try await runBlocking {
            try self.requireHandleSync().clipboardClearNow()
        }
    }

    public func checkpointStorage() async throws {
        try await runBlocking {
            try self.requireHandleSync().checkpointStorage()
        }
    }

    // MARK: - Apple AutoFill / Passkey / TextToInsert / CXF

    public func passkeyListForRp(rpId: String, allowCredentialIdsB64u: [String]) async throws -> [KSPasskeyListCandidate] {
        try await runBlocking {
            let json = try self.requireHandleSync().passkeyListForRpJson(
                rpId: rpId,
                allowCredentialIdsB64u: allowCredentialIdsB64u
            )
            return try self.decodeJSON(json)
        }
    }

    public func passkeyCreateApple(
        clientDataHash: Data,
        rpId: String,
        rpName: String,
        userId: Data,
        userName: String,
        userDisplayName: String,
        targetItemId: String?
    ) async throws -> KSApplePasskeyRegistration {
        try await runBlocking {
            let reg = try self.requireHandleSync().passkeyCreateApple(
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
    }

    public func passkeyAssertApple(
        clientDataHash: Data,
        rpId: String,
        credentialId: Data
    ) async throws -> KSApplePasskeyAssertion {
        try await runBlocking {
            let res = try self.requireHandleSync().passkeyAssertApple(
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
    }

    public func textInsertCandidates(query: String) async throws -> [KSTextInsertCandidate] {
        try await runBlocking {
            let json = try self.requireHandleSync().textInsertCandidatesJson(query: query)
            return try self.decodeJSON(json)
        }
    }

    public func cxfExportBundleJson() async throws -> String {
        try await runBlocking {
            try self.requireHandleSync().cxfExportBundleJson()
        }
    }

    public func cxfImportBundleJson(_ bundleJson: String) async throws -> KSImportSummary {
        try await runBlocking {
            let json = try self.requireHandleSync().cxfImportBundleJson(bundleJson: bundleJson)
            return try self.decodeJSON(json)
        }
    }

    // MARK: - Helpers

    private func encodeJSON<T: Encodable>(_ value: T) throws -> String {
        let data = try JSONEncoder().encode(value)
        return String(data: data, encoding: .utf8) ?? "{}"
    }

    private func decodeJSON<T: Decodable>(_ json: String) throws -> T {
        guard let data = json.data(using: .utf8) else {
            throw KSCoreAdapterError.backend("Invalid UTF-8 JSON payload")
        }
        return try JSONDecoder().decode(T.self, from: data)
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

            var pool = ""
            if options.includeUppercase { pool += upper }
            if options.includeLowercase { pool += lower }
            if options.includeDigits { pool += digits }
            if options.includeSymbols { pool += symbols }
            if pool.isEmpty { pool = upper + lower }

            let poolChars = Array(pool)
            let digitChars = Array(digits)
            let symbolChars = Array(symbols)
            let upperChars = Array(upper)
            let lowerChars = Array(lower)
            let len = max(8, min(64, options.length))

            var resultChars: [Character] = []
            if options.includeUppercase {
                resultChars.append(upperChars[randomIndex(upperBound: upperChars.count)])
            }
            if options.includeLowercase {
                resultChars.append(lowerChars[randomIndex(upperBound: lowerChars.count)])
            }
            if options.includeDigits {
                let targetDigits = max(0, min(len - resultChars.count, options.minDigits))
                for _ in 0..<targetDigits {
                    resultChars.append(digitChars[randomIndex(upperBound: digitChars.count)])
                }
            }
            if options.includeSymbols {
                let targetSymbols = max(0, min(len - resultChars.count, options.minSymbols))
                for _ in 0..<targetSymbols {
                    resultChars.append(symbolChars[randomIndex(upperBound: symbolChars.count)])
                }
            }
            while resultChars.count < len {
                resultChars.append(poolChars[randomIndex(upperBound: poolChars.count)])
            }
            // CSPRNG Fisher-Yates shuffle
            if resultChars.count > 1 {
                for i in stride(from: resultChars.count - 1, through: 1, by: -1) {
                    let j = randomIndex(upperBound: i + 1)
                    if i != j {
                        resultChars.swapAt(i, j)
                    }
                }
            }

            let out = String(resultChars)
            let bits = Int(Double(len) * log2(Double(max(2, poolChars.count))))
            return KSGeneratorResult(
                value: out,
                strength: KSPasswordStrength(score: bits >= 80 ? 4 : (bits >= 56 ? 3 : 2), label: bits >= 80 ? "Strong" : (bits >= 56 ? "Good" : "Fair"), entropyBits: bits)
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
