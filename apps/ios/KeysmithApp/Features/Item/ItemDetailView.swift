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
    @State private var isRepromptPasswordVisible: Bool = false
    @State private var isVerifyingReprompt: Bool = false
    @State private var repromptError: String?
    @State private var largeTypeTarget: LargeTypePayload?
    @State private var recentlyCopiedFieldID: String?
    @State private var showNavTitle: Bool = false
    @Environment(\.openURL) private var openURL

    private struct LargeTypePayload: Identifiable {
        let id = UUID()
        let title: String
        let secret: String
        let copyable: Bool
        let isSensitive: Bool
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
        .onScrollGeometryChange(for: Bool.self) { geo in
            geo.contentOffset.y > 56
        } action: { _, collapsed in
            if showNavTitle != collapsed {
                withAnimation(.easeInOut(duration: 0.16)) {
                    showNavTitle = collapsed
                }
            }
        }
        .navigationTitle(showNavTitle ? (detail?.title ?? "") : "")
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
            LargeTypeSheet(
                title: payload.title,
                secret: payload.secret,
                closeTitle: store.l10n.close,
                copyTitle: payload.copyable ? store.l10n.copy : nil,
                onCopy: payload.copyable ? {
                    store.copyToClipboard(payload.secret, label: payload.title, isSensitive: payload.isSensitive)
                } : nil
            )
        }
        .onChange(of: itemId) { _, _ in
            repromptUnlocked = false
            repromptPassword = ""
            repromptError = nil
            revealedFieldIDs.removeAll()
            showNavTitle = false
        }
        .task(id: "\(itemId)-\(store.itemDetailRefreshToken)") {
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
            KSItemFaviconBadge(
                store: store,
                title: detail.title,
                icon: detail.icon,
                primaryUrl: detail.urls.first?.uri,
                category: detail.category,
                size: 48
            )

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
        let biometry = AppleBiometricKeyStore.shared.currentBiometryKind()
        let biometryName = store.l10n.biometryName(biometry)
        return VStack(alignment: .leading, spacing: 12) {
            Label(
                store.l10n.t(zhCN: "此条目已启用二次身份验证", en: "Identity verification required"),
                systemImage: "lock.shield.fill"
            )
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(KeysmithColors.symbol)

            Text(store.l10n.t(
                zhCN: "查看或复制敏感字段前，请先通过 \(biometryName) 或主密码验证。",
                en: "Verify with \(biometryName) or master password before viewing or copying secrets."
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
                Label(store.l10n.verifyWithBiometry(biometry), systemImage: biometry.systemImage)
                    .font(.subheadline.weight(.semibold))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .foregroundStyle(.white)
                    .background(KeysmithColors.accent, in: RoundedRectangle(cornerRadius: 12))
            }

            HStack(spacing: 8) {
                HStack(spacing: 6) {
                    Group {
                        if isRepromptPasswordVisible {
                            TextField(store.l10n.masterPasswordPlaceholder, text: $repromptPassword)
                        } else {
                            SecureField(store.l10n.masterPasswordPlaceholder, text: $repromptPassword)
                        }
                    }
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .onSubmit {
                        Task { await verifyRepromptPassword() }
                    }

                    Button {
                        isRepromptPasswordVisible.toggle()
                    } label: {
                        Image(systemName: isRepromptPasswordVisible ? "eye.slash" : "eye")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .background(Color(.tertiarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 10, style: .continuous))

                Button {
                    Task { await verifyRepromptPassword() }
                } label: {
                    if isVerifyingReprompt {
                        ProgressView().controlSize(.small)
                    } else {
                        Text(store.l10n.unlock)
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(KeysmithColors.accent)
                .disabled(isVerifyingReprompt || repromptPassword.isEmpty)
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

    private func verifyRepromptPassword() async {
        repromptError = nil
        isVerifyingReprompt = true
        defer { isVerifyingReprompt = false }
        do {
            try await store.verifyMasterPassword(repromptPassword)
            repromptPassword = ""
            repromptUnlocked = true
        } catch {
            repromptError = error.localizedDescription
        }
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

    private func triggerFieldCopy(id: String, value: String, label: String, isSensitive: Bool) {
        store.copyToClipboard(value, label: label, isSensitive: isSensitive)
        recentlyCopiedFieldID = id
        Task {
            try? await Task.sleep(for: .seconds(1.2))
            if recentlyCopiedFieldID == id {
                recentlyCopiedFieldID = nil
            }
        }
    }

    private func fieldRow(_ field: KSItemField) -> some View {
        let shouldMaskForCapture = store.isScreenCaptured && store.session.screenCaptureProtected && field.sensitive
        let isRevealed = !field.sensitive || (revealedFieldIDs.contains(field.id) && !shouldMaskForCapture)
        let isCopied = recentlyCopiedFieldID == field.id

        return HStack(alignment: .center, spacing: 8) {
            VStack(alignment: .leading, spacing: 5) {
                Text(field.label)
                    .font(.caption)
                    .foregroundStyle(.secondary)

                if field.sensitive || field.fieldType == .password || field.fieldType == .sshPrivateKey {
                    ColoredSecretText(
                        text: field.value,
                        font: .system(.body, design: .monospaced).monospacedDigit(),
                        isMasked: !isRevealed
                    )
                    .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    Text(field.value)
                        .font(.system(.body, design: .monospaced))
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .contentShape(Rectangle())
            .onTapGesture {
                if field.copyable && !field.value.isEmpty {
                    triggerFieldCopy(
                        id: field.id,
                        value: field.value,
                        label: field.label,
                        isSensitive: field.sensitive
                    )
                }
            }

            if !field.value.isEmpty {
                HStack(spacing: 4) {
                    if field.sensitive {
                        Button {
                            if revealedFieldIDs.contains(field.id) {
                                revealedFieldIDs.remove(field.id)
                            } else {
                                revealedFieldIDs.insert(field.id)
                            }
                        } label: {
                            Image(systemName: isRevealed ? "eye.slash" : "eye")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                                .frame(width: 34, height: 34)
                                .background(Color.secondary.opacity(0.10), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(isRevealed ? store.l10n.hide : store.l10n.reveal)
                    }

                    if field.copyable {
                        Button {
                            triggerFieldCopy(
                                id: field.id,
                                value: field.value,
                                label: field.label,
                                isSensitive: field.sensitive
                            )
                        } label: {
                            Image(systemName: isCopied ? "checkmark" : "doc.on.doc")
                                .font(.subheadline.weight(.medium))
                                .foregroundStyle(isCopied ? KeysmithColors.success : KeysmithColors.accent)
                                .frame(width: 34, height: 34)
                                .background(
                                    (isCopied ? KeysmithColors.success : KeysmithColors.accent).opacity(0.14),
                                    in: RoundedRectangle(cornerRadius: 9, style: .continuous)
                                )
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(store.l10n.copy)
                    }

                    Menu {
                        if field.copyable {
                            Button {
                                triggerFieldCopy(
                                    id: field.id,
                                    value: field.value,
                                    label: field.label,
                                    isSensitive: field.sensitive
                                )
                            } label: {
                                Label(store.l10n.copy, systemImage: "doc.on.doc")
                            }
                        }
                        if field.sensitive {
                            Button {
                                if revealedFieldIDs.contains(field.id) {
                                    revealedFieldIDs.remove(field.id)
                                } else {
                                    revealedFieldIDs.insert(field.id)
                                }
                            } label: {
                                Label(
                                    isRevealed ? store.l10n.hide : store.l10n.reveal,
                                    systemImage: isRevealed ? "eye.slash" : "eye"
                                )
                            }
                        }
                        Button {
                            largeTypeTarget = LargeTypePayload(
                                title: field.label,
                                secret: field.value,
                                copyable: field.copyable,
                                isSensitive: field.sensitive
                            )
                        } label: {
                            Label(store.l10n.largeType, systemImage: "textformat.size.larger")
                        }
                    } label: {
                        Image(systemName: "ellipsis")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .frame(width: 32, height: 34)
                            .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                    }
                    .accessibilityLabel(store.l10n.largeType)
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
        .contextMenu {
            if field.copyable && !field.value.isEmpty {
                Button {
                    triggerFieldCopy(
                        id: field.id,
                        value: field.value,
                        label: field.label,
                        isSensitive: field.sensitive
                    )
                } label: {
                    Label(store.l10n.copy, systemImage: "doc.on.doc")
                }
            }
            if field.sensitive {
                Button {
                    if revealedFieldIDs.contains(field.id) {
                        revealedFieldIDs.remove(field.id)
                    } else {
                        revealedFieldIDs.insert(field.id)
                    }
                } label: {
                    Label(
                        isRevealed ? store.l10n.hide : store.l10n.reveal,
                        systemImage: isRevealed ? "eye.slash" : "eye"
                    )
                }
            }
            if !field.value.isEmpty {
                Button {
                    largeTypeTarget = LargeTypePayload(
                        title: field.label,
                        secret: field.value,
                        copyable: field.copyable,
                        isSensitive: field.sensitive
                    )
                } label: {
                    Label(store.l10n.largeType, systemImage: "textformat.size.larger")
                }
            }
        }
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
                        triggerFieldCopy(
                            id: "__totp__",
                            value: code,
                            label: store.l10n.t(zhCN: "验证码", en: "2FA Code"),
                            isSensitive: true
                        )
                    }
                } label: {
                    let totpCopied = recentlyCopiedFieldID == "__totp__"
                    Image(systemName: totpCopied ? "checkmark" : "doc.on.doc")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.white)
                        .frame(width: 40, height: 40)
                        .background(
                            totpCopied ? KeysmithColors.success : KeysmithColors.accent,
                            in: RoundedRectangle(cornerRadius: 12, style: .continuous)
                        )
                }
                .buttonStyle(.plain)
                .accessibilityLabel(store.l10n.copy)
            }
            .padding(14)
            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .contentShape(Rectangle())
            .onTapGesture {
                if let code = totp?.code {
                    triggerFieldCopy(
                        id: "__totp__",
                        value: code,
                        label: store.l10n.t(zhCN: "验证码", en: "2FA Code"),
                        isSensitive: true
                    )
                }
            }
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
        VStack(alignment: .leading, spacing: 0) {
            Text(store.l10n.t(zhCN: "关联网址", en: "Websites"))
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .padding(.horizontal, 14)
                .padding(.top, 12)
                .padding(.bottom, 8)

            ForEach(Array(urls.enumerated()), id: \.element.id) { idx, urlItem in
                if idx > 0 {
                    Divider().padding(.leading, 14)
                }
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 4) {
                        if let label = urlItem.label, !label.isEmpty {
                            Text(label)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        } else if let host = URL(string: urlItem.uri)?.host, !host.isEmpty {
                            Text(host)
                                .font(.caption.weight(.medium))
                                .foregroundStyle(.secondary)
                        }
                        Text(urlItem.uri)
                            .font(.subheadline.monospaced())
                            .lineLimit(2)
                            .truncationMode(.middle)
                            .textSelection(.enabled)
                    }
                    Spacer(minLength: 8)
                    HStack(spacing: 10) {
                        Button {
                            store.copyToClipboard(
                                urlItem.uri,
                                label: store.l10n.t(zhCN: "网址", en: "URL"),
                                isSensitive: false
                            )
                        } label: {
                            Image(systemName: "doc.on.doc")
                                .font(.subheadline)
                                .frame(width: 36, height: 36)
                                .background(Color.secondary.opacity(0.12), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                        }
                        .buttonStyle(.plain)

                        if let parsed = URL(string: urlItem.uri) {
                            Button {
                                openURL(parsed)
                            } label: {
                                Image(systemName: "arrow.up.right.square")
                                    .font(.subheadline)
                                    .foregroundStyle(KeysmithColors.accent)
                                    .frame(width: 36, height: 36)
                                    .background(KeysmithColors.accent.opacity(0.14), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
            }
        }
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
