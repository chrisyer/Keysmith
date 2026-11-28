import SwiftUI

public enum KSItemsFilterPreset: Hashable, Sendable {
    case all
    case favorites
    case category(KSItemCategory)
}

public struct iPhoneHomeView: View {
    public let store: KeysmithStore
    @Binding public var selectedVaultId: String?
    public var onSelectItem: (String) -> Void
    public var onNewItem: () -> Void
    public var onOpenSettings: () -> Void
    public var onJumpToItems: (KSItemsFilterPreset) -> Void

    @State private var totpSecretsByItemId: [String: String] = [:]
    @State private var primaryPasswordsByItemId: [String: String] = [:]

    public init(
        store: KeysmithStore,
        selectedVaultId: Binding<String?>,
        onSelectItem: @escaping (String) -> Void,
        onNewItem: @escaping () -> Void,
        onOpenSettings: @escaping () -> Void,
        onJumpToItems: @escaping (KSItemsFilterPreset) -> Void
    ) {
        self.store = store
        self._selectedVaultId = selectedVaultId
        self.onSelectItem = onSelectItem
        self.onNewItem = onNewItem
        self.onOpenSettings = onOpenSettings
        self.onJumpToItems = onJumpToItems
    }

    private var scopedItems: [KSItemSummary] {
        store.visibleItems.filter { item in
            guard let selectedVaultId else { return true }
            return item.vaultId == selectedVaultId
        }
    }

    private var favoriteItems: [KSItemSummary] {
        scopedItems.filter(\.favorite)
    }

    private var totpItems: [KSItemSummary] {
        Array(scopedItems.filter(\.hasTotp).prefix(2))
    }

