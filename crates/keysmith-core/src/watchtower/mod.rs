use std::collections::{HashMap, HashSet};

use chrono::{Duration, NaiveDate, Utc};
use rand::{rngs::OsRng, RngCore};
use sha1::{Digest, Sha1};

use crate::domain::{
    extract_domain, FieldPurpose, FieldType, ItemCategory, ItemDetail, WatchtowerIssueType,
    WatchtowerReport,
};
use crate::error::CoreError;
use crate::generator::evaluate_password_strength;
use crate::protocol::VaultwardenClient;

/// Curated 150+ popular websites & developer services known to support 2FA (TOTP/WebAuthn).
pub const TWO_FACTOR_CAPABLE_DOMAINS: &[&str] = &[
    "github.com", "gitlab.com", "bitbucket.org", "npmjs.com", "pypi.org", "crates.io",
    "docker.com", "hub.docker.com", "vercel.com", "netlify.com", "cloudflare.com", "dash.cloudflare.com",
    "aws.amazon.com", "console.aws.amazon.com", "cloud.google.com", "portal.azure.com", "digitalocean.com",
    "linode.com", "vultr.com", "hetzner.com", "fly.io", "render.com", "railway.app", "supabase.com",
    "planetscale.com", "neon.tech", "mongodb.com", "cockroachlabs.com", "datadoghq.com", "sentry.io",
    "grafana.com", "pagerduty.com", "snyk.io", "1password.com", "bitwarden.com", "proton.me", "protonmail.com",
    "tuta.com", "fastmail.com", "google.com", "accounts.google.com", "apple.com", "appleid.apple.com",
    "icloud.com", "microsoft.com", "login.live.com", "login.microsoftonline.com", "yahoo.com", "aol.com",
    "zoho.com", "dropbox.com", "box.com", "mega.nz", "sync.com", "nextcloud.com", "notion.so", "figma.com",
    "linear.app", "slack.com", "discord.com", "zoom.us", "teams.microsoft.com", "webex.com", "atlassian.com",
    "id.atlassian.com", "trello.com", "asana.com", "monday.com", "clickup.com", "airtable.com", "miro.com",
    "canva.com", "adobe.com", "autodesk.com", "jetbrains.com", "openai.com", "platform.openai.com",
    "anthropic.com", "console.anthropic.com", "huggingface.co", "kaggle.com", "wandb.ai", "replicate.com",
    "stripe.com", "dashboard.stripe.com", "paypal.com", "wise.com", "revolut.com", "chase.com",
    "bankofamerica.com", "wellsfargo.com", "citi.com", "capitalone.com", "americanexpress.com",
    "fidelity.com", "schwab.com", "vanguard.com", "robinhood.com", "coinbase.com", "kraken.com",
    "binance.com", "okx.com", "bybit.com", "ledger.com", "amazon.com", "amazon.co.uk", "amazon.de",
    "amazon.co.jp", "ebay.com", "etsy.com", "shopify.com", "aliexpress.com", "walmart.com", "target.com",
    "bestbuy.com", "newegg.com", "steam.com", "store.steampowered.com", "epicgames.com", "ea.com",
    "ubisoft.com", "playstation.com", "xbox.com", "nintendo.com", "twitch.tv", "youtube.com", "netflix.com",
    "spotify.com", "hulu.com", "disneyplus.com", "x.com", "twitter.com", "facebook.com", "instagram.com",
    "threads.net", "linkedin.com", "reddit.com", "pinterest.com", "tumblr.com", "tiktok.com", "snapchat.com",
    "telegram.org", "signal.org", "whatsapp.com", "namecheap.com", "godaddy.com", "porkbun.com",
    "gandi.net", "dnsimple.com", "tailscale.com", "zerotier.com", "ngrok.com", "twilio.com", "sendgrid.com",
    "mailgun.com", "postmarkapp.com", "resend.com", "heroku.com", "backblaze.com", "wasabi.com",
    "fastly.com", "akamai.com", "oracle.com", "ibm.com", "salesforce.com", "hubspot.com", "zendesk.com",
    "intercom.com", "okta.com", "auth0.com", "duo.com", "aliyun.com", "cloud.tencent.com", "huawei.com",
    "baidu.com", "qq.com", "weixin.qq.com", "weibo.com", "bilibili.com", "zhihu.com", "jd.com", "taobao.com",
    "alipay.com", "feishu.cn", "dingtalk.com", "gitee.com", "coding.net",
];

pub fn is_known_2fa_domain(uri: &str) -> bool {
    let host = extract_domain(uri).to_ascii_lowercase();
    if host.is_empty() {
        return false;
    }
    TWO_FACTOR_CAPABLE_DOMAINS
        .iter()
        .any(|d| host == *d || host.ends_with(&format!(".{d}")))
}

