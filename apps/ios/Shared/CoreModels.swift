import Foundation

public enum KSAuthStatus: String, Sendable, Codable, Equatable {
    case unauthenticated = "Unauthenticated"
    case locked = "Locked"
    case unlocked = "Unlocked"
}

public enum KSLockTimeoutAction: String, Sendable, Codable, CaseIterable, Identifiable {
    case lock
    case logout

    public var id: String { rawValue }
}

public enum KSAutoLockOption: Int, Sendable, CaseIterable, Identifiable {
    case immediate = 0
    case seconds15 = 15
    case seconds30 = 30
    case minute1 = 60
    case minutes5 = 300
    case minutes15 = 900
    case minutes30 = 1800
    case never = -1

    public var id: Int { rawValue }
    public var secondsValue: Int { rawValue }

    public var minutesValue: Int {
        switch self {
        case .immediate, .seconds15, .seconds30, .minute1:
            return rawValue <= 0 ? (self == .never ? 0 : 0) : 1
        case .minutes5:
            return 5
        case .minutes15:
            return 15
        case .minutes30:
            return 30
        case .never:
            return 0
        }
    }

    public static func from(autoLockSeconds: Int?, autoLockMinutes: Int) -> KSAutoLockOption {
        if let secs = autoLockSeconds {
            if let exact = KSAutoLockOption(rawValue: secs) {
                return exact
            }
            if secs < 0 { return .never }
            if secs == 0 { return .immediate }
            if secs <= 15 { return .seconds15 }
            if secs <= 30 { return .seconds30 }
            if secs <= 60 { return .minute1 }
            if secs <= 300 { return .minutes5 }
            if secs <= 900 { return .minutes15 }
            return .minutes30
        }
        switch autoLockMinutes {
        case 0: return .never
        case 1: return .minute1
        case 2...5: return .minutes5
        case 6...15: return .minutes15
        default: return .minutes30
        }
    }
}

public enum KSClipboardOption: Int, Sendable, CaseIterable, Identifiable {
    case seconds10 = 10
    case seconds15 = 15
    case seconds30 = 30
    case seconds60 = 60
    case minutes2 = 120
    case never = 0

    public var id: Int { rawValue }
    public var seconds: Int { rawValue }

    public static func from(seconds: Int) -> KSClipboardOption {
        KSClipboardOption(rawValue: seconds) ?? .seconds30
    }
}

public enum KSBiometricMaxDaysOption: Int, Sendable, CaseIterable, Identifiable {
    case everyUnlock = 0
    case day1 = 1
    case days7 = 7
    case days14 = 14
    case days30 = 30

    public var id: Int { rawValue }

    public static func from(days: Int) -> KSBiometricMaxDaysOption {
        KSBiometricMaxDaysOption(rawValue: days) ?? .days7
    }
}

public enum KSTrashAutoPurgeOption: Int, Sendable, CaseIterable, Identifiable {
    case days7 = 7
    case days30 = 30
    case days90 = 90
    case never = 0

    public var id: Int { rawValue }

    public static func from(days: Int) -> KSTrashAutoPurgeOption {
        KSTrashAutoPurgeOption(rawValue: days) ?? .days30
    }
}

public enum KSSnapshotScheduleOption: Int, Sendable, CaseIterable, Identifiable {
    case daily = 1
    case weekly = 7
    case off = 0

    public var id: Int { rawValue }

    public static func from(intervalDays: Int) -> KSSnapshotScheduleOption {
        if intervalDays <= 0 { return .off }
        if intervalDays >= 7 { return .weekly }
        return .daily
    }
}

public struct KSSessionState: Sendable, Codable, Equatable {
    public var accountId: String
    public var status: KSAuthStatus
    public var email: String
    public var displayName: String
    public var serverUrl: String
    public var biometricEnabled: Bool
    public var autoLockMinutes: Int
    public var autoLockSeconds: Int?
    public var clipboardClearSeconds: Int
    public var lastSyncAt: String
    public var kdfType: String
    public var closeToTray: Bool
    public var lockOnSleep: Bool
    public var screenCaptureProtected: Bool
    public var vibrancyEnabled: Bool
    public var faviconEnabled: Bool
    public var quickAccessShortcut: String
    public var biometricMaxDays: Int
    public var launchAtLogin: Bool
    public var travelMode: Bool
    public var trashAutoPurgeDays: Int
    public var sshBiometricConfirm: Bool

    public init(
        accountId: String = "",
        status: KSAuthStatus = .unauthenticated,
        email: String = "",
        displayName: String = "",
        serverUrl: String = "https://vault.bitwarden.com",
        biometricEnabled: Bool = false,
        autoLockMinutes: Int = 1,
        autoLockSeconds: Int? = 60,
        clipboardClearSeconds: Int = 30,
        lastSyncAt: String = "",
        kdfType: String = "Argon2id",
        closeToTray: Bool = false,
        lockOnSleep: Bool = true,
        screenCaptureProtected: Bool = true,
        vibrancyEnabled: Bool = true,
        faviconEnabled: Bool = true,
        quickAccessShortcut: String = "",
        biometricMaxDays: Int = 7,
        launchAtLogin: Bool = false,
        travelMode: Bool = false,
        trashAutoPurgeDays: Int = 30,
        sshBiometricConfirm: Bool = false
    ) {
        self.accountId = accountId
        self.status = status
        self.email = email
        self.displayName = displayName
        self.serverUrl = serverUrl
        self.biometricEnabled = biometricEnabled
        self.autoLockMinutes = autoLockMinutes
        self.autoLockSeconds = autoLockSeconds
        self.clipboardClearSeconds = clipboardClearSeconds
        self.lastSyncAt = lastSyncAt
        self.kdfType = kdfType
        self.closeToTray = closeToTray
        self.lockOnSleep = lockOnSleep
        self.screenCaptureProtected = screenCaptureProtected
        self.vibrancyEnabled = vibrancyEnabled
        self.faviconEnabled = faviconEnabled
        self.quickAccessShortcut = quickAccessShortcut
        self.biometricMaxDays = biometricMaxDays
        self.launchAtLogin = launchAtLogin
        self.travelMode = travelMode
        self.trashAutoPurgeDays = trashAutoPurgeDays
        self.sshBiometricConfirm = sshBiometricConfirm
    }

