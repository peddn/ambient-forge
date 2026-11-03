//! REST-Schnittstelle der Admin-Oberfläche und Medienauslieferung.

use std::path::PathBuf;
use std::sync::Arc;

use axum::Router;
use axum::body::Body;
use axum::extract::{DefaultBodyLimit, FromRequest, Multipart, Path, Request, State};
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, patch, post, put};
use serde::Deserialize;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tokio::io::AsyncWriteExt;
use tower::ServiceExt;
use tower_http::services::ServeFile;

use crate::app::{App, Change};
use crate::auth::{self, AdminSession, SESSION_COOKIE};
use crate::error::ApiError;
use crate::model::*;
use crate::sniff::{HEAD_LEN, sniff};
use crate::store::{EffectPatch, ScenePatch, TrackPatch};
use crate::token::{new_id, new_session_token};

const UPLOAD_LIMIT: usize = 2 * 1024 * 1024 * 1024;
const CACHE_FOREVER: &str = "public, max-age=31536000, immutable";

type Shared = State<Arc<App>>;
type ApiResult<T = Value> = Result<axum::Json<T>, ApiError>;

/// Wie `Json`, antwortet bei ungültigen Daten aber mit dem Fehlercode `invalid_value`.
struct JsonBody<T>(T);

impl<S, T> FromRequest<S> for JsonBody<T>
where
    S: Send + Sync,
    T: DeserializeOwned,
{
    type Rejection = ApiError;

    async fn from_request(request: Request, state: &S) -> Result<Self, Self::Rejection> {
        axum::Json::<T>::from_request(request, state)
            .await
            .map(|axum::Json(value)| Self(value))
            .map_err(|_| ApiError::InvalidValue)
    }
}

fn ok() -> ApiResult {
    Ok(axum::Json(json!({})))
}

fn io_error(error: impl std::fmt::Display) -> ApiError {
    eprintln!("Dateifehler: {error}");
    ApiError::Internal
}

pub fn routes() -> Router<Arc<App>> {
    Router::new()
        .route("/login", post(login))
        .route("/logout", post(logout))
        .route("/data", get(all_data))
        .route("/projects", post(create_project))
        .route(
            "/projects/{id}",
            patch(update_project).delete(delete_project),
        )
        .route("/projects/{id}/scenes", post(create_scene))
        .route("/scenes/{id}", patch(update_scene).delete(delete_scene))
        .route("/scenes/{id}/images", post(add_image))
        .route("/scenes/{id}/images/{image_id}", delete(remove_image))
        .route("/scenes/{id}/tracks", post(add_track))
        .route(
            "/scenes/{id}/tracks/{track_id}",
            patch(update_track).delete(remove_track),
        )
        .route("/effects", post(create_effect))
        .route("/effects/{id}", patch(update_effect).delete(delete_effect))
        .route(
            "/assets",
            post(upload).layer(DefaultBodyLimit::max(UPLOAD_LIMIT)),
        )
        .route("/assets/{id}", get(admin_asset).delete(delete_asset))
        .route("/order", put(reorder))
        .route("/link", patch(update_link))
        .route("/link/renew", post(renew_link))
        .route("/settings", patch(update_settings))
}

// Anmeldung

#[derive(Deserialize)]
struct LoginBody {
    password: String,
}

async fn login(
    State(app): Shared,
    JsonBody(body): JsonBody<LoginBody>,
) -> Result<Response, ApiError> {
    let hash = app.lock().store.app.password_hash.clone();
    let valid = tokio::task::spawn_blocking(move || auth::verify_password(&body.password, &hash))
        .await
        .map_err(|_| ApiError::Internal)?;
    if !valid {
        return Err(ApiError::Unauthorized);
    }

    let session = new_session_token();
    app.lock().sessions.insert(session.clone());
    let cookie = format!("{SESSION_COOKIE}={session}; Path=/; HttpOnly; SameSite=Strict");
    Ok(([(header::SET_COOKIE, cookie)], axum::Json(json!({}))).into_response())
}

async fn logout(State(app): Shared, AdminSession(session): AdminSession) -> Response {
    app.end_session(&session);
    let cookie = format!("{SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0");
    ([(header::SET_COOKIE, cookie)], axum::Json(json!({}))).into_response()
}

async fn all_data(State(app): Shared, _: AdminSession) -> ApiResult {
    let inner = app.lock();
    let store = &inner.store;
    let mut projects: Vec<&Project> = store.projects.values().collect();
    projects.sort_by_key(|project| project.name.to_lowercase());
    let assets: Vec<&Asset> = store.assets.values().collect();
    Ok(axum::Json(json!({
        "rev": store.rev,
        "projects": projects,
        "effects": store.app.effects,
        "assets": assets,
    })))
}

