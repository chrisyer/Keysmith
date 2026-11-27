import AuthenticationServices
import Foundation

/// Synchronizes non-secret credential metadata (domain, username, passkey ID, TOTP marker)
/// to `ASCredentialIdentityStore.shared`. Never stores plaintext passwords or private keys.
public actor CredentialIdentitySync {
    public static let shared = CredentialIdentitySync()

    public init() {}

    public func sync(items: [KSItemSummary], passkeyCandidates: [KSPasskeyListCandidate] = []) async {
        let store = ASCredentialIdentityStore.shared
        let state = await store.state()
        guard state.isEnabled else { return }

        var identities: [any ASCredentialIdentity] = []

        for item in items where item.deletedAt == nil {
            if let primaryURL = item.primaryUrl,
               let host = normalizedHost(from: primaryURL),
               let username = item.username, !username.isEmpty,
               item.hasPassword {
                let serviceId = ASCredentialServiceIdentifier(identifier: host, type: .domain)
                let pwdIdentity = ASPasswordCredentialIdentity(
                    serviceIdentifier: serviceId,
                    user: username,
                    recordIdentifier: item.id
                )
                identities.append(pwdIdentity)

                if item.hasTotp {
                    let otpIdentity = ASOneTimeCodeCredentialIdentity(
                        serviceIdentifier: serviceId,
                        label: "\(item.title) (\(username))",
                        recordIdentifier: item.id
                    )
                    identities.append(otpIdentity)
                }
            }
        }

        for candidate in passkeyCandidates {
            if let credData = Data(base64URLEncoded: candidate.credentialId),
               let handleData = Data(base64URLEncoded: candidate.userHandle) {
                let passkeyId = ASPasskeyCredentialIdentity(
                    relyingPartyIdentifier: candidate.rpId,
                    userName: candidate.userName,
                    credentialID: credData,
                    userHandle: handleData,
                    recordIdentifier: candidate.itemId
                )
                identities.append(passkeyId)
            }
        }

        do {
            try await store.replaceCredentialIdentities(identities)
        } catch {
            // Non-fatal in unsigned Simulator or when AutoFill is disabled.
        }
    }

    public func clearAll() async {
        try? await ASCredentialIdentityStore.shared.removeAllCredentialIdentities()
    }

    private func normalizedHost(from rawURL: String) -> String? {
        if let host = URL(string: rawURL)?.host, !host.isEmpty {
            return host
        }
        if let host = URL(string: "https://\(rawURL)")?.host, !host.isEmpty {
            return host
        }
        return nil
    }
}

public extension Data {
    init?(base64URLEncoded string: String) {
        var base64 = string
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        let remainder = base64.count % 4
        if remainder > 0 {
            base64 += String(repeating: "=", count: 4 - remainder)
        }
        self.init(base64Encoded: base64)
    }

    func base64URLEncodedString() -> String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
