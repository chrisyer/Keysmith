import SwiftUI

public struct ItemEditorView: View {
    public let store: KeysmithStore
    public let existingItem: KSItemDetail?
    public var onSaved: (KSItemDetail) -> Void
    public var onCancel: () -> Void

    @State private var draft: KSItemDraft
    @State private var newUrlString: String = ""
    @State private var isSaving: Bool = false
    @State private var errorMessage: String?
    @State private var scanningFieldLocation: FieldLocation?

    private struct FieldLocation: Identifiable {
        let id = UUID()
        let sectionIndex: Int
        let fieldIndex: Int
    }

    public init(
        store: KeysmithStore,
        existingItem: KSItemDetail? = nil,
        defaultVaultId: String? = nil,
        onSaved: @escaping (KSItemDetail) -> Void,
        onCancel: @escaping () -> Void
    ) {
        self.store = store
        self.existingItem = existingItem
        self.onSaved = onSaved
        self.onCancel = onCancel

        if let existingItem {
            _draft = State(initialValue: existingItem.toDraft())
        } else {
            let fallbackVault = defaultVaultId ?? store.vaults.first(where: { $0.isDefault })?.id ?? store.vaults.first?.id ?? "personal"
            let initialDraft = KSItemDraft(
                vaultId: fallbackVault,
                title: "",
                category: .login,
                sections: [
                    KSItemSection(
                        id: UUID().uuidString,
                        title: "",
                        fields: [
                            KSItemField(label: "用户名", fieldType: .text, value: "", sensitive: false, purpose: .username),
                            KSItemField(label: "密码", fieldType: .password, value: "", sensitive: true, purpose: .password),
                        ]
                    )
                ]
            )
            _draft = State(initialValue: initialDraft)
        }
    }

    public var body: some View {
        Form {
            Section(store.l10n.t(zhCN: "基本信息", en: "Basic Info")) {
                TextField(store.l10n.t(zhCN: "条目标题", en: "Title"), text: $draft.title)

                Picker(store.l10n.t(zhCN: "所属保险库", en: "Vault"), selection: $draft.vaultId) {
                    ForEach(store.vaults) { vault in
                        Text(vault.name).tag(vault.id)
                    }
                }

                Picker(store.l10n.t(zhCN: "条目类型", en: "Category"), selection: $draft.category) {
                    ForEach(KSItemCategory.allCases) { cat in
                        Text(store.l10n.categoryTitle(cat)).tag(cat)
                    }
                }

                Toggle(store.l10n.t(zhCN: "星标收藏", en: "Favorite"), isOn: $draft.favorite)
                Toggle(store.l10n.t(zhCN: "查看前需二次验证", en: "Require Master Password Reprompt"), isOn: $draft.reprompt)
            }

            ForEach($draft.sections) { $section in
                Section(section.title.isEmpty ? store.l10n.t(zhCN: "主要字段", en: "Fields") : section.title) {
                    ForEach(Array(section.fields.enumerated()), id: \.element.id) { idx, _ in
                        fieldEditorRow(
                            field: $section.fields[idx],
                            sectionId: section.id,
                            fieldIndex: idx
                        )
                    }
                    .onDelete { offsets in
                        section.fields.remove(atOffsets: offsets)
                    }
                }
            }

            Section(store.l10n.t(zhCN: "常用字段快捷添加", en: "Quick Add Common Fields")) {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        presetChip(label: "+ 一次性验证码 (TOTP)", color: KeysmithColors.accent) {
                            appendField(KSItemField(label: "一次性验证码", fieldType: .totp, value: "", sensitive: true, purpose: .totp))
                        }
                        presetChip(label: "+ 网址", color: .secondary) {
                            appendField(KSItemField(label: "网址", fieldType: .url, value: "https://", sensitive: false))
                        }
                        presetChip(label: "+ 用户名", color: .secondary) {
                            appendField(KSItemField(label: "用户名", fieldType: .text, value: "", sensitive: false, purpose: .username))
                        }
                        presetChip(label: "+ 密码", color: .secondary) {
                            appendField(KSItemField(label: "密码", fieldType: .password, value: "", sensitive: true, purpose: .password))
                        }
                        presetChip(label: "+ 恢复代码", color: .secondary) {
                            appendField(KSItemField(label: "恢复代码", fieldType: .multiline, value: "", sensitive: true, purpose: .recoveryCodes))
                        }
                        presetChip(label: "+ PIN 码", color: .secondary) {
                            appendField(KSItemField(label: "PIN 码", fieldType: .password, value: "", sensitive: true, purpose: .pin))
                        }
                    }
                    .padding(.vertical, 2)
                }
            }

            Section(store.l10n.t(zhCN: "关联网址", en: "Websites")) {
                ForEach($draft.urls) { $urlItem in
                    HStack {
                        TextField("https://example.com", text: $urlItem.uri)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .keyboardType(.URL)
                    }
                }
                .onDelete { offsets in
                    draft.urls.remove(atOffsets: offsets)
                }

                HStack {
                    TextField("https://example.com", text: $newUrlString)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                    Button(store.l10n.t(zhCN: "添加", en: "Add")) {
                        let trimmed = newUrlString.trimmingCharacters(in: .whitespacesAndNewlines)
                        guard !trimmed.isEmpty else { return }
                        draft.urls.append(KSItemUrl(uri: trimmed))
                        newUrlString = ""
                    }
                }
            }

