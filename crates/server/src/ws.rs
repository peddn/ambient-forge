//! WebSocket-Verbindungen zu Admin-Oberfläche und Anzeigen.

use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::extract::ws::{CloseFrame, Message, Utf8Bytes, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use futures_util::{SinkExt, Stream, StreamExt};
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::sync::mpsc;

use crate::app::{App, CLOSE_INVALID_TOKEN, CLOSE_SESSION_EXPIRED, Outgoing, Role};
use crate::auth::session_from_headers;
use crate::error::ApiError;
use crate::model::{PROTOCOL, ReportedStatus};
use crate::net::client_name;
use crate::store::TrackPatch;

const PING_INTERVAL: Duration = Duration::from_secs(5);
const PONG_TIMEOUT: Duration = Duration::from_secs(15);
const CLOSE_TIMEOUT: Duration = Duration::from_secs(1);

#[derive(Deserialize)]
struct Envelope {
    #[serde(rename = "type")]
    kind: String,
    id: Option<String>,
}

#[derive(Deserialize)]
#[serde(tag = "type", content = "data")]
enum AdminMessage {
    #[serde(rename = "hello")]
    Hello { protocol: u32 },
    #[serde(rename = "project.activate", rename_all = "camelCase")]
    ProjectActivate { project_id: String },
    #[serde(rename = "scene.activate", rename_all = "camelCase")]
    SceneActivate { scene_id: String },
    #[serde(rename = "track.update", rename_all = "camelCase")]
    TrackUpdate {
        scene_id: String,
        track_id: String,
        volume: Option<f64>,
        pan: Option<f64>,
        muted: Option<bool>,
    },
    #[serde(rename = "effect.play", rename_all = "camelCase")]
    EffectPlay { effect_id: String },
    #[serde(rename = "master.set")]
    MasterSet { on: bool },
    #[serde(rename = "pong")]
    Pong {},
}

#[derive(Deserialize)]
#[serde(tag = "type", content = "data")]
enum DisplayMessage {
    #[serde(rename = "hello")]
    Hello { protocol: u32 },
    #[serde(rename = "status")]
    Status(ReportedStatus),
    #[serde(rename = "pong")]
    Pong { t: u64 },
}

fn origin_matches_host(headers: &HeaderMap) -> bool {
    let Some(origin) = headers.get(header::ORIGIN).and_then(|v| v.to_str().ok()) else {
        return true;
    };
    let host = headers.get(header::HOST).and_then(|v| v.to_str().ok());
    let origin_host = origin.split_once("://").map(|(_, rest)| rest);
    host.is_some() && host == origin_host
}

pub async fn admin_socket(
    upgrade: WebSocketUpgrade,
    State(app): State<Arc<App>>,
    headers: HeaderMap,
) -> Response {
    if !origin_matches_host(&headers) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let session = session_from_headers(&app, &headers);
    upgrade.on_upgrade(move |socket| async move {
        match session {
            Some(session) => {
                run(socket, app, Role::Admin, Some(session), "Admin".into()).await;
            }
            None => close_now(socket, CLOSE_SESSION_EXPIRED).await,
        }
    })
}

pub async fn display_socket(
    upgrade: WebSocketUpgrade,
    State(app): State<Arc<App>>,
    Path(token): Path<String>,
    headers: HeaderMap,
) -> Response {
    let user_agent = headers
        .get(header::USER_AGENT)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    let client = client_name(user_agent);
    let valid = app.token_is_current(&token);
    // Auch ungültige Token werden angenommen: Nur so erfährt die Seite den Grund.
    upgrade.on_upgrade(move |socket| async move {
        if valid {
            run(socket, app, Role::Display, None, client).await;
        } else {
            close_now(socket, CLOSE_INVALID_TOKEN).await;
        }
    })
}

fn close_message(code: u16) -> Message {
    Message::Close(Some(CloseFrame {
        code,
        reason: Utf8Bytes::from_static(""),
    }))
}

/// Wartet auf die Bestätigung des Browsers. Endet die Verbindung vorher, kann der
/// Close-Code verloren gehen, und die Seite erfährt den Grund nicht.
async fn await_close<S>(stream: &mut S)
where
    S: Stream<Item = Result<Message, axum::Error>> + Unpin,
{
    let _ = tokio::time::timeout(CLOSE_TIMEOUT, async {
        while let Some(Ok(frame)) = stream.next().await {
            if matches!(frame, Message::Close(_)) {
                break;
            }
        }
    })
    .await;
}

async fn close_now(mut socket: WebSocket, code: u16) {
    if socket.send(close_message(code)).await.is_ok() {
        await_close(&mut socket).await;
    }
}

async fn run(
    socket: WebSocket,
    app: Arc<App>,
    role: Role,
    session: Option<String>,
    client: String,
) {
    let (mut sink, mut stream) = socket.split();
    let (sender, mut outgoing) = mpsc::unbounded_channel();
    let id = app.register(role, sender.clone(), session, client);

    let mut ping = tokio::time::interval(PING_INTERVAL);
    let mut last_pong = Instant::now();

    loop {
        tokio::select! {
            next = outgoing.recv() => {
                let frame = match next {
                    Some(Outgoing::Text(text)) => Message::text(text),
                    Some(Outgoing::Close(code)) => {
                        if sink.send(close_message(code)).await.is_ok() {
                            await_close(&mut stream).await;
                        }
                        break;
                    }
                    None => break,
                };
                if sink.send(frame).await.is_err() {
                    break;
                }
            }
            frame = stream.next() => {
                let text = match frame {
                    Some(Ok(Message::Text(text))) => text,
                    Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
                    Some(Ok(_)) => continue,
                };
                let envelope = serde_json::from_str::<Envelope>(&text).ok();
                let request = envelope.as_ref().and_then(|envelope| envelope.id.clone());
                if envelope.is_some_and(|envelope| envelope.kind == "pong") {
                    last_pong = Instant::now();
                }
                match role {
                    Role::Admin => handle_admin(&app, id, &sender, request, text.as_str()),
                    Role::Display => handle_display(&app, id, &sender, text.as_str()),
                }
            }
            _ = ping.tick() => {
                if last_pong.elapsed() > PONG_TIMEOUT {
                    break;
                }
                let message = json!({ "type": "ping", "data": { "t": app.now_ms() } });
                if sink.send(Message::text(message.to_string())).await.is_err() {
                    break;
                }
            }
        }
    }

    app.unregister(id);
}

fn send(sender: &mpsc::UnboundedSender<Outgoing>, message: Value) {
    let _ = sender.send(Outgoing::Text(message.to_string()));
}

fn reply(
    sender: &mpsc::UnboundedSender<Outgoing>,
    id: Option<String>,
    result: Result<Value, ApiError>,
) {
    let Some(id) = id else { return };
    let message = match result {
        Ok(data) => json!({ "type": "ack", "id": id, "data": data }),
        Err(error) => json!({ "type": "error", "id": id, "data": { "code": error.code() } }),
    };
    send(sender, message);
}

fn reload(sender: &mpsc::UnboundedSender<Outgoing>) {
    send(sender, json!({ "type": "reload" }));
}

fn handle_admin(
    app: &App,
    connection: u64,
    sender: &mpsc::UnboundedSender<Outgoing>,
    id: Option<String>,
    text: &str,
) {
    let Ok(message) = serde_json::from_str::<AdminMessage>(text) else {
        reply(sender, id, Err(ApiError::InvalidValue));
        return;
    };

    let done = |result: Result<(), ApiError>| result.map(|()| json!({}));
    let result = match message {
        AdminMessage::Hello { protocol } => {
            if protocol == PROTOCOL {
                app.admin_hello(connection);
            } else {
                reload(sender);
            }
            return;
        }
        AdminMessage::Pong {} => return,
        AdminMessage::ProjectActivate { project_id } => done(app.activate_project(&project_id)),
        AdminMessage::SceneActivate { scene_id } => done(app.activate_scene(&scene_id)),
        AdminMessage::TrackUpdate {
            scene_id,
            track_id,
            volume,
            pan,
            muted,
        } => {
            let patch = TrackPatch {
                volume,
                pan,
                muted,
                ..TrackPatch::default()
            };
            done(app.update_track_live(connection, &scene_id, &track_id, patch))
        }
        AdminMessage::EffectPlay { effect_id } => app
            .play_effect(&effect_id)
            .map(|delivered| json!({ "delivered": delivered })),
        AdminMessage::MasterSet { on } => {
            app.set_master(on);
            Ok(json!({}))
        }
    };
    reply(sender, id, result);
}

fn handle_display(
    app: &App,
    connection: u64,
    sender: &mpsc::UnboundedSender<Outgoing>,
    text: &str,
) {
    // Alles außer Begrüßung, Status und Pong wird verworfen.
    let Ok(message) = serde_json::from_str::<DisplayMessage>(text) else {
        return;
    };
    match message {
        DisplayMessage::Hello { protocol } => {
            if protocol == PROTOCOL {
                app.display_hello(connection);
            } else {
                reload(sender);
            }
        }
        DisplayMessage::Status(status) => app.display_status(connection, status),
        DisplayMessage::Pong { t } => {
            app.display_rtt(connection, app.now_ms().saturating_sub(t));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    fn headers(origin: Option<&'static str>, host: &'static str) -> HeaderMap {
        let mut map = HeaderMap::new();
        map.insert(header::HOST, HeaderValue::from_static(host));
        if let Some(origin) = origin {
            map.insert(header::ORIGIN, HeaderValue::from_static(origin));
        }
        map
    }

    #[test]
    fn origin_muss_zum_host_passen() {
        assert!(origin_matches_host(&headers(
            Some("http://192.168.1.20:8080"),
            "192.168.1.20:8080"
        )));
        assert!(!origin_matches_host(&headers(
            Some("http://boese.example"),
            "192.168.1.20:8080"
        )));
        assert!(origin_matches_host(&headers(None, "192.168.1.20:8080")));
    }

    #[test]
    fn nachrichten_passen_zum_protokoll() {
        let scene: AdminMessage = serde_json::from_str(
            r#"{ "type": "scene.activate", "id": "c-17", "data": { "sceneId": "scn_02" } }"#,
        )
        .unwrap();
        assert!(matches!(scene, AdminMessage::SceneActivate { scene_id } if scene_id == "scn_02"));

        let track: AdminMessage = serde_json::from_str(
            r#"{ "type": "track.update", "data": { "sceneId": "s", "trackId": "t", "pan": -0.5 } }"#,
        )
        .unwrap();
        assert!(matches!(
            track,
            AdminMessage::TrackUpdate {
                pan: Some(_),
                volume: None,
                ..
            }
        ));

        let pong: AdminMessage =
            serde_json::from_str(r#"{ "type": "pong", "data": { "t": 123 } }"#).unwrap();
        assert!(matches!(pong, AdminMessage::Pong {}));
    }
}
