import SwiftUI

public struct LockScreenView: View {
    public let store: KeysmithStore

    @State private var masterPassword: String = ""
    @State private var errorMessage: String?
    @State private var isUnlocking: Bool = false

    public init(store: KeysmithStore) {
        self.store = store
    }

    public var body: some View {
        VStack(spacing: 24) {
            Spacer()

            VStack(spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 22, style: .continuous)
                        .fill(KeysmithColors.accent.opacity(0.14))
                        .frame(width: 72, height: 72)
                    Text("K")
                        .font(.system(size: 34, weight: .bold, design: .rounded))
                        .foregroundStyle(KeysmithColors.accent)
                }
                .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 22, style: .continuous))

                Text(store.l10n.vaultLockedTitle)
                    .font(.title3.weight(.bold))

                Text("\(store.session.email) · \(store.session.serverUrl)")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            VStack(spacing: 14) {
                if store.session.biometricEnabled || store.isDemoMode {
                    Button {
                        Task { await unlockBiometric() }
                    } label: {
                        Label(store.l10n.unlockWithFaceID, systemImage: "faceid")
                            .font(.body.weight(.semibold))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 13)
                            .foregroundStyle(.white)
                            .background(KeysmithColors.accent, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    }
                    .disabled(isUnlocking)
                }

                HStack(spacing: 10) {
                    SecureField(store.l10n.masterPasswordPlaceholder, text: $masterPassword)
                        .textFieldStyle(.roundedBorder)
                        .onSubmit {
                            Task { await unlockPassword() }
                        }

                    Button {
                        Task { await unlockPassword() }
                    } label: {
                        Text(store.l10n.unlock)
                            .font(.subheadline.weight(.semibold))
                            .padding(.horizontal, 14)
                            .padding(.vertical, 8)
                            .background(Color.secondary.opacity(0.16), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    }
                    .disabled(isUnlocking || masterPassword.isEmpty)
                }

                if let errorMessage {
                    Text(errorMessage)
                        .font(.caption)
                        .foregroundStyle(KeysmithColors.danger)
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    Text("Data Protection Keychain · BiometryCurrentSet")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(18)
            .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            .frame(maxWidth: 400)

            HStack(spacing: 18) {
                if store.accounts.count > 1 {
                    Menu {
                        ForEach(store.accounts) { acc in
                            Button(acc.email) {
                                Task { try? await store.switchAccount(acc.id) }
                            }
                        }
                    } label: {
                        Text(store.l10n.t(zhCN: "切换账户", en: "Switch Account"))
                            .font(.footnote)
                    }
                }

                Button(role: .destructive) {
                    Task { await store.logout(clearLocalCache: false) }
                } label: {
                    Text(store.l10n.t(zhCN: "退出登录", en: "Sign Out"))
                        .font(.footnote)
                }
            }

            Spacer()
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemGroupedBackground))
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
