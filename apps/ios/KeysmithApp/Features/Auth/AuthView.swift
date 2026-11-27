import SwiftUI

public struct AuthView: View {
    public let store: KeysmithStore

    private enum AuthTab: String, CaseIterable, Identifiable {
        case login
        case register
        var id: String { rawValue }
    }

    @State private var tab: AuthTab = .login
    @State private var serverUrl: String = "https://vault.bitwarden.com"
    @State private var email: String = ""
    @State private var displayName: String = ""
    @State private var masterPassword: String = ""
    @State private var confirmPassword: String = ""
    @State private var passwordHint: String = ""

    @State private var allowInsecureHttp: Bool = false
    @State private var twoFactorRequired: Bool = false
    @State private var twoFactorCode: String = ""
    @State private var twoFactorRemember: Bool = false

    @State private var serverCheckMessage: String?
    @State private var serverCheckOk: Bool = false
    @State private var registrationDisabled: Bool = false
    @State private var weakKdfIterations: Int?
    @State private var errorMessage: String?
    @State private var isSubmitting: Bool = false

    public init(store: KeysmithStore) {
        self.store = store
    }

    public var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    headerCard

                    Picker("", selection: $tab) {
                        Text(store.l10n.t(zhCN: "登录账户", en: "Sign In")).tag(AuthTab.login)
                        Text(store.l10n.t(zhCN: "注册新账户", en: "Create Account")).tag(AuthTab.register)
                    }
                    .pickerStyle(.segmented)

                    if !store.accounts.isEmpty {
                        savedAccountsCard
                    }

                    formCard

                    if isNonLoopbackHTTP {
                        insecureHttpWarningCard
                    }

                    if let iters = weakKdfIterations {
                        weakKdfWarningCard(iterations: iters)
                    }

                    if let err = errorMessage {
                        Text(err)
                            .font(.footnote)
                            .foregroundStyle(KeysmithColors.danger)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(12)
                            .background(KeysmithColors.danger.opacity(0.10), in: RoundedRectangle(cornerRadius: 12))
                    }

