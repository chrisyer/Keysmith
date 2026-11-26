use base64::{
    engine::general_purpose::{STANDARD, STANDARD_NO_PAD, URL_SAFE, URL_SAFE_NO_PAD},
    Engine as _,
};
use chrono::Utc;
use p256::ecdsa::{signature::Signer, DerSignature, SigningKey};
use p256::elliptic_curve::sec1::ToEncodedPoint;
use p256::pkcs8::{DecodePrivateKey, EncodePrivateKey, EncodePublicKey};
use rand::rngs::OsRng;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use url::Url;
use uuid::Uuid;

use crate::domain::PasskeyCredential;
use crate::error::CoreError;

/// Dedicated Keysmith authenticator AAGUID (UUID bytes).
pub const KEYSMITH_AAGUID: [u8; 16] = [
    0x6b, 0x65, 0x79, 0x73, 0x6d, 0x69, 0x74, 0x68, 0x41, 0x41, 0x47, 0x55, 0x49, 0x44, 0x01, 0x00,
];
pub const KEYSMITH_AAGUID_STR: &str = "6b657973-6d69-7468-4141-475549440100";

const COSE_ALG_ES256: i32 = -7;

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
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone)]
pub struct PasskeyCreateOutput {
    pub credential: PasskeyCredential,
    pub response_json: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PasskeyAssertParams {
    pub origin: String,
    pub rp_id: String,
    pub challenge_b64u: String,
    #[serde(default)]
    pub cross_origin: bool,
}

pub fn encode_b64u(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

pub fn now_rfc3339() -> String {
    Utc::now().to_rfc3339()
}

pub fn decode_b64u_or_b64(input: &str) -> Result<Vec<u8>, CoreError> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }
    URL_SAFE_NO_PAD
        .decode(trimmed)
        .or_else(|_| URL_SAFE.decode(trimmed))
        .or_else(|_| STANDARD_NO_PAD.decode(trimmed))
        .or_else(|_| STANDARD.decode(trimmed))
        .map_err(|e| CoreError::Validation(format!("Base64 解码失败: {e}")))
}

/// Normalize a WebAuthn RP ID by trimming whitespace and trailing dots and lowercasing.
pub fn normalize_rp_id(rp_id: &str) -> String {
    rp_id.trim().trim_end_matches('.').to_ascii_lowercase()
}

/// Bitwarden stores UUID credential IDs as hyphenated 36-char UUIDs (16 raw bytes) or Base64URL.
pub fn decode_credential_id_bytes(cred_id: &str) -> Result<Vec<u8>, CoreError> {
    let trimmed = cred_id.trim();
    if trimmed.len() == 36 && trimmed.contains('-') {
        if let Ok(parsed) = Uuid::parse_str(trimmed) {
            return Ok(parsed.as_bytes().to_vec());
        }
    }
    decode_b64u_or_b64(trimmed)
}