    enum CodingKeys: String, CodingKey {
        case accountId, status, email, displayName, serverUrl, biometricEnabled
        case autoLockMinutes, autoLockSeconds, clipboardClearSeconds, lastSyncAt, kdfType
        case closeToTray, lockOnSleep, screenCaptureProtected, vibrancyEnabled, faviconEnabled
        case quickAccessShortcut, biometricMaxDays, launchAtLogin, travelMode
        case trashAutoPurgeDays, sshBiometricConfirm
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        accountId = try c.decodeIfPresent(String.self, forKey: .accountId) ?? ""
        status = try c.decodeIfPresent(KSAuthStatus.self, forKey: .status) ?? .unauthenticated
        email = try c.decodeIfPresent(String.self, forKey: .email) ?? ""
        displayName = try c.decodeIfPresent(String.self, forKey: .displayName) ?? ""
        serverUrl = try c.decodeIfPresent(String.self, forKey: .serverUrl) ?? ""
        biometricEnabled = try c.decodeIfPresent(Bool.self, forKey: .biometricEnabled) ?? false
        autoLockMinutes = try c.decodeIfPresent(Int.self, forKey: .autoLockMinutes) ?? 1
        autoLockSeconds = try c.decodeIfPresent(Int.self, forKey: .autoLockSeconds)
        clipboardClearSeconds = try c.decodeIfPresent(Int.self, forKey: .clipboardClearSeconds) ?? 30
        lastSyncAt = try c.decodeIfPresent(String.self, forKey: .lastSyncAt) ?? ""
        kdfType = try c.decodeIfPresent(String.self, forKey: .kdfType) ?? "Argon2id"
        closeToTray = try c.decodeIfPresent(Bool.self, forKey: .closeToTray) ?? false
        lockOnSleep = try c.decodeIfPresent(Bool.self, forKey: .lockOnSleep) ?? true
        screenCaptureProtected = try c.decodeIfPresent(Bool.self, forKey: .screenCaptureProtected) ?? true
        vibrancyEnabled = try c.decodeIfPresent(Bool.self, forKey: .vibrancyEnabled) ?? true
        faviconEnabled = try c.decodeIfPresent(Bool.self, forKey: .faviconEnabled) ?? true
        quickAccessShortcut = try c.decodeIfPresent(String.self, forKey: .quickAccessShortcut) ?? ""
        biometricMaxDays = try c.decodeIfPresent(Int.self, forKey: .biometricMaxDays) ?? 7
        launchAtLogin = try c.decodeIfPresent(Bool.self, forKey: .launchAtLogin) ?? false
        travelMode = try c.decodeIfPresent(Bool.self, forKey: .travelMode) ?? false
        trashAutoPurgeDays = try c.decodeIfPresent(Int.self, forKey: .trashAutoPurgeDays) ?? 30
        sshBiometricConfirm = try c.decodeIfPresent(Bool.self, forKey: .sshBiometricConfirm) ?? false
    }
}

public struct KSSessionPreferencesPatch: Sendable, Codable, Equatable {
    public var biometricEnabled: Bool?
    public var autoLockMinutes: Int?
    public var autoLockSeconds: Int?
    public var clipboardClearSeconds: Int?
    public var closeToTray: Bool?
    public var lockOnSleep: Bool?
    public var screenCaptureProtected: Bool?
    public var vibrancyEnabled: Bool?
    public var faviconEnabled: Bool?
    public var quickAccessShortcut: String?
    public var biometricMaxDays: Int?
    public var launchAtLogin: Bool?
    public var travelMode: Bool?
    public var trashAutoPurgeDays: Int?
    public var sshBiometricConfirm: Bool?

    public init(
        biometricEnabled: Bool? = nil,
        autoLockMinutes: Int? = nil,
        autoLockSeconds: Int? = nil,
        clipboardClearSeconds: Int? = nil,
        closeToTray: Bool? = nil,
        lockOnSleep: Bool? = nil,
        screenCaptureProtected: Bool? = nil,
        vibrancyEnabled: Bool? = nil,
        faviconEnabled: Bool? = nil,
        quickAccessShortcut: String? = nil,
        biometricMaxDays: Int? = nil,
        launchAtLogin: Bool? = nil,
        travelMode: Bool? = nil,
        trashAutoPurgeDays: Int? = nil,
        sshBiometricConfirm: Bool? = nil
    ) {
        self.biometricEnabled = biometricEnabled
        self.autoLockMinutes = autoLockMinutes
        self.autoLockSeconds = autoLockSeconds
        self.clipboardClearSeconds = clipboardClearSeconds
        self.closeToTray = closeToTray
        self.lockOnSleep = lockOnSleep
        self.screenCaptureProtected = screenCaptureProtected
        self.vibrancyEnabled = vibrancyEnabled
        self.faviconEnabled = faviconEnabled
        self.quickAccessShortcut = quickAccessShortcut
        self.biometricMaxDays = biometricMaxDays
        self.launchAtLogin = launchAtLogin
        self.travelMode = travelMode
        self.trashAutoPurgeDays = trashAutoPurgeDays
        self.sshBiometricConfirm = sshBiometricConfirm
    }
}

public struct KSAccountSummary: Sendable, Codable, Identifiable, Equatable {
    public var id: String
    public var email: String
    public var displayName: String
    public var serverUrl: String
    public var isActive: Bool
    public var kdfType: String
    public var lastSyncAt: String

    public init(
        id: String,
        email: String,
        displayName: String,
        serverUrl: String,
        isActive: Bool,
        kdfType: String,
        lastSyncAt: String
    ) {
        self.id = id
        self.email = email
        self.displayName = displayName
        self.serverUrl = serverUrl
        self.isActive = isActive
        self.kdfType = kdfType
        self.lastSyncAt = lastSyncAt
    }
}

public struct KSVault: Sendable, Codable, Identifiable, Equatable, Hashable {
    public var id: String
    public var name: String
    public var icon: String
    public var color: String
    public var isDefault: Bool
    public var isOrganization: Bool
    public var travelSafe: Bool
    public var itemCount: Int

    public init(
        id: String,
        name: String,
        icon: String = "folder",
        color: String = "#0572EC",
        isDefault: Bool = false,
        isOrganization: Bool = false,
        travelSafe: Bool = false,
        itemCount: Int = 0
    ) {
        self.id = id
        self.name = name
        self.icon = icon
        self.color = color
        self.isDefault = isDefault
        self.isOrganization = isOrganization
        self.travelSafe = travelSafe
        self.itemCount = itemCount
    }

    enum CodingKeys: String, CodingKey {
        case id, name, icon, color, isDefault, isOrganization, travelSafe, itemCount
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        icon = try c.decodeIfPresent(String.self, forKey: .icon) ?? "folder"
        color = try c.decodeIfPresent(String.self, forKey: .color) ?? "#0572EC"
        isDefault = try c.decodeIfPresent(Bool.self, forKey: .isDefault) ?? false
        isOrganization = try c.decodeIfPresent(Bool.self, forKey: .isOrganization) ?? false
        travelSafe = try c.decodeIfPresent(Bool.self, forKey: .travelSafe) ?? false
        itemCount = try c.decodeIfPresent(Int.self, forKey: .itemCount) ?? 0
    }
}

public enum KSItemCategory: String, Sendable, Codable, CaseIterable, Identifiable {
    case login
    case password
    case secureNote = "secure_note"
    case creditCard = "credit_card"
    case identity
    case apiCredential = "api_credential"
    case database
    case server
    case sshKey = "ssh_key"
    case softwareLicense = "software_license"
    case passkey
    case bankAccount = "bank_account"
    case cryptoWallet = "crypto_wallet"
    case wifiRouter = "wifi_router"
    case passport
    case driverLicense = "driver_license"
    case membership
    case medicalRecord = "medical_record"
    case document

    public var id: String { rawValue }

    public var systemImage: String {
        switch self {
        case .login: return "globe"
        case .password: return "key.fill"
        case .secureNote: return "doc.text.fill"
        case .creditCard: return "creditcard.fill"
        case .identity: return "person.text.rectangle.fill"
        case .apiCredential: return "chevron.left.forwardslash.chevron.right"
        case .database: return "cylinder.split.1x2.fill"
        case .server: return "server.rack"
        case .sshKey: return "terminal.fill"
        case .softwareLicense: return "checkmark.seal.fill"
        case .passkey: return "person.badge.key.fill"
        case .bankAccount: return "building.columns.fill"
        case .cryptoWallet: return "bitcoinsign.circle.fill"
        case .wifiRouter: return "wifi"
        case .passport: return "book.closed.fill"
        case .driverLicense: return "car.fill"
        case .membership: return "person.crop.rectangle.stack.fill"
        case .medicalRecord: return "heart.text.square.fill"
        case .document: return "folder.fill"
        }
    }

