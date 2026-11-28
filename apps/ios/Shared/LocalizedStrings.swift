import Foundation

public struct KSLocalizedStrings: Sendable {
    public let locale: KSLanguageMode

    public init(languageCode: String) {
        self.locale = Self.resolve(languageCode: languageCode)
    }

    public static func resolve(languageCode: String) -> KSLanguageMode {
        let mode = KSLanguageMode(rawValue: languageCode) ?? .system
        if mode != .system { return mode }
        let preferred = Locale.preferredLanguages.first?.lowercased() ?? "en"
        if preferred.hasPrefix("zh-hant") || preferred.hasPrefix("zh-tw") || preferred.hasPrefix("zh-hk") {
            return .zhTW
        }
        if preferred.hasPrefix("zh") { return .zhCN }
        if preferred.hasPrefix("ja") { return .ja }
        if preferred.hasPrefix("ko") { return .ko }
        if preferred.hasPrefix("de") { return .de }
        if preferred.hasPrefix("fr") { return .fr }
        if preferred.hasPrefix("es") { return .es }
        return .en
    }

    private var isZhHans: Bool { locale == .zhCN }
    private var isZhHant: Bool { locale == .zhTW }
    private var isJa: Bool { locale == .ja }
    private var isKo: Bool { locale == .ko }
    private var isDe: Bool { locale == .de }
    private var isFr: Bool { locale == .fr }
    private var isEs: Bool { locale == .es }

    public func t(
        zhCN: String,
        zhTW: String? = nil,
        en: String,
        ja: String? = nil,
        ko: String? = nil,
        de: String? = nil,
        fr: String? = nil,
        es: String? = nil
    ) -> String {
        switch locale {
        case .zhCN: return zhCN
        case .zhTW: return zhTW ?? zhCN
        case .en, .system: return en
        case .ja: return ja ?? en
        case .ko: return ko ?? en
        case .de: return de ?? en
        case .fr: return fr ?? en
        case .es: return es ?? en
        }
    }

    // MARK: - Tabs & Navigation
    public var tabHome: String {
        t(zhCN: "首页", zhTW: "首頁", en: "Home", ja: "ホーム", ko: "홈", de: "Start", fr: "Accueil", es: "Inicio")
    }
    public var tabItems: String {
        t(zhCN: "项目", zhTW: "項目", en: "Items", ja: "項目", ko: "항목", de: "Einträge", fr: "Éléments", es: "Elementos")
    }
    public var tabTools: String {
        t(zhCN: "安全中心", zhTW: "安全中心", en: "Security", ja: "セキュリティ", ko: "보안", de: "Sicherheit", fr: "Sécurité", es: "Seguridad")
    }
    public var tabSearch: String {
        t(zhCN: "搜索", zhTW: "搜尋", en: "Search", ja: "検索", ko: "검색", de: "Suche", fr: "Rechercher", es: "Buscar")
    }

