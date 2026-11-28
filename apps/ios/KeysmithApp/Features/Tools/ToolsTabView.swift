import SwiftUI

/// Security Center tab combining the Watchtower security dashboard
/// and encrypted Send share manager.
public struct ToolsTabView: View {
    @Bindable var store: KeysmithStore
    let isEmbeddedInNavigationStack: Bool
    let onOpenSettings: () -> Void
    let onSelectItem: ((String) -> Void)?
    let onScanTotp: (() -> Void)?

    @State private var showCreateSendSheet = false
    @State private var showGeneratorSheet = false
    @State private var checkHibpOnScan = false
    @State private var isScanningWatchtower = false
    @State private var selectedIssueFilter: KSWatchtowerIssue? = nil

    public init(
        store: KeysmithStore,
        isEmbeddedInNavigationStack: Bool = false,
        onOpenSettings: @escaping () -> Void,
        onSelectItem: ((String) -> Void)? = nil,
        onScanTotp: (() -> Void)? = nil
    ) {
        self.store = store
        self.isEmbeddedInNavigationStack = isEmbeddedInNavigationStack
        self.onOpenSettings = onOpenSettings
        self.onSelectItem = onSelectItem
        self.onScanTotp = onScanTotp
    }

    public var body: some View {
        Group {
            if isEmbeddedInNavigationStack {
                mainContent
            } else {
                NavigationStack {
                    mainContent
                }
            }
        }
        .sheet(isPresented: $showCreateSendSheet) {
            CreateTextSendSheet(store: store)
        }
        .sheet(isPresented: $showGeneratorSheet) {
            KeysmithPasswordGeneratorSheet(store: store)
        }
    }

    private var mainContent: some View {
        ScrollView {
            VStack(spacing: 16) {
                quickToolsCard
                watchtowerCard
                sendCard
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
        }
        .background(Color(.systemGroupedBackground))
        .refreshable {
            await store.runWatchtowerScan(checkHibp: checkHibpOnScan)
            await store.loadSends()
        }
        .navigationTitle(store.l10n.tabTools)
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
        }
    }

    // MARK: - Quick Security Tools (Generator & TOTP Scanner)

    private var quickToolsCard: some View {
        let cols = onScanTotp == nil
            ? [GridItem(.flexible())]
            : [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)]
        return LazyVGrid(columns: cols, spacing: 10) {
            Button {
                showGeneratorSheet = true
            } label: {
                HStack(spacing: 10) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .fill(KeysmithColors.accent.opacity(0.14))
                        Image(systemName: "wand.and.stars")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(KeysmithColors.accent)
                    }
                    .frame(width: 36, height: 36)

                    VStack(alignment: .leading, spacing: 2) {
                        Text(store.l10n.t(zhCN: "密码生成器", zhTW: "密碼產生器", en: "Generator"))
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(.primary)
                            .lineLimit(1)
                        Text(store.l10n.t(zhCN: "强密码 / 短语 / PIN", en: "Passwords & PIN"))
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    Spacer(minLength: 0)
                }
                .padding(12)
                .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
            .buttonStyle(.plain)

            if let onScanTotp {
                Button(action: onScanTotp) {
                    HStack(spacing: 10) {
                        ZStack {
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .fill(KeysmithColors.success.opacity(0.14))
                            Image(systemName: "qrcode.viewfinder")
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(KeysmithColors.success)
                        }
                        .frame(width: 36, height: 36)

                        VStack(alignment: .leading, spacing: 2) {
                            Text(store.l10n.t(zhCN: "扫 2FA 二维码", zhTW: "掃描 2FA QR 碼", en: "Scan 2FA QR"))
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(.primary)
                                .lineLimit(1)
                            Text(store.l10n.t(zhCN: "扫描并保存新条目", en: "Create TOTP item"))
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(12)
                    .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                }
                .buttonStyle(.plain)
            }
        }
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
                    issue: .weak,
                    title: store.l10n.t(zhCN: "弱密码", zhTW: "弱密碼", en: "Weak"),
                    count: report?.count(for: .weak) ?? 0,
                    icon: "exclamationmark.shield",
                    color: KeysmithColors.warning
                )
                watchtowerMetricTile(
                    issue: .reused,
                    title: store.l10n.t(zhCN: "重复使用", zhTW: "重複使用", en: "Reused"),
                    count: report?.count(for: .reused) ?? 0,
                    icon: "doc.on.doc.fill",
                    color: KeysmithColors.symbol
                )
                watchtowerMetricTile(
                    issue: .missing2fa,
                    title: store.l10n.t(zhCN: "未开 2FA", zhTW: "未啟用 2FA", en: "Missing 2FA"),
                    count: report?.count(for: .missing2fa) ?? 0,
                    icon: "lock.trianglebadge.exclamationmark",
                    color: KeysmithColors.accent
                )
                watchtowerMetricTile(
                    issue: .breached,
                    title: store.l10n.t(zhCN: "已泄露 (HIBP)", zhTW: "已洩漏 (HIBP)", en: "Compromised"),
                    count: report?.count(for: .breached) ?? 0,
                    icon: "flame.fill",
                    color: KeysmithColors.danger
                )
            }

