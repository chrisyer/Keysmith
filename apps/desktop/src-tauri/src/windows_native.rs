#![cfg(target_os = "windows")]

use std::ffi::c_void;
use std::fs;
use std::path::{Path, PathBuf};
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
    CloseHandle, GetLastError, GlobalFree, LocalFree, BOOL, HANDLE, HLOCAL, HWND, LPARAM,
    LRESULT, WPARAM,
};
use windows_sys::Win32::Security::Authorization::{
    ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW,
    SetNamedSecurityInfoW, SDDL_REVISION_1, SE_FILE_OBJECT,
};
use windows_sys::Win32::Security::Cryptography::{
    NCryptCreatePersistedKey, NCryptDecrypt, NCryptDeleteKey, NCryptEncrypt, NCryptFinalizeKey,
    NCryptFreeObject, NCryptOpenKey, NCryptOpenStorageProvider, NCryptSetProperty,
    BCRYPT_OAEP_PADDING_INFO, NCRYPT_KEY_HANDLE, NCRYPT_OVERWRITE_KEY_FLAG, NCRYPT_PAD_OAEP_FLAG,
    NCRYPT_PROV_HANDLE,
};
use windows_sys::Win32::Security::{
    GetSecurityDescriptorDacl, GetTokenInformation, TokenUser, ACL, DACL_SECURITY_INFORMATION,
    PSECURITY_DESCRIPTOR, PROTECTED_DACL_SECURITY_INFORMATION, SECURITY_ATTRIBUTES, TOKEN_QUERY,
    TOKEN_USER,
};
use windows_sys::Win32::System::DataExchange::{
    CloseClipboard, EmptyClipboard, OpenClipboard, RegisterClipboardFormatW, SetClipboardData,
};
use windows_sys::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
use windows_sys::Win32::System::RemoteDesktop::{
    WTSRegisterSessionNotification, NOTIFY_FOR_THIS_SESSION,
};
use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
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

struct CurrentUserSecurityDescriptor {
    sd: PSECURITY_DESCRIPTOR,
}

impl Drop for CurrentUserSecurityDescriptor {
    fn drop(&mut self) {
        if !self.sd.is_null() {
            unsafe {
                LocalFree(self.sd as HLOCAL);
            }
        }
    }
}

fn current_user_sid_string() -> Result<String, CoreError> {
    let mut token: HANDLE = null_mut();
    let ok = unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) };
    if ok == 0 || token.is_null() {
        return Err(CoreError::Biometric(format!(
            "Win32 OpenProcessToken failed ({})",
            unsafe { GetLastError() }
        )));
    }
    let mut len: u32 = 0;
    unsafe { GetTokenInformation(token, TokenUser, null_mut(), 0, &mut len) };
    if len == 0 {
        unsafe { CloseHandle(token) };
        return Err(CoreError::Biometric(format!(
            "Win32 GetTokenInformation size query failed ({})",
            unsafe { GetLastError() }
        )));
    }
    let mut buf = vec![0u8; len as usize];
    let ok = unsafe {
        GetTokenInformation(
            token,
            TokenUser,
            buf.as_mut_ptr() as *mut c_void,
            len,
            &mut len,
        )
    };
    unsafe { CloseHandle(token) };
    if ok == 0 {
        return Err(CoreError::Biometric(format!(
            "Win32 GetTokenInformation(TokenUser) failed ({})",
            unsafe { GetLastError() }
        )));
    }
    let user = unsafe { &*(buf.as_ptr() as *const TOKEN_USER) };
    let mut sid_wide: *mut u16 = null_mut();
    let ok = unsafe { ConvertSidToStringSidW(user.User.Sid, &mut sid_wide) };
    if ok == 0 || sid_wide.is_null() {
        return Err(CoreError::Biometric(format!(
            "Win32 ConvertSidToStringSidW failed ({})",
            unsafe { GetLastError() }
        )));
    }
    let mut slen = 0usize;
    unsafe {
        while *sid_wide.add(slen) != 0 {
            slen += 1;
        }
        let sid_str = String::from_utf16_lossy(std::slice::from_raw_parts(sid_wide, slen));
        LocalFree(sid_wide as HLOCAL);
        Ok(sid_str)
    }
}