    public var defaultColorHex: String {
        switch self {
        case .login: return "#0572EC"
        case .password: return "#7C3AED"
        case .secureNote: return "#D97706"
        case .creditCard: return "#0D9488"
        case .identity: return "#DB2777"
        case .apiCredential: return "#2563EB"
        case .database: return "#0891B2"
        case .server: return "#4F46E5"
        case .sshKey: return "#16A34A"
        case .softwareLicense: return "#EA580C"
        case .passkey: return "#0EA5E9"
        case .bankAccount: return "#0F766E"
        case .cryptoWallet: return "#D97706"
        case .wifiRouter: return "#0284C7"
        case .passport: return "#4338CA"
        case .driverLicense: return "#2563EB"
        case .membership: return "#9333EA"
        case .medicalRecord: return "#E11D48"
        case .document: return "#475569"
        }
    }
}

public enum KSFieldType: String, Sendable, Codable, CaseIterable, Identifiable {
    case text
    case password
    case email
    case url
    case totp
    case date
    case monthYear = "month_year"
    case phone
    case number
    case address
    case multiline
    case sshPrivateKey = "ssh_private_key"
    case sshPublicKey = "ssh_public_key"
    case keyValue = "key_value"

    public var id: String { rawValue }
}

public enum KSFieldPurpose: String, Sendable, Codable, CaseIterable {
    case username
    case password
    case totp
    case cardNumber = "card_number"
    case cardCvv = "card_cvv"
    case cardExpiry = "card_expiry"
    case pin
    case recoveryCodes = "recovery_codes"
}

public enum KSUrlMatchRule: String, Sendable, Codable, CaseIterable, Identifiable {
    case domain
    case host
    case startsWith = "starts_with"
    case exact
    case never

    public var id: String { rawValue }
}

public enum KSItemIcon: Sendable, Codable, Equatable, Hashable {
    case domain(host: String)
    case preset(name: String, color: String)

    enum CodingKeys: String, CodingKey {
        case kind, host, name, color
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let kind = try c.decode(String.self, forKey: .kind)
        if kind == "domain" {
            let host = try c.decode(String.self, forKey: .host)
            self = .domain(host: host)
        } else {
            let name = try c.decodeIfPresent(String.self, forKey: .name) ?? "key"
            let color = try c.decodeIfPresent(String.self, forKey: .color) ?? "#0572EC"
            self = .preset(name: name, color: color)
        }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .domain(let host):
            try c.encode("domain", forKey: .kind)
            try c.encode(host, forKey: .host)
        case .preset(let name, let color):
            try c.encode("preset", forKey: .kind)
            try c.encode(name, forKey: .name)
            try c.encode(color, forKey: .color)
        }
    }
}

public struct KSItemField: Sendable, Codable, Identifiable, Equatable, Hashable {
    public var id: String
    public var label: String
    public var fieldType: KSFieldType
    public var value: String
    public var sensitive: Bool
    public var copyable: Bool
    public var purpose: KSFieldPurpose?

    public init(
        id: String = UUID().uuidString,
        label: String,
        fieldType: KSFieldType,
        value: String,
        sensitive: Bool = false,
        copyable: Bool = true,
        purpose: KSFieldPurpose? = nil
    ) {
        self.id = id
        self.label = label
        self.fieldType = fieldType
        self.value = value
        self.sensitive = sensitive
        self.copyable = copyable
        self.purpose = purpose
    }

    enum CodingKeys: String, CodingKey {
        case id, label, fieldType, value, sensitive, copyable, purpose
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        label = try c.decode(String.self, forKey: .label)
        fieldType = try c.decode(KSFieldType.self, forKey: .fieldType)
        value = try c.decode(String.self, forKey: .value)
        sensitive = try c.decodeIfPresent(Bool.self, forKey: .sensitive) ?? false
        copyable = try c.decodeIfPresent(Bool.self, forKey: .copyable) ?? true
        purpose = try c.decodeIfPresent(KSFieldPurpose.self, forKey: .purpose)
    }
}

public struct KSItemSection: Sendable, Codable, Identifiable, Equatable, Hashable {
    public var id: String
    public var title: String
    public var fields: [KSItemField]

    public init(id: String = UUID().uuidString, title: String = "", fields: [KSItemField] = []) {
        self.id = id
        self.title = title
        self.fields = fields
    }
}

public struct KSItemUrl: Sendable, Codable, Identifiable, Equatable, Hashable {
    public var id: String
    public var uri: String
    public var label: String?
    public var matchRule: KSUrlMatchRule

    public init(
        id: String = UUID().uuidString,
        uri: String,
        label: String? = nil,
        matchRule: KSUrlMatchRule = .domain
    ) {
        self.id = id
        self.uri = uri
        self.label = label
        self.matchRule = matchRule
    }
}

public struct KSPasswordHistoryEntry: Sendable, Codable, Equatable, Hashable {
    public var value: String
    public var changedAt: String

    public init(value: String, changedAt: String) {
        self.value = value
        self.changedAt = changedAt
    }
}

public struct KSWatchtowerFlags: Sendable, Codable, Equatable, Hashable {
    public var ignoreWeak: Bool
    public var ignoreReused: Bool
    public var ignoreMissing2fa: Bool
    public var ignoreUnsecuredUrl: Bool
    public var ignoreExpiring: Bool
    public var ignorePasskeyAvailable: Bool

    public init(
        ignoreWeak: Bool = false,
        ignoreReused: Bool = false,
        ignoreMissing2fa: Bool = false,
        ignoreUnsecuredUrl: Bool = false,
        ignoreExpiring: Bool = false,
        ignorePasskeyAvailable: Bool = false
    ) {
        self.ignoreWeak = ignoreWeak
        self.ignoreReused = ignoreReused
        self.ignoreMissing2fa = ignoreMissing2fa
        self.ignoreUnsecuredUrl = ignoreUnsecuredUrl
        self.ignoreExpiring = ignoreExpiring
        self.ignorePasskeyAvailable = ignorePasskeyAvailable
    }

    enum CodingKeys: String, CodingKey {
        case ignoreWeak, ignoreReused, ignoreMissing2fa, ignoreUnsecuredUrl, ignoreExpiring, ignorePasskeyAvailable
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        ignoreWeak = try c.decodeIfPresent(Bool.self, forKey: .ignoreWeak) ?? false
        ignoreReused = try c.decodeIfPresent(Bool.self, forKey: .ignoreReused) ?? false
        ignoreMissing2fa = try c.decodeIfPresent(Bool.self, forKey: .ignoreMissing2fa) ?? false
        ignoreUnsecuredUrl = try c.decodeIfPresent(Bool.self, forKey: .ignoreUnsecuredUrl) ?? false
        ignoreExpiring = try c.decodeIfPresent(Bool.self, forKey: .ignoreExpiring) ?? false
        ignorePasskeyAvailable = try c.decodeIfPresent(Bool.self, forKey: .ignorePasskeyAvailable) ?? false
    }
}

public struct KSItemAttachment: Sendable, Codable, Identifiable, Equatable, Hashable {
    public var id: String
    public var fileName: String
    public var size: UInt64
    public var sizeName: String
    public var hasLocalData: Bool

    public init(id: String, fileName: String, size: UInt64, sizeName: String, hasLocalData: Bool = false) {
        self.id = id
        self.fileName = fileName
        self.size = size
        self.sizeName = sizeName
        self.hasLocalData = hasLocalData
    }
}

public struct KSPasskeyCredential: Sendable, Codable, Identifiable, Equatable, Hashable {
    public var credentialId: String
    public var rpId: String
    public var rpName: String
    public var userHandle: String
    public var userName: String
    public var userDisplayName: String
    public var algorithm: Int
    public var privateKeyPkcs8: String?
    public var publicKeySpki: String
    public var signCount: UInt32
    public var discoverable: Bool
    public var aaguid: String
    public var transports: [String]
    public var backedUp: Bool
    public var createdAt: String
    public var lastUsedAt: String?