/// Curated directory of popular websites & developer platforms supporting WebAuthn Passkeys.
pub const PASSKEY_CAPABLE_DOMAINS: &[&str] = &[
    "github.com", "gitlab.com", "google.com", "accounts.google.com", "youtube.com", "gmail.com",
    "apple.com", "icloud.com", "microsoft.com", "live.com", "outlook.com", "office.com",
    "amazon.com", "aws.amazon.com", "amazon.co.jp", "amazon.co.uk", "amazon.de",
    "paypal.com", "ebay.com", "shopify.com", "stripe.com", "cloudflare.com", "vercel.com",
    "netlify.com", "supabase.com", "tailscale.com", "1password.com", "bitwarden.com",
    "proton.me", "fastmail.com", "dropbox.com", "box.com", "notion.so", "figma.com",
    "linear.app", "discord.com", "slack.com", "atlassian.com", "x.com", "twitter.com",
    "tiktok.com", "whatsapp.com", "linkedin.com", "uber.com", "airbnb.com", "booking.com",
    "kayak.com", "binance.com", "coinbase.com", "kraken.com", "okx.com", "bybit.com",
    "robinhood.com", "wise.com", "revolut.com", "playstation.com", "sony.com", "nintendo.com",
    "bestbuy.com", "target.com", "walmart.com", "homedepot.com", "cvs.com", "adobe.com",
    "docusign.com", "intuit.com", "okta.com", "auth0.com", "openai.com", "anthropic.com",
    "huggingface.co", "npmjs.com", "pypi.org", "yahoo.com", "zoho.com", "alipay.com",
    "taobao.com", "dingtalk.com", "feishu.cn", "larksuite.com",
];

pub fn is_known_passkey_domain(uri: &str) -> bool {
    let host = extract_domain(uri).to_ascii_lowercase();
    if host.is_empty() {
        return false;
    }
    PASSKEY_CAPABLE_DOMAINS
        .iter()
        .any(|d| host == *d || host.ends_with(&format!(".{d}")))
}

fn is_local_or_intranet_host(uri: &str) -> bool {
    let Ok(parsed) = url::Url::parse(uri) else {
        return false;
    };
    let Some(host) = parsed.host_str() else {
        return false;
    };
    let host = host.to_ascii_lowercase();
    if host == "localhost" || host == "127.0.0.1" || host == "::1" || host.ends_with(".local") {
        return true;
    }
    if host.starts_with("10.") || host.starts_with("192.168.") {
        return true;
    }
    if let Some(rest) = host.strip_prefix("172.") {
        if let Some((second_str, _)) = rest.split_once('.') {
            if let Ok(second) = second_str.parse::<u8>() {
                if (16..=31).contains(&second) {
                    return true;
                }
            }
        }
    }
    false
}

fn last_day_of_year_month(year: i32, month: u32) -> Option<NaiveDate> {
    if !(1..=12).contains(&month) || !(1970..=2200).contains(&year) {
        return None;
    }
    let next_month = if month == 12 {
        NaiveDate::from_ymd_opt(year + 1, 1, 1)
    } else {
        NaiveDate::from_ymd_opt(year, month + 1, 1)
    };
    next_month.and_then(|d| d.pred_opt())
}

fn is_expiring_or_expired(value: &str, now: NaiveDate) -> bool {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return false;
    }
    let threshold = now + Duration::days(35);

    // YYYY-MM or YYYY/MM
    if trimmed.len() == 7 && matches!(trimmed.as_bytes()[4], b'-' | b'/') {
        if let (Ok(y), Ok(m)) = (trimmed[..4].parse::<i32>(), trimmed[5..7].parse::<u32>()) {
            if let Some(last_day) = last_day_of_year_month(y, m) {
                return last_day <= threshold;
            }
        }
    }

    // MM/YY or MM-YY or MM/YYYY or MM-YYYY
    if let Some((left, right)) = trimmed.split_once('/').or_else(|| trimmed.split_once('-')) {
        let l = left.trim();
        let r = right.trim();
        if (1..=2).contains(&l.len()) && (r.len() == 2 || r.len() == 4) {
            if let (Ok(m), Ok(raw_y)) = (l.parse::<u32>(), r.parse::<i32>()) {
                let full_y = if r.len() == 2 { 2000 + raw_y } else { raw_y };
                if let Some(last_day) = last_day_of_year_month(full_y, m) {
                    return last_day <= threshold;
                }
            }
        }
    }

    if trimmed.len() >= 10 {
        let head = &trimmed[..10];
        if let Ok(d) = NaiveDate::parse_from_str(head, "%Y-%m-%d")
            .or_else(|_| NaiveDate::parse_from_str(head, "%Y/%m/%d"))
        {
            return d <= threshold;
        }
    }

    false
}