                    primaryActionButtons
                }
                .padding()
                .frame(maxWidth: 480)
                .frame(maxWidth: .infinity)
            }
            .background(Color(.systemGroupedBackground))
            .navigationBarHidden(true)
            .onAppear {
                if let last = store.appSettings.lastServerUrl, !last.isEmpty {
                    serverUrl = last
                }
            }
        }
    }

    private var headerCard: some View {
        VStack(spacing: 10) {
            ZStack {
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .fill(KeysmithColors.accent)
                    .frame(width: 64, height: 64)
                Image(systemName: "key.fill")
                    .font(.system(size: 28, weight: .bold))
                    .foregroundStyle(.white)
            }
            Text("Keysmith")
                .font(.title2.weight(.bold))
            Text(store.l10n.t(
                zhCN: "零知识加密 Vaultwarden / Bitwarden 客户端",
                en: "Zero-knowledge Vaultwarden & Bitwarden Client"
            ))
            .font(.footnote)
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
        }
        .padding(.top, 12)
    }

    private var savedAccountsCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(store.l10n.t(zhCN: "已有账户", en: "Saved Accounts"))
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)

            ForEach(store.accounts) { account in
                Button {
                    Task {
                        try? await store.switchAccount(account.id)
                    }
                } label: {
                    HStack(spacing: 10) {
                        Circle()
                            .fill(KeysmithColors.accent)
                            .frame(width: 32, height: 32)
                            .overlay(
                                Text(String(account.displayName.prefix(1)).uppercased())
                                    .font(.caption.weight(.bold))
                                    .foregroundStyle(.white)
                            )
                        VStack(alignment: .leading, spacing: 2) {
                            Text(account.displayName.isEmpty ? account.email : account.displayName)
                                .font(.subheadline.weight(.semibold))
                            Text("\(account.email) · \(account.serverUrl)")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                        Spacer()
                        Image(systemName: "chevron.right")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .padding(12)
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var formCard: some View {
        VStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text(store.l10n.t(zhCN: "服务器地址", en: "Server URL"))
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.secondary)
                    Spacer()
                    Button(store.l10n.t(zhCN: "检查连接", en: "Test Connection")) {
                        Task { await checkServer() }
                    }
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(KeysmithColors.accent)
                }
                TextField("https://vault.example.com", text: $serverUrl)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                    .textFieldStyle(.roundedBorder)

                if let msg = serverCheckMessage {
                    Text(msg)
                        .font(.caption)
                        .foregroundStyle(serverCheckOk ? KeysmithColors.success : KeysmithColors.danger)
                }
            }

            if tab == .register {
                if registrationDisabled {
                    Text(store.l10n.t(zhCN: "当前服务器已关闭注册，仅支持登录", en: "Registration is disabled on this server"))
                        .font(.caption)
                        .foregroundStyle(KeysmithColors.warning)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                VStack(alignment: .leading, spacing: 6) {
                    Text(store.l10n.t(zhCN: "显示名称", en: "Display Name"))
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.secondary)
                    TextField("Cherry Wang", text: $displayName)
                        .textFieldStyle(.roundedBorder)
                }
            }

            VStack(alignment: .leading, spacing: 6) {
                Text(store.l10n.t(zhCN: "邮箱", en: "Email"))
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)
                TextField("you@example.com", text: $email)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.emailAddress)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit {
                        if tab == .login {
                            Task { await checkPreloginKdf() }
                        }
                    }
            }

            VStack(alignment: .leading, spacing: 6) {
                Text(store.l10n.t(zhCN: "主密码", en: "Master Password"))
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)
                SecureField(store.l10n.masterPasswordPlaceholder, text: $masterPassword)
                    .textFieldStyle(.roundedBorder)
            }

            if tab == .register {
                VStack(alignment: .leading, spacing: 6) {
                    Text(store.l10n.t(zhCN: "确认主密码", en: "Confirm Master Password"))
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.secondary)
                    SecureField(store.l10n.t(zhCN: "再次输入主密码", en: "Confirm password"), text: $confirmPassword)
                        .textFieldStyle(.roundedBorder)

                    Text(store.l10n.t(
                        zhCN: "规则：至少 12 个字符，且包含至少两类字符（大小写字母、数字或符号）",
                        en: "Rule: at least 12 characters and 2 character classes"
                    ))
                    .font(.caption2)
                    .foregroundStyle(isPasswordPolicySatisfied || masterPassword.isEmpty ? Color.secondary : KeysmithColors.warning)
                }

                VStack(alignment: .leading, spacing: 6) {
                    Text(store.l10n.t(zhCN: "密码提示（可选）", en: "Master Password Hint (Optional)"))
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.secondary)
                    TextField(store.l10n.t(zhCN: "留空则不设置", en: "Optional hint"), text: $passwordHint)
                        .textFieldStyle(.roundedBorder)
                }
            }

            if tab == .login && twoFactorRequired {
                VStack(alignment: .leading, spacing: 6) {
                    Text(store.l10n.t(zhCN: "两步验证码", en: "Two-Factor Code"))
                        .font(.caption.weight(.medium))
                        .foregroundStyle(KeysmithColors.accent)
                    TextField("123456", text: $twoFactorCode)
                        .keyboardType(.numberPad)
                        .textFieldStyle(.roundedBorder)
                    Toggle(store.l10n.t(zhCN: "记住此设备", en: "Remember this device"), isOn: $twoFactorRemember)
                        .font(.caption)
                }
            }
        }
        .padding(16)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private var insecureHttpWarningCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(
                store.l10n.t(
                    zhCN: "检测到非本地服务器使用明文 HTTP 连接。凭据和令牌可能在网络中被窃听。",
                    en: "Plaintext HTTP detected for a non-loopback server. Credentials may be intercepted."
                ),
                systemImage: "exclamationmark.triangle.fill"
            )
            .font(.caption)
            .foregroundStyle(KeysmithColors.danger)

            Toggle(
                store.l10n.t(
                    zhCN: "我了解风险，允许对此服务器使用明文 HTTP 连接",
                    en: "I understand the risk and allow unencrypted HTTP"
                ),
                isOn: $allowInsecureHttp
            )
            .font(.caption.weight(.medium))
        }
        .padding(12)
        .background(KeysmithColors.danger.opacity(0.10), in: RoundedRectangle(cornerRadius: 14))
    }

    private func weakKdfWarningCard(iterations: Int) -> some View {
        Label(
            store.l10n.t(
                zhCN: "检测到较弱的 KDF 配置（PBKDF2 仅 \(iterations) 次迭代，低于建议值 600,000），建议在服务端提高 KDF 强度。",
                en: "Weak KDF detected (PBKDF2 \(iterations) iterations < 600,000). Recommend upgrading server KDF."
            ),
            systemImage: "shield.lefthalf.filled.trianglebadge.exclamationmark"
        )
        .font(.caption)
        .foregroundStyle(KeysmithColors.warning)
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(KeysmithColors.warning.opacity(0.12), in: RoundedRectangle(cornerRadius: 14))
    }

    private var primaryActionButtons: some View {
        VStack(spacing: 12) {
            Button {
                Task { await submit() }
            } label: {
                HStack {
                    if isSubmitting {
                        ProgressView()
                            .tint(.white)
                    }
                    Text(tab == .login
                        ? store.l10n.t(zhCN: "登录", en: "Sign In")
                        : store.l10n.t(zhCN: "创建账户", en: "Create Account"))
                        .font(.body.weight(.semibold))
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 13)
                .foregroundStyle(.white)
                .background(KeysmithColors.accent, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
            .disabled(isSubmitting || (tab == .register && registrationDisabled))

            Button {
                store.enterDemoMode()
            } label: {
                Label(store.l10n.enterDemoMode, systemImage: "sparkles")
                    .font(.subheadline.weight(.medium))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 11)
            }
            .buttonStyle(.bordered)
            .tint(KeysmithColors.accent)
        }
    }

    // MARK: - Validation & Actions

    private var isNonLoopbackHTTP: Bool {
        let trimmed = serverUrl.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard trimmed.hasPrefix("http://"), let url = URL(string: trimmed), let host = url.host else {
            return false
        }
        return host != "localhost" && host != "127.0.0.1" && host != "::1"
    }

    private var isPasswordPolicySatisfied: Bool {
        guard masterPassword.count >= 12 else { return false }
        var classes = 0
        if masterPassword.contains(where: { $0.isUppercase }) { classes += 1 }
        if masterPassword.contains(where: { $0.isLowercase }) { classes += 1 }
        if masterPassword.contains(where: { $0.isNumber }) { classes += 1 }
        if masterPassword.contains(where: { !$0.isLetter && !$0.isNumber }) { classes += 1 }
        return classes >= 2
    }

    private func checkServer() async {
        errorMessage = nil
        if isNonLoopbackHTTP && !allowInsecureHttp {
            serverCheckOk = false
            serverCheckMessage = store.l10n.t(zhCN: "请先确认明文 HTTP 风险提示", en: "Confirm HTTP risk first")
            return
        }
        do {
            let res = try await store.checkServer(serverUrl: serverUrl, allowInsecureHttp: allowInsecureHttp)
            serverCheckOk = res.ok
            registrationDisabled = res.disableUserRegistration
            serverCheckMessage = res.ok
                ? store.l10n.t(zhCN: "已连接 · \(res.version)", en: "Connected · \(res.version)")
                : store.l10n.t(zhCN: "连接失败", en: "Unreachable")
        } catch {
            serverCheckOk = false
            serverCheckMessage = error.localizedDescription
        }
    }

    private func checkPreloginKdf() async {
        let cleanEmail = email.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanEmail.isEmpty else { return }
        if isNonLoopbackHTTP && !allowInsecureHttp { return }
        if let kdf = try? await store.prelogin(serverUrl: serverUrl, email: cleanEmail, allowInsecureHttp: allowInsecureHttp) {
            if kdf.kdf == 0 && kdf.kdfIterations < 600_000 {
                weakKdfIterations = kdf.kdfIterations
            } else {
                weakKdfIterations = nil
            }
        }
    }

    private func submit() async {
        errorMessage = nil
        let cleanServer = serverUrl.trimmingCharacters(in: .whitespacesAndNewlines)
        let cleanEmail = email.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanServer.isEmpty, !cleanEmail.isEmpty, !masterPassword.isEmpty else {
            errorMessage = store.l10n.t(zhCN: "请完整填写服务器、邮箱和主密码", en: "Please fill in server, email, and master password")
            return
        }
        if isNonLoopbackHTTP && !allowInsecureHttp {
            errorMessage = store.l10n.t(
                zhCN: "请先勾选确认明文 HTTP 风险提示后再继续，或改用 https:// 地址。",
                en: "Confirm the unencrypted HTTP risk warning before continuing, or switch to https://."
            )
            return
        }

        isSubmitting = true
        defer { isSubmitting = false }

        do {
            if tab == .login {
                await checkPreloginKdf()
                try await store.login(
                    serverUrl: cleanServer,
                    email: cleanEmail,
                    masterPassword: masterPassword,
                    twoFactorProvider: twoFactorRequired ? 0 : nil,
                    twoFactorToken: twoFactorRequired ? twoFactorCode : nil,
                    twoFactorRemember: twoFactorRemember,
                    allowInsecureHttp: allowInsecureHttp
                )
            } else {
                guard isPasswordPolicySatisfied else {
                    errorMessage = store.l10n.t(
                        zhCN: "主密码至少需要 12 个字符，且包含至少两类字符（大写字母、小写字母、数字或符号）。",
                        en: "Master password must be at least 12 characters with at least 2 character classes."
                    )
                    return
                }
                guard masterPassword == confirmPassword else {
                    errorMessage = store.l10n.t(zhCN: "两次输入的主密码不一致", en: "Master passwords do not match")
                    return
                }
                try await store.register(
                    serverUrl: cleanServer,
                    email: cleanEmail,
                    displayName: displayName.trimmingCharacters(in: .whitespacesAndNewlines),
                    masterPassword: masterPassword,
                    hint: passwordHint.isEmpty ? nil : passwordHint,
                    allowInsecureHttp: allowInsecureHttp
                )
            }
        } catch KSCoreAdapterError.twoFactorRequired(let msg, _) {
            twoFactorRequired = true
            errorMessage = msg
        } catch {
            let desc = error.localizedDescription
            if desc.localizedCaseInsensitiveContains("two-factor") || desc.localizedCaseInsensitiveContains("2fa") || desc.localizedCaseInsensitiveContains("两步") {
                twoFactorRequired = true
            }
            errorMessage = desc
        }
    }
}
