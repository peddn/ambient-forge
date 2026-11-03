//! Laufender Zustand: Daten, Verbindungen und das Verteilen von Änderungen.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{Value, json};
use tokio::sync::mpsc::UnboundedSender;

use crate::error::ApiError;
use crate::model::*;
use crate::net;
use crate::saver::Saver;
use crate::store::Store;
use crate::token::new_link_token;

pub const CLOSE_INVALID_TOKEN: u16 = 4001;
pub const CLOSE_SESSION_EXPIRED: u16 = 4002;
const DISPLAY_LIST_INTERVAL: Duration = Duration::from_millis(250);

pub enum Outgoing {
    Text(String),
    Close(u16),
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Role {
    Admin,
    Display,
}

pub struct Connection {
    pub role: Role,
    pub sender: UnboundedSender<Outgoing>,
    /// Erst nach einem gültigen `hello` bekommt eine Verbindung Nachrichten.
    pub ready: bool,
    pub session: Option<String>,
    pub client: String,
    pub status: ReportedStatus,
    pub rtt_ms: Option<u64>,
}

impl Connection {
    pub fn send(&self, message: &Value) {
        let _ = self.sender.send(Outgoing::Text(message.to_string()));
    }

    fn close(&self, code: u16) {
        let _ = self.sender.send(Outgoing::Close(code));
    }
}

pub struct Inner {
    pub store: Store,
    pub connections: HashMap<u64, Connection>,
    pub sessions: HashSet<String>,
    last_content: SnapshotContent,
    displays_dirty: bool,
}

#[derive(Clone)]
pub struct Paths {
    pub web: PathBuf,
    pub data: PathBuf,
    pub media: PathBuf,
    pub projects: PathBuf,
}

impl Paths {
    pub fn new(web: PathBuf, data: PathBuf) -> Self {
        let media = data.join("media");
        let projects = data.join("projects");
        Self {
            web,
            data,
            media,
            projects,
        }
    }

    pub fn app_file(&self) -> PathBuf {
        self.data.join("app.json")
    }

    pub fn assets_file(&self) -> PathBuf {
        self.data.join("assets.json")
    }

    pub fn project_file(&self, id: &str) -> PathBuf {
        self.projects.join(format!("{id}.json"))
    }

    pub fn media_file(&self, asset: &Asset) -> PathBuf {
        self.media.join(format!("{}.{}", asset.id, asset.ext))
    }
}

pub struct App {
    inner: Mutex<Inner>,
    pub paths: Paths,
    pub port: u16,
    pub saver: Saver,
    started: Instant,
    next_connection: AtomicU64,
}

/// Beschreibt, was eine Änderung nach sich zieht.
#[derive(Default)]
pub struct Change {
    pub save_app: bool,
    pub save_assets: bool,
    pub save_project: Option<String>,
    pub remove_project: Option<String>,
    pub data: Option<(&'static str, Option<String>)>,
    pub state: bool,
}

impl Change {
    pub fn project(id: &str) -> Self {
        Self {
            save_project: Some(id.to_owned()),
            data: Some(("project", Some(id.to_owned()))),
            ..Self::default()
        }
    }

    pub fn effects() -> Self {
        Self {
            save_app: true,
            data: Some(("effects", None)),
            ..Self::default()
        }
    }

    pub fn assets() -> Self {
        Self {
            save_assets: true,
            data: Some(("assets", None)),
            ..Self::default()
        }
    }

    pub fn with_state(mut self) -> Self {
        self.save_app = true;
        self.state = true;
        self
    }

    pub fn state() -> Self {
        Self::default().with_state()
    }
}

fn message(kind: &str, data: Value) -> Value {
    json!({ "type": kind, "data": data })
}

fn serialized<T: Serialize>(value: &T) -> Vec<u8> {
    serde_json::to_vec_pretty(value).expect("Daten lassen sich immer als JSON schreiben")
}

impl Inner {
    fn snapshot_message(&self, content: &SnapshotContent) -> Value {
        let mut data = serde_json::to_value(content).unwrap_or_default();
        data["rev"] = json!(self.store.rev);
        message("snapshot", data)
    }

