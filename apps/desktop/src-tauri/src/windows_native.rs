#![cfg(target_os = "windows")]

use std::ffi::c_void;
use std::fs;
use std::path::PathBuf;
use std::ptr::{null, null_mut};
use std::sync::atomic::{AtomicIsize, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use keysmith_core::error::CoreError;
use sha2::{Digest, Sha256};
use windows::core::HSTRING;
use windows::Security::Credentials::UI::{
    UserConsentVerificationResult, UserConsentVerifier, UserConsentVerifierAvailability,
};
use windows_sys::Win32::Foundation::{
    GetLastError, GlobalFree, LocalFree, HLOCAL, HWND, LPARAM, LRESULT, WPARAM,
};
use windows_sys::Win32::Security::Cryptography::{
    CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
};
use windows_sys::Win32::System::DataExchange::{
    CloseClipboard, EmptyClipboard, OpenClipboard, RegisterClipboardFormatW, SetClipboardData,
};
use windows_sys::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
use windows_sys::Win32::System::RemoteDesktop::{
    WTSRegisterSessionNotification, NOTIFY_FOR_THIS_SESSION,
};
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, KEYEVENTF_UNICODE,
    VK_RETURN, VK_TAB,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DispatchMessageW, GetForegroundWindow, GetMessageW,
    GetWindowLongPtrW, GetWindowThreadProcessId, PostQuitMessage, RegisterClassW,
    SetForegroundWindow, SetWindowLongPtrW, TranslateMessage, CREATESTRUCTW, GWLP_USERDATA,
    HWND_MESSAGE, MSG, PBT_APMSUSPEND, WM_CREATE, WM_DESTROY, WM_POWERBROADCAST,
    WM_WTSSESSION_CHANGE, WNDCLASSW, WTS_CONSOLE_DISCONNECT, WTS_REMOTE_DISCONNECT,
    WTS_SESSION_LOCK,
};
use zeroize::Zeroizing;

const CF_UNICODETEXT_FMT: u32 = 13;

fn encode_wide_null(s: &str) -> Vec<u16> {
    let mut wide: Vec<u16> = s.encode_utf16().collect();
    wide.push(0);
    wide
}

unsafe fn set_clipboard_bytes(format: u32, bytes: &[u8]) -> Result<(), CoreError> {
    let hmem = unsafe { GlobalAlloc(GMEM_MOVEABLE, bytes.len()) };
    if hmem.is_null() {
        return Err(CoreError::Clipboard(format!(
            "Win32 GlobalAlloc failed ({})",
            unsafe { GetLastError() }
        )));
    }
    let ptr = unsafe { GlobalLock(hmem) } as *mut u8;
    if ptr.is_null() {
        let err = unsafe { GetLastError() };
        unsafe { GlobalFree(hmem) };
        return Err(CoreError::Clipboard(format!(
            "Win32 GlobalLock failed ({err})"
        )));
    }
    unsafe {
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), ptr, bytes.len());
        GlobalUnlock(hmem);
    }
    let handle = unsafe { SetClipboardData(format, hmem) };
    if handle.is_null() {
        let err = unsafe { GetLastError() };
        unsafe { GlobalFree(hmem) };
        return Err(CoreError::Clipboard(format!(
            "Win32 SetClipboardData failed ({err})"
        )));
    }
    Ok(())
}

unsafe fn set_clipboard_dword_format(format_name: &str, value: u32) {
    let wide = encode_wide_null(format_name);
    let fmt = unsafe { RegisterClipboardFormatW(wide.as_ptr()) };
    if fmt != 0 {
        let _ = unsafe { set_clipboard_bytes(fmt, &value.to_le_bytes()) };
    }
}

pub fn pasteboard_write(text: &str, is_sensitive: bool) -> Result<(), CoreError> {
    let wide = encode_wide_null(text);
    let byte_slice =
        unsafe { std::slice::from_raw_parts(wide.as_ptr() as *const u8, wide.len() * 2) };

    let mut opened = false;
    for _ in 0..6 {
        if unsafe { OpenClipboard(null_mut()) } != 0 {
            opened = true;
            break;
        }
        thread::sleep(Duration::from_millis(8));
    }
    if !opened {
        return Err(CoreError::Clipboard(format!(
            "Failed to open Windows clipboard ({})",
            unsafe { GetLastError() }
        )));
    }

    let res = unsafe {
        if EmptyClipboard() == 0 {
            Err(CoreError::Clipboard(format!(
                "Failed to empty Windows clipboard ({})",
                GetLastError()
            )))
        } else {
            let text_res = set_clipboard_bytes(CF_UNICODETEXT_FMT, byte_slice);
            if text_res.is_ok() && is_sensitive {
                set_clipboard_dword_format("ExcludeClipboardContentFromMonitorProcessing", 1);
                set_clipboard_dword_format("CanIncludeInClipboardHistory", 0);
                set_clipboard_dword_format("CanUploadClipboardContentToCloud", 0);
            }
            text_res
        }
    };

    unsafe {
        CloseClipboard();
    }
    res
}

