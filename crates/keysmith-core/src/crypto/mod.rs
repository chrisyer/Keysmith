use aes::cipher::{block_padding::Pkcs7, BlockDecryptMut, BlockEncryptMut, KeyIvInit};
use argon2::{Algorithm, Argon2, Params, Version};
use base64::{
    engine::general_purpose::STANDARD as B64,
    engine::general_purpose::URL_SAFE_NO_PAD,
    Engine as _,
};
use hkdf::Hkdf;
use hmac::{Hmac, Mac};
use pbkdf2::pbkdf2_hmac;
use rand::{rngs::OsRng, RngCore};
use rsa::pkcs8::{DecodePrivateKey, EncodePrivateKey, EncodePublicKey};
use rsa::{Oaep, RsaPrivateKey};
use serde::{Deserialize, Serialize};
use sha1::Sha1;
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;
use zeroize::{Zeroize, Zeroizing};

use crate::error::CoreError;

type Aes256CbcEnc = cbc::Encryptor<aes::Aes256>;
type Aes256CbcDec = cbc::Decryptor<aes::Aes256>;
type HmacSha256 = Hmac<Sha256>;

pub const KDF_PBKDF2_SHA256: u8 = 0;
pub const KDF_ARGON2ID: u8 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KdfConfig {
    #[serde(alias = "Kdf")]
    pub kdf: u8,
    #[serde(alias = "KdfIterations")]
    pub kdf_iterations: u32,
    #[serde(default, alias = "KdfMemory", skip_serializing_if = "Option::is_none")]
    pub kdf_memory: Option<u32>,
    #[serde(default, alias = "KdfParallelism", skip_serializing_if = "Option::is_none")]
    pub kdf_parallelism: Option<u32>,
}

impl Default for KdfConfig {
    fn default() -> Self {
        Self {
            kdf: KDF_ARGON2ID,
            kdf_iterations: 3,
            kdf_memory: Some(64),
            kdf_parallelism: Some(4),
        }
    }
}

impl KdfConfig {
    pub fn pbkdf2_default() -> Self {
        Self {
            kdf: KDF_PBKDF2_SHA256,
            kdf_iterations: 600_000,
            kdf_memory: None,
            kdf_parallelism: None,
        }
    }

    pub fn label(&self) -> &'static str {
        match self.kdf {
            KDF_ARGON2ID => "Argon2id",
            _ => "PBKDF2",
        }
    }

    pub fn validate(&self) -> Result<(), CoreError> {
        match self.kdf {
            KDF_PBKDF2_SHA256 => {
                if self.kdf_iterations < 1 {
                    return Err(CoreError::Validation("PBKDF2 迭代次数必须大于 0".to_string()));
                }
            }
            KDF_ARGON2ID => {
                let mem = self.kdf_memory.unwrap_or(64);
                let par = self.kdf_parallelism.unwrap_or(4);
                if self.kdf_iterations < 1 || mem < 1 || par < 1 {
                    return Err(CoreError::Validation("Argon2id KDF 参数无效".to_string()));
                }
            }
            other => {
                return Err(CoreError::Validation(format!("不支持的 KDF 类型: {other}")));
            }
        }
        Ok(())
    }
}

/// 32-byte Master Key derived from Master Password + normalized Email.
/// Intentionally does NOT implement Debug or Serialize.
pub struct MasterKey(Zeroizing<[u8; 32]>);

impl MasterKey {
    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
}

/// 64-byte Stretched Master Key (32B enc_key + 32B mac_key) expanded via HKDF-SHA256.
pub struct StretchedMasterKey {
    enc_key: Zeroizing<[u8; 32]>,
    mac_key: Zeroizing<[u8; 32]>,
}

impl StretchedMasterKey {
    pub fn enc_key(&self) -> &[u8; 32] {
        &self.enc_key
    }

    pub fn mac_key(&self) -> &[u8; 32] {
        &self.mac_key
    }
}

/// 64-byte User Symmetric Key (32B enc_key + 32B mac_key) used for vault cipher/folder encryption.
#[derive(Clone)]
pub struct UserSymmetricKey {
    enc_key: Zeroizing<[u8; 32]>,
    mac_key: Zeroizing<[u8; 32]>,
}

impl UserSymmetricKey {
    pub fn generate() -> Self {
        let mut enc = Zeroizing::new([0u8; 32]);
        let mut mac = Zeroizing::new([0u8; 32]);
        OsRng.fill_bytes(&mut *enc);
        OsRng.fill_bytes(&mut *mac);
        Self {
            enc_key: enc,
            mac_key: mac,
        }
    }