// Projekte

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct NameBody {
    name: String,
}

async fn create_project(
    State(app): Shared,
    _: AdminSession,
    JsonBody(body): JsonBody<NameBody>,
) -> ApiResult<Project> {
    let project = app.mutate(|store| {
        let project = store.create_project(&body.name)?;
        let change = Change::project(&project.id).with_state();
        Ok((project, change))
    })?;
    Ok(axum::Json(project))
}

async fn update_project(
    State(app): Shared,
    _: AdminSession,
    Path(id): Path<String>,
    JsonBody(body): JsonBody<NameBody>,
) -> ApiResult<Project> {
    let project = app.mutate(|store| {
        let project = store.rename_project(&id, &body.name)?;
        Ok((project, Change::project(&id)))
    })?;
    Ok(axum::Json(project))
}

async fn delete_project(State(app): Shared, _: AdminSession, Path(id): Path<String>) -> ApiResult {
    app.mutate(|store| {
        store.delete_project(&id)?;
        let mut change = Change::project(&id).with_state();
        change.save_project = None;
        change.remove_project = Some(id.clone());
        Ok(((), change))
    })?;
    ok()
}

// Szenen

async fn create_scene(
    State(app): Shared,
    _: AdminSession,
    Path(project_id): Path<String>,
    JsonBody(body): JsonBody<NameBody>,
) -> ApiResult<Scene> {
    let scene = app.mutate(|store| {
        let scene = store.create_scene(&project_id, &body.name)?;
        Ok((scene, Change::project(&project_id)))
    })?;
    Ok(axum::Json(scene))
}

async fn update_scene(
    State(app): Shared,
    _: AdminSession,
    Path(id): Path<String>,
    JsonBody(patch): JsonBody<ScenePatch>,
) -> ApiResult<Scene> {
    let scene = app.mutate(|store| {
        let project_id = store.project_of_scene(&id)?;
        let scene = store.update_scene(&id, patch)?;
        Ok((scene, Change::project(&project_id)))
    })?;
    Ok(axum::Json(scene))
}

async fn delete_scene(State(app): Shared, _: AdminSession, Path(id): Path<String>) -> ApiResult {
    app.mutate(|store| {
        let project_id = store.delete_scene(&id)?;
        Ok(((), Change::project(&project_id)))
    })?;
    ok()
}

// Bilder

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ImageBody {
    asset_id: String,
}

async fn add_image(
    State(app): Shared,
    _: AdminSession,
    Path(scene_id): Path<String>,
    JsonBody(body): JsonBody<ImageBody>,
) -> ApiResult<Image> {
    let image = app.mutate(|store| {
        let project_id = store.project_of_scene(&scene_id)?;
        let image = store.add_image(&scene_id, &body.asset_id)?;
        Ok((image, Change::project(&project_id)))
    })?;
    Ok(axum::Json(image))
}

async fn remove_image(
    State(app): Shared,
    _: AdminSession,
    Path((scene_id, image_id)): Path<(String, String)>,
) -> ApiResult {
    app.mutate(|store| {
        let project_id = store.project_of_scene(&scene_id)?;
        store.remove_image(&scene_id, &image_id)?;
        Ok(((), Change::project(&project_id)))
    })?;
    ok()
}

// Spuren

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TrackBody {
    asset_id: String,
    name: Option<String>,
    mode: Option<TrackMode>,
}

async fn add_track(
    State(app): Shared,
    _: AdminSession,
    Path(scene_id): Path<String>,
    JsonBody(body): JsonBody<TrackBody>,
) -> ApiResult<Track> {
    let track = app.mutate(|store| {
        let project_id = store.project_of_scene(&scene_id)?;
        let track = store.add_track(&scene_id, &body.asset_id, body.name.as_deref(), body.mode)?;
        Ok((track, Change::project(&project_id)))
    })?;
    Ok(axum::Json(track))
}

async fn update_track(
    State(app): Shared,
    _: AdminSession,
    Path((scene_id, track_id)): Path<(String, String)>,
    JsonBody(patch): JsonBody<TrackPatch>,
) -> ApiResult<Track> {
    let track = app.mutate(|store| {
        let project_id = store.project_of_scene(&scene_id)?;
        let track = store.update_track(&scene_id, &track_id, patch)?;
        Ok((track, Change::project(&project_id)))
    })?;
    Ok(axum::Json(track))
}

