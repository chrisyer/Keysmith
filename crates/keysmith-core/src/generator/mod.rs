pub mod masked_email;

use std::collections::HashSet;

use rand::{rngs::OsRng, RngCore};

use crate::domain::{GeneratorMode, GeneratorOptions, GeneratorResult, PasswordStrength};

pub use masked_email::{generate_catch_all_alias, generate_masked_email};

const LOWER: &[u8] = b"abcdefghijkmnopqrstuvwxyz";
const LOWER_FULL: &[u8] = b"abcdefghijklmnopqrstuvwxyz";
const UPPER: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ";
const UPPER_FULL: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS: &[u8] = b"23456789";
const DIGITS_FULL: &[u8] = b"0123456789";
const SYMBOLS: &[u8] = b"!@#$%^&*-_=+?";

const WORD_LIST: &[&str] = &[
    "amber", "anchor", "alpine", "apricot", "atlas", "aurora", "bamboo", "beacon",
    "birch", "blossom", "breeze", "bridge", "bronze", "canyon", "cedar", "cinder",
    "citadel", "clover", "cobalt", "compass", "copper", "coral", "cosmos", "crater",
    "crimson", "crystal", "cypress", "dawn", "delta", "dolphin", "dragon", "drift",
    "echo", "eclipse", "emerald", "ember", "falcon", "feather", "fern", "fjord",
    "flint", "forest", "forge", "fossil", "fountain", "frost", "galaxy", "garden",
    "garnet", "glacier", "glade", "granite", "harbor", "harvest", "haven", "hazel",
    "hearth", "helium", "horizon", "indigo", "iris", "island", "ivory", "jade",
    "jasper", "juniper", "kestrel", "keystone", "lagoon", "lantern", "larch", "laurel",
    "legend", "lichen", "linen", "lotus", "lunar", "lynx", "magnet", "maple",
    "marble", "meadow", "mercury", "meteor", "mirage", "monarch", "mosaic", "moss",
    "nebula", "nectar", "nickel", "nimbus", "north", "oak", "oasis", "obsidian",
    "ocean", "ochre", "olive", "onyx", "opal", "orbit", "orchid", "osprey",
    "otter", "oxide", "pacific", "palace", "panther", "papyrus", "paragon", "pebble",
    "pelican", "pepper", "petal", "phantom", "phoenix", "photon", "pine", "pioneer",
    "planet", "plaza", "plum", "polar", "poplar", "prism", "pulse", "quartz",
    "quiver", "radium", "rain", "raven", "redwood", "reef", "relic", "ripple",
    "river", "robin", "rocket", "saffron", "sage", "salmon", "sapphire", "saturn",
    "scarlet", "sequoia", "shadow", "sierra", "silver", "slate", "solstice", "sonar",
    "sparrow", "spectra", "sphinx", "spruce", "starlight", "summit", "sunbeam", "sundial",
    "sunrise", "swift", "sycamore", "talon", "tangerine", "temple", "thistle", "thunder",
    "timber", "topaz", "torrent", "trident", "tundra", "turmeric", "umbra", "valley",
    "velvet", "verbena", "vertex", "vesper", "violet", "voyager", "walnut", "whisper",
    "willow", "winter", "wisteria", "zenith", "zephyr", "zircon",
];

fn random_index(max: usize) -> usize {
    if max <= 1 {
        return 0;
    }
    let max_u32 = max as u32;
    let limit = (u32::MAX / max_u32) * max_u32;
    loop {
        let n = OsRng.next_u32();
        if n < limit {
            return (n % max_u32) as usize;
        }
    }
}

pub fn evaluate_password_strength(password: &str) -> PasswordStrength {
    if password.is_empty() {
        return PasswordStrength {
            score: 0,
            label: "空密码".to_string(),
            entropy_bits: 0,
        };
    }

    let mut pool: u32 = 0;
    if password.chars().any(|c| c.is_ascii_lowercase()) {
        pool += 26;
    }
    if password.chars().any(|c| c.is_ascii_uppercase()) {
        pool += 26;
    }
    if password.chars().any(|c| c.is_ascii_digit()) {
        pool += 10;
    }
    if password.chars().any(|c| !c.is_ascii_alphanumeric()) {
        pool += 32;
    }

    let char_len = password.chars().count() as f64;
    let unique_chars = password.chars().collect::<HashSet<char>>().len() as f64;
    let effective_len = char_len.min(unique_chars * 1.45);
    let mut entropy = (effective_len * (pool.max(2) as f64).log2()).round() as u32;

    let lower = password.to_lowercase();
    let has_common_prefix = [
        "password", "admin", "qwerty", "123456", "summer", "welcome", "letmein",
    ]
    .iter()
    .any(|p| lower.starts_with(p));
    let has_triple_repeat = has_consecutive_repeat(password, 3);

    if char_len < 10.0 || has_common_prefix || has_triple_repeat {
        entropy = entropy.min(38);
    }

    if char_len <= 12.0 && is_alpha_plus_trailing_digits(password) {
        entropy = entropy.min(44);
    }

    let (score, label) = if entropy >= 80 {
        (4, "极强")
    } else if entropy >= 60 {
        (3, "强")
    } else if entropy >= 45 {
        (2, "中等")
    } else if entropy >= 28 {
        (1, "较弱")
    } else {
        (0, "极弱")
    };

    PasswordStrength {
        score,
        label: label.to_string(),
        entropy_bits: entropy,
    }
}