    pub fn connections_of(&self, role: Role) -> impl Iterator<Item = &Connection> {
        self.connections
            .values()
            .filter(move |connection| connection.role == role && connection.ready)
    }

    pub fn to_displays(&self, message: &Value) {
        self.connections_of(Role::Display)
            .for_each(|display| display.send(message));
    }

    pub fn to_admins(&self, message: &Value) {
        self.connections_of(Role::Admin)
            .for_each(|admin| admin.send(message));
    }

    fn display_list(&self) -> Vec<DisplayInfo> {
        let mut displays: Vec<(u64, DisplayInfo)> = self
            .connections
            .iter()
            .filter(|(_, connection)| connection.role == Role::Display && connection.ready)
            .map(|(id, connection)| {
                (
                    *id,
                    DisplayInfo {
                        connection_id: format!("con_{id}"),
                        client: connection.client.clone(),
                        status: connection.status.clone(),
                        rtt_ms: connection.rtt_ms,
                    },
                )
            })
            .collect();
        displays.sort_by_key(|(id, _)| *id);
        displays.into_iter().map(|(_, display)| display).collect()
    }

    fn link_host(&self, hosts: &[String]) -> String {
        self.store
            .app
            .link
            .host
            .as_ref()
            .filter(|host| hosts.contains(host))
            .or_else(|| hosts.first())
            .cloned()
            .unwrap_or_else(|| "127.0.0.1".into())
    }

    pub fn admin_state(&self, port: u16) -> Value {
        let app = &self.store.app;
        let hosts = net::lan_hosts();
        let url = format!(
            "http://{}:{port}/d/{}",
            self.link_host(&hosts),
            app.link.token
        );
        message(
            "state",
            json!({
                "rev": self.store.rev,
                "activeProjectId": app.active_project_id,
                "activeSceneId": self.store.active_scene_id(),
                "masterOn": app.master_on,
                "masterFadeMs": app.master_fade_ms,
                "link": {
                    "url": url,
                    "enabled": app.link.enabled,
                    "host": app.link.host,
                    "hosts": hosts,
                },
                "displays": self.display_list(),
            }),
        )
    }
}

impl App {
    pub fn new(store: Store, paths: Paths, port: u16, saver: Saver) -> Self {
        let last_content = store.content();
        Self {
            inner: Mutex::new(Inner {
                store,
                connections: HashMap::new(),
                sessions: HashSet::new(),
                last_content,
                displays_dirty: false,
            }),
            paths,
            port,
            saver,
            started: Instant::now(),
            next_connection: AtomicU64::new(1),
        }
    }

    pub fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn now_ms(&self) -> u64 {
        self.started.elapsed().as_millis() as u64
    }

    fn save_project(&self, inner: &Inner, id: &str, later: bool) {
        if let Some(project) = inner.store.projects.get(id) {
            let path = self.paths.project_file(id);
            let bytes = serialized(project);
            if later {
                self.saver.write_later(path, bytes);
            } else {
                self.saver.write(path, bytes);
            }
        }
    }

    pub fn save_app(&self, inner: &Inner) {
        self.saver
            .write(self.paths.app_file(), serialized(&inner.store.app));
    }

    /// Schickt einen neuen Snapshot, wenn sich der Inhalt der Anzeige geändert hat.
    fn sync_displays(&self, inner: &mut Inner) {
        let content = inner.store.content();
        if content == inner.last_content {
            return;
        }
        if inner.store.app.link.enabled {
            inner.to_displays(&inner.snapshot_message(&content));
        }
        inner.last_content = content;
    }

