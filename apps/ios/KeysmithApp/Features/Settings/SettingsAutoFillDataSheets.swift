import AuthenticationServices
import SwiftUI
import UIKit
import UniformTypeIdentifiers

// MARK: - AutoFill / Passkey / TextToInsert Status & Guide Sheet

struct SettingsAutoFillGuideSheet: View {
    @Bindable var store: KeysmithStore
    @Binding var autoFillEnabled: Bool
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                #if KEYSMITH_PERSONAL_BUILD
                Section(store.l10n.t(zhCN: "当前构建说明", en: "Personal Build Notice")) {
                    Label(
                        store.l10n.t(
                            zhCN: "当前为 Personal Team 签名调试构建，未嵌入系统 AutoFill、Passkey Provider 与控制中心小组件扩展。",
                            en: "This Personal Team build does not bundle the system AutoFill, Passkey Provider, or Control Widget extensions."
                        ),
                        systemImage: "info.circle.fill"
                    )
                    .font(.subheadline)
                    .foregroundStyle(KeysmithColors.warning)

                    Text(store.l10n.t(
                        zhCN: "如需测试系统自动填充与 Passkey，请使用包含 App Group 权益的 KeysmithApp 目标编译。",
                        en: "To use system AutoFill & Passkey extensions, build the KeysmithApp target with Apple Developer App Group entitlements."
                    ))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
                #else
                Section(store.l10n.t(zhCN: "当前扩展能力状态", en: "Extension Capabilities")) {
                    statusRow(
                        title: store.l10n.t(zhCN: "系统自动填充服务", en: "System AutoFill Service"),
                        subtitle: autoFillEnabled
                            ? store.l10n.t(zhCN: "已在系统设置中启用 Keysmith", en: "Keysmith is enabled in System Settings")
                            : store.l10n.t(zhCN: "尚未在系统设置中开启", en: "Not enabled in System Settings yet"),
                        ok: autoFillEnabled
                    )
                    statusRow(title: "ProvidesPasswords", subtitle: store.l10n.t(zhCN: "QuickType 键盘栏密码建议与填充", en: "QuickType password suggestions and fill"), ok: true)
                    statusRow(title: "ProvidesPasskeys", subtitle: store.l10n.t(zhCN: "无密码 Passkey 注册与登录断言", en: "Passkey registration and sign-in assertions"), ok: true)
                    statusRow(title: "ProvidesOneTimeCodes", subtitle: store.l10n.t(zhCN: "6 位 TOTP 动态验证码原生推荐", en: "Native 6-digit TOTP code suggestions"), ok: true)
                    statusRow(title: "ProvidesTextToInsert", subtitle: store.l10n.t(zhCN: "任意文本框插入卡号、CVV 与身份信息", en: "Insert cards, CVV, and identity fields anywhere"), ok: true)
                }

                Section(store.l10n.t(zhCN: "开启指引", en: "Setup Guide")) {
                    Text(store.l10n.t(zhCN: "1. 打开系统「设置 → 通用 → 自动填充与密码」", en: "1. Open iOS Settings -> General -> AutoFill & Passwords"))
                    Text(store.l10n.t(zhCN: "2. 打开「自动填充密码和通行密钥」开关", en: "2. Enable AutoFill Passwords and Passkeys"))
                    Text(store.l10n.t(zhCN: "3. 在填充来源中勾选「Keysmith」，并将验证码来源设为 Keysmith", en: "3. Select Keysmith for passwords and verification codes"))
                }
                .font(.subheadline)

                Section {
                    Button {
                        if let url = URL(string: UIApplication.openSettingsURLString) {
                            UIApplication.shared.open(url)
                        }
                    } label: {
                        Label(store.l10n.t(zhCN: "前往 iOS 系统设置", en: "Open iOS Settings"), systemImage: "arrow.up.forward.app")
                    }

                    Button {
                        Task {
                            await CredentialIdentitySync.shared.sync(items: store.items)
                            let state = await ASCredentialIdentityStore.shared.state()
                            autoFillEnabled = state.isEnabled
                            store.showToast(store.l10n.t(zhCN: "已刷新系统自动填充索引", en: "Refreshed system AutoFill index"))
                        }
                    } label: {
                        Label(store.l10n.t(zhCN: "重新同步系统凭证索引", en: "Resync System Credential Index"), systemImage: "arrow.triangle.2.circlepath")
                    }
                }
                #endif
            }
            .navigationTitle(store.l10n.t(zhCN: "自动填充与通行密钥", en: "AutoFill & Passkeys"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(store.l10n.done) { dismiss() }
                }
            }
        }
    }

    private func statusRow(title: String, subtitle: String, ok: Bool) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.subheadline.weight(.medium))
                Text(subtitle).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Image(systemName: ok ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                .foregroundStyle(ok ? KeysmithColors.success : KeysmithColors.warning)
        }
    }
}

