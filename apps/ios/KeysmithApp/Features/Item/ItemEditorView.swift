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
    @State private var generatorFieldLocation: FieldLocation?

    private struct FieldLocation: Identifiable {
        let id = UUID()
        let sectionIndex: Int
        let fieldIndex: Int
    }

    public init(
        store: KeysmithStore,
        existingItem: KSItemDetail? = nil,
        initialDraft: KSItemDraft? = nil,
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
        } else if let initialDraft {
            _draft = State(initialValue: initialDraft)
        } else {
            let fallbackVault = defaultVaultId ?? store.vaults.first(where: { $0.isDefault })?.id ?? store.vaults.first?.id ?? "personal"
            let usernameLabel = store.l10n.t(zhCN: "用户名", en: "Username")
            let passwordLabel = store.l10n.t(zhCN: "密码", en: "Password")
            let initialDraft = KSItemDraft(
                vaultId: fallbackVault,
                title: "",
                category: .login,
                sections: [
                    KSItemSection(
                        id: UUID().uuidString,
                        title: "",
                        fields: [
                            KSItemField(label: usernameLabel, fieldType: .text, value: "", sensitive: false, purpose: .username),
                            KSItemField(label: passwordLabel, fieldType: .password, value: "", sensitive: true, purpose: .password),
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
                Toggle(store.l10n.t(zhCN: "查看前需二次验证", en: "Require Identity Reprompt"), isOn: $draft.reprompt)
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
                        presetChip(
                            label: store.l10n.t(zhCN: "+ 一次性验证码 (TOTP)", en: "+ One-Time Code (TOTP)"),
                            color: KeysmithColors.accent
                        ) {
                            appendField(KSItemField(
                                label: store.l10n.t(zhCN: "一次性验证码", en: "One-Time Code"),
                                fieldType: .totp,
                                value: "",
                                sensitive: true,
                                purpose: .totp
                            ))
                        }
                        presetChip(label: store.l10n.t(zhCN: "+ 网址", en: "+ URL"), color: .secondary) {
                            appendField(KSItemField(
                                label: store.l10n.t(zhCN: "网址", en: "URL"),
                                fieldType: .url,
                                value: "https://",
                                sensitive: false
                            ))
                        }
                        presetChip(label: store.l10n.t(zhCN: "+ 用户名", en: "+ Username"), color: .secondary) {
                            appendField(KSItemField(
                                label: store.l10n.t(zhCN: "用户名", en: "Username"),
                                fieldType: .text,
                                value: "",
                                sensitive: false,
                                purpose: .username
                            ))
                        }
                        presetChip(label: store.l10n.t(zhCN: "+ 密码", en: "+ Password"), color: .secondary) {
                            appendField(KSItemField(
                                label: store.l10n.t(zhCN: "密码", en: "Password"),
                                fieldType: .password,
                                value: "",
                                sensitive: true,
                                purpose: .password
                            ))
                        }
                        presetChip(label: store.l10n.t(zhCN: "+ 恢复代码", en: "+ Recovery Codes"), color: .secondary) {
                            appendField(KSItemField(
                                label: store.l10n.t(zhCN: "恢复代码", en: "Recovery Codes"),
                                fieldType: .multiline,
                                value: "",
                                sensitive: true,
                                purpose: .recoveryCodes
                            ))
                        }
                        presetChip(label: store.l10n.t(zhCN: "+ PIN 码", en: "+ PIN"), color: .secondary) {
                            appendField(KSItemField(
                                label: store.l10n.t(zhCN: "PIN 码", en: "PIN"),
                                fieldType: .password,
                                value: "",
                                sensitive: true,
                                purpose: .pin
                            ))
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
                        .submitLabel(.done)
                        .onSubmit { commitPendingUrl() }
                    Button(store.l10n.t(zhCN: "添加", en: "Add")) {
                        commitPendingUrl()
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
        .scrollDismissesKeyboard(.interactively)
        .onChange(of: draft.category) { _, newCategory in
            applyTemplateIfEmpty(for: newCategory)
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
                l10n: store.l10n,
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
        .sheet(item: $generatorFieldLocation) { loc in
            KeysmithPasswordGeneratorSheet(store: store) { generatedValue in
                if loc.sectionIndex < draft.sections.count,
                   loc.fieldIndex < draft.sections[loc.sectionIndex].fields.count {
                    draft.sections[loc.sectionIndex].fields[loc.fieldIndex].value = generatedValue
                }
            }
        }
    }

    @ViewBuilder
    private func fieldEditorRow(
        field: Binding<KSItemField>,
        sectionId: String,
        fieldIndex: Int
    ) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
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

            Group {
                if field.wrappedValue.fieldType == .multiline || field.wrappedValue.fieldType == .sshPrivateKey {
                    TextEditor(text: field.value)
                        .font(.system(.footnote, design: .monospaced))
                        .frame(minHeight: 72)
                } else {
                    TextField(store.l10n.t(zhCN: "输入值", en: "Value"), text: field.value)
                        .font(.system(.subheadline, design: .monospaced))
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 9)
            .background(Color(.tertiarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 10, style: .continuous))

            HStack(spacing: 8) {
                if field.wrappedValue.fieldType == .password {
                    Button {
                        let generated = LocalGeneratorEngine.generate(options: store.generatorOptions)
                        field.wrappedValue.value = generated.value
                    } label: {
                        Label(store.l10n.t(zhCN: "随机生成", en: "Generate"), systemImage: "wand.and.stars")
                            .font(.caption.weight(.semibold))
                            .padding(.horizontal, 10)
                            .padding(.vertical, 7)
                            .background(KeysmithColors.accent.opacity(0.14), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                            .foregroundStyle(KeysmithColors.accent)
                    }
                    .buttonStyle(.plain)

                    Button {
                        if let secIdx = draft.sections.firstIndex(where: { $0.id == sectionId }) {
                            generatorFieldLocation = FieldLocation(sectionIndex: secIdx, fieldIndex: fieldIndex)
                        }
                    } label: {
                        Label(store.l10n.t(zhCN: "选项", en: "Options"), systemImage: "slider.horizontal.3")
                            .font(.caption.weight(.medium))
                            .padding(.horizontal, 10)
                            .padding(.vertical, 7)
                            .background(Color.secondary.opacity(0.12), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
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
                            .padding(.horizontal, 10)
                            .padding(.vertical, 7)
                            .background(KeysmithColors.accent.opacity(0.14), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                            .foregroundStyle(KeysmithColors.accent)
                    }
                    .buttonStyle(.plain)
                }

                Spacer(minLength: 4)

                Button {
                    field.wrappedValue.sensitive.toggle()
                } label: {
                    let masked = field.wrappedValue.sensitive
                    Label(
                        masked ? store.l10n.t(zhCN: "掩码", en: "Masked") : store.l10n.t(zhCN: "明文", en: "Plain"),
                        systemImage: masked ? "lock.fill" : "lock.open"
                    )
                    .font(.caption.weight(.medium))
                    .foregroundStyle(masked ? KeysmithColors.symbol : .secondary)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(
                        (masked ? KeysmithColors.symbol : Color.secondary).opacity(0.12),
                        in: Capsule()
                    )
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.vertical, 6)
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

    private func commitPendingUrl() {
        let trimmed = newUrlString.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        draft.urls.append(KSItemUrl(uri: trimmed))
        newUrlString = ""
    }

    private func applyTemplateIfEmpty(for category: KSItemCategory) {
        guard existingItem == nil else { return }
        let allValuesEmpty = draft.sections.allSatisfy { sec in
            sec.fields.allSatisfy { $0.value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        }
        guard allValuesEmpty else { return }

        let fields: [KSItemField]
        switch category {
        case .creditCard:
            fields = [
                KSItemField(label: store.l10n.t(zhCN: "持卡人", en: "Cardholder"), fieldType: .text, value: "", sensitive: false),
                KSItemField(label: store.l10n.t(zhCN: "卡号", en: "Card Number"), fieldType: .number, value: "", sensitive: true, purpose: .cardNumber),
                KSItemField(label: store.l10n.t(zhCN: "有效期", en: "Expiry"), fieldType: .monthYear, value: "", sensitive: false, purpose: .cardExpiry),
                KSItemField(label: "CVV", fieldType: .password, value: "", sensitive: true, purpose: .cardCvv),
            ]
        case .sshKey:
            fields = [
                KSItemField(label: store.l10n.t(zhCN: "公钥", en: "Public Key"), fieldType: .sshPublicKey, value: "", sensitive: false),
                KSItemField(label: store.l10n.t(zhCN: "私钥", en: "Private Key"), fieldType: .sshPrivateKey, value: "", sensitive: true),
            ]
        case .apiCredential:
            fields = [
                KSItemField(label: "API Key / Client ID", fieldType: .text, value: "", sensitive: false),
                KSItemField(label: "Secret / Token", fieldType: .password, value: "", sensitive: true, purpose: .password),
            ]
        case .database, .server:
            fields = [
                KSItemField(label: store.l10n.t(zhCN: "主机地址", en: "Host"), fieldType: .url, value: "", sensitive: false),
                KSItemField(label: store.l10n.t(zhCN: "用户名", en: "Username"), fieldType: .text, value: "", sensitive: false, purpose: .username),
                KSItemField(label: store.l10n.t(zhCN: "密码", en: "Password"), fieldType: .password, value: "", sensitive: true, purpose: .password),
            ]
        case .secureNote:
            fields = []
        default:
            fields = [
                KSItemField(label: store.l10n.t(zhCN: "用户名", en: "Username"), fieldType: .text, value: "", sensitive: false, purpose: .username),
                KSItemField(label: store.l10n.t(zhCN: "密码", en: "Password"), fieldType: .password, value: "", sensitive: true, purpose: .password),
            ]
        }
        draft.sections = fields.isEmpty ? [] : [KSItemSection(id: UUID().uuidString, title: "", fields: fields)]
    }

    private func fieldTypeLabel(_ type: KSFieldType) -> String {
        switch type {
        case .text: return store.l10n.t(zhCN: "文本", en: "Text")
        case .password: return store.l10n.t(zhCN: "密码", en: "Password")
        case .email: return store.l10n.t(zhCN: "邮箱", en: "Email")
        case .url: return store.l10n.t(zhCN: "网址", en: "URL")
        case .totp: return "TOTP"
        case .date: return store.l10n.t(zhCN: "日期", en: "Date")
        case .monthYear: return store.l10n.t(zhCN: "年月 (MM/YY)", en: "MM/YY")
        case .phone: return store.l10n.t(zhCN: "电话", en: "Phone")
        case .number: return store.l10n.t(zhCN: "数字", en: "Number")
        case .address: return store.l10n.t(zhCN: "地址", en: "Address")
        case .multiline: return store.l10n.t(zhCN: "多行文本", en: "Multiline")
        case .sshPrivateKey: return store.l10n.t(zhCN: "SSH 私钥", en: "SSH Private")
        case .sshPublicKey: return store.l10n.t(zhCN: "SSH 公钥", en: "SSH Public")
        case .keyValue: return store.l10n.t(zhCN: "键值对", en: "Key-Value")
        }
    }

    private func save() async {
        commitPendingUrl()
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

public struct KeysmithPasswordGeneratorSheet: View {
    @Bindable public var store: KeysmithStore
    public var onUsePassword: ((String) -> Void)?
    @Environment(\.dismiss) private var dismiss

    public init(store: KeysmithStore, onUsePassword: ((String) -> Void)? = nil) {
        self.store = store
        self.onUsePassword = onUsePassword
    }

    private var clampedLength: Int {
        min(64, max(8, store.generatorOptions.length))
    }

    public var body: some View {
        NavigationStack {
            Form {
                Section(store.l10n.t(zhCN: "预览", en: "Preview")) {
                    VStack(alignment: .leading, spacing: 10) {
                        ColoredSecretText(
                            text: store.generatorResult.value,
                            font: .system(.title3, design: .monospaced).monospacedDigit()
                        )
                        .frame(maxWidth: .infinity, alignment: .leading)

                        HStack {
                            Text(store.generatorResult.strength.label)
                                .font(.caption.weight(.semibold))
                                .padding(.horizontal, 10)
                                .padding(.vertical, 4)
                                .background(KeysmithColors.success.opacity(0.14), in: Capsule())
                                .foregroundStyle(KeysmithColors.success)

                            Spacer()

                            Text("\(store.generatorResult.strength.entropyBits) bits")
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding(.vertical, 4)

                    HStack(spacing: 12) {
                        Button {
                            store.regeneratePassword()
                        } label: {
                            Label(store.l10n.t(zhCN: "换一个", en: "Regenerate"), systemImage: "arrow.clockwise")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)

                        Button {
                            if let onUsePassword {
                                onUsePassword(store.generatorResult.value)
                                dismiss()
                            } else {
                                store.copyToClipboard(
                                    store.generatorResult.value,
                                    label: store.l10n.t(zhCN: "生成的密码", en: "Generated Password"),
                                    isSensitive: true
                                )
                            }
                        } label: {
                            Label(
                                onUsePassword != nil
                                    ? store.l10n.t(zhCN: "填入密码", en: "Use Password")
                                    : store.l10n.t(zhCN: "复制密码", en: "Copy Password"),
                                systemImage: onUsePassword != nil ? "checkmark" : "doc.on.doc"
                            )
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(KeysmithColors.accent)
                    }
                }

                Section(store.l10n.t(zhCN: "生成模式", en: "Mode")) {
                    Picker(
                        store.l10n.t(zhCN: "类型", en: "Type"),
                        selection: Binding(
                            get: { store.generatorOptions.mode },
                            set: { mode in
                                store.generatorOptions.mode = mode
                                store.regeneratePassword()
                            }
                        )
                    ) {
                        Text(store.l10n.t(zhCN: "随机密码", en: "Password")).tag(KSGeneratorMode.password)
                        Text(store.l10n.t(zhCN: "助记短语", en: "Passphrase")).tag(KSGeneratorMode.passphrase)
                        Text("PIN").tag(KSGeneratorMode.pin)
                    }
                    .pickerStyle(.segmented)
                }

                if store.generatorOptions.mode == .password {
                    Section(store.l10n.t(zhCN: "长度与字符要求", en: "Length & Character Rules")) {
                        VStack(alignment: .leading, spacing: 8) {
                            Stepper(
                                value: Binding(
                                    get: { clampedLength },
                                    set: { val in
                                        store.generatorOptions.length = val
                                        store.regeneratePassword()
                                    }
                                ),
                                in: 8...64
                            ) {
                                HStack {
                                    Text(store.l10n.t(zhCN: "密码长度", en: "Length"))
                                    Spacer()
                                    Text("\(clampedLength) \(store.l10n.t(zhCN: "位", en: "chars"))")
                                        .font(.subheadline.monospacedDigit().weight(.semibold))
                                        .foregroundStyle(KeysmithColors.accent)
                                }
                            }

                            Slider(
                                value: Binding(
                                    get: { Double(clampedLength) },
                                    set: { val in
                                        let rounded = Int(val.rounded())
                                        if store.generatorOptions.length != rounded {
                                            store.generatorOptions.length = rounded
                                            store.regeneratePassword()
                                        }
                                    }
                                ),
                                in: 8...64,
                                step: 1
                            )
                            .tint(KeysmithColors.accent)
                        }

                        Toggle(
                            store.l10n.t(zhCN: "包含大写字母 (A-Z)", en: "Uppercase (A-Z)"),
                            isOn: Binding(
                                get: { store.generatorOptions.includeUppercase },
                                set: { val in
                                    store.generatorOptions.includeUppercase = val
                                    store.regeneratePassword()
                                }
                            )
                        )

                        Toggle(
                            store.l10n.t(zhCN: "包含小写字母 (a-z)", en: "Lowercase (a-z)"),
                            isOn: Binding(
                                get: { store.generatorOptions.includeLowercase },
                                set: { val in
                                    store.generatorOptions.includeLowercase = val
                                    store.regeneratePassword()
                                }
                            )
                        )

                        Toggle(
                            store.l10n.t(zhCN: "包含数字 (0-9)", en: "Digits (0-9)"),
                            isOn: Binding(
                                get: { store.generatorOptions.includeDigits },
                                set: { val in
                                    store.generatorOptions.includeDigits = val
                                    store.regeneratePassword()
                                }
                            )
                        )

                        if store.generatorOptions.includeDigits {
                            Stepper(
                                value: Binding(
                                    get: { store.generatorOptions.minDigits },
                                    set: { val in
                                        store.generatorOptions.minDigits = val
                                        store.regeneratePassword()
                                    }
                                ),
                                in: 0...9
                            ) {
                                Text(store.l10n.t(
                                    zhCN: "最少数字位数：\(store.generatorOptions.minDigits)",
                                    en: "Min digits: \(store.generatorOptions.minDigits)"
                                ))
                            }
                        }

                        Toggle(
                            store.l10n.t(zhCN: "包含特殊符号 (!@#$)", en: "Special Symbols (!@#$)"),
                            isOn: Binding(
                                get: { store.generatorOptions.includeSymbols },
                                set: { val in
                                    store.generatorOptions.includeSymbols = val
                                    store.regeneratePassword()
                                }
                            )
                        )

                        if store.generatorOptions.includeSymbols {
                            Stepper(
                                value: Binding(
                                    get: { store.generatorOptions.minSymbols },
                                    set: { val in
                                        store.generatorOptions.minSymbols = val
                                        store.regeneratePassword()
                                    }
                                ),
                                in: 0...9
                            ) {
                                Text(store.l10n.t(
                                    zhCN: "最少特殊字符数：\(store.generatorOptions.minSymbols)",
                                    en: "Min symbols: \(store.generatorOptions.minSymbols)"
                                ))
                            }
                        }

                        Toggle(
                            store.l10n.t(zhCN: "排除易混淆字符 (0O / 1lI)", en: "Exclude Ambiguous (0O / 1lI)"),
                            isOn: Binding(
                                get: { store.generatorOptions.excludeAmbiguous },
                                set: { val in
                                    store.generatorOptions.excludeAmbiguous = val
                                    store.regeneratePassword()
                                }
                            )
                        )
                    }
                } else if store.generatorOptions.mode == .passphrase {
                    Section(store.l10n.t(zhCN: "短语参数", en: "Passphrase Rules")) {
                        Stepper(
                            value: Binding(
                                get: { store.generatorOptions.wordCount },
                                set: { val in
                                    store.generatorOptions.wordCount = val
                                    store.regeneratePassword()
                                }
                            ),
                            in: 3...10
                        ) {
                            Text(store.l10n.t(
                                zhCN: "单词数量：\(store.generatorOptions.wordCount)",
                                en: "Words: \(store.generatorOptions.wordCount)"
                            ))
                        }

                        Picker(
                            store.l10n.t(zhCN: "分隔符", en: "Separator"),
                            selection: Binding(
                                get: { store.generatorOptions.separator },
                                set: { val in
                                    store.generatorOptions.separator = val
                                    store.regeneratePassword()
                                }
                            )
                        ) {
                            Text("-").tag("-")
                            Text(".").tag(".")
                            Text("_").tag("_")
                            Text(store.l10n.t(zhCN: "空格", en: "Space")).tag(" ")
                        }

                        Toggle(
                            store.l10n.t(zhCN: "首字母大写", en: "Capitalize"),
                            isOn: Binding(
                                get: { store.generatorOptions.capitalize },
                                set: { val in
                                    store.generatorOptions.capitalize = val
                                    store.regeneratePassword()
                                }
                            )
                        )

                        Toggle(
                            store.l10n.t(zhCN: "附加随机数字", en: "Include Number"),
                            isOn: Binding(
                                get: { store.generatorOptions.includeNumberInPhrase },
                                set: { val in
                                    store.generatorOptions.includeNumberInPhrase = val
                                    store.regeneratePassword()
                                }
                            )
                        )
                    }
                } else {
                    Section(store.l10n.t(zhCN: "PIN 位数", en: "PIN Length")) {
                        Stepper(
                            value: Binding(
                                get: { store.generatorOptions.pinLength },
                                set: { val in
                                    store.generatorOptions.pinLength = val
                                    store.regeneratePassword()
                                }
                            ),
                            in: 4...12
                        ) {
                            Text(store.l10n.t(
                                zhCN: "位数：\(store.generatorOptions.pinLength) 位",
                                en: "Digits: \(store.generatorOptions.pinLength)"
                            ))
                        }
                    }
                }
            }
            .navigationTitle(store.l10n.t(zhCN: "密码生成选项", en: "Password Options"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(store.l10n.cancel) { dismiss() }
                }
            }
            .onAppear {
                if store.generatorResult.value.isEmpty {
                    store.regeneratePassword()
                }
            }
        }
    }
}
