import SwiftUI

/// Tools tab combining the 3-color password/passphrase/PIN generator,
/// Watchtower security dashboard, and encrypted Send share manager.
public struct ToolsTabView: View {
    @Bindable var store: KeysmithStore
    let onOpenSettings: () -> Void

    @State private var showHistorySheet = false
    @State private var showCreateSendSheet = false
    @State private var checkHibpOnScan = false
    @State private var isScanningWatchtower = false

    public init(store: KeysmithStore, onOpenSettings: @escaping () -> Void) {
        self.store = store
        self.onOpenSettings = onOpenSettings
    }

    public var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    generatorCard
                    watchtowerCard
                    sendCard
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle(store.l10n.t(
                zhCN: "工具与安全中心",
                zhTW: "工具與安全中心",
                en: "Tools & Security",
                ja: "ツールとセキュリティ",
                ko: "도구 및 보안",
                de: "Werkzeuge & Sicherheit",
                fr: "Outils et sécurité",
                es: "Herramientas y seguridad"
            ))
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(action: onOpenSettings) {
                        Image(systemName: "gearshape")
                    }
                    .accessibilityLabel(store.l10n.settings)
                }
            }
            .task {
                if store.watchtowerReport == nil && store.session.status == .unlocked {
                    await store.runWatchtowerScan(checkHibp: false)
                }
                await store.loadSends()
                await store.loadGeneratorHistory()
            }
            .sheet(isPresented: $showHistorySheet) {
                GeneratorHistorySheet(store: store)
            }
            .sheet(isPresented: $showCreateSendSheet) {
                CreateTextSendSheet(store: store)
            }
        }
    }

    // MARK: - Password Generator Card

    private var generatorCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Label(
                    store.l10n.t(
                        zhCN: "密码生成器",
                        zhTW: "密碼生成器",
                        en: "Password Generator",
                        ja: "パスワード生成",
                        ko: "비밀번호 생성기"
                    ),
                    systemImage: "wand.and.stars"
                )
                .font(.headline)

                Spacer()

                Button {
                    showHistorySheet = true
                } label: {
                    Label(
                        store.l10n.t(zhCN: "历史", zhTW: "歷史", en: "History"),
                        systemImage: "clock.arrow.circlepath"
                    )
                    .font(.caption.weight(.medium))
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
            }

            Picker(
                store.l10n.t(zhCN: "模式", en: "Mode"),
                selection: Binding(
                    get: { store.generatorOptions.mode },
                    set: { mode in
                        store.generatorOptions.mode = mode
                        store.regeneratePassword()
                    }
                )
            ) {
                Text(store.l10n.t(zhCN: "密码", zhTW: "密碼", en: "Password")).tag(KSGeneratorMode.password)
                Text(store.l10n.t(zhCN: "短语", zhTW: "片語", en: "Passphrase")).tag(KSGeneratorMode.passphrase)
                Text("PIN").tag(KSGeneratorMode.pin)
            }
            .pickerStyle(.segmented)

            VStack(alignment: .leading, spacing: 8) {
                ColoredSecretText(
                    text: store.generatorResult.value,
                    font: .system(.title3, design: .monospaced).monospacedDigit()
                )
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(12)
                .background(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(Color(.secondarySystemGroupedBackground))
                )

                HStack(spacing: 8) {
                    strengthPill(store.generatorResult.strength)
                    Spacer()
                    Text("\(store.generatorResult.strength.entropyBits) bits")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
            }

            generatorControls

            HStack(spacing: 10) {
                Button {
                    store.regeneratePassword()
                } label: {
                    Label(
                        store.l10n.t(zhCN: "换一个", zhTW: "換一個", en: "Regenerate"),
                        systemImage: "arrow.clockwise"
                    )
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)

                Button {
                    store.copyToClipboard(
                        store.generatorResult.value,
                        label: store.l10n.t(zhCN: "新密码", zhTW: "新密碼", en: "Generated Password"),
                        isSensitive: true
                    )
                } label: {
                    Label(store.l10n.copy, systemImage: "doc.on.doc")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(KeysmithColors.accent)
            }
        }
        .padding(16)
        .background(cardBackground)
    }

    @ViewBuilder
    private var generatorControls: some View {
        switch store.generatorOptions.mode {
        case .password:
            VStack(spacing: 10) {
                HStack {
                    Text(store.l10n.t(zhCN: "长度", zhTW: "長度", en: "Length"))
                        .font(.subheadline)
                    Spacer()
                    Text("\(clampedPasswordLength) \(store.l10n.t(zhCN: "位", en: "chars"))")
                        .font(.subheadline.monospacedDigit().weight(.semibold))
                        .foregroundStyle(KeysmithColors.accent)
                }

                Slider(
                    value: Binding(
                        get: { Double(clampedPasswordLength) },
                        set: { newVal in
                            let rounded = Int(newVal.rounded())
                            if store.generatorOptions.length != rounded {
                                store.generatorOptions.length = rounded
                                store.regeneratePassword()
                            }
                        }
                    ),
                    in: 12...32,
                    step: 1
                )
                .tint(KeysmithColors.accent)

                Toggle(
                    store.l10n.t(zhCN: "包含数字 (0-9)", zhTW: "包含數字 (0-9)", en: "Include Digits (0-9)"),
                    isOn: Binding(
                        get: { store.generatorOptions.includeDigits },
                        set: { val in
                            store.generatorOptions.includeDigits = val
                            store.regeneratePassword()
                        }
                    )
                )
                .font(.subheadline)

                Toggle(
                    store.l10n.t(zhCN: "包含特殊符号 (!@#$)", zhTW: "包含特殊符號 (!@#$)", en: "Include Symbols (!@#$)"),
                    isOn: Binding(
                        get: { store.generatorOptions.includeSymbols },
                        set: { val in
                            store.generatorOptions.includeSymbols = val
                            store.regeneratePassword()
                        }
                    )
                )
                .font(.subheadline)

                Toggle(
                    store.l10n.t(zhCN: "排除易混淆字符 (0O / 1lI)", zhTW: "排除易混淆字元 (0O / 1lI)", en: "Exclude Ambiguous (0O / 1lI)"),
                    isOn: Binding(
                        get: { store.generatorOptions.excludeAmbiguous },
                        set: { val in
                            store.generatorOptions.excludeAmbiguous = val
                            store.regeneratePassword()
                        }
                    )
                )
                .font(.subheadline)
            }

        case .passphrase:
            VStack(spacing: 10) {
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
                        zhCN: "词数：\(store.generatorOptions.wordCount) 个单词",
                        en: "Words: \(store.generatorOptions.wordCount)"
                    ))
                    .font(.subheadline)
                }

                Toggle(
                    store.l10n.t(zhCN: "首字母大写", en: "Capitalize Words"),
                    isOn: Binding(
                        get: { store.generatorOptions.capitalize },
                        set: { val in
                            store.generatorOptions.capitalize = val
                            store.regeneratePassword()
                        }
                    )
                )
                .font(.subheadline)

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
                .font(.subheadline)
            }

        case .pin:
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
                    zhCN: "PIN 位数：\(store.generatorOptions.pinLength) 位",
                    en: "PIN Length: \(store.generatorOptions.pinLength)"
                ))
                .font(.subheadline)
            }
        }
    }

    private var clampedPasswordLength: Int {
        min(32, max(12, store.generatorOptions.length))
    }

    private func strengthPill(_ strength: KSPasswordStrength) -> some View {
        let color: Color = switch strength.score {
        case 4...: KeysmithColors.success
        case 3: KeysmithColors.accent
        case 2: KeysmithColors.warning
        default: KeysmithColors.danger
        }
        return Text(strength.label)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 10)
            .padding(.vertical, 3)
            .background(color.opacity(0.14), in: Capsule())
            .foregroundStyle(color)
    }

    // MARK: - Watchtower Dashboard Card

    private var watchtowerCard: some View {
        let report = store.watchtowerReport
        let score = report?.score ?? 100
        let ringColor: Color = score >= 80
            ? KeysmithColors.success
            : (score >= 55 ? KeysmithColors.warning : KeysmithColors.danger)

        return VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 14) {
                ZStack {
                    Circle()
                        .stroke(ringColor.opacity(0.18), lineWidth: 7)
                    Circle()
                        .trim(from: 0, to: CGFloat(min(100, max(0, score))) / 100.0)
                        .stroke(ringColor, style: StrokeStyle(lineWidth: 7, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                    Text("\(score)")
                        .font(.system(.headline, design: .rounded).monospacedDigit().bold())
                        .foregroundStyle(ringColor)
                }
                .frame(width: 58, height: 58)

                VStack(alignment: .leading, spacing: 4) {
                    Text(store.l10n.t(
                        zhCN: "安全守望台 (Watchtower)",
                        zhTW: "安全守望台 (Watchtower)",
                        en: "Watchtower Security"
                    ))
                    .font(.headline)

                    if let report {
                        Text(store.l10n.t(
                            zhCN: "已审计 \(report.totalAudited) 项 · \(report.totalRiskItems) 项需关注",
                            zhTW: "已審計 \(report.totalAudited) 項 · \(report.totalRiskItems) 項需關注",
                            en: "Audited \(report.totalAudited) items · \(report.totalRiskItems) need attention"
                        ))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    } else {
                        Text(store.l10n.t(zhCN: "等待执行安全扫描", en: "Ready to scan vault"))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                Spacer()
            }

            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                watchtowerMetricTile(
                    title: store.l10n.t(zhCN: "弱密码", zhTW: "弱密碼", en: "Weak"),
                    count: report?.count(for: .weak) ?? 0,
                    icon: "exclamationmark.shield",
                    color: KeysmithColors.warning
                )
                watchtowerMetricTile(
                    title: store.l10n.t(zhCN: "重复使用", zhTW: "重複使用", en: "Reused"),
                    count: report?.count(for: .reused) ?? 0,
                    icon: "doc.on.doc.fill",
                    color: KeysmithColors.symbol
                )
                watchtowerMetricTile(
                    title: store.l10n.t(zhCN: "未开 2FA", zhTW: "未啟用 2FA", en: "Missing 2FA"),
                    count: report?.count(for: .missing2fa) ?? 0,
                    icon: "lock.trianglebadge.exclamationmark",
                    color: KeysmithColors.accent
                )
                watchtowerMetricTile(
                    title: store.l10n.t(zhCN: "已泄露 (HIBP)", zhTW: "已洩漏 (HIBP)", en: "Compromised"),
                    count: report?.count(for: .breached) ?? 0,
                    icon: "flame.fill",
                    color: KeysmithColors.danger
                )
            }

            HStack {
                Toggle(
                    store.l10n.t(zhCN: "联网检测泄露 (k-匿名)", en: "Check HIBP (k-anonymity)"),
                    isOn: $checkHibpOnScan
                )
                .font(.caption)
            }

            Button {
                Task {
                    isScanningWatchtower = true
                    await store.runWatchtowerScan(checkHibp: checkHibpOnScan)
                    isScanningWatchtower = false
                }
            } label: {
                HStack {
                    if isScanningWatchtower {
                        ProgressView()
                            .controlSize(.small)
                    } else {
                        Image(systemName: "shield.lefthalf.filled.badge.checkmark")
                    }
                    Text(store.l10n.t(zhCN: "立即执行安全扫描", zhTW: "立即執行安全掃描", en: "Run Watchtower Scan"))
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(KeysmithColors.accent)
            .disabled(isScanningWatchtower)
        }
        .padding(16)
        .background(cardBackground)
    }

    private func watchtowerMetricTile(title: String, count: Int, icon: String, color: Color) -> some View {
        HStack(spacing: 10) {
            Image(systemName: icon)
                .font(.title3)
                .foregroundStyle(count > 0 ? color : KeysmithColors.success)
                .frame(width: 28)

            VStack(alignment: .leading, spacing: 2) {
                Text("\(count)")
                    .font(.headline.monospacedDigit())
                    .foregroundStyle(count > 0 ? color : .primary)
                Text(title)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Spacer(minLength: 0)
        }
        .padding(10)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color(.secondarySystemGroupedBackground))
        )
    }

    // MARK: - Send Encrypted Share Manager

    private var sendCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Label(
                    store.l10n.t(zhCN: "Send 加密分享", zhTW: "Send 加密分享", en: "Encrypted Sends"),
                    systemImage: "paperplane.circle.fill"
                )
                .font(.headline)

                Spacer()

                Button {
                    showCreateSendSheet = true
                } label: {
                    Label(store.l10n.newItem, systemImage: "plus")
                        .font(.caption.weight(.semibold))
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
                .tint(KeysmithColors.accent)
            }

            if store.sends.isEmpty {
                Text(store.l10n.t(
                    zhCN: "暂无有效 Send 分享链接。可创建端到端加密文本并设置过期时间或访问密码。",
                    en: "No active Sends. Create an end-to-end encrypted text share with expiration or password protection."
                ))
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(.vertical, 6)
            } else {
                VStack(spacing: 10) {
                    ForEach(store.sends) { send in
                        sendRow(send)
                    }
                }
            }
        }
        .padding(16)
        .background(cardBackground)
    }

    private func sendRow(_ send: KSSendItem) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: send.sendType == .file ? "doc.fill" : "text.alignleft")
                    .foregroundStyle(KeysmithColors.accent)
                Text(send.name)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
                Spacer()
                if send.hasPassword {
                    Image(systemName: "lock.fill")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                if send.disabled {
                    Text(store.l10n.t(zhCN: "已停用", en: "Disabled"))
                        .font(.caption2.weight(.medium))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(KeysmithColors.danger.opacity(0.14), in: Capsule())
                        .foregroundStyle(KeysmithColors.danger)
                }
            }

            HStack(spacing: 12) {
                Text(store.l10n.t(
                    zhCN: "访问 \(send.accessCount)\(send.maxAccessCount.map { "/\($0)" } ?? "") 次",
                    en: "Views: \(send.accessCount)\(send.maxAccessCount.map { "/\($0)" } ?? "")"
                ))
                Text("·")
                Text(store.l10n.t(zhCN: "删除于 \(shortDate(send.deletionDate))", en: "Deletes \(shortDate(send.deletionDate))"))
            }
            .font(.caption)
            .foregroundStyle(.secondary)

            HStack(spacing: 8) {
                Button {
                    store.copyToClipboard(send.shareUrl, label: "\(send.name) 链接", isSensitive: false)
                } label: {
                    Label(store.l10n.t(zhCN: "复制链接", en: "Copy Link"), systemImage: "link")
                        .font(.caption.weight(.medium))
                }
                .buttonStyle(.bordered)
                .controlSize(.small)

                Spacer()

                Button(role: .destructive) {
                    Task {
                        do {
                            try await store.deleteSend(id: send.id)
                        } catch {
                            store.errorBanner = error.localizedDescription
                        }
                    }
                } label: {
                    Label(store.l10n.t(zhCN: "删除", en: "Delete"), systemImage: "trash")
                        .font(.caption)
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
            }
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color(.secondarySystemGroupedBackground))
        )
    }

    private var cardBackground: some View {
        RoundedRectangle(cornerRadius: 18, style: .continuous)
            .fill(Color(.systemBackground))
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .strokeBorder(Color.primary.opacity(0.06), lineWidth: 1)
            )
    }

    private func shortDate(_ iso: String) -> String {
        if iso.count >= 10 {
            return String(iso.prefix(10))
        }
        return iso
    }
}