// MARK: - Equivalent & Disabled AutoFill Domains Editor

struct SettingsDomainsSheet: View {
    @Bindable var store: KeysmithStore
    @Environment(\.dismiss) private var dismiss

    @State private var newEquivalentGroupText = ""
    @State private var newDisabledDomain = ""

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(Array(store.appSettings.customEquivalentDomains.enumerated()), id: \.offset) { idx, group in
                        Text(group.joined(separator: " ↔ "))
                            .font(.subheadline.monospaced())
                            .swipeActions {
                                Button(store.l10n.t(zhCN: "删除", en: "Delete"), role: .destructive) {
                                    var updated = store.appSettings.customEquivalentDomains
                                    updated.remove(at: idx)
                                    Task { try? await store.updateAppSettings(.init(customEquivalentDomains: updated)) }
                                }
                            }
                    }

                    HStack {
                        TextField(store.l10n.t(zhCN: "例如：apple.com, icloud.com", en: "e.g. apple.com, icloud.com"), text: $newEquivalentGroupText)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                        Button(store.l10n.t(zhCN: "添加", en: "Add")) {
                            let domains = newEquivalentGroupText
                                .split(separator: ",")
                                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
                                .filter { !$0.isEmpty }
                            guard domains.count >= 2 else { return }
                            var updated = store.appSettings.customEquivalentDomains
                            updated.append(domains)
                            newEquivalentGroupText = ""
                            Task { try? await store.updateAppSettings(.init(customEquivalentDomains: updated)) }
                        }
                        .disabled(newEquivalentGroupText.split(separator: ",").count < 2)
                    }
                } header: {
                    Text(store.l10n.t(zhCN: "等效域名组（逗号分隔）", en: "Equivalent Domains (comma-separated)"))
                }

                Section {
                    ForEach(store.appSettings.disabledAutofillDomains, id: \.self) { domain in
                        Text(domain)
                            .font(.subheadline.monospaced())
                            .swipeActions {
                                Button(store.l10n.t(zhCN: "删除", en: "Delete"), role: .destructive) {
                                    let updated = store.appSettings.disabledAutofillDomains.filter { $0 != domain }
                                    Task { try? await store.updateAppSettings(.init(disabledAutofillDomains: updated)) }
                                }
                            }
                    }

                    HStack {
                        TextField(store.l10n.t(zhCN: "排除域名（例如：intranet.local）", en: "Excluded domain (e.g. intranet.local)"), text: $newDisabledDomain)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                        Button(store.l10n.t(zhCN: "添加", en: "Add")) {
                            let host = newDisabledDomain.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
                            guard !host.isEmpty else { return }
                            var updated = store.appSettings.disabledAutofillDomains
                            if !updated.contains(host) {
                                updated.append(host)
                            }
                            newDisabledDomain = ""
                            Task { try? await store.updateAppSettings(.init(disabledAutofillDomains: updated)) }
                        }
                        .disabled(newDisabledDomain.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                } header: {
                    Text(store.l10n.t(zhCN: "禁用自动填充站点", en: "Excluded Domains"))
                }
            }
            .navigationTitle(store.l10n.t(zhCN: "域名匹配规则", en: "Domain Matching Rules"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(store.l10n.done) { dismiss() }
                }
            }
        }
    }
}

// MARK: - FIDO CXF Import / Export Sheet

struct SettingsCxfExchangeSheet: View {
    @Bindable var store: KeysmithStore
    @Environment(\.dismiss) private var dismiss

