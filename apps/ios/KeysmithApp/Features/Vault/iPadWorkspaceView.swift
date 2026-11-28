import SwiftUI

public struct iPadWorkspaceView: View {
    @Bindable public var store: KeysmithStore

    private enum SidebarFilter: Hashable {
        case all
        case favorites
        case passkeys
        case tools
        case vault(String)
        case category(KSItemCategory)
        case trash
    }

    private enum RightPaneMode: Equatable {
        case item
        case editor(KSItemDetail?)
        case newDraft(KSItemDraft)
        case settings
        case tools
    }

    @State private var columnVisibility: NavigationSplitViewVisibility = .all
    @State private var sidebarSelection: SidebarFilter? = .all
    @State private var selectedItemId: String?
    @State private var rightPaneMode: RightPaneMode = .item
    @State private var searchText: String = ""
    @State private var isShowingScannerSheet: Bool = false
    @State private var isConfirmingEmptyTrash: Bool = false
    @State private var cachedSections: [KSAlphabetSection] = []
    @State private var cachedItemCount: Int = 0

    public init(store: KeysmithStore) {
        self.store = store
    }

    private var filteredItems: [KSItemSummary] {
        let base: [KSItemSummary]
        switch sidebarSelection {
        case .trash:
            base = store.items.filter { $0.deletedAt != nil }
        default:
            base = store.visibleItems
        }

        return base.filter { item in
            switch sidebarSelection {
            case .all, .none, .tools, .trash:
                break
            case .favorites:
                if !item.favorite { return false }
            case .passkeys:
                if !item.hasPasskey && item.category != .passkey { return false }
            case .vault(let vaultId):
                if item.vaultId != vaultId { return false }
            case .category(let cat):
                if item.category != cat { return false }
            }

            let trimmed = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            guard !trimmed.isEmpty else { return true }
            if trimmed == "is:passkey" { return item.hasPasskey }
            if trimmed == "is:totp" { return item.hasTotp }
            return item.title.localizedCaseInsensitiveContains(trimmed)
                || item.subtitle.localizedCaseInsensitiveContains(trimmed)
                || (item.username ?? "").localizedCaseInsensitiveContains(trimmed)
                || item.tags.contains { $0.localizedCaseInsensitiveContains(trimmed) }
        }
    }

    private var activeColumnTitle: String {
        switch sidebarSelection {
        case .all, .none: return store.l10n.allItems
        case .favorites: return store.l10n.t(zhCN: "我的收藏", en: "Favorites")
        case .passkeys: return store.l10n.t(zhCN: "通行密钥 Passkeys", en: "Passkeys")
        case .tools: return store.l10n.tabTools
        case .vault(let id): return store.vaults.first(where: { $0.id == id })?.name ?? store.l10n.allVaults
        case .category(let cat): return store.l10n.categoryTitle(cat)
        case .trash: return store.l10n.t(zhCN: "废纸篓", en: "Trash")
        }
    }

    public var body: some View {
        NavigationSplitView(columnVisibility: $columnVisibility) {
            sidebarColumn
        } content: {
            contentColumn
        } detail: {
            detailColumn
        }
        .navigationSplitViewStyle(.balanced)
        .overlay(alignment: .bottomTrailing) {
            if store.clipboardActive {
                ClipboardAccessoryBar(store: store)
                    .frame(maxWidth: 340)
                    .padding(16)
            }
        }
        .onAppear {
            if selectedItemId == nil {
                selectedItemId = store.visibleItems.first?.id
            }
            if store.isShowingSettingsModal {
                rightPaneMode = .settings
                store.isShowingSettingsModal = false
            }
            if store.isShowingTotpScannerFromDeepLink {
                isShowingScannerSheet = true
                store.isShowingTotpScannerFromDeepLink = false
            }
            consumePendingRoute()
        }
        .onChange(of: store.isShowingSettingsModal) { _, newValue in
            if newValue {
                rightPaneMode = .settings
                store.isShowingSettingsModal = false
            }
        }
        .onChange(of: store.pendingRoute) { _, _ in
            consumePendingRoute()
        }
        .onChange(of: store.isShowingTotpScannerFromDeepLink) { _, newValue in
            if newValue {
                isShowingScannerSheet = true
                store.isShowingTotpScannerFromDeepLink = false
            }
        }
        .sheet(isPresented: $isShowingScannerSheet) {
            TotpScannerSheet(
                l10n: store.l10n,
                parseQrData: { data in
                    try await store.parseTotpQrImage(data: data)
                },
                onScanned: { scannedUri in
                    let vaultId: String = {
                        if case .vault(let id) = sidebarSelection { return id }
                        return store.vaults.first(where: { $0.isDefault })?.id
                            ?? store.vaults.first?.id
                            ?? "personal"
                    }()
                    let draft = KSItemDraft.fromScannedTotpUri(scannedUri, vaultId: vaultId, l10n: store.l10n)
                    isShowingScannerSheet = false
                    rightPaneMode = .newDraft(draft)
                }
            )
        }
    }