impl CurrentUserSecurityDescriptor {
    fn new() -> Result<Self, CoreError> {
        let sid = current_user_sid_string()?;
        let sddl = format!("D:P(A;;GA;;;{sid})(A;;GA;;;SY)");
        let sddl_wide = encode_wide_null(&sddl);
        let mut sd: PSECURITY_DESCRIPTOR = null_mut();
        let ok = unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                sddl_wide.as_ptr(),
                SDDL_REVISION_1,
                &mut sd,
                null_mut(),
            )
        };
        if ok == 0 || sd.is_null() {
            return Err(CoreError::Biometric(format!(
                "ConvertStringSecurityDescriptorToSecurityDescriptorW failed ({})",
                unsafe { GetLastError() }
            )));
        }
        Ok(Self { sd })
    }
}

pub fn harden_path_current_user_only(path: &Path) -> Result<(), CoreError> {
    let holder = CurrentUserSecurityDescriptor::new()?;
    let mut dacl_present: BOOL = 0;
    let mut dacl_defaulted: BOOL = 0;
    let mut p_dacl: *mut ACL = null_mut();
    let ok = unsafe {
        GetSecurityDescriptorDacl(holder.sd, &mut dacl_present, &mut p_dacl, &mut dacl_defaulted)
    };
    if ok == 0 || dacl_present == 0 || p_dacl.is_null() {
        return Err(CoreError::Biometric(format!(
            "GetSecurityDescriptorDacl failed ({})",
            unsafe { GetLastError() }
        )));
    }
    let path_wide = encode_wide_null(&path.to_string_lossy());
    let status = unsafe {
        SetNamedSecurityInfoW(
            path_wide.as_ptr(),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
            null_mut(),
            null_mut(),
            p_dacl,
            null_mut(),
        )
    };
    if status != 0 {
        return Err(CoreError::Biometric(format!(
            "SetNamedSecurityInfoW failed ({status})"
        )));
    }
    Ok(())
}

pub fn with_current_user_security_attributes<F, R>(f: F) -> Result<R, String>
where
    F: FnOnce(*mut c_void) -> R,
{
    let holder = CurrentUserSecurityDescriptor::new().map_err(|e| e.to_string())?;
    let mut sa = SECURITY_ATTRIBUTES {
        nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: holder.sd,
        bInheritHandle: 0,
    };
    Ok(f(&mut sa as *mut SECURITY_ATTRIBUTES as *mut c_void))
}

fn account_hash_hex(account_id: &str) -> String {
    let hash = Sha256::digest(account_id.as_bytes());
    hash.iter().map(|b| format!("{b:02x}")).collect()
}

fn biometric_dir() -> Result<PathBuf, CoreError> {
    let base = std::env::var_os("APPDATA")
        .or_else(|| std::env::var_os("LOCALAPPDATA"))
        .map(PathBuf::from)
        .ok_or_else(|| {
            CoreError::Biometric("Cannot resolve Windows APPDATA directory".to_string())
        })?;
    let dir = base.join("dev.keysmith.desktop").join("biometric");
    fs::create_dir_all(&dir)
        .map_err(|e| CoreError::Biometric(format!("Failed to create biometric directory: {e}")))?;
    let _ = harden_path_current_user_only(&dir);
    Ok(dir)
}

fn whkey_path(account_id: &str) -> Result<PathBuf, CoreError> {
    Ok(biometric_dir()?.join(format!("{}.whkey", account_hash_hex(account_id))))
}

fn legacy_dpapi_path(account_id: &str) -> Result<PathBuf, CoreError> {
    Ok(biometric_dir()?.join(format!("{}.dpapi", account_hash_hex(account_id))))
}

fn wh_key_container_name(account_id: &str) -> String {
    format!("Keysmith-Unlock-{}", account_hash_hex(account_id))
}