    @State private var showFileImporter = false
    @State private var showTokenPrompt = false
    @State private var importTokenText = ""
    @State private var exportedBundle: String?
    @State private var statusText: String?
    @State private var errorText: String?
    @State private var isBusy = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text(store.l10n.t(
                        zhCN: "通过 iOS 26 FIDO Credential Exchange (CXF) 原生系统安全通道，与 Apple「密码」、1Password 等兼容管理器安全互迁账号与通行密钥。",
                        en: "Securely migrate credentials and passkeys with Apple Passwords, 1Password, and compatible managers using FIDO Credential Exchange (CXF)."
                    ))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Section(store.l10n.t(zhCN: "原生系统互迁 (ASCredentialExchange)", en: "System Exchange (ASCredentialExchange)")) {
                    Button {
                        Task { await runNativeSystemExport() }
                    } label: {
                        Label(store.l10n.t(zhCN: "通过系统 CXF 导出凭证", en: "Export Credentials via CXF"), systemImage: "square.and.arrow.up.on.square")
                    }
                    .disabled(isBusy)

                    Button {
                        showTokenPrompt = true
                    } label: {
                        Label(store.l10n.t(zhCN: "通过系统 CXF 令牌导入 (ASCredentialImportManager)", en: "Import via CXF Token"), systemImage: "key.icloud")
                    }
                    .disabled(isBusy)

                    Button {
                        showFileImporter = true
                    } label: {
                        Label(store.l10n.t(zhCN: "导入 CXF 凭证数据包 (JSON)", en: "Import CXF Bundle (JSON)"), systemImage: "square.and.arrow.down")
                    }
                    .disabled(isBusy)
                }

                Section(store.l10n.t(zhCN: "本地 CXF JSON 快照", en: "Local CXF JSON Bundle")) {
                    Button {
                        Task { await generateCxfJson() }
                    } label: {
                        Label(store.l10n.t(zhCN: "生成加密 CXF JSON Bundle", en: "Generate CXF JSON Bundle"), systemImage: "doc.badge.gearshape")
                    }
                    .disabled(isBusy)

                    if let exportedBundle {
                        ShareLink(item: exportedBundle, preview: SharePreview("keysmith-cxf-export.json")) {
                            Label(store.l10n.t(zhCN: "分享 / 保存 CXF Bundle", en: "Share / Save CXF Bundle"), systemImage: "square.and.arrow.up")
                        }
                    }
                }

                if let statusText {
                    Section {
                        Text(statusText)
                            .font(.caption)
                            .foregroundStyle(KeysmithColors.success)
                    }
                }