async fn remove_track(
    State(app): Shared,
    _: AdminSession,
    Path((scene_id, track_id)): Path<(String, String)>,
) -> ApiResult {
    app.mutate(|store| {
        let project_id = store.project_of_scene(&scene_id)?;
        store.remove_track(&scene_id, &track_id)?;
        Ok(((), Change::project(&project_id)))
    })?;
    ok()
}

// Effekte

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EffectBody {
    asset_id: String,
    name: Option<String>,
    volume: Option<f64>,
}

async fn create_effect(
    State(app): Shared,
    _: AdminSession,
    JsonBody(body): JsonBody<EffectBody>,
) -> ApiResult<Effect> {
    let effect = app.mutate(|store| {
        let effect = store.create_effect(&body.asset_id, body.name.as_deref(), body.volume)?;
        Ok((effect, Change::effects()))
    })?;
    Ok(axum::Json(effect))
}

async fn update_effect(
    State(app): Shared,
    _: AdminSession,
    Path(id): Path<String>,
    JsonBody(patch): JsonBody<EffectPatch>,
) -> ApiResult<Effect> {
    let effect = app.mutate(|store| {
        let effect = store.update_effect(&id, patch)?;
        Ok((effect, Change::effects()))
    })?;
    Ok(axum::Json(effect))
}

async fn delete_effect(State(app): Shared, _: AdminSession, Path(id): Path<String>) -> ApiResult {
    app.mutate(|store| {
        store.delete_effect(&id)?;
        Ok(((), Change::effects()))
    })?;
    ok()
}

// Dateien

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// Speichert ein Upload-Feld und gibt Prüfsumme, Anfang und Größe der Datei zurück.
async fn store_field(
    field: &mut axum::extract::multipart::Field<'_>,
    path: &std::path::Path,
) -> Result<(String, Vec<u8>, u64), ApiError> {
    let mut file = tokio::fs::File::create(path).await.map_err(io_error)?;
    let mut hasher = Sha256::new();
    let mut head = Vec::with_capacity(HEAD_LEN);
    let mut size = 0u64;

    while let Some(chunk) = field.chunk().await.map_err(|_| ApiError::InvalidValue)? {
        hasher.update(&chunk);
        if head.len() < HEAD_LEN {
            let missing = (HEAD_LEN - head.len()).min(chunk.len());
            head.extend_from_slice(&chunk[..missing]);
        }
        size += chunk.len() as u64;
        file.write_all(&chunk).await.map_err(io_error)?;
    }
    file.flush().await.map_err(io_error)?;
    Ok((hex(&hasher.finalize()), head, size))
}

async fn upload(
    State(app): Shared,
    _: AdminSession,
    mut multipart: Multipart,
) -> Result<axum::Json<Asset>, ApiError> {
    let mut field = loop {
        let field = multipart
            .next_field()
            .await
            .map_err(|_| ApiError::InvalidValue)?
            .ok_or(ApiError::InvalidValue)?;
        if field.name() == Some("file") {
            break field;
        }
    };

    let name = field.file_name().unwrap_or("Datei").trim().to_owned();
    let temporary = app.paths.media.join(format!(".{}", new_id("upload")));
    let stored = store_field(&mut field, &temporary).await;
    let detected = stored.as_ref().ok().and_then(|(_, head, _)| sniff(head));
    let (Ok((hash, _, size)), Some(detected)) = (stored, detected) else {
        let _ = tokio::fs::remove_file(&temporary).await;
        return Err(ApiError::InvalidValue);
    };

    let asset = Asset {
        id: hash[..32].to_owned(),
        kind: detected.kind,
        name: if name.is_empty() {
            "Datei".into()
        } else {
            name
        },
        mime: detected.mime.to_owned(),
        size_bytes: size,
        ext: detected.ext.to_owned(),
    };

    let existing = app.lock().store.assets.get(&asset.id).cloned();
    if let Some(existing) = existing {
        let _ = tokio::fs::remove_file(&temporary).await;
        return Ok(axum::Json(existing));
    }

    tokio::fs::rename(&temporary, app.paths.media_file(&asset))
        .await
        .map_err(io_error)?;
    let saved = asset.clone();
    app.mutate(|store| {
        store.assets.insert(saved.id.clone(), saved);
        Ok(((), Change::assets()))
    })?;
    Ok(axum::Json(asset))
}

