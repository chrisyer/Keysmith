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
        case settings
        case tools
    }

    @State private var columnVisibility: NavigationSplitViewVisibility = .all
    @State private var sidebarSelection: SidebarFilter? = .all
    @State private var selectedItemId: String?
    @State private var rightPaneMode: RightPaneMode = .item
    @State private var searchText: String = ""
    @State private var isShowingScannerSheet: Bool = false

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
        }
        .onChange(of: store.isShowingSettingsModal) { _, newValue in
            if newValue {
                rightPaneMode = .settings
                store.isShowingSettingsModal = false
            }
        }
        .onChange(of: store.pendingRoute) { _, route in
            guard let route else { return }
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
        .onChange(of: store.isShowingTotpScannerFromDeepLink) { _, newValue in
            if newValue {
                isShowingScannerSheet = true
                store.isShowingTotpScannerFromDeepLink = false
            }
        }
        .sheet(isPresented: $isShowingScannerSheet) {
            TotpScannerSheet { scannedUri in
                store.copyToClipboard(scannedUri, label: "TOTP URI", isSensitive: true)
            }
        }
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
                Label(store.l10n.t(zhCN: "工具与安全中心", en: "Tools & Watchtower"), systemImage: "wrench.and.screwdriver")
                    .tag(SidebarFilter.tools)
                    .onTapGesture {
                        sidebarSelection = .tools
                        rightPaneMode = .tools
                    }
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

    private var contentColumn: some View {
        List(selection: $selectedItemId) {
            ForEach(filteredItems) { item in
                HStack(spacing: 10) {
                    KSItemIconBadge(title: item.title, icon: item.icon, category: item.category, size: 36)

                    VStack(alignment: .leading, spacing: 2) {
                        Text(item.title)
                            .font(.subheadline.weight(.semibold))
                            .lineLimit(1)
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
                .tag(item.id)
                .swipeActions(edge: .trailing) {
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
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(activeColumnTitle)
        .searchable(
            text: $searchText,
            placement: .navigationBarDrawer(displayMode: .always),
            prompt: Text(store.l10n.t(zhCN: "搜索条目、is:passkey...", en: "Search items, is:passkey..."))
        )
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button {
                    Task { await store.syncNow() }
                } label: {
                    Image(systemName: "arrow.triangle.2.circlepath")
                }
                .disabled(store.isSyncing)

                Button {
                    rightPaneMode = .editor(nil)
                } label: {
                    Label(store.l10n.newItem, systemImage: "plus")
                }
                .buttonStyle(.borderedProminent)
                .tint(KeysmithColors.accent)
            }
        }
        .onChange(of: selectedItemId) { _, newValue in
            if newValue != nil && rightPaneMode != .item {
                rightPaneMode = .item
            }
        }
        .onChange(of: sidebarSelection) { _, newSelection in
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
            ToolsTabView(store: store, onOpenSettings: {
                rightPaneMode = .settings
            })

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