    private var activeVaultName: String {
        if let selectedVaultId, let vault = store.vaults.first(where: { $0.id == selectedVaultId }) {
            return vault.name
        }
        return store.l10n.allVaults
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if store.session.travelMode {
                    travelModeBanner
                }

                favoritesSection

                if !totpItems.isEmpty {
                    liveTotpSection
                }

                recentSection

                quickCategoriesGrid
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 24)
        }
        .background(Color(.systemGroupedBackground))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Menu {
                    Button {
                        selectedVaultId = nil
                    } label: {
                        HStack {
                            Text(store.l10n.allVaults)
                            if selectedVaultId == nil {
                                Image(systemName: "checkmark")
                            }
                        }
                    }
                    Divider()
                    ForEach(store.vaults) { vault in
                        Button {
                            selectedVaultId = vault.id
                        } label: {
                            HStack {
                                Text(vault.name)
                                if selectedVaultId == vault.id {
                                    Image(systemName: "checkmark")
                                }
                            }
                        }
                    }
                } label: {
                    HStack(spacing: 6) {
                        Circle()
                            .fill(store.syncStatus.signalrConnected || store.isDemoMode ? KeysmithColors.success : Color.secondary)
                            .frame(width: 7, height: 7)
                        Text(activeVaultName)
                            .font(.subheadline.weight(.semibold))
                        Image(systemName: "chevron.down")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(.secondary)
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                }
            }

            ToolbarItemGroup(placement: .topBarTrailing) {
                Button(action: onNewItem) {
                    Image(systemName: "plus")
                        .fontWeight(.semibold)
                        .foregroundStyle(KeysmithColors.accent)
                }
                .accessibilityLabel(store.l10n.newItem)

                Button(action: onOpenSettings) {
                    Image(systemName: "gearshape")
                }
                .accessibilityLabel(store.l10n.settings)
            }
        }
        .task(id: scopedItems.map(\.id)) {
            await preloadSecretsForHome()
        }
    }

    private var travelModeBanner: some View {
        HStack {
            Label(
                store.l10n.t(zhCN: "旅行模式已开启（仅显示旅行安全条目）", en: "Travel Mode Active"),
                systemImage: "airplane"
            )
            .font(.caption.weight(.medium))
            .foregroundStyle(KeysmithColors.symbol)
            Spacer()
            Button(store.l10n.settings, action: onOpenSettings)
                .font(.caption.weight(.semibold))
                .foregroundStyle(KeysmithColors.symbol)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(KeysmithColors.symbol.opacity(0.14), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private var favoritesSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("\(store.l10n.favorites) (\(favoriteItems.count))")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.secondary)
                Spacer()
                Button {
                    onJumpToItems(.favorites)
                } label: {
                    Text(store.l10n.t(zhCN: "全部 (\(favoriteItems.count)) ›", en: "All (\(favoriteItems.count)) ›"))
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(KeysmithColors.accent)
                }
            }

            if favoriteItems.isEmpty {
                Text(store.l10n.t(zhCN: "星标收藏常用条目后将显示在这里", en: "Star favorite items for quick access"))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16))
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(spacing: 12) {
                        ForEach(favoriteItems) { item in
                            favoriteCard(item)
                                .frame(width: 158)
                        }
                    }
                    .scrollTargetLayout()
                    .padding(.vertical, 2)
                }
                .scrollTargetBehavior(.viewAligned)
            }
        }
    }

    private func favoriteCard(_ item: KSItemSummary) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Button {
                onSelectItem(item.id)
            } label: {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        KSItemFaviconBadge(
                            store: store,
                            title: item.title,
                            icon: item.icon,
                            primaryUrl: item.primaryUrl,
                            category: item.category,
                            size: 36
                        )
                        Spacer()
                        if item.hasPasskey {
                            Text("PK")
                                .font(.caption2.weight(.bold))
                                .foregroundStyle(KeysmithColors.success)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(KeysmithColors.success.opacity(0.14), in: RoundedRectangle(cornerRadius: 6))
                        }
                    }

                    Text(item.title)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.primary)
                        .lineLimit(1)

                    Text(item.subtitle.isEmpty ? store.l10n.categoryTitle(item.category) : item.subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.plain)

            Button {
                Task { await copyPrimaryPassword(for: item) }
            } label: {
                Text(store.l10n.t(zhCN: "复制密码", en: "Copy Password"))
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.primary)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
                    .background(Color(.tertiarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 10))
            }
            .buttonStyle(.plain)
        }
        .padding(12)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private var liveTotpSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(store.l10n.liveTotp)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)

            TimelineView(.periodic(from: .now, by: 1.0)) { context in
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                    ForEach(totpItems) { item in
                        let secret = totpSecretsByItemId[item.id] ?? ""
                        let totp = secret.isEmpty ? nil : store.computeTotp(secret, at: context.date)
                        let urgent = (totp?.remainingSeconds ?? 30) <= 5

                        Button {
                            if let code = totp?.code {
                                store.copyToClipboard(code, label: "\(item.title) 2FA", isSensitive: true)
                            } else {
                                onSelectItem(item.id)
                            }
                        } label: {
                            VStack(alignment: .leading, spacing: 6) {
                                Text(item.title)
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(.primary)
                                    .lineLimit(1)
                                Text(totp?.formattedCode ?? "--- ---")
                                    .font(.system(.title3, design: .monospaced).monospacedDigit().weight(.bold))
                                    .foregroundStyle(urgent ? KeysmithColors.danger : KeysmithColors.accent)
                                Text("\(totp?.remainingSeconds ?? 30)s · \(store.l10n.t(zhCN: "点按复制", en: "Tap to copy"))")
                                    .font(.caption2.monospacedDigit())
                                    .foregroundStyle(.secondary)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(12)
                            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private var recentSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(store.l10n.recentItems)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)

            VStack(spacing: 0) {
                let recents = Array(scopedItems.prefix(3))
                ForEach(Array(recents.enumerated()), id: \.element.id) { idx, item in
                    if idx > 0 {
                        Divider().padding(.leading, 56)
                    }
                    HStack(spacing: 12) {
                        Button {
                            onSelectItem(item.id)
                        } label: {
                            HStack(spacing: 12) {
                                KSItemFaviconBadge(
                                    store: store,
                                    title: item.title,
                                    icon: item.icon,
                                    primaryUrl: item.primaryUrl,
                                    category: item.category,
                                    size: 36
                                )
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(item.title)
                                        .font(.subheadline.weight(.semibold))
                                        .foregroundStyle(.primary)
                                        .lineLimit(1)
                                    Text(item.subtitle)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(1)
                                }
                                Spacer()
                            }
                        }
                        .buttonStyle(.plain)

                        Button {
                            Task { await copyPrimaryPassword(for: item) }
                        } label: {
                            Text(store.l10n.copy)
                                .font(.subheadline.weight(.medium))
                                .padding(.horizontal, 13)
                                .padding(.vertical, 8)
                                .background(Color(.tertiarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 10))
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(12)
                }
            }
            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
    }

    private var quickCategoriesGrid: some View {
        let categories: [KSItemCategory] = [.login, .passkey, .creditCard, .sshKey]
        return LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
            ForEach(categories) { category in
                let count = scopedItems.filter { item in
                    category == .passkey ? (item.category == .passkey || item.hasPasskey) : item.category == category
                }.count
                Button {
                    onJumpToItems(.category(category))
                } label: {
                    HStack {
                        Label(store.l10n.categoryTitle(category), systemImage: category.systemImage)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(.primary)
                        Spacer()
                        Text("\(count)")
                            .font(.subheadline.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                    .padding(14)
                    .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func preloadSecretsForHome() async {
        for item in totpItems where totpSecretsByItemId[item.id] == nil {
            if let detail = try? await store.getItemDetail(id: item.id), let totp = detail.primaryTotp {
                totpSecretsByItemId[item.id] = totp
            }
        }
    }

    private func copyPrimaryPassword(for item: KSItemSummary) async {
        if item.reprompt {
            onSelectItem(item.id)
            return
        }
        if let cached = primaryPasswordsByItemId[item.id] {
            store.copyToClipboard(cached, label: item.title, isSensitive: true)
            return
        }
        if let detail = try? await store.getItemDetail(id: item.id), let pw = detail.primaryPassword {
            primaryPasswordsByItemId[item.id] = pw
            store.copyToClipboard(pw, label: item.title, isSensitive: true)
        } else {
            onSelectItem(item.id)
        }
    }
}
