use base64::{
    engine::general_purpose::{STANDARD, STANDARD_NO_PAD, URL_SAFE, URL_SAFE_NO_PAD},
    Engine as _,
};
use chrono::Utc;
use hmac::{Hmac, Mac};
use p256::ecdsa::{signature::Signer, DerSignature, SigningKey};
use p256::elliptic_curve::sec1::ToEncodedPoint;
use p256::pkcs8::{DecodePrivateKey, EncodePrivateKey, EncodePublicKey};
use rand::rngs::OsRng;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use url::Url;
use uuid::Uuid;

use crate::domain::{domains_are_equivalent, PasskeyCredential};
use crate::error::CoreError;

type HmacSha256 = Hmac<Sha256>;

/// Dedicated Keysmith authenticator AAGUID (UUID bytes).
pub const KEYSMITH_AAGUID: [u8; 16] = [
    0x6b, 0x65, 0x79, 0x73, 0x6d, 0x69, 0x74, 0x68, 0x41, 0x41, 0x47, 0x55, 0x49, 0x44, 0x01, 0x00,
];
pub const KEYSMITH_AAGUID_STR: &str = "6b657973-6d69-7468-4141-475549440100";

pub const COSE_ALG_ES256: i32 = -7;
pub const COSE_ALG_EDDSA: i32 = -8;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PasskeyCreateParams {
    pub origin: String,
    pub rp_id: String,
    pub rp_name: String,
    pub user_id_b64u: String,
    pub user_name: String,
    pub user_display_name: String,
    pub challenge_b64u: String,
    #[serde(default)]
    pub pub_key_cred_params: Vec<i32>,
    #[serde(default = "default_true")]
    pub discoverable: bool,
    #[serde(default)]
    pub cross_origin: bool,
    #[serde(default)]
    pub authenticator_attachment: Option<String>,
    #[serde(default)]
    pub prf_requested: bool,
    #[serde(default)]
    pub prf_eval_first_b64u: Option<String>,
    #[serde(default)]
    pub prf_eval_second_b64u: Option<String>,
    #[serde(default)]
    pub custom_equivalent_domains: Vec<Vec<String>>,
}

