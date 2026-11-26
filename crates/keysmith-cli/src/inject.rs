use std::collections::HashMap;
use std::path::Path;
use std::process::Stdio;

use anyhow::{anyhow, Context, Result};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

use crate::socket_client::SocketClient;

fn is_ref_terminator(ch: char) -> bool {
    ch.is_whitespace()
        || matches!(
            ch,
            '"' | '\'' | '`' | '}' | ')' | ']' | '>' | ',' | ';'
        )
}

/// Extract all unique `ks://...` secret references from a template or value string.
/// Supports both `{{ ks://vault/item/field }}` and bare `ks://vault/item/field`.
pub fn extract_ks_references(input: &str) -> Vec<String> {
    let mut refs = Vec::new();
    let mut idx = 0;
    while let Some(rel) = input[idx..].find("ks://") {
        let start = idx + rel;
        let tail = &input[start + 5..];
        let end_rel = tail
            .char_indices()
            .find(|(_, c)| is_ref_terminator(*c))
            .map(|(i, _)| i)
            .unwrap_or(tail.len());
        let token = &input[start..start + 5 + end_rel];
        if token.len() > 5 && token[5..].contains('/') && !refs.iter().any(|r| r == token) {
            refs.push(token.to_string());
        }
        idx = start + 5 + end_rel;
    }
    refs
}

/// Substitute `{{ ks://... }}` blocks and bare `ks://...` tokens using `resolved`.
pub fn render_template(input: &str, resolved: &HashMap<String, String>) -> Result<String> {
    // 1. Replace `{{ ... }}` placeholders containing a single `ks://...` reference
    let mut after_braces = String::with_capacity(input.len());
    let mut cursor = 0;
    while let Some(open_rel) = input[cursor..].find("{{") {
        let open_idx = cursor + open_rel;
        after_braces.push_str(&input[cursor..open_idx]);
        if let Some(close_rel) = input[open_idx + 2..].find("}}") {
            let close_idx = open_idx + 2 + close_rel;
            let inner = input[open_idx + 2..close_idx].trim();
            if inner.starts_with("ks://") {
                let val = resolved
                    .get(inner)
                    .ok_or_else(|| anyhow!("Unresolved secret reference: {inner}"))?;
                after_braces.push_str(val);
                cursor = close_idx + 2;
                continue;
            }
        }
        after_braces.push_str("{{");
        cursor = open_idx + 2;
    }
    after_braces.push_str(&input[cursor..]);

    // 2. Replace any remaining bare `ks://...` tokens
    let mut out = String::with_capacity(after_braces.len());
    let mut idx = 0;
    while let Some(rel) = after_braces[idx..].find("ks://") {
        let start = idx + rel;
        out.push_str(&after_braces[idx..start]);
        let tail = &after_braces[start + 5..];
        let end_rel = tail
            .char_indices()
            .find(|(_, c)| is_ref_terminator(*c))
            .map(|(i, _)| i)
            .unwrap_or(tail.len());
        let token = &after_braces[start..start + 5 + end_rel];
        if let Some(val) = resolved.get(token) {
            out.push_str(val);
        } else {
            out.push_str(token);
        }
        idx = start + 5 + end_rel;
    }
    out.push_str(&after_braces[idx..]);
    Ok(out)
}

/// Parse `.env` style key-value pairs (`KEY=VALUE`, `export KEY="VALUE"`, `# comments`).
pub fn parse_dotenv_entries(content: &str) -> Vec<(String, String)> {
    let mut entries = Vec::new();
    for raw_line in content.lines() {
        let trimmed = raw_line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let without_export = trimmed
            .strip_prefix("export ")
            .map(str::trim_start)
            .unwrap_or(trimmed);
        let Some((k, v)) = without_export.split_once('=') else {
            continue;
        };
        let key = k.trim();
        if key.is_empty() {
            continue;
        }
        let mut val = v.trim();
        if (val.starts_with('"') && val.ends_with('"') && val.len() >= 2)
            || (val.starts_with('\'') && val.ends_with('\'') && val.len() >= 2)
        {
            val = &val[1..val.len() - 1];
        }
        entries.push((key.to_string(), val.to_string()));
    }
    entries
}