    pub fn from_bytes(bytes: &[u8]) -> Result<Self, CoreError> {
        if bytes.len() != 64 {
            return Err(CoreError::Crypto(format!(
                "UserSymmetricKey 长度必须为 64 字节，实际为 {}",
                bytes.len()
            )));
        }
        let mut enc = Zeroizing::new([0u8; 32]);
        let mut mac = Zeroizing::new([0u8; 32]);
        enc.copy_from_slice(&bytes[..32]);
        mac.copy_from_slice(&bytes[32..]);
        Ok(Self {
            enc_key: enc,
            mac_key: mac,
        })
    }

    pub fn to_bytes(&self) -> Zeroizing<[u8; 64]> {
        let mut out = Zeroizing::new([0u8; 64]);
        out[..32].copy_from_slice(&*self.enc_key);
        out[32..].copy_from_slice(&*self.mac_key);
        out
    }

    pub fn enc_key(&self) -> &[u8; 32] {
        &self.enc_key
    }

    pub fn mac_key(&self) -> &[u8; 32] {
        &self.mac_key
    }

    pub fn encrypt_string(&self, plaintext: &str) -> Result<String, CoreError> {
        encrypt_bytes(plaintext.as_bytes(), &self.enc_key, &self.mac_key)
    }

    pub fn decrypt_string(&self, enc_str: &str) -> Result<Zeroizing<String>, CoreError> {
        decrypt_string(enc_str, &self.enc_key, &self.mac_key)
    }
}

/// Normalize email per Bitwarden specification before KDF salting.
pub fn normalize_email(email: &str) -> String {
    email.trim().to_lowercase()
}

/// Derive 32-byte Master Key from Master Password + email + KdfConfig.
pub fn derive_master_key(
    master_password: &str,
    email: &str,
    kdf: &KdfConfig,
) -> Result<MasterKey, CoreError> {
    kdf.validate()?;
    let normalized = normalize_email(email);
    let mut out = Zeroizing::new([0u8; 32]);

    match kdf.kdf {
        KDF_PBKDF2_SHA256 => {
            pbkdf2_hmac::<Sha256>(
                master_password.as_bytes(),
                normalized.as_bytes(),
                kdf.kdf_iterations,
                &mut *out,
            );
        }
        KDF_ARGON2ID => {
            // Bitwarden Argon2id uses SHA-256(lowercase(email)) as the 32-byte salt
            let salt = Sha256::digest(normalized.as_bytes());
            let mem_kib = kdf.kdf_memory.unwrap_or(64).saturating_mul(1024);
            let params = Params::new(
                mem_kib,
                kdf.kdf_iterations,
                kdf.kdf_parallelism.unwrap_or(4),
                Some(32),
            )
            .map_err(|e| CoreError::Crypto(format!("Argon2 参数构造失败: {e}")))?;
            let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
            argon2
                .hash_password_into(master_password.as_bytes(), &salt, &mut *out)
                .map_err(|e| CoreError::Crypto(format!("Argon2id 派生失败: {e}")))?;
        }
        _ => unreachable!("validated above"),
    }

    Ok(MasterKey(out))
}

/// Derive Bitwarden MasterPasswordHash (PBKDF2-SHA256, 1 round, salt = master_password).
pub fn derive_master_password_hash(master_key: &MasterKey, master_password: &str) -> String {
    let mut out = Zeroizing::new([0u8; 32]);
    pbkdf2_hmac::<Sha256>(
        master_key.as_bytes(),
        master_password.as_bytes(),
        1,
        &mut *out,
    );
    B64.encode(&*out)
}

/// Expand 32B MasterKey via HKDF-SHA256::expand (no Extract) into 64B StretchedMasterKey.
pub fn stretch_master_key(master_key: &MasterKey) -> Result<StretchedMasterKey, CoreError> {
    let hk = Hkdf::<Sha256>::from_prk(master_key.as_bytes())
        .map_err(|e| CoreError::Crypto(format!("HKDF 初始化失败: {e}")))?;
    let mut enc_key = Zeroizing::new([0u8; 32]);
    let mut mac_key = Zeroizing::new([0u8; 32]);
    hk.expand(b"enc", &mut *enc_key)
        .map_err(|e| CoreError::Crypto(format!("HKDF enc 扩展失败: {e}")))?;
    hk.expand(b"mac", &mut *mac_key)
        .map_err(|e| CoreError::Crypto(format!("HKDF mac 扩展失败: {e}")))?;
    Ok(StretchedMasterKey { enc_key, mac_key })
}