    public var id: String { credentialId }

    public init(
        credentialId: String,
        rpId: String,
        rpName: String,
        userHandle: String,
        userName: String,
        userDisplayName: String,
        algorithm: Int = -7,
        privateKeyPkcs8: String? = nil,
        publicKeySpki: String = "",
        signCount: UInt32 = 0,
        discoverable: Bool = true,
        aaguid: String = "",
        transports: [String] = ["internal"],
        backedUp: Bool = true,
        createdAt: String = "",
        lastUsedAt: String? = nil
    ) {
        self.credentialId = credentialId
        self.rpId = rpId
        self.rpName = rpName
        self.userHandle = userHandle
        self.userName = userName
        self.userDisplayName = userDisplayName
        self.algorithm = algorithm
        self.privateKeyPkcs8 = privateKeyPkcs8
        self.publicKeySpki = publicKeySpki
        self.signCount = signCount
        self.discoverable = discoverable
        self.aaguid = aaguid
        self.transports = transports
        self.backedUp = backedUp
        self.createdAt = createdAt
        self.lastUsedAt = lastUsedAt
    }
}

public enum KSWatchtowerIssue: String, Sendable, Codable, CaseIterable, Identifiable, Hashable {
    case weak
    case reused
    case missing2fa = "missing_2fa"
    case unsecuredUrl = "unsecured_url"
    case expiring
    case breached
    case passkeyAvailable = "passkey_available"

    public var id: String { rawValue }
}

public struct KSItemSummary: Sendable, Codable, Identifiable, Equatable, Hashable {
    public var id: String
    public var vaultId: String
    public var title: String
    public var subtitle: String
    public var category: KSItemCategory
    public var icon: KSItemIcon?
    public var tags: [String]
    public var favorite: Bool
    public var hasTotp: Bool
    public var hasPasskey: Bool
    public var primaryUrl: String?
    public var username: String?
    public var hasPassword: Bool
    public var archived: Bool
    public var reprompt: Bool
    public var ssoProvider: String?
    public var linkedItemCount: Int
    public var attachmentCount: Int
    public var deletedAt: String?
    public var updatedAt: String
    public var issues: [KSWatchtowerIssue]

    public init(
        id: String,
        vaultId: String,
        title: String,
        subtitle: String,
        category: KSItemCategory,
        icon: KSItemIcon? = nil,
        tags: [String] = [],
        favorite: Bool = false,
        hasTotp: Bool = false,
        hasPasskey: Bool = false,
        primaryUrl: String? = nil,
        username: String? = nil,
        hasPassword: Bool = false,
        archived: Bool = false,
        reprompt: Bool = false,
        ssoProvider: String? = nil,
        linkedItemCount: Int = 0,
        attachmentCount: Int = 0,
        deletedAt: String? = nil,
        updatedAt: String = "",
        issues: [KSWatchtowerIssue] = []
    ) {
        self.id = id
        self.vaultId = vaultId
        self.title = title
        self.subtitle = subtitle
        self.category = category
        self.icon = icon
        self.tags = tags
        self.favorite = favorite
        self.hasTotp = hasTotp
        self.hasPasskey = hasPasskey
        self.primaryUrl = primaryUrl
        self.username = username
        self.hasPassword = hasPassword
        self.archived = archived
        self.reprompt = reprompt
        self.ssoProvider = ssoProvider
        self.linkedItemCount = linkedItemCount
        self.attachmentCount = attachmentCount
        self.deletedAt = deletedAt
        self.updatedAt = updatedAt
        self.issues = issues
    }

    enum CodingKeys: String, CodingKey {
        case id, vaultId, title, subtitle, category, icon, tags, favorite
        case hasTotp, hasPasskey, primaryUrl, username, hasPassword
        case archived, reprompt, ssoProvider, linkedItemCount, attachmentCount
        case deletedAt, updatedAt, issues
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        vaultId = try c.decode(String.self, forKey: .vaultId)
        title = try c.decode(String.self, forKey: .title)
        subtitle = try c.decodeIfPresent(String.self, forKey: .subtitle) ?? ""
        category = try c.decode(KSItemCategory.self, forKey: .category)
        icon = try c.decodeIfPresent(KSItemIcon.self, forKey: .icon)
        tags = try c.decodeIfPresent([String].self, forKey: .tags) ?? []
        favorite = try c.decodeIfPresent(Bool.self, forKey: .favorite) ?? false
        hasTotp = try c.decodeIfPresent(Bool.self, forKey: .hasTotp) ?? false
        hasPasskey = try c.decodeIfPresent(Bool.self, forKey: .hasPasskey) ?? false
        primaryUrl = try c.decodeIfPresent(String.self, forKey: .primaryUrl)
        username = try c.decodeIfPresent(String.self, forKey: .username)
        hasPassword = try c.decodeIfPresent(Bool.self, forKey: .hasPassword) ?? false
        archived = try c.decodeIfPresent(Bool.self, forKey: .archived) ?? false
        reprompt = try c.decodeIfPresent(Bool.self, forKey: .reprompt) ?? false
        ssoProvider = try c.decodeIfPresent(String.self, forKey: .ssoProvider)
        linkedItemCount = try c.decodeIfPresent(Int.self, forKey: .linkedItemCount) ?? 0
        attachmentCount = try c.decodeIfPresent(Int.self, forKey: .attachmentCount) ?? 0
        deletedAt = try c.decodeIfPresent(String.self, forKey: .deletedAt)
        updatedAt = try c.decodeIfPresent(String.self, forKey: .updatedAt) ?? ""
        issues = try c.decodeIfPresent([KSWatchtowerIssue].self, forKey: .issues) ?? []
    }
}

public struct KSItemDetail: Sendable, Codable, Identifiable, Equatable {
    public var id: String
    public var vaultId: String
    public var title: String
    public var favorite: Bool
    public var deletedAt: String?
    public var schema: String
    public var category: KSItemCategory
    public var subtitle: String?
    public var icon: KSItemIcon?
    public var tags: [String]
    public var urls: [KSItemUrl]
    public var sections: [KSItemSection]
    public var passkeys: [KSPasskeyCredential]
    public var notes: String
    public var passwordHistory: [KSPasswordHistoryEntry]
    public var watchtower: KSWatchtowerFlags
    public var archived: Bool
    public var reprompt: Bool
    public var ssoProvider: String?
    public var linkedItemIds: [String]
    public var attachments: [KSItemAttachment]
    public var createdAt: String
    public var updatedAt: String