async fn delete_asset(State(app): Shared, _: AdminSession, Path(id): Path<String>) -> ApiResult {
    let asset = app.mutate(|store| {
        let asset = store.delete_asset(&id)?;
        Ok((asset, Change::assets()))
    })?;
    app.saver.remove(app.paths.media_file(&asset));
    ok()
}

/// Sucht die Datei zu einer Asset-ID. Der Zusatz gibt an, ob sie unveränderlich ist.
fn locate_asset(app: &App, id: &str) -> Result<(PathBuf, String, bool), ApiError> {
    let builtin = match id {
        BUILTIN_BLACK => Some(("black.png", "image/png")),
        BUILTIN_SILENCE => Some(("silence.wav", "audio/wav")),
        _ => None,
    };
    if let Some((file, mime)) = builtin {
        return Ok((app.paths.web.join("builtin").join(file), mime.into(), false));
    }
    let inner = app.lock();
    let asset = inner.store.assets.get(id).ok_or(ApiError::NotFound)?;
    Ok((app.paths.media_file(asset), asset.mime.clone(), true))
}

async fn send_asset(app: &App, id: &str, request: Request) -> Result<Response, ApiError> {
    let (path, mime, immutable) = locate_asset(app, id)?;
    let mime = mime.parse::<mime::Mime>().map_err(|_| ApiError::Internal)?;
    let response = ServeFile::new_with_mime(path, &mime)
        .oneshot(request)
        .await
        .map_err(|_| ApiError::Internal)?;

    let mut response = response.map(Body::new);
    let cache = if immutable { CACHE_FOREVER } else { "no-cache" };
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static(cache));
    Ok(response)
}

async fn admin_asset(
    State(app): Shared,
    _: AdminSession,
    Path(id): Path<String>,
    request: Request,
) -> Result<Response, ApiError> {
    send_asset(&app, &id, request).await
}

pub async fn display_media(
    State(app): Shared,
    Path((token, id)): Path<(String, String)>,
    request: Request,
) -> Result<Response, Response> {
    let allowed = {
        let inner = app.lock();
        let link = &inner.store.app.link;
        link.enabled && link.token == token
    };
    if !allowed {
        return Err(StatusCode::FORBIDDEN.into_response());
    }
    send_asset(&app, &id, request)
        .await
        .map_err(IntoResponse::into_response)
}

// Reihenfolge

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OrderBody {
    scope: String,
    parent_id: Option<String>,
    ids: Vec<String>,
}

async fn reorder(
    State(app): Shared,
    _: AdminSession,
    JsonBody(body): JsonBody<OrderBody>,
) -> ApiResult {
    app.mutate(|store| {
        let parent = body.parent_id.as_deref().unwrap_or_default();
        let change = match body.scope.as_str() {
            "scenes" => {
                store.reorder_scenes(parent, &body.ids)?;
                Change::project(parent)
            }
            "images" => {
                let project_id = store.project_of_scene(parent)?;
                store.reorder_images(parent, &body.ids)?;
                Change::project(&project_id)
            }
            "tracks" => {
                let project_id = store.project_of_scene(parent)?;
                store.reorder_tracks(parent, &body.ids)?;
                Change::project(&project_id)
            }
            "effects" => {
                store.reorder_effects(&body.ids)?;
                Change::effects()
            }
            _ => return Err(ApiError::InvalidValue),
        };
        Ok(((), change))
    })?;
    ok()
}

// Link und Einstellungen

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct LinkBody {
    enabled: Option<bool>,
    /// Fehlt das Feld, bleibt die Adresse. `null` wählt sie wieder automatisch.
    #[serde(default, deserialize_with = "present")]
    host: Option<Option<String>>,
}

fn present<'de, D>(deserializer: D) -> Result<Option<Option<String>>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Option::<String>::deserialize(deserializer).map(Some)
}

async fn update_link(
    State(app): Shared,
    _: AdminSession,
    JsonBody(body): JsonBody<LinkBody>,
) -> ApiResult {
    if let Some(host) = body.host {
        app.set_link_host(host)?;
    }
    if let Some(enabled) = body.enabled {
        app.set_link_enabled(enabled);
    }
    ok()
}

async fn renew_link(State(app): Shared, _: AdminSession) -> ApiResult {
    app.renew_link();
    ok()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SettingsBody {
    master_fade_ms: u32,
}

async fn update_settings(
    State(app): Shared,
    _: AdminSession,
    JsonBody(body): JsonBody<SettingsBody>,
) -> ApiResult {
    app.mutate(|store| {
        store.set_master_fade(body.master_fade_ms)?;
        Ok(((), Change::state()))
    })?;
    ok()
}
