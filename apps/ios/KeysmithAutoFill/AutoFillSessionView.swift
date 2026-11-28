import AuthenticationServices
import Foundation
import SwiftUI

struct AutoFillSessionView: View {
    let adapter: KeysmithCoreAdapter
    let serviceHosts: [String]
    let passkeyParameters: ASPasskeyCredentialRequestParameters?
    let oneTimeCodeOnly: Bool
    var targetItemId: String? = nil
    var fallbackUser: String = ""

    let onSelectPassword: (String, String, String?) async -> Void
    let onSelectOneTimeCode: (String) async -> Void
    let onSelectPasskey: (KSPasskeyListCandidate, ASPasskeyCredentialRequestParameters) async -> Void
    let onCancel: () async -> Void

    @State private var isUnlocked = false
    @State private var isBusy = false
    @State private var sessionState = KSSessionState()
    @State private var masterPassword = ""
    @State private var useMasterPassword = false
    @State private var searchQuery = ""
    @State private var items: [KSItemSummary] = []
    @State private var passkeys: [KSPasskeyListCandidate] = []
    @State private var errorMessage: String?

    private let l10n = KSLocalizedStrings(languageCode: "system")
    private let accentColor = Color(red: 5.0 / 255.0, green: 114.0 / 255.0, blue: 236.0 / 255.0)

    private var biometryKind: KSBiometryKind {
        AppleBiometricKeyStore.shared.currentBiometryKind()
    }

    var body: some View {
        NavigationStack {
            Group {
                if !isUnlocked {
                    unlockGateView
                } else {
                    credentialListView
                }
            }
            .navigationTitle(oneTimeCodeOnly
                             ? l10n.t(zhCN: "选择验证码", en: "Choose Verification Code")
                             : l10n.t(zhCN: "Keysmith 自动填充", en: "Keysmith AutoFill"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(l10n.cancel) {
                        Task { await onCancel() }
                    }
                    .disabled(isBusy)
                }
            }
            .task {
                await bootstrapExtensionSession()
            }
        }
    }