type TriggerCallback = Arc<dyn Fn(&'static str) + Send + Sync>;

unsafe extern "system" fn observer_wnd_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    match msg {
        WM_CREATE => {
            let cs = unsafe { &*(lparam as *const CREATESTRUCTW) };
            unsafe {
                SetWindowLongPtrW(hwnd, GWLP_USERDATA, cs.lpCreateParams as isize);
                WTSRegisterSessionNotification(hwnd, NOTIFY_FOR_THIS_SESSION);
            }
            0
        }
        WM_WTSSESSION_CHANGE => {
            let ptr = unsafe { GetWindowLongPtrW(hwnd, GWLP_USERDATA) } as *const TriggerCallback;
            if !ptr.is_null() {
                let code = wparam as u32;
                if matches!(
                    code,
                    WTS_SESSION_LOCK | WTS_CONSOLE_DISCONNECT | WTS_REMOTE_DISCONNECT
                ) {
                    let cb = unsafe { &*ptr };
                    cb("screen_lock");
                }
            }
            0
        }
        WM_POWERBROADCAST => {
            if wparam as u32 == PBT_APMSUSPEND {
                let ptr =
                    unsafe { GetWindowLongPtrW(hwnd, GWLP_USERDATA) } as *const TriggerCallback;
                if !ptr.is_null() {
                    let cb = unsafe { &*ptr };
                    cb("system_sleep");
                }
            }
            1
        }
        WM_DESTROY => {
            let ptr = unsafe { GetWindowLongPtrW(hwnd, GWLP_USERDATA) } as *mut TriggerCallback;
            if !ptr.is_null() {
                unsafe {
                    SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0);
                    drop(Box::from_raw(ptr));
                }
            }
            unsafe { PostQuitMessage(0) };
            0
        }
        _ => unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) },
    }
}

pub fn register_sleep_and_screen_lock_observers(on_trigger: TriggerCallback) {
    let _ = thread::Builder::new()
        .name("keysmith-win-session-observer".to_string())
        .spawn(move || unsafe {
            let class_name = encode_wide_null("KeysmithWinSessionObserverClass");
            let wc = WNDCLASSW {
                lpfnWndProc: Some(observer_wnd_proc),
                lpszClassName: class_name.as_ptr(),
                ..std::mem::zeroed()
            };
            RegisterClassW(&wc);

            let cb_ptr = Box::into_raw(Box::new(on_trigger)) as *const c_void;
            let title = encode_wide_null("Keysmith Session Observer");
            let hwnd = CreateWindowExW(
                0,
                class_name.as_ptr(),
                title.as_ptr(),
                0,
                0,
                0,
                0,
                0,
                HWND_MESSAGE,
                null_mut(),
                null_mut(),
                cb_ptr,
            );
            if hwnd.is_null() {
                drop(Box::from_raw(cb_ptr as *mut TriggerCallback));
                return;
            }

            let mut msg: MSG = std::mem::zeroed();
            while GetMessageW(&mut msg, null_mut(), 0, 0) > 0 {
                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        });
}

pub fn biometry_is_available() -> bool {
    let Ok(op) = UserConsentVerifier::CheckAvailabilityAsync() else {
        return false;
    };
    matches!(
        op.get(),
        Ok(UserConsentVerifierAvailability::Available)
    )
}

pub fn biometry_authenticate(reason: &str) -> Result<(), CoreError> {
    let msg = HSTRING::from(reason);
    let op = UserConsentVerifier::RequestVerificationAsync(&msg)
        .map_err(|e| CoreError::Biometric(format!("Windows Hello initialization failed: {e}")))?;
    let res = op
        .get()
        .map_err(|e| CoreError::Biometric(format!("Windows Hello verification failed: {e}")))?;
    if res == UserConsentVerificationResult::Verified {
        Ok(())
    } else {
        Err(CoreError::Biometric(
            "Windows Hello verification was cancelled or did not pass".to_string(),
        ))
    }
}

fn dpapi_key_path(account_id: &str) -> Result<PathBuf, CoreError> {
    let base = std::env::var_os("APPDATA")
        .or_else(|| std::env::var_os("LOCALAPPDATA"))
        .map(PathBuf::from)
        .ok_or_else(|| {
            CoreError::Biometric("Cannot resolve Windows APPDATA directory".to_string())
        })?;
    let dir = base.join("dev.keysmith.desktop").join("biometric");
    fs::create_dir_all(&dir)
        .map_err(|e| CoreError::Biometric(format!("Failed to create DPAPI key directory: {e}")))?;
    let hash = Sha256::digest(account_id.as_bytes());
    let hex: String = hash.iter().map(|b| format!("{b:02x}")).collect();
    Ok(dir.join(format!("{hex}.dpapi")))
}

pub fn keychain_save(account_id: &str, key: &[u8]) -> Result<(), CoreError> {
    let path = dpapi_key_path(account_id)?;
    let in_blob = CRYPT_INTEGER_BLOB {
        cbData: key.len() as u32,
        pbData: key.as_ptr() as *mut u8,
    };
    let mut out_blob = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: null_mut(),
    };
    let ok = unsafe {
        CryptProtectData(
            &in_blob,
            null(),
            null(),
            null_mut(),
            null_mut(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut out_blob,
        )
    };
    if ok == 0 || out_blob.pbData.is_null() {
        return Err(CoreError::Biometric(format!(
            "Windows DPAPI CryptProtectData failed ({})",
            unsafe { GetLastError() }
        )));
    }
    let slice = unsafe { std::slice::from_raw_parts(out_blob.pbData, out_blob.cbData as usize) };
    let write_res = fs::write(&path, slice)
        .map_err(|e| CoreError::Biometric(format!("Failed to save DPAPI key blob: {e}")));
    unsafe {
        LocalFree(out_blob.pbData as HLOCAL);
    }
    write_res
}

pub fn keychain_load(account_id: &str) -> Result<Zeroizing<Vec<u8>>, CoreError> {
    let path = dpapi_key_path(account_id)?;
    let encrypted = fs::read(&path)
        .map_err(|e| CoreError::Biometric(format!("No Windows DPAPI key stored: {e}")))?;
    let in_blob = CRYPT_INTEGER_BLOB {
        cbData: encrypted.len() as u32,
        pbData: encrypted.as_ptr() as *mut u8,
    };
    let mut out_blob = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: null_mut(),
    };
    let ok = unsafe {
        CryptUnprotectData(
            &in_blob,
            null_mut(),
            null(),
            null_mut(),
            null_mut(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut out_blob,
        )
    };
    if ok == 0 || out_blob.pbData.is_null() {
        return Err(CoreError::Biometric(format!(
            "Windows DPAPI CryptUnprotectData failed ({})",
            unsafe { GetLastError() }
        )));
    }
    let plain =
        unsafe { std::slice::from_raw_parts(out_blob.pbData, out_blob.cbData as usize) }.to_vec();
    unsafe {
        LocalFree(out_blob.pbData as HLOCAL);
    }
    Ok(Zeroizing::new(plain))
}

static LAST_EXTERNAL_HWND: AtomicIsize = AtomicIsize::new(0);

pub fn record_frontmost_external_app() {
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_null() {
            return;
        }
        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if pid != 0 && pid != std::process::id() {
            LAST_EXTERNAL_HWND.store(hwnd as isize, Ordering::SeqCst);
        }
    }
}

