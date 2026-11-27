import SwiftUI

// MARK: - Accounts Switch / Add Sheet

struct SettingsAccountsSheet: View {
    @Bindable var store: KeysmithStore
    @Environment(\.dismiss) private var dismiss
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            List {
                Section("已登录账号") {
                    if store.accounts.isEmpty {
                        Text(store.session.email.isEmpty ? "当前未登录账号" : store.session.email)
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
                        Label("添加或登录其他 Vaultwarden 账号", systemImage: "person.badge.plus")
                    }
                } footer: {
                    Text("切换前会保留当前账号的离线密文库与本地隔离配置。")
                }

                if let errorMessage {
                    Section {
                        Text(errorMessage)
                            .font(.caption)
                            .foregroundStyle(KeysmithColors.danger)
                    }
                }
            }
            .navigationTitle("账号管理")
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
                Section("新建保险库") {
                    HStack {
                        TextField("保险库名称", text: $newVaultName)
                        Button("创建") {
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

                Section("保险库与旅行安全标记") {
                    ForEach(store.vaults) { vault in
                        VStack(alignment: .leading, spacing: 8) {
                            HStack {
                                Circle()
                                    .fill(KeysmithColors.fromHex(vault.color))
                                    .frame(width: 10, height: 10)
                                Text(vault.name)
                                    .font(.subheadline.weight(.semibold))
                                if vault.isDefault {
                                    Text("默认")
                                        .font(.caption2)
                                        .padding(.horizontal, 6)
                                        .padding(.vertical, 1)
                                        .background(Color(.tertiarySystemFill), in: Capsule())
                                }
                                if vault.isOrganization {
                                    Text("组织")
                                        .font(.caption2)
                                        .padding(.horizontal, 6)
                                        .padding(.vertical, 1)
                                        .background(KeysmithColors.accent.opacity(0.14), in: Capsule())
                                        .foregroundStyle(KeysmithColors.accent)
                                }
                                Spacer()
                                Text("\(vault.itemCount) 项")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }

                            Toggle(
                                "旅行安全 (Travel Safe)",
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
                                Button("删除", role: .destructive) {
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
                                Button("重命名") {
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
            .navigationTitle("管理保险库")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(store.l10n.done) { dismiss() }
                }
            }
            .alert("重命名保险库", isPresented: Binding(
                get: { renamingVault != nil },
                set: { if !$0 { renamingVault = nil } }
            )) {
                TextField("名称", text: $renameText)
                Button("保存") {
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
                Button("取消", role: .cancel) { renamingVault = nil }
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
                    Text("Emergency Kit 包含服务器地址、登录邮箱、KDF 配置与恢复指引（不包含主密码明文）。建议打印或离线安全保存。")
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
                                Label("复制内容", systemImage: "doc.on.doc")
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.bordered)

                            ShareLink(item: kit.content, preview: SharePreview(kit.fileName)) {
                                Label("导出文件", systemImage: "square.and.arrow.up")
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
                        ProgressView("正在生成 Emergency Kit...")
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
