import SwiftUI

public struct iPhoneMainTabView: View {
    @Bindable public var store: KeysmithStore

    @State private var selectedVaultId: String?
    @State private var itemsFilterPreset: KSItemsFilterPreset = .all
    @State private var homeNavPath: [String] = []
    @State private var itemsNavPath: [String] = []
    @State private var searchNavPath: [String] = []

    @State private var editingItem: KSItemDetail?
    @State private var isShowingNewItemSheet: Bool = false
    @State private var isShowingSettingsSheet: Bool = false
    @State private var isShowingScannerSheet: Bool = false

    public init(store: KeysmithStore) {
        self.store = store
    }

    public var body: some View {
        TabView(selection: $store.activePhoneTab) {
            Tab(store.l10n.tabHome, systemImage: "house.fill", value: KSPhoneTab.home) {
                NavigationStack(path: $homeNavPath) {
                    iPhoneHomeView(
                        store: store,
                        selectedVaultId: $selectedVaultId,
                        onSelectItem: { homeNavPath.append($0) },
                        onNewItem: { isShowingNewItemSheet = true },
                        onOpenSettings: { isShowingSettingsSheet = true },
                        onJumpToItems: { preset in
                            itemsFilterPreset = preset
                            store.activePhoneTab = .items
                        }
                    )
                    .navigationDestination(for: String.self) { itemId in
                        ItemDetailView(
                            store: store,
                            itemId: itemId,
                            onEdit: { editingItem = $0 },
                            onDeleted: { if !homeNavPath.isEmpty { homeNavPath.removeLast() } }
                        )
                    }
                }
            }

            Tab(store.l10n.tabItems, systemImage: "rectangle.stack.fill", value: KSPhoneTab.items) {
                NavigationStack(path: $itemsNavPath) {
                    iPhoneItemsView(
                        store: store,
                        filterPreset: $itemsFilterPreset,
                        selectedVaultId: selectedVaultId,
                        isSearchMode: false,
                        onSelectItem: { itemsNavPath.append($0) },
                        onNewItem: { isShowingNewItemSheet = true },
                        onOpenSettings: { isShowingSettingsSheet = true }
                    )
                    .navigationDestination(for: String.self) { itemId in
                        ItemDetailView(
                            store: store,
                            itemId: itemId,
                            onEdit: { editingItem = $0 },
                            onDeleted: { if !itemsNavPath.isEmpty { itemsNavPath.removeLast() } }
                        )
                    }
                }
            }

            Tab(store.l10n.tabTools, systemImage: "shield.lefthalf.filled", value: KSPhoneTab.tools) {
                ToolsTabView(store: store, onOpenSettings: {
                    isShowingSettingsSheet = true
                })
            }

            Tab(store.l10n.tabSearch, systemImage: "magnifyingglass", value: KSPhoneTab.search, role: .search) {
                NavigationStack(path: $searchNavPath) {
                    iPhoneItemsView(
                        store: store,
                        filterPreset: $itemsFilterPreset,
                        selectedVaultId: selectedVaultId,
                        isSearchMode: true,
                        onSelectItem: { searchNavPath.append($0) },
                        onNewItem: { isShowingNewItemSheet = true },
                        onOpenSettings: { isShowingSettingsSheet = true }
                    )
                    .navigationDestination(for: String.self) { itemId in
                        ItemDetailView(
                            store: store,
                            itemId: itemId,
                            onEdit: { editingItem = $0 },
                            onDeleted: { if !searchNavPath.isEmpty { searchNavPath.removeLast() } }
                        )
                    }
                }
            }
        }
        .modifier(ClipboardTabAccessoryModifier(store: store))
        .sheet(isPresented: $isShowingNewItemSheet) {
            NavigationStack {
                ItemEditorView(
                    store: store,
                    defaultVaultId: selectedVaultId,
                    onSaved: { saved in
                        isShowingNewItemSheet = false
                        store.showToast(store.l10n.t(zhCN: "已保存「\(saved.title)」", en: "Saved \(saved.title)"))
                    },
                    onCancel: { isShowingNewItemSheet = false }
                )
            }
        }
        .sheet(item: $editingItem) { detail in
            NavigationStack {
                ItemEditorView(
                    store: store,
                    existingItem: detail,
                    onSaved: { _ in editingItem = nil },
                    onCancel: { editingItem = nil }
                )
            }
        }
        .sheet(isPresented: $isShowingSettingsSheet) {
            SettingsView(store: store, isEmbeddedInSplitView: false) {
                isShowingSettingsSheet = false
            }
        }
        .sheet(isPresented: $isShowingScannerSheet) {
            TotpScannerSheet(
                l10n: store.l10n,
                parseQrData: { data in
                    try await store.parseTotpQrImage(data: data)
                },
                onScanned: { scannedUri in
                    store.copyToClipboard(scannedUri, label: "TOTP URI", isSensitive: true)
                }
            )
        }
        .onChange(of: store.isShowingSettingsModal) { _, newValue in
            if newValue {
                isShowingSettingsSheet = true
                store.isShowingSettingsModal = false
            }
        }
        .onChange(of: store.isShowingTotpScannerFromDeepLink) { _, newValue in
            if newValue {
                isShowingScannerSheet = true
                store.isShowingTotpScannerFromDeepLink = false
            }
        }
        .onChange(of: store.pendingRoute) { _, route in
            guard let route else { return }
            switch route {
            case .settings:
                isShowingSettingsSheet = true
            case .search:
                store.activePhoneTab = .search
            case .scanTotp:
                isShowingScannerSheet = true
            case .item(let id):
                store.activePhoneTab = .items
                itemsNavPath.append(id)
            case .lock:
                break
            }
            store.pendingRoute = nil
        }
        .onAppear {
            if store.isShowingSettingsModal {
                isShowingSettingsSheet = true
                store.isShowingSettingsModal = false
            }
            if store.isShowingTotpScannerFromDeepLink {
                isShowingScannerSheet = true
                store.isShowingTotpScannerFromDeepLink = false
            }
        }
    }
}

private struct ClipboardTabAccessoryModifier: ViewModifier {
    let store: KeysmithStore

    func body(content: Content) -> some View {
        if #available(iOS 26.1, *) {
            content.tabViewBottomAccessory(isEnabled: store.clipboardActive) {
                ClipboardAccessoryBar(store: store)
            }
        } else {
            content.tabViewBottomAccessory {
                if store.clipboardActive {
                    ClipboardAccessoryBar(store: store)
                }
            }
        }
    }
}
