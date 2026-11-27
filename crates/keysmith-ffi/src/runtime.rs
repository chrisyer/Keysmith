use std::future::Future;

use crate::mapper::FfiError;

/// Tokio runtime wrapper configured for either the main app (multi-thread)
/// or an iOS AutoFill extension (single `current_thread` for low memory).
pub struct FfiRuntime {
    rt: tokio::runtime::Runtime,
}

impl FfiRuntime {
    pub fn new(is_extension: bool) -> Result<Self, FfiError> {
        let mut builder = if is_extension {
            tokio::runtime::Builder::new_current_thread()
        } else {
            let mut mt = tokio::runtime::Builder::new_multi_thread();
            mt.thread_name("keysmith-ffi-worker");
            mt
        };
        let rt = builder
            .enable_all()
            .build()
            .map_err(|e| FfiError::Internal {
                msg: format!("初始化异步运行时失败: {e}"),
            })?;
        Ok(Self { rt })
    }

    pub fn block_on<F: Future>(&self, fut: F) -> F::Output {
        self.rt.block_on(fut)
    }
}
