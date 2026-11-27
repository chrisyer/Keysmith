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
    @State private var searchQuery = ""
    @State private var items: [KSItemSummary] = []
    @State private var passkeys: [KSPasskeyListCandidate] = []
    @State private var errorMessage: String?

    private let accentColor = Color(red: 5.0 / 255.0, green: 114.0 / 255.0, blue: 236.0 / 255.0)

    var body: some View {
        NavigationStack {
            Group {
                if !isUnlocked {
                    unlockGateView
                } else {
                    credentialListView
                }
            }
            .navigationTitle(oneTimeCodeOnly ? "选择验证码" : "Keysmith 自动填充")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("取消") {
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
        VStack(spacing: 18) {
            Spacer()

            ZStack {
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .fill(accentColor)
                Text("K")
                    .font(.system(size: 28, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)
            }
            .frame(width: 60, height: 60)

            VStack(spacing: 4) {
                Text("解锁 Keysmith 保险库")
                    .font(.headline)
                if !serviceHosts.isEmpty {
                    Text(serviceHosts.joined(separator: " · "))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            if sessionState.status == .unauthenticated {
                Text("请先打开 Keysmith 主应用登录账号后再使用自动填充。")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)
            } else {
                VStack(spacing: 12) {
                    if sessionState.biometricEnabled {
                        Button {
                            Task { await unlockWithBiometric() }
                        } label: {
                            Label("使用 Face ID 解锁并填充", systemImage: "faceid")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(accentColor)
                    }

                    HStack(spacing: 8) {
                        SecureField("输入主密码", text: $masterPassword)
                            .textFieldStyle(.roundedBorder)
                        Button("解锁") {
                            Task { await unlockWithPassword() }
                        }
                        .buttonStyle(.bordered)
                        .disabled(masterPassword.isEmpty)
                    }
                }
                .padding(.horizontal, 24)
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
        .disabled(isBusy)
    }

    private var credentialListView: some View {
        List {
            if let passkeyParameters, !passkeys.isEmpty {
                Section("通行密钥 Passkeys (\(passkeyParameters.relyingPartyIdentifier))") {
                    ForEach(passkeys) { pk in
                        Button {
                            Task {
                                isBusy = true
                                await onSelectPasskey(pk, passkeyParameters)
                            }
                        } label: {
                            HStack(spacing: 10) {
                                Image(systemName: "person.badge.key.fill")
                                    .foregroundStyle(.teal)
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

            Section(serviceHosts.isEmpty ? "全部可用凭证" : "匹配站点与全部凭证") {
                ForEach(filteredItems) { item in
                    Button {
                        Task { await pickItem(item) }
                    } label: {
                        HStack(spacing: 10) {
                            Image(systemName: item.hasTotp && oneTimeCodeOnly ? "key.viewfinder" : item.category.systemImage)
                                .foregroundStyle(accentColor)
                                .frame(width: 24)
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
        .searchable(text: $searchQuery, prompt: "搜索标题或账号")
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
        guard let url = item.primaryUrl?.lowercased() else { return false }
        return serviceHosts.contains { host in
            let h = host.lowercased()
            return url.contains(h) || h.contains(url)
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
                errorMessage = "无法读取该条目详情"
                return
            }
            if oneTimeCodeOnly {
                guard let totp = detail.primaryTotp else {
                    errorMessage = "该条目未配置 TOTP"
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

    @State private var statusText = "Keysmith AutoFill 已配置就绪，支持密码、Passkey、2FA 验证码与任意文本插入。"

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                Image(systemName: "checkmark.shield.fill")
                    .font(.system(size: 52))
                    .foregroundStyle(.teal)
                Text("Keysmith AutoFill")
                    .font(.title2.bold())
                Text(statusText)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)
                Button("完成") {
                    Task { await onDone() }
                }
                .buttonStyle(.borderedProminent)
            }
            .padding()
            .task {
                try? await adapter.initializeIfNeeded()
                if let state = try? await adapter.sessionGetState(), state.status == .unauthenticated {
                    statusText = "请打开 Keysmith 主应用登录后再完成自动填充。"
                }
            }
        }
    }
}
