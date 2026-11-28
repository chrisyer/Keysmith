import Foundation
import SwiftUI

struct PasskeyApprovalView: View {
    enum Mode {
        case assertion(rpId: String, userName: String, credentialId: Data, clientDataHash: Data)
        case registration(
            rpId: String,
            rpName: String,
            userId: Data,
            userName: String,
            userDisplayName: String,
            clientDataHash: Data
        )
    }

    let adapter: KeysmithCoreAdapter
    let mode: Mode
    let onConfirmAssertion: (Data, String, Data) async -> Void
    let onConfirmRegistration: (Data, String, String, Data, String, String?) async -> Void
    let onCancel: () async -> Void

    @State private var sessionState = KSSessionState()
    @State private var loginItems: [KSItemSummary] = []
    @State private var selectedTargetItemId: String? = nil
    @State private var masterPassword = ""
    @State private var isBusy = false
    @State private var errorMessage: String?

    private let l10n = KSLocalizedStrings(languageCode: "system")
    private let accentColor = Color(red: 5.0 / 255.0, green: 114.0 / 255.0, blue: 236.0 / 255.0)

    private var biometryKind: KSBiometryKind {
        AppleBiometricKeyStore.shared.currentBiometryKind()
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 18) {
                headerCard

                if case .registration(let rpId, _, _, _, _, _) = mode, sessionState.status == .unlocked {
                    targetItemPicker(rpId: rpId)
                }

                if sessionState.status != .unlocked {
                    VStack(spacing: 12) {
                        if sessionState.biometricEnabled {
                            Button {
                                Task { await unlockAndProceedWithBiometric() }
                            } label: {
                                Label(confirmButtonTitle, systemImage: biometryKind.systemImage)
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.borderedProminent)
                            .controlSize(.large)
                            .tint(accentColor)
                        }

                        HStack(spacing: 8) {
                            SecureField(l10n.t(zhCN: "或输入主密码确认", en: "Or enter master password"), text: $masterPassword)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 10)
                                .background(Color(.tertiarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                            Button(l10n.t(zhCN: "确认", en: "Confirm")) {
                                Task { await unlockAndProceedWithPassword() }
                            }
                            .buttonStyle(.bordered)
                            .disabled(masterPassword.isEmpty)
                        }
                    }
                } else {
                    Button {
                        Task { await executeConfirmedPasskeyAction() }
                    } label: {
                        Label(confirmButtonTitle, systemImage: "checkmark.shield.fill")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .tint(accentColor)
                }

                if let errorMessage {
                    Text(errorMessage)
                        .font(.caption)
                        .foregroundStyle(.red)
                        .multilineTextAlignment(.center)
                }

                Spacer()
            }
            .padding(20)
            .background(Color(.systemGroupedBackground))
            .navigationTitle(isRegistration
                             ? l10n.t(zhCN: "保存通行密钥", en: "Save Passkey")
                             : l10n.t(zhCN: "通行密钥登录", en: "Passkey Sign In"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(l10n.cancel) {
                        Task { await onCancel() }
                    }
                    .disabled(isBusy)
                }
            }
            .disabled(isBusy)
            .task {
                await initializeSession()
            }
        }
    }

    private var isRegistration: Bool {
        if case .registration = mode { return true }
        return false
    }

    private var confirmButtonTitle: String {
        if sessionState.status != .unlocked && sessionState.biometricEnabled {
            let bioName = l10n.biometryName(biometryKind)
            return isRegistration
                ? l10n.t(zhCN: "使用 \(bioName) 创建并保存", en: "Create & Save with \(bioName)")
                : l10n.t(zhCN: "使用 \(bioName) 验证并登录", en: "Sign In with \(bioName)")
        }
        return isRegistration
            ? l10n.t(zhCN: "创建并保存通行密钥", en: "Create & Save Passkey")
            : l10n.t(zhCN: "确认并登录", en: "Sign In with Passkey")
    }