struct NcryptHandle(usize);
impl Drop for NcryptHandle {
    fn drop(&mut self) {
        if self.0 != 0 {
            unsafe {
                let _ = NCryptFreeObject(self.0);
            }
        }
    }
}

fn open_passport_ksp() -> Result<NcHandleWrapper, CoreError> {
    let mut prov: NCRYPT_PROV_HANDLE = 0;
    let prov_name = encode_wide_null("Microsoft Passport Key Storage Provider");
    let status = unsafe { NCryptOpenStorageProvider(&mut prov, prov_name.as_ptr(), 0) };
    if status != 0 || prov == 0 {
        return Err(CoreError::Biometric(format!(
            "Windows Hello CNG Microsoft Passport Key Storage Provider unavailable (0x{status:08x})"
        )));
    }
    Ok(NcHandleWrapper(prov))
}

type NcHandleWrapper = NcryptHandle;

pub fn keychain_save(account_id: &str, key: &[u8]) -> Result<(), CoreError> {
    let prov = open_passport_ksp()?;
    let container = encode_wide_null(&wh_key_container_name(account_id));

    let mut old_key: NCRYPT_KEY_HANDLE = 0;
    if unsafe { NCryptOpenKey(prov.0, &mut old_key, container.as_ptr(), 0, 0) } == 0 && old_key != 0
    {
        unsafe {
            let _ = NCryptDeleteKey(old_key, 0);
        }
    }

    let alg_rsa = encode_wide_null("RSA");
    let mut key_handle: NCRYPT_KEY_HANDLE = 0;
    let status = unsafe {
        NCryptCreatePersistedKey(
            prov.0,
            &mut key_handle,
            alg_rsa.as_ptr(),
            container.as_ptr(),
            0,
            NCRYPT_OVERWRITE_KEY_FLAG,
        )
    };
    if status != 0 || key_handle == 0 {
        return Err(CoreError::Biometric(format!(
            "Windows Hello NCryptCreatePersistedKey failed (0x{status:08x})"
        )));
    }
    let key_guard = NcryptHandle(key_handle);

    let prop_len = encode_wide_null("Length");
    let key_bits: u32 = 2048;
    let status = unsafe {
        NCryptSetProperty(
            key_guard.0,
            prop_len.as_ptr(),
            &key_bits as *const u32 as *const u8,
            std::mem::size_of::<u32>() as u32,
            0,
        )
    };
    if status != 0 {
        return Err(CoreError::Biometric(format!(
            "Windows Hello NCryptSetProperty(Length) failed (0x{status:08x})"
        )));
    }

    let status = unsafe { NCryptFinalizeKey(key_guard.0, 0) };
    if status != 0 {
        return Err(CoreError::Biometric(format!(
            "Windows Hello NCryptFinalizeKey failed (0x{status:08x})"
        )));
    }

    let sha256_wide = encode_wide_null("SHA256");
    let mut oaep = BCRYPT_OAEP_PADDING_INFO {
        pszAlgId: sha256_wide.as_ptr(),
        pbLabel: null_mut(),
        cbLabel: 0,
    };
    let mut cipher_len: u32 = 0;
    let status = unsafe {
        NCryptEncrypt(
            key_guard.0,
            key.as_ptr(),
            key.len() as u32,
            &mut oaep as *mut BCRYPT_OAEP_PADDING_INFO as *mut c_void,
            null_mut(),
            0,
            &mut cipher_len,
            NCRYPT_PAD_OAEP_FLAG,
        )
    };
    if status != 0 || cipher_len == 0 {
        return Err(CoreError::Biometric(format!(
            "Windows Hello NCryptEncrypt size query failed (0x{status:08x})"
        )));
    }

    let mut cipher = vec![0u8; cipher_len as usize];
    let status = unsafe {
        NCryptEncrypt(
            key_guard.0,
            key.as_ptr(),
            key.len() as u32,
            &mut oaep as *mut BCRYPT_OAEP_PADDING_INFO as *mut c_void,
            cipher.as_mut_ptr(),
            cipher_len,
            &mut cipher_len,
            NCRYPT_PAD_OAEP_FLAG,
        )
    };
    if status != 0 {
        return Err(CoreError::Biometric(format!(
            "Windows Hello NCryptEncrypt failed (0x{status:08x})"
        )));
    }
    cipher.truncate(cipher_len as usize);

    let path = whkey_path(account_id)?;
    fs::write(&path, &cipher)
        .map_err(|e| CoreError::Biometric(format!("Failed to save Windows Hello key blob: {e}")))?;
    harden_path_current_user_only(&path)?;
    if let Ok(legacy) = legacy_dpapi_path(account_id) {
        let _ = fs::remove_file(legacy);
    }
    Ok(())
}

