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
    @State private var query = ""
    @State private var candidates: [KSTextInsertCandidate] = []
    @State private var errorMessage: String?

    private let accentColor = Color(red: 5.0 / 255.0, green: 114.0 / 255.0, blue: 236.0 / 255.0)

    var body: some View {
        NavigationStack {
            Group {
                if !isUnlocked {
                    unlockView
                } else {
                    candidatesList
                }
            }
            .navigationTitle("插入 Keysmith 字段")
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
                await initializeSession()
            }
        }
    }

    private var unlockView: some View {
        VStack(spacing: 16) {
            Spacer()
            Image(systemName: "text.insert")
                .font(.system(size: 40))
                .foregroundStyle(accentColor)
            Text("解锁后选择银行卡、身份或安全字段注入")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal)

            if sessionState.biometricEnabled {
                Button {
                    Task { await unlockWithBiometric() }
                } label: {
                    Label("使用 Face ID 解锁", systemImage: "faceid")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(accentColor)
                .padding(.horizontal, 24)
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
            .padding(.horizontal, 24)

            if let errorMessage {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundStyle(.red)
            }
            Spacer()
        }
        .disabled(isBusy)
    }

    private var candidatesList: some View {
        List {
            if filteredCandidates.isEmpty {
                ContentUnavailableView(
                    "暂无可插入字段",
                    systemImage: "creditcard",
                    description: Text("请确认保险库中存在银行卡、身份信息或安全备注条目。")
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
        .searchable(text: $query, prompt: "搜索卡号、姓名或字段")
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
