use std::time::{SystemTime, UNIX_EPOCH};

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use hmac::{Hmac, Mac};
use sha1::Sha1;
use sha2::{Sha256, Sha512};

use crate::domain::TotpCode;
use crate::error::CoreError;

const BASE32_ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TotpAlgorithm {
    Sha1,
    Sha256,
    Sha512,
}

struct ParsedTotp {
    secret: String,
    digits: usize,
    period: u64,
    algorithm: TotpAlgorithm,
}

fn parse_totp_input(secret_or_uri: &str) -> ParsedTotp {
    let trimmed = secret_or_uri.trim();
    if trimmed.to_ascii_lowercase().starts_with("otpauth://") {
        if let Ok(parsed) = url::Url::parse(trimmed) {
            let mut secret = String::new();
            let mut digits: usize = 6;
            let mut period: u64 = 30;
            let mut algorithm = TotpAlgorithm::Sha1;

            for (k, v) in parsed.query_pairs() {
                match k.as_ref() {
                    "secret" => secret = v.into_owned(),
                    "digits" => {
                        if let Ok(d) = v.parse::<usize>() {
                            if d == 6 || d == 8 {
                                digits = d;
                            }
                        }
                    }
                    "period" => {
                        if let Ok(p) = v.parse::<u64>() {
                            if p > 0 {
                                period = p;
                            }
                        }
                    }
                    "algorithm" => {
                        algorithm = match v.to_ascii_uppercase().as_str() {
                            "SHA256" => TotpAlgorithm::Sha256,
                            "SHA512" => TotpAlgorithm::Sha512,
                            _ => TotpAlgorithm::Sha1,
                        };
                    }
                    _ => {}
                }
            }
            return ParsedTotp {
                secret,
                digits,
                period,
                algorithm,
            };
        }
    }

    ParsedTotp {
        secret: trimmed.to_string(),
        digits: 6,
        period: 30,
        algorithm: TotpAlgorithm::Sha1,
    }
}

pub fn decode_base32(input: &str) -> Vec<u8> {
    let mut bits: u32 = 0;
    let mut value: u32 = 0;
    let mut output = Vec::new();

    for ch in input.bytes() {
        let up = ch.to_ascii_uppercase();
        if let Some(idx) = BASE32_ALPHABET.iter().position(|&b| b == up) {
            value = (value << 5) | (idx as u32);
            bits += 5;
            if bits >= 8 {
                output.push(((value >> (bits - 8)) & 0xff) as u8);
                bits -= 8;
            }
        }
    }
    output
}

fn format_code_digits(code: &str) -> String {
    match code.len() {
        6 => format!("{} {}", &code[..3], &code[3..]),
        8 => format!("{} {}", &code[..4], &code[4..]),
        _ => code.to_string(),
    }
}

pub fn compute_totp(secret_or_uri: &str) -> Result<TotpCode, CoreError> {
    let now_secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| CoreError::Internal(e.to_string()))?
        .as_secs();
    Ok(compute_totp_at(secret_or_uri, now_secs))
}

pub fn compute_totp_at(secret_or_uri: &str, epoch_secs: u64) -> TotpCode {
    let parsed = parse_totp_input(secret_or_uri);
    let period = parsed.period.max(1);
    let counter = epoch_secs / period;
    let remaining_seconds = period - (epoch_secs % period);
    let digits = parsed.digits;

    let key_bytes = decode_base32(&parsed.secret);
    if key_bytes.is_empty() {
        let fallback = "0".repeat(digits);
        return TotpCode {
            formatted_code: format_code_digits(&fallback),
            code: fallback,
            remaining_seconds,
            period,
        };
    }

    let counter_bytes = counter.to_be_bytes();
    let hmac_bytes: Vec<u8> = match parsed.algorithm {
        TotpAlgorithm::Sha1 => {
            let mut mac = <Hmac<Sha1> as Mac>::new_from_slice(&key_bytes).expect("HMAC key");
            mac.update(&counter_bytes);
            mac.finalize().into_bytes().to_vec()
        }
        TotpAlgorithm::Sha256 => {
            let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(&key_bytes).expect("HMAC key");
            mac.update(&counter_bytes);
            mac.finalize().into_bytes().to_vec()
        }
        TotpAlgorithm::Sha512 => {
            let mut mac = <Hmac<Sha512> as Mac>::new_from_slice(&key_bytes).expect("HMAC key");
            mac.update(&counter_bytes);
            mac.finalize().into_bytes().to_vec()
        }
    };

    let offset = (hmac_bytes[hmac_bytes.len() - 1] & 0x0f) as usize;
    let binary = (((hmac_bytes[offset] & 0x7f) as u32) << 24)
        | ((hmac_bytes[offset + 1] as u32) << 16)
        | ((hmac_bytes[offset + 2] as u32) << 8)
        | (hmac_bytes[offset + 3] as u32);

    let modulo = 10_u32.pow(digits as u32);
    let code = format!("{:0width$}", binary % modulo, width = digits);
    let formatted_code = format_code_digits(&code);

    TotpCode {
        code,
        formatted_code,
        remaining_seconds,
        period,
    }
}

