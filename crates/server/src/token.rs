//! Zufallswerte für IDs, Link, Sitzungen und das Admin-Passwort.

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use rand::RngExt;

/// Ohne leicht verwechselbare Zeichen wie 0/O oder 1/l, weil es abgetippt wird.
const PASSWORD_ALPHABET: &[u8] = b"abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PASSWORD_LEN: usize = 16;

fn random_bytes<const N: usize>() -> [u8; N] {
    rand::rng().random()
}

pub fn new_id(prefix: &str) -> String {
    let bytes: [u8; 6] = random_bytes();
    let hex: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
    format!("{prefix}_{hex}")
}

/// 128 Bit Zufall, Base64URL-kodiert, 22 Zeichen.
pub fn new_link_token() -> String {
    URL_SAFE_NO_PAD.encode(random_bytes::<16>())
}

pub fn new_session_token() -> String {
    URL_SAFE_NO_PAD.encode(random_bytes::<32>())
}

pub fn new_password() -> String {
    let mut rng = rand::rng();
    (0..PASSWORD_LEN)
        .map(|_| PASSWORD_ALPHABET[rng.random_range(0..PASSWORD_ALPHABET.len())] as char)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn link_token_hat_22_zeichen() {
        assert_eq!(new_link_token().len(), 22);
        assert_ne!(new_link_token(), new_link_token());
    }

    #[test]
    fn id_hat_praefix() {
        assert!(new_id("scn").starts_with("scn_"));
    }

    #[test]
    fn passwort_hat_feste_laenge() {
        assert_eq!(new_password().len(), PASSWORD_LEN);
    }
}