            if let report {
                let flagged = flaggedItems(in: report)
                if !flagged.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text(selectedIssueFilter.map { issueLabel($0) }
                                 ?? store.l10n.t(zhCN: "待处理风险条目", en: "Flagged Items"))
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.secondary)
                            Spacer()
                            if selectedIssueFilter != nil {
                                Button(store.l10n.t(zhCN: "显示全部", en: "Show All")) {
                                    selectedIssueFilter = nil
                                }
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(KeysmithColors.accent)
                            }
                        }

                        VStack(spacing: 0) {
                            ForEach(Array(flagged.enumerated()), id: \.element.item.id) { idx, entry in
                                if idx > 0 {
                                    Divider().padding(.leading, 48)
                                }
                                Button {
                                    onSelectItem?(entry.item.id)
                                } label: {
                                    HStack(spacing: 10) {
                                        KSItemFaviconBadge(
                                            store: store,
                                            title: entry.item.title,
                                            icon: entry.item.icon,
                                            primaryUrl: entry.item.primaryUrl,
                                            category: entry.item.category,
                                            size: 32
                                        )
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(entry.item.title)
                                                .font(.subheadline.weight(.semibold))
                                                .foregroundStyle(.primary)
                                                .lineLimit(1)
                                            Text(entry.issues.map { issueLabel($0) }.joined(separator: " · "))
                                                .font(.caption2)
                                                .foregroundStyle(KeysmithColors.warning)
                                                .lineLimit(1)
                                        }
                                        Spacer()
                                        Image(systemName: "chevron.right")
                                            .font(.caption.weight(.semibold))
                                            .foregroundStyle(.tertiary)
                                    }
                                    .padding(.horizontal, 10)
                                    .padding(.vertical, 9)
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .background(
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .fill(Color(.tertiarySystemGroupedBackground))
                        )
                    }
                }
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

    private func watchtowerMetricTile(
        issue: KSWatchtowerIssue,
        title: String,
        count: Int,
        icon: String,
        color: Color
    ) -> some View {
        let isSelected = selectedIssueFilter == issue
        return Button {
            selectedIssueFilter = isSelected ? nil : issue
        } label: {
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
                    .fill(Color(.tertiarySystemGroupedBackground))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(isSelected ? color : Color.clear, lineWidth: 1.5)
            )
        }
        .buttonStyle(.plain)
    }

    private func flaggedItems(in report: KSWatchtowerReport) -> [(item: KSItemSummary, issues: [KSWatchtowerIssue])] {
        let targetIds: Set<String>
        if let selected = selectedIssueFilter {
            targetIds = Set(report.itemIdsByIssue[selected.rawValue] ?? [])
        } else {
            var union = Set(report.itemIssues.keys)
            for ids in report.itemIdsByIssue.values {
                union.formUnion(ids)
            }
            targetIds = union
        }
        return store.visibleItems
            .filter { targetIds.contains($0.id) }
            .map { item in
                let issues = report.itemIssues[item.id] ?? item.issues
                return (item, issues)
            }
    }

    private func issueLabel(_ issue: KSWatchtowerIssue) -> String {
        switch issue {
        case .weak: return store.l10n.t(zhCN: "弱密码", zhTW: "弱密碼", en: "Weak")
        case .reused: return store.l10n.t(zhCN: "重复使用", zhTW: "重複使用", en: "Reused")
        case .missing2fa: return store.l10n.t(zhCN: "未开 2FA", zhTW: "未啟用 2FA", en: "Missing 2FA")
        case .unsecuredUrl: return store.l10n.t(zhCN: "不安全链接", en: "Insecure URL")
        case .expiring: return store.l10n.t(zhCN: "即将过期", en: "Expiring")
        case .breached: return store.l10n.t(zhCN: "已泄露", zhTW: "已洩漏", en: "Compromised")
        case .passkeyAvailable: return store.l10n.t(zhCN: "可升级 Passkey", en: "Passkey Available")
        }
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
                    store.copyToClipboard(
                        send.shareUrl,
                        label: store.l10n.t(zhCN: "\(send.name) 链接", en: "\(send.name) Link"),
                        isSensitive: false
                    )
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
                .fill(Color(.tertiarySystemGroupedBackground))
        )
    }

    private var cardBackground: some View {
        RoundedRectangle(cornerRadius: 18, style: .continuous)
            .fill(Color(.secondarySystemGroupedBackground))
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .strokeBorder(Color.primary.opacity(0.05), lineWidth: 1)
            )
    }

    private func shortDate(_ iso: String) -> String {
        if iso.count >= 10 {
            return String(iso.prefix(10))
        }
        return iso
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
                        Text(store.l10n.t(zhCN: "1 天", en: "1 day")).tag(1)
                        Text(store.l10n.t(zhCN: "7 天", en: "7 days")).tag(7)
                        Text(store.l10n.t(zhCN: "30 天", en: "30 days")).tag(30)
                    }
                    Toggle(store.l10n.t(zhCN: "限制最大访问次数", en: "Limit Access Count"), isOn: $maxAccessEnabled)
                    if maxAccessEnabled {
                        Stepper(value: $maxAccessCount, in: 1...50) {
                            Text(store.l10n.t(zhCN: "最多 \(maxAccessCount) 次", en: "Max \(maxAccessCount) views"))
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