    pub fn commit(&self, inner: &mut Inner, change: Change) {
        inner.store.rev += 1;
        if change.save_app {
            self.save_app(inner);
        }
        if change.save_assets {
            let assets: Vec<&Asset> = inner.store.assets.values().collect();
            self.saver
                .write(self.paths.assets_file(), serialized(&assets));
        }
        if let Some(id) = &change.save_project {
            self.save_project(inner, id, false);
        }
        if let Some(id) = &change.remove_project {
            self.saver.remove(self.paths.project_file(id));
        }
        if let Some((scope, project_id)) = change.data {
            inner.to_admins(&message(
                "data.changed",
                json!({ "rev": inner.store.rev, "scope": scope, "projectId": project_id }),
            ));
        }
        if change.state {
            inner.to_admins(&inner.admin_state(self.port));
        }
        self.sync_displays(inner);
    }

    /// Führt eine Änderung aus und verteilt sie.
    pub fn mutate<T>(
        &self,
        action: impl FnOnce(&mut Store) -> Result<(T, Change), ApiError>,
    ) -> Result<T, ApiError> {
        let mut inner = self.lock();
        let (result, change) = action(&mut inner.store)?;
        self.commit(&mut inner, change);
        Ok(result)
    }

    // Verbindungen

    pub fn register(
        &self,
        role: Role,
        sender: UnboundedSender<Outgoing>,
        session: Option<String>,
        client: String,
    ) -> u64 {
        let id = self.next_connection.fetch_add(1, Ordering::Relaxed);
        self.lock().connections.insert(
            id,
            Connection {
                role,
                sender,
                ready: false,
                session,
                client,
                status: ReportedStatus::default(),
                rtt_ms: None,
            },
        );
        id
    }

    pub fn unregister(&self, id: u64) {
        let mut inner = self.lock();
        if let Some(connection) = inner.connections.remove(&id)
            && connection.role == Role::Display
        {
            inner.displays_dirty = true;
        }
    }

    pub fn admin_hello(&self, id: u64) {
        let mut inner = self.lock();
        let state = inner.admin_state(self.port);
        if let Some(connection) = inner.connections.get_mut(&id) {
            connection.ready = true;
            connection.send(&state);
        }
    }

    pub fn display_hello(&self, id: u64) {
        let mut inner = self.lock();
        let content = inner.store.content();
        let first = if inner.store.app.link.enabled {
            inner.snapshot_message(&content)
        } else {
            message("link.disabled", json!({}))
        };
        if let Some(connection) = inner.connections.get_mut(&id) {
            connection.ready = true;
            connection.send(&first);
        }
        inner.displays_dirty = true;
    }

    pub fn display_status(&self, id: u64, status: ReportedStatus) {
        let mut inner = self.lock();
        if let Some(connection) = inner.connections.get_mut(&id) {
            connection.status = status;
            inner.displays_dirty = true;
        }
    }

    pub fn display_rtt(&self, id: u64, rtt_ms: u64) {
        let mut inner = self.lock();
        if let Some(connection) = inner.connections.get_mut(&id) {
            connection.rtt_ms = Some(rtt_ms);
            inner.displays_dirty = true;
        }
    }

    /// Sendet die Anzeigenliste höchstens viermal pro Sekunde.
    pub async fn publish_display_list(&self) {
        let mut interval = tokio::time::interval(DISPLAY_LIST_INTERVAL);
        loop {
            interval.tick().await;
            let mut inner = self.lock();
            if inner.displays_dirty {
                inner.displays_dirty = false;
                let list = serde_json::to_value(inner.display_list()).unwrap_or_default();
                inner.to_admins(&message("displays", list));
            }
        }
    }

    // Live-Befehle

    pub fn activate_project(&self, project_id: &str) -> Result<(), ApiError> {
        self.mutate(|store| {
            store.activate_project(project_id)?;
            Ok(((), Change::state()))
        })
    }

    pub fn activate_scene(&self, scene_id: &str) -> Result<(), ApiError> {
        self.mutate(|store| {
            let project_id = store.activate_scene(scene_id)?;
            Ok(((), Change::project(&project_id).with_state()))
        })
    }