// MARK: - Generator History Sheet

private struct GeneratorHistorySheet: View {
    @Bindable var store: KeysmithStore
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                if store.generatorHistory.isEmpty {
                    ContentUnavailableView(
                        store.l10n.t(zhCN: "暂无生成历史", en: "No Generator History"),
                        systemImage: "clock.arrow.circlepath",
                        description: Text(store.l10n.t(
                            zhCN: "生成的密码会以密文形式安全保存在本地。",
                            en: "Generated passwords are stored locally in encrypted form."
                        ))
                    )
                } else {
                    List(store.generatorHistory) { entry in
                        HStack {
                            VStack(alignment: .leading, spacing: 4) {
                                ColoredSecretText(
                                    text: entry.value,
                                    font: .system(.subheadline, design: .monospaced)
                                )
                                Text("\(entry.mode) · \(entry.entropyBits) bits · \(String(entry.createdAt.prefix(16)))")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Button(store.l10n.copy) {
                                store.copyToClipboard(entry.value, label: "历史密码", isSensitive: true)
                            }
                            .buttonStyle(.bordered)
                            .controlSize(.small)
                        }
                    }
                }
            }
            .navigationTitle(store.l10n.t(zhCN: "生成历史", en: "Generator History"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    if !store.generatorHistory.isEmpty {
                        Button(store.l10n.clearClipboard, role: .destructive) {
                            Task { await store.clearGeneratorHistory() }
                        }
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button(store.l10n.done) { dismiss() }
                }
            }
            .task {
                await store.loadGeneratorHistory()
            }
        }
    }
}