fn has_consecutive_repeat(s: &str, min_run: usize) -> bool {
    let mut prev: Option<char> = None;
    let mut run = 0;
    for ch in s.chars() {
        if Some(ch) == prev {
            run += 1;
            if run >= min_run {
                return true;
            }
        } else {
            prev = Some(ch);
            run = 1;
        }
    }
    false
}

fn is_alpha_plus_trailing_digits(s: &str) -> bool {
    let mut chars = s.chars().peekable();
    let mut alpha_count = 0;
    while let Some(&c) = chars.peek() {
        if c.is_ascii_alphabetic() {
            alpha_count += 1;
            chars.next();
        } else {
            break;
        }
    }
    if alpha_count == 0 {
        return false;
    }
    let mut digit_count = 0;
    while let Some(&c) = chars.peek() {
        if c.is_ascii_digit() {
            digit_count += 1;
            chars.next();
        } else {
            break;
        }
    }
    if !(1..=4).contains(&digit_count) {
        return false;
    }
    match chars.next() {
        None => true,
        Some(c) if matches!(c, '!' | '?' | '.') => chars.next().is_none(),
        _ => false,
    }
}

pub fn generate_secret(options: &GeneratorOptions) -> GeneratorResult {
    match options.mode {
        GeneratorMode::Pin => {
            let len = options.pin_length.clamp(4, 12);
            let mut pin = String::with_capacity(len);
            for _ in 0..len {
                let ch = DIGITS_FULL[random_index(DIGITS_FULL.len())] as char;
                pin.push(ch);
            }
            let strength = evaluate_password_strength(&pin);
            GeneratorResult {
                value: pin,
                strength,
            }
        }
        GeneratorMode::Passphrase => {
            let count = options.word_count.clamp(3, 8);
            let mut words = Vec::with_capacity(count);
            for _ in 0..count {
                let raw = WORD_LIST[random_index(WORD_LIST.len())];
                let word = if options.capitalize {
                    let mut chars = raw.chars();
                    match chars.next() {
                        Some(first) => format!("{}{}", first.to_ascii_uppercase(), chars.as_str()),
                        None => String::new(),
                    }
                } else {
                    raw.to_string()
                };
                words.push(word);
            }
            if options.include_number_in_phrase && !words.is_empty() {
                let idx = random_index(words.len());
                let num = random_index(90) + 10;
                words[idx].push_str(&num.to_string());
            }
            let sep = if options.separator.is_empty() {
                "-"
            } else {
                options.separator.as_str()
            };
            let value = words.join(sep);
            let strength = evaluate_password_strength(&value);
            GeneratorResult { value, strength }
        }
        GeneratorMode::Password => {
            let len = options.length.clamp(8, 64);
            let lower = if options.exclude_ambiguous {
                LOWER
            } else {
                LOWER_FULL
            };
            let upper = if options.exclude_ambiguous {
                UPPER
            } else {
                UPPER_FULL
            };
            let digits = if options.exclude_ambiguous {
                DIGITS
            } else {
                DIGITS_FULL
            };

            let mut groups: Vec<&[u8]> = vec![lower, upper];
            if options.include_digits {
                groups.push(digits);
            }
            if options.include_symbols {
                groups.push(SYMBOLS);
            }

            let all_chars: Vec<u8> = groups.iter().flat_map(|g| g.iter().copied()).collect();
            let mut chars: Vec<u8> = Vec::with_capacity(len);

            for g in &groups {
                if chars.len() < len {
                    chars.push(g[random_index(g.len())]);
                }
            }
            while chars.len() < len {
                chars.push(all_chars[random_index(all_chars.len())]);
            }

            // Fisher-Yates shuffle with OsRng
            for i in (1..chars.len()).rev() {
                let j = random_index(i + 1);
                chars.swap(i, j);
            }

            let value = String::from_utf8(chars).unwrap_or_default();
            let strength = evaluate_password_strength(&value);
            GeneratorResult { value, strength }
        }
    }
}