    // MARK: - Common
    public var allVaults: String {
        t(zhCN: "全部保险库", zhTW: "全部保險庫", en: "All Vaults", ja: "すべての保管庫", ko: "모든 금고", de: "Alle Tresore", fr: "Tous les coffres", es: "Todas las bóvedas")
    }
    public var allItems: String {
        t(zhCN: "所有项目", zhTW: "所有項目", en: "All Items", ja: "すべて", ko: "모든 항목", de: "Alle Einträge", fr: "Tous", es: "Todos")
    }
    public var favorites: String {
        t(zhCN: "常用收藏", zhTW: "常用收藏", en: "Favorites", ja: "お気に入り", ko: "즐겨찾기", de: "Favoriten", fr: "Favoris", es: "Favoritos")
    }
    public var recentItems: String {
        t(zhCN: "最近使用", zhTW: "最近使用", en: "Recent", ja: "最近使用", ko: "최근 항목", de: "Zuletzt", fr: "Récents", es: "Recientes")
    }
    public var liveTotp: String {
        t(zhCN: "实时验证码 (2FA)", zhTW: "即時驗證碼 (2FA)", en: "Live Codes (2FA)", ja: "2FA コード", ko: "실시간 2FA", de: "Live-Codes (2FA)", fr: "Codes 2FA", es: "Códigos 2FA")
    }
    public var newItem: String {
        t(zhCN: "新建", zhTW: "新增", en: "New", ja: "新規", ko: "새 항목", de: "Neu", fr: "Nouveau", es: "Nuevo")
    }
    public var settings: String {
        t(zhCN: "设置", zhTW: "設定", en: "Settings", ja: "設定", ko: "설정", de: "Einstellungen", fr: "Réglages", es: "Ajustes")
    }
    public var lockNow: String {
        t(zhCN: "锁定", zhTW: "鎖定", en: "Lock", ja: "ロック", ko: "잠금", de: "Sperren", fr: "Verrouiller", es: "Bloquear")
    }
    public var syncNow: String {
        t(zhCN: "立即同步", zhTW: "立即同步", en: "Sync Now", ja: "今すぐ同期", ko: "지금 동기화", de: "Jetzt synchronisieren", fr: "Synchroniser", es: "Sincronizar")
    }
    public var save: String {
        t(zhCN: "保存", zhTW: "儲存", en: "Save", ja: "保存", ko: "저장", de: "Sichern", fr: "Enregistrer", es: "Guardar")
    }
    public var cancel: String {
        t(zhCN: "取消", zhTW: "取消", en: "Cancel", ja: "キャンセル", ko: "취소", de: "Abbrechen", fr: "Annuler", es: "Cancelar")
    }
    public var edit: String {
        t(zhCN: "编辑", zhTW: "編輯", en: "Edit", ja: "編集", ko: "편집", de: "Bearbeiten", fr: "Modifier", es: "Editar")
    }
    public var copy: String {
        t(zhCN: "复制", zhTW: "複製", en: "Copy", ja: "コピー", ko: "복사", de: "Kopieren", fr: "Copier", es: "Copiar")
    }
    public var reveal: String {
        t(zhCN: "显示", zhTW: "顯示", en: "Reveal", ja: "表示", ko: "표시", de: "Einblenden", fr: "Afficher", es: "Mostrar")
    }
    public var hide: String {
        t(zhCN: "隐藏", zhTW: "隱藏", en: "Hide", ja: "隠す", ko: "숨기기", de: "Ausblenden", fr: "Masquer", es: "Ocultar")
    }
    public var largeType: String {
        t(zhCN: "大字查看", zhTW: "大字檢視", en: "Large Type", ja: "大きく表示", ko: "큰 글자", de: "Großdruck", fr: "Grands caractères", es: "Texto grande")
    }
    public var clearClipboard: String {
        t(zhCN: "清空", zhTW: "清除", en: "Clear", ja: "消去", ko: "지우기", de: "Löschen", fr: "Effacer", es: "Borrar")
    }
    public var done: String {
        t(zhCN: "完成", zhTW: "完成", en: "Done", ja: "完了", ko: "완료", de: "Fertig", fr: "Terminé", es: "Listo")
    }
    public var close: String {
        t(zhCN: "关闭", zhTW: "關閉", en: "Close", ja: "閉じる", ko: "닫기", de: "Schließen", fr: "Fermer", es: "Cerrar")
    }

    // MARK: - Auth & Lock
    public var signInTitle: String {
        t(zhCN: "登录 Keysmith", zhTW: "登入 Keysmith", en: "Sign in to Keysmith", ja: "Keysmith にサインイン", ko: "Keysmith 로그인", de: "Bei Keysmith anmelden", fr: "Connexion à Keysmith", es: "Iniciar sesión")
    }
    public var createAccountTitle: String {
        t(zhCN: "创建账户", zhTW: "建立帳戶", en: "Create Account", ja: "アカウント作成", ko: "계정 만들기", de: "Konto erstellen", fr: "Créer un compte", es: "Crear cuenta")
    }
    public var enterDemoMode: String {
        t(zhCN: "进入本地演示模式", zhTW: "進入本機示範模式", en: "Enter Local Demo Mode", ja: "デモモードに入る", ko: "로컬 데모 모드", de: "Lokaler Demomodus", fr: "Mode démo local", es: "Modo demo local")
    }
    public var vaultLockedTitle: String {
        t(zhCN: "Keysmith 保险库已锁定", zhTW: "Keysmith 保險庫已鎖定", en: "Keysmith Vault Locked", ja: "Keysmith はロックされています", ko: "Keysmith 금고 잠김", de: "Keysmith-Tresor gesperrt", fr: "Coffre verrouillé", es: "Bóveda bloqueada")
    }
    public var unlockWithFaceID: String {
        t(zhCN: "使用 Face ID 解锁", zhTW: "使用 Face ID 解鎖", en: "Unlock with Face ID", ja: "Face ID でロック解除", ko: "Face ID로 잠금 해제", de: "Mit Face ID entsperren", fr: "Déverrouiller avec Face ID", es: "Desbloquear con Face ID")
    }
    public var masterPasswordPlaceholder: String {
        t(zhCN: "输入主密码", zhTW: "輸入主密碼", en: "Enter master password", ja: "マスターパスワードを入力", ko: "마스터 비밀번호 입력", de: "Master-Passwort eingeben", fr: "Mot de passe principal", es: "Contraseña maestra")
    }
    public var unlock: String {
        t(zhCN: "解锁", zhTW: "解鎖", en: "Unlock", ja: "ロック解除", ko: "잠금 해제", de: "Entsperren", fr: "Déverrouiller", es: "Desbloquear")
    }

