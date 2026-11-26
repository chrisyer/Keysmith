use crate::domain::{expand_equivalent_domains, extract_domain, ItemCategory, ItemDetail, Vault};

const PINYIN_TOKENS: &[(&str, &str)] = &[
    ("个人", "gr geren"),
    ("工作", "gz gongzuo"),
    ("基础设施", "jcss jichusheshi"),
    ("开发", "kf kaifa"),
    ("生产", "sc shengchan"),
    ("常用", "cy changyong"),
    ("云服务", "yfw yunfuwu"),
    ("数据库", "sjk shujuku"),
    ("银行卡", "yhk yinhangka"),
    ("信用卡", "xyk xinyongka"),
    ("招商银行", "zsyh zhaoshangyinhang"),
    ("服务器", "fwq fuwuqi"),
    ("身份", "sf shenfen"),
    ("证件", "zj zhengjian"),
    ("安全笔记", "aqbj anquanbiji"),
    ("通行密钥", "txmy tongxingmiyao passkey fido2"),
    ("硬件密钥", "yjmy yingjianmiyao"),
    ("合作伙伴", "hzhb hezuohuoban"),
    ("内网", "nw neiwang"),
    ("测试", "cs ceshi"),
    ("代码签名", "dmqm daimaqianming"),
];

fn map_category_alias(alias: &str) -> Option<ItemCategory> {
    match alias {
        "login" | "dl" | "登录" => Some(ItemCategory::Login),
        "password" | "mm" | "密码" => Some(ItemCategory::Password),
        "note" | "secure_note" | "bj" | "笔记" => Some(ItemCategory::SecureNote),
        "card" | "credit_card" | "yhk" | "银行卡" => Some(ItemCategory::CreditCard),
        "identity" | "sf" | "身份" => Some(ItemCategory::Identity),
        "api" | "api_credential" => Some(ItemCategory::ApiCredential),
        "db" | "database" | "sjk" | "数据库" => Some(ItemCategory::Database),
        "server" | "fwq" | "服务器" => Some(ItemCategory::Server),
        "ssh" | "ssh_key" => Some(ItemCategory::SshKey),
        "license" | "software_license" => Some(ItemCategory::SoftwareLicense),
        "passkey" | "txmy" | "通行密钥" => Some(ItemCategory::Passkey),
        "bank" | "bank_account" | "银行账户" => Some(ItemCategory::BankAccount),
        "wallet" | "crypto" | "crypto_wallet" | "钱包" | "加密钱包" => {
            Some(ItemCategory::CryptoWallet)
        }
        "wifi" | "wifi_router" | "路由器" => Some(ItemCategory::WifiRouter),
        "passport" | "护照" => Some(ItemCategory::Passport),
        "driver" | "driver_license" | "驾照" => Some(ItemCategory::DriverLicense),
        "membership" | "会员" => Some(ItemCategory::Membership),
        "medical" | "medical_record" | "医疗" => Some(ItemCategory::MedicalRecord),
        "doc" | "document" | "文档" => Some(ItemCategory::Document),
        _ => None,
    }
}

#[derive(Debug, Default, Clone)]
pub struct ParsedSearchQuery {
    pub tags: Vec<String>,
    pub vaults: Vec<String>,
    pub categories: Vec<ItemCategory>,
    pub sso_providers: Vec<String>,
    pub favorite_only: bool,
    pub passkey_only: bool,
    pub linked_only: bool,
    pub free_terms: Vec<String>,
}

pub fn parse_search_query(raw_query: &str) -> ParsedSearchQuery {
    let mut result = ParsedSearchQuery::default();
    for token in raw_query.split_whitespace() {
        let lower = token.to_lowercase();
        if let Some(tag) = lower.strip_prefix("tag:") {
            if !tag.is_empty() {
                result.tags.push(tag.to_string());
                continue;
            }
        }
        if let Some(vault) = lower.strip_prefix("vault:") {
            if !vault.is_empty() {
                result.vaults.push(vault.to_string());
                continue;
            }
        }
        if let Some(cat) = lower.strip_prefix("cat:") {
            if !cat.is_empty() {
                if let Some(mapped) = map_category_alias(cat) {
                    result.categories.push(mapped);
                }
                continue;
            }
        }
        if let Some(sso) = lower.strip_prefix("sso:") {
            if !sso.is_empty() {
                result.sso_providers.push(sso.to_string());
                continue;
            }
        }
        if lower == "is:favorite" || lower == "is:fav" {
            result.favorite_only = true;
            continue;
        }
        if lower == "is:passkey" {
            result.passkey_only = true;
            continue;
        }
        if lower == "is:sso" {
            result.sso_providers.push("*".to_string());
            continue;
        }
        if lower == "is:linked" {
            result.linked_only = true;
            continue;
        }
        result.free_terms.push(lower);
    }
    result
}

