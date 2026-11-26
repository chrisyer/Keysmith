use zeroize::Zeroizing;

use crate::error::CoreError;

/// Platform abstraction for biometric-protected key storage (e.g. macOS Keychain + Touch ID ACL).
pub trait BiometricKeyStore: Send + Sync {
    fn is_available(&self) -> bool;

    /// Persist the 64-byte UserSymmetricKey into the OS Keychain protected by biometry.
    fn save_unlock_key(&self, account_id: &str, key: &[u8]) -> Result<(), CoreError>;

    /// Prompt biometric authentication and return the 64-byte UserSymmetricKey.
    fn load_unlock_key(
        &self,
        account_id: &str,
        reason: &str,
    ) -> Result<Zeroizing<Vec<u8>>, CoreError>;

    /// Remove the stored unlock key for the given account.
    fn delete_unlock_key(&self, account_id: &str) -> Result<(), CoreError>;
}

/// Platform abstraction for secure clipboard operations with concealed/transient marking.
pub trait ClipboardManager: Send + Sync {
    fn copy_secret(
        &self,
        text: &str,
        label: &str,
        is_sensitive: bool,
        clear_after_secs: u64,
    ) -> Result<(), CoreError>;

    fn clear_now(&self) -> Result<(), CoreError>;
}

/// Default no-op biometric store for headless/test environments.
#[derive(Debug, Default)]
pub struct NoopBiometricKeyStore;

impl BiometricKeyStore for NoopBiometricKeyStore {
    fn is_available(&self) -> bool {
        false
    }

    fn save_unlock_key(&self, _account_id: &str, _key: &[u8]) -> Result<(), CoreError> {
        Err(CoreError::Biometric("当前环境不支持生物识别钥匙串".to_string()))
    }

    fn load_unlock_key(
        &self,
        _account_id: &str,
        _reason: &str,
    ) -> Result<Zeroizing<Vec<u8>>, CoreError> {
        Err(CoreError::Biometric("当前环境不支持生物识别钥匙串".to_string()))
    }

    fn delete_unlock_key(&self, _account_id: &str) -> Result<(), CoreError> {
        Ok(())
    }
}

/// Default no-op clipboard manager for headless/test environments.
#[derive(Debug, Default)]
pub struct NoopClipboardManager;

impl ClipboardManager for NoopClipboardManager {
    fn copy_secret(
        &self,
        _text: &str,
        _label: &str,
        _is_sensitive: bool,
        _clear_after_secs: u64,
    ) -> Result<(), CoreError> {
        Ok(())
    }

    fn clear_now(&self) -> Result<(), CoreError> {
        Ok(())
    }
}