    private func consumePendingRoute() {
        guard let route = store.pendingRoute else { return }
        switch route {
        case .settings:
            rightPaneMode = .settings
        case .item(let id):
            selectedItemId = id
            rightPaneMode = .item
        case .search:
            sidebarSelection = .all
        case .scanTotp:
            isShowingScannerSheet = true
        case .lock:
            break
        }
        store.pendingRoute = nil
    }

    // MARK: - Left Sidebar (Liquid Glass)

    private var sidebarColumn: some View {
        List(selection: $sidebarSelection) {
            Section {
                HStack(spacing: 10) {
                    Circle()
                        .fill(KeysmithColors.accent)
                        .frame(width: 34, height: 34)
                        .overlay(
                            Text(String(store.session.displayName.prefix(2)).uppercased())
                                .font(.caption.weight(.bold))
                                .foregroundStyle(.white)
                        )
                    VStack(alignment: .leading, spacing: 2) {
                        Text(store.session.displayName.isEmpty ? "Keysmith" : store.session.displayName)
                            .font(.subheadline.weight(.semibold))
                            .lineLimit(1)
                        Text(store.session.email)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    Spacer()
                    Circle()
                        .fill(store.syncStatus.signalrConnected || store.isDemoMode ? KeysmithColors.success : Color.secondary)
                        .frame(width: 8, height: 8)
                }
                .padding(.vertical, 4)
            }

            Section(store.l10n.t(zhCN: "视图筛选", en: "Views")) {
                sidebarRow(
                    title: store.l10n.allItems,
                    icon: "square.grid.2x2",
                    count: store.visibleItems.count,
                    tag: .all
                )
                sidebarRow(
                    title: store.l10n.t(zhCN: "我的收藏", en: "Favorites"),
                    icon: "star.fill",
                    count: store.visibleItems.filter(\.favorite).count,
                    tag: .favorites
                )
                sidebarRow(
                    title: store.l10n.t(zhCN: "通行密钥 Passkeys", en: "Passkeys"),
                    icon: "person.badge.key.fill",
                    count: store.visibleItems.filter { $0.hasPasskey || $0.category == .passkey }.count,
                    tag: .passkeys
                )
                sidebarRow(
                    title: store.l10n.tabTools,
                    icon: "shield.lefthalf.filled",
                    count: store.watchtowerReport?.totalRiskItems ?? 0,
                    tag: .tools
                )
                sidebarRow(
                    title: store.l10n.t(zhCN: "废纸篓", en: "Trash"),
                    icon: "trash",
                    count: store.trashedItems.count,
                    tag: .trash
                )
            }

            Section(store.l10n.t(zhCN: "保险库", en: "Vaults")) {
                ForEach(store.vaults) { vault in
                    let count = store.visibleItems.filter { $0.vaultId == vault.id }.count
                    sidebarRow(
                        title: vault.name,
                        icon: "folder.fill",
                        count: count,
                        tag: .vault(vault.id)
                    )
                }
            }

            Section(store.l10n.t(zhCN: "类别", en: "Categories")) {
                ForEach([KSItemCategory.login, .creditCard, .sshKey, .secureNote, .apiCredential]) { cat in
                    let count = store.visibleItems.filter { $0.category == cat }.count
                    if count > 0 || cat == .login {
                        sidebarRow(
                            title: store.l10n.categoryTitle(cat),
                            icon: cat.systemImage,
                            count: count,
                            tag: .category(cat)
                        )
                    }
                }
            }
        }
        .listStyle(.sidebar)
        .navigationTitle("Keysmith")
        .safeAreaInset(edge: .bottom) {
            HStack(spacing: 10) {
                Button {
                    rightPaneMode = .settings
                } label: {
                    Label(store.l10n.settings, systemImage: "gearshape")
                        .font(.caption.weight(.semibold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                }
                .buttonStyle(.bordered)

                Button {
                    store.lock(reason: "ipad_sidebar")
                } label: {
                    Label(store.l10n.lockNow, systemImage: "lock.fill")
                        .font(.caption.weight(.semibold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                }
                .buttonStyle(.bordered)
            }
            .padding(12)
        }
    }

    private func sidebarRow(title: String, icon: String, count: Int, tag: SidebarFilter) -> some View {
        HStack {
            Label(title, systemImage: icon)
            Spacer()
            Text("\(count)")
                .font(.caption.monospacedDigit())
                .foregroundStyle(.secondary)
        }
        .tag(tag)
    }

    // MARK: - Middle Item List Column

    private var showIndexBar: Bool {
        cachedSections.count > 1 && cachedItemCount >= 12
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

    private var contentColumn: some View {
        ScrollViewReader { proxy in
            ZStack(alignment: .trailing) {
                List {
                    ForEach(cachedSections) { section in
                        Section {
                            ForEach(section.items) { item in
                                let isSelected = selectedItemId == item.id && rightPaneMode == .item
                                Button {
                                    selectedItemId = item.id
                                    rightPaneMode = .item
                                } label: {
                                    HStack(spacing: 10) {
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
                                                .foregroundStyle(isSelected ? .white : .primary)
                                                .lineLimit(1)
                                            Text(item.subtitle.isEmpty ? store.l10n.categoryTitle(item.category) : item.subtitle)
                                                .font(.caption)
                                                .foregroundStyle(isSelected ? Color.white.opacity(0.85) : .secondary)
                                                .lineLimit(1)
                                        }

                                        Spacer()

                                        if item.hasPasskey {
                                            Text("PK")
                                                .font(.caption2.weight(.bold))
                                                .foregroundStyle(isSelected ? Color.white : KeysmithColors.success)
                                                .padding(.horizontal, 6)
                                                .padding(.vertical, 2)
                                                .background(
                                                    isSelected ? Color.white.opacity(0.22) : KeysmithColors.success.opacity(0.14),
                                                    in: RoundedRectangle(cornerRadius: 6, style: .continuous)
                                                )
                                        }
                                    }
                                    .padding(.horizontal, 10)
                                    .padding(.vertical, 8)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .background(
                                        isSelected ? KeysmithColors.accent : Color.clear,
                                        in: RoundedRectangle(cornerRadius: 12, style: .continuous)
                                    )
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                                .listRowBackground(Color.clear)
                                .listRowSeparator(.hidden)
                                .listRowInsets(EdgeInsets(top: 3, leading: 10, bottom: 3, trailing: showIndexBar ? 26 : 10))
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
                                    } else if item.hasPassword && !item.reprompt {
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
                                }
                            }
                        } header: {
                            Text(section.letter)
                                .font(.caption.weight(.bold))
                                .foregroundStyle(.secondary)
                                .id("ipad-alpha-\(section.letter)")
                        }
                    }
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
                .background(Color(.systemGroupedBackground))
                .refreshable {
                    await store.syncNow()
                }

                if showIndexBar {
                    KSAlphabetIndexBar(letters: cachedSections.map(\.letter)) { letter in
                        withAnimation(.snappy(duration: 0.2)) {
                            proxy.scrollTo("ipad-alpha-\(letter)", anchor: .top)
                        }
                    }
                    .padding(.trailing, 4)
                }
            }
        }
        .onAppear {
            rebuildSections()
        }
        .onChange(of: itemSignature) { _, _ in
            rebuildSections()
        }
        .onChange(of: searchText) { _, _ in
            rebuildSections()
        }
        .navigationTitle(activeColumnTitle)
        .searchable(
            text: $searchText,
            placement: .navigationBarDrawer(displayMode: .always),
            prompt: Text(store.l10n.t(zhCN: "搜索条目、is:passkey...", en: "Search items, is:passkey..."))
        )
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                if sidebarSelection == .trash && !store.trashedItems.isEmpty {
                    Button(role: .destructive) {
                        isConfirmingEmptyTrash = true
                    } label: {
                        Label(store.l10n.t(zhCN: "清空", en: "Empty"), systemImage: "trash.slash")
                    }
                } else {
                    Button {
                        Task { await store.syncNow() }
                    } label: {
                        Image(systemName: "arrow.triangle.2.circlepath")
                    }
                    .disabled(store.isSyncing)
                }

                Button {
                    isShowingScannerSheet = true
                } label: {
                    Image(systemName: "qrcode.viewfinder")
                }
                .accessibilityLabel(store.l10n.t(zhCN: "扫描 2FA 二维码", en: "Scan 2FA QR"))

                Button {
                    rightPaneMode = .editor(nil)
                } label: {
                    Label(store.l10n.newItem, systemImage: "plus")
                }
                .buttonStyle(.borderedProminent)
                .tint(KeysmithColors.accent)
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
        .onChange(of: selectedItemId) { _, newValue in
            if newValue != nil && rightPaneMode != .item {
                rightPaneMode = .item
            }
        }
        .onChange(of: sidebarSelection) { _, newSelection in
            rebuildSections()
            if newSelection == .tools {
                rightPaneMode = .tools
            } else if rightPaneMode == .tools {
                rightPaneMode = .item
            }
        }
    }

    // MARK: - Right Detail / Editor / Settings / Tools Column

    @ViewBuilder
    private var detailColumn: some View {
        switch rightPaneMode {
        case .settings:
            SettingsView(store: store, isEmbeddedInSplitView: true) {
                rightPaneMode = .item
            }

        case .tools:
            ToolsTabView(
                store: store,
                isEmbeddedInNavigationStack: false,
                onOpenSettings: {
                    rightPaneMode = .settings
                },
                onSelectItem: { id in
                    selectedItemId = id
                    rightPaneMode = .item
                },
                onScanTotp: {
                    isShowingScannerSheet = true
                }
            )

        case .editor(let existing):
            NavigationStack {
                ItemEditorView(
                    store: store,
                    existingItem: existing,
                    defaultVaultId: {
                        if case .vault(let id) = sidebarSelection { return id }
                        return nil
                    }(),
                    onSaved: { saved in
                        selectedItemId = saved.id
                        rightPaneMode = .item
                    },
                    onCancel: {
                        rightPaneMode = .item
                    }
                )
            }

        case .newDraft(let draft):
            NavigationStack {
                ItemEditorView(
                    store: store,
                    initialDraft: draft,
                    onSaved: { saved in
                        selectedItemId = saved.id
                        rightPaneMode = .item
                    },
                    onCancel: {
                        rightPaneMode = .item
                    }
                )
            }

        case .item:
            if let selectedItemId {
                NavigationStack {
                    ItemDetailView(
                        store: store,
                        itemId: selectedItemId,
                        onEdit: { detail in
                            rightPaneMode = .editor(detail)
                        },
                        onDeleted: {
                            self.selectedItemId = filteredItems.first(where: { $0.id != selectedItemId })?.id
                        }
                    )
                }
            } else {
                ContentUnavailableView(
                    store.l10n.t(zhCN: "选择或新建一个条目", en: "Select or Create an Item"),
                    systemImage: "key.fill"
                )
            }
        }
    }
}