/// Parsed Bitwarden EncString (supports Type 2 and legacy Type 0).
#[derive(Debug, Clone)]
pub enum EncString {
    /// `0.<iv_b64>|<ct_b64>` (AesCbc256_B64)
    AesCbc256 { iv: [u8; 16], ct: Vec<u8> },
    /// `2.<iv_b64>|<ct_b64>|<mac_b64>` (AesCbc256_HmacSha256_B64)
    AesCbc256HmacSha256 {
        iv: [u8; 16],
        ct: Vec<u8>,
        mac: [u8; 32],
    },
}

impl EncString {
    pub fn parse(raw: &str) -> Result<Self, CoreError> {
        let (type_str, payload) = raw
            .split_once('.')
            .ok_or_else(|| CoreError::Crypto("EncString 缺少类型前缀".to_string()))?;

        let parts: Vec<&str> = payload.split('|').collect();
        match type_str {
            "2" => {
                if parts.len() != 3 {
                    return Err(CoreError::Crypto("Type 2 EncString 段数错误".to_string()));
                }
                let iv_vec = B64
                    .decode(parts[0])
                    .map_err(|e| CoreError::Crypto(format!("IV Base64 解码失败: {e}")))?;
                let iv: [u8; 16] = iv_vec
                    .try_into()
                    .map_err(|_| CoreError::Crypto("IV 长度必须为 16 字节".to_string()))?;
                let ct = B64
                    .decode(parts[1])
                    .map_err(|e| CoreError::Crypto(format!("密文 Base64 解码失败: {e}")))?;
                let mac_vec = B64
                    .decode(parts[2])
                    .map_err(|e| CoreError::Crypto(format!("MAC Base64 解码失败: {e}")))?;
                let mac: [u8; 32] = mac_vec
                    .try_into()
                    .map_err(|_| CoreError::Crypto("MAC 长度必须为 32 字节".to_string()))?;
                Ok(Self::AesCbc256HmacSha256 { iv, ct, mac })
            }
            "0" => {
                if parts.len() != 2 {
                    return Err(CoreError::Crypto("Type 0 EncString 段数错误".to_string()));
                }
                let iv_vec = B64
                    .decode(parts[0])
                    .map_err(|e| CoreError::Crypto(format!("IV Base64 解码失败: {e}")))?;
                let iv: [u8; 16] = iv_vec
                    .try_into()
                    .map_err(|_| CoreError::Crypto("IV 长度必须为 16 字节".to_string()))?;
                let ct = B64
                    .decode(parts[1])
                    .map_err(|e| CoreError::Crypto(format!("密文 Base64 解码失败: {e}")))?;
                Ok(Self::AesCbc256 { iv, ct })
            }
            other => Err(CoreError::Crypto(format!("不支持的 EncString 类型: {other}"))),
        }
    }
}

/// Encrypt raw bytes into Bitwarden Type 2 EncString (`2.<iv>|<ct>|<mac>`).
pub fn encrypt_bytes(
    plaintext: &[u8],
    enc_key: &[u8; 32],
    mac_key: &[u8; 32],
) -> Result<String, CoreError> {
    let mut iv = [0u8; 16];
    OsRng.fill_bytes(&mut iv);

    let ct = Aes256CbcEnc::new_from_slices(enc_key, &iv)
        .map_err(|e| CoreError::Crypto(format!("AES-CBC 初始化失败: {e}")))?
        .encrypt_padded_vec_mut::<Pkcs7>(plaintext);

    let mut hmac = <HmacSha256 as Mac>::new_from_slice(mac_key)
        .map_err(|e| CoreError::Crypto(format!("HMAC 初始化失败: {e}")))?;
    hmac.update(&iv);
    hmac.update(&ct);
    let mac = hmac.finalize().into_bytes();

    Ok(format!(
        "2.{}|{}|{}",
        B64.encode(iv),
        B64.encode(ct),
        B64.encode(mac)
    ))
}