fn is_strict_base32_secret(raw: &str) -> bool {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return false;
    }
    let valid_chars = trimmed
        .bytes()
        .all(|b| matches!(b, b'A'..=b'Z' | b'a'..=b'z' | b'2'..=b'7' | b'=' | b' ' | b'-'));
    if !valid_chars {
        return false;
    }
    decode_base32(trimmed).len() >= 10
}

fn detect_totp_in_gray(img: &image::GrayImage) -> Option<String> {
    let mut prepared = rqrr::PreparedImage::prepare(img.clone());
    let grids = prepared.detect_grids();

    let mut decoded_values = Vec::new();
    for grid in grids {
        if let Ok((_meta, content)) = grid.decode() {
            let trimmed = content.trim().to_string();
            if !trimmed.is_empty() {
                decoded_values.push(trimmed);
            }
        }
    }

    if let Some(uri) = decoded_values
        .iter()
        .find(|v| v.to_ascii_lowercase().starts_with("otpauth://"))
    {
        return Some(uri.clone());
    }

    decoded_values
        .into_iter()
        .find(|v| is_strict_base32_secret(v))
}

/// Decode a QR code image from raw bytes (PNG/JPEG/WebP) and extract an `otpauth://` URI
/// or strict Base32 TOTP secret. Tries full-res, half-res (for high-DPI screens), and
/// color-inverted luma (for dark-mode QR codes).
pub fn parse_totp_qr_bytes(bytes: &[u8]) -> Result<String, CoreError> {
    let gray = image::load_from_memory(bytes)
        .map_err(|e| CoreError::Validation(format!("无法识别的图片格式: {e}")))?
        .to_luma8();

    if let Some(found) = detect_totp_in_gray(&gray) {
        return Ok(found);
    }

    let working_gray = if gray.width() > 1400 || gray.height() > 1000 {
        let half = image::imageops::resize(
            &gray,
            (gray.width() / 2).max(1),
            (gray.height() / 2).max(1),
            image::imageops::FilterType::Triangle,
        );
        if let Some(found) = detect_totp_in_gray(&half) {
            return Ok(found);
        }
        half
    } else {
        gray
    };

    let mut inverted = working_gray.clone();
    for px in inverted.pixels_mut() {
        px.0[0] = 255_u8.saturating_sub(px.0[0]);
    }
    if let Some(found) = detect_totp_in_gray(&inverted) {
        return Ok(found);
    }

    Err(CoreError::Validation(
        "未在图片中检测到有效的 TOTP 二维码".to_string(),
    ))
}

/// Decode a QR code image (base64-encoded PNG/JPEG/WebP, optional `data:image/...;base64,` prefix)
/// and extract an `otpauth://` URI or Base32 TOTP secret.
pub fn parse_totp_qr_image(image_base64: &str) -> Result<String, CoreError> {
    let raw_b64 = image_base64
        .trim()
        .split_once("base64,")
        .map(|(_, rest)| rest)
        .unwrap_or_else(|| image_base64.trim());

    let bytes = B64
        .decode(raw_b64)
        .map_err(|e| CoreError::Validation(format!("二维码图片 Base64 解码失败: {e}")))?;

    parse_totp_qr_bytes(&bytes)
}