            Section(store.l10n.t(zhCN: "备注", en: "Notes")) {
                TextEditor(text: $draft.notes)
                    .frame(minHeight: 90)
            }

            if let errorMessage {
                Section {
                    Text(errorMessage)
                        .font(.caption)
                        .foregroundStyle(KeysmithColors.danger)
                }
            }
        }
        .navigationTitle(existingItem == nil
            ? store.l10n.t(zhCN: "新建条目", en: "New Item")
            : store.l10n.t(zhCN: "编辑条目", en: "Edit Item"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button(store.l10n.cancel) {
                    onCancel()
                }
            }
            ToolbarItem(placement: .confirmationAction) {
                Button(store.l10n.save) {
                    Task { await save() }
                }
                .disabled(isSaving || draft.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .sheet(item: $scanningFieldLocation) { loc in
            TotpScannerSheet(
                parseQrData: { data in
                    try await store.parseTotpQrImage(data: data)
                },
                onScanned: { scannedUri in
                    if loc.sectionIndex < draft.sections.count,
                       loc.fieldIndex < draft.sections[loc.sectionIndex].fields.count {
                        draft.sections[loc.sectionIndex].fields[loc.fieldIndex].value = scannedUri
                    }
                }
            )
        }
    }

    @ViewBuilder
    private func fieldEditorRow(
        field: Binding<KSItemField>,
        sectionId: String,
        fieldIndex: Int
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                TextField(store.l10n.t(zhCN: "字段名称", en: "Label"), text: field.label)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)

                Spacer()

                Picker("", selection: field.fieldType) {
                    ForEach(KSFieldType.allCases) { type in
                        Text(fieldTypeLabel(type)).tag(type)
                    }
                }
                .labelsHidden()
                .pickerStyle(.menu)
            }

            HStack(spacing: 8) {
                if field.wrappedValue.fieldType == .multiline {
                    TextEditor(text: field.value)
                        .font(.system(.footnote, design: .monospaced))
                        .frame(minHeight: 60)
                } else {
                    TextField(store.l10n.t(zhCN: "输入值", en: "Value"), text: field.value)
                        .font(.system(.subheadline, design: .monospaced))
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }

                if field.wrappedValue.fieldType == .password {
                    Button {
                        let generated = LocalGeneratorEngine.generate(options: KSGeneratorOptions())
                        field.wrappedValue.value = generated.value
                    } label: {
                        Image(systemName: "wand.and.stars")
                            .foregroundStyle(KeysmithColors.accent)
                    }
                    .buttonStyle(.plain)
                }

                if field.wrappedValue.fieldType == .totp {
                    Button {
                        if let secIdx = draft.sections.firstIndex(where: { $0.id == sectionId }) {
                            scanningFieldLocation = FieldLocation(sectionIndex: secIdx, fieldIndex: fieldIndex)
                        }
                    } label: {
                        Label(store.l10n.t(zhCN: "扫二维码", en: "Scan QR"), systemImage: "qrcode.viewfinder")
                            .font(.caption.weight(.semibold))
                            .padding(.horizontal, 8)
                            .padding(.vertical, 5)
                            .background(KeysmithColors.accent.opacity(0.14), in: RoundedRectangle(cornerRadius: 8))
                            .foregroundStyle(KeysmithColors.accent)
                    }
                    .buttonStyle(.plain)
                }
            }

            Toggle(store.l10n.t(zhCN: "敏感掩码", en: "Mask Secret"), isOn: field.sensitive)
                .font(.caption)
        }
        .padding(.vertical, 4)
    }

    private func presetChip(label: String, color: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(.caption.weight(.medium))
                .foregroundStyle(color == .secondary ? .primary : color)
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                .background(
                    (color == .secondary ? Color.secondary.opacity(0.12) : color.opacity(0.14)),
                    in: RoundedRectangle(cornerRadius: 10, style: .continuous)
                )
        }
        .buttonStyle(.plain)
    }

    private func appendField(_ field: KSItemField) {
        if draft.sections.isEmpty {
            draft.sections.append(KSItemSection(title: "", fields: [field]))
        } else {
            draft.sections[0].fields.append(field)
        }
    }

    private func fieldTypeLabel(_ type: KSFieldType) -> String {
        switch type {
        case .text: return "Text"
        case .password: return "Password"
        case .email: return "Email"
        case .url: return "URL"
        case .totp: return "TOTP"
        case .date: return "Date"
        case .monthYear: return "MM/YY"
        case .phone: return "Phone"
        case .number: return "Number"
        case .address: return "Address"
        case .multiline: return "Multiline"
        case .sshPrivateKey: return "SSH Private"
        case .sshPublicKey: return "SSH Public"
        case .keyValue: return "Key-Value"
        }
    }

    private func save() async {
        errorMessage = nil
        isSaving = true
        defer { isSaving = false }
        do {
            let saved: KSItemDetail
            if let existingId = existingItem?.id {
                saved = try await store.updateItem(id: existingId, draft: draft)
            } else {
                saved = try await store.createItem(draft)
            }
            onSaved(saved)
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