fn category_slug(c: ItemCategory) -> &'static str {
    match c {
        ItemCategory::Login => "login",
        ItemCategory::Password => "password",
        ItemCategory::SecureNote => "secure_note",
        ItemCategory::CreditCard => "credit_card",
        ItemCategory::Identity => "identity",
        ItemCategory::ApiCredential => "api_credential",
        ItemCategory::Database => "database",
        ItemCategory::Server => "server",
        ItemCategory::SshKey => "ssh_key",
        ItemCategory::SoftwareLicense => "software_license",
        ItemCategory::Passkey => "passkey",
        ItemCategory::BankAccount => "bank_account",
        ItemCategory::CryptoWallet => "crypto_wallet",
        ItemCategory::WifiRouter => "wifi_router",
        ItemCategory::Passport => "passport",
        ItemCategory::DriverLicense => "driver_license",
        ItemCategory::Membership => "membership",
        ItemCategory::MedicalRecord => "medical_record",
        ItemCategory::Document => "document",
    }
}

fn expand_pinyin(text: &str) -> String {
    let mut hits: Vec<(usize, &str, &str)> = Vec::new();
    for (zh, py) in PINYIN_TOKENS {
        if let Some(pos) = text.find(zh) {
            let short = py.split_whitespace().next().unwrap_or(py);
            hits.push((pos, short, *py));
        }
    }
    hits.sort_by_key(|(pos, _, _)| *pos);

    let mut combined_initials = String::new();
    let mut out = String::new();
    for (_, short, full) in hits {
        combined_initials.push_str(short);
        out.push(' ');
        out.push_str(full);
    }
    if !combined_initials.is_empty() {
        out.push(' ');
        out.push_str(&combined_initials);
    }
    out
}

/// Replace `local@domain.tld` tokens with `local` so ordinary queries like `google`
/// do not falsely match unrelated items merely using `@googlemail.com` or `@google.com`.
fn strip_email_domains(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for (i, token) in text.split_whitespace().enumerate() {
        if i > 0 {
            out.push(' ');
        }
        if let Some(at_idx) = token.find('@') {
            let after = &token[at_idx + 1..];
            if !after.is_empty() && after.contains('.') {
                out.push_str(&token[..at_idx]);
                continue;
            }
        }
        out.push_str(token);
    }
    out
}