    private var headerCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(accentColor)
                    Image(systemName: "person.badge.key.fill")
                        .font(.headline)
                        .foregroundStyle(.white)
                }
                .frame(width: 40, height: 40)

                VStack(alignment: .leading, spacing: 2) {
                    Text(isRegistration
                         ? l10n.t(zhCN: "保存通行密钥到 Keysmith", en: "Save Passkey to Keysmith")
                         : l10n.t(zhCN: "使用 Keysmith 通行密钥登录", en: "Sign In with Keysmith Passkey"))
                        .font(.subheadline.weight(.bold))
                    switch mode {
                    case .assertion(let rpId, let userName, _, _):
                        Text("\(rpId) · \(userName)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    case .registration(let rpId, _, _, let userName, _, _):
                        Text("\(rpId) · \(userName)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }

            Divider()

            Text(isRegistration
                 ? l10n.t(zhCN: "将生成 ECDSA P-256 通行密钥并写入 App Group 加密库，回主 App 后自动同步。", en: "Generates an ECDSA P-256 passkey stored in your encrypted vault and syncs automatically.")
                 : l10n.t(zhCN: "验证后使用 Apple clientDataHash 完成断言签名，并立即锁定会话。", en: "Signs the WebAuthn assertion using Apple clientDataHash and immediately locks the extension session."))
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(Color(.secondarySystemGroupedBackground))
        )
    }

    private func targetItemPicker(rpId: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(l10n.t(zhCN: "绑定到条目", en: "Attach to Item"))
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)

            Picker(l10n.t(zhCN: "绑定到条目", en: "Attach to Item"), selection: $selectedTargetItemId) {
                Text(l10n.t(zhCN: "新建条目 (\(rpId))", en: "Create New Item (\(rpId))")).tag(String?.none)
                ForEach(loginItems) { item in
                    Text("\(item.title) (\(item.subtitle))").tag(Optional(item.id))
                }
            }
            .pickerStyle(.menu)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func initializeSession() async {
        do {
            try await adapter.initializeIfNeeded()
            sessionState = try await adapter.sessionGetState()
            if sessionState.status == .unlocked {
                await loadCandidateItems()
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func loadCandidateItems() async {
        guard case .registration(let rpId, _, _, _, _, _) = mode else { return }
        let all = (try? await adapter.itemList(filter: KSItemFilter())) ?? []
        let filtered = all.filter { $0.category == .login || $0.category == .passkey }
        loginItems = filtered
        if selectedTargetItemId == nil {
            selectedTargetItemId = filtered.first(where: {
                ($0.primaryUrl?.lowercased().contains(rpId.lowercased()) ?? false)
                    || $0.title.lowercased().contains(rpId.lowercased())
            })?.id
        }
    }

    private func unlockAndProceedWithBiometric() async {
        isBusy = true
        errorMessage = nil
        defer { isBusy = false }
        do {
            sessionState = try await adapter.sessionUnlockBiometric()
            if isRegistration {
                await loadCandidateItems()
            }
            await executeConfirmedPasskeyAction()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func unlockAndProceedWithPassword() async {
        isBusy = true
        errorMessage = nil
        defer { isBusy = false }
        do {
            sessionState = try await adapter.sessionUnlockPassword(masterPassword)
            masterPassword = ""
            if isRegistration {
                await loadCandidateItems()
            }
            await executeConfirmedPasskeyAction()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func executeConfirmedPasskeyAction() async {
        isBusy = true
        switch mode {
        case .assertion(let rpId, _, let credentialId, let clientDataHash):
            await onConfirmAssertion(clientDataHash, rpId, credentialId)
        case .registration(let rpId, let rpName, let userId, let userName, _, let clientDataHash):
            await onConfirmRegistration(
                clientDataHash,
                rpId,
                rpName,
                userId,
                userName,
                selectedTargetItemId
            )
        }
    }
}
