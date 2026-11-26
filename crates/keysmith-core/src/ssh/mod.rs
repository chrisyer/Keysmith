use ed25519_dalek::{Signer, SigningKey};
use rand::rngs::OsRng;
use ssh_key::{
    private::{Ed25519Keypair, KeypairData},
    HashAlg, LineEnding, PrivateKey,
};

use crate::domain::SshKeyPair;
use crate::error::CoreError;

/// Generate a fresh Ed25519 SSH keypair in OpenSSH format with SHA-256 fingerprint.
pub fn ssh_generate_ed25519(comment: Option<&str>) -> Result<SshKeyPair, CoreError> {
    let signing = SigningKey::generate(&mut OsRng);
    let keypair = Ed25519Keypair::from(&signing);
    let comment_str = comment
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .unwrap_or("keysmith@macos");

    let priv_key = PrivateKey::new(KeypairData::Ed25519(keypair), comment_str)
        .map_err(|e| CoreError::Crypto(format!("构造 OpenSSH 私钥失败: {e}")))?;

    let private_key_openssh = priv_key
        .to_openssh(LineEnding::LF)
        .map_err(|e| CoreError::Crypto(format!("导出 OpenSSH 私钥失败: {e}")))?
        .to_string();

    let public_key = priv_key
        .public_key()
        .to_openssh()
        .map_err(|e| CoreError::Crypto(format!("导出 OpenSSH 公钥失败: {e}")))?;

    let fingerprint_sha256 = priv_key.fingerprint(HashAlg::Sha256).to_string();

    Ok(SshKeyPair {
        public_key,
        private_key_openssh,
        fingerprint_sha256,
    })
}

/// Sign arbitrary challenge bytes using an OpenSSH Ed25519 private key (returns 64-byte raw signature).
pub fn ssh_sign_ed25519(private_key_openssh: &str, data: &[u8]) -> Result<Vec<u8>, CoreError> {
    let priv_key = PrivateKey::from_openssh(private_key_openssh.trim())
        .map_err(|e| CoreError::Crypto(format!("解析 OpenSSH 私钥失败: {e}")))?;

    let KeypairData::Ed25519(kp) = priv_key.key_data() else {
        return Err(CoreError::Crypto("仅支持 Ed25519 SSH 私钥签名".to_string()));
    };

    let signing = SigningKey::try_from(kp)
        .map_err(|e| CoreError::Crypto(format!("转换 Ed25519 签名密钥失败: {e}")))?;
    let sig = signing.sign(data);
    Ok(sig.to_bytes().to_vec())
}

/// Compute SHA-256 fingerprint from an OpenSSH public key string (`ssh-ed25519 AAAA...`).
pub fn ssh_fingerprint_from_public(public_key_openssh: &str) -> Option<String> {
    let pk = ssh_key::PublicKey::from_openssh(public_key_openssh.trim()).ok()?;
    Some(pk.fingerprint(HashAlg::Sha256).to_string())
}