pub fn score_search_query(item: &ItemDetail, vaults: &[Vault], raw_query: &str) -> Option<u32> {
    if raw_query.trim().is_empty() {
        return Some(0);
    }
    let parsed = parse_search_query(raw_query);
    let vault = vaults.iter().find(|v| v.id == item.vault_id);
    let vault_name_raw = vault.map(|v| v.name.as_str()).unwrap_or("");
    let vault_name_lower = vault_name_raw.to_lowercase();

    if parsed.favorite_only && !item.favorite {
        return None;
    }

    if parsed.passkey_only
        && item.payload.passkeys.is_empty()
        && item.payload.category != ItemCategory::Passkey
    {
        return None;
    }

    if parsed.linked_only && item.payload.linked_item_ids.is_empty() {
        return None;
    }

    for tag in &parsed.tags {
        if !item
            .payload
            .tags
            .iter()
            .any(|t| t.to_lowercase().contains(tag))
        {
            return None;
        }
    }

    let vault_pinyin = expand_pinyin(vault_name_raw);
    for v in &parsed.vaults {
        if !vault_name_lower.contains(v) && !vault_pinyin.contains(v) {
            return None;
        }
    }

    if !parsed.categories.is_empty() && !parsed.categories.contains(&item.payload.category) {
        return None;
    }

    if !parsed.sso_providers.is_empty() {
        let item_sso = item
            .payload
            .sso_provider
            .as_deref()
            .unwrap_or("")
            .to_lowercase();
        if item_sso.is_empty() {
            return None;
        }
        for sso_filter in &parsed.sso_providers {
            if sso_filter != "*" && !item_sso.contains(sso_filter) {
                return None;
            }
        }
    }

    if parsed.free_terms.is_empty() {
        return Some(100);
    }

    let title_lower = item.title.to_lowercase();
    let title_with_pinyin = format!("{title_lower}{}", expand_pinyin(&item.title));

    let url_hosts_lower: Vec<String> = item
        .payload
        .urls
        .iter()
        .map(|u| extract_domain(&u.uri).to_lowercase())
        .filter(|h| !h.is_empty())
        .collect();
    let equiv_hosts_lower: Vec<String> = url_hosts_lower
        .iter()
        .flat_map(|h| expand_equivalent_domains(h, &[]))
        .collect();
    let sso_lower = item
        .payload
        .sso_provider
        .as_deref()
        .unwrap_or("")
        .to_lowercase();
    let full_urls_lower: Vec<String> = item
        .payload
        .urls
        .iter()
        .map(|u| u.uri.to_lowercase())
        .filter(|u| !u.is_empty())
        .collect();
    let passkey_rps_lower: Vec<String> = item
        .payload
        .passkeys
        .iter()
        .flat_map(|p| [p.rp_id.to_lowercase(), p.rp_name.to_lowercase()])
        .filter(|s| !s.is_empty())
        .collect();
    let tags_lower: Vec<String> = item
        .payload
        .tags
        .iter()
        .map(|t| t.to_lowercase())
        .collect();

    let raw_secondary = {
        let mut parts = Vec::new();
        if let Some(sub) = &item.payload.subtitle {
            if !sub.is_empty() {
                parts.push(sub.clone());
            }
        }
        for sec in &item.payload.sections {
            for f in &sec.fields {
                if !f.sensitive && !f.value.trim().is_empty() {
                    parts.push(f.value.clone());
                }
            }
        }
        for pk in &item.payload.passkeys {
            if !pk.user_name.is_empty() {
                parts.push(pk.user_name.clone());
            }
        }
        parts.join(" ").to_lowercase()
    };
    let secondary_stripped = strip_email_domains(&raw_secondary);

    let notes_lower = item.payload.notes.to_lowercase();
    let notes_stripped = strip_email_domains(&notes_lower);
    let vault_corpus = format!(
        "{vault_name_lower}{vault_pinyin} {}",
        category_slug(item.payload.category)
    );

    let mut total_score = 0u32;

    for term in &parsed.free_terms {
        let mut best_term_score = 0u32;

        if title_lower == *term {
            best_term_score = best_term_score.max(1000);
        } else if title_lower.starts_with(term) {
            best_term_score = best_term_score.max(800);
        } else if title_with_pinyin.contains(term) {
            best_term_score = best_term_score.max(650);
        }

        if url_hosts_lower.iter().any(|h| h.contains(term))
            || passkey_rps_lower.iter().any(|rp| rp.contains(term))
        {
            best_term_score = best_term_score.max(550);
        } else if term.len() >= 3 && equiv_hosts_lower.iter().any(|eq| eq.contains(term)) {
            best_term_score = best_term_score.max(460);
        }

        if !sso_lower.is_empty() && sso_lower.contains(term) {
            best_term_score = best_term_score.max(420);
        }

        if full_urls_lower.iter().any(|u| u.contains(term))
            || tags_lower.iter().any(|t| t.contains(term))
        {
            best_term_score = best_term_score.max(400);
        }

        let allow_email_domain = term.contains('@');
        let sec_haystack = if allow_email_domain {
            &raw_secondary
        } else {
            &secondary_stripped
        };
        if sec_haystack.contains(term) {
            best_term_score = best_term_score.max(300);
        }

        let notes_haystack = if allow_email_domain {
            &notes_lower
        } else {
            &notes_stripped
        };
        if notes_haystack.contains(term) || vault_corpus.contains(term) {
            best_term_score = best_term_score.max(180);
        }

        if best_term_score == 0 {
            return None;
        }
        total_score = total_score.saturating_add(best_term_score);
    }

    Some(total_score)
}

pub fn matches_search_query(item: &ItemDetail, vaults: &[Vault], raw_query: &str) -> bool {
    score_search_query(item, vaults, raw_query).is_some()
}
