import SwiftUI

@main
public struct KeysmithApp: App {
    @State private var store = KeysmithStore.shared
    @Environment(\.scenePhase) private var scenePhase

    public init() {}

    public var body: some Scene {
        WindowGroup {
            RootContentView(store: store)
                .preferredColorScheme(store.colorSchemeOverride)
                .onOpenURL { url in
                    store.handleDeepLink(url)
                }
                .task {
                    await store.bootstrap()
                }
                .onChange(of: scenePhase) { _, newPhase in
                    store.handleScenePhaseChange(newPhase)
                }
        }
        .commands {
            CommandMenu("Keysmith") {
                Button(store.l10n.tabSearch) {
                    store.activePhoneTab = .search
                    store.pendingRoute = .search
                }
                .keyboardShortcut("k", modifiers: .command)

                Button(store.l10n.syncNow) {
                    Task { await store.syncNow() }
                }
                .keyboardShortcut("r", modifiers: .command)

                Button(store.l10n.lockNow) {
                    store.lock(reason: "keyboard_shortcut")
                }
                .keyboardShortcut("l", modifiers: .command)

                Button(store.l10n.settings) {
                    store.isShowingSettingsModal = true
                }
                .keyboardShortcut(",", modifiers: .command)

                Button(store.l10n.clearClipboard) {
                    store.clearClipboardNow()
                }
                .keyboardShortcut(".", modifiers: .command)
            }
        }
    }
}
