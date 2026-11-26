use serde::Serialize;

/// Unified error type for `keysmith-core`, serializable for Tauri IPC boundaries.
#[derive(Debug, thiserror::Error)]
pub enum CoreError {
    #[error("{0}")]
    InvalidState(String),

    #[error("{0}")]
    Validation(String),

    #[error("加密/解密错误: {0}")]
    Crypto(String),

    #[error("{0}")]
    NotFound(String),

    #[error("网络请求失败: {0}")]
    Network(String),

    #[error("{message}")]
    Auth {
        message: String,
        two_factor_required: bool,
        two_factor_providers: Vec<u8>,
    },

    #[error("访问令牌已过期或未授权: {0}")]
    Unauthorized(String),

    #[error("同步冲突: {0}")]
    Conflict(String),

    #[error("本地存储错误: {0}")]
    Storage(String),

    #[error("生物识别错误: {0}")]
    Biometric(String),

    #[error("剪贴板操作失败: {0}")]
    Clipboard(String),

    #[error("内部错误: {0}")]
    Internal(String),
}

impl CoreError {
    pub fn auth(message: impl Into<String>) -> Self {
        Self::Auth {
            message: message.into(),
            two_factor_required: false,
            two_factor_providers: Vec::new(),
        }
    }

    pub fn two_factor_required(message: impl Into<String>, providers: Vec<u8>) -> Self {
        Self::Auth {
            message: message.into(),
            two_factor_required: true,
            two_factor_providers: providers,
        }
    }

    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidState(_) => "INVALID_STATE",
            Self::Validation(_) => "VALIDATION",
            Self::Crypto(_) => "CRYPTO",
            Self::NotFound(_) => "NOT_FOUND",
            Self::Network(_) => "NETWORK",
            Self::Auth {
                two_factor_required: true,
                ..
            } => "TWO_FACTOR_REQUIRED",
            Self::Auth { .. } => "AUTH",
            Self::Unauthorized(_) => "UNAUTHORIZED",
            Self::Conflict(_) => "CONFLICT",
            Self::Storage(_) => "STORAGE",
            Self::Biometric(_) => "BIOMETRIC",
            Self::Clipboard(_) => "CLIPBOARD",
            Self::Internal(_) => "INTERNAL",
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SerializedError<'a> {
    code: &'static str,
    message: String,
    two_factor_required: bool,
    two_factor_providers: &'a [u8],
}

impl Serialize for CoreError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let (two_factor_required, two_factor_providers) = match self {
            Self::Auth {
                two_factor_required,
                two_factor_providers,
                ..
            } => (*two_factor_required, two_factor_providers.as_slice()),
            _ => (false, &[][..]),
        };
        SerializedError {
            code: self.code(),
            message: self.to_string(),
            two_factor_required,
            two_factor_providers,
        }
        .serialize(serializer)
    }
}