                if let errorText {
                    Section {
                        Text(errorText)
                            .font(.caption)
                            .foregroundStyle(KeysmithColors.danger)
                    }
                }
            }
            .navigationTitle(store.l10n.t(zhCN: "FIDO CXF 凭证互迁", en: "FIDO CXF Exchange"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(store.l10n.done) { dismiss() }
                }
            }
            .alert(store.l10n.t(zhCN: "输入系统 CXF 导入令牌", en: "Enter CXF Import Token"), isPresented: $showTokenPrompt) {
                TextField("UUID Token", text: $importTokenText)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                Button(store.l10n.t(zhCN: "导入", en: "Import")) {
                    if let uuid = UUID(uuidString: importTokenText.trimmingCharacters(in: .whitespacesAndNewlines)) {
                        Task { await runNativeSystemImport(token: uuid) }
                    } else {
                        errorText = store.l10n.t(zhCN: "请输入有效的 UUID 令牌", en: "Enter a valid UUID token")
                    }
                }
                Button(store.l10n.cancel, role: .cancel) {}
            }
            .fileImporter(
                isPresented: $showFileImporter,
                allowedContentTypes: [.json, .plainText],
                allowsMultipleSelection: false
            ) { result in
                Task { await handleImportedFile(result) }
            }
        }
    }

    private func runNativeSystemImport(token: UUID) async {
        isBusy = true
        errorText = nil
        statusText = nil
        defer { isBusy = false }

        do {
            let manager = ASCredentialImportManager()
            let credentialData = try await manager.importCredentials(token: token)
            let data = try JSONEncoder().encode(credentialData)
            guard let json = String(data: data, encoding: .utf8) else {
                errorText = store.l10n.t(zhCN: "无法编码 CXF 导入数据", en: "Failed to encode CXF import payload")
                return
            }
            let summary = try await store.importCxfBundleJson(json)
            statusText = store.l10n.t(
                zhCN: "已通过系统 CXF 导入 \(summary.importedItems) 条凭证（跳过 \(summary.skippedItems) 项）。",
                en: "Imported \(summary.importedItems) credentials via CXF (\(summary.skippedItems) skipped)."
            )
        } catch {
            errorText = error.localizedDescription
        }
    }

    private func runNativeSystemExport() async {
        isBusy = true
        errorText = nil
        statusText = nil
        defer { isBusy = false }

        do {
            try await store.verifyUserPresence(reason: store.l10n.t(zhCN: "验证身份以安全导出 FIDO CXF 凭证", en: "Verify identity to export CXF credentials"))
            let bundleJson = try await store.exportCxfBundleJson()
            exportedBundle = bundleJson

            if let window = keyWindow(), let data = bundleJson.data(using: .utf8) {
                let decoded = try JSONDecoder().decode(ASExportedCredentialData.self, from: data)
                let manager = ASCredentialExportManager(presentationAnchor: window)
                _ = try await manager.requestExport(for: nil)
                try await manager.exportCredentials(decoded)
                statusText = store.l10n.t(zhCN: "已通过系统 FIDO CXF 安全通道完成凭证导出。", en: "Exported credentials via FIDO CXF.")
                return
            }
            statusText = store.l10n.t(zhCN: "已生成 CXF Bundle（当前环境未检测到系统接收方，可通过下方分享保存）。", en: "CXF bundle ready. Use Share below to save it.")
        } catch {
            // Also fallback to raw bundle sharing if ASExportedCredentialData schema differs in demo/simulator.
            if exportedBundle != nil {
                statusText = store.l10n.t(
                    zhCN: "已生成 CXF 导出数据，可通过下方按钮导出；系统通道提示：\(error.localizedDescription)",
                    en: "CXF export ready below (system channel note: \(error.localizedDescription))."
                )
            } else {
                errorText = error.localizedDescription
            }
        }
    }

    private func generateCxfJson() async {
        isBusy = true
        errorText = nil
        defer { isBusy = false }
        do {
            try await store.verifyUserPresence(reason: store.l10n.t(zhCN: "验证身份以生成 CXF 数据包", en: "Verify identity to generate CXF bundle"))
            exportedBundle = try await store.exportCxfBundleJson()
            statusText = store.l10n.t(zhCN: "CXF Bundle 已就绪。", en: "CXF bundle is ready.")
        } catch {
            errorText = error.localizedDescription
        }
    }

    private func handleImportedFile(_ result: Result<[URL], Error>) async {
        isBusy = true
        errorText = nil
        statusText = nil
        defer { isBusy = false }
        do {
            let urls = try result.get()
            guard let url = urls.first else { return }
            let access = url.startAccessingSecurityScopedResource()
            defer { if access { url.stopAccessingSecurityScopedResource() } }
            let data = try Data(contentsOf: url)
            guard let json = String(data: data, encoding: .utf8) else {
                errorText = store.l10n.t(zhCN: "无法以 UTF-8 读取所选文件", en: "Unable to read selected file as UTF-8")
                return
            }
            let summary = try await store.importCxfBundleJson(json)
            statusText = store.l10n.t(
                zhCN: "已导入 \(summary.importedItems) 条凭证（跳过 \(summary.skippedItems) 项）。",
                en: "Imported \(summary.importedItems) credentials (\(summary.skippedItems) skipped)."
            )
        } catch {
            errorText = error.localizedDescription
        }
    }

    private func keyWindow() -> UIWindow? {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first(where: \.isKeyWindow)
    }
}

// MARK: - Local Encrypted Snapshots Sheet

struct SettingsSnapshotsSheet: View {
    @Bindable var store: KeysmithStore
    @Environment(\.dismiss) private var dismiss

    @State private var isCreating = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Button {
                        Task {
                            isCreating = true
                            defer { isCreating = false }
                            do {
                                _ = try await store.createSnapshot()
                            } catch {
                                errorMessage = error.localizedDescription
                            }
                        }
                    } label: {
                        HStack {
                            Label(store.l10n.t(zhCN: "立即创建加密快照", en: "Create Encrypted Snapshot Now"), systemImage: "plus.circle.fill")
                            Spacer()
                            if isCreating { ProgressView().controlSize(.small) }
                        }
                    }
                    .disabled(isCreating)
                }

                Section(store.l10n.t(zhCN: "本地快照列表", en: "Local Snapshots")) {
                    if store.snapshots.isEmpty {
                        Text(store.l10n.t(zhCN: "暂无本地加密快照", en: "No local snapshots yet"))
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(store.snapshots) { snap in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(snap.fileName)
                                    .font(.subheadline.weight(.medium))
                                Text(store.l10n.t(
                                    zhCN: "\(snap.itemCount) 条目 · \(snap.vaultCount) 保险库 · \(ByteCountFormatter.string(fromByteCount: Int64(snap.sizeBytes), countStyle: .file))",
                                    en: "\(snap.itemCount) items · \(snap.vaultCount) vaults · \(ByteCountFormatter.string(fromByteCount: Int64(snap.sizeBytes), countStyle: .file))"
                                ))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                Text(String(snap.createdAt.prefix(19)).replacingOccurrences(of: "T", with: " "))
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                            .swipeActions {
                                Button(store.l10n.t(zhCN: "删除", en: "Delete"), role: .destructive) {
                                    Task { try? await store.deleteSnapshot(id: snap.id) }
                                }
                            }
                        }
                    }
                }

                if let errorMessage {
                    Section {
                        Text(errorMessage).font(.caption).foregroundStyle(KeysmithColors.danger)
                    }
                }
            }
            .navigationTitle(store.l10n.t(zhCN: "本地加密快照", en: "Local Encrypted Snapshots"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(store.l10n.done) { dismiss() }
                }
            }
            .task {
                await store.loadSnapshots()
            }
        }
    }
}