fn is_expiry_label(label: &str) -> bool {
    let lower = label.to_lowercase();
    label.contains("到期")
        || label.contains("过期")
        || label.contains("有效期")
        || lower.contains("expiry")
        || lower.contains("expire")
        || lower.contains("expiration")
        || lower.contains("valid thru")
        || lower.contains("valid until")
}

pub fn sha1_upper_hex(secret: &str) -> String {
    let digest = Sha1::digest(secret.as_bytes());
    let mut out = String::with_capacity(40);
    for b in digest {
        use std::fmt::Write;
        let _ = write!(&mut out, "{b:02X}");
    }
    out
}

/// Query HaveIBeenPwned k-anonymity API using only the first 5 hex characters of SHA-1.
pub async fn check_hibp_breached_sha1_hashes(
    client: &VaultwardenClient,
    items: &[ItemDetail],
) -> Result<HashSet<String>, CoreError> {
    let mut by_prefix: HashMap<String, Vec<String>> = HashMap::new();
    for item in items.iter().filter(|i| i.deleted_at.is_none()) {
        for field in item.payload.sections.iter().flat_map(|s| s.fields.iter()) {
            if field.purpose == Some(FieldPurpose::Password) && !field.value.trim().is_empty() {
                let hex = sha1_upper_hex(&field.value);
                let prefix = hex[..5].to_string();
                let entry = by_prefix.entry(prefix).or_default();
                if !entry.contains(&hex) {
                    entry.push(hex);
                }
            }
        }
    }

    let mut breached = HashSet::new();
    for (prefix, hashes) in by_prefix {
        let body = client.check_hibp_range(&prefix).await?;
        let mut suffixes = HashSet::new();
        for line in body.lines() {
            if let Some((suffix, count_str)) = line.split_once(':') {
                if count_str.trim().parse::<u64>().unwrap_or(0) > 0 {
                    suffixes.insert(suffix.trim().to_ascii_uppercase());
                }
            }
        }
        for full_hex in hashes {
            if suffixes.contains(&full_hex[5..]) {
                breached.insert(full_hex);
            }
        }
    }
    Ok(breached)
}

