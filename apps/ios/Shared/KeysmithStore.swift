import Foundation
import Observation
import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

@MainActor
@Observable
public final class KeysmithStore {
    public let adapter: KeysmithCoreAdapter

    public var isDemoMode: Bool = false
    public var isInitialized: Bool = false
    public var isLoading: Bool = false
    public var isSyncing: Bool = false

    public var session: KSSessionState = KSSessionState()
    public var accounts: [KSAccountSummary] = []
    public var vaults: [KSVault] = []
    public var items: [KSItemSummary] = []
    public var syncStatus: KSSyncStatus = KSSyncStatus()
    public var appSettings: KSAppSettings = KSAppSettings()
    public var lockTimeoutAction: KSLockTimeoutAction = .lock

    public var watchtowerReport: KSWatchtowerReport?
    public var sends: [KSSendItem] = []
    public var generatorOptions: KSGeneratorOptions = KSGeneratorOptions()
    public var generatorResult: KSGeneratorResult = LocalGeneratorEngine.generate(options: KSGeneratorOptions())
    public var generatorHistory: [KSGeneratorHistoryEntry] = []
    public var snapshots: [KSLocalSnapshotInfo] = []

    // Navigation & transient UI state
    public var pendingRoute: KSDeepLink?
    public var isShowingTotpScannerFromDeepLink: Bool = false
    public var isShowingSettingsModal: Bool = false
    public var activePhoneTab: KSPhoneTab = .home
    public var toastMessage: String?
    public var errorBanner: String?

    // Clipboard countdown state (for .tabViewBottomAccessory & iPad status)
    public var clipboardActive: Bool = false
    public var clipboardLabel: String = ""
    public var clipboardRemainingSeconds: Int = 0

    // Privacy & Screen Capture state
    public var isPrivacyShieldVisible: Bool = false
    public var isScreenCaptured: Bool = false

    // In-memory demo backing store
    private var demoDetails: [String: KSItemDetail] = [:]
    private var clipboardTask: Task<Void, Never>?
    private var backgroundTimestamp: Date?
    private var screenCaptureObserver: NSObjectProtocol?

    private static let lockActionStorageKey = "keysmith.ios.lockTimeoutAction"

    public init(adapter: KeysmithCoreAdapter = KeysmithCoreAdapter(isExtension: false)) {
        self.adapter = adapter
        if let savedAction = UserDefaults.standard.string(forKey: Self.lockActionStorageKey),
           let parsed = KSLockTimeoutAction(rawValue: savedAction) {
            self.lockTimeoutAction = parsed
        }
        setupClipboardObserver()
        setupScreenCaptureMonitor()
    }

    public var l10n: KSLocalizedStrings {
        KSLocalizedStrings(languageCode: appSettings.language)
    }

    public var colorSchemeOverride: ColorScheme? {
        switch appSettings.themeMode {
        case .light: return .light
        case .dark: return .dark
        case .system: return nil
        }
    }

    public var visibleItems: [KSItemSummary] {
        items.filter { item in
            guard item.deletedAt == nil && !item.archived else { return false }
            if session.travelMode {
                if let vault = vaults.first(where: { $0.id == item.vaultId }) {
                    return vault.travelSafe
                }
                return false
            }
            return true
        }
    }

    // MARK: - Lifecycle & Bootstrap

    public func bootstrap(isDemoArg: Bool = ProcessInfo.processInfo.arguments.contains("-demo")) async {
        if isDemoArg {
            enterDemoMode()
            return
        }
        isLoading = true
        defer {
            isLoading = false
            isInitialized = true
        }

        do {
            try await adapter.initializeIfNeeded()
            let loadedSession = try await adapter.sessionGetState()
            let loadedSettings = try await adapter.appSettingsGet()
            let loadedAccounts = try await adapter.accountList()

            session = loadedSession
            appSettings = loadedSettings
            accounts = loadedAccounts

            if loadedSession.status == .unlocked {
                await refreshUnlockedState()
            }
        } catch {
            errorBanner = error.localizedDescription
        }
    }