// MARK: - Vault Import / Export Sheet

struct SettingsVaultTransferSheet: View {
    @Bindable var store: KeysmithStore
    @Environment(\.dismiss) private var dismiss

    @State private var showImporter = false
    @State private var exportedJson: String?
    @State private var statusMessage: String?
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            List {
                Section(store.l10n.t(zhCN: "导入数据", en: "Import Data")) {
                    Button {
                        showImporter = true
                    } label: {
                        Label(store.l10n.t(zhCN: "导入 Bitwarden JSON / CSV", en: "Import Bitwarden JSON / CSV"), systemImage: "square.and.arrow.down")
                    }
                }

                Section(store.l10n.t(zhCN: "导出保险库", en: "Export Vault")) {
                    let bioName = store.l10n.biometryName(AppleBiometricKeyStore.shared.currentBiometryKind())
                    Button {
                        Task { await prepareExport() }
                    } label: {
                        Label(store.l10n.t(zhCN: "导出 JSON 备份（需\(bioName)确认）", en: "Export JSON Backup (\(bioName) required)"), systemImage: "doc.text")
                    }

                    if let exportedJson {
                        ShareLink(item: exportedJson, preview: SharePreview("keysmith-vault-export.json")) {
                            Label(store.l10n.t(zhCN: "分享 / 存储导出文件", en: "Share / Save Export File"), systemImage: "square.and.arrow.up")
                        }
                    }
                }

                if let statusMessage {
                    Section {
                        Text(statusMessage).font(.caption).foregroundStyle(KeysmithColors.success)
                    }
                }

                if let errorMessage {
                    Section {
                        Text(errorMessage).font(.caption).foregroundStyle(KeysmithColors.danger)
                    }
                }
            }
            .navigationTitle(store.l10n.t(zhCN: "导入 / 导出保险库", en: "Import / Export Vault"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(store.l10n.done) { dismiss() }
                }
            }
            .fileImporter(
                isPresented: $showImporter,
                allowedContentTypes: [.json, .commaSeparatedText, .plainText],
                allowsMultipleSelection: false
            ) { result in
                Task { await handleImport(result) }
            }
        }
    }

    private func prepareExport() async {
        errorMessage = nil
        do {
            try await store.verifyUserPresence(reason: store.l10n.t(zhCN: "验证身份以导出保险库数据", en: "Verify identity to export vault data"))
            var details: [KSItemDetail] = []
            for summary in store.items {
                if let detail = try? await store.getItemDetail(id: summary.id) {
                    details.append(detail)
                }
            }
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            let data = try encoder.encode(details)
            exportedJson = String(data: data, encoding: .utf8)
            statusMessage = store.l10n.t(zhCN: "已生成 \(details.count) 条保险库记录的导出文件。", en: "Prepared export file for \(details.count) items.")
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func handleImport(_ result: Result<[URL], Error>) async {
        errorMessage = nil
        do {
            let urls = try result.get()
            guard let url = urls.first else { return }
            let access = url.startAccessingSecurityScopedResource()
            defer { if access { url.stopAccessingSecurityScopedResource() } }
            let data = try Data(contentsOf: url)
            if let drafts = try? JSONDecoder().decode([KSItemDraft].self, from: data) {
                for draft in drafts {
                    _ = try await store.createItem(draft)
                }
                statusMessage = store.l10n.t(zhCN: "成功导入 \(drafts.count) 条记录。", en: "Imported \(drafts.count) items.")
            } else if let text = String(data: data, encoding: .utf8) {
                let summary = try await store.importCxfBundleJson(text)
                statusMessage = store.l10n.t(zhCN: "成功导入 \(summary.importedItems) 条记录。", en: "Imported \(summary.importedItems) items.")
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