pub fn run_watchtower_audit(
    items: &[ItemDetail],
    hibp_breached_sha1: Option<&HashSet<String>>,
    hibp_checked_at: Option<String>,
) -> WatchtowerReport {
    let active_items: Vec<&ItemDetail> = items
        .iter()
        .filter(|i| i.deleted_at.is_none() && !i.payload.archived)
        .collect();
    let today = Utc::now().date_naive();

    let all_issue_types = [
        WatchtowerIssueType::Weak,
        WatchtowerIssueType::Reused,
        WatchtowerIssueType::Missing2fa,
        WatchtowerIssueType::UnsecuredUrl,
        WatchtowerIssueType::Expiring,
        WatchtowerIssueType::Breached,
        WatchtowerIssueType::PasskeyAvailable,
    ];

    let mut item_ids_by_issue: HashMap<WatchtowerIssueType, Vec<String>> = HashMap::new();
    for t in all_issue_types {
        item_ids_by_issue.insert(t, Vec::new());
    }

    let mut item_issue_sets: HashMap<String, Vec<WatchtowerIssueType>> = HashMap::new();
    let mut add_issue = |item_id: &str, issue: WatchtowerIssueType| {
        let list = item_issue_sets.entry(item_id.to_string()).or_default();
        if !list.contains(&issue) {
            list.push(issue);
            if let Some(bucket) = item_ids_by_issue.get_mut(&issue) {
                bucket.push(item_id.to_string());
            }
        }
    };

    // Per-audit random salt for BLAKE3 password reuse bucketing (never key map by plaintext)
    let mut reuse_salt = [0u8; 32];
    OsRng.fill_bytes(&mut reuse_salt);
    let mut password_buckets: HashMap<[u8; 32], Vec<String>> = HashMap::new();
    let mut known_2fa_missing_ids: HashSet<String> = HashSet::new();

    for item in &active_items {
        let fields: Vec<_> = item
            .payload
            .sections
            .iter()
            .flat_map(|s| s.fields.iter())
            .collect();

        for field in &fields {
            if field.purpose == Some(FieldPurpose::Password) && !field.value.trim().is_empty() {
                if !item.payload.watchtower.ignore_weak {
                    let strength = evaluate_password_strength(&field.value);
                    if strength.score < 3 {
                        add_issue(&item.id, WatchtowerIssueType::Weak);
                    }
                }
                if !item.payload.watchtower.ignore_reused {
                    let mut hasher = blake3::Hasher::new();
                    hasher.update(&reuse_salt);
                    hasher.update(field.value.as_bytes());
                    let digest: [u8; 32] = *hasher.finalize().as_bytes();
                    let bucket = password_buckets.entry(digest).or_default();
                    if !bucket.contains(&item.id) {
                        bucket.push(item.id.clone());
                    }
                }
                if let Some(breached_set) = hibp_breached_sha1 {
                    let sha1_hex = sha1_upper_hex(&field.value);
                    if breached_set.contains(&sha1_hex) {
                        add_issue(&item.id, WatchtowerIssueType::Breached);
                    }
                }
            }

            if !item.payload.watchtower.ignore_expiring
                && (field.purpose == Some(FieldPurpose::CardExpiry)
                    || field.field_type == FieldType::MonthYear
                    || (matches!(
                        field.field_type,
                        FieldType::Date | FieldType::Text | FieldType::MonthYear
                    ) && is_expiry_label(&field.label)))
                && is_expiring_or_expired(&field.value, today)
            {
                add_issue(&item.id, WatchtowerIssueType::Expiring);
            }
        }

        let has_sso = item
            .payload
            .sso_provider
            .as_deref()
            .map(|s| !s.trim().is_empty())
            .unwrap_or(false);

        if !item.payload.watchtower.ignore_missing_2fa
            && item.payload.category == ItemCategory::Login
            && !has_sso
        {
            let has_valid_url = item.payload.urls.iter().any(|u| !u.uri.trim().is_empty());
            let has_totp = fields
                .iter()
                .any(|f| f.field_type == FieldType::Totp && !f.value.trim().is_empty());
            let has_passkey = !item.payload.passkeys.is_empty();
            if has_valid_url && !has_totp && !has_passkey {
                let known_2fa = item
                    .payload
                    .urls
                    .iter()
                    .any(|u| is_known_2fa_domain(&u.uri));
                if known_2fa {
                    known_2fa_missing_ids.insert(item.id.clone());
                }
                add_issue(&item.id, WatchtowerIssueType::Missing2fa);
            }
        }

        if !item.payload.watchtower.ignore_passkey_available
            && item.payload.category == ItemCategory::Login
            && !has_sso
            && item.payload.passkeys.is_empty()
            && item
                .payload
                .urls
                .iter()
                .any(|u| is_known_passkey_domain(&u.uri))
        {
            add_issue(&item.id, WatchtowerIssueType::PasskeyAvailable);
        }

        if !item.payload.watchtower.ignore_unsecured_url {
            let has_insecure = item.payload.urls.iter().any(|u| {
                let trimmed = u.uri.trim();
                trimmed.to_ascii_lowercase().starts_with("http://")
                    && !is_local_or_intranet_host(trimmed)
            });
            if has_insecure {
                add_issue(&item.id, WatchtowerIssueType::UnsecuredUrl);
            }
        }
    }

    for (_, item_ids) in password_buckets {
        if item_ids.len() >= 2 {
            for id in item_ids {
                add_issue(&id, WatchtowerIssueType::Reused);
            }
        }
    }

    // Prioritize known 2FA-capable sites at the top of Missing2fa list
    if let Some(missing_list) = item_ids_by_issue.get_mut(&WatchtowerIssueType::Missing2fa) {
        missing_list.sort_by_key(|id| if known_2fa_missing_ids.contains(id) { 0 } else { 1 });
    }

    let mut counts = HashMap::new();
    for t in all_issue_types {
        counts.insert(
            t,
            item_ids_by_issue.get(&t).map(|v| v.len()).unwrap_or(0),
        );
    }

    let penalty: i32 = (counts[&WatchtowerIssueType::Breached] as i32) * 14
        + (counts[&WatchtowerIssueType::Weak] as i32) * 10
        + (counts[&WatchtowerIssueType::Reused] as i32) * 7
        + (counts[&WatchtowerIssueType::Missing2fa] as i32) * 4
        + (counts[&WatchtowerIssueType::UnsecuredUrl] as i32) * 5
        + (counts[&WatchtowerIssueType::Expiring] as i32) * 3
        + (counts[&WatchtowerIssueType::PasskeyAvailable] as i32);

    let score = (100 - penalty).clamp(12, 100) as u32;

    WatchtowerReport {
        score,
        total_audited: active_items.len(),
        total_risk_items: item_issue_sets.len(),
        counts,
        item_ids_by_issue,
        item_issues: item_issue_sets,
        hibp_checked: hibp_breached_sha1.is_some(),
        hibp_checked_at,
    }
}