    public func enterDemoMode() {
        isDemoMode = true
        isInitialized = true
        errorBanner = nil
        demoDetails = Dictionary(uniqueKeysWithValues: DemoSeedData.itemDetails.map { ($0.id, $0) })
        vaults = DemoSeedData.vaults
        items = DemoSeedData.summaries(from: DemoSeedData.itemDetails)
        accounts = [DemoSeedData.demoAccount]
        session = KSSessionState(
            accountId: DemoSeedData.demoAccount.id,
            status: .unlocked,
            email: DemoSeedData.demoAccount.email,
            displayName: DemoSeedData.demoAccount.displayName,
            serverUrl: DemoSeedData.demoAccount.serverUrl,
            biometricEnabled: true,
            autoLockMinutes: 1,
            autoLockSeconds: 60,
            clipboardClearSeconds: 30,
            lastSyncAt: DemoSeedData.demoAccount.lastSyncAt,
            kdfType: "Argon2id",
            lockOnSleep: true,
            screenCaptureProtected: true,
            vibrancyEnabled: true,
            faviconEnabled: true,
            biometricMaxDays: 7,
            travelMode: false,
            trashAutoPurgeDays: 30
        )
        syncStatus = KSSyncStatus(
            state: .idle,
            pendingCount: 0,
            lastSyncAt: "2026-11-27T14:33:00Z",
            signalrConnected: true
        )
        watchtowerReport = DemoSeedData.demoWatchtowerReport
        sends = DemoSeedData.demoSends
        snapshots = DemoSeedData.demoSnapshots
        appSettings = KSAppSettings(language: "zh-CN", theme: "system", syncMode: "auto")
        regeneratePassword()
    }

    public func handleScenePhaseChange(_ phase: ScenePhase) {
        switch phase {
        case .inactive:
            isPrivacyShieldVisible = true
        case .background:
            isPrivacyShieldVisible = true
            backgroundTimestamp = Date()
            if !isDemoMode {
                Task { try? await adapter.checkpointStorage() }
            }
            if session.status == .unlocked && session.lockOnSleep {
                let autoOpt = KSAutoLockOption.from(
                    autoLockSeconds: session.autoLockSeconds,
                    autoLockMinutes: session.autoLockMinutes
                )
                if autoOpt == .immediate {
                    lock(reason: "background_immediate")
                }
            }
        case .active:
            isPrivacyShieldVisible = false
            updateScreenCapturedState()
            if session.status == .unlocked, let bg = backgroundTimestamp {
                backgroundTimestamp = nil
                let elapsed = Int(Date().timeIntervalSince(bg))
                let threshold = effectiveAutoLockSeconds
                if threshold == 0 || (threshold > 0 && elapsed >= threshold) {
                    if lockTimeoutAction == .logout && !isDemoMode {
                        Task { await logout(clearLocalCache: false) }
                    } else {
                        lock(reason: "auto_lock_timeout")
                    }
                    return
                }
            }
            if !isDemoMode && session.status == .unlocked {
                Task {
                    _ = try? await adapter.checkAutoLock()
                    await refreshUnlockedState()
                }
            }
        @unknown default:
            break
        }
    }

    private var effectiveAutoLockSeconds: Int {
        if let secs = session.autoLockSeconds {
            return secs
        }
        return session.autoLockMinutes == 0 ? -1 : session.autoLockMinutes * 60
    }

    public func handleDeepLink(_ url: URL) {
        guard let link = KSDeepLink(url: url) else { return }
        switch link {
        case .lock:
            lock(reason: "deep_link")
        case .search:
            activePhoneTab = .search
            pendingRoute = link
        case .scanTotp:
            isShowingTotpScannerFromDeepLink = true
            pendingRoute = link
        case .settings:
            isShowingSettingsModal = true
            pendingRoute = link
        case .item:
            pendingRoute = link
        }
    }

    // MARK: - Auth & Session Actions

    public func checkServer(serverUrl: String, allowInsecureHttp: Bool) async throws -> KSServerCheckResult {
        try await adapter.authCheckServer(serverUrl: serverUrl, allowInsecureHttp: allowInsecureHttp)
    }

    public func prelogin(serverUrl: String, email: String, allowInsecureHttp: Bool) async throws -> KSKdfConfig {
        try await adapter.authPrelogin(serverUrl: serverUrl, email: email, allowInsecureHttp: allowInsecureHttp)
    }

