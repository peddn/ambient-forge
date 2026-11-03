//! Fehlercodes, die Admin-Oberfläche und REST-Antworten gemeinsam nutzen.

use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde_json::json;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ApiError {
    NotFound,
    WrongProject,
    SceneActive,
    AssetInUse,
    InvalidValue,
    Unauthorized,
    Internal,
}

impl ApiError {
    pub fn code(self) -> &'static str {
        match self {
            Self::NotFound => "not_found",
            Self::WrongProject => "wrong_project",
            Self::SceneActive => "scene_active",
            Self::AssetInUse => "asset_in_use",
            Self::InvalidValue => "invalid_value",
            Self::Unauthorized => "unauthorized",
            Self::Internal => "internal",
        }
    }

    fn status(self) -> StatusCode {
        match self {
            Self::NotFound => StatusCode::NOT_FOUND,
            Self::WrongProject | Self::SceneActive | Self::AssetInUse => StatusCode::CONFLICT,
            Self::InvalidValue => StatusCode::BAD_REQUEST,
            Self::Unauthorized => StatusCode::UNAUTHORIZED,
            Self::Internal => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status(), Json(json!({ "code": self.code() }))).into_response()
    }
}
