use std::collections::HashSet;

use url::Url;

/// Built-in equivalent domain groups (modeled after 1Password / Bitwarden Equivalent Domains).
pub const DEFAULT_EQUIVALENT_DOMAIN_GROUPS: &[&[&str]] = &[
    &[
        "google.com",
        "youtube.com",
        "gmail.com",
        "googlemail.com",
        "youtu.be",
    ],
    &["apple.com", "icloud.com", "me.com"],
    &[
        "microsoft.com",
        "live.com",
        "outlook.com",
        "office.com",
        "office365.com",
        "microsoftonline.com",
    ],
    &["github.com", "githubusercontent.com", "github.dev"],
    &["paypal.com", "paypalobjects.com"],
    &["jd.com", "360buy.com", "jd.hk"],
    &["taobao.com", "tmall.com", "alipay.com", "1688.com"],
    &["x.com", "twitter.com", "twimg.com"],
    &[
        "amazon.com",
        "aws.amazon.com",
        "amazon.co.jp",
        "amazon.co.uk",
        "amazon.de",
    ],
    &["bilibili.com", "biligame.com", "b23.tv"],
    &["bytedance.com", "feishu.cn", "larksuite.com"],
    &["qq.com", "weixin.qq.com", "wechat.com"],
];

const TWO_PART_SUFFIXES: &[&str] = &[
    "co.uk", "org.uk", "ac.uk", "gov.uk", "co.jp", "ne.jp", "or.jp", "com.cn", "net.cn", "org.cn",
    "gov.cn", "com.hk", "com.tw", "com.au", "net.au", "org.au", "co.nz", "com.sg", "com.br",
    "com.mx", "co.kr", "co.in",
];

/// Normalize a URL or host into a lowercase hostname without port, trailing dot, or `www.`.
pub fn normalize_host(host_or_uri: &str) -> String {
    let trimmed = host_or_uri.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let candidate = if trimmed.contains("://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };
    let host = if let Ok(parsed) = Url::parse(&candidate) {
        parsed.host_str().unwrap_or(trimmed).to_string()
    } else {
        trimmed
            .split('/')
            .next()
            .unwrap_or(trimmed)
            .split(':')
            .next()
            .unwrap_or(trimmed)
            .to_string()
    };
    let lower = host.trim().trim_end_matches('.').to_ascii_lowercase();
    lower.strip_prefix("www.").unwrap_or(&lower).to_string()
}

/// Extract the registrable base domain (eTLD+1 approximation) from a URL or hostname.
pub fn registrable_domain(host_or_uri: &str) -> String {
    let host = normalize_host(host_or_uri);
    if host.is_empty() || host == "localhost" || host.parse::<std::net::IpAddr>().is_ok() {
        return host;
    }
    let parts: Vec<&str> = host.split('.').collect();
    if parts.len() <= 2 {
        return host;
    }
    let last_two = format!("{}.{}", parts[parts.len() - 2], parts[parts.len() - 1]);
    if TWO_PART_SUFFIXES.contains(&last_two.as_str()) && parts.len() >= 3 {
        return format!("{}.{last_two}", parts[parts.len() - 3]);
    }
    last_two
}

fn host_matches_group_entry(host: &str, base: &str, entry: &str) -> bool {
    let norm = normalize_host(entry);
    if norm.is_empty() {
        return false;
    }
    host == norm || base == norm || host.ends_with(&format!(".{norm}"))
}

/// Expand a host or URL into the set of all equivalent domains (normalized, lowercase).
pub fn expand_equivalent_domains(
    host_or_uri: &str,
    custom_groups: &[Vec<String>],
) -> HashSet<String> {
    let host = normalize_host(host_or_uri);
    let base = registrable_domain(&host);
    let mut out = HashSet::new();
    if host.is_empty() {
        return out;
    }
    out.insert(host.clone());
    if !base.is_empty() {
        out.insert(base.clone());
    }

    for group in DEFAULT_EQUIVALENT_DOMAIN_GROUPS {
        if group
            .iter()
            .any(|entry| host_matches_group_entry(&host, &base, entry))
        {
            for entry in *group {
                let norm = normalize_host(entry);
                if !norm.is_empty() {
                    out.insert(registrable_domain(&norm));
                    out.insert(norm);
                }
            }
        }
    }

    for group in custom_groups {
        if group
            .iter()
            .any(|entry| host_matches_group_entry(&host, &base, entry))
        {
            for entry in group {
                let norm = normalize_host(entry);
                if !norm.is_empty() {
                    out.insert(registrable_domain(&norm));
                    out.insert(norm);
                }
            }
        }
    }

    out
}

/// Check whether two hosts or URLs belong to the same registrable domain or equivalent domain group.
pub fn domains_are_equivalent(
    a: &str,
    b: &str,
    custom_groups: &[Vec<String>],
) -> bool {
    let host_a = normalize_host(a);
    let host_b = normalize_host(b);
    if host_a.is_empty() || host_b.is_empty() {
        return false;
    }
    let base_a = registrable_domain(&host_a);
    let base_b = registrable_domain(&host_b);
    if host_a == host_b || (!base_a.is_empty() && base_a == base_b) {
        return true;
    }
    let eq_a = expand_equivalent_domains(&host_a, custom_groups);
    eq_a.contains(&host_b) || eq_a.contains(&base_b)
}

/// Check whether autofill is disabled for a given host/URL according to user rules.
pub fn is_domain_autofill_disabled(host_or_uri: &str, disabled_domains: &[String]) -> bool {
    let host = normalize_host(host_or_uri);
    if host.is_empty() {
        return false;
    }
    let base = registrable_domain(&host);
    disabled_domains.iter().any(|rule| {
        let norm = normalize_host(rule);
        !norm.is_empty()
            && (host == norm || base == norm || host.ends_with(&format!(".{norm}")))
    })
}
