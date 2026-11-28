import AuthenticationServices
import Foundation
import SwiftUI
import UIKit

@MainActor
public final class CredentialProviderViewController: ASCredentialProviderViewController {
    private let adapter = KeysmithCoreAdapter(isExtension: true)
    private var hostingController: UIHostingController<AnyView>?

    private enum Mode {
        case list(
            serviceIdentifiers: [ASCredentialServiceIdentifier],
            passkeyParams: ASPasskeyCredentialRequestParameters?,
            oneTimeCodeOnly: Bool
        )
        case textToInsert
        case passkeyAssertion(ASPasskeyCredentialRequest)
        case passkeyRegistration(ASPasskeyCredentialRequest)
        case passwordRequest(ASPasswordCredentialRequest)
        case oneTimeCodeRequest(ASOneTimeCodeCredentialRequest)
        case extensionConfiguration
    }

    // MARK: - Silent Requests (Always Require User Interaction)

    public override func provideCredentialWithoutUserInteraction(
        for credentialIdentity: ASPasswordCredentialIdentity
    ) {
        rejectWithoutUserInteraction()
    }

    public override func provideCredentialWithoutUserInteraction(
        for credentialRequest: any ASCredentialRequest
    ) {
        rejectWithoutUserInteraction()
    }

    private func rejectWithoutUserInteraction() {
        let error = NSError(
            domain: ASExtensionErrorDomain,
            code: ASExtensionError.userInteractionRequired.rawValue
        )
        extensionContext.cancelRequest(withError: error)
    }

    // MARK: - Credential Lists

    public override func prepareCredentialList(
        for serviceIdentifiers: [ASCredentialServiceIdentifier]
    ) {
        presentMode(.list(
            serviceIdentifiers: serviceIdentifiers,
            passkeyParams: nil,
            oneTimeCodeOnly: false
        ))
    }

    public override func prepareCredentialList(
        for serviceIdentifiers: [ASCredentialServiceIdentifier],
        requestParameters: ASPasskeyCredentialRequestParameters
    ) {
        presentMode(.list(
            serviceIdentifiers: serviceIdentifiers,
            passkeyParams: requestParameters,
            oneTimeCodeOnly: false
        ))
    }

    public override func prepareOneTimeCodeCredentialList(
        for serviceIdentifiers: [ASCredentialServiceIdentifier]
    ) {
        presentMode(.list(
            serviceIdentifiers: serviceIdentifiers,
            passkeyParams: nil,
            oneTimeCodeOnly: true
        ))
    }

    // MARK: - Text To Insert

    public override func prepareInterfaceForUserChoosingTextToInsert() {
        presentMode(.textToInsert)
    }

    // MARK: - Direct Credential Requests

    public override func prepareInterfaceToProvideCredential(
        for credentialIdentity: ASPasswordCredentialIdentity
    ) {
        let request = ASPasswordCredentialRequest(credentialIdentity: credentialIdentity)
        presentMode(.passwordRequest(request))
    }

    public override func prepareInterfaceToProvideCredential(
        for credentialRequest: any ASCredentialRequest
    ) {
        if let passkeyRequest = credentialRequest as? ASPasskeyCredentialRequest {
            presentMode(.passkeyAssertion(passkeyRequest))
            return
        }
        if let otpRequest = credentialRequest as? ASOneTimeCodeCredentialRequest {
            presentMode(.oneTimeCodeRequest(otpRequest))
            return
        }
        if let passwordRequest = credentialRequest as? ASPasswordCredentialRequest {
            presentMode(.passwordRequest(passwordRequest))
            return
        }
        Task { await cancelWithExtensionError(.failed) }
    }

    // MARK: - Passkey Registration & Extension Configuration

    public override func prepareInterface(
        forPasskeyRegistration registrationRequest: any ASCredentialRequest
    ) {
        guard let passkeyRequest = registrationRequest as? ASPasskeyCredentialRequest else {
            Task { await cancelWithExtensionError(.failed) }
            return
        }
        presentMode(.passkeyRegistration(passkeyRequest))
    }

    public override func prepareInterfaceForExtensionConfiguration() {
        presentMode(.extensionConfiguration)
    }

    // MARK: - Root SwiftUI Embedding

