import Foundation

public enum DemoSeedData {
    public static let demoAccount = KSAccountSummary(
        id: "demo-account-cherry",
        email: "cherry@example.com",
        displayName: "Cherry Wang",
        serverUrl: "https://vault.example.com",
        isActive: true,
        kdfType: "Argon2id",
        lastSyncAt: "2026-11-27T14:33:00Z"
    )

    public static let vaults: [KSVault] = [
        KSVault(id: "vault-personal", name: "个人", icon: "person.fill", color: "#0572EC", isDefault: true, travelSafe: true, itemCount: 2),
        KSVault(id: "vault-work", name: "工作", icon: "briefcase.fill", color: "#0D9488", isDefault: false, travelSafe: true, itemCount: 4),
        KSVault(id: "vault-infra", name: "基础设施", icon: "server.rack", color: "#7C3AED", isDefault: false, travelSafe: false, itemCount: 2),
    ]

    public static let itemDetails: [KSItemDetail] = [
        KSItemDetail(
            id: "gh-main",
            vaultId: "vault-work",
            title: "GitHub Main",
            favorite: true,
            category: .login,
            subtitle: "dev@keysmith.app",
            icon: .preset(name: "GH", color: "#24292E"),
            tags: ["开发", "常用"],
            urls: [KSItemUrl(id: "u-gh-1", uri: "https://github.com/login", label: "GitHub", matchRule: .domain)],
            sections: [
                KSItemSection(
                    id: "sec-gh-1",
                    title: "",
                    fields: [
                        KSItemField(id: "f-gh-u", label: "用户名", fieldType: .text, value: "dev@keysmith.app", sensitive: false, purpose: .username),
                        KSItemField(id: "f-gh-p", label: "密码", fieldType: .password, value: "K9#mV4!xP2@qL8$zR5", sensitive: true, purpose: .password),
                        KSItemField(id: "f-gh-t", label: "一次性验证码", fieldType: .totp, value: "otpauth://totp/GitHub:dev@keysmith.app?secret=JBSWY3DPEHPK3PXP&issuer=GitHub", sensitive: true, purpose: .totp),
                    ]
                )
            ],
            passkeys: [
                KSPasskeyCredential(
                    credentialId: "Z2l0aHViLW1haW4tY3JlZC0wMQ",
                    rpId: "github.com",
                    rpName: "GitHub",
                    userHandle: "ZGV2LWtleXNtaXRoLTAx",
                    userName: "dev@keysmith.app",
                    userDisplayName: "Cherry Wang",
                    algorithm: -7,
                    publicKeySpki: "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEDemoGitHubPublicKey",
                    signCount: 42,
                    createdAt: "2026-10-14T09:00:00Z"
                )
            ],
            notes: "主开发账号 · 已开启 2FA 与 Passkey",
            createdAt: "2026-01-12T08:00:00Z",
            updatedAt: "2026-11-26T14:20:00Z"
        ),
        KSItemDetail(
            id: "aws-prod",
            vaultId: "vault-infra",
            title: "AWS Production",
            favorite: true,
            category: .login,
            subtitle: "ops-root@keysmith.app",
            icon: .preset(name: "AW", color: "#D97706"),
            tags: ["云服务", "生产"],
            urls: [KSItemUrl(id: "u-aws-1", uri: "https://console.aws.amazon.com", label: "Console", matchRule: .domain)],
            sections: [
                KSItemSection(
                    id: "sec-aws-1",
                    title: "",
                    fields: [
                        KSItemField(id: "f-aws-u", label: "用户名", fieldType: .email, value: "ops-root@keysmith.app", sensitive: false, purpose: .username),
                        KSItemField(id: "f-aws-p", label: "密码", fieldType: .password, value: "A7!wQ9#rT3%vY6&mN2", sensitive: true, purpose: .password),
                        KSItemField(id: "f-aws-t", label: "MFA 验证码", fieldType: .totp, value: "otpauth://totp/AWS:ops-root?secret=NB2W45DFOIZA&issuer=AWS", sensitive: true, purpose: .totp),
                    ]
                )
            ],
            notes: "需 Face ID 二次验证（reprompt = true）",
            reprompt: true,
            createdAt: "2026-02-05T10:00:00Z",
            updatedAt: "2026-11-25T16:10:00Z"
        ),
        KSItemDetail(
            id: "apple-dev",
            vaultId: "vault-work",
            title: "Apple Developer",
            favorite: true,
            category: .passkey,
            subtitle: "chrisyer@icloud.com",
            icon: .preset(name: "", color: "#0572EC"),
            tags: ["签名", "常用"],
            urls: [KSItemUrl(id: "u-apple-1", uri: "https://developer.apple.com", label: "Developer", matchRule: .domain)],
            sections: [
                KSItemSection(
                    id: "sec-apple-1",
                    title: "",
                    fields: [
                        KSItemField(id: "f-apple-u", label: "Apple ID", fieldType: .email, value: "chrisyer@icloud.com", sensitive: false, purpose: .username),
                        KSItemField(id: "f-apple-p", label: "密码", fieldType: .password, value: "D4$pL8@nC2*vZ7!xK9", sensitive: true, purpose: .password),
                    ]
                )
            ],
            passkeys: [
                KSPasskeyCredential(
                    credentialId: "YXBwbGUtZGV2LWNyZWQtMDI",
                    rpId: "apple.com",
                    rpName: "Apple",
                    userHandle: "Y2hyaXN5ZXItYXBwbGUtMDI",
                    userName: "chrisyer@icloud.com",
                    userDisplayName: "Cherry Wang",
                    algorithm: -7,
                    publicKeySpki: "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEDemoApplePublicKey",
                    signCount: 11,
                    createdAt: "2026-11-18T11:00:00Z"
                )
            ],
            notes: "App Groups & AutoFill 签发账号",
            createdAt: "2026-03-19T09:30:00Z",
            updatedAt: "2026-11-24T12:00:00Z"
        ),
        KSItemDetail(
            id: "cf-prod",
            vaultId: "vault-infra",
            title: "Cloudflare Zero Trust",
            favorite: true,
            category: .login,
            subtitle: "infra@keysmith.app",
            icon: .preset(name: "CF", color: "#EA580C"),
            tags: ["DNS", "生产"],
            urls: [KSItemUrl(id: "u-cf-1", uri: "https://dash.cloudflare.com", label: "Dashboard", matchRule: .domain)],
            sections: [
                KSItemSection(
                    id: "sec-cf-1",
                    title: "",
                    fields: [
                        KSItemField(id: "f-cf-u", label: "用户名", fieldType: .email, value: "infra@keysmith.app", sensitive: false, purpose: .username),
                        KSItemField(id: "f-cf-p", label: "密码", fieldType: .password, value: "C8!pR2#nL9@vT5$wB3", sensitive: true, purpose: .password),
                        KSItemField(id: "f-cf-t", label: "一次性验证码", fieldType: .totp, value: "otpauth://totp/Cloudflare:infra?secret=MFRGGZDFMZTWQ2LK&issuer=Cloudflare", sensitive: true, purpose: .totp),
                    ]
                )
            ],
            notes: "DNS 与 Pages 部署凭证",
            createdAt: "2026-04-02T14:00:00Z",
            updatedAt: "2026-11-23T09:45:00Z"
        ),
        KSItemDetail(
            id: "linear-ws",
            vaultId: "vault-work",
            title: "Linear Workspace",
            favorite: true,
            category: .login,
            subtitle: "cherry@keysmith.app",
            icon: .preset(name: "LN", color: "#4F46E5"),
            tags: ["协作"],
            urls: [KSItemUrl(id: "u-ln-1", uri: "https://linear.app", label: "Linear", matchRule: .domain)],
            sections: [
                KSItemSection(
                    id: "sec-ln-1",
                    title: "",
                    fields: [
                        KSItemField(id: "f-ln-u", label: "邮箱", fieldType: .email, value: "cherry@keysmith.app", sensitive: false, purpose: .username),
                        KSItemField(id: "f-ln-p", label: "密码", fieldType: .password, value: "L5@qM9!xB3#tN7$kW4", sensitive: true, purpose: .password),
                    ]
                )
            ],
            notes: "产品路线图与任务追踪",
            createdAt: "2026-05-11T10:15:00Z",
            updatedAt: "2026-11-22T18:00:00Z"
        ),
        KSItemDetail(
            id: "stripe-pay",
            vaultId: "vault-work",
            title: "Stripe Dashboard",
            favorite: true,
            category: .login,
            subtitle: "billing@keysmith.app",
            icon: .preset(name: "ST", color: "#635BFF"),
            tags: ["支付"],
            urls: [KSItemUrl(id: "u-st-1", uri: "https://dashboard.stripe.com", label: "Stripe", matchRule: .domain)],
            sections: [
                KSItemSection(
                    id: "sec-st-1",
                    title: "",
                    fields: [
                        KSItemField(id: "f-st-u", label: "邮箱", fieldType: .email, value: "billing@keysmith.app", sensitive: false, purpose: .username),
                        KSItemField(id: "f-st-p", label: "密码", fieldType: .password, value: "S3#vZ8!kP6@wN4$rQ9", sensitive: true, purpose: .password),
                    ]
                )
            ],
            notes: "结算与 Webhook 密钥管理",
            reprompt: true,
            createdAt: "2026-06-08T11:20:00Z",
            updatedAt: "2026-11-21T15:30:00Z"
        ),
        KSItemDetail(
            id: "cmb-card",
            vaultId: "vault-personal",
            title: "招商银行白金卡",
            favorite: false,
            category: .creditCard,
            subtitle: "•••• 8842 · 09/29",
            icon: .preset(name: "💳", color: "#E11D48"),
            tags: ["金融", "旅行保留"],
            urls: [],
            sections: [
                KSItemSection(
                    id: "sec-cmb-1",
                    title: "卡片信息",
                    fields: [
                        KSItemField(id: "f-cmb-h", label: "持卡人姓名", fieldType: .text, value: "CHERRY WANG", sensitive: false),
                        KSItemField(id: "f-cmb-n", label: "卡号", fieldType: .number, value: "6225 8810 0421 8842", sensitive: true, purpose: .cardNumber),
                        KSItemField(id: "f-cmb-e", label: "有效期", fieldType: .monthYear, value: "2029-09", sensitive: false, purpose: .cardExpiry),
                        KSItemField(id: "f-cmb-c", label: "安全码 (CVV)", fieldType: .password, value: "739", sensitive: true, purpose: .cardCvv),
                    ]
                )
            ],
            notes: "支持 iOS 26 ProvidesTextToInsert 任意页快捷插入",
            reprompt: true,
            createdAt: "2026-07-15T13:00:00Z",
            updatedAt: "2026-11-20T10:15:00Z"
        ),
        KSItemDetail(
            id: "bastion-ssh",
            vaultId: "vault-personal",
            title: "Prod Bastion SSH",
            favorite: false,
            category: .sshKey,
            subtitle: "SHA256:9qF4xN7kL8w2+eR",
            icon: .preset(name: "⌘", color: "#0D9488"),
            tags: ["运维"],
            urls: [KSItemUrl(id: "u-ssh-1", uri: "ssh://bastion.keysmith.internal", label: "Bastion", matchRule: .host)],
            sections: [
                KSItemSection(
                    id: "sec-ssh-1",
                    title: "Ed25519 密钥",
                    fields: [
                        KSItemField(id: "f-ssh-pub", label: "公钥", fieldType: .sshPublicKey, value: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKeysmithDemo", sensitive: false),
                        KSItemField(id: "f-ssh-priv", label: "私钥", fieldType: .sshPrivateKey, value: "-----BEGIN OPENSSH PRIVATE KEY-----\nDEMO-KEY-MATERIAL\n-----END OPENSSH PRIVATE KEY-----", sensitive: true),
                        KSItemField(id: "f-ssh-fp", label: "指纹", fieldType: .text, value: "SHA256:9qF4xN7kL8w2+eR", sensitive: false),
                    ]
                )
            ],
            notes: "默认关闭 SSH Agent，启用前需手动确认",
            reprompt: true,
            createdAt: "2026-08-22T17:00:00Z",
            updatedAt: "2026-11-19T21:00:00Z"
        ),
    ]

    public static func summaries(from details: [KSItemDetail]) -> [KSItemSummary] {
        details.map { detail in
            var issues: [KSWatchtowerIssue] = []
            if detail.category == .login && detail.primaryTotp == nil && detail.passkeys.isEmpty {
                issues.append(.missing2fa)
            }
            return KSItemSummary(
                id: detail.id,
                vaultId: detail.vaultId,
                title: detail.title,
                subtitle: detail.subtitle ?? detail.primaryUsername ?? "",
                category: detail.category,
                icon: detail.icon,
                tags: detail.tags,
                favorite: detail.favorite,
                hasTotp: detail.primaryTotp != nil,
                hasPasskey: !detail.passkeys.isEmpty,
                primaryUrl: detail.urls.first?.uri,
                username: detail.primaryUsername,
                hasPassword: detail.primaryPassword != nil,
                archived: detail.archived,
                reprompt: detail.reprompt,
                ssoProvider: detail.ssoProvider,
                linkedItemCount: detail.linkedItemIds.count,
                attachmentCount: detail.attachments.count,
                deletedAt: detail.deletedAt,
                updatedAt: detail.updatedAt,
                issues: issues
            )
        }
    }

    public static let demoWatchtowerReport = KSWatchtowerReport(
        score: 92,
        totalAudited: 8,
        totalRiskItems: 2,
        counts: [
            KSWatchtowerIssue.weak.rawValue: 0,
            KSWatchtowerIssue.reused.rawValue: 0,
            KSWatchtowerIssue.missing2fa.rawValue: 2,
            KSWatchtowerIssue.unsecuredUrl.rawValue: 0,
            KSWatchtowerIssue.expiring.rawValue: 0,
            KSWatchtowerIssue.breached.rawValue: 0,
            KSWatchtowerIssue.passkeyAvailable.rawValue: 1,
        ],
        itemIdsByIssue: [
            KSWatchtowerIssue.missing2fa.rawValue: ["linear-ws", "stripe-pay"],
            KSWatchtowerIssue.passkeyAvailable.rawValue: ["cf-prod"],
        ],
        itemIssues: [
            "linear-ws": [.missing2fa],
            "stripe-pay": [.missing2fa],
            "cf-prod": [.passkeyAvailable],
        ],
        hibpChecked: true,
        hibpCheckedAt: "2026-11-27T14:30:00Z"
    )

    public static let demoSends: [KSSendItem] = [
        KSSendItem(
            id: "send-demo-1",
            accessId: "acc-demo-1",
            sendType: .text,
            name: "Staging API Token (临时)",
            notes: "仅限联调使用",
            text: "ks_staging_98a7f6e5d4c3b2a1",
            hidden: true,
            shareUrl: "https://vault.example.com/#/send/acc-demo-1/demo-key",
            maxAccessCount: 3,
            accessCount: 1,
            expirationDate: "2026-12-01T00:00:00Z",
            deletionDate: "2026-12-07T00:00:00Z",
            revisionDate: "2026-11-27T10:00:00Z",
            disabled: false,
            hideEmail: true,
            hasPassword: true
        ),
        KSSendItem(
            id: "send-demo-2",
            accessId: "acc-demo-2",
            sendType: .text,
            name: "VPN 临时接入说明",
            text: "Endpoint: vpn.keysmith.internal:51820",
            hidden: false,
            shareUrl: "https://vault.example.com/#/send/acc-demo-2/demo-key",
            maxAccessCount: nil,
            accessCount: 2,
            expirationDate: nil,
            deletionDate: "2026-12-10T00:00:00Z",
            revisionDate: "2026-11-26T09:00:00Z",
            disabled: false,
            hideEmail: false,
            hasPassword: false
        ),
    ]

    public static let demoSnapshots: [KSLocalSnapshotInfo] = [
        KSLocalSnapshotInfo(
            id: "snap-1",
            fileName: "keysmith-snapshot-2026-11-27.ksbak",
            createdAt: "2026-11-27T04:00:00Z",
            sizeBytes: 48_320,
            itemCount: 8,
            vaultCount: 3
        )
    ]
}