/// Mask resolved secret values (>= 4 chars) in output lines with `[REDACTED]`.
pub fn mask_secrets_in_text(text: &str, secrets: &[String]) -> String {
    let mut candidates: Vec<&str> = secrets
        .iter()
        .map(String::as_str)
        .filter(|s| s.len() >= 4)
        .collect();
    if candidates.is_empty() {
        return text.to_string();
    }
    candidates.sort_by(|a, b| b.len().cmp(&a.len()));
    candidates.dedup();

    let mut masked = text.to_string();
    for secret in candidates {
        if masked.contains(secret) {
            masked = masked.replace(secret, "[REDACTED]");
        }
    }
    masked
}

pub async fn resolve_reference_string(client: &SocketClient, reference: &str) -> Result<String> {
    let res = client.resolve_secret_ref(reference).await?;
    if let Some(s) = res.get("value").and_then(|v| v.as_str()) {
        Ok(s.to_string())
    } else if let Some(s) = res.as_str() {
        Ok(s.to_string())
    } else {
        Err(anyhow!(
            "Invalid secret response from Keysmith for {reference}"
        ))
    }
}

pub async fn resolve_all_references(
    client: &SocketClient,
    refs: &[String],
) -> Result<HashMap<String, String>> {
    let mut map = HashMap::with_capacity(refs.len());
    for r in refs {
        if !map.contains_key(r) {
            let val = resolve_reference_string(client, r).await?;
            map.insert(r.clone(), val);
        }
    }
    Ok(map)
}

pub fn write_restricted_file(path: &Path, content: &str) -> Result<()> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("Failed to create directory {}", parent.display()))?;
        }
    }
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let mut f = std::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .mode(0o600)
            .open(path)
            .with_context(|| format!("Failed to open output file {}", path.display()))?;
        f.write_all(content.as_bytes())
            .with_context(|| format!("Failed to write output file {}", path.display()))?;
    }
    #[cfg(not(unix))]
    {
        std::fs::write(path, content.as_bytes())
            .with_context(|| format!("Failed to write output file {}", path.display()))?;
    }
    Ok(())
}