/// Verify-then-decrypt Bitwarden EncString (Type 2 constant-time HMAC check, plus Type 0 read support).
pub fn decrypt_bytes(
    enc_str: &str,
    enc_key: &[u8; 32],
    mac_key: &[u8; 32],
) -> Result<Zeroizing<Vec<u8>>, CoreError> {
    let parsed = EncString::parse(enc_str)?;
    match parsed {
        EncString::AesCbc256HmacSha256 { iv, ct, mac } => {
            let mut hmac = <HmacSha256 as Mac>::new_from_slice(mac_key)
                .map_err(|e| CoreError::Crypto(format!("HMAC 初始化失败: {e}")))?;
            hmac.update(&iv);
            hmac.update(&ct);
            let computed = hmac.finalize().into_bytes();
            if computed.as_slice().ct_eq(&mac).unwrap_u8() != 1 {
                return Err(CoreError::Crypto(
                    "密文 MAC 校验失败（密钥错误或数据已被篡改）".to_string(),
                ));
            }
            let pt = Aes256CbcDec::new_from_slices(enc_key, &iv)
                .map_err(|e| CoreError::Crypto(format!("AES-CBC 初始化失败: {e}")))?
                .decrypt_padded_vec_mut::<Pkcs7>(&ct)
                .map_err(|e| CoreError::Crypto(format!("AES-CBC 解密填充失败: {e}")))?;
            Ok(Zeroizing::new(pt))
        }
        EncString::AesCbc256 { iv, ct } => {
            let pt = Aes256CbcDec::new_from_slices(enc_key, &iv)
                .map_err(|e| CoreError::Crypto(format!("AES-CBC 初始化失败: {e}")))?
                .decrypt_padded_vec_mut::<Pkcs7>(&ct)
                .map_err(|e| CoreError::Crypto(format!("AES-CBC 解密填充失败: {e}")))?;
            Ok(Zeroizing::new(pt))
        }
    }
}

pub fn decrypt_string(
    enc_str: &str,
    enc_key: &[u8; 32],
    mac_key: &[u8; 32],
) -> Result<Zeroizing<String>, CoreError> {
    let bytes = decrypt_bytes(enc_str, enc_key, mac_key)?;
    let s = String::from_utf8(bytes.to_vec())
        .map_err(|e| CoreError::Crypto(format!("解密明文 UTF-8 解析失败: {e}")))?;
    Ok(Zeroizing::new(s))
}

/// Encrypt the 64-byte UserSymmetricKey with the 64-byte StretchedMasterKey.
pub fn protect_user_symmetric_key(
    usk: &UserSymmetricKey,
    smk: &StretchedMasterKey,
) -> Result<String, CoreError> {
    let raw = usk.to_bytes();
    encrypt_bytes(&*raw, smk.enc_key(), smk.mac_key())
}

/// Decrypt the 64-byte UserSymmetricKey using StretchedMasterKey.
pub fn unprotect_user_symmetric_key(
    protected_key_enc: &str,
    smk: &StretchedMasterKey,
) -> Result<UserSymmetricKey, CoreError> {
    let pt = decrypt_bytes(protected_key_enc, smk.enc_key(), smk.mac_key())?;
    UserSymmetricKey::from_bytes(&pt)
}

/// Generate an RSA-2048 keypair for Bitwarden account registration (`keys.publicKey` & `keys.encryptedPrivateKey`).
pub fn generate_rsa_keypair(usk: &UserSymmetricKey) -> Result<(String, String), CoreError> {
    let mut rng = OsRng;
    let private_key = RsaPrivateKey::new(&mut rng, 2048)
        .map_err(|e| CoreError::Crypto(format!("RSA-2048 密钥生成失败: {e}")))?;
    let public_der = private_key
        .to_public_key()
        .to_public_key_der()
        .map_err(|e| CoreError::Crypto(format!("RSA 公钥导出失败: {e}")))?;
    let mut private_der = private_key
        .to_pkcs8_der()
        .map_err(|e| CoreError::Crypto(format!("RSA 私钥导出失败: {e}")))?;

    let public_b64 = B64.encode(public_der.as_bytes());
    let encrypted_priv = encrypt_bytes(private_der.as_bytes(), usk.enc_key(), usk.mac_key())?;
    // Zeroize private key bytes buffer if mutable
    let _ = &mut private_der;
    Ok((public_b64, encrypted_priv))
}

/// Decrypt a Bitwarden RSA-OAEP EncString (`3.<b64>` / `4.<b64>` / `5.<b64>` / `6.<b64>`)
/// using a PKCS#8 DER-encoded RSA private key.
pub fn decrypt_rsa_oaep(
    enc_str: &str,
    private_key_pkcs8_der: &[u8],
) -> Result<Zeroizing<Vec<u8>>, CoreError> {
    let trimmed = enc_str.trim();
    let (type_str, payload) = trimmed
        .split_once('.')
        .ok_or_else(|| CoreError::Crypto("Invalid RSA EncString format".to_string()))?;
    let cipher_part = payload.split('|').next().unwrap_or(payload).trim();
    let ciphertext = B64
        .decode(cipher_part)
        .map_err(|e| CoreError::Crypto(format!("RSA ciphertext Base64 decode failed: {e}")))?;

    let private_key = RsaPrivateKey::from_pkcs8_der(private_key_pkcs8_der)
        .map_err(|e| CoreError::Crypto(format!("RSA private key PKCS#8 decode failed: {e}")))?;

    let plaintext = match type_str.trim() {
        "3" | "5" => private_key
            .decrypt(Oaep::new::<Sha256>(), &ciphertext)
            .map_err(|e| CoreError::Crypto(format!("RSA-OAEP-SHA256 decrypt failed: {e}")))?,
        "4" | "6" => private_key
            .decrypt(Oaep::new::<Sha1>(), &ciphertext)
            .map_err(|e| CoreError::Crypto(format!("RSA-OAEP-SHA1 decrypt failed: {e}")))?,
        other => {
            return Err(CoreError::Crypto(format!(
                "Unsupported RSA EncString cipher type: {other}"
            )))
        }
    };
    Ok(Zeroizing::new(plaintext))
}

