import SwiftUI

public struct iPhoneItemsView: View {
    public let store: KeysmithStore
    @Binding public var filterPreset: KSItemsFilterPreset
    public var selectedVaultId: String?
    public var isSearchMode: Bool
    public var onSelectItem: (String) -> Void
    public var onNewItem: () -> Void
    public var onOpenSettings: () -> Void

    @State private var searchQuery: String = ""

    public init(
        store: KeysmithStore,
        filterPreset: Binding<KSItemsFilterPreset>,
        selectedVaultId: String? = nil,
        isSearchMode: Bool = false,
        onSelectItem: @escaping (String) -> Void,
        onNewItem: @escaping () -> Void,
        onOpenSettings: @escaping () -> Void
    ) {
        self.store = store
        self._filterPreset = filterPreset
        self.selectedVaultId = selectedVaultId
        self.isSearchMode = isSearchMode
        self.onSelectItem = onSelectItem
        self.onNewItem = onNewItem
        self.onOpenSettings = onOpenSettings
    }

    private var filteredItems: [KSItemSummary] {
        store.visibleItems.filter { item in
            if let selectedVaultId, item.vaultId != selectedVaultId {
                return false
            }
            if !isSearchMode {
                switch filterPreset {
                case .all:
                    break
                case .favorites:
                    if !item.favorite { return false }
                case .category(let cat):
                    if cat == .passkey {
                        if item.category != .passkey && !item.hasPasskey { return false }
                    } else if item.category != cat {
                        return false
                    }
                }
            }
            return matchesSearch(item: item, query: searchQuery)
        }
    }

    public var body: some View {
        List {
            if !isSearchMode {
                Section {
                    filterChipsRow
                        .listRowInsets(EdgeInsets(top: 6, leading: 0, bottom: 6, trailing: 0))
                        .listRowBackground(Color.clear)
                }
            }

            if filteredItems.isEmpty {
                ContentUnavailableView(
                    store.l10n.t(zhCN: "未找到匹配条目", en: "No Matching Items"),
                    systemImage: "magnifyingglass",
                    description: Text(store.l10n.t(zhCN: "尝试更改筛选条件或搜索关键字", en: "Try a different filter or search query"))
                )
                .listRowBackground(Color.clear)
            } else {
                Section {
                    ForEach(filteredItems) { item in
                        Button {
                            onSelectItem(item.id)
                        } label: {
                            HStack(spacing: 12) {
                                KSItemIconBadge(title: item.title, icon: item.icon, category: item.category, size: 38)

                                VStack(alignment: .leading, spacing: 3) {
                                    HStack(spacing: 4) {
                                        if item.favorite {
                                            Image(systemName: "star.fill")
                                                .font(.caption2)
                                                .foregroundStyle(.yellow)
                                        }
                                        Text(item.title)
                                            .font(.subheadline.weight(.semibold))
                                            .foregroundStyle(.primary)
                                            .lineLimit(1)
                                    }
                                    Text(item.subtitle.isEmpty ? store.l10n.categoryTitle(item.category) : item.subtitle)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(1)
                                }

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
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                            if item.hasPassword && !item.reprompt {
                                Button {
                                    Task {
                                        if let detail = try? await store.getItemDetail(id: item.id),
                                           let pw = detail.primaryPassword {
                                            store.copyToClipboard(pw, label: item.title, isSensitive: true)
                                        }
                                    }
                                } label: {
                                    Label(store.l10n.copy, systemImage: "key.fill")
                                }
                                .tint(KeysmithColors.accent)
                            }
                            if let username = item.username, !username.isEmpty {
                                Button {
                                    store.copyToClipboard(username, label: store.l10n.t(zhCN: "用户名", en: "Username"), isSensitive: false)
                                } label: {
                                    Label(store.l10n.t(zhCN: "用户名", en: "User"), systemImage: "person.fill")
                                }
                                .tint(KeysmithColors.success)
                            }
                        }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(isSearchMode ? store.l10n.tabSearch : store.l10n.allItems)
        .searchable(
            text: $searchQuery,
            placement: .navigationBarDrawer(displayMode: isSearchMode ? .always : .automatic),
            prompt: Text(store.l10n.t(zhCN: "搜索标题、账号或 is:passkey", en: "Search items or is:passkey"))
        )
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button(action: onNewItem) {
                    Image(systemName: "plus")
                        .fontWeight(.semibold)
                        .foregroundStyle(KeysmithColors.accent)
                }
                Button(action: onOpenSettings) {
                    Image(systemName: "gearshape")
                }
            }
        }
    }

    private var filterChipsRow: some View {
        let presets: [(String, KSItemsFilterPreset)] = [
            (store.l10n.t(zhCN: "全部", en: "All"), .all),
            (store.l10n.t(zhCN: "收藏", en: "Favorites"), .favorites),
            (store.l10n.categoryTitle(.login), .category(.login)),
            (store.l10n.categoryTitle(.passkey), .category(.passkey)),
            (store.l10n.categoryTitle(.creditCard), .category(.creditCard)),
            (store.l10n.categoryTitle(.sshKey), .category(.sshKey)),
        ]
        return ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(presets, id: \.0) { title, preset in
                    let active = filterPreset == preset
                    Button {
                        filterPreset = preset
                    } label: {
                        Text(title)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(active ? .white : .primary)
                            .padding(.horizontal, 13)
                            .padding(.vertical, 7)
                            .background(
                                active ? KeysmithColors.accent : Color(.secondarySystemGroupedBackground),
                                in: Capsule()
                            )
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 16)
        }
    }

    private func matchesSearch(item: KSItemSummary, query: String) -> Bool {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !trimmed.isEmpty else { return true }
        if trimmed == "is:passkey" { return item.hasPasskey }
        if trimmed == "is:totp" { return item.hasTotp }
        if trimmed == "is:favorite" { return item.favorite }
        if trimmed.hasPrefix("tag:") {
            let tag = String(trimmed.dropFirst(4))
            return item.tags.contains { $0.lowercased().contains(tag) }
        }
        return item.title.localizedCaseInsensitiveContains(trimmed)
            || item.subtitle.localizedCaseInsensitiveContains(trimmed)
            || (item.username ?? "").localizedCaseInsensitiveContains(trimmed)
            || (item.primaryUrl ?? "").localizedCaseInsensitiveContains(trimmed)
            || item.tags.contains { $0.localizedCaseInsensitiveContains(trimmed) }
    }
}