    public func categoryTitle(_ category: KSItemCategory) -> String {
        switch category {
        case .login: return t(zhCN: "登录", zhTW: "登入", en: "Login", ja: "ログイン", ko: "로그인", de: "Anmeldung", fr: "Identifiant", es: "Inicio de sesión")
        case .password: return t(zhCN: "密码", zhTW: "密碼", en: "Password", ja: "パスワード", ko: "비밀번호", de: "Passwort", fr: "Mot de passe", es: "Contraseña")
        case .secureNote: return t(zhCN: "安全笔记", zhTW: "安全筆記", en: "Secure Note", ja: "セキュアノート", ko: "보안 메모", de: "Sichere Notiz", fr: "Note sécurisée", es: "Nota segura")
        case .creditCard: return t(zhCN: "银行卡", zhTW: "銀行卡", en: "Credit Card", ja: "クレジットカード", ko: "카드", de: "Kreditkarte", fr: "Carte bancaire", es: "Tarjeta")
        case .identity: return t(zhCN: "身份信息", zhTW: "身分資訊", en: "Identity", ja: "個人情報", ko: "신원 정보", de: "Identität", fr: "Identité", es: "Identidad")
        case .apiCredential: return t(zhCN: "API 凭证", zhTW: "API 憑證", en: "API Credential", ja: "API 認証", ko: "API 자격 증명", de: "API-Zugangsdaten", fr: "Clé API", es: "Credencial API")
        case .database: return t(zhCN: "数据库", zhTW: "資料庫", en: "Database", ja: "データベース", ko: "데이터베이스", de: "Datenbank", fr: "Base de données", es: "Base de datos")
        case .server: return t(zhCN: "服务器", zhTW: "伺服器", en: "Server", ja: "サーバー", ko: "서버", de: "Server", fr: "Serveur", es: "Servidor")
        case .sshKey: return t(zhCN: "SSH 密钥", zhTW: "SSH 金鑰", en: "SSH Key", ja: "SSH 鍵", ko: "SSH 키", de: "SSH-Schlüssel", fr: "Clé SSH", es: "Clave SSH")
        case .softwareLicense: return t(zhCN: "软件许可", zhTW: "軟體授權", en: "Software License", ja: "ライセンス", ko: "소프트웨어 라이선스", de: "Softwarelizenz", fr: "Licence logicielle", es: "Licencia")
        case .passkey: return t(zhCN: "通行密钥", zhTW: "通行密鑰", en: "Passkey", ja: "パスキー", ko: "패스키", de: "Passkey", fr: "Clé d'accès", es: "Passkey")
        case .bankAccount: return t(zhCN: "银行账户", zhTW: "銀行帳戶", en: "Bank Account", ja: "銀行口座", ko: "은행 계좌", de: "Bankkonto", fr: "Compte bancaire", es: "Cuenta bancaria")
        case .cryptoWallet: return t(zhCN: "加密钱包", zhTW: "加密錢包", en: "Crypto Wallet", ja: "暗号ウォレット", ko: "암호화폐 지갑", de: "Krypto-Wallet", fr: "Portefeuille crypto", es: "Billetera cripto")
        case .wifiRouter: return "Wi-Fi"
        case .passport: return t(zhCN: "护照", zhTW: "護照", en: "Passport", ja: "パスポート", ko: "여권", de: "Reisepass", fr: "Passeport", es: "Pasaporte")
        case .driverLicense: return t(zhCN: "驾驶证", zhTW: "駕照", en: "Driver License", ja: "運転免許証", ko: "운전면허증", de: "Führerschein", fr: "Permis de conduire", es: "Licencia de conducir")
        case .membership: return t(zhCN: "会员卡", zhTW: "會員卡", en: "Membership", ja: "会員証", ko: "멤버십", de: "Mitgliedschaft", fr: "Adhésion", es: "Membresía")
        case .medicalRecord: return t(zhCN: "医疗记录", zhTW: "醫療紀錄", en: "Medical Record", ja: "医療記録", ko: "의료 기록", de: "Krankenakte", fr: "Dossier médical", es: "Registro médico")
        case .document: return t(zhCN: "文档", zhTW: "文件", en: "Document", ja: "ドキュメント", ko: "문서", de: "Dokument", fr: "Document", es: "Documento")
        }
    }

