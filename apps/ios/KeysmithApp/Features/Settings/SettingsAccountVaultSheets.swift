import SwiftUI

// MARK: - Accounts Switch / Add Sheet

struct SettingsAccountsSheet: View {
    @Bindable var store: KeysmithStore
    @Environment(\.dismiss) private var dismiss
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            List {
                Section(store.l10n.t(zhCN: "已登录账号", zhTW: "已登入帳戶", en: "Signed-in Accounts")) {
                    if store.accounts.isEmpty {
                        Text(store.session.email.isEmpty
                             ? store.l10n.t(zhCN: "当前未登录账号", en: "No active account")
                             : store.session.email)
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(store.accounts) { account in
                            Button {
                                Task {
                                    do {
                                        try await store.switchAccount(account.id)
                                        dismiss()
                                    } catch {
                                        errorMessage = error.localizedDescription
                                    }
                                }
                            } label: {
                                HStack {
                                    VStack(alignment: .leading, spacing: 3) {
                                        HStack(spacing: 6) {
                                            Text(account.displayName.isEmpty ? account.email : account.displayName)
                                                .font(.subheadline.weight(.semibold))
                                            Text(account.kdfType)
                                                .font(.caption2)
                                                .padding(.horizontal, 6)
                                                .padding(.vertical, 1)
                                                .background(Color(.tertiarySystemFill), in: Capsule())
                                        }
                                        Text("\(account.email) · \(account.serverUrl)")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    if account.isActive {
                                        Image(systemName: "checkmark.circle.fill")
                                            .foregroundStyle(KeysmithColors.success)
                                    }
                                }
                            }
                            .foregroundStyle(.primary)
                        }
                    }
                }

                Section {
                    Button {
                        Task {
                            await store.logout(clearLocalCache: false)
                            dismiss()
                        }
                    } label: {
                        Label(
                            store.l10n.t(zhCN: "添加或登录其他 Vaultwarden 账号", en: "Add or Sign In to Another Account"),
                            systemImage: "person.badge.plus"
                        )
                    }
                } footer: {
                    Text(store.l10n.t(
                        zhCN: "切换前会保留当前账号的离线密文库与本地隔离配置。",
                        en: "Your current account's offline encrypted vault stays isolated when switching."
                    ))
                }

                if let errorMessage {
                    Section {
                        Text(errorMessage)
                            .font(.caption)
                            .foregroundStyle(KeysmithColors.danger)
                    }
                }
            }
            .navigationTitle(store.l10n.t(zhCN: "账号管理", zhTW: "帳戶管理", en: "Accounts"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(store.l10n.done) { dismiss() }
                }
            }
        }
    }
}

// MARK: - Manage Vaults & Travel Safe Sheet

struct SettingsVaultsSheet: View {
    @Bindable var store: KeysmithStore
    @Environment(\.dismiss) private var dismiss