    public func login(
        serverUrl: String,
        email: String,
        masterPassword: String,
        twoFactorProvider: UInt8? = nil,
        twoFactorToken: String? = nil,
        twoFactorRemember: Bool = false,
        allowInsecureHttp: Bool = false
    ) async throws {
        isDemoMode = false
        isLoading = true
        defer { isLoading = false }
        let newSession = try await adapter.authLogin(
            serverUrl: serverUrl,
            email: email,
            masterPassword: masterPassword,
            twoFactorProvider: twoFactorProvider,
            twoFactorToken: twoFactorToken,
            twoFactorRemember: twoFactorRemember,
            allowInsecureHttp: allowInsecureHttp
        )
        session = newSession
        accounts = (try? await adapter.accountList()) ?? accounts
        await refreshUnlockedState()
    }

    public func register(
        serverUrl: String,
        email: String,
        displayName: String,
        masterPassword: String,
        hint: String? = nil,
        allowInsecureHttp: Bool = false
    ) async throws {
        isDemoMode = false
        isLoading = true
        defer { isLoading = false }
        let newSession = try await adapter.authRegister(
            serverUrl: serverUrl,
            email: email,
            displayName: displayName,
            masterPassword: masterPassword,
            hint: hint,
            allowInsecureHttp: allowInsecureHttp
        )
        session = newSession
        accounts = (try? await adapter.accountList()) ?? accounts
        await refreshUnlockedState()
    }