pub fn keychain_load(account_id: &str) -> Result<Zeroizing<Vec<u8>>, CoreError> {
    let path = whkey_path(account_id)?;
    let cipher = fs::read(&path).map_err(|e| {
        if legacy_dpapi_path(account_id).map(|p| p.exists()).unwrap_or(false) {
            CoreError::Biometric(
                "Legacy Windows DPAPI biometric binding is disabled; please unlock once with your master password to re-bind Windows Hello hardware key."
                    .to_string(),
            )
        } else {
            CoreError::Biometric(format!("No Windows Hello hardware key stored: {e}"))
        }
    })?;

    let prov = open_passport_ksp()?;
    let container = encode_wide_null(&wh_key_container_name(account_id));
    let mut key_handle: NCRYPT_KEY_HANDLE = 0;
    let status = unsafe { NCryptOpenKey(prov.0, &mut key_handle, container.as_ptr(), 0, 0) };
    if status != 0 || key_handle == 0 {
        return Err(CoreError::Biometric(format!(
            "Windows Hello NCryptOpenKey failed (0x{status:08x})"
        )));
    }
    let key_guard = NcryptHandle(key_handle);

    let sha256_wide = encode_wide_null("SHA256");
    let mut oaep = BCRYPT_OAEP_PADDING_INFO {
        pszAlgId: sha256_wide.as_ptr(),
        pbLabel: null_mut(),
        cbLabel: 0,
    };
    let mut plain_len: u32 = 0;
    let status = unsafe {
        NCryptDecrypt(
            key_guard.0,
            cipher.as_ptr(),
            cipher.len() as u32,
            &mut oaep as *mut BCRYPT_OAEP_PADDING_INFO as *mut c_void,
            null_mut(),
            0,
            &mut plain_len,
            NCRYPT_PAD_OAEP_FLAG,
        )
    };
    if status != 0 || plain_len == 0 {
        return Err(CoreError::Biometric(format!(
            "Windows Hello NCryptDecrypt size query failed (0x{status:08x})"
        )));
    }

    let mut plain = Zeroizing::new(vec![0u8; plain_len as usize]);
    let status = unsafe {
        NCryptDecrypt(
            key_guard.0,
            cipher.as_ptr(),
            cipher.len() as u32,
            &mut oaep as *mut BCRYPT_OAEP_PADDING_INFO as *mut c_void,
            plain.as_mut_ptr(),
            plain_len,
            &mut plain_len,
            NCRYPT_PAD_OAEP_FLAG,
        )
    };
    if status != 0 {
        return Err(CoreError::Biometric(format!(
            "Windows Hello NCryptDecrypt failed (0x{status:08x})"
        )));
    }
    plain.truncate(plain_len as usize);
    Ok(plain)
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
    if let Ok(prov) = open_passport_ksp() {
        let container = encode_wide_null(&wh_key_container_name(account_id));
        let mut key_handle: NCRYPT_KEY_HANDLE = 0;
        if unsafe { NCryptOpenKey(prov.0, &mut key_handle, container.as_ptr(), 0, 0) } == 0
            && key_handle != 0
        {
            unsafe {
                let _ = NCryptDeleteKey(key_handle, 0);
            }
        }
    }
    if let Ok(wh) = whkey_path(account_id) {
        if wh.exists() {
            fs::remove_file(&wh).map_err(|e| {
                CoreError::Biometric(format!("Failed to remove Windows Hello key blob: {e}"))
            })?;
        }
    }
    if let Ok(legacy) = legacy_dpapi_path(account_id) {
        let _ = fs::remove_file(legacy);
    }
    Ok(())
}

