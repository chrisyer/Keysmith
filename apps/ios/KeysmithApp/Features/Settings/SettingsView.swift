import AuthenticationServices
import SwiftUI

/// Full 6-group `.insetGrouped` settings view matching 1Password/Bitwarden parity
/// and supporting both iPhone modal presentation and iPadOS split-view embedding.
public struct SettingsView: View {
    @Bindable var store: KeysmithStore
    let isEmbeddedInSplitView: Bool
    let onClose: () -> Void

    @State private var activeSheet: SettingsSheet?
    @State private var showClearCacheLogoutConfirm = false
    @State private var autoFillEnabled = false

    public init(
        store: KeysmithStore,
        isEmbeddedInSplitView: Bool = false,
        onClose: @escaping () -> Void = {}
    ) {
        self.store = store
        self.isEmbeddedInSplitView = isEmbeddedInSplitView
        self.onClose = onClose
    }

    public var body: some View {
        Group {
            if isEmbeddedInSplitView {
                settingsForm
                    .navigationTitle(store.l10n.settings)
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .topBarTrailing) {
                            Button(store.l10n.t(zhCN: "返回条目详情", zhTW: "返回項目詳情", en: "Back to Item")) {
                                onClose()
                            }
                        }
                    }
            } else {
                NavigationStack {
                    settingsForm
                        .navigationTitle(store.l10n.settings)
                        .navigationBarTitleDisplayMode(.inline)
                        .toolbar {
                            ToolbarItem(placement: .topBarTrailing) {
                                Button(store.l10n.done) {
                                    onClose()
                                }
                                .fontWeight(.semibold)
                            }
                        }
                }
            }
        }
        .sheet(item: $activeSheet) { sheet in
            switch sheet {
            case .accounts:
                SettingsAccountsSheet(store: store)
            case .vaults:
                SettingsVaultsSheet(store: store)
            case .emergencyKit:
                SettingsEmergencyKitSheet(store: store)
            case .autofillGuide:
                SettingsAutoFillGuideSheet(store: store, autoFillEnabled: $autoFillEnabled)
            case .domains:
                SettingsDomainsSheet(store: store)
            case .cxfExchange:
                SettingsCxfExchangeSheet(store: store)
            case .snapshots:
                SettingsSnapshotsSheet(store: store)
            case .vaultTransfer:
                SettingsVaultTransferSheet(store: store)
            }
        }
        .confirmationDialog(
            store.l10n.t(
                zhCN: "清除本地缓存并退出登录？",
                zhTW: "清除本機快取並登出？",
                en: "Clear local cache and sign out?"
            ),
            isPresented: $showClearCacheLogoutConfirm,
            titleVisibility: .visible
        ) {
            Button(
                store.l10n.t(zhCN: "清除本地缓存并退出登录", zhTW: "清除本機快取並登出", en: "Clear Cache & Sign Out"),
                role: .destructive
            ) {
                Task {
                    await store.logout(clearLocalCache: true)
                    onClose()
                }
            }
            Button(store.l10n.cancel, role: .cancel) {}
        } message: {
            Text(store.l10n.t(
                zhCN: "退出前将清空 ASCredentialIdentityStore、Keychain 生物识别绑定并删除本地 WAL 数据库。",
                en: "This clears ASCredentialIdentityStore, Keychain biometric bindings, and deletes the local encrypted WAL database."
            ))
        }
        .task {
            let state = await ASCredentialIdentityStore.shared.state()
            autoFillEnabled = state.isEnabled
        }
    }

    private var settingsForm: some View {
        Form {
            accountAndVaultsSection
            securityAndLockSection
            autoFillAndPasskeySection
            syncAndBackupSection
            languageAndAppearanceSection
            aboutAndDangerSection
        }
        .formStyle(.grouped)
    }

    // MARK: - 1. 账号与保险库

    private var accountAndVaultsSection: some View {
        Section(store.l10n.t(
            zhCN: "账号与保险库",
            zhTW: "帳戶與保險庫",
            en: "Account & Vaults",
            ja: "アカウントと保管庫",
            ko: "계정 및 금고"
        )) {
            HStack(spacing: 12) {
                ZStack {
                    Circle()
                        .fill(KeysmithColors.accent)
                    Text(accountInitials)
                        .font(.subheadline.bold())
                        .foregroundStyle(.white)
                }
                .frame(width: 40, height: 40)

                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text(store.session.displayName.isEmpty ? "Keysmith" : store.session.displayName)
                            .font(.subheadline.weight(.semibold))
                            .lineLimit(1)

                        Text(store.session.kdfType.isEmpty ? "Argon2id" : store.session.kdfType)
                            .font(.caption2.weight(.medium))
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Color(.tertiarySystemFill), in: Capsule())
                            .foregroundStyle(.secondary)
                    }

                    Text("\(store.session.email) · \(hostDisplay(store.session.serverUrl))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                Spacer(minLength: 4)

                liveSyncBadge
            }
            .padding(.vertical, 2)

            Button {
                activeSheet = .accounts
            } label: {
                LabeledContent(
                    store.l10n.t(zhCN: "切换 / 添加账号", zhTW: "切換 / 新增帳戶", en: "Switch / Add Account"),
                    value: "\(max(1, store.accounts.count)) 个账号"
                )
            }
            .foregroundStyle(.primary)

            Button {
                activeSheet = .vaults
            } label: {
                LabeledContent(
                    store.l10n.t(zhCN: "管理保险库与文件夹", zhTW: "管理保險庫與資料夾", en: "Manage Vaults & Folders"),
                    value: "\(store.vaults.count) 个保险库"
                )
            }
            .foregroundStyle(.primary)

            Button {
                activeSheet = .emergencyKit
            } label: {
                LabeledContent(
                    store.l10n.t(zhCN: "紧急恢复包（Emergency Kit）", zhTW: "緊急恢復包（Emergency Kit）", en: "Emergency Kit"),
                    value: store.l10n.t(zhCN: "查看 / 导出", en: "View / Export")
                )
            }
            .foregroundStyle(.primary)
        }
    }

    private var liveSyncBadge: some View {
        let isLive = store.syncStatus.signalrConnected || store.appSettings.syncModeEnum == .auto
        let color = isLive ? KeysmithColors.success : Color.secondary
        return HStack(spacing: 4) {
            Circle()
                .fill(color)
                .frame(width: 6, height: 6)
            Text(isLive
                 ? store.l10n.t(zhCN: "实时已连接", en: "Live")
                 : store.l10n.t(zhCN: "手动", en: "Manual"))
                .font(.caption2.weight(.medium))
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(color.opacity(0.14), in: Capsule())
        .foregroundStyle(color)
    }

    // MARK: - 2. 安全与锁定

    private var securityAndLockSection: some View {
        Section(store.l10n.t(
            zhCN: "安全与锁定",
            zhTW: "安全與鎖定",
            en: "Security & Locking",
            ja: "セキュリティとロック",
            ko: "보안 및 잠금"
        )) {
            Toggle(
                store.l10n.t(zhCN: "Face ID / Touch ID 解锁", zhTW: "Face ID / Touch ID 解鎖", en: "Face ID / Touch ID Unlock"),
                isOn: Binding(
                    get: { store.session.biometricEnabled },
                    set: { val in
                        Task { try? await store.updatePreferences(.init(biometricEnabled: val)) }
                    }
                )
            )

            Picker(
                store.l10n.t(zhCN: "免主密码最长周期", zhTW: "免主密碼最長週期", en: "Biometric Max Days"),
                selection: Binding(
                    get: { KSBiometricMaxDaysOption.from(days: store.session.biometricMaxDays) },
                    set: { opt in
                        Task { try? await store.updatePreferences(.init(biometricMaxDays: opt.rawValue)) }
                    }
                )
            ) {
                ForEach(KSBiometricMaxDaysOption.allCases) { opt in
                    Text(biometricMaxDaysLabel(opt)).tag(opt)
                }
            }

            Picker(
                store.l10n.t(zhCN: "自动锁定时间", zhTW: "自動鎖定時間", en: "Auto-Lock Timeout"),
                selection: Binding(
                    get: {
                        KSAutoLockOption.from(
                            autoLockSeconds: store.session.autoLockSeconds,
                            autoLockMinutes: store.session.autoLockMinutes
                        )
                    },
                    set: { opt in
                        Task {
                            try? await store.updatePreferences(.init(
                                autoLockMinutes: opt.minutesValue,
                                autoLockSeconds: opt.secondsValue
                            ))
                        }
                    }
                )
            ) {
                ForEach(KSAutoLockOption.allCases) { opt in
                    Text(store.l10n.autoLockLabel(opt)).tag(opt)
                }
            }

            Picker(
                store.l10n.t(zhCN: "超时后执行动作", zhTW: "逾時後執行動作", en: "Timeout Action"),
                selection: Binding(
                    get: { store.lockTimeoutAction },
                    set: { action in store.setLockTimeoutAction(action) }
                )
            ) {
                Text(store.l10n.t(zhCN: "锁定保险库", zhTW: "鎖定保險庫", en: "Lock Vault")).tag(KSLockTimeoutAction.lock)
                Text(store.l10n.t(zhCN: "退出登录", zhTW: "登出", en: "Log Out")).tag(KSLockTimeoutAction.logout)
            }

            Toggle(
                store.l10n.t(zhCN: "锁屏或切后台立即锁定", zhTW: "鎖屏或切背景立即鎖定", en: "Lock on Background"),
                isOn: Binding(
                    get: { store.session.lockOnSleep },
                    set: { val in
                        Task { try? await store.updatePreferences(.init(lockOnSleep: val)) }
                    }
                )
            )

            Picker(
                store.l10n.t(zhCN: "剪贴板自动清除", zhTW: "剪貼簿自動清除", en: "Clipboard Auto-Clear"),
                selection: Binding(
                    get: { KSClipboardOption.from(seconds: store.session.clipboardClearSeconds) },
                    set: { opt in
                        Task { try? await store.updatePreferences(.init(clipboardClearSeconds: opt.seconds)) }
                    }
                )
            ) {
                ForEach(KSClipboardOption.allCases) { opt in
                    Text(store.l10n.clipboardLabel(opt)).tag(opt)
                }
            }

            Toggle(
                store.l10n.t(zhCN: "填充后自动复制 2FA 验证码", zhTW: "填充後自動複製 2FA 驗證碼", en: "Auto-Copy TOTP on Fill"),
                isOn: Binding(
                    get: { store.appSettings.autoCopyTotpOnFill },
                    set: { val in
                        Task { try? await store.updateAppSettings(.init(autoCopyTotpOnFill: val)) }
                    }
                )
            )

            Toggle(
                store.l10n.t(zhCN: "防截屏与录屏保护", zhTW: "防截圖與錄影保護", en: "Screen Capture Protection"),
                isOn: Binding(
                    get: { store.session.screenCaptureProtected },
                    set: { val in
                        Task { try? await store.updatePreferences(.init(screenCaptureProtected: val)) }
                    }
                )
            )

            Toggle(isOn: Binding(
                get: { store.session.travelMode },
                set: { val in
                    Task { try? await store.updatePreferences(.init(travelMode: val)) }
                }
            )) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(store.l10n.t(zhCN: "旅行模式（Travel Mode）", zhTW: "旅行模式（Travel Mode）", en: "Travel Mode"))
                    Text(store.l10n.t(
                        zhCN: "开启后隐藏非旅行安全保险库",
                        zhTW: "開啟後隱藏非旅行安全保險庫",
                        en: "Hide vaults not marked Travel Safe"
                    ))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
            }

            Picker(
                store.l10n.t(zhCN: "回收站自动清理", zhTW: "垃圾桶自動清理", en: "Trash Auto-Purge"),
                selection: Binding(
                    get: { KSTrashAutoPurgeOption.from(days: store.session.trashAutoPurgeDays) },
                    set: { opt in
                        Task { try? await store.updatePreferences(.init(trashAutoPurgeDays: opt.rawValue)) }
                    }
                )
            ) {
                ForEach(KSTrashAutoPurgeOption.allCases) { opt in
                    Text(trashPurgeLabel(opt)).tag(opt)
                }
            }
        }
    }

    // MARK: - 3. 自动填充与通行密钥

    private var autoFillAndPasskeySection: some View {
        Section(store.l10n.t(
            zhCN: "自动填充与通行密钥",
            zhTW: "自動填充與通行密鑰",
            en: "AutoFill & Passkeys",
            ja: "自動入力とパスキー",
            ko: "자동 완성 및 패스키"
        )) {
            Button {
                activeSheet = .autofillGuide
            } label: {
                HStack {
                    Text(store.l10n.t(
                        zhCN: "系统 AutoFill、Passkey 与 TextToInsert",
                        en: "System AutoFill, Passkey & TextToInsert"
                    ))
                    Spacer()
                    Text(autoFillEnabled
                         ? store.l10n.t(zhCN: "已就绪", en: "Ready")
                         : store.l10n.t(zhCN: "去开启", en: "Setup"))
                        .font(.subheadline)
                        .foregroundStyle(autoFillEnabled ? KeysmithColors.success : KeysmithColors.warning)
                }
            }
            .foregroundStyle(.primary)

            Button {
                activeSheet = .domains
            } label: {
                let ruleCount = store.appSettings.customEquivalentDomains.count
                    + store.appSettings.disabledAutofillDomains.count
                LabeledContent(
                    store.l10n.t(zhCN: "等效域名与禁用填充站点", en: "Equivalent & Excluded Domains"),
                    value: "\(ruleCount) 条规则"
                )
            }
            .foregroundStyle(.primary)

            Button {
                activeSheet = .cxfExchange
            } label: {
                LabeledContent(
                    store.l10n.t(zhCN: "FIDO CXF 安全凭证互迁", en: "FIDO CXF Credential Exchange"),
                    value: store.l10n.t(zhCN: "导入 / 导出", en: "Import / Export")
                )
            }
            .foregroundStyle(.primary)
        }
    }

    // MARK: - 4. 同步与数据备份

    private var syncAndBackupSection: some View {
        Section(store.l10n.t(
            zhCN: "同步与数据备份",
            zhTW: "同步與資料備份",
            en: "Sync & Backup",
            ja: "同期とバックアップ",
            ko: "동기화 및 백업"
        )) {
            Picker(
                store.l10n.t(zhCN: "同步模式", en: "Sync Mode"),
                selection: Binding(
                    get: { store.appSettings.syncModeEnum },
                    set: { mode in
                        Task { try? await store.updateAppSettings(.init(syncMode: mode.rawValue)) }
                    }
                )
            ) {
                Text(store.l10n.t(zhCN: "自动实时同步 (SignalR)", en: "Auto Live Sync (SignalR)")).tag(KSSyncMode.auto)
                Text(store.l10n.t(zhCN: "仅手动同步", en: "Manual Only")).tag(KSSyncMode.manual)
            }

            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(store.l10n.t(zhCN: "手动触发同步", en: "Manual Sync"))
                    Text("\(store.l10n.t(zhCN: "上次同步：", en: "Last synced: "))\(formattedSyncTime)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button {
                    Task { await store.syncNow() }
                } label: {
                    if store.isSyncing {
                        ProgressView().controlSize(.small)
                    } else {
                        Text(store.l10n.syncNow)
                    }
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
                .disabled(store.isSyncing)
            }

            Picker(
                store.l10n.t(zhCN: "本地加密快照备份", en: "Local Encrypted Snapshots"),
                selection: Binding(
                    get: { KSSnapshotScheduleOption.from(intervalDays: store.appSettings.snapshotIntervalDays) },
                    set: { opt in
                        Task {
                            try? await store.updateAppSettings(.init(
                                snapshotIntervalDays: opt.rawValue,
                                snapshotKeepCount: 5
                            ))
                        }
                    }
                )
            ) {
                Text(store.l10n.t(zhCN: "每日 · 保留 5 份", en: "Daily · Keep 5")).tag(KSSnapshotScheduleOption.daily)
                Text(store.l10n.t(zhCN: "每周 · 保留 5 份", en: "Weekly · Keep 5")).tag(KSSnapshotScheduleOption.weekly)
                Text(store.l10n.t(zhCN: "关闭", en: "Off")).tag(KSSnapshotScheduleOption.off)
            }

            Button {
                activeSheet = .snapshots
            } label: {
                LabeledContent(
                    store.l10n.t(zhCN: "管理本地加密快照", en: "Manage Local Snapshots"),
                    value: "\(store.snapshots.count) 份"
                )
            }
            .foregroundStyle(.primary)

            Button {
                activeSheet = .vaultTransfer
            } label: {
                LabeledContent(
                    store.l10n.t(zhCN: "导入 / 导出保险库", en: "Import / Export Vault"),
                    value: "JSON / CSV"
                )
            }
            .foregroundStyle(.primary)
        }
    }

    // MARK: - 5. 语言与外观

    private var languageAndAppearanceSection: some View {
        Section(store.l10n.t(
            zhCN: "语言与外观",
            zhTW: "語言與外觀",
            en: "Language & Appearance",
            ja: "言語と外観",
            ko: "언어 및 모양"
        )) {
            Picker(
                store.l10n.t(zhCN: "界面语言", zhTW: "介面語言", en: "Language"),
                selection: Binding(
                    get: { store.appSettings.languageMode },
                    set: { mode in
                        Task { try? await store.updateAppSettings(.init(language: mode.rawValue)) }
                    }
                )
            ) {
                ForEach(KSLanguageMode.allCases) { mode in
                    Text(mode == .system
                         ? store.l10n.t(zhCN: "跟随系统", zhTW: "跟隨系統", en: "System Default")
                         : mode.nativeName)
                        .tag(mode)
                }
            }

            Picker(
                store.l10n.t(zhCN: "外观主题", zhTW: "外觀主題", en: "Appearance"),
                selection: Binding(
                    get: { store.appSettings.themeMode },
                    set: { mode in
                        Task { try? await store.updateAppSettings(.init(theme: mode.rawValue)) }
                    }
                )
            ) {
                Text(store.l10n.t(zhCN: "浅色", zhTW: "淺色", en: "Light")).tag(KSThemeMode.light)
                Text(store.l10n.t(zhCN: "深色", zhTW: "深色", en: "Dark")).tag(KSThemeMode.dark)
                Text(store.l10n.t(zhCN: "跟随系统", zhTW: "跟隨系統", en: "System")).tag(KSThemeMode.system)
            }

            Toggle(
                store.l10n.t(zhCN: "显示网站图标 (Favicon)", en: "Show Website Icons (Favicon)"),
                isOn: Binding(
                    get: { store.session.faviconEnabled },
                    set: { val in
                        Task { try? await store.updatePreferences(.init(faviconEnabled: val)) }
                    }
                )
            )

            Toggle(
                store.l10n.t(zhCN: "Liquid Glass 动态透明质感", en: "Liquid Glass Vibrancy"),
                isOn: Binding(
                    get: { store.session.vibrancyEnabled },
                    set: { val in
                        Task { try? await store.updatePreferences(.init(vibrancyEnabled: val)) }
                    }
                )
            )
        }
    }

    // MARK: - 6. 关于与危险操作

    private var aboutAndDangerSection: some View {
        Section(store.l10n.t(
            zhCN: "关于与危险操作",
            zhTW: "關於與危險操作",
            en: "About & Danger Zone"
        )) {
            LabeledContent(
                store.l10n.t(zhCN: "版本与内核", en: "Version & Core"),
                value: "v\(AppConfig.appVersion) · keysmith-core"
            )
            .font(.subheadline)

            Button {
                store.lock(reason: "settings_manual")
                onClose()
            } label: {
                Text(store.l10n.t(zhCN: "立即锁定保险库", zhTW: "立即鎖定保險庫", en: "Lock Vault Now"))
                    .frame(maxWidth: .infinity, alignment: .center)
                    .fontWeight(.semibold)
            }
            .tint(KeysmithColors.accent)

            Button(role: .destructive) {
                showClearCacheLogoutConfirm = true
            } label: {
                Text(store.l10n.t(
                    zhCN: "清除本地缓存并退出登录",
                    zhTW: "清除本機快取並登出",
                    en: "Clear Local Cache & Sign Out"
                ))
                .frame(maxWidth: .infinity, alignment: .center)
                .fontWeight(.semibold)
            }
        }
    }

    // MARK: - Helpers

    private var accountInitials: String {
        let base = store.session.displayName.isEmpty ? store.session.email : store.session.displayName
        let parts = base.split(separator: " ")
        if parts.count >= 2 {
            return String(parts[0].prefix(1) + parts[1].prefix(1)).uppercased()
        }
        return String(base.prefix(2)).uppercased()
    }

    private func hostDisplay(_ urlStr: String) -> String {
        URL(string: urlStr)?.host ?? urlStr
    }

    private var formattedSyncTime: String {
        let raw = store.syncStatus.lastSyncAt.isEmpty ? store.session.lastSyncAt : store.syncStatus.lastSyncAt
        if raw.isEmpty { return store.l10n.t(zhCN: "从未", en: "Never") }
        return String(raw.prefix(19)).replacingOccurrences(of: "T", with: " ")
    }

    private func biometricMaxDaysLabel(_ opt: KSBiometricMaxDaysOption) -> String {
        switch opt {
        case .everyUnlock: return store.l10n.t(zhCN: "每次解锁", en: "Every Unlock")
        case .day1: return store.l10n.t(zhCN: "1 天", en: "1 day")
        case .days7: return store.l10n.t(zhCN: "7 天", en: "7 days")
        case .days14: return store.l10n.t(zhCN: "14 天", en: "14 days")
        case .days30: return store.l10n.t(zhCN: "30 天", en: "30 days")
        }
    }

    private func trashPurgeLabel(_ opt: KSTrashAutoPurgeOption) -> String {
        switch opt {
        case .days7: return store.l10n.t(zhCN: "7 天", en: "7 days")
        case .days30: return store.l10n.t(zhCN: "30 天", en: "30 days")
        case .days90: return store.l10n.t(zhCN: "90 天", en: "90 days")
        case .never: return store.l10n.t(zhCN: "永不", en: "Never")
        }
    }
}

private enum SettingsSheet: String, Identifiable {
    case accounts
    case vaults
    case emergencyKit
    case autofillGuide
    case domains
    case cxfExchange
    case snapshots
    case vaultTransfer

    var id: String { rawValue }
}