fn send_vk(vk: u16) -> Result<(), CoreError> {
    let inputs = [
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: vk,
                    wScan: 0,
                    dwFlags: 0,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        },
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: vk,
                    wScan: 0,
                    dwFlags: KEYEVENTF_KEYUP,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        },
    ];
    let sent = unsafe { SendInput(2, inputs.as_ptr(), std::mem::size_of::<INPUT>() as i32) };
    if sent == 0 {
        return Err(CoreError::Internal(format!(
            "Win32 SendInput failed ({})",
            unsafe { GetLastError() }
        )));
    }
    Ok(())
}

fn send_unicode_unit(unit: u16) -> Result<(), CoreError> {
    let inputs = [
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: 0,
                    wScan: unit,
                    dwFlags: KEYEVENTF_UNICODE,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        },
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: 0,
                    wScan: unit,
                    dwFlags: KEYEVENTF_UNICODE | KEYEVENTF_KEYUP,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        },
    ];
    let sent = unsafe { SendInput(2, inputs.as_ptr(), std::mem::size_of::<INPUT>() as i32) };
    if sent == 0 {
        return Err(CoreError::Internal(format!(
            "Win32 SendInput unicode failed ({})",
            unsafe { GetLastError() }
        )));
    }
    Ok(())
}

pub fn auto_type_sequence(steps: &[crate::macos::AutoTypeStep]) -> Result<(), CoreError> {
    let target_hwnd = LAST_EXTERNAL_HWND.load(Ordering::SeqCst);
    if target_hwnd != 0 {
        unsafe {
            SetForegroundWindow(target_hwnd as HWND);
        }
    }
    thread::sleep(Duration::from_millis(140));

    for step in steps {
        match step {
            crate::macos::AutoTypeStep::Text(text) => {
                for u in text.encode_utf16() {
                    send_unicode_unit(u)?;
                    thread::sleep(Duration::from_millis(4));
                }
            }
            crate::macos::AutoTypeStep::Tab => {
                send_vk(VK_TAB)?;
                thread::sleep(Duration::from_millis(35));
            }
            crate::macos::AutoTypeStep::Enter => {
                send_vk(VK_RETURN)?;
            }
        }
    }
    Ok(())
}

pub fn keychain_delete(account_id: &str) -> Result<(), CoreError> {
    let path = dpapi_key_path(account_id)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| {
            CoreError::Biometric(format!("Failed to remove Windows DPAPI key blob: {e}"))
        })?;
    }
    Ok(())
}
