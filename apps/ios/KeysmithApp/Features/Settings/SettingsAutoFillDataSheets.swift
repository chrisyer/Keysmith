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
                Section("当前扩展能力状态") {
                    statusRow(
                        title: "系统自动填充服务",
                        subtitle: autoFillEnabled ? "已在系统设置中启用 Keysmith" : "尚未在系统设置中开启",
                        ok: autoFillEnabled
                    )
                    statusRow(title: "ProvidesPasswords", subtitle: "QuickType 键盘栏密码建议与填充", ok: true)
                    statusRow(title: "ProvidesPasskeys", subtitle: "无密码 Passkey 注册与登录断言", ok: true)
                    statusRow(title: "ProvidesOneTimeCodes", subtitle: "6 位 TOTP 动态验证码原生推荐", ok: true)
                    statusRow(title: "ProvidesTextToInsert", subtitle: "任意文本框插入卡号、CVV 与身份信息", ok: true)
                }

                Section("开启指引") {
                    Text("1. 打开系统「设置 → 通用 → 自动填充与密码」")
                    Text("2. 打开「自动填充密码和通行密钥」开关")
                    Text("3. 在填充来源中勾选「Keysmith」，并将验证码来源设为 Keysmith")
                }
                .font(.subheadline)

                Section {
                    Button {
                        if let url = URL(string: UIApplication.openSettingsURLString) {
                            UIApplication.shared.open(url)
                        }
                    } label: {
                        Label("前往 iOS 系统设置", systemImage: "arrow.up.forward.app")
                    }

                    Button {
                        Task {
                            await CredentialIdentitySync.shared.sync(items: store.items)
                            let state = await ASCredentialIdentityStore.shared.state()
                            autoFillEnabled = state.isEnabled
                            store.showToast("已刷新系统自动填充索引")
                        }
                    } label: {
                        Label("重新同步系统凭证索引", systemImage: "arrow.triangle.2.circlepath")
                    }
                }
            }
            .navigationTitle("自动填充与通行密钥")
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
                                Button("删除", role: .destructive) {
                                    var updated = store.appSettings.customEquivalentDomains
                                    updated.remove(at: idx)
                                    Task { try? await store.updateAppSettings(.init(customEquivalentDomains: updated)) }
                                }
                            }
                    }

                    HStack {
                        TextField("例如：apple.com, icloud.com", text: $newEquivalentGroupText)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                        Button("添加") {
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
                    Text("等效域名组（逗号分隔）")
                }

                Section {
                    ForEach(store.appSettings.disabledAutofillDomains, id: \.self) { domain in
                        Text(domain)
                            .font(.subheadline.monospaced())
                            .swipeActions {
                                Button("删除", role: .destructive) {
                                    let updated = store.appSettings.disabledAutofillDomains.filter { $0 != domain }
                                    Task { try? await store.updateAppSettings(.init(disabledAutofillDomains: updated)) }
                                }
                            }
                    }

                    HStack {
                        TextField("排除域名（例如：intranet.local）", text: $newDisabledDomain)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                        Button("添加") {
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
                    Text("禁用自动填充站点")
                }
            }
            .navigationTitle("域名匹配规则")
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
                    Text("通过 iOS 26 FIDO Credential Exchange (CXF) 原生系统安全通道，与 Apple「密码」、1Password 等兼容管理器安全互迁账号与通行密钥。")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Section("原生系统互迁 (ASCredentialExchange)") {
                    Button {
                        Task { await runNativeSystemExport() }
                    } label: {
                        Label("通过系统 CXF 导出凭证", systemImage: "square.and.arrow.up.on.square")
                    }
                    .disabled(isBusy)

                    Button {
                        showTokenPrompt = true
                    } label: {
                        Label("通过系统 CXF 令牌导入 (ASCredentialImportManager)", systemImage: "key.icloud")
                    }
                    .disabled(isBusy)

                    Button {
                        showFileImporter = true
                    } label: {
                        Label("导入 CXF 凭证数据包 (JSON)", systemImage: "square.and.arrow.down")
                    }
                    .disabled(isBusy)
                }

                Section("本地 CXF JSON 快照") {
                    Button {
                        Task { await generateCxfJson() }
                    } label: {
                        Label("生成加密 CXF JSON Bundle", systemImage: "doc.badge.gearshape")
                    }
                    .disabled(isBusy)

                    if let exportedBundle {
                        ShareLink(item: exportedBundle, preview: SharePreview("keysmith-cxf-export.json")) {
                            Label("分享 / 保存 CXF Bundle", systemImage: "square.and.arrow.up")
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
            .navigationTitle("FIDO CXF 凭证互迁")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(store.l10n.done) { dismiss() }
                }
            }
            .alert("输入系统 CXF 导入令牌", isPresented: $showTokenPrompt) {
                TextField("UUID Token", text: $importTokenText)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                Button("导入") {
                    if let uuid = UUID(uuidString: importTokenText.trimmingCharacters(in: .whitespacesAndNewlines)) {
                        Task { await runNativeSystemImport(token: uuid) }
                    } else {
                        errorText = "请输入有效的 UUID 令牌"
                    }
                }
                Button("取消", role: .cancel) {}
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
                errorText = "无法编码 CXF 导入数据"
                return
            }
            let summary = try await store.importCxfBundleJson(json)
            statusText = "已通过系统 CXF 导入 \(summary.importedItems) 条凭证（跳过 \(summary.skippedItems) 项）。"
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
            try await store.verifyUserPresence(reason: "验证身份以安全导出 FIDO CXF 凭证")
            let bundleJson = try await store.exportCxfBundleJson()
            exportedBundle = bundleJson

            if let window = keyWindow(), let data = bundleJson.data(using: .utf8) {
                let decoded = try JSONDecoder().decode(ASExportedCredentialData.self, from: data)
                let manager = ASCredentialExportManager(presentationAnchor: window)
                _ = try await manager.requestExport(for: nil)
                try await manager.exportCredentials(decoded)
                statusText = "已通过系统 FIDO CXF 安全通道完成凭证导出。"
                return
            }
            statusText = "已生成 CXF Bundle（当前环境未检测到系统接收方，可通过下方分享保存）。"
        } catch {
            // Also fallback to raw bundle sharing if ASExportedCredentialData schema differs in demo/simulator.
            if exportedBundle != nil {
                statusText = "已生成 CXF 导出数据，可通过下方按钮导出；系统通道提示：\(error.localizedDescription)"
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
            try await store.verifyUserPresence(reason: "验证身份以生成 CXF 数据包")
            exportedBundle = try await store.exportCxfBundleJson()
            statusText = "CXF Bundle 已就绪。"
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
                errorText = "无法以 UTF-8 读取所选文件"
                return
            }
            let summary = try await store.importCxfBundleJson(json)
            statusText = "已导入 \(summary.importedItems) 条凭证（跳过 \(summary.skippedItems) 项）。"
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
                            Label("立即创建加密快照", systemImage: "plus.circle.fill")
                            Spacer()
                            if isCreating { ProgressView().controlSize(.small) }
                        }
                    }
                    .disabled(isCreating)
                }

                Section("本地快照列表") {
                    if store.snapshots.isEmpty {
                        Text("暂无本地加密快照")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(store.snapshots) { snap in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(snap.fileName)
                                    .font(.subheadline.weight(.medium))
                                Text("\(snap.itemCount) 条目 · \(snap.vaultCount) 保险库 · \(ByteCountFormatter.string(fromByteCount: Int64(snap.sizeBytes), countStyle: .file))")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                Text(String(snap.createdAt.prefix(19)).replacingOccurrences(of: "T", with: " "))
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                            .swipeActions {
                                Button("删除", role: .destructive) {
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
            .navigationTitle("本地加密快照")
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
                Section("导入数据") {
                    Button {
                        showImporter = true
                    } label: {
                        Label("导入 Bitwarden JSON / CSV", systemImage: "square.and.arrow.down")
                    }
                }

                Section("导出保险库") {
                    Button {
                        Task { await prepareExport() }
                    } label: {
                        Label("导出 JSON 备份（需 Face ID 确认）", systemImage: "doc.text")
                    }

                    if let exportedJson {
                        ShareLink(item: exportedJson, preview: SharePreview("keysmith-vault-export.json")) {
                            Label("分享 / 存储导出文件", systemImage: "square.and.arrow.up")
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
            .navigationTitle("导入 / 导出保险库")
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
            try await store.verifyUserPresence(reason: "验证身份以导出保险库数据")
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
            statusMessage = "已生成 \(details.count) 条保险库记录的导出文件。"
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
                statusMessage = "成功导入 \(drafts.count) 条记录。"
            } else if let text = String(data: data, encoding: .utf8) {
                let summary = try await store.importCxfBundleJson(text)
                statusMessage = "成功导入 \(summary.importedItems) 条记录。"
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