pub fn scan_screen_totp_qr() -> Result<Option<String>, CoreError> {
    use std::io::Cursor;
    use windows_sys::Win32::Graphics::Gdi::{
        BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC,
        GetDIBits, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
        RGBQUAD, SRCCOPY,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetSystemMetrics, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN,
        SM_YVIRTUALSCREEN,
    };

    let vx = unsafe { GetSystemMetrics(SM_XVIRTUALSCREEN) };
    let vy = unsafe { GetSystemMetrics(SM_YVIRTUALSCREEN) };
    let width = unsafe { GetSystemMetrics(SM_CXVIRTUALSCREEN) };
    let height = unsafe { GetSystemMetrics(SM_CYVIRTUALSCREEN) };
    if width <= 0 || height <= 0 {
        return Err(CoreError::Internal(
            "Unable to query Windows virtual screen dimensions".to_string(),
        ));
    }

    let screen_dc = unsafe { GetDC(null_mut()) };
    if screen_dc.is_null() {
        return Err(CoreError::Internal(
            "Win32 GetDC(NULL) failed".to_string(),
        ));
    }
    let mem_dc = unsafe { CreateCompatibleDC(screen_dc) };
    if mem_dc.is_null() {
        unsafe { ReleaseDC(null_mut(), screen_dc) };
        return Err(CoreError::Internal(
            "Win32 CreateCompatibleDC failed".to_string(),
        ));
    }
    let bmp = unsafe { CreateCompatibleBitmap(screen_dc, width, height) };
    if bmp.is_null() {
        unsafe {
            DeleteDC(mem_dc);
            ReleaseDC(null_mut(), screen_dc);
        }
        return Err(CoreError::Internal(
            "Win32 CreateCompatibleBitmap failed".to_string(),
        ));
    }

    let old_obj = unsafe { SelectObject(mem_dc, bmp) };
    let blt_ok = unsafe { BitBlt(mem_dc, 0, 0, width, height, screen_dc, vx, vy, SRCCOPY) };

    let mut rgba_buf = vec![0u8; (width as usize) * (height as usize) * 4];
    let mut bmi = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width,
            biHeight: -height,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB,
            biSizeImage: 0,
            biXPelsPerMeter: 0,
            biYPelsPerMeter: 0,
            biClrUsed: 0,
            biClrImportant: 0,
        },
        bmiColors: [RGBQUAD {
            rgbBlue: 0,
            rgbGreen: 0,
            rgbRed: 0,
            rgbReserved: 0,
        }],
    };
    let dib_rows = if blt_ok != 0 {
        unsafe {
            GetDIBits(
                mem_dc,
                bmp,
                0,
                height as u32,
                rgba_buf.as_mut_ptr() as *mut c_void,
                &mut bmi,
                DIB_RGB_COLORS,
            )
        }
    } else {
        0
    };

    unsafe {
        SelectObject(mem_dc, old_obj);
        DeleteObject(bmp);
        DeleteDC(mem_dc);
        ReleaseDC(null_mut(), screen_dc);
    }

    if blt_ok == 0 || dib_rows == 0 {
        return Err(CoreError::Internal(format!(
            "Failed to capture screen image ({})",
            unsafe { GetLastError() }
        )));
    }

    for px in rgba_buf.chunks_exact_mut(4) {
        px.swap(0, 2);
        px[3] = 255;
    }

    let img = image::RgbaImage::from_raw(width as u32, height as u32, rgba_buf)
        .ok_or_else(|| CoreError::Internal("Failed to construct screen RGBA image".to_string()))?;
    let mut png_bytes = Vec::new();
    img.write_to(&mut Cursor::new(&mut png_bytes), image::ImageFormat::Png)
        .map_err(|e| CoreError::Internal(format!("Failed to encode screen capture: {e}")))?;

    let uri = keysmith_core::totp::parse_totp_qr_bytes(&png_bytes)?;
    Ok(Some(uri))
}