    private func presentMode(_ mode: Mode) {
        let rootView: AnyView
        switch mode {
        case .list(let serviceIdentifiers, let passkeyParams, let oneTimeCodeOnly):
            let hosts = serviceIdentifiers.map(\.identifier)
            rootView = AnyView(
                AutoFillSessionView(
                    adapter: adapter,
                    serviceHosts: hosts,
                    passkeyParameters: passkeyParams,
                    oneTimeCodeOnly: oneTimeCodeOnly,
                    onSelectPassword: { [weak self] username, password, totpSecret in
                        await self?.completePassword(username: username, password: password, totpSecret: totpSecret)
                    },
                    onSelectOneTimeCode: { [weak self] code in
                        await self?.completeOneTimeCode(code: code)
                    },
                    onSelectPasskey: { [weak self] candidate, params in
                        await self?.completePasskeyAssertion(
                            clientDataHash: params.clientDataHash,
                            rpId: params.relyingPartyIdentifier,
                            credentialIdB64u: candidate.credentialId
                        )
                    },
                    onCancel: { [weak self] in
                        await self?.cancelWithExtensionError(.userCanceled)
                    }
                )
            )

        case .textToInsert:
            rootView = AnyView(
                TextInsertPickerView(
                    adapter: adapter,
                    onSelectText: { [weak self] text in
                        await self?.completeTextToInsert(text)
                    },
                    onCancel: { [weak self] in
                        await self?.cancelWithExtensionError(.userCanceled)
                    }
                )
            )

        case .passkeyAssertion(let request):
            let passkeyIdentity = request.credentialIdentity as? ASPasskeyCredentialIdentity
            let rpId = passkeyIdentity?.relyingPartyIdentifier
                ?? request.credentialIdentity.serviceIdentifier.identifier
            let userName = passkeyIdentity?.userName ?? request.credentialIdentity.user
            let credId = passkeyIdentity?.credentialID ?? Data()

            rootView = AnyView(
                PasskeyApprovalView(
                    adapter: adapter,
                    mode: .assertion(
                        rpId: rpId,
                        userName: userName,
                        credentialId: credId,
                        clientDataHash: request.clientDataHash
                    ),
                    onConfirmAssertion: { [weak self] clientDataHash, rpId, credentialId in
                        await self?.completePasskeyAssertion(
                            clientDataHash: clientDataHash,
                            rpId: rpId,
                            credentialIdData: credentialId
                        )
                    },
                    onConfirmRegistration: { _, _, _, _, _, _ in },
                    onCancel: { [weak self] in
                        await self?.cancelWithExtensionError(.userCanceled)
                    }
                )
            )

        case .passkeyRegistration(let request):
            let passkeyIdentity = request.credentialIdentity as? ASPasskeyCredentialIdentity
            let rpId = passkeyIdentity?.relyingPartyIdentifier
                ?? request.credentialIdentity.serviceIdentifier.identifier
            let userName = passkeyIdentity?.userName ?? request.credentialIdentity.user
            let userHandle = passkeyIdentity?.userHandle ?? Data(userName.utf8)

            rootView = AnyView(
                PasskeyApprovalView(
                    adapter: adapter,
                    mode: .registration(
                        rpId: rpId,
                        rpName: rpId,
                        userId: userHandle,
                        userName: userName,
                        userDisplayName: userName,
                        clientDataHash: request.clientDataHash
                    ),
                    onConfirmAssertion: { _, _, _ in },
                    onConfirmRegistration: { [weak self] clientDataHash, rpId, rpName, userId, userName, targetItemId in
                        await self?.completePasskeyRegistration(
                            clientDataHash: clientDataHash,
                            rpId: rpId,
                            rpName: rpName,
                            userId: userId,
                            userName: userName,
                            targetItemId: targetItemId
                        )
                    },
                    onCancel: { [weak self] in
                        await self?.cancelWithExtensionError(.userCanceled)
                    }
                )
            )

        case .passwordRequest(let request):
            let itemId = request.credentialIdentity.recordIdentifier ?? ""
            let fallbackUser = request.credentialIdentity.user
            let host = request.credentialIdentity.serviceIdentifier.identifier
            rootView = AnyView(
                AutoFillSessionView(
                    adapter: adapter,
                    serviceHosts: [host],
                    passkeyParameters: nil,
                    oneTimeCodeOnly: false,
                    targetItemId: itemId,
                    fallbackUser: fallbackUser,
                    onSelectPassword: { [weak self] username, password, totpSecret in
                        await self?.completePassword(username: username, password: password, totpSecret: totpSecret)
                    },
                    onSelectOneTimeCode: { [weak self] code in
                        await self?.completeOneTimeCode(code: code)
                    },
                    onSelectPasskey: { _, _ in },
                    onCancel: { [weak self] in
                        await self?.cancelWithExtensionError(.userCanceled)
                    }
                )
            )

        case .oneTimeCodeRequest(let request):
            let itemId = request.credentialIdentity.recordIdentifier ?? ""
            let host = request.credentialIdentity.serviceIdentifier.identifier
            rootView = AnyView(
                AutoFillSessionView(
                    adapter: adapter,
                    serviceHosts: [host],
                    passkeyParameters: nil,
                    oneTimeCodeOnly: true,
                    targetItemId: itemId,
                    onSelectPassword: { _, _, _ in },
                    onSelectOneTimeCode: { [weak self] code in
                        await self?.completeOneTimeCode(code: code)
                    },
                    onSelectPasskey: { _, _ in },
                    onCancel: { [weak self] in
                        await self?.cancelWithExtensionError(.userCanceled)
                    }
                )
            )

        case .extensionConfiguration:
            rootView = AnyView(
                AutoFillConfigurationView(
                    adapter: adapter,
                    onDone: { [weak self] in
                        await self?.completeConfiguration()
                    }
                )
            )
        }

        embedSwiftUIView(rootView)
    }

