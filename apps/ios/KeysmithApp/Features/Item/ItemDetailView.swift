import SwiftUI

public struct ItemDetailView: View {
    public let store: KeysmithStore
    public let itemId: String
    public var onEdit: (KSItemDetail) -> Void
    public var onDeleted: () -> Void

    @State private var detail: KSItemDetail?
    @State private var isLoading: Bool = true
    @State private var revealedFieldIDs: Set<String> = []
    @State private var repromptUnlocked: Bool = false
    @State private var repromptPassword: String = ""
    @State private var repromptError: String?
    @State private var largeTypeTarget: LargeTypePayload?
    @Environment(\.openURL) private var openURL

    private struct LargeTypePayload: Identifiable {
        let id = UUID()
        let title: String
        let secret: String
    }

    public init(
        store: KeysmithStore,
        itemId: String,
        onEdit: @escaping (KSItemDetail) -> Void = { _ in },
        onDeleted: @escaping () -> Void = {}
    ) {
        self.store = store
        self.itemId = itemId
        self.onEdit = onEdit
        self.onDeleted = onDeleted
    }

    public var body: some View {
        ScrollView {
            if isLoading {
                ProgressView()
                    .frame(maxWidth: .infinity, minHeight: 220)
            } else if let detail {
                VStack(spacing: 14) {
                    headerCard(detail)

                    if detail.reprompt && !repromptUnlocked {
                        repromptGateCard(detail)
                    } else {
                        fieldsCards(detail)
                        if let totpValue = detail.primaryTotp {
                            totpLiveCard(totpValue)
                        }
                        if !detail.passkeys.isEmpty {
                            passkeysCard(detail.passkeys)
                        }
                        if !detail.urls.isEmpty {
                            urlsCard(detail.urls)
                        }
                        if !detail.notes.isEmpty {
                            notesCard(detail.notes)
                        }
                    }

                    metadataFooter(detail)
                }
                .padding()
            } else {
                ContentUnavailableView(
                    store.l10n.t(zhCN: "条目不存在", en: "Item Not Found"),
                    systemImage: "key.slash"
                )
            }
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle(detail?.title ?? "")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let detail {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    Button {
                        Task {
                            try? await store.toggleFavorite(id: detail.id)
                            await loadDetail()
                        }
                    } label: {
                        Image(systemName: detail.favorite ? "star.fill" : "star")
                            .foregroundStyle(detail.favorite ? Color.yellow : Color.primary)
                    }

                    Button(store.l10n.edit) {
                        onEdit(detail)
                    }

                    Menu {
                        if detail.deletedAt != nil {
                            Button(store.l10n.t(zhCN: "放回原处", en: "Restore")) {
                                Task {
                                    try? await store.restoreItem(id: detail.id)
                                    await loadDetail()
                                }
                            }
                            Button(store.l10n.t(zhCN: "彻底删除", en: "Delete Permanently"), role: .destructive) {
                                Task {
                                    try? await store.deleteItemPermanently(id: detail.id)
                                    onDeleted()
                                }
                            }
                        } else {
                            Button(store.l10n.t(zhCN: "移入废纸篓", en: "Move to Trash"), role: .destructive) {
                                Task {
                                    try? await store.trashItem(id: detail.id)
                                    onDeleted()
                                }
                            }
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                }
            }
        }
        .sheet(item: $largeTypeTarget) { payload in
            LargeTypeSheet(title: payload.title, secret: payload.secret)
        }
        .task(id: itemId) {
            repromptUnlocked = false
            revealedFieldIDs.removeAll()
            await loadDetail()
        }
    }

    private func loadDetail() async {
        isLoading = true
        defer { isLoading = false }
        detail = try? await store.getItemDetail(id: itemId)
    }

    private func headerCard(_ detail: KSItemDetail) -> some View {
        let vaultName = store.vaults.first(where: { $0.id == detail.vaultId })?.name ?? ""
        return HStack(spacing: 14) {
            KSItemIconBadge(title: detail.title, icon: detail.icon, category: detail.category, size: 48)

            VStack(alignment: .leading, spacing: 4) {
                Text(detail.title)
                    .font(.headline)
                HStack(spacing: 6) {
                    if !vaultName.isEmpty {
                        Text(vaultName)
                    }
                    Text("·")
                    Text(store.l10n.categoryTitle(detail.category))
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }

            Spacer()

            if detail.reprompt {
                Text(store.l10n.t(zhCN: "二次验证", en: "Reprompt"))
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(KeysmithColors.symbol)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(KeysmithColors.symbol.opacity(0.14), in: Capsule())
            }
        }
        .padding(14)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private func repromptGateCard(_ detail: KSItemDetail) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(
                store.l10n.t(zhCN: "此条目已启用二次身份验证", en: "Identity verification required"),
                systemImage: "lock.shield.fill"
            )
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(KeysmithColors.symbol)

            Text(store.l10n.t(
                zhCN: "查看或复制敏感字段前，请先通过 Face ID 或主密码验证。",
                en: "Verify with Face ID or master password before viewing or copying secrets."
            ))
            .font(.caption)
            .foregroundStyle(.secondary)

            Button {
                Task {
                    repromptError = nil
                    do {
                        try await store.verifyUserPresence(
                            reason: store.l10n.t(zhCN: "验证身份以查看「\(detail.title)」", en: "Verify to view \(detail.title)")
                        )
                        repromptUnlocked = true
                    } catch {
                        repromptError = error.localizedDescription
                    }
                }
            } label: {
                Label(store.l10n.t(zhCN: "Face ID 验证", en: "Verify with Face ID"), systemImage: "faceid")
                    .font(.subheadline.weight(.semibold))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .foregroundStyle(.white)
                    .background(KeysmithColors.accent, in: RoundedRectangle(cornerRadius: 12))
            }

            HStack {
                SecureField(store.l10n.masterPasswordPlaceholder, text: $repromptPassword)
                    .textFieldStyle(.roundedBorder)
                Button(store.l10n.unlock) {
                    if !repromptPassword.isEmpty {
                        repromptUnlocked = true
                        repromptPassword = ""
                    }
                }
                .buttonStyle(.bordered)
            }

            if let repromptError {
                Text(repromptError)
                    .font(.caption)
                    .foregroundStyle(KeysmithColors.danger)
            }
        }
        .padding(14)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private func fieldsCards(_ detail: KSItemDetail) -> some View {
        ForEach(detail.sections) { section in
            let visibleFields = section.fields.filter { $0.fieldType != .totp }
            if !visibleFields.isEmpty {
                VStack(alignment: .leading, spacing: 0) {
                    if !section.title.isEmpty {
                        Text(section.title)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 14)
                            .padding(.top, 12)
                            .padding(.bottom, 6)
                    }

                    ForEach(Array(visibleFields.enumerated()), id: \.element.id) { idx, field in
                        if idx > 0 {
                            Divider().padding(.leading, 14)
                        }
                        fieldRow(field)
                    }
                }
                .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
        }
    }

    private func fieldRow(_ field: KSItemField) -> some View {
        let shouldMaskForCapture = store.isScreenCaptured && store.session.screenCaptureProtected && field.sensitive
        let isRevealed = !field.sensitive || (revealedFieldIDs.contains(field.id) && !shouldMaskForCapture)

        return VStack(alignment: .leading, spacing: 8) {
            Text(field.label)
                .font(.caption)
                .foregroundStyle(.secondary)

            if field.sensitive || field.fieldType == .password || field.fieldType == .sshPrivateKey {
                ColoredSecretText(
                    text: field.value,
                    font: .system(.subheadline, design: .monospaced).monospacedDigit(),
                    isMasked: !isRevealed
                )
            } else {
                Text(field.value)
                    .font(.system(.subheadline, design: .monospaced))
                    .textSelection(.enabled)
            }

            HStack(spacing: 8) {
                if field.sensitive {
                    Button {
                        if revealedFieldIDs.contains(field.id) {
                            revealedFieldIDs.remove(field.id)
                        } else {
                            revealedFieldIDs.insert(field.id)
                        }
                    } label: {
                        Text(isRevealed ? store.l10n.hide : store.l10n.reveal)
                            .font(.caption.weight(.medium))
                            .padding(.horizontal, 10)
                            .padding(.vertical, 5)
                            .background(Color.secondary.opacity(0.14), in: RoundedRectangle(cornerRadius: 8))
                    }
                    .buttonStyle(.plain)
                }

                if field.copyable && !field.value.isEmpty {
                    Button {
                        store.copyToClipboard(field.value, label: field.label, isSensitive: field.sensitive)
                    } label: {
                        Text(store.l10n.copy)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(KeysmithColors.accent)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 5)
                            .background(KeysmithColors.accent.opacity(0.14), in: RoundedRectangle(cornerRadius: 8))
                    }
                    .buttonStyle(.plain)
                }

                if !field.value.isEmpty {
                    Button {
                        largeTypeTarget = LargeTypePayload(title: field.label, secret: field.value)
                    } label: {
                        Text(store.l10n.largeType)
                            .font(.caption.weight(.medium))
                            .padding(.horizontal, 10)
                            .padding(.vertical, 5)
                            .background(Color.secondary.opacity(0.14), in: RoundedRectangle(cornerRadius: 8))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func totpLiveCard(_ secretOrUri: String) -> some View {
        TimelineView(.periodic(from: .now, by: 1.0)) { context in
            let totp = store.computeTotp(secretOrUri, at: context.date)
            let remaining = totp?.remainingSeconds ?? 30
            let period = max(1, totp?.period ?? 30)
            let progress = Double(remaining) / Double(period)
            let isUrgent = remaining <= 5

            HStack(spacing: 14) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(store.l10n.t(zhCN: "一次性验证码 (TOTP)", en: "One-Time Code (TOTP)"))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text(totp?.formattedCode ?? "--- ---")
                        .font(.system(.title2, design: .monospaced).monospacedDigit().weight(.bold))
                        .foregroundStyle(isUrgent ? KeysmithColors.danger : KeysmithColors.accent)
                }

                Spacer()

                ZStack {
                    Circle()
                        .stroke(Color.secondary.opacity(0.2), lineWidth: 3)
                    Circle()
                        .trim(from: 0, to: progress)
                        .stroke(
                            isUrgent ? KeysmithColors.danger : KeysmithColors.accent,
                            style: StrokeStyle(lineWidth: 3, lineCap: .round)
                        )
                        .rotationEffect(.degrees(-90))
                    Text("\(remaining)s")
                        .font(.caption2.monospacedDigit().weight(.semibold))
                        .foregroundStyle(isUrgent ? KeysmithColors.danger : .primary)
                }
                .frame(width: 38, height: 38)

                Button {
                    if let code = totp?.code {
                        store.copyToClipboard(code, label: store.l10n.t(zhCN: "验证码", en: "2FA Code"), isSensitive: true)
                    }
                } label: {
                    Text(store.l10n.copy)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(KeysmithColors.accent, in: RoundedRectangle(cornerRadius: 10))
                }
                .buttonStyle(.plain)
            }
            .padding(14)
            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
    }

    private func passkeysCard(_ passkeys: [KSPasskeyCredential]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(store.l10n.t(zhCN: "通行密钥 Passkey", en: "Passkeys"))
                    .font(.subheadline.weight(.semibold))
                Spacer()
                Text(store.l10n.t(zhCN: "可用", en: "Active"))
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(KeysmithColors.success)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(KeysmithColors.success.opacity(0.14), in: Capsule())
            }

            ForEach(passkeys) { pk in
                VStack(alignment: .leading, spacing: 4) {
                    Text("RP: \(pk.rpId) · \(pk.algorithm == -8 ? "EdDSA (-8)" : "ECDSA P-256 (-7)")")
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                    Text(store.l10n.t(
                        zhCN: "用户 \(pk.userName) · 已使用 \(pk.signCount) 次",
                        en: "User \(pk.userName) · Used \(pk.signCount) times"
                    ))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private func urlsCard(_ urls: [KSItemUrl]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(store.l10n.t(zhCN: "关联网址", en: "Websites"))
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            ForEach(urls) { urlItem in
                HStack {
                    Text(urlItem.uri)
                        .font(.caption.monospaced())
                        .lineLimit(1)
                    Spacer()
                    if let parsed = URL(string: urlItem.uri) {
                        Button {
                            openURL(parsed)
                        } label: {
                            Image(systemName: "arrow.up.right.square")
                                .foregroundStyle(KeysmithColors.accent)
                        }
                    }
                }
            }
        }
        .padding(14)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private func notesCard(_ notes: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(store.l10n.t(zhCN: "备注", en: "Notes"))
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            Text(notes)
                .font(.subheadline)
                .textSelection(.enabled)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private func metadataFooter(_ detail: KSItemDetail) -> some View {
        HStack {
            Text(store.l10n.t(zhCN: "更新于 \(detail.updatedAt.prefix(10))", en: "Updated \(detail.updatedAt.prefix(10))"))
            Spacer()
            Text("ID: \(detail.id.prefix(8))")
        }
        .font(.caption2.monospaced())
        .foregroundStyle(.secondary)
        .padding(.horizontal, 4)
    }
}