// MARK: - Create Text Send Sheet

private struct CreateTextSendSheet: View {
    @Bindable var store: KeysmithStore
    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var text = ""
    @State private var hidden = true
    @State private var password = ""
    @State private var maxAccessEnabled = false
    @State private var maxAccessCount = 3
    @State private var deletionDays = 7
    @State private var hideEmail = false
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                Section(store.l10n.t(zhCN: "分享内容", en: "Content")) {
                    TextField(store.l10n.t(zhCN: "标题（例如：临时 SSH Token）", en: "Title"), text: $name)
                    TextEditor(text: $text)
                        .frame(minHeight: 110)
                        .font(.system(.body, design: .monospaced))
                    Toggle(store.l10n.t(zhCN: "默认隐藏文本内容", en: "Hide text by default"), isOn: $hidden)
                }

                Section(store.l10n.t(zhCN: "访问控制", en: "Access Control")) {
                    Picker(store.l10n.t(zhCN: "自动删除时间", en: "Deletion Delay"), selection: $deletionDays) {
                        Text("1 天").tag(1)
                        Text("7 天").tag(7)
                        Text("30 天").tag(30)
                    }
                    Toggle(store.l10n.t(zhCN: "限制最大访问次数", en: "Limit Access Count"), isOn: $maxAccessEnabled)
                    if maxAccessEnabled {
                        Stepper(value: $maxAccessCount, in: 1...50) {
                            Text("最多 \(maxAccessCount) 次")
                        }
                    }
                    SecureField(store.l10n.t(zhCN: "可选访问密码", en: "Optional password"), text: $password)
                    Toggle(store.l10n.t(zhCN: "隐藏我的邮箱", en: "Hide my email"), isOn: $hideEmail)
                }

