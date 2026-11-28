import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

public enum KeysmithColors {
    public static let accent = dynamicColor(light: 0x0572EC, dark: 0x3B93FF)
    public static let digit = dynamicColor(light: 0x0572EC, dark: 0x58A6FF)
    public static let symbol = dynamicColor(light: 0xD9480F, dark: 0xFF7A59)
    public static let success = dynamicColor(light: 0x0D9488, dark: 0x2DD4BF)
    public static let danger = dynamicColor(light: 0xE03131, dark: 0xFF6B6B)
    public static let warning = dynamicColor(light: 0xD97706, dark: 0xFBBF24)

    public static func fromHex(_ hex: String) -> Color {
        let cleaned = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        guard Scanner(string: cleaned).scanHexInt64(&int) else {
            return accent
        }
        let r, g, b: UInt64
        switch cleaned.count {
        case 6:
            (r, g, b) = ((int >> 16) & 0xFF, (int >> 8) & 0xFF, int & 0xFF)
        case 8:
            (r, g, b) = ((int >> 16) & 0xFF, (int >> 8) & 0xFF, int & 0xFF)
        default:
            return accent
        }
        return Color(
            .sRGB,
            red: Double(r) / 255.0,
            green: Double(g) / 255.0,
            blue: Double(b) / 255.0,
            opacity: 1.0
        )
    }

    private static func dynamicColor(light: UInt32, dark: UInt32) -> Color {
        #if canImport(UIKit)
        return Color(uiColor: UIColor { traits in
            let hex = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(
                red: CGFloat((hex >> 16) & 0xFF) / 255.0,
                green: CGFloat((hex >> 8) & 0xFF) / 255.0,
                blue: CGFloat(hex & 0xFF) / 255.0,
                alpha: 1.0
            )
        })
        #else
        return Color(
            red: Double((light >> 16) & 0xFF) / 255.0,
            green: Double((light >> 8) & 0xFF) / 255.0,
            blue: Double(light & 0xFF) / 255.0
        )
        #endif
    }
}

/// Brand mark rendered using the bundled `AppLogo` image asset with graceful fallback.
public struct KSAppLogoView: View {
    public var size: CGFloat

    public init(size: CGFloat = 68) {
        self.size = size
    }

    public var body: some View {
        let shape = RoundedRectangle(cornerRadius: size * 0.24, style: .continuous)
        Group {
            #if canImport(UIKit)
            if let img = UIImage(named: "AppLogo") {
                Image(uiImage: img)
                    .resizable()
                    .interpolation(.high)
                    .scaledToFill()
                    .frame(width: size, height: size)
                    .clipShape(shape)
                    .overlay(
                        shape.strokeBorder(Color.primary.opacity(0.10), lineWidth: 1)
                    )
            } else {
                fallbackBadge(shape: shape)
            }
            #else
            fallbackBadge(shape: shape)
            #endif
        }
        .shadow(color: KeysmithColors.accent.opacity(0.22), radius: 12, y: 5)
        .accessibilityHidden(true)
    }

    private func fallbackBadge(shape: RoundedRectangle) -> some View {
        ZStack {
            shape.fill(KeysmithColors.accent)
            Image(systemName: "key.fill")
                .font(.system(size: size * 0.44, weight: .bold))
                .foregroundStyle(.white)
        }
        .frame(width: size, height: size)
    }
}

public struct KSItemIconBadge: View {
    public let title: String
    public let icon: KSItemIcon?
    public let category: KSItemCategory
    public var size: CGFloat

    public init(title: String, icon: KSItemIcon?, category: KSItemCategory, size: CGFloat = 38) {
        self.title = title
        self.icon = icon
        self.category = category
        self.size = size
    }

    public var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: size * 0.28, style: .continuous)
                .fill(badgeColor)
            badgeContent
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }

    private var badgeColor: Color {
        switch icon {
        case .preset(_, let hex):
            return KeysmithColors.fromHex(hex)
        case .domain, .none:
            return KeysmithColors.fromHex(category.defaultColorHex)
        }
    }

    @ViewBuilder
    private var badgeContent: some View {
        switch icon {
        case .preset(let name, _):
            if name.count <= 2 && !name.isEmpty {
                Text(name)
                    .font(.system(size: size * 0.38, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)
            } else {
                Image(systemName: category.systemImage)
                    .font(.system(size: size * 0.44, weight: .semibold))
                    .foregroundStyle(.white)
            }
        case .domain, .none:
            let initials = String(title.trimmingCharacters(in: .whitespacesAndNewlines).prefix(2)).uppercased()
            if !initials.isEmpty && category == .login {
                Text(initials)
                    .font(.system(size: size * 0.36, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)
            } else {
                Image(systemName: category.systemImage)
                    .font(.system(size: size * 0.44, weight: .semibold))
                    .foregroundStyle(.white)
            }
        }
    }
}

public struct KSItemFaviconBadge: View {
    public let store: KeysmithStore
    public let title: String
    public let icon: KSItemIcon?
    public var primaryUrl: String?
    public let category: KSItemCategory
    public var size: CGFloat

    #if canImport(UIKit)
    @State private var loadedImage: UIImage?
    #endif

    public init(
        store: KeysmithStore,
        title: String,
        icon: KSItemIcon?,
        primaryUrl: String? = nil,
        category: KSItemCategory,
        size: CGFloat = 38
    ) {
        self.store = store
        self.title = title
        self.icon = icon
        self.primaryUrl = primaryUrl
        self.category = category
        self.size = size
    }

    private var resolvedHost: String? {
        store.faviconHost(icon: icon, primaryUrl: primaryUrl)
    }

    public var body: some View {
        Group {
            #if canImport(UIKit)
            let displayImage = store.session.faviconEnabled
                ? (loadedImage ?? resolvedHost.flatMap { KSFaviconCache.shared.cachedImage(for: $0) })
                : nil
            if let image = displayImage {
                ZStack {
                    RoundedRectangle(cornerRadius: size * 0.28, style: .continuous)
                        .fill(Color.white.opacity(0.96))
                    Image(uiImage: image)
                        .resizable()
                        .interpolation(.high)
                        .scaledToFit()
                        .padding(size * 0.16)
                }
                .frame(width: size, height: size)
                .clipShape(RoundedRectangle(cornerRadius: size * 0.28, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: size * 0.28, style: .continuous)
                        .strokeBorder(Color.primary.opacity(0.08), lineWidth: 1)
                )
            } else {
                KSItemIconBadge(title: title, icon: icon, category: category, size: size)
            }
            #else
            KSItemIconBadge(title: title, icon: icon, category: category, size: size)
            #endif
        }
        .accessibilityHidden(true)
        .task(id: "\(resolvedHost ?? "")-\(store.session.faviconEnabled)") {
            #if canImport(UIKit)
            guard store.session.faviconEnabled, let host = resolvedHost else {
                loadedImage = nil
                return
            }
            if let cached = KSFaviconCache.shared.cachedImage(for: host) {
                if loadedImage !== cached { loadedImage = cached }
                return
            }
            if let fetched = await KSFaviconCache.shared.loadImage(
                for: host,
                isDemoMode: store.isDemoMode,
                adapter: store.adapter
            ) {
                loadedImage = fetched
            }
            #endif
        }
    }
}