/// Decrypt an Organization's 64-byte symmetric key using the user's encrypted RSA private key.
pub fn decrypt_org_symmetric_key(
    org_key_enc: &str,
    encrypted_private_key: &str,
    usk: &UserSymmetricKey,
) -> Result<UserSymmetricKey, CoreError> {
    let priv_der = decrypt_bytes(encrypted_private_key, usk.enc_key(), usk.mac_key())?;
    let org_key_bytes = decrypt_rsa_oaep(org_key_enc, &priv_der)?;
    UserSymmetricKey::from_bytes(&org_key_bytes)
}

/// Generate a random 128-bit (16-byte) Bitwarden Send secret seed.
pub fn generate_send_seed() -> Zeroizing<[u8; 16]> {
    let mut seed = Zeroizing::new([0u8; 16]);
    OsRng.fill_bytes(&mut *seed);
    seed
}

/// Derive a 64-byte UserSymmetricKey from a 16-byte Send seed using HKDF-SHA256
/// with salt `b"bitwarden-send"` and info `b"send"`.
pub fn derive_send_key(seed: &[u8; 16]) -> Result<UserSymmetricKey, CoreError> {
    let hk = Hkdf::<Sha256>::new(Some(b"bitwarden-send"), seed);
    let mut key64 = Zeroizing::new([0u8; 64]);
    hk.expand(b"send", &mut *key64)
        .map_err(|e| CoreError::Crypto(format!("Send HKDF 派生失败: {e}")))?;
    UserSymmetricKey::from_bytes(&*key64)
}

/// Hash a Send access password with PBKDF2-HMAC-SHA256 (100,000 rounds, salt = 16-byte Send seed).
pub fn hash_send_password(password: &str, seed: &[u8; 16]) -> String {
    let mut out = Zeroizing::new([0u8; 32]);
    pbkdf2_hmac::<Sha256>(password.as_bytes(), seed, 100_000, &mut *out);
    B64.encode(&*out)
}

/// Encrypt binary payload into Bitwarden Type 2 EncBuffer (`[2u8] || iv(16) || mac(32) || ct`).
pub fn encrypt_send_buffer(
    plaintext: &[u8],
    enc_key: &[u8; 32],
    mac_key: &[u8; 32],
) -> Result<Vec<u8>, CoreError> {
    let mut iv = [0u8; 16];
    OsRng.fill_bytes(&mut iv);

    let ct = Aes256CbcEnc::new_from_slices(enc_key, &iv)
        .map_err(|e| CoreError::Crypto(format!("AES-CBC 初始化失败: {e}")))?
        .encrypt_padded_vec_mut::<Pkcs7>(plaintext);

    let mut hmac = <HmacSha256 as Mac>::new_from_slice(mac_key)
        .map_err(|e| CoreError::Crypto(format!("HMAC 初始化失败: {e}")))?;
    hmac.update(&iv);
    hmac.update(&ct);
    let mac = hmac.finalize().into_bytes();

    let mut out = Vec::with_capacity(1 + 16 + 32 + ct.len());
    out.push(2u8);
    out.extend_from_slice(&iv);
    out.extend_from_slice(&mac);
    out.extend_from_slice(&ct);
    Ok(out)
}

/// Build zero-knowledge Send share URL with the 16-byte seed strictly inside the URL fragment.
pub fn build_send_share_url(server_url: &str, access_id: &str, seed: &[u8; 16]) -> String {
    let base = server_url.trim().trim_end_matches('/');
    let frag = URL_SAFE_NO_PAD.encode(seed);
    format!("{base}/#/send/{access_id}/{frag}")
}

/// Utility to wipe a String in-place before dropping.
pub fn zeroize_string(s: &mut String) {
    s.zeroize();
}
