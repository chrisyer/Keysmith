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
    @State private var cachedSections: [KSAlphabetSection] = []
    @State private var cachedItemCount: Int = 0
    @State private var isConfirmingEmptyTrash: Bool = false

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

    private var showIndexBar: Bool {
        cachedSections.count > 1 && cachedItemCount >= 12
    }

    private var filteredItems: [KSItemSummary] {
        let trimmedQuery = searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let isSearchingTrash = isSearchMode && trimmedQuery == "is:trash"
        let base: [KSItemSummary]
        if (!isSearchMode && filterPreset == .trash) || isSearchingTrash {
            base = store.trashedItems
        } else {
            base = store.visibleItems
        }

        return base.filter { item in
            if let selectedVaultId, item.vaultId != selectedVaultId {
                return false
            }
            if !isSearchMode {
                switch filterPreset {
                case .all, .trash:
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

    private var itemSignature: String {
        let visibleSig = store.visibleItems.map(\.id).joined(separator: ",")
        let trashSig = store.trashedItems.map(\.id).joined(separator: ",")
        return "\(visibleSig)|\(trashSig)"
    }

    private func rebuildSections() {
        let items = filteredItems
        cachedItemCount = items.count
        cachedSections = KSAlphabetIndexer.group(items)
    }

    public var body: some View {
        ScrollViewReader { proxy in
            ZStack(alignment: .trailing) {
                List {
                    if !isSearchMode {
                        Section {
                            filterChipsRow
                                .listRowInsets(EdgeInsets(top: 6, leading: 0, bottom: 6, trailing: 0))
                                .listRowBackground(Color.clear)
                        }
                    } else if searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        Section {
                            searchQuickChipsRow
                                .listRowInsets(EdgeInsets(top: 6, leading: 0, bottom: 6, trailing: 0))
                                .listRowBackground(Color.clear)
                        }
                    }

                    if !isSearchMode && filterPreset == .trash && !store.trashedItems.isEmpty {
                        Section {
                            HStack {
                                Text(store.l10n.t(
                                    zhCN: "废纸篓中有 \(store.trashedItems.count) 个条目",
                                    en: "\(store.trashedItems.count) item(s) in Trash"
                                ))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                Spacer()
                                Button(role: .destructive) {
                                    isConfirmingEmptyTrash = true
                                } label: {
                                    Text(store.l10n.t(zhCN: "清空废纸篓", en: "Empty Trash"))
                                        .font(.caption.weight(.semibold))
                                }
                            }
                        }
                    }

                    if cachedSections.isEmpty {
                        ContentUnavailableView(
                            (!isSearchMode && filterPreset == .trash)
                                ? store.l10n.t(zhCN: "废纸篓为空", en: "Trash is Empty")
                                : store.l10n.t(zhCN: "未找到匹配条目", en: "No Matching Items"),
                            systemImage: (!isSearchMode && filterPreset == .trash) ? "trash" : "magnifyingglass",
                            description: Text(
                                (!isSearchMode && filterPreset == .trash)
                                    ? store.l10n.t(zhCN: "被删除的条目会暂存此处，可随时恢复", en: "Deleted items are kept here and can be restored")
                                    : store.l10n.t(zhCN: "尝试更改筛选条件或搜索关键字", en: "Try a different filter or search query")
                            )
                        )
                        .listRowBackground(Color.clear)
                    } else {
                        ForEach(cachedSections) { section in
                            Section {
                                ForEach(section.items) { item in
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
                                                size: 38
                                            )

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
                                        .padding(.trailing, showIndexBar ? 18 : 0)
                                        .contentShape(Rectangle())
                                    }
                                    .buttonStyle(.plain)
                                    .accessibilityElement(children: .combine)
                                    .accessibilityLabel(
                                        "\(item.title), \(store.l10n.categoryTitle(item.category))"
                                            + (item.hasPasskey ? ", Passkey" : "")
                                    )
                                    .swipeActions(edge: .trailing, allowsFullSwipe: item.deletedAt == nil) {
                                        if item.deletedAt != nil {
                                            Button(role: .destructive) {
                                                Task { try? await store.deleteItemPermanently(id: item.id) }
                                            } label: {
                                                Label(store.l10n.t(zhCN: "彻底删除", en: "Delete"), systemImage: "trash.fill")
                                            }
                                            Button {
                                                Task { try? await store.restoreItem(id: item.id) }
                                            } label: {
                                                Label(store.l10n.t(zhCN: "恢复", en: "Restore"), systemImage: "arrow.uturn.backward")
                                            }
                                            .tint(KeysmithColors.success)
                                        } else {
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
                            } header: {
                                Text(section.letter)
                                    .font(.caption.weight(.bold))
                                    .foregroundStyle(.secondary)
                                    .id("alpha-\(section.letter)")
                            }
                        }
                    }
                }
                .listStyle(.insetGrouped)
                .refreshable {
                    await store.syncNow()
                }

                if showIndexBar {
                    KSAlphabetIndexBar(letters: cachedSections.map(\.letter)) { letter in
                        withAnimation(.snappy(duration: 0.2)) {
                            proxy.scrollTo("alpha-\(letter)", anchor: .top)
                        }
                    }
                    .padding(.trailing, 4)
                }
            }
        }
        .confirmationDialog(
            store.l10n.t(zhCN: "确定清空废纸篓？此操作不可撤销。", en: "Empty Trash? This cannot be undone."),
            isPresented: $isConfirmingEmptyTrash,
            titleVisibility: .visible
        ) {
            Button(store.l10n.t(zhCN: "彻底清空", en: "Empty Trash"), role: .destructive) {
                Task { try? await store.emptyTrash() }
            }
            Button(store.l10n.cancel, role: .cancel) {}
        }
        .onAppear {
            rebuildSections()
        }
        .onChange(of: itemSignature) { _, _ in
            rebuildSections()
        }
        .onChange(of: filterPreset) { _, _ in
            rebuildSections()
        }
        .onChange(of: selectedVaultId) { _, _ in
            rebuildSections()
        }
        .onChange(of: searchQuery) { _, _ in
            rebuildSections()
        }
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
                .accessibilityLabel(store.l10n.newItem)

                Button(action: onOpenSettings) {
                    Image(systemName: "gearshape")
                }
                .accessibilityLabel(store.l10n.settings)
            }
        }
    }

    private var filterChipsRow: some View {
        let trashCount = store.trashedItems.count
        let trashLabel = trashCount > 0
            ? store.l10n.t(zhCN: "废纸篓 (\(trashCount))", en: "Trash (\(trashCount))")
            : store.l10n.t(zhCN: "废纸篓", en: "Trash")
        let presets: [(String, KSItemsFilterPreset)] = [
            (store.l10n.t(zhCN: "全部", en: "All"), .all),
            (store.l10n.t(zhCN: "收藏", en: "Favorites"), .favorites),
            (store.l10n.categoryTitle(.login), .category(.login)),
            (store.l10n.categoryTitle(.passkey), .category(.passkey)),
            (store.l10n.categoryTitle(.creditCard), .category(.creditCard)),
            (store.l10n.categoryTitle(.sshKey), .category(.sshKey)),
            (trashLabel, .trash),
        ]
        return ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(presets, id: \.1) { title, preset in
                    let active = filterPreset == preset
                    Button {
                        filterPreset = preset
                    } label: {
                        Text(title)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(active ? .white : (preset == .trash ? KeysmithColors.danger : .primary))
                            .padding(.horizontal, 13)
                            .padding(.vertical, 7)
                            .background(
                                active ? (preset == .trash ? KeysmithColors.danger : KeysmithColors.accent) : Color(.secondarySystemGroupedBackground),
                                in: Capsule()
                            )
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 16)
        }
    }

    private var searchQuickChipsRow: some View {
        let chips: [(String, String, String)] = [
            (store.l10n.t(zhCN: "通行密钥", en: "Passkeys"), "person.badge.key.fill", "is:passkey"),
            ("2FA / TOTP", "lock.shield.fill", "is:totp"),
            (store.l10n.t(zhCN: "常用收藏", en: "Favorites"), "star.fill", "is:favorite"),
            (store.l10n.t(zhCN: "废纸篓", en: "Trash"), "trash", "is:trash"),
        ]
        return ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(chips, id: \.2) { title, icon, token in
                    Button {
                        searchQuery = token
                    } label: {
                        Label(title, systemImage: icon)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.primary)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 7)
                            .background(Color(.secondarySystemGroupedBackground), in: Capsule())
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
        if trimmed == "is:trash" { return item.deletedAt != nil }
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
