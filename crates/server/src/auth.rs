//! Admin-Passwort und Sitzungen.

use std::sync::Arc;

use argon2::password_hash::{PasswordHasher, PasswordVerifier};
use argon2::{Argon2, PasswordHash};
use axum::extract::{FromRef, FromRequestParts};
use axum::http::request::Parts;
use axum::http::{HeaderMap, header};

use crate::app::App;
use crate::error::ApiError;

pub const SESSION_COOKIE: &str = "ambient_forge_session";

pub fn hash_password(password: &str) -> Result<String, String> {
    Argon2::default()
        .hash_password(password.as_bytes())
        .map(|hash| hash.to_string())
        .map_err(|error| error.to_string())
}

pub fn verify_password(password: &str, hash: &str) -> bool {
    let Ok(parsed) = PasswordHash::new(hash) else {
        return false;
    };
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok()
}

fn cookie_value<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(';'))
        .filter_map(|pair| pair.trim().split_once('='))
        .find(|(key, _)| *key == name)
        .map(|(_, value)| value)
}

pub fn session_from_headers(app: &App, headers: &HeaderMap) -> Option<String> {
    let session = cookie_value(headers, SESSION_COOKIE)?;
    app.lock()
        .sessions
        .contains(session)
        .then(|| session.to_owned())
}

/// Nur für eingeloggte Admins erreichbar.
pub struct AdminSession(pub String);

impl<S> FromRequestParts<S> for AdminSession
where
    Arc<App>: FromRef<S>,
    S: Send + Sync,
{
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let app = Arc::<App>::from_ref(state);
        session_from_headers(&app, &parts.headers)
            .map(AdminSession)
            .ok_or(ApiError::Unauthorized)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    #[test]
    fn passwort_wird_geprueft() {
        let hash = hash_password("geheim").unwrap();
        assert!(hash.starts_with("$argon2"));
        assert!(verify_password("geheim", &hash));
        assert!(!verify_password("falsch", &hash));
        assert!(!verify_password("geheim", "kein-hash"));
    }

    #[test]
    fn cookie_wird_gefunden() {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::COOKIE,
            HeaderValue::from_static("andere=1; ambient_forge_session=abc; weitere=2"),
        );
        assert_eq!(cookie_value(&headers, SESSION_COOKIE), Some("abc"));
        assert_eq!(cookie_value(&headers, "fehlt"), None);
    }
}