    public init(
        id: String,
        vaultId: String,
        title: String,
        favorite: Bool = false,
        deletedAt: String? = nil,
        schema: String = "keysmith.item.v1",
        category: KSItemCategory = .login,
        subtitle: String? = nil,
        icon: KSItemIcon? = nil,
        tags: [String] = [],
        urls: [KSItemUrl] = [],
        sections: [KSItemSection] = [],
        passkeys: [KSPasskeyCredential] = [],
        notes: String = "",
        passwordHistory: [KSPasswordHistoryEntry] = [],
        watchtower: KSWatchtowerFlags = KSWatchtowerFlags(),
        archived: Bool = false,
        reprompt: Bool = false,
        ssoProvider: String? = nil,
        linkedItemIds: [String] = [],
        attachments: [KSItemAttachment] = [],
        createdAt: String = "",
        updatedAt: String = ""
    ) {
        self.id = id
        self.vaultId = vaultId
        self.title = title
        self.favorite = favorite
        self.deletedAt = deletedAt
        self.schema = schema
        self.category = category
        self.subtitle = subtitle
        self.icon = icon
        self.tags = tags
        self.urls = urls
        self.sections = sections
        self.passkeys = passkeys
        self.notes = notes
        self.passwordHistory = passwordHistory
        self.watchtower = watchtower
        self.archived = archived
        self.reprompt = reprompt
        self.ssoProvider = ssoProvider
        self.linkedItemIds = linkedItemIds
        self.attachments = attachments
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    enum CodingKeys: String, CodingKey {
        case id, vaultId, title, favorite, deletedAt, schema, category, subtitle, icon
        case tags, urls, sections, passkeys, notes, passwordHistory, watchtower
        case archived, reprompt, ssoProvider, linkedItemIds, attachments, createdAt, updatedAt
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        vaultId = try c.decode(String.self, forKey: .vaultId)
        title = try c.decode(String.self, forKey: .title)
        favorite = try c.decodeIfPresent(Bool.self, forKey: .favorite) ?? false
        deletedAt = try c.decodeIfPresent(String.self, forKey: .deletedAt)
        schema = try c.decodeIfPresent(String.self, forKey: .schema) ?? "keysmith.item.v1"
        category = try c.decode(KSItemCategory.self, forKey: .category)
        subtitle = try c.decodeIfPresent(String.self, forKey: .subtitle)
        icon = try c.decodeIfPresent(KSItemIcon.self, forKey: .icon)
        tags = try c.decodeIfPresent([String].self, forKey: .tags) ?? []
        urls = try c.decodeIfPresent([KSItemUrl].self, forKey: .urls) ?? []
        sections = try c.decodeIfPresent([KSItemSection].self, forKey: .sections) ?? []
        passkeys = try c.decodeIfPresent([KSPasskeyCredential].self, forKey: .passkeys) ?? []
        notes = try c.decodeIfPresent(String.self, forKey: .notes) ?? ""
        passwordHistory = try c.decodeIfPresent([KSPasswordHistoryEntry].self, forKey: .passwordHistory) ?? []
        watchtower = try c.decodeIfPresent(KSWatchtowerFlags.self, forKey: .watchtower) ?? KSWatchtowerFlags()
        archived = try c.decodeIfPresent(Bool.self, forKey: .archived) ?? false
        reprompt = try c.decodeIfPresent(Bool.self, forKey: .reprompt) ?? false
        ssoProvider = try c.decodeIfPresent(String.self, forKey: .ssoProvider)
        linkedItemIds = try c.decodeIfPresent([String].self, forKey: .linkedItemIds) ?? []
        attachments = try c.decodeIfPresent([KSItemAttachment].self, forKey: .attachments) ?? []
        createdAt = try c.decodeIfPresent(String.self, forKey: .createdAt) ?? ""
        updatedAt = try c.decodeIfPresent(String.self, forKey: .updatedAt) ?? ""
    }

    public func toDraft() -> KSItemDraft {
        KSItemDraft(
            id: id,
            vaultId: vaultId,
            title: title,
            favorite: favorite,
            category: category,
            subtitle: subtitle,
            icon: icon,
            tags: tags,
            urls: urls,
            sections: sections,
            passkeys: passkeys,
            notes: notes,
            passwordHistory: passwordHistory,
            watchtower: watchtower,
            archived: archived,
            reprompt: reprompt,
            ssoProvider: ssoProvider,
            linkedItemIds: linkedItemIds
        )
    }

    public var primaryUsername: String? {
        allFields.first(where: { $0.purpose == .username && !$0.value.isEmpty })?.value
            ?? allFields.first(where: { ($0.fieldType == .email || $0.fieldType == .text) && !$0.value.isEmpty })?.value
    }

    public var primaryPassword: String? {
        allFields.first(where: { $0.purpose == .password && !$0.value.isEmpty })?.value
            ?? allFields.first(where: { $0.fieldType == .password && !$0.value.isEmpty })?.value
    }

    public var primaryTotp: String? {
        allFields.first(where: { ($0.purpose == .totp || $0.fieldType == .totp) && !$0.value.isEmpty })?.value
    }

    public var allFields: [KSItemField] {
        sections.flatMap(\.fields)
    }
}

public struct KSItemDraft: Sendable, Codable, Equatable {
    public var id: String?
    public var vaultId: String
    public var title: String
    public var favorite: Bool
    public var category: KSItemCategory
    public var subtitle: String?
    public var icon: KSItemIcon?
    public var tags: [String]
    public var urls: [KSItemUrl]
    public var sections: [KSItemSection]
    public var passkeys: [KSPasskeyCredential]
    public var notes: String
    public var passwordHistory: [KSPasswordHistoryEntry]
    public var watchtower: KSWatchtowerFlags
    public var archived: Bool
    public var reprompt: Bool
    public var ssoProvider: String?
    public var linkedItemIds: [String]

    public init(
        id: String? = nil,
        vaultId: String = "personal",
        title: String = "",
        favorite: Bool = false,
        category: KSItemCategory = .login,
        subtitle: String? = nil,
        icon: KSItemIcon? = nil,
        tags: [String] = [],
        urls: [KSItemUrl] = [],
        sections: [KSItemSection] = [],
        passkeys: [KSPasskeyCredential] = [],
        notes: String = "",
        passwordHistory: [KSPasswordHistoryEntry] = [],
        watchtower: KSWatchtowerFlags = KSWatchtowerFlags(),
        archived: Bool = false,
        reprompt: Bool = false,
        ssoProvider: String? = nil,
        linkedItemIds: [String] = []
    ) {
        self.id = id
        self.vaultId = vaultId
        self.title = title
        self.favorite = favorite
        self.category = category
        self.subtitle = subtitle
        self.icon = icon
        self.tags = tags
        self.urls = urls
        self.sections = sections
        self.passkeys = passkeys
        self.notes = notes
        self.passwordHistory = passwordHistory
        self.watchtower = watchtower
        self.archived = archived
        self.reprompt = reprompt
        self.ssoProvider = ssoProvider
        self.linkedItemIds = linkedItemIds
    }
}

public enum KSSortBy: String, Sendable, Codable, CaseIterable {
    case titleAsc = "title_asc"
    case titleDesc = "title_desc"
    case updatedDesc = "updated_desc"
    case createdDesc = "created_desc"
}

public struct KSItemFilter: Sendable, Codable, Equatable {
    public var vaultId: String?
    public var category: KSItemCategory?
    public var tag: String?
    public var favorite: Bool?
    public var passkeyOnly: Bool?
    public var trashed: Bool?
    public var archived: Bool?
    public var watchtowerIssue: KSWatchtowerIssue?
    public var query: String?
    public var sortBy: KSSortBy?

    public init(
        vaultId: String? = nil,
        category: KSItemCategory? = nil,
        tag: String? = nil,
        favorite: Bool? = nil,
        passkeyOnly: Bool? = nil,
        trashed: Bool? = nil,
        archived: Bool? = nil,
        watchtowerIssue: KSWatchtowerIssue? = nil,
        query: String? = nil,
        sortBy: KSSortBy? = .updatedDesc
    ) {
        self.vaultId = vaultId
        self.category = category
        self.tag = tag
        self.favorite = favorite
        self.passkeyOnly = passkeyOnly
        self.trashed = trashed
        self.archived = archived
        self.watchtowerIssue = watchtowerIssue
        self.query = query
        self.sortBy = sortBy
    }
}

public enum KSSyncStateKind: String, Sendable, Codable, Equatable {
    case idle
    case syncing
    case offline
    case error
}

public struct KSSyncStatus: Sendable, Codable, Equatable {
    public var state: KSSyncStateKind
    public var pendingCount: Int
    public var lastSyncAt: String
    public var message: String?
    public var signalrConnected: Bool