    private var unlockGateView: some View {
        VStack(spacing: 20) {
            Spacer()

            ZStack {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(accentColor)
                Image(systemName: "key.fill")
                    .font(.system(size: 26, weight: .bold))
                    .foregroundStyle(.white)
            }
            .frame(width: 60, height: 60)

            VStack(spacing: 4) {
                Text(l10n.t(zhCN: "解锁 Keysmith 保险库", en: "Unlock Keysmith Vault"))
                    .font(.headline)
                if !serviceHosts.isEmpty {
                    Text(serviceHosts.joined(separator: " · "))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            if sessionState.status == .unauthenticated {
                Text(l10n.t(
                    zhCN: "请先打开 Keysmith 主应用登录账号后再使用自动填充。",
                    en: "Please open the Keysmith app and sign in before using AutoFill."
                ))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)
            } else if sessionState.biometricEnabled && !useMasterPassword {
                VStack(spacing: 14) {
                    Button {
                        Task { await unlockWithBiometric() }
                    } label: {
                        Label(l10n.unlockWithBiometry(biometryKind), systemImage: biometryKind.systemImage)
                            .font(.body.weight(.semibold))
                            .frame(minWidth: 200, maxWidth: 250)
                    }
                    .buttonStyle(.borderedProminent)
                    .buttonBorderShape(.capsule)
                    .controlSize(.large)
                    .tint(accentColor)

                    Button {
                        errorMessage = nil
                        useMasterPassword = true
                    } label: {
                        Text(l10n.t(zhCN: "改用主密码解锁", en: "Use Master Password"))
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(accentColor)
                    }
                    .buttonStyle(.plain)
                }
            } else {
                VStack(spacing: 12) {
                    VStack(spacing: 12) {
                        SecureField(l10n.masterPasswordPlaceholder, text: $masterPassword)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .padding(.horizontal, 14)
                            .padding(.vertical, 11)
                            .background(Color(.tertiarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                            .onSubmit {
                                Task { await unlockWithPassword() }
                            }
                        Button {
                            Task { await unlockWithPassword() }
                        } label: {
                            Text(l10n.unlock)
                                .font(.body.weight(.semibold))
                                .frame(minWidth: 160, maxWidth: 220)
                        }
                        .buttonStyle(.borderedProminent)
                        .buttonBorderShape(.capsule)
                        .controlSize(.large)
                        .tint(accentColor)
                        .disabled(masterPassword.isEmpty)
                    }
                    .padding(16)
                    .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .padding(.horizontal, 24)

                    if sessionState.biometricEnabled {
                        Button {
                            errorMessage = nil
                            useMasterPassword = false
                            Task { await unlockWithBiometric() }
                        } label: {
                            Label(l10n.unlockWithBiometry(biometryKind), systemImage: biometryKind.systemImage)
                                .font(.subheadline.weight(.medium))
                                .foregroundStyle(accentColor)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }

            if let errorMessage {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)
            }

            Spacer()
        }
        .background(Color(.systemGroupedBackground))
        .disabled(isBusy)
    }

    private var credentialListView: some View {
        List {
            if let passkeyParameters, !passkeys.isEmpty {
                Section(l10n.t(
                    zhCN: "通行密钥 Passkeys (\(passkeyParameters.relyingPartyIdentifier))",
                    en: "Passkeys (\(passkeyParameters.relyingPartyIdentifier))"
                )) {
                    ForEach(passkeys) { pk in
                        Button {
                            Task {
                                isBusy = true
                                await onSelectPasskey(pk, passkeyParameters)
                            }
                        } label: {
                            HStack(spacing: 10) {
                                ZStack {
                                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                                        .fill(Color.teal)
                                    Image(systemName: "person.badge.key.fill")
                                        .font(.caption.weight(.semibold))
                                        .foregroundStyle(.white)
                                }
                                .frame(width: 30, height: 30)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(pk.itemTitle)
                                        .font(.subheadline.weight(.semibold))
                                    Text("\(pk.userName) · \(pk.rpId)")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                        .foregroundStyle(.primary)
                    }
                }
            }

            if filteredItems.isEmpty && passkeys.isEmpty {
                ContentUnavailableView(
                    l10n.t(zhCN: "未找到匹配凭证", en: "No Matching Credentials"),
                    systemImage: "key.slash",
                    description: Text(l10n.t(
                        zhCN: "请在 Keysmith 主应用中添加条目或更换搜索关键词。",
                        en: "Add items in the Keysmith app or try a different search."
                    ))
                )
            } else if !filteredItems.isEmpty {
                Section(serviceHosts.isEmpty
                        ? l10n.t(zhCN: "全部可用凭证", en: "All Credentials")
                        : l10n.t(zhCN: "匹配站点与全部凭证", en: "Matching & All Credentials")) {
                    ForEach(filteredItems) { item in
                        Button {
                            Task { await pickItem(item) }
                        } label: {
                            HStack(spacing: 10) {
                                ZStack {
                                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                                        .fill(accentColor)
                                    Image(systemName: item.hasTotp && oneTimeCodeOnly ? "key.viewfinder" : item.category.systemImage)
                                        .font(.caption.weight(.semibold))
                                        .foregroundStyle(.white)
                                }
                                .frame(width: 30, height: 30)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(item.title)
                                        .font(.subheadline.weight(.semibold))
                                    Text(item.subtitle)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                                if item.hasTotp {
                                    Text("2FA")
                                        .font(.caption2.weight(.semibold))
                                        .padding(.horizontal, 6)
                                        .padding(.vertical, 2)
                                        .background(accentColor.opacity(0.14), in: Capsule())
                                        .foregroundStyle(accentColor)
                                }
                            }
                        }
                        .foregroundStyle(.primary)
                    }
                }
            }
        }
        .searchable(text: $searchQuery, prompt: l10n.t(zhCN: "搜索标题或账号", en: "Search title or username"))
        .disabled(isBusy)
    }

    private var filteredItems: [KSItemSummary] {
        let base = oneTimeCodeOnly ? items.filter(\.hasTotp) : items.filter { $0.hasPassword || $0.hasTotp }
        let q = searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let searched = q.isEmpty
            ? base
            : base.filter {
                $0.title.lowercased().contains(q)
                    || $0.subtitle.lowercased().contains(q)
                    || ($0.primaryUrl?.lowercased().contains(q) ?? false)
            }

        guard !serviceHosts.isEmpty else { return searched }
        return searched.sorted { lhs, rhs in
            let lMatch = matchesHost(lhs)
            let rMatch = matchesHost(rhs)
            if lMatch != rMatch { return lMatch && !rMatch }
            return lhs.title.localizedCaseInsensitiveCompare(rhs.title) == .orderedAscending
        }
    }

    private func matchesHost(_ item: KSItemSummary) -> Bool {
        guard let raw = item.primaryUrl?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty else {
            return false
        }
        let parsedHost = URL(string: raw)?.host?.lowercased()
            ?? URL(string: "https://\(raw)")?.host?.lowercased()
        guard let itemHost = parsedHost, !itemHost.isEmpty else { return false }
        return serviceHosts.contains { rawHost in
            let host = rawHost.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            guard !host.isEmpty else { return false }
            return itemHost == host
                || itemHost.hasSuffix(".\(host)")
                || host.hasSuffix(".\(itemHost)")
        }
    }

    private func bootstrapExtensionSession() async {
        do {
            try await adapter.initializeIfNeeded()
            sessionState = try await adapter.sessionGetState()
            if sessionState.status == .unlocked {
                await afterUnlocked()
            } else if sessionState.status == .locked && sessionState.biometricEnabled {
                await unlockWithBiometric()
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func unlockWithBiometric() async {
        isBusy = true
        errorMessage = nil
        defer { isBusy = false }
        do {
            sessionState = try await adapter.sessionUnlockBiometric()
            await afterUnlocked()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func unlockWithPassword() async {
        isBusy = true
        errorMessage = nil
        defer { isBusy = false }
        do {
            sessionState = try await adapter.sessionUnlockPassword(masterPassword)
            masterPassword = ""
            await afterUnlocked()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func afterUnlocked() async {
        isUnlocked = true
        if let targetItemId, !targetItemId.isEmpty,
           let detail = try? await adapter.itemGet(id: targetItemId) {
            if oneTimeCodeOnly, let totp = detail.primaryTotp,
               let code = try? await adapter.totpCompute(secretOrUri: totp) {
                await onSelectOneTimeCode(code.code)
                return
            }
            if !oneTimeCodeOnly, let password = detail.primaryPassword {
                let user = detail.primaryUsername ?? fallbackUser
                await onSelectPassword(user, password, detail.primaryTotp)
                return
            }
        }

        do {
            items = try await adapter.itemList(filter: KSItemFilter())
            if let passkeyParameters {
                let allowB64u = passkeyParameters.allowedCredentials.map { Self.encodeBase64URL($0) }
                passkeys = (try? await adapter.passkeyListForRp(
                    rpId: passkeyParameters.relyingPartyIdentifier,
                    allowCredentialIdsB64u: allowB64u
                )) ?? []
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func pickItem(_ item: KSItemSummary) async {
        isBusy = true
        errorMessage = nil
        defer { isBusy = false }
        do {
            guard let detail = try await adapter.itemGet(id: item.id) else {
                errorMessage = l10n.t(zhCN: "无法读取该条目详情", en: "Unable to load item details")
                return
            }
            if oneTimeCodeOnly {
                guard let totp = detail.primaryTotp else {
                    errorMessage = l10n.t(zhCN: "该条目未配置 TOTP", en: "No TOTP configured for this item")
                    return
                }
                let code = try await adapter.totpCompute(secretOrUri: totp)
                await onSelectOneTimeCode(code.code)
            } else {
                let user = detail.primaryUsername ?? ""
                let pass = detail.primaryPassword ?? ""
                await onSelectPassword(user, pass, detail.primaryTotp)
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private static func encodeBase64URL(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

struct AutoFillConfigurationView: View {
    let adapter: KeysmithCoreAdapter
    let onDone: () async -> Void

    private let l10n = KSLocalizedStrings(languageCode: "system")
    @State private var needsSignIn = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                Image(systemName: "checkmark.shield.fill")
                    .font(.system(size: 52))
                    .foregroundStyle(.teal)
                Text("Keysmith AutoFill")
                    .font(.title2.bold())
                Text(needsSignIn
                     ? l10n.t(
                        zhCN: "请打开 Keysmith 主应用登录后再使用自动填充。",
                        en: "Please open the Keysmith app and sign in before using AutoFill."
                     )
                     : l10n.t(
                        zhCN: "Keysmith AutoFill 已配置就绪，支持密码、Passkey、2FA 验证码与任意文本插入。",
                        en: "Keysmith AutoFill is ready for passwords, passkeys, 2FA verification codes, and text insertion."
                     ))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)
                Button(l10n.done) {
                    Task { await onDone() }
                }
                .buttonStyle(.borderedProminent)
            }
            .padding()
            .task {
                try? await adapter.initializeIfNeeded()
                if let state = try? await adapter.sessionGetState(), state.status == .unauthenticated {
                    needsSignIn = true
                }
            }
        }
    }
}