    public func autoLockLabel(_ option: KSAutoLockOption) -> String {
        switch option {
        case .immediate: return t(zhCN: "立即", zhTW: "立即", en: "Immediately", ja: "即時", ko: "즉시", de: "Sofort", fr: "Immédiatement", es: "Inmediatamente")
        case .seconds15: return t(zhCN: "15 秒", zhTW: "15 秒", en: "15 seconds", ja: "15秒", ko: "15초", de: "15 Sek.", fr: "15 s", es: "15 s")
        case .seconds30: return t(zhCN: "30 秒", zhTW: "30 秒", en: "30 seconds", ja: "30秒", ko: "30초", de: "30 Sek.", fr: "30 s", es: "30 s")
        case .minute1: return t(zhCN: "1 分钟", zhTW: "1 分鐘", en: "1 minute", ja: "1分", ko: "1분", de: "1 Min.", fr: "1 min", es: "1 min")
        case .minutes5: return t(zhCN: "5 分钟", zhTW: "5 分鐘", en: "5 minutes", ja: "5分", ko: "5분", de: "5 Min.", fr: "5 min", es: "5 min")
        case .minutes15: return t(zhCN: "15 分钟", zhTW: "15 分鐘", en: "15 minutes", ja: "15分", ko: "15분", de: "15 Min.", fr: "15 min", es: "15 min")
        case .minutes30: return t(zhCN: "30 分钟", zhTW: "30 分鐘", en: "30 minutes", ja: "30分", ko: "30분", de: "30 Min.", fr: "30 min", es: "30 min")
        case .never: return t(zhCN: "永不", zhTW: "永不", en: "Never", ja: "しない", ko: "안 함", de: "Nie", fr: "Jamais", es: "Nunca")
        }
    }

    public func clipboardLabel(_ option: KSClipboardOption) -> String {
        switch option {
        case .seconds10: return t(zhCN: "10 秒", zhTW: "10 秒", en: "10 seconds", ja: "10秒", ko: "10초", de: "10 Sek.", fr: "10 s", es: "10 s")
        case .seconds15: return t(zhCN: "15 秒", zhTW: "15 秒", en: "15 seconds", ja: "15秒", ko: "15초", de: "15 Sek.", fr: "15 s", es: "15 s")
        case .seconds30: return t(zhCN: "30 秒", zhTW: "30 秒", en: "30 seconds", ja: "30秒", ko: "30초", de: "30 Sek.", fr: "30 s", es: "30 s")
        case .seconds60: return t(zhCN: "60 秒", zhTW: "60 秒", en: "60 seconds", ja: "60秒", ko: "60초", de: "60 Sek.", fr: "60 s", es: "60 s")
        case .minutes2: return t(zhCN: "2 分钟", zhTW: "2 分鐘", en: "2 minutes", ja: "2分", ko: "2분", de: "2 Min.", fr: "2 min", es: "2 min")
        case .never: return t(zhCN: "永不", zhTW: "永不", en: "Never", ja: "しない", ko: "안 함", de: "Nie", fr: "Jamais", es: "Nunca")
        }
    }
}