    public init(
        state: KSSyncStateKind = .idle,
        pendingCount: Int = 0,
        lastSyncAt: String = "",
        message: String? = nil,
        signalrConnected: Bool = false
    ) {
        self.state = state
        self.pendingCount = pendingCount
        self.lastSyncAt = lastSyncAt
        self.message = message
        self.signalrConnected = signalrConnected
    }
}

public struct KSTotpCode: Sendable, Codable, Equatable {
    public var code: String
    public var formattedCode: String
    public var remainingSeconds: Int
    public var period: Int

    public init(code: String, formattedCode: String, remainingSeconds: Int, period: Int = 30) {
        self.code = code
        self.formattedCode = formattedCode
        self.remainingSeconds = remainingSeconds
        self.period = period
    }
}

public enum KSGeneratorMode: String, Sendable, Codable, CaseIterable, Identifiable {
    case password
    case passphrase
    case pin

    public var id: String { rawValue }
}

public struct KSGeneratorOptions: Sendable, Codable, Equatable {
    public var mode: KSGeneratorMode
    public var length: Int
    public var includeUppercase: Bool
    public var includeLowercase: Bool
    public var includeDigits: Bool
    public var includeSymbols: Bool
    public var minDigits: Int
    public var minSymbols: Int
    public var excludeAmbiguous: Bool
    public var wordCount: Int
    public var separator: String
    public var capitalize: Bool
    public var includeNumberInPhrase: Bool
    public var pinLength: Int

    public init(
        mode: KSGeneratorMode = .password,
        length: Int = 20,
        includeUppercase: Bool = true,
        includeLowercase: Bool = true,
        includeDigits: Bool = true,
        includeSymbols: Bool = true,
        minDigits: Int = 1,
        minSymbols: Int = 1,
        excludeAmbiguous: Bool = true,
        wordCount: Int = 4,
        separator: String = "-",
        capitalize: Bool = true,
        includeNumberInPhrase: Bool = true,
        pinLength: Int = 6
    ) {
        self.mode = mode
        self.length = length
        self.includeUppercase = includeUppercase
        self.includeLowercase = includeLowercase
        self.includeDigits = includeDigits
        self.includeSymbols = includeSymbols
        self.minDigits = minDigits
        self.minSymbols = minSymbols
        self.excludeAmbiguous = excludeAmbiguous
        self.wordCount = wordCount
        self.separator = separator
        self.capitalize = capitalize
        self.includeNumberInPhrase = includeNumberInPhrase
        self.pinLength = pinLength
    }

    enum CodingKeys: String, CodingKey {
        case mode, length, includeUppercase, includeLowercase, includeDigits, includeSymbols
        case minDigits, minSymbols, excludeAmbiguous, wordCount, separator, capitalize
        case includeNumberInPhrase, pinLength
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        mode = try c.decodeIfPresent(KSGeneratorMode.self, forKey: .mode) ?? .password
        length = try c.decodeIfPresent(Int.self, forKey: .length) ?? 20
        includeUppercase = try c.decodeIfPresent(Bool.self, forKey: .includeUppercase) ?? true
        includeLowercase = try c.decodeIfPresent(Bool.self, forKey: .includeLowercase) ?? true
        includeDigits = try c.decodeIfPresent(Bool.self, forKey: .includeDigits) ?? true
        includeSymbols = try c.decodeIfPresent(Bool.self, forKey: .includeSymbols) ?? true
        minDigits = try c.decodeIfPresent(Int.self, forKey: .minDigits) ?? 1
        minSymbols = try c.decodeIfPresent(Int.self, forKey: .minSymbols) ?? 1
        excludeAmbiguous = try c.decodeIfPresent(Bool.self, forKey: .excludeAmbiguous) ?? true
        wordCount = try c.decodeIfPresent(Int.self, forKey: .wordCount) ?? 4
        separator = try c.decodeIfPresent(String.self, forKey: .separator) ?? "-"
        capitalize = try c.decodeIfPresent(Bool.self, forKey: .capitalize) ?? true
        includeNumberInPhrase = try c.decodeIfPresent(Bool.self, forKey: .includeNumberInPhrase) ?? true
        pinLength = try c.decodeIfPresent(Int.self, forKey: .pinLength) ?? 6
    }
}

public struct KSPasswordStrength: Sendable, Codable, Equatable {
    public var score: Int
    public var label: String
    public var entropyBits: Int

    public init(score: Int = 4, label: String = "Strong", entropyBits: Int = 96) {
        self.score = score
        self.label = label
        self.entropyBits = entropyBits
    }
}

public struct KSGeneratorResult: Sendable, Codable, Equatable {
    public var value: String
    public var strength: KSPasswordStrength

    public init(value: String, strength: KSPasswordStrength = KSPasswordStrength()) {
        self.value = value
        self.strength = strength
    }
}

public struct KSGeneratorHistoryEntry: Sendable, Codable, Identifiable, Equatable {
    public var id: String
    public var value: String
    public var mode: String
    public var entropyBits: Int
    public var source: String?
    public var createdAt: String

    public init(id: String, value: String, mode: String, entropyBits: Int, source: String? = nil, createdAt: String) {
        self.id = id
        self.value = value
        self.mode = mode
        self.entropyBits = entropyBits
        self.source = source
        self.createdAt = createdAt
    }
}

public struct KSWatchtowerReport: Sendable, Codable, Equatable {
    public var score: Int
    public var totalAudited: Int
    public var totalRiskItems: Int
    public var counts: [String: Int]
    public var itemIdsByIssue: [String: [String]]
    public var itemIssues: [String: [KSWatchtowerIssue]]
    public var hibpChecked: Bool
    public var hibpCheckedAt: String?

    public init(
        score: Int = 100,
        totalAudited: Int = 0,
        totalRiskItems: Int = 0,
        counts: [String: Int] = [:],
        itemIdsByIssue: [String: [String]] = [:],
        itemIssues: [String: [KSWatchtowerIssue]] = [:],
        hibpChecked: Bool = false,
        hibpCheckedAt: String? = nil
    ) {
        self.score = score
        self.totalAudited = totalAudited
        self.totalRiskItems = totalRiskItems
        self.counts = counts
        self.itemIdsByIssue = itemIdsByIssue
        self.itemIssues = itemIssues
        self.hibpChecked = hibpChecked
        self.hibpCheckedAt = hibpCheckedAt
    }

    public func count(for issue: KSWatchtowerIssue) -> Int {
        counts[issue.rawValue] ?? 0
    }
}

public enum KSSendType: String, Sendable, Codable, Equatable {
    case text
    case file
}

public struct KSSendItem: Sendable, Codable, Identifiable, Equatable {
    public var id: String
    public var accessId: String
    public var sendType: KSSendType
    public var name: String
    public var notes: String?
    public var text: String?
    public var hidden: Bool
    public var fileName: String?
    public var fileSize: UInt64?
    public var fileSizeName: String?
    public var shareUrl: String
    public var maxAccessCount: Int?
    public var accessCount: Int
    public var expirationDate: String?
    public var deletionDate: String
    public var revisionDate: String
    public var disabled: Bool
    public var hideEmail: Bool
    public var hasPassword: Bool

