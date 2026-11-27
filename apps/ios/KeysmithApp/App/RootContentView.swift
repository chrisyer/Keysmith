import SwiftUI

public struct RootContentView: View {
    public let store: KeysmithStore
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    public init(store: KeysmithStore) {
        self.store = store
    }

    public var body: some View {
        ZStack {
            Group {
                if !store.isInitialized && store.isLoading {
                    VStack(spacing: 14) {
                        ProgressView()
                        Text("Keysmith")
                            .font(.headline)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color(.systemGroupedBackground))
                } else {
                    switch store.session.status {
                    case .unauthenticated:
                        AuthView(store: store)
                    case .locked:
                        LockScreenView(store: store)
                    case .unlocked:
                        if horizontalSizeClass == .regular {
                            iPadWorkspaceView(store: store)
                        } else {
                            iPhoneMainTabView(store: store)
                        }
                    }
                }
            }

            if let toast = store.toastMessage {
                VStack {
                    Text(toast)
                        .font(.caption.weight(.semibold))
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)
                        .glassEffect(.regular, in: .capsule)
                        .padding(.top, 10)
                    Spacer()
                }
                .transition(.move(edge: .top).combined(with: .opacity))
                .allowsHitTesting(false)
            }

            PrivacyShieldOverlay(
                isAppSwitcherBlurVisible: store.isPrivacyShieldVisible,
                isScreenCapturedWarningVisible: store.isScreenCaptured && store.session.screenCaptureProtected && store.session.status == .unlocked,
                l10n: store.l10n
            )
        }
        .animation(.easeInOut(duration: 0.18), value: store.toastMessage)
        .animation(.easeInOut(duration: 0.16), value: store.isPrivacyShieldVisible)
    }
}