/// Resolve `ks://` references in environment variables, optional `--env-file`, and command args,
/// then execute the child process in memory without writing any plaintext `.env` to disk.
pub async fn run_with_secret_env(
    client: &SocketClient,
    env_file: Option<&Path>,
    no_masking: bool,
    command: &[String],
) -> Result<i32> {
    if command.is_empty() {
        return Err(anyhow!("Missing command to execute after `ks run --`"));
    }

    let mut env_pairs: Vec<(String, String)> = std::env::vars().collect();
    if let Some(path) = env_file {
        let raw = std::fs::read_to_string(path)
            .with_context(|| format!("Failed to read env file {}", path.display()))?;
        for (k, v) in parse_dotenv_entries(&raw) {
            if let Some(existing) = env_pairs.iter_mut().find(|(ek, _)| ek == &k) {
                existing.1 = v;
            } else {
                env_pairs.push((k, v));
            }
        }
    }

    let mut all_refs = Vec::new();
    for (_, val) in &env_pairs {
        for r in extract_ks_references(val) {
            if !all_refs.contains(&r) {
                all_refs.push(r);
            }
        }
    }
    for arg in command.iter().skip(1) {
        for r in extract_ks_references(arg) {
            if !all_refs.contains(&r) {
                all_refs.push(r);
            }
        }
    }

    let resolved_map = resolve_all_references(client, &all_refs).await?;
    let secret_values: Vec<String> = resolved_map.values().cloned().collect();

    let mut cmd = Command::new(&command[0]);
    for arg in command.iter().skip(1) {
        let rendered = if arg.contains("ks://") {
            render_template(arg, &resolved_map)?
        } else {
            arg.clone()
        };
        cmd.arg(rendered);
    }

    cmd.env_clear();
    for (k, v) in env_pairs {
        let rendered = if v.contains("ks://") {
            render_template(&v, &resolved_map)?
        } else {
            v
        };
        cmd.env(k, rendered);
    }

    cmd.stdin(Stdio::inherit());

    if no_masking || secret_values.is_empty() {
        cmd.stdout(Stdio::inherit());
        cmd.stderr(Stdio::inherit());
        let status = cmd
            .status()
            .await
            .with_context(|| format!("Failed to execute command '{}'", command[0]))?;
        return Ok(status.code().unwrap_or(1));
    }

    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .with_context(|| format!("Failed to spawn command '{}'", command[0]))?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let secrets_out = secret_values.clone();
    let secrets_err = secret_values;

    let stdout_task = tokio::spawn(async move {
        if let Some(out) = stdout {
            let mut reader = BufReader::new(out);
            let mut writer = tokio::io::stdout();
            let mut line = String::new();
            while let Ok(n) = reader.read_line(&mut line).await {
                if n == 0 {
                    break;
                }
                let masked = mask_secrets_in_text(&line, &secrets_out);
                let _ = writer.write_all(masked.as_bytes()).await;
                let _ = writer.flush().await;
                line.clear();
            }
        }
    });

    let stderr_task = tokio::spawn(async move {
        if let Some(err) = stderr {
            let mut reader = BufReader::new(err);
            let mut writer = tokio::io::stderr();
            let mut line = String::new();
            while let Ok(n) = reader.read_line(&mut line).await {
                if n == 0 {
                    break;
                }
                let masked = mask_secrets_in_text(&line, &secrets_err);
                let _ = writer.write_all(masked.as_bytes()).await;
                let _ = writer.flush().await;
                line.clear();
            }
        }
    });

    let status = child.wait().await?;
    let _ = stdout_task.await;
    let _ = stderr_task.await;
    Ok(status.code().unwrap_or(1))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_and_render_ks_templates() {
        let tpl = r#"
DATABASE_URL="postgres://{{ ks://Work/ProdDB/username }}:{{ ks://Work/ProdDB/password }}@db.internal:5432/app"
API_TOKEN=ks://Personal/OpenAI/password
PLAIN=hello_world
"#;
        let refs = extract_ks_references(tpl);
        assert_eq!(
            refs,
            vec![
                "ks://Work/ProdDB/username",
                "ks://Work/ProdDB/password",
                "ks://Personal/OpenAI/password",
            ]
        );

        let mut map = HashMap::new();
        map.insert("ks://Work/ProdDB/username".to_string(), "db_admin".to_string());
        map.insert("ks://Work/ProdDB/password".to_string(), "Sup3rS3cret!".to_string());
        map.insert(
            "ks://Personal/OpenAI/password".to_string(),
            "sk-live-987654".to_string(),
        );

        let rendered = render_template(tpl, &map).unwrap();
        assert!(rendered.contains("postgres://db_admin:Sup3rS3cret!@db.internal:5432/app"));
        assert!(rendered.contains("API_TOKEN=sk-live-987654"));
        assert!(rendered.contains("PLAIN=hello_world"));
    }

    #[test]
    fn dotenv_parser_and_secret_masking() {
        let raw = r#"
# comment
export STRIPE_KEY="ks://Work/Stripe/password"
PORT=8080
SINGLE='ks://Work/GitHub/totp'
"#;
        let parsed = parse_dotenv_entries(raw);
        assert_eq!(
            parsed,
            vec![
                ("STRIPE_KEY".to_string(), "ks://Work/Stripe/password".to_string()),
                ("PORT".to_string(), "8080".to_string()),
                ("SINGLE".to_string(), "ks://Work/GitHub/totp".to_string()),
            ]
        );

        let secrets = vec!["sk_live_TopSecret123".to_string(), "abc".to_string()];
        let masked = mask_secrets_in_text("Token is sk_live_TopSecret123 and abc", &secrets);
        assert_eq!(masked, "Token is [REDACTED] and abc");
    }
}
