import SwiftUI

public struct LockScreenView: View {
    public let store: KeysmithStore

    @Environment(\.scenePhase) private var scenePhase
    @FocusState private var isPasswordFieldFocused: Bool

    @State private var masterPassword: String = ""
    @State private var isPasswordVisible: Bool = false
    @State private var useMasterPassword: Bool = false
    @State private var didAttemptAutoFaceId: Bool = false
    @State private var errorMessage: String?
    @State private var isUnlocking: Bool = false

    public init(store: KeysmithStore) {
        self.store = store
        self._useMasterPassword = State(initialValue: !(store.session.biometricEnabled || store.isDemoMode))
    }

    private var canUseBiometrics: Bool {
        store.session.biometricEnabled || store.isDemoMode
    }

    public var body: some View {
        VStack(spacing: 24) {
            Spacer()

            VStack(spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 20, style: .continuous)
                        .fill(KeysmithColors.accent)
                        .frame(width: 68, height: 68)
                    Image(systemName: "key.fill")
                        .font(.system(size: 30, weight: .bold))
                        .foregroundStyle(.white)
                }
                .shadow(color: KeysmithColors.accent.opacity(0.25), radius: 14, y: 6)

                Text(store.l10n.vaultLockedTitle)
                    .font(.title3.weight(.bold))

                Text(store.session.email)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            if canUseBiometrics && !useMasterPassword {
                biometricUnlockView
            } else {
                masterPasswordUnlockView
            }

            if let errorMessage {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundStyle(KeysmithColors.danger)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 340)
            }

            HStack(spacing: 20) {
                if store.accounts.count > 1 {
                    Menu {
                        ForEach(store.accounts) { acc in
                            Button(acc.email) {
                                Task { try? await store.switchAccount(acc.id) }
                            }
                        }
                    } label: {
                        Text(store.l10n.t(zhCN: "切换账户", en: "Switch Account"))
                            .font(.footnote.weight(.medium))
                    }
                }

                Button(role: .destructive) {
                    Task { await store.logout(clearLocalCache: false) }
                } label: {
                    Text(store.l10n.t(zhCN: "退出登录", en: "Sign Out"))
                        .font(.footnote.weight(.medium))
                }
            }
            .padding(.top, 4)

            Spacer()
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemGroupedBackground))
        .onChange(of: scenePhase) { _, phase in
            if phase == .background {
                didAttemptAutoFaceId = false
            }
        }
        .onChange(of: store.session.biometricEnabled) { _, enabled in
            if !enabled && !store.isDemoMode {
                useMasterPassword = true
            }
        }
        .task(id: "\(scenePhase)-\(store.isPrivacyShieldVisible)-\(canUseBiometrics)") {
            guard canUseBiometrics,
                  !useMasterPassword,
                  !isUnlocking,
                  !didAttemptAutoFaceId,
                  scenePhase == .active,
                  !store.isPrivacyShieldVisible
            else {
                return
            }
            didAttemptAutoFaceId = true
            try? await Task.sleep(for: .milliseconds(180))
            guard !Task.isCancelled, scenePhase == .active else { return }
            await unlockBiometric()
        }
    }

    private var biometricUnlockView: some View {
        VStack(spacing: 14) {
            Button {
                Task { await unlockBiometric() }
            } label: {
                HStack(spacing: 8) {
                    if isUnlocking {
                        ProgressView()
                            .tint(.white)
                    } else {
                        Image(systemName: "faceid")
                    }
                    Text(store.l10n.unlockWithFaceID)
                        .font(.body.weight(.semibold))
                }
                .frame(minWidth: 210, maxWidth: 260)
            }
            .buttonStyle(.borderedProminent)
            .buttonBorderShape(.capsule)
            .controlSize(.large)
            .tint(KeysmithColors.accent)
            .disabled(isUnlocking)

            Button {
                errorMessage = nil
                withAnimation(.easeInOut(duration: 0.2)) {
                    useMasterPassword = true
                }
                isPasswordFieldFocused = true
            } label: {
                Text(store.l10n.t(zhCN: "改用主密码解锁", en: "Use Master Password"))
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(KeysmithColors.accent)
                    .padding(.vertical, 6)
            }
            .buttonStyle(.plain)
        }
        .padding(.vertical, 8)
    }

    private var masterPasswordUnlockView: some View {
        VStack(spacing: 16) {
            VStack(alignment: .leading, spacing: 14) {
                Text(store.l10n.t(zhCN: "主密码", en: "Master Password"))
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)

                HStack(spacing: 8) {
                    Group {
                        if isPasswordVisible {
                            TextField(store.l10n.masterPasswordPlaceholder, text: $masterPassword)
                        } else {
                            SecureField(store.l10n.masterPasswordPlaceholder, text: $masterPassword)
                        }
                    }
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($isPasswordFieldFocused)
                    .onSubmit {
                        Task { await unlockPassword() }
                    }

                    Button {
                        isPasswordVisible.toggle()
                    } label: {
                        Image(systemName: isPasswordVisible ? "eye.slash" : "eye")
                            .foregroundStyle(.secondary)
                            .frame(width: 28, height: 28)
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                .background(Color(.tertiarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12, style: .continuous))

                Button {
                    Task { await unlockPassword() }
                } label: {
                    HStack(spacing: 8) {
                        if isUnlocking {
                            ProgressView()
                                .tint(.white)
                        }
                        Text(store.l10n.unlock)
                            .font(.body.weight(.semibold))
                    }
                    .frame(minWidth: 180, maxWidth: 240)
                }
                .buttonStyle(.borderedProminent)
                .buttonBorderShape(.capsule)
                .controlSize(.large)
                .tint(KeysmithColors.accent)
                .frame(maxWidth: .infinity)
                .disabled(isUnlocking || masterPassword.isEmpty)
            }
            .padding(20)
            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            .frame(maxWidth: 380)

            if canUseBiometrics {
                Button {
                    errorMessage = nil
                    withAnimation(.easeInOut(duration: 0.2)) {
                        useMasterPassword = false
                    }
                    Task { await unlockBiometric() }
                } label: {
                    Label(store.l10n.unlockWithFaceID, systemImage: "faceid")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(KeysmithColors.accent)
                        .padding(.vertical, 6)
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func unlockBiometric() async {
        errorMessage = nil
        isUnlocking = true
        defer { isUnlocking = false }
        do {
            try await store.unlockWithBiometric()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func unlockPassword() async {
        errorMessage = nil
        isUnlocking = true
        defer { isUnlocking = false }
        do {
            try await store.unlockWithPassword(masterPassword)
            masterPassword = ""
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