                if let errorMessage {
                    Section {
                        Text(errorMessage)
                            .foregroundStyle(KeysmithColors.danger)
                            .font(.caption)
                    }
                }
            }
            .navigationTitle(store.l10n.t(zhCN: "新建 Send 分享", en: "New Text Send"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(store.l10n.cancel) { dismiss() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button(store.l10n.t(zhCN: "创建并复制", en: "Create")) {
                        Task { await createSend() }
                    }
                    .disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || text.isEmpty || isSubmitting)
                }
            }
        }
    }

    private func createSend() async {
        isSubmitting = true
        defer { isSubmitting = false }
        let deletionDate = Calendar.current.date(byAdding: .day, value: deletionDays, to: Date()) ?? Date()
        let iso = ISO8601DateFormatter().string(from: deletionDate)
        let input = KSSendCreateTextInput(
            name: name.trimmingCharacters(in: .whitespacesAndNewlines),
            text: text,
            hidden: hidden,
            maxAccessCount: maxAccessEnabled ? maxAccessCount : nil,
            deletionDate: iso,
            password: password.isEmpty ? nil : password,
            hideEmail: hideEmail
        )
        do {
            let created = try await store.createTextSend(input)
            store.copyToClipboard(created.shareUrl, label: created.name, isSensitive: false)
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