    private func embedSwiftUIView(_ rootView: AnyView) {
        if let existing = hostingController {
            existing.willMove(toParent: nil)
            existing.view.removeFromSuperview()
            existing.removeFromParent()
        }
        let host = UIHostingController(rootView: rootView)
        addChild(host)
        host.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(host.view)
        NSLayoutConstraint.activate([
            host.view.topAnchor.constraint(equalTo: view.topAnchor),
            host.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            host.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            host.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
        host.didMove(toParent: self)
        hostingController = host
    }

    // MARK: - Completion With Mandatory Lock & Storage Checkpoint

    private func lockAndCheckpointBeforeExit() async {
        try? await adapter.sessionLock(reason: "extension_complete")
        try? await adapter.checkpointStorage()
    }

    private func completePassword(username: String, password: String, totpSecret: String?) async {
        if let totpSecret,
           !totpSecret.isEmpty,
           let settings = try? await adapter.appSettingsGet(),
           settings.autoCopyTotpOnFill,
           let code = try? await adapter.totpCompute(secretOrUri: totpSecret) {
            let state = try? await adapter.sessionGetState()
            let clearSecs = UInt64(max(0, state?.clipboardClearSeconds ?? 30))
            try? await adapter.clipboardCopySecret(
                text: code.code,
                label: KSLocalizedStrings(languageCode: "system").t(zhCN: "2FA 验证码", en: "2FA Code"),
                isSensitive: true,
                clearAfterSecs: clearSecs
            )
        }
        await lockAndCheckpointBeforeExit()
        let credential = ASPasswordCredential(user: username, password: password)
        extensionContext.completeRequest(withSelectedCredential: credential, completionHandler: nil)
    }

    private func completeOneTimeCode(code: String) async {
        await lockAndCheckpointBeforeExit()
        let credential = ASOneTimeCodeCredential(code: code)
        extensionContext.completeOneTimeCodeRequest(using: credential, completionHandler: nil)
    }

    private func completeTextToInsert(_ text: String) async {
        await lockAndCheckpointBeforeExit()
        extensionContext.completeRequest(withTextToInsert: text, completionHandler: nil)
    }

    private func completePasskeyAssertion(
        clientDataHash: Data,
        rpId: String,
        credentialIdB64u: String
    ) async {
        guard let credId = Self.decodeBase64URL(credentialIdB64u) else {
            await cancelWithExtensionError(.credentialIdentityNotFound)
            return
        }
        await completePasskeyAssertion(
            clientDataHash: clientDataHash,
            rpId: rpId,
            credentialIdData: credId
        )
    }

    private func completePasskeyAssertion(
        clientDataHash: Data,
        rpId: String,
        credentialIdData: Data
    ) async {
        do {
            let assertion = try await adapter.passkeyAssertApple(
                clientDataHash: clientDataHash,
                rpId: rpId,
                credentialId: credentialIdData
            )
            await lockAndCheckpointBeforeExit()
            let credential = ASPasskeyAssertionCredential(
                userHandle: assertion.userHandle,
                relyingParty: rpId,
                signature: assertion.signature,
                clientDataHash: assertion.clientDataHash,
                authenticatorData: assertion.authenticatorData,
                credentialID: assertion.credentialId
            )
            extensionContext.completeAssertionRequest(using: credential, completionHandler: nil)
        } catch {
            await cancelWithExtensionError(.failed)
        }
    }

    private func completePasskeyRegistration(
        clientDataHash: Data,
        rpId: String,
        rpName: String,
        userId: Data,
        userName: String,
        targetItemId: String?
    ) async {
        do {
            let reg = try await adapter.passkeyCreateApple(
                clientDataHash: clientDataHash,
                rpId: rpId,
                rpName: rpName,
                userId: userId,
                userName: userName,
                userDisplayName: userName,
                targetItemId: targetItemId
            )
            await lockAndCheckpointBeforeExit()
            let credential = ASPasskeyRegistrationCredential(
                relyingParty: rpId,
                clientDataHash: reg.clientDataHash,
                credentialID: reg.credentialId,
                attestationObject: reg.attestationObject
            )
            extensionContext.completeRegistrationRequest(using: credential, completionHandler: nil)
        } catch {
            await cancelWithExtensionError(.failed)
        }
    }

    private func completeConfiguration() async {
        await lockAndCheckpointBeforeExit()
        extensionContext.completeExtensionConfigurationRequest()
    }

    private func cancelWithExtensionError(_ code: ASExtensionError.Code) async {
        await lockAndCheckpointBeforeExit()
        let error = NSError(domain: ASExtensionErrorDomain, code: code.rawValue)
        extensionContext.cancelRequest(withError: error)
    }

    private static func decodeBase64URL(_ input: String) -> Data? {
        var b64 = input
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        let rem = b64.count % 4
        if rem > 0 {
            b64 += String(repeating: "=", count: 4 - rem)
        }
        return Data(base64Encoded: b64)
    }
}
