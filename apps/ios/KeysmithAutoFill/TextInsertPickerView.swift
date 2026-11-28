import Foundation
import SwiftUI

struct TextInsertPickerView: View {
    let adapter: KeysmithCoreAdapter
    let onSelectText: (String) async -> Void
    let onCancel: () async -> Void

    @State private var sessionState = KSSessionState()
    @State private var isUnlocked = false
    @State private var isBusy = false
    @State private var masterPassword = ""
    @State private var useMasterPassword = false
    @State private var query = ""
    @State private var candidates: [KSTextInsertCandidate] = []
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
                    unlockView
                } else {
                    candidatesList
                }
            }
            .navigationTitle(l10n.t(zhCN: "插入 Keysmith 字段", en: "Insert Keysmith Field"))
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
                await initializeSession()
            }
        }
    }

    private var unlockView: some View {
        VStack(spacing: 18) {
            Spacer()
            Image(systemName: "text.insert")
                .font(.system(size: 40))
                .foregroundStyle(accentColor)
            Text(l10n.t(zhCN: "解锁后选择银行卡、身份或安全字段注入", en: "Unlock to insert card, identity, or secure fields"))
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal)

            if sessionState.biometricEnabled && !useMasterPassword {
                Button {
                    Task { await unlockWithBiometric() }
                } label: {
                    Label(l10n.unlockWithBiometry(biometryKind), systemImage: biometryKind.systemImage)
                        .font(.body.weight(.semibold))
                        .frame(minWidth: 190, maxWidth: 240)
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
            }
            Spacer()
        }
        .background(Color(.systemGroupedBackground))
        .disabled(isBusy)
    }

    private var candidatesList: some View {
        List {
            if filteredCandidates.isEmpty {
                ContentUnavailableView(
                    l10n.t(zhCN: "暂无可插入字段", en: "No Insertable Fields"),
                    systemImage: "creditcard",
                    description: Text(l10n.t(
                        zhCN: "请确认保险库中存在银行卡、身份信息或安全备注条目。",
                        en: "Make sure your vault contains cards, identities, or secure notes."
                    ))
                )
            } else {
                ForEach(groupedItemTitles, id: \.self) { itemTitle in
                    Section(itemTitle) {
                        ForEach(filteredCandidates.filter { $0.itemTitle == itemTitle }) { cand in
                            Button {
                                Task {
                                    isBusy = true
                                    await onSelectText(cand.value)
                                }
                            } label: {
                                HStack {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(cand.fieldLabel)
                                            .font(.subheadline.weight(.medium))
                                        Text(cand.sensitive ? maskedValue(cand.value) : cand.value)
                                            .font(.caption.monospaced())
                                            .foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    Image(systemName: "arrow.down.doc")
                                        .foregroundStyle(accentColor)
                                }
                            }
                            .foregroundStyle(.primary)
                        }
                    }
                }
            }
        }
        .searchable(text: $query, prompt: l10n.t(zhCN: "搜索卡号、姓名或字段", en: "Search card, name, or field"))
        .disabled(isBusy)
    }

    private var filteredCandidates: [KSTextInsertCandidate] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !q.isEmpty else { return candidates }
        return candidates.filter {
            $0.itemTitle.lowercased().contains(q)
                || $0.fieldLabel.lowercased().contains(q)
                || $0.subtitle.lowercased().contains(q)
        }
    }

    private var groupedItemTitles: [String] {
        var seen = Set<String>()
        var ordered: [String] = []
        for cand in filteredCandidates where !seen.contains(cand.itemTitle) {
            seen.insert(cand.itemTitle)
            ordered.append(cand.itemTitle)
        }
        return ordered
    }

    private func maskedValue(_ value: String) -> String {
        if value.count <= 4 { return "••••" }
        return "•••• \(value.suffix(4))"
    }

    private func initializeSession() async {
        do {
            try await adapter.initializeIfNeeded()
            sessionState = try await adapter.sessionGetState()
            if sessionState.status == .unlocked {
                await loadCandidates()
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
            await loadCandidates()
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
            await loadCandidates()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func loadCandidates() async {
        isUnlocked = true
        do {
            candidates = try await adapter.textInsertCandidates(query: "")
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