    public func unlockWithPassword(_ password: String) async throws {
        if isDemoMode {
            guard !password.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                throw KSCoreAdapterError.invalidMasterPassword("请输入主密码")
            }
            session.status = .unlocked
            return
        }
        isLoading = true
        defer { isLoading = false }
        session = try await adapter.sessionUnlockPassword(password)
        await refreshUnlockedState()
    }

    public func unlockWithBiometric() async throws {
        if isDemoMode {
            try AppleBiometricKeyStore.shared.verifyUser(reason: l10n.unlockWithFaceID)
            session.status = .unlocked
            return
        }
        isLoading = true
        defer { isLoading = false }
        session = try await adapter.sessionUnlockBiometric()
        await refreshUnlockedState()
    }

    public func verifyUserPresence(reason: String) async throws {
        if isDemoMode {
            try AppleBiometricKeyStore.shared.verifyUser(reason: reason)
            return
        }
        try await adapter.sessionVerifyUserPresence(reason: reason)
    }

    public func lock(reason: String = "manual") {
        clearClipboardNow()
        if isDemoMode {
            session.status = .locked
            return
        }
        session.status = .locked
        Task {
            try? await adapter.sessionLock(reason: reason)
            try? await adapter.checkpointStorage()
        }
    }

    public func logout(clearLocalCache: Bool) async {
        clearClipboardNow()
        await CredentialIdentitySync.shared.clearAll()
        if isDemoMode {
            isDemoMode = false
            demoDetails.removeAll()
            vaults = []
            items = []
            accounts = []
            session = KSSessionState()
            return
        }
        try? await adapter.authLogout(clearLocalCache: clearLocalCache)
        session = (try? await adapter.sessionGetState()) ?? KSSessionState()
        accounts = (try? await adapter.accountList()) ?? []
        vaults = []
        items = []
        sends = []
        watchtowerReport = nil
    }

    public func switchAccount(_ accountId: String) async throws {
        if isDemoMode { return }
        session = try await adapter.accountSwitch(accountId: accountId)
        accounts = (try? await adapter.accountList()) ?? accounts
        if session.status == .unlocked {
            await refreshUnlockedState()
        } else {
            vaults = []
            items = []
        }
    }

    public func updatePreferences(_ patch: KSSessionPreferencesPatch) async throws {
        if let v = patch.biometricEnabled { session.biometricEnabled = v }
        if let v = patch.autoLockMinutes { session.autoLockMinutes = v }
        if let v = patch.autoLockSeconds { session.autoLockSeconds = v }
        if let v = patch.clipboardClearSeconds { session.clipboardClearSeconds = v }
        if let v = patch.lockOnSleep { session.lockOnSleep = v }
        if let v = patch.screenCaptureProtected { session.screenCaptureProtected = v }
        if let v = patch.vibrancyEnabled { session.vibrancyEnabled = v }
        if let v = patch.faviconEnabled { session.faviconEnabled = v }
        if let v = patch.biometricMaxDays { session.biometricMaxDays = v }
        if let v = patch.travelMode { session.travelMode = v }
        if let v = patch.trashAutoPurgeDays { session.trashAutoPurgeDays = v }

        if isDemoMode { return }
        session = try await adapter.sessionUpdatePreferences(patch)
        if patch.travelMode != nil {
            await refreshUnlockedState()
        }
    }

    public func updateAppSettings(_ patch: KSAppSettingsPatch) async throws {
        if let v = patch.language { appSettings.language = v }
        if let v = patch.theme { appSettings.theme = v }
        if let v = patch.customEquivalentDomains { appSettings.customEquivalentDomains = v }
        if let v = patch.disabledAutofillDomains { appSettings.disabledAutofillDomains = v }
        if let v = patch.autoCopyTotpOnFill { appSettings.autoCopyTotpOnFill = v }
        if let v = patch.snapshotIntervalDays { appSettings.snapshotIntervalDays = v }
        if let v = patch.snapshotKeepCount { appSettings.snapshotKeepCount = v }
        if let v = patch.syncMode { appSettings.syncMode = v }

        if isDemoMode { return }
        appSettings = try await adapter.appSettingsUpdate(patch)
    }

    public func setLockTimeoutAction(_ action: KSLockTimeoutAction) {
        lockTimeoutAction = action
        UserDefaults.standard.set(action.rawValue, forKey: Self.lockActionStorageKey)
    }

    // MARK: - Vaults, Items & Sync

    public func refreshUnlockedState() async {
        if isDemoMode {
            let list = Array(demoDetails.values).sorted { $0.updatedAt > $1.updatedAt }
            items = DemoSeedData.summaries(from: list)
            recalculateDemoVaultCounts()
            return
        }
        guard session.status == .unlocked else { return }
        do {
            async let vTask = adapter.vaultList()
            async let iTask = adapter.itemList(filter: KSItemFilter())
            async let sTask = adapter.syncGetStatus()
            let (v, i, s) = try await (vTask, iTask, sTask)
            vaults = v
            items = i
            syncStatus = s
            await CredentialIdentitySync.shared.sync(items: i)
        } catch {
            errorBanner = error.localizedDescription
        }
    }

    public func syncNow() async {
        isSyncing = true
        defer { isSyncing = false }
        if isDemoMode {
            let fmt = ISO8601DateFormatter()
            let now = fmt.string(from: Date())
            syncStatus.lastSyncAt = now
            syncStatus.state = .idle
            session.lastSyncAt = now
            showToast(l10n.t(zhCN: "已完成加密同步", en: "Encrypted sync completed"))
            return
        }
        do {
            syncStatus = try await adapter.syncNow()
            await refreshUnlockedState()
            showToast(l10n.t(zhCN: "已完成加密同步", en: "Encrypted sync completed"))
        } catch {
            errorBanner = error.localizedDescription
        }
    }

    public func createVault(name: String, icon: String = "folder.fill", color: String = "#0572EC") async throws -> KSVault {
        if isDemoMode {
            let v = KSVault(id: "vault-\(UUID().uuidString.prefix(6))", name: name, icon: icon, color: color, travelSafe: false, itemCount: 0)
            vaults.append(v)
            return v
        }
        let created = try await adapter.vaultCreate(name: name, icon: icon, color: color)
        await refreshUnlockedState()
        return created
    }

    public func renameVault(id: String, name: String) async throws -> KSVault {
        if isDemoMode {
            if let idx = vaults.firstIndex(where: { $0.id == id }) {
                vaults[idx].name = name
                return vaults[idx]
            }
            throw KSCoreAdapterError.validation("Vault not found")
        }
        let updated = try await adapter.vaultRename(id: id, name: name)
        await refreshUnlockedState()
        return updated
    }

    public func setVaultTravelSafe(id: String, travelSafe: Bool) async throws -> KSVault {
        if isDemoMode {
            if let idx = vaults.firstIndex(where: { $0.id == id }) {
                vaults[idx].travelSafe = travelSafe
                return vaults[idx]
            }
            throw KSCoreAdapterError.validation("Vault not found")
        }
        let updated = try await adapter.vaultSetTravelSafe(id: id, travelSafe: travelSafe)
        await refreshUnlockedState()
        return updated
    }

    public func deleteVault(id: String) async throws {
        if isDemoMode {
            vaults.removeAll { $0.id == id && !$0.isDefault }
            return
        }
        try await adapter.vaultDelete(id: id)
        await refreshUnlockedState()
    }

    public func getItemDetail(id: String) async throws -> KSItemDetail? {
        if isDemoMode {
            return demoDetails[id]
        }
        return try await adapter.itemGet(id: id)
    }

    @discardableResult
    public func createItem(_ draft: KSItemDraft) async throws -> KSItemDetail {
        if isDemoMode {
            let now = ISO8601DateFormatter().string(from: Date())
            let newDetail = KSItemDetail(
                id: draft.id ?? "item-\(UUID().uuidString.prefix(8))",
                vaultId: draft.vaultId,
                title: draft.title,
                favorite: draft.favorite,
                category: draft.category,
                subtitle: draft.subtitle,
                icon: draft.icon ?? .preset(name: String(draft.title.prefix(2)).uppercased(), color: draft.category.defaultColorHex),
                tags: draft.tags,
                urls: draft.urls,
                sections: draft.sections,
                passkeys: draft.passkeys,
                notes: draft.notes,
                passwordHistory: draft.passwordHistory,
                watchtower: draft.watchtower,
                archived: draft.archived,
                reprompt: draft.reprompt,
                ssoProvider: draft.ssoProvider,
                linkedItemIds: draft.linkedItemIds,
                createdAt: now,
                updatedAt: now
            )
            demoDetails[newDetail.id] = newDetail
            await refreshUnlockedState()
            return newDetail
        }
        let created = try await adapter.itemCreate(draft)
        await refreshUnlockedState()
        return created
    }

    @discardableResult
    public func updateItem(id: String, draft: KSItemDraft) async throws -> KSItemDetail {
        if isDemoMode {
            let now = ISO8601DateFormatter().string(from: Date())
            let existing = demoDetails[id]
            let updated = KSItemDetail(
                id: id,
                vaultId: draft.vaultId,
                title: draft.title,
                favorite: draft.favorite,
                category: draft.category,
                subtitle: draft.subtitle,
                icon: draft.icon ?? existing?.icon,
                tags: draft.tags,
                urls: draft.urls,
                sections: draft.sections,
                passkeys: draft.passkeys,
                notes: draft.notes,
                passwordHistory: draft.passwordHistory,
                watchtower: draft.watchtower,
                archived: draft.archived,
                reprompt: draft.reprompt,
                ssoProvider: draft.ssoProvider,
                linkedItemIds: draft.linkedItemIds,
                attachments: existing?.attachments ?? [],
                createdAt: existing?.createdAt ?? now,
                updatedAt: now
            )
            demoDetails[id] = updated
            await refreshUnlockedState()
            return updated
        }
        let updated = try await adapter.itemUpdate(id: id, draft: draft)
        await refreshUnlockedState()
        return updated
    }

    public func toggleFavorite(id: String) async throws {
        if isDemoMode {
            demoDetails[id]?.favorite.toggle()
            await refreshUnlockedState()
            return
        }
        _ = try await adapter.itemToggleFavorite(id: id)
        await refreshUnlockedState()
    }

    public func trashItem(id: String) async throws {
        if isDemoMode {
            demoDetails[id]?.deletedAt = ISO8601DateFormatter().string(from: Date())
            await refreshUnlockedState()
            return
        }
        try await adapter.itemTrash(id: id)
        await refreshUnlockedState()
    }

    public func restoreItem(id: String) async throws {
        if isDemoMode {
            demoDetails[id]?.deletedAt = nil
            await refreshUnlockedState()
            return
        }
        try await adapter.itemRestore(id: id)
        await refreshUnlockedState()
    }

    public func deleteItemPermanently(id: String) async throws {
        if isDemoMode {
            demoDetails.removeValue(forKey: id)
            await refreshUnlockedState()
            return
        }
        try await adapter.itemDeletePermanent(id: id)
        await refreshUnlockedState()
    }

    public func emptyTrash() async throws {
        if isDemoMode {
            demoDetails = demoDetails.filter { $0.value.deletedAt == nil }
            await refreshUnlockedState()
            return
        }
        _ = try await adapter.itemEmptyTrash()
        await refreshUnlockedState()
    }

    // MARK: - TOTP, Generator, Watchtower, Send & Snapshots

    public func computeTotp(_ secretOrUri: String, at date: Date = Date()) -> KSTotpCode? {
        LocalTotpEngine.compute(secretOrUri: secretOrUri, at: date)
    }

    public func parseTotpQrImage(data: Data) async throws -> String {
        if isDemoMode {
            if let str = String(data: data, encoding: .utf8), str.hasPrefix("otpauth://") {
                return str
            }
            return "otpauth://totp/GitHub:dev@keysmith.app?secret=JBSWY3DPEHPK3PXP&issuer=GitHub"
        }
        return try await adapter.totpParseQrImage(data: data)
    }

    public func regeneratePassword() {
        let opts = generatorOptions
        if isDemoMode {
            generatorResult = LocalGeneratorEngine.generate(options: opts)
            return
        }
        generatorResult = LocalGeneratorEngine.generate(options: opts)
        Task {
            if let res = try? await adapter.generatorGenerate(options: opts) {
                generatorResult = res
            }
        }
    }

    public func loadGeneratorHistory() async {
        if isDemoMode { return }
        if let list = try? await adapter.generatorHistoryList() {
            generatorHistory = list
        }
    }

    public func clearGeneratorHistory() async {
        generatorHistory = []
        if !isDemoMode {
            try? await adapter.generatorHistoryClear()
        }
    }

    public func runWatchtowerScan(checkHibp: Bool = false) async {
        if isDemoMode {
            watchtowerReport = DemoSeedData.demoWatchtowerReport
            return
        }
        do {
            watchtowerReport = try await adapter.watchtowerScan(checkHibp: checkHibp)
        } catch {
            errorBanner = error.localizedDescription
        }
    }

    public func loadSends() async {
        if isDemoMode { return }
        if let list = try? await adapter.sendList() {
            sends = list
        }
    }

    @discardableResult
    public func createTextSend(_ input: KSSendCreateTextInput) async throws -> KSSendItem {
        if isDemoMode {
            let item = KSSendItem(
                id: "send-\(UUID().uuidString.prefix(6))",
                accessId: "acc-\(UUID().uuidString.prefix(6))",
                sendType: .text,
                name: input.name,
                notes: input.notes,
                text: input.text,
                hidden: input.hidden,
                shareUrl: "https://vault.example.com/#/send/\(UUID().uuidString.prefix(8))",
                maxAccessCount: input.maxAccessCount,
                accessCount: 0,
                expirationDate: input.expirationDate,
                deletionDate: input.deletionDate,
                revisionDate: ISO8601DateFormatter().string(from: Date()),
                disabled: input.disabled,
                hideEmail: input.hideEmail,
                hasPassword: !(input.password ?? "").isEmpty
            )
            sends.insert(item, at: 0)
            return item
        }
        let created = try await adapter.sendCreateText(input)
        sends.insert(created, at: 0)
        return created
    }

    public func deleteSend(id: String) async throws {
        if isDemoMode {
            sends.removeAll { $0.id == id }
            return
        }
        try await adapter.sendDelete(id: id)
        sends.removeAll { $0.id == id }
    }

    public func exportEmergencyKit() async throws -> KSExportResult {
        if isDemoMode {
            return KSExportResult(
                fileName: "Keysmith-Emergency-Kit.txt",
                content: """
                KEYSMITH EMERGENCY KIT
                Account: \(session.displayName) <\(session.email)>
                Server: \(session.serverUrl)
                KDF: \(session.kdfType)
                """
            )
        }
        return try await adapter.vaultExportEmergencyKit()
    }

    public func loadSnapshots() async {
        if isDemoMode { return }
        if let list = try? await adapter.snapshotList() {
            snapshots = list
        }
    }

    @discardableResult
    public func createSnapshot() async throws -> KSLocalSnapshotInfo {
        if isDemoMode {
            let snap = KSLocalSnapshotInfo(
                id: "snap-\(UUID().uuidString.prefix(6))",
                fileName: "keysmith-snapshot-\(Date().formatted(.iso8601.year().month().day())).ksbak",
                createdAt: ISO8601DateFormatter().string(from: Date()),
                sizeBytes: 51_200,
                itemCount: items.count,
                vaultCount: vaults.count
            )
            snapshots.insert(snap, at: 0)
            return snap
        }
        let snap = try await adapter.snapshotCreate()
        snapshots.insert(snap, at: 0)
        return snap
    }

    public func deleteSnapshot(id: String) async throws {
        if isDemoMode {
            snapshots.removeAll { $0.id == id }
            return
        }
        try await adapter.snapshotDelete(id: id)
        snapshots.removeAll { $0.id == id }
    }

    public func exportCxfBundleJson() async throws -> String {
        if isDemoMode {
            return "{\"version\":\"cxf-0.1\",\"items\":\(items.count)}"
        }
        return try await adapter.cxfExportBundleJson()
    }

    public func importCxfBundleJson(_ json: String) async throws -> KSImportSummary {
        if isDemoMode {
            return KSImportSummary(importedVaults: 0, importedItems: 0, skippedItems: 0)
        }
        let summary = try await adapter.cxfImportBundleJson(json)
        await refreshUnlockedState()
        return summary
    }

    // MARK: - Clipboard & Toast

    public func copyToClipboard(_ value: String, label: String, isSensitive: Bool = true) {
        let clearSecs = UInt64(max(0, session.clipboardClearSeconds))
        if isDemoMode {
            try? AppleClipboardManager.shared.copySecret(
                text: value,
                label: label,
                isSensitive: isSensitive,
                clearAfterSecs: clearSecs
            )
        } else {
            Task {
                try? await adapter.clipboardCopySecret(
                    text: value,
                    label: label,
                    isSensitive: isSensitive,
                    clearAfterSecs: clearSecs
                )
            }
        }
        if isSensitive {
            startClipboardCountdown(label: label, seconds: Int(clearSecs))
        } else {
            showToast(l10n.t(zhCN: "已复制「\(label)」", en: "Copied \(label)"))
        }
        #if canImport(UIKit)
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        #endif
    }

    public func clearClipboardNow() {
        clipboardTask?.cancel()
        clipboardTask = nil
        clipboardActive = false
        clipboardRemainingSeconds = 0
        clipboardLabel = ""
        if isDemoMode {
            try? AppleClipboardManager.shared.clearNow()
        } else {
            Task { try? await adapter.clipboardClearNow() }
        }
    }

    public func showToast(_ message: String) {
        toastMessage = message
        Task {
            try? await Task.sleep(for: .seconds(2.5))
            if toastMessage == message {
                toastMessage = nil
            }
        }
    }

    // MARK: - Private Helpers

    private func recalculateDemoVaultCounts() {
        let activeDetails = demoDetails.values.filter { $0.deletedAt == nil && !$0.archived }
        vaults = vaults.map { vault in
            var copy = vault
            copy.itemCount = activeDetails.filter { $0.vaultId == vault.id }.count
            return copy
        }
    }

    private func startClipboardCountdown(label: String, seconds: Int) {
        clipboardTask?.cancel()
        clipboardLabel = label
        clipboardActive = true
        clipboardRemainingSeconds = seconds

        guard seconds > 0 else { return }

        clipboardTask = Task { [weak self] in
            var remaining = seconds
            while remaining > 0 && !Task.isCancelled {
                try? await Task.sleep(for: .seconds(1))
                guard !Task.isCancelled else { return }
                remaining -= 1
                self?.clipboardRemainingSeconds = remaining
            }
            if !Task.isCancelled {
                self?.clearClipboardNow()
            }
        }
    }

    private func setupClipboardObserver() {
        AppleClipboardManager.shared.registerCopyObserver { [weak self] label, secs in
            Task { @MainActor in
                self?.startClipboardCountdown(label: label, seconds: Int(secs))
            }
        }
    }

    private func setupScreenCaptureMonitor() {
        updateScreenCapturedState()
        #if canImport(UIKit)
        screenCaptureObserver = NotificationCenter.default.addObserver(
            forName: UIScreen.capturedDidChangeNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                self?.updateScreenCapturedState()
            }
        }
        #endif
    }

    private func updateScreenCapturedState() {
        #if canImport(UIKit)
        isScreenCaptured = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .contains { $0.screen.isCaptured }
        #endif
    }
}