    public init(
        id: String,
        accessId: String = "",
        sendType: KSSendType = .text,
        name: String,
        notes: String? = nil,
        text: String? = nil,
        hidden: Bool = false,
        fileName: String? = nil,
        fileSize: UInt64? = nil,
        fileSizeName: String? = nil,
        shareUrl: String,
        maxAccessCount: Int? = nil,
        accessCount: Int = 0,
        expirationDate: String? = nil,
        deletionDate: String,
        revisionDate: String = "",
        disabled: Bool = false,
        hideEmail: Bool = false,
        hasPassword: Bool = false
    ) {
        self.id = id
        self.accessId = accessId
        self.sendType = sendType
        self.name = name
        self.notes = notes
        self.text = text
        self.hidden = hidden
        self.fileName = fileName
        self.fileSize = fileSize
        self.fileSizeName = fileSizeName
        self.shareUrl = shareUrl
        self.maxAccessCount = maxAccessCount
        self.accessCount = accessCount
        self.expirationDate = expirationDate
        self.deletionDate = deletionDate
        self.revisionDate = revisionDate
        self.disabled = disabled
        self.hideEmail = hideEmail
        self.hasPassword = hasPassword
    }
}

public struct KSSendCreateTextInput: Sendable, Codable, Equatable {
    public var name: String
    public var text: String
    public var hidden: Bool
    public var notes: String?
    public var maxAccessCount: Int?
    public var expirationDate: String?
    public var deletionDate: String
    public var password: String?
    public var disabled: Bool
    public var hideEmail: Bool

    public init(
        name: String,
        text: String,
        hidden: Bool = false,
        notes: String? = nil,
        maxAccessCount: Int? = nil,
        expirationDate: String? = nil,
        deletionDate: String,
        password: String? = nil,
        disabled: Bool = false,
        hideEmail: Bool = false
    ) {
        self.name = name
        self.text = text
        self.hidden = hidden
        self.notes = notes
        self.maxAccessCount = maxAccessCount
        self.expirationDate = expirationDate
        self.deletionDate = deletionDate
        self.password = password
        self.disabled = disabled
        self.hideEmail = hideEmail
    }
}

public enum KSLanguageMode: String, Sendable, Codable, CaseIterable, Identifiable {
    case system
    case zhCN = "zh-CN"
    case zhTW = "zh-TW"
    case en
    case ja
    case ko
    case de
    case fr
    case es

    public var id: String { rawValue }

    public var nativeName: String {
        switch self {
        case .system: return "System / 跟随系统"
        case .zhCN: return "简体中文"
        case .zhTW: return "繁體中文"
        case .en: return "English"
        case .ja: return "日本語"
        case .ko: return "한국어"
        case .de: return "Deutsch"
        case .fr: return "Français"
        case .es: return "Español"
        }
    }
}

public enum KSThemeMode: String, Sendable, Codable, CaseIterable, Identifiable {
    case system
    case light
    case dark

    public var id: String { rawValue }
}

public enum KSSyncMode: String, Sendable, Codable, CaseIterable, Identifiable {
    case auto
    case manual

    public var id: String { rawValue }
}

public enum KSMaskedEmailProvider: String, Sendable, Codable, CaseIterable {
    case catchAll = "catch_all"
    case simpleLogin = "simple_login"
    case addyIo = "addy_io"
    case fastmail
    case duckDuckGo = "duck_duck_go"
}

public struct KSMaskedEmailConfig: Sendable, Codable, Equatable {
    public var provider: KSMaskedEmailProvider
    public var apiKey: String
    public var domain: String
    public var apiBaseUrl: String?

    public init(
        provider: KSMaskedEmailProvider = .catchAll,
        apiKey: String = "",
        domain: String = "",
        apiBaseUrl: String? = nil
    ) {
        self.provider = provider
        self.apiKey = apiKey
        self.domain = domain
        self.apiBaseUrl = apiBaseUrl
    }
}

public struct KSAppSettings: Sendable, Codable, Equatable {
    public var language: String
    public var theme: String
    public var customShortcuts: [String: String]
    public var lastServerUrl: String?
    public var maskedEmail: KSMaskedEmailConfig
    public var customEquivalentDomains: [[String]]
    public var disabledAutofillDomains: [String]
    public var autoCopyTotpOnFill: Bool
    public var sshAgentEnabled: Bool
    public var snapshotIntervalDays: Int
    public var snapshotKeepCount: Int
    public var syncMode: String

    public init(
        language: String = "system",
        theme: String = "system",
        customShortcuts: [String: String] = [:],
        lastServerUrl: String? = nil,
        maskedEmail: KSMaskedEmailConfig = KSMaskedEmailConfig(),
        customEquivalentDomains: [[String]] = [["apple.com", "icloud.com"], ["github.com", "gist.github.com"]],
        disabledAutofillDomains: [String] = [],
        autoCopyTotpOnFill: Bool = true,
        sshAgentEnabled: Bool = false,
        snapshotIntervalDays: Int = 1,
        snapshotKeepCount: Int = 5,
        syncMode: String = "auto"
    ) {
        self.language = language
        self.theme = theme
        self.customShortcuts = customShortcuts
        self.lastServerUrl = lastServerUrl
        self.maskedEmail = maskedEmail
        self.customEquivalentDomains = customEquivalentDomains
        self.disabledAutofillDomains = disabledAutofillDomains
        self.autoCopyTotpOnFill = autoCopyTotpOnFill
        self.sshAgentEnabled = sshAgentEnabled
        self.snapshotIntervalDays = snapshotIntervalDays
        self.snapshotKeepCount = snapshotKeepCount
        self.syncMode = syncMode
    }

    enum CodingKeys: String, CodingKey {
        case language, theme, customShortcuts, lastServerUrl, maskedEmail
        case customEquivalentDomains, disabledAutofillDomains, autoCopyTotpOnFill
        case sshAgentEnabled, snapshotIntervalDays, snapshotKeepCount, syncMode
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        language = try c.decodeIfPresent(String.self, forKey: .language) ?? "system"
        theme = try c.decodeIfPresent(String.self, forKey: .theme) ?? "system"
        customShortcuts = try c.decodeIfPresent([String: String].self, forKey: .customShortcuts) ?? [:]
        lastServerUrl = try c.decodeIfPresent(String.self, forKey: .lastServerUrl)
        maskedEmail = try c.decodeIfPresent(KSMaskedEmailConfig.self, forKey: .maskedEmail) ?? KSMaskedEmailConfig()
        customEquivalentDomains = try c.decodeIfPresent([[String]].self, forKey: .customEquivalentDomains) ?? []
        disabledAutofillDomains = try c.decodeIfPresent([String].self, forKey: .disabledAutofillDomains) ?? []
        autoCopyTotpOnFill = try c.decodeIfPresent(Bool.self, forKey: .autoCopyTotpOnFill) ?? true
        sshAgentEnabled = try c.decodeIfPresent(Bool.self, forKey: .sshAgentEnabled) ?? false
        snapshotIntervalDays = try c.decodeIfPresent(Int.self, forKey: .snapshotIntervalDays) ?? 1
        snapshotKeepCount = try c.decodeIfPresent(Int.self, forKey: .snapshotKeepCount) ?? 5
        syncMode = try c.decodeIfPresent(String.self, forKey: .syncMode) ?? "auto"
    }

    public var languageMode: KSLanguageMode {
        KSLanguageMode(rawValue: language) ?? .system
    }

    public var themeMode: KSThemeMode {
        KSThemeMode(rawValue: theme) ?? .system
    }

    public var syncModeEnum: KSSyncMode {
        KSSyncMode(rawValue: syncMode) ?? .auto
    }
}

public struct KSAppSettingsPatch: Sendable, Codable, Equatable {
    public var language: String?
    public var theme: String?
    public var customShortcuts: [String: String]?
    public var lastServerUrl: String?
    public var maskedEmail: KSMaskedEmailConfig?
    public var customEquivalentDomains: [[String]]?
    public var disabledAutofillDomains: [String]?
    public var autoCopyTotpOnFill: Bool?
    public var sshAgentEnabled: Bool?
    public var snapshotIntervalDays: Int?
    public var snapshotKeepCount: Int?
    public var syncMode: String?