impl Default for PasskeyCreateParams {
    fn default() -> Self {
        Self {
            origin: String::new(),
            rp_id: String::new(),
            rp_name: String::new(),
            user_id_b64u: String::new(),
            user_name: String::new(),
            user_display_name: String::new(),
            challenge_b64u: String::new(),
            pub_key_cred_params: Vec::new(),
            discoverable: true,
            cross_origin: false,
            authenticator_attachment: None,
            prf_requested: false,
            prf_eval_first_b64u: None,
            prf_eval_second_b64u: None,
            custom_equivalent_domains: Vec::new(),
        }
    }
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone)]
pub struct PasskeyCreateOutput {
    pub credential: PasskeyCredential,
    pub response_json: Value,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PasskeyAssertParams {
    pub origin: String,
    pub rp_id: String,
    pub challenge_b64u: String,
    #[serde(default)]
    pub cross_origin: bool,
    #[serde(default)]
    pub prf_eval_first_b64u: Option<String>,
    #[serde(default)]
    pub prf_eval_second_b64u: Option<String>,
    #[serde(default)]
    pub custom_equivalent_domains: Vec<Vec<String>>,
}

pub fn encode_b64u(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

pub fn now_rfc3339() -> String {
    Utc::now().to_rfc3339()
}

fn strip_encoding_prefix(input: &str) -> &str {
    let trimmed = input.trim();
    for prefix in ["base64url.", "base64.", "b64u.", "b64."] {
        if let Some(rest) = trimmed.get(..prefix.len()) {
            if rest.eq_ignore_ascii_case(prefix) {
                return &trimmed[prefix.len()..];
            }
        }
    }
    trimmed
}

pub fn decode_b64u_or_b64(input: &str) -> Result<Vec<u8>, CoreError> {
    let stripped = strip_encoding_prefix(input).trim();
    if stripped.is_empty() {
        return Ok(Vec::new());
    }
    let clean_owned;
    let candidate = if stripped.chars().any(char::is_whitespace) {
        clean_owned = stripped
            .chars()
            .filter(|c| !c.is_whitespace())
            .collect::<String>();
        clean_owned.as_str()
    } else {
        stripped
    };
    URL_SAFE_NO_PAD
        .decode(candidate)
        .or_else(|_| URL_SAFE.decode(candidate))
        .or_else(|_| STANDARD_NO_PAD.decode(candidate))
        .or_else(|_| STANDARD.decode(candidate))
        .map_err(|e| CoreError::Validation(format!("Base64 解码失败: {e}")))
}

/// Normalize a WebAuthn RP ID by extracting host from URL if needed, stripping port and trailing dots, and lowercasing.
pub fn normalize_rp_id(rp_id: &str) -> String {
    let trimmed = rp_id.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let host_part = if trimmed.contains("://") {
        if let Ok(parsed) = Url::parse(trimmed) {
            parsed.host_str().unwrap_or(trimmed).to_string()
        } else {
            trimmed.to_string()
        }
    } else {
        trimmed.to_string()
    };
    let without_port = if !host_part.starts_with('[') {
        host_part
            .split(':')
            .next()
            .unwrap_or(&host_part)
            .to_string()
    } else {
        host_part
    };
    without_port.trim().trim_end_matches('.').to_ascii_lowercase()
}

/// Bitwarden stores credential IDs as hyphenated 36-char UUIDs, `b64.<base64>`, `hex.<hex>`, or Base64URL.
pub fn decode_credential_id_bytes(cred_id: &str) -> Result<Vec<u8>, CoreError> {
    let trimmed = cred_id.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }
    if let Some(prefix) = trimmed.get(..4) {
        if prefix.eq_ignore_ascii_case("hex.") {
            let hex_str = trimmed[4..].trim();
            if hex_str.len() % 2 == 0 {
                let mut out = Vec::with_capacity(hex_str.len() / 2);
                let mut valid = true;
                for chunk in hex_str.as_bytes().chunks_exact(2) {
                    if let Ok(s) = std::str::from_utf8(chunk) {
                        if let Ok(b) = u8::from_str_radix(s, 16) {
                            out.push(b);
                            continue;
                        }
                    }
                    valid = false;
                    break;
                }
                if valid {
                    return Ok(out);
                }
            }
        }
    }
    let without_prefix = strip_encoding_prefix(trimmed).trim();
    if without_prefix.len() == 36 && without_prefix.contains('-') {
        if let Ok(parsed) = Uuid::parse_str(without_prefix) {
            return Ok(parsed.as_bytes().to_vec());
        }
    }
    decode_b64u_or_b64(trimmed)
}

fn parse_secure_origin_host(origin: &str) -> Option<String> {
    let parsed = Url::parse(origin.trim()).ok()?;
    let host = parsed.host_str()?.to_ascii_lowercase();
    let scheme = parsed.scheme();
    let secure = scheme == "https"
        || (scheme == "http"
            && (host == "localhost" || host == "127.0.0.1" || host.ends_with(".localhost")));
    if secure {
        Some(host)
    } else {
        None
    }
}

/// Validate WebAuthn RP ID against caller origin (exact host or subdomain suffix, HTTPS or localhost).
pub fn rp_id_matches_origin(rp_id: &str, origin: &str) -> bool {
    let rp = normalize_rp_id(rp_id);
    if rp.is_empty() {
        return false;
    }
    let Some(host) = parse_secure_origin_host(origin) else {
        return false;
    };
    host == rp || host.ends_with(&format!(".{rp}"))
}

/// Validate WebAuthn RP ID against caller origin with WebAuthn Related Origins / Equivalent Domains support.
pub fn rp_id_matches_origin_ext(
    rp_id: &str,
    origin: &str,
    custom_equivalents: &[Vec<String>],
) -> bool {
    let rp = normalize_rp_id(rp_id);
    if rp.is_empty() {
        return false;
    }
    let Some(host) = parse_secure_origin_host(origin) else {
        return false;
    };
    host == rp
        || host.ends_with(&format!(".{rp}"))
        || domains_are_equivalent(&host, &rp, custom_equivalents)
}

/// Check whether a stored credential ID matches any candidate Base64URL/UUID credential ID.
pub fn passkey_matches_credential_list(
    passkey: &PasskeyCredential,
    candidate_ids: &[String],
) -> bool {
    let pk_trimmed = passkey.credential_id.trim();
    let pk_bytes = decode_credential_id_bytes(pk_trimmed).ok();
    candidate_ids.iter().any(|cand| {
        let cand_trimmed = cand.trim();
        if !pk_trimmed.is_empty() && cand_trimmed == pk_trimmed {
            return true;
        }
        match (&pk_bytes, decode_credential_id_bytes(cand_trimmed)) {
            (Some(a), Ok(b)) => !a.is_empty() && *a == b,
            _ => false,
        }
    })
}

fn decode_pkcs8_signing_key(encoded: &str) -> Result<SigningKey, CoreError> {
    let trimmed = encoded.trim();
    if trimmed.is_empty() {
        return Err(CoreError::Crypto("Passkey 缺少私钥数据".to_string()));
    }
    if trimmed.starts_with("2.") && trimmed.contains('|') {
        return Err(CoreError::Crypto(
            "Passkey 私钥尚未解密，请重新同步密码库".to_string(),
        ));
    }
    let secret = if trimmed.starts_with("-----BEGIN") {
        p256::SecretKey::from_pkcs8_pem(trimmed)
            .or_else(|_| p256::SecretKey::from_sec1_pem(trimmed))
            .map_err(|e| CoreError::Crypto(format!("解析 PKCS#8 PEM 私钥失败: {e}")))?
    } else {
        let der = decode_b64u_or_b64(trimmed)?;
        p256::SecretKey::from_pkcs8_der(&der)
            .or_else(|_| p256::SecretKey::from_sec1_der(&der))
            .map_err(|e| CoreError::Crypto(format!("解析 PKCS#8 DER 私钥失败: {e}")))?
    };
    Ok(SigningKey::from(&secret))
}

/// RFC 8410 Ed25519 PKCS#8 v1 DER prefix (16 bytes) + 32-byte seed = 48 bytes.
fn encode_ed25519_pkcs8_der(seed: &[u8; 32]) -> [u8; 48] {
    const PREFIX: [u8; 16] = [
        0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04,
        0x20,
    ];
    let mut out = [0u8; 48];
    out[..16].copy_from_slice(&PREFIX);
    out[16..].copy_from_slice(seed);
    out
}

/// RFC 8410 Ed25519 SubjectPublicKeyInfo DER prefix (12 bytes) + 32-byte pubkey = 44 bytes.
fn encode_ed25519_spki_der(pub_bytes: &[u8; 32]) -> [u8; 44] {
    const PREFIX: [u8; 12] = [
        0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
    ];
    let mut out = [0u8; 44];
    out[..12].copy_from_slice(&PREFIX);
    out[12..].copy_from_slice(pub_bytes);
    out
}

fn decode_ed25519_signing_key(encoded: &str) -> Result<ed25519_dalek::SigningKey, CoreError> {
    let trimmed = encoded.trim();
    if trimmed.is_empty() {
        return Err(CoreError::Crypto("Passkey 缺少私钥数据".to_string()));
    }
    if trimmed.starts_with("2.") && trimmed.contains('|') {
        return Err(CoreError::Crypto(
            "Passkey 私钥尚未解密，请重新同步密码库".to_string(),
        ));
    }
    let body = if trimmed.starts_with("-----BEGIN") {
        trimmed
            .lines()
            .filter(|l| !l.trim_start().starts_with("-----"))
            .collect::<String>()
    } else {
        trimmed.to_string()
    };
    let der = decode_b64u_or_b64(&body)?;
    if der.len() == 32 {
        let seed: [u8; 32] = der.try_into().unwrap();
        return Ok(ed25519_dalek::SigningKey::from_bytes(&seed));
    }
    if der.len() == 64 {
        let seed: [u8; 32] = der[..32].try_into().unwrap();
        return Ok(ed25519_dalek::SigningKey::from_bytes(&seed));
    }
    // Search for Ed25519 OID 1.3.101.112 (06 03 2b 65 70) + OCTET STRING (04 22 04 20)
    const MARKER: [u8; 9] = [0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20];
    if let Some(pos) = der.windows(MARKER.len()).position(|w| w == MARKER) {
        let start = pos + MARKER.len();
        if der.len() >= start + 32 {
            let seed: [u8; 32] = der[start..start + 32].try_into().unwrap();
            return Ok(ed25519_dalek::SigningKey::from_bytes(&seed));
        }
    }
    Err(CoreError::Crypto("解析 Ed25519 PKCS#8 私钥失败".to_string()))
}

/// Deterministic WebAuthn Level 3 `prf` extension evaluation (`HMAC-SHA256` over `"WebAuthn PRF\0" || salt`).
pub fn compute_prf_output(private_key_encoded: &str, salt_b64u: &str) -> Result<String, CoreError> {
    let key_raw = decode_b64u_or_b64(private_key_encoded)?;
    if key_raw.is_empty() {
        return Err(CoreError::Crypto("PRF 缺少凭据私钥材料".to_string()));
    }
    let salt = decode_b64u_or_b64(salt_b64u)?;
    let mut kdf_mac = HmacSha256::new_from_slice(b"keysmith-webauthn-prf-key-v1")
        .map_err(|e| CoreError::Crypto(format!("PRF KDF 初始化失败: {e}")))?;
    kdf_mac.update(&key_raw);
    let prf_secret = kdf_mac.finalize().into_bytes();

    let mut eval_mac = HmacSha256::new_from_slice(&prf_secret)
        .map_err(|e| CoreError::Crypto(format!("PRF HMAC 初始化失败: {e}")))?;
    eval_mac.update(b"WebAuthn PRF\x00");
    eval_mac.update(&salt);
    let out = eval_mac.finalize().into_bytes();
    Ok(encode_b64u(&out))
}

fn build_prf_extension_result(
    private_key_encoded: &str,
    include_enabled_flag: bool,
    prf_requested: bool,
    eval_first: Option<&str>,
    eval_second: Option<&str>,
) -> Result<Option<Value>, CoreError> {
    let has_first = eval_first.map(str::trim).filter(|s| !s.is_empty());
    let has_second = eval_second.map(str::trim).filter(|s| !s.is_empty());
    if !prf_requested && has_first.is_none() {
        return Ok(None);
    }
    let mut prf_obj = serde_json::Map::new();
    if include_enabled_flag {
        prf_obj.insert("enabled".to_string(), Value::Bool(true));
    }
    if let Some(first_salt) = has_first {
        let mut results = serde_json::Map::new();
        results.insert(
            "first".to_string(),
            Value::String(compute_prf_output(private_key_encoded, first_salt)?),
        );
        if let Some(second_salt) = has_second {
            results.insert(
                "second".to_string(),
                Value::String(compute_prf_output(private_key_encoded, second_salt)?),
            );
        }
        prf_obj.insert("results".to_string(), Value::Object(results));
    }
    Ok(Some(Value::Object(prf_obj)))
}

fn cbor_write_type_len(out: &mut Vec<u8>, major: u8, val: u64) {
    let prefix = major << 5;
    if val <= 23 {
        out.push(prefix | (val as u8));
    } else if val <= u8::MAX as u64 {
        out.push(prefix | 24);
        out.push(val as u8);
    } else if val <= u16::MAX as u64 {
        out.push(prefix | 25);
        out.extend_from_slice(&(val as u16).to_be_bytes());
    } else if val <= u32::MAX as u64 {
        out.push(prefix | 26);
        out.extend_from_slice(&(val as u32).to_be_bytes());
    } else {
        out.push(prefix | 27);
        out.extend_from_slice(&val.to_be_bytes());
    }
}

fn cbor_write_int(out: &mut Vec<u8>, val: i64) {
    if val >= 0 {
        cbor_write_type_len(out, 0, val as u64);
    } else {
        let encoded = (-1 - val) as u64;
        cbor_write_type_len(out, 1, encoded);
    }
}

fn cbor_write_bytes(out: &mut Vec<u8>, bytes: &[u8]) {
    cbor_write_type_len(out, 2, bytes.len() as u64);
    out.extend_from_slice(bytes);
}

fn cbor_write_text(out: &mut Vec<u8>, text: &str) {
    cbor_write_type_len(out, 3, text.len() as u64);
    out.extend_from_slice(text.as_bytes());
}

fn cbor_write_map_header(out: &mut Vec<u8>, len: usize) {
    cbor_write_type_len(out, 5, len as u64);
}

/// Encode COSE EC2 P-256 public key map in canonical CTAP2 order: { 1: 2, 3: -7, -1: 1, -2: x, -3: y }.
pub fn encode_cose_ec2_p256_key(x: &[u8; 32], y: &[u8; 32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(80);
    cbor_write_map_header(&mut out, 5);
    cbor_write_int(&mut out, 1); // kty
    cbor_write_int(&mut out, 2); // EC2
    cbor_write_int(&mut out, 3); // alg
    cbor_write_int(&mut out, -7); // ES256
    cbor_write_int(&mut out, -1); // crv
    cbor_write_int(&mut out, 1); // P-256
    cbor_write_int(&mut out, -2); // x coordinate
    cbor_write_bytes(&mut out, x);
    cbor_write_int(&mut out, -3); // y coordinate
    cbor_write_bytes(&mut out, y);
    out
}

/// Encode COSE OKP Ed25519 public key map in canonical CTAP2 order: { 1: 1, 3: -8, -1: 6, -2: pub_bytes }.
pub fn encode_cose_okp_ed25519_key(pub_bytes: &[u8; 32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(48);
    cbor_write_map_header(&mut out, 4);
    cbor_write_int(&mut out, 1); // kty
    cbor_write_int(&mut out, 1); // OKP
    cbor_write_int(&mut out, 3); // alg
    cbor_write_int(&mut out, -8); // EdDSA
    cbor_write_int(&mut out, -1); // crv
    cbor_write_int(&mut out, 6); // Ed25519
    cbor_write_int(&mut out, -2); // x (public key bytes)
    cbor_write_bytes(&mut out, pub_bytes);
    out
}

/// Encode WebAuthn attestationObject with fmt="none": { "fmt": "none", "attStmt": {}, "authData": bstr }.
pub fn encode_none_attestation_object(auth_data: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(auth_data.len() + 32);
    cbor_write_map_header(&mut out, 3);
    cbor_write_text(&mut out, "fmt");
    cbor_write_text(&mut out, "none");
    cbor_write_text(&mut out, "attStmt");
    cbor_write_map_header(&mut out, 0);
    cbor_write_text(&mut out, "authData");
    cbor_write_bytes(&mut out, auth_data);
    out
}

fn build_client_data_json(
    kind: &str,
    challenge_b64u: &str,
    origin: &str,
    cross_origin: bool,
) -> Result<Vec<u8>, CoreError> {
    let challenge = challenge_b64u.trim();
    if challenge.is_empty() {
        return Err(CoreError::Validation("缺少 WebAuthn challenge".to_string()));
    }
    let val = json!({
        "type": kind,
        "challenge": challenge,
        "origin": origin.trim(),
        "crossOrigin": cross_origin,
    });
    serde_json::to_vec(&val)
        .map_err(|e| CoreError::Internal(format!("序列化 clientDataJSON 失败: {e}")))
}

fn choose_cose_algorithm(pub_key_cred_params: &[i32]) -> Result<i32, CoreError> {
    if pub_key_cred_params.is_empty() {
        return Ok(COSE_ALG_ES256);
    }
    for alg in pub_key_cred_params {
        if *alg == COSE_ALG_ES256 || *alg == COSE_ALG_EDDSA {
            return Ok(*alg);
        }
    }
    Err(CoreError::Validation(
        "网站未支持 ES256 (-7) 或 Ed25519 (-8) Passkey 算法".to_string(),
    ))
}

/// Generate a new WebAuthn ES256 (-7) or Ed25519 (-8) Passkey credential and attestation response.
pub fn create_passkey_credential(
    params: &PasskeyCreateParams,
) -> Result<PasskeyCreateOutput, CoreError> {
    let rp_id = normalize_rp_id(&params.rp_id);
    let origin = params.origin.trim().to_string();
    if !rp_id_matches_origin_ext(&rp_id, &origin, &params.custom_equivalent_domains) {
        return Err(CoreError::Validation(format!(
            "Passkey RP ID ({rp_id}) 与页面源 ({origin}) 不匹配"
        )));
    }
    let chosen_alg = choose_cose_algorithm(&params.pub_key_cred_params)?;

    let user_id_bytes = decode_b64u_or_b64(&params.user_id_b64u)?;
    if user_id_bytes.is_empty() || user_id_bytes.len() > 64 {
        return Err(CoreError::Validation(
            "WebAuthn user.id 长度必须在 1..=64 字节之间".to_string(),
        ));
    }

    let (private_key_pkcs8_b64u, public_key_spki_b64u, cose_key) = if chosen_alg == COSE_ALG_EDDSA {
        let ed_key = ed25519_dalek::SigningKey::generate(&mut OsRng);
        let seed = ed_key.to_bytes();
        let pub_bytes = ed_key.verifying_key().to_bytes();
        let pkcs8 = encode_ed25519_pkcs8_der(&seed);
        let spki = encode_ed25519_spki_der(&pub_bytes);
        let cose = encode_cose_okp_ed25519_key(&pub_bytes);
        (encode_b64u(&pkcs8), encode_b64u(&spki), cose)
    } else {
        let secret_key = p256::SecretKey::random(&mut OsRng);
        let pkcs8_der = secret_key
            .to_pkcs8_der()
            .map_err(|e| CoreError::Crypto(format!("导出 Passkey PKCS#8 私钥失败: {e}")))?;
        let public_key = secret_key.public_key();
        let spki_der = public_key
            .to_public_key_der()
            .map_err(|e| CoreError::Crypto(format!("导出 Passkey SPKI 公钥失败: {e}")))?;
        let point = public_key.to_encoded_point(false);
        let x_bytes: [u8; 32] = point
            .x()
            .ok_or_else(|| CoreError::Crypto("缺少 P-256 公钥 X 坐标".to_string()))?
            .as_slice()
            .try_into()
            .map_err(|_| CoreError::Crypto("P-256 公钥 X 坐标长度无效".to_string()))?;
        let y_bytes: [u8; 32] = point
            .y()
            .ok_or_else(|| CoreError::Crypto("缺少 P-256 公钥 Y 坐标".to_string()))?
            .as_slice()
            .try_into()
            .map_err(|_| CoreError::Crypto("P-256 公钥 Y 坐标长度无效".to_string()))?;
        let cose = encode_cose_ec2_p256_key(&x_bytes, &y_bytes);
        (
            encode_b64u(pkcs8_der.as_bytes()),
            encode_b64u(spki_der.as_ref()),
            cose,
        )
    };

    let cred_uuid = Uuid::new_v4();
    let cred_id_bytes = cred_uuid.as_bytes();
    let cred_id_b64u = encode_b64u(cred_id_bytes);
    let rp_hash = Sha256::digest(rp_id.as_bytes());

    // Flags: UP (0x01) | UV (0x04) | BE (0x08) | BS (0x10) | AT (0x40) = 0x5d
    let flags: u8 = 0x5d;
    let sign_count: u32 = 0;

    let mut auth_data = Vec::with_capacity(37 + 18 + cred_id_bytes.len() + cose_key.len());
    auth_data.extend_from_slice(&rp_hash);
    auth_data.push(flags);
    auth_data.extend_from_slice(&sign_count.to_be_bytes());
    auth_data.extend_from_slice(&KEYSMITH_AAGUID);
    auth_data.extend_from_slice(&(cred_id_bytes.len() as u16).to_be_bytes());
    auth_data.extend_from_slice(cred_id_bytes);
    auth_data.extend_from_slice(&cose_key);

    let attestation_object = encode_none_attestation_object(&auth_data);
    let client_data_json = build_client_data_json(
        "webauthn.create",
        &params.challenge_b64u,
        &origin,
        params.cross_origin,
    )?;

    let transports = vec!["internal".to_string(), "hybrid".to_string()];
    let rp_name = if params.rp_name.trim().is_empty() {
        rp_id.clone()
    } else {
        params.rp_name.trim().to_string()
    };
    let user_name = params.user_name.trim().to_string();
    let user_display_name = if params.user_display_name.trim().is_empty() {
        user_name.clone()
    } else {
        params.user_display_name.trim().to_string()
    };

    let prf_ext = build_prf_extension_result(
        &private_key_pkcs8_b64u,
        true,
        params.prf_requested,
        params.prf_eval_first_b64u.as_deref(),
        params.prf_eval_second_b64u.as_deref(),
    )?;

    let credential = PasskeyCredential {
        credential_id: cred_uuid.to_string(),
        rp_id: rp_id.clone(),
        rp_name,
        user_handle: STANDARD.encode(&user_id_bytes),
        user_name,
        user_display_name,
        algorithm: chosen_alg,
        private_key_pkcs8: private_key_pkcs8_b64u,
        public_key_spki: public_key_spki_b64u.clone(),
        sign_count,
        discoverable: params.discoverable,
        aaguid: KEYSMITH_AAGUID_STR.to_string(),
        transports: transports.clone(),
        backed_up: true,
        created_at: Utc::now().to_rfc3339(),
        last_used_at: None,
    };

    let attachment = match params.authenticator_attachment.as_deref().map(str::trim) {
        Some("cross-platform") => "cross-platform",
        _ => "platform",
    };

    let mut ext_results = json!({
        "credProps": {
            "rk": params.discoverable,
        }
    });
    if let Some(prf_val) = prf_ext {
        ext_results["prf"] = prf_val;
    }

    let response_json = json!({
        "id": cred_id_b64u,
        "rawId": cred_id_b64u,
        "type": "public-key",
        "authenticatorAttachment": attachment,
        "response": {
            "clientDataJSON": encode_b64u(&client_data_json),
            "attestationObject": encode_b64u(&attestation_object),
            "authenticatorData": encode_b64u(&auth_data),
            "publicKey": public_key_spki_b64u,
            "publicKeyAlgorithm": chosen_alg,
            "transports": transports,
        },
        "clientExtensionResults": ext_results,
    });

    Ok(PasskeyCreateOutput {
        credential,
        response_json,
    })
}

/// Sign a WebAuthn assertion challenge using an existing ES256 (-7) or Ed25519 (-8) Passkey credential.
/// Returns `(next_sign_count, assertion_response_json)`.
pub fn assert_passkey_credential(
    passkey: &PasskeyCredential,
    params: &PasskeyAssertParams,
) -> Result<(u32, Value), CoreError> {
    let rp_id = normalize_rp_id(&params.rp_id);
    let origin = params.origin.trim().to_string();
    if !rp_id_matches_origin_ext(&rp_id, &origin, &params.custom_equivalent_domains) {
        return Err(CoreError::Validation(format!(
            "Passkey RP ID ({rp_id}) 与页面源 ({origin}) 不匹配"
        )));
    }
    let stored_rp = normalize_rp_id(&passkey.rp_id);
    if stored_rp != rp_id
        && !domains_are_equivalent(&stored_rp, &rp_id, &params.custom_equivalent_domains)
    {
        return Err(CoreError::Validation(format!(
            "Passkey 所属域名 ({}) 与请求 RP ID ({rp_id}) 不一致",
            passkey.rp_id
        )));
    }
    if passkey.algorithm != COSE_ALG_ES256 && passkey.algorithm != COSE_ALG_EDDSA {
        return Err(CoreError::Validation(format!(
            "当前仅支持 ES256 (-7) 与 Ed25519 (-8) Passkey 签名，不支持算法 {}",
            passkey.algorithm
        )));
    }

    let next_sign_count = passkey.sign_count.saturating_add(1);

    let client_data_json = build_client_data_json(
        "webauthn.get",
        &params.challenge_b64u,
        &origin,
        params.cross_origin,
    )?;
    let client_data_hash = Sha256::digest(&client_data_json);
    let rp_hash = Sha256::digest(rp_id.as_bytes());

    // Flags: UP (0x01) | UV (0x04) | BE (0x08) | BS (0x10) = 0x1d
    let flags: u8 = 0x1d;
    let mut auth_data = Vec::with_capacity(37);
    auth_data.extend_from_slice(&rp_hash);
    auth_data.push(flags);
    auth_data.extend_from_slice(&next_sign_count.to_be_bytes());

    let mut signed_payload = Vec::with_capacity(auth_data.len() + client_data_hash.len());
    signed_payload.extend_from_slice(&auth_data);
    signed_payload.extend_from_slice(&client_data_hash);

    let signature_b64u = if passkey.algorithm == COSE_ALG_EDDSA {
        let ed_key = decode_ed25519_signing_key(&passkey.private_key_pkcs8)?;
        let sig = ed_key.sign(&signed_payload);
        encode_b64u(&sig.to_bytes())
    } else {
        let signing_key = decode_pkcs8_signing_key(&passkey.private_key_pkcs8)?;
        let sig: DerSignature = signing_key.sign(&signed_payload);
        encode_b64u(sig.as_bytes())
    };

    let cred_id_bytes = decode_credential_id_bytes(&passkey.credential_id)?;
    let cred_id_b64u = encode_b64u(&cred_id_bytes);
    let user_handle_bytes = decode_b64u_or_b64(&passkey.user_handle).unwrap_or_default();
    let user_handle_val = if user_handle_bytes.is_empty() {
        Value::Null
    } else {
        Value::String(encode_b64u(&user_handle_bytes))
    };

    let mut ext_results = serde_json::Map::new();
    if let Some(prf_val) = build_prf_extension_result(
        &passkey.private_key_pkcs8,
        false,
        false,
        params.prf_eval_first_b64u.as_deref(),
        params.prf_eval_second_b64u.as_deref(),
    )? {
        ext_results.insert("prf".to_string(), prf_val);
    }

    let response_json = json!({
        "id": cred_id_b64u,
        "rawId": cred_id_b64u,
        "type": "public-key",
        "authenticatorAttachment": "platform",
        "response": {
            "clientDataJSON": encode_b64u(&client_data_json),
            "authenticatorData": encode_b64u(&auth_data),
            "signature": signature_b64u,
            "userHandle": user_handle_val,
        },
        "clientExtensionResults": Value::Object(ext_results),
    });

    Ok((next_sign_count, response_json))
}