    @State private var newVaultName = ""
    @State private var renamingVault: KSVault?
    @State private var renameText = ""
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            List {
                Section(store.l10n.t(zhCN: "新建保险库", zhTW: "新增保險庫", en: "New Vault")) {
                    HStack {
                        TextField(store.l10n.t(zhCN: "保险库名称", en: "Vault name"), text: $newVaultName)
                        Button(store.l10n.t(zhCN: "创建", en: "Create")) {
                            let name = newVaultName.trimmingCharacters(in: .whitespacesAndNewlines)
                            guard !name.isEmpty else { return }
                            Task {
                                do {
                                    _ = try await store.createVault(name: name)
                                    newVaultName = ""
                                } catch {
                                    errorMessage = error.localizedDescription
                                }
                            }
                        }
                        .disabled(newVaultName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }

                Section(store.l10n.t(zhCN: "保险库与旅行安全标记", en: "Vaults & Travel Safe")) {
                    ForEach(store.vaults) { vault in
                        VStack(alignment: .leading, spacing: 8) {
                            HStack {
                                Circle()
                                    .fill(KeysmithColors.fromHex(vault.color))
                                    .frame(width: 10, height: 10)
                                Text(vault.name)
                                    .font(.subheadline.weight(.semibold))
                                if vault.isDefault {
                                    Text(store.l10n.t(zhCN: "默认", en: "Default"))
                                        .font(.caption2)
                                        .padding(.horizontal, 6)
                                        .padding(.vertical, 1)
                                        .background(Color(.tertiarySystemFill), in: Capsule())
                                }
                                if vault.isOrganization {
                                    Text(store.l10n.t(zhCN: "组织", en: "Org"))
                                        .font(.caption2)
                                        .padding(.horizontal, 6)
                                        .padding(.vertical, 1)
                                        .background(KeysmithColors.accent.opacity(0.14), in: Capsule())
                                        .foregroundStyle(KeysmithColors.accent)
                                }
                                Spacer()
                                Text(store.l10n.t(zhCN: "\(vault.itemCount) 项", en: "\(vault.itemCount) items"))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }

                            Toggle(
                                store.l10n.t(zhCN: "旅行安全 (Travel Safe)", en: "Travel Safe"),
                                isOn: Binding(
                                    get: { vault.travelSafe },
                                    set: { val in
                                        Task {
                                            do {
                                                _ = try await store.setVaultTravelSafe(id: vault.id, travelSafe: val)
                                            } catch {
                                                errorMessage = error.localizedDescription
                                            }
                                        }
                                    }
                                )
                            )
                            .font(.caption)
                        }
                        .swipeActions(edge: .trailing) {
                            if !vault.isDefault && !vault.isOrganization {
                                Button(store.l10n.t(zhCN: "删除", en: "Delete"), role: .destructive) {
                                    Task {
                                        do {
                                            try await store.deleteVault(id: vault.id)
                                        } catch {
                                            errorMessage = error.localizedDescription
                                        }
                                    }
                                }
                            }
                            if !vault.isOrganization {
                                Button(store.l10n.t(zhCN: "重命名", en: "Rename")) {
                                    renamingVault = vault
                                    renameText = vault.name
                                }
                                .tint(KeysmithColors.accent)
                            }
                        }
                    }
                }

                if let errorMessage {
                    Section {
                        Text(errorMessage)
                            .font(.caption)
                            .foregroundStyle(KeysmithColors.danger)
                    }
                }
            }
            .navigationTitle(store.l10n.t(zhCN: "管理保险库", en: "Manage Vaults"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(store.l10n.done) { dismiss() }
                }
            }
            .alert(store.l10n.t(zhCN: "重命名保险库", en: "Rename Vault"), isPresented: Binding(
                get: { renamingVault != nil },
                set: { if !$0 { renamingVault = nil } }
            )) {
                TextField(store.l10n.t(zhCN: "名称", en: "Name"), text: $renameText)
                Button(store.l10n.save) {
                    guard let vault = renamingVault else { return }
                    let trimmed = renameText.trimmingCharacters(in: .whitespacesAndNewlines)
                    guard !trimmed.isEmpty else { return }
                    Task {
                        do {
                            _ = try await store.renameVault(id: vault.id, name: trimmed)
                            renamingVault = nil
                        } catch {
                            errorMessage = error.localizedDescription
                        }
                    }
                }
                Button(store.l10n.cancel, role: .cancel) { renamingVault = nil }
            }
        }
    }
}

// MARK: - Emergency Kit Sheet

struct SettingsEmergencyKitSheet: View {
    @Bindable var store: KeysmithStore
    @Environment(\.dismiss) private var dismiss

    @State private var kit: KSExportResult?
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text(store.l10n.t(
                        zhCN: "Emergency Kit 包含服务器地址、登录邮箱、KDF 配置与恢复指引（不包含主密码明文）。建议打印或离线安全保存。",
                        en: "Your Emergency Kit contains your server URL, email, KDF settings, and recovery notes (never your master password). Keep a printed or offline copy."
                    ))
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    if let kit {
                        Text(kit.content)
                            .font(.system(.caption, design: .monospaced))
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(14)
                            .background(
                                RoundedRectangle(cornerRadius: 14, style: .continuous)
                                    .fill(Color(.secondarySystemGroupedBackground))
                            )

                        HStack(spacing: 10) {
                            Button {
                                store.copyToClipboard(kit.content, label: "Emergency Kit", isSensitive: true)
                            } label: {
                                Label(store.l10n.t(zhCN: "复制内容", en: "Copy"), systemImage: "doc.on.doc")
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.bordered)

                            ShareLink(item: kit.content, preview: SharePreview(kit.fileName)) {
                                Label(store.l10n.t(zhCN: "导出文件", en: "Export File"), systemImage: "square.and.arrow.up")
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(KeysmithColors.accent)
                        }
                    } else if let errorMessage {
                        Text(errorMessage)
                            .font(.caption)
                            .foregroundStyle(KeysmithColors.danger)
                    } else {
                        ProgressView(store.l10n.t(zhCN: "正在生成 Emergency Kit...", en: "Generating Emergency Kit..."))
                            .frame(maxWidth: .infinity, minHeight: 140)
                    }
                }
                .padding(16)
            }
            .navigationTitle("Emergency Kit")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(store.l10n.done) { dismiss() }
                }
            }
            .task {
                do {
                    kit = try await store.exportEmergencyKit()
                } catch {
                    errorMessage = error.localizedDescription
                }
            }
        }
    }
}