    public init(
        language: String? = nil,
        theme: String? = nil,
        customShortcuts: [String: String]? = nil,
        lastServerUrl: String? = nil,
        maskedEmail: KSMaskedEmailConfig? = nil,
        customEquivalentDomains: [[String]]? = nil,
        disabledAutofillDomains: [String]? = nil,
        autoCopyTotpOnFill: Bool? = nil,
        sshAgentEnabled: Bool? = nil,
        snapshotIntervalDays: Int? = nil,
        snapshotKeepCount: Int? = nil,
        syncMode: String? = nil
    ) {
        self.language = language
        self.theme = theme
        self.customShortcuts = customShortcuts
        self.lastServerUrl = lastServerUrl
        self.maskedEmail = maskedEmail
        self.customEquivalentDomains = customEquivalentDomains
        self.disabledAutofillDomains = disabledAutofillDomains
        self.autoCopyTotpOnFill = autoCopyTotpOnFill
        self.sshAgentEnabled = sshAgentEnabled
        self.snapshotIntervalDays = snapshotIntervalDays
        self.snapshotKeepCount = snapshotKeepCount
        self.syncMode = syncMode
    }
}

public struct KSLocalSnapshotInfo: Sendable, Codable, Identifiable, Equatable {
    public var id: String
    public var fileName: String
    public var createdAt: String
    public var sizeBytes: UInt64
    public var itemCount: Int
    public var vaultCount: Int

    public init(id: String, fileName: String, createdAt: String, sizeBytes: UInt64, itemCount: Int, vaultCount: Int) {
        self.id = id
        self.fileName = fileName
        self.createdAt = createdAt
        self.sizeBytes = sizeBytes
        self.itemCount = itemCount
        self.vaultCount = vaultCount
    }
}

public struct KSExportResult: Sendable, Codable, Equatable {
    public var fileName: String
    public var content: String

    public init(fileName: String, content: String) {
        self.fileName = fileName
        self.content = content
    }
}

public struct KSImportSummary: Sendable, Codable, Equatable {
    public var importedVaults: Int
    public var importedItems: Int
    public var skippedItems: Int
    public var warnings: [String]

    public init(importedVaults: Int, importedItems: Int, skippedItems: Int, warnings: [String] = []) {
        self.importedVaults = importedVaults
        self.importedItems = importedItems
        self.skippedItems = skippedItems
        self.warnings = warnings
    }
}

public struct KSServerCheckResult: Sendable, Codable, Equatable {
    public var ok: Bool
    public var version: String
    public var disableUserRegistration: Bool

    public init(ok: Bool, version: String, disableUserRegistration: Bool = false) {
        self.ok = ok
        self.version = version
        self.disableUserRegistration = disableUserRegistration
    }
}

public struct KSKdfConfig: Sendable, Codable, Equatable {
    public var kdf: Int
    public var kdfIterations: Int
    public var kdfMemory: Int?
    public var kdfParallelism: Int?

    public init(kdf: Int = 1, kdfIterations: Int = 600_000, kdfMemory: Int? = 64, kdfParallelism: Int? = 4) {
        self.kdf = kdf
        self.kdfIterations = kdfIterations
        self.kdfMemory = kdfMemory
        self.kdfParallelism = kdfParallelism
    }
}

public struct KSTextInsertCandidate: Sendable, Codable, Identifiable, Equatable {
    public var id: String
    public var itemId: String
    public var itemTitle: String
    public var category: KSItemCategory
    public var fieldLabel: String
    public var value: String
    public var sensitive: Bool
    public var subtitle: String

    public init(
        id: String,
        itemId: String,
        itemTitle: String,
        category: KSItemCategory,
        fieldLabel: String,
        value: String,
        sensitive: Bool = false,
        subtitle: String = ""
    ) {
        self.id = id
        self.itemId = itemId
        self.itemTitle = itemTitle
        self.category = category
        self.fieldLabel = fieldLabel
        self.value = value
        self.sensitive = sensitive
        self.subtitle = subtitle
    }

    enum CodingKeys: String, CodingKey {
        case id, itemId, itemTitle, category, fieldLabel, value, sensitive, subtitle
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(String.self, forKey: .id) ?? UUID().uuidString
        itemId = try c.decode(String.self, forKey: .itemId)
        itemTitle = try c.decode(String.self, forKey: .itemTitle)
        category = try c.decodeIfPresent(KSItemCategory.self, forKey: .category) ?? .creditCard
        fieldLabel = try c.decode(String.self, forKey: .fieldLabel)
        value = try c.decode(String.self, forKey: .value)
        sensitive = try c.decodeIfPresent(Bool.self, forKey: .sensitive) ?? false
        subtitle = try c.decodeIfPresent(String.self, forKey: .subtitle) ?? ""
    }
}

public struct KSPasskeyListCandidate: Sendable, Codable, Identifiable, Equatable {
    public var itemId: String
    public var itemTitle: String
    public var credentialId: String
    public var rpId: String
    public var rpName: String
    public var userHandle: String
    public var userName: String
    public var userDisplayName: String

    public var id: String { credentialId }

    public init(
        itemId: String,
        itemTitle: String,
        credentialId: String,
        rpId: String,
        rpName: String,
        userHandle: String,
        userName: String,
        userDisplayName: String
    ) {
        self.itemId = itemId
        self.itemTitle = itemTitle
        self.credentialId = credentialId
        self.rpId = rpId
        self.rpName = rpName
        self.userHandle = userHandle
        self.userName = userName
        self.userDisplayName = userDisplayName
    }
}

public enum KSPhoneTab: Hashable, Sendable {
    case home
    case items
    case tools
    case search
}

public struct KSApplePasskeyRegistration: Sendable, Equatable {
    public var credentialId: Data
    public var attestationObject: Data
    public var clientDataHash: Data
    public var itemId: String

    public init(credentialId: Data, attestationObject: Data, clientDataHash: Data, itemId: String) {
        self.credentialId = credentialId
        self.attestationObject = attestationObject
        self.clientDataHash = clientDataHash
        self.itemId = itemId
    }
}

public struct KSApplePasskeyAssertion: Sendable, Equatable {
    public var credentialId: Data
    public var userHandle: Data
    public var authenticatorData: Data
    public var signature: Data
    public var clientDataHash: Data

    public init(
        credentialId: Data,
        userHandle: Data,
        authenticatorData: Data,
        signature: Data,
        clientDataHash: Data
    ) {
        self.credentialId = credentialId
        self.userHandle = userHandle
        self.authenticatorData = authenticatorData
        self.signature = signature
        self.clientDataHash = clientDataHash
    }
}

public enum KSCoreAdapterError: Error, LocalizedError, Sendable {
    case notInitialized
    case twoFactorRequired(message: String, providers: [UInt8])
    case invalidMasterPassword(String)
    case locked(String)
    case network(String)
    case validation(String)
    case biometric(String)
    case backend(String)

    public var errorDescription: String? {
        switch self {
        case .notInitialized: return "Keysmith core is not initialized"
        case .twoFactorRequired(let msg, _): return msg
        case .invalidMasterPassword(let msg): return msg
        case .locked(let msg): return msg
        case .network(let msg): return msg
        case .validation(let msg): return msg
        case .biometric(let msg): return msg
        case .backend(let msg): return msg
        }
    }
}