    pub fn update_track_live(
        &self,
        sender: u64,
        scene_id: &str,
        track_id: &str,
        patch: crate::store::TrackPatch,
    ) -> Result<(), ApiError> {
        let mut fields = json!({ "trackId": track_id });
        if let Some(volume) = patch.volume {
            fields["volume"] = json!(volume);
        }
        if let Some(pan) = patch.pan {
            fields["pan"] = json!(pan);
        }
        if let Some(muted) = patch.muted {
            fields["muted"] = json!(muted);
        }

        let mut inner = self.lock();
        let project_id = inner.store.project_of_scene(scene_id)?;
        inner.store.update_track(scene_id, track_id, patch)?;
        inner.store.rev += 1;
        fields["rev"] = json!(inner.store.rev);
        self.save_project(&inner, &project_id, true);

        if inner.store.is_scene_active(scene_id) {
            if inner.store.app.link.enabled {
                inner.to_displays(&message("track.update", fields.clone()));
            }
            inner.last_content = inner.store.content();
        }

        fields["sceneId"] = json!(scene_id);
        let update = message("track.updated", fields);
        inner
            .connections
            .iter()
            .filter(|(id, connection)| {
                **id != sender && connection.role == Role::Admin && connection.ready
            })
            .for_each(|(_, connection)| connection.send(&update));
        Ok(())
    }

    /// Spielt einen Effekt ab und gibt die Zahl der Anzeigen zurück, die ihn hören lassen.
    pub fn play_effect(&self, effect_id: &str) -> Result<usize, ApiError> {
        let inner = self.lock();
        let app = &inner.store.app;
        if !app.effects.iter().any(|effect| effect.id == effect_id) {
            return Err(ApiError::NotFound);
        }
        if !app.master_on || !app.link.enabled {
            return Ok(0);
        }
        inner.to_displays(&message("effect.play", json!({ "effectId": effect_id })));
        Ok(inner
            .connections_of(Role::Display)
            .filter(|display| display.status.audio == "running")
            .count())
    }

    pub fn set_master(&self, on: bool) {
        let mut inner = self.lock();
        if inner.store.app.master_on == on {
            return;
        }
        inner.store.app.master_on = on;
        inner.store.rev += 1;
        self.save_app(&inner);
        if inner.store.app.link.enabled {
            inner.to_displays(&message(
                "master.set",
                json!({
                    "rev": inner.store.rev,
                    "on": on,
                    "fadeMs": inner.store.app.master_fade_ms,
                }),
            ));
        }
        inner.last_content = inner.store.content();
        inner.to_admins(&inner.admin_state(self.port));
    }

    // Link

    pub fn set_link_enabled(&self, enabled: bool) {
        let mut inner = self.lock();
        if inner.store.app.link.enabled == enabled {
            return;
        }
        inner.store.app.link.enabled = enabled;
        if enabled {
            let content = inner.store.content();
            inner.store.rev += 1;
            inner.to_displays(&inner.snapshot_message(&content));
            inner.last_content = content;
        } else {
            inner.to_displays(&message("link.disabled", json!({})));
        }
        self.commit(&mut inner, Change::state());
    }

    pub fn set_link_host(&self, host: Option<String>) -> Result<(), ApiError> {
        if let Some(host) = &host
            && !net::lan_hosts().contains(host)
        {
            return Err(ApiError::InvalidValue);
        }
        self.mutate(|store| {
            store.app.link.host = host;
            Ok(((), Change::state()))
        })
    }

    pub fn renew_link(&self) {
        let mut inner = self.lock();
        inner.store.app.link.token = new_link_token();
        let revoked = message("link.revoked", json!({}));
        inner
            .connections
            .values()
            .filter(|connection| connection.role == Role::Display)
            .for_each(|connection| {
                connection.send(&revoked);
                connection.close(CLOSE_INVALID_TOKEN);
            });
        self.commit(&mut inner, Change::state());
    }

    pub fn token_is_current(&self, token: &str) -> bool {
        self.lock().store.app.link.token == token
    }

    // Sitzungen

    pub fn end_session(&self, session: &str) {
        let mut inner = self.lock();
        inner.sessions.remove(session);
        inner
            .connections
            .values()
            .filter(|connection| connection.session.as_deref() == Some(session))
            .for_each(|connection| connection.close(CLOSE_SESSION_EXPIRED));
    }
}