/// Validate WebAuthn RP ID against caller origin (exact host or subdomain suffix, HTTPS or localhost).
pub fn rp_id_matches_origin(rp_id: &str, origin: &str) -> bool {
    let rp = normalize_rp_id(rp_id);
    if rp.is_empty() {
        return false;
    }
    let Ok(parsed) = Url::parse(origin.trim()) else {
        return false;
    };
    let Some(host) = parsed.host_str().map(|h| h.to_ascii_lowercase()) else {
        return false;
    };
    let scheme = parsed.scheme();
    let secure = scheme == "https"
        || (scheme == "http"
            && (host == "localhost" || host == "127.0.0.1" || host.ends_with(".localhost")));
    if !secure {
        return false;
    }
    host == rp || host.ends_with(&format!(".{rp}"))
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

/// Generate a new WebAuthn ES256 (P-256) Passkey credential and attestation response.
pub fn create_passkey_credential(
    params: &PasskeyCreateParams,
) -> Result<PasskeyCreateOutput, CoreError> {
    let rp_id = normalize_rp_id(&params.rp_id);
    let origin = params.origin.trim().to_string();
    if !rp_id_matches_origin(&rp_id, &origin) {
        return Err(CoreError::Validation(format!(
            "Passkey RP ID ({rp_id}) 与页面源 ({origin}) 不匹配"
        )));
    }
    if !params.pub_key_cred_params.is_empty()
        && !params.pub_key_cred_params.contains(&COSE_ALG_ES256)
    {
        return Err(CoreError::Validation(
            "网站未支持 ES256 (-7) Passkey 算法".to_string(),
        ));
    }

    let user_id_bytes = decode_b64u_or_b64(&params.user_id_b64u)?;
    if user_id_bytes.is_empty() || user_id_bytes.len() > 64 {
        return Err(CoreError::Validation(
            "WebAuthn user.id 长度必须在 1..=64 字节之间".to_string(),
        ));
    }

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

    let cred_uuid = Uuid::new_v4();
    let cred_id_bytes = cred_uuid.as_bytes();
    let cred_id_b64u = encode_b64u(cred_id_bytes);

    let cose_key = encode_cose_ec2_p256_key(&x_bytes, &y_bytes);
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

    let credential = PasskeyCredential {
        credential_id: cred_uuid.to_string(),
        rp_id: rp_id.clone(),
        rp_name,
        user_handle: STANDARD.encode(&user_id_bytes),
        user_name,
        user_display_name,
        algorithm: COSE_ALG_ES256,
        private_key_pkcs8: encode_b64u(pkcs8_der.as_bytes()),
        public_key_spki: encode_b64u(spki_der.as_ref()),
        sign_count,
        discoverable: params.discoverable,
        aaguid: KEYSMITH_AAGUID_STR.to_string(),
        transports: transports.clone(),
        backed_up: true,
        created_at: Utc::now().to_rfc3339(),
        last_used_at: None,
    };

    let response_json = json!({
        "id": cred_id_b64u,
        "rawId": cred_id_b64u,
        "type": "public-key",
        "authenticatorAttachment": "platform",
        "response": {
            "clientDataJSON": encode_b64u(&client_data_json),
            "attestationObject": encode_b64u(&attestation_object),
            "authenticatorData": encode_b64u(&auth_data),
            "publicKey": encode_b64u(spki_der.as_ref()),
            "publicKeyAlgorithm": COSE_ALG_ES256,
            "transports": transports,
        },
        "clientExtensionResults": {
            "credProps": {
                "rk": params.discoverable,
            }
        }
    });

    Ok(PasskeyCreateOutput {
        credential,
        response_json,
    })
}

/// Sign a WebAuthn assertion challenge using an existing ES256 Passkey credential.
/// Returns `(next_sign_count, assertion_response_json)`.
pub fn assert_passkey_credential(
    passkey: &PasskeyCredential,
    params: &PasskeyAssertParams,
) -> Result<(u32, Value), CoreError> {
    let rp_id = normalize_rp_id(&params.rp_id);
    let origin = params.origin.trim().to_string();
    if !rp_id_matches_origin(&rp_id, &origin) {
        return Err(CoreError::Validation(format!(
            "Passkey RP ID ({rp_id}) 与页面源 ({origin}) 不匹配"
        )));
    }
    if normalize_rp_id(&passkey.rp_id) != rp_id {
        return Err(CoreError::Validation(format!(
            "Passkey 所属域名 ({}) 与请求 RP ID ({rp_id}) 不一致",
            passkey.rp_id
        )));
    }
    if passkey.algorithm != COSE_ALG_ES256 {
        return Err(CoreError::Validation(format!(
            "当前仅支持 ES256 (-7) Passkey 签名，不支持算法 {}",
            passkey.algorithm
        )));
    }

    let signing_key = decode_pkcs8_signing_key(&passkey.private_key_pkcs8)?;
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

    let sig: DerSignature = signing_key.sign(&signed_payload);
    let cred_id_bytes = decode_credential_id_bytes(&passkey.credential_id)?;
    let cred_id_b64u = encode_b64u(&cred_id_bytes);
    let user_handle_bytes = decode_b64u_or_b64(&passkey.user_handle).unwrap_or_default();
    let user_handle_val = if user_handle_bytes.is_empty() {
        Value::Null
    } else {
        Value::String(encode_b64u(&user_handle_bytes))
    };

    let response_json = json!({
        "id": cred_id_b64u,
        "rawId": cred_id_b64u,
        "type": "public-key",
        "authenticatorAttachment": "platform",
        "response": {
            "clientDataJSON": encode_b64u(&client_data_json),
            "authenticatorData": encode_b64u(&auth_data),
            "signature": encode_b64u(sig.as_bytes()),
            "userHandle": user_handle_val,
        },
        "clientExtensionResults": {},
    });

    Ok((next_sign_count, response_json))
}
