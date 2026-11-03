//! Gespeicherte Daten und der Zielzustand der Anzeige, siehe docs/spezifikation.md.

use serde::{Deserialize, Serialize};

pub const SCHEMA_VERSION: u32 = 1;
pub const PROTOCOL: u32 = 1;
pub const BUILTIN_BLACK: &str = "builtin-black";
pub const BUILTIN_SILENCE: &str = "builtin-silence";

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppData {
    pub schema_version: u32,
    pub active_project_id: Option<String>,
    pub master_on: bool,
    pub master_fade_ms: u32,
    pub link: Link,
    pub effects: Vec<Effect>,
    pub password_hash: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Link {
    pub token: String,
    pub enabled: bool,
    pub host: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub active_scene_id: Option<String>,
    pub scenes: Vec<Scene>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Scene {
    pub id: String,
    pub name: String,
    pub transition_ms: u32,
    pub slide_duration_ms: u32,
    pub slide_fade_ms: u32,
    pub images: Vec<Image>,
    pub tracks: Vec<Track>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Image {
    pub id: String,
    pub asset_id: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TrackMode {
    Buffer,
    Stream,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub id: String,
    pub name: String,
    pub asset_id: String,
    pub volume: f64,
    pub pan: f64,
    pub muted: bool,
    pub mode: TrackMode,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Effect {
    pub id: String,
    pub name: String,
    pub asset_id: String,
    pub volume: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AssetKind {
    Image,
    Audio,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Asset {
    pub id: String,
    pub kind: AssetKind,
    pub name: String,
    pub mime: String,
    pub size_bytes: u64,
    /// Dateiendung in `media/`.
    pub ext: String,
}

/// Der Inhalt einer Anzeige ohne `rev`, damit sich Änderungen vergleichen lassen.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotContent {
    pub master_on: bool,
    pub master_fade_ms: u32,
    pub scene: Option<SnapshotScene>,
    pub effects: Vec<SnapshotEffect>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotScene {
    pub id: String,
    pub transition_ms: u32,
    pub slide_duration_ms: u32,
    pub slide_fade_ms: u32,
    pub images: Vec<Image>,
    pub tracks: Vec<SnapshotTrack>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotTrack {
    pub id: String,
    pub asset_id: String,
    pub volume: f64,
    pub pan: f64,
    pub muted: bool,
    pub mode: TrackMode,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotEffect {
    pub id: String,
    pub asset_id: String,
    pub volume: f64,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetError {
    pub asset_id: String,
    pub reason: String,
}

/// Was eine Anzeige über sich selbst meldet.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportedStatus {
    pub audio: String,
    pub scene_id: Option<String>,
    pub scene_state: String,
    pub loaded: u32,
    pub total: u32,
    pub errors: Vec<AssetError>,
}

impl Default for ReportedStatus {
    fn default() -> Self {
        Self {
            audio: "locked".into(),
            scene_id: None,
            scene_state: "ready".into(),
            loaded: 0,
            total: 0,
            errors: Vec::new(),
        }
    }
}

/// Ein Eintrag in der Anzeigenliste der Admin-Oberfläche.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayInfo {
    pub connection_id: String,
    pub client: String,
    #[serde(flatten)]
    pub status: ReportedStatus,
    pub rtt_ms: Option<u64>,
}
