//! Fachliche Regeln. Dieses Modul kennt weder Netzwerk noch Dateisystem.

use std::collections::BTreeMap;

use serde::Deserialize;

use crate::error::ApiError;
use crate::model::*;
use crate::token::{new_id, new_link_token};

const MAX_NAME_LEN: usize = 200;
const MAX_FADE_MS: u32 = 600_000;
const MIN_SLIDE_MS: u32 = 1_000;
const MAX_SLIDE_MS: u32 = 86_400_000;
const MAX_MASTER_FADE_MS: u32 = 10_000;

#[derive(Debug)]
pub struct Store {
    pub app: AppData,
    pub assets: BTreeMap<String, Asset>,
    pub projects: BTreeMap<String, Project>,
    pub rev: u64,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScenePatch {
    pub name: Option<String>,
    pub transition_ms: Option<u32>,
    pub slide_duration_ms: Option<u32>,
    pub slide_fade_ms: Option<u32>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TrackPatch {
    pub name: Option<String>,
    pub volume: Option<f64>,
    pub pan: Option<f64>,
    pub muted: Option<bool>,
    pub mode: Option<TrackMode>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EffectPatch {
    pub name: Option<String>,
    pub volume: Option<f64>,
}

pub fn new_app_data(password_hash: String) -> AppData {
    AppData {
        schema_version: SCHEMA_VERSION,
        active_project_id: None,
        master_on: true,
        master_fade_ms: 400,
        link: Link {
            token: new_link_token(),
            enabled: true,
            host: None,
        },
        effects: Vec::new(),
        password_hash,
    }
}

fn clean_name(name: &str) -> Result<String, ApiError> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > MAX_NAME_LEN {
        return Err(ApiError::InvalidValue);
    }
    Ok(name.to_owned())
}

fn check_volume(value: f64) -> Result<f64, ApiError> {
    if (0.0..=1.0).contains(&value) {
        Ok(value)
    } else {
        Err(ApiError::InvalidValue)
    }
}

fn check_pan(value: f64) -> Result<f64, ApiError> {
    if (-1.0..=1.0).contains(&value) {
        Ok(value)
    } else {
        Err(ApiError::InvalidValue)
    }
}

fn check_range(value: u32, min: u32, max: u32) -> Result<u32, ApiError> {
    if (min..=max).contains(&value) {
        Ok(value)
    } else {
        Err(ApiError::InvalidValue)
    }
}

fn placeholder_image() -> Image {
    Image {
        id: new_id("img"),
        asset_id: BUILTIN_BLACK.into(),
    }
}

fn placeholder_track() -> Track {
    Track {
        id: new_id("trk"),
        name: "Leere Tonspur".into(),
        asset_id: BUILTIN_SILENCE.into(),
        volume: 1.0,
        pan: 0.0,
        muted: false,
        mode: TrackMode::Buffer,
    }
}

/// Bringt `items` in die Reihenfolge von `ids`. `ids` muss genau dieselben Einträge enthalten.
fn reorder_by_id<T>(
    items: &mut [T],
    ids: &[String],
    id_of: impl Fn(&T) -> &str,
) -> Result<(), ApiError> {
    let mut sorted_new: Vec<&str> = ids.iter().map(String::as_str).collect();
    let mut sorted_old: Vec<&str> = items.iter().map(&id_of).collect();
    sorted_new.sort_unstable();
    sorted_old.sort_unstable();
    if sorted_new != sorted_old {
        return Err(ApiError::InvalidValue);
    }
    items.sort_by_key(|item| ids.iter().position(|id| id == id_of(item)));
    Ok(())
}

impl Store {
    pub fn new(app: AppData) -> Self {
        Self {
            app,
            assets: BTreeMap::new(),
            projects: BTreeMap::new(),
            rev: 1,
        }
    }

    // Abfragen

    pub fn active_project(&self) -> Option<&Project> {
        self.projects.get(self.app.active_project_id.as_ref()?)
    }

    pub fn active_scene_id(&self) -> Option<&str> {
        self.active_project()?.active_scene_id.as_deref()
    }

    pub fn active_scene(&self) -> Option<&Scene> {
        let project = self.active_project()?;
        let id = project.active_scene_id.as_ref()?;
        project.scenes.iter().find(|scene| &scene.id == id)
    }

    pub fn is_scene_active(&self, scene_id: &str) -> bool {
        self.active_scene_id() == Some(scene_id)
    }

    pub fn content(&self) -> SnapshotContent {
        SnapshotContent {
            master_on: self.app.master_on,
            master_fade_ms: self.app.master_fade_ms,
            scene: self.active_scene().map(|scene| SnapshotScene {
                id: scene.id.clone(),
                transition_ms: scene.transition_ms,
                slide_duration_ms: scene.slide_duration_ms,
                slide_fade_ms: scene.slide_fade_ms,
                images: scene.images.clone(),
                tracks: scene
                    .tracks
                    .iter()
                    .map(|track| SnapshotTrack {
                        id: track.id.clone(),
                        asset_id: track.asset_id.clone(),
                        volume: track.volume,
                        pan: track.pan,
                        muted: track.muted,
                        mode: track.mode,
                    })
                    .collect(),
            }),
            effects: self
                .app
                .effects
                .iter()
                .map(|effect| SnapshotEffect {
                    id: effect.id.clone(),
                    asset_id: effect.asset_id.clone(),
                    volume: effect.volume,
                })
                .collect(),
        }
    }

    pub fn project_of_scene(&self, scene_id: &str) -> Result<String, ApiError> {
        self.projects
            .values()
            .find(|project| project.scenes.iter().any(|scene| scene.id == scene_id))
            .map(|project| project.id.clone())
            .ok_or(ApiError::NotFound)
    }

    fn project_mut(&mut self, id: &str) -> Result<&mut Project, ApiError> {
        self.projects.get_mut(id).ok_or(ApiError::NotFound)
    }

    fn scene_mut(&mut self, scene_id: &str) -> Result<&mut Scene, ApiError> {
        self.projects
            .values_mut()
            .flat_map(|project| project.scenes.iter_mut())
            .find(|scene| scene.id == scene_id)
            .ok_or(ApiError::NotFound)
    }

    fn require_asset(&self, asset_id: &str, kind: AssetKind) -> Result<&Asset, ApiError> {
        let asset = self.assets.get(asset_id).ok_or(ApiError::NotFound)?;
        if asset.kind == kind {
            Ok(asset)
        } else {
            Err(ApiError::InvalidValue)
        }
    }

    // Projekte

    pub fn create_project(&mut self, name: &str) -> Result<Project, ApiError> {
        let project = Project {
            id: new_id("prj"),
            name: clean_name(name)?,
            active_scene_id: None,
            scenes: Vec::new(),
        };
        if self.projects.is_empty() {
            self.app.active_project_id = Some(project.id.clone());
        }
        self.projects.insert(project.id.clone(), project.clone());
        Ok(project)
    }

    pub fn rename_project(&mut self, id: &str, name: &str) -> Result<Project, ApiError> {
        let name = clean_name(name)?;
        let project = self.project_mut(id)?;
        project.name = name;
        Ok(project.clone())
    }

    pub fn delete_project(&mut self, id: &str) -> Result<(), ApiError> {
        self.projects.remove(id).ok_or(ApiError::NotFound)?;
        if self.app.active_project_id.as_deref() == Some(id) {
            self.app.active_project_id = None;
        }
        Ok(())
    }

    pub fn activate_project(&mut self, id: &str) -> Result<(), ApiError> {
        if !self.projects.contains_key(id) {
            return Err(ApiError::NotFound);
        }
        self.app.active_project_id = Some(id.to_owned());
        Ok(())
    }

    // Szenen

    pub fn create_scene(&mut self, project_id: &str, name: &str) -> Result<Scene, ApiError> {
        let scene = Scene {
            id: new_id("scn"),
            name: clean_name(name)?,
            transition_ms: 2_000,
            slide_duration_ms: 30_000,
            slide_fade_ms: 2_000,
            images: vec![placeholder_image()],
            tracks: vec![placeholder_track()],
        };
        self.project_mut(project_id)?.scenes.push(scene.clone());
        Ok(scene)
    }

    pub fn update_scene(&mut self, scene_id: &str, patch: ScenePatch) -> Result<Scene, ApiError> {
        let name = patch.name.as_deref().map(clean_name).transpose()?;
        let transition = patch
            .transition_ms
            .map(|ms| check_range(ms, 0, MAX_FADE_MS))
            .transpose()?;
        let duration = patch
            .slide_duration_ms
            .map(|ms| check_range(ms, MIN_SLIDE_MS, MAX_SLIDE_MS))
            .transpose()?;
        let fade = patch
            .slide_fade_ms
            .map(|ms| check_range(ms, 0, MAX_FADE_MS))
            .transpose()?;

        let scene = self.scene_mut(scene_id)?;
        if let Some(name) = name {
            scene.name = name;
        }
        if let Some(ms) = transition {
            scene.transition_ms = ms;
        }
        if let Some(ms) = duration {
            scene.slide_duration_ms = ms;
        }
        if let Some(ms) = fade {
            scene.slide_fade_ms = ms;
        }
        Ok(scene.clone())
    }

    pub fn delete_scene(&mut self, scene_id: &str) -> Result<String, ApiError> {
        if self.is_scene_active(scene_id) {
            return Err(ApiError::SceneActive);
        }
        let project_id = self.project_of_scene(scene_id)?;
        let project = self.project_mut(&project_id)?;
        project.scenes.retain(|scene| scene.id != scene_id);
        if project.active_scene_id.as_deref() == Some(scene_id) {
            project.active_scene_id = None;
        }
        Ok(project_id)
    }

    pub fn activate_scene(&mut self, scene_id: &str) -> Result<String, ApiError> {
        let project_id = self.project_of_scene(scene_id)?;
        if self.app.active_project_id.as_deref() != Some(project_id.as_str()) {
            return Err(ApiError::WrongProject);
        }
        self.project_mut(&project_id)?.active_scene_id = Some(scene_id.to_owned());
        Ok(project_id)
    }

    // Bilder

    pub fn add_image(&mut self, scene_id: &str, asset_id: &str) -> Result<Image, ApiError> {
        self.require_asset(asset_id, AssetKind::Image)?;
        let image = Image {
            id: new_id("img"),
            asset_id: asset_id.to_owned(),
        };
        let scene = self.scene_mut(scene_id)?;
        scene.images.retain(|entry| entry.asset_id != BUILTIN_BLACK);
        scene.images.push(image.clone());
        Ok(image)
    }

    pub fn remove_image(&mut self, scene_id: &str, image_id: &str) -> Result<(), ApiError> {
        let scene = self.scene_mut(scene_id)?;
        if !scene.images.iter().any(|image| image.id == image_id) {
            return Err(ApiError::NotFound);
        }
        scene.images.retain(|image| image.id != image_id);
        if scene.images.is_empty() {
            scene.images.push(placeholder_image());
        }
        Ok(())
    }

    // Spuren

    pub fn add_track(
        &mut self,
        scene_id: &str,
        asset_id: &str,
        name: Option<&str>,
        mode: Option<TrackMode>,
    ) -> Result<Track, ApiError> {
        let asset = self.require_asset(asset_id, AssetKind::Audio)?;
        let name = clean_name(name.unwrap_or(&asset.name))?;
        let track = Track {
            id: new_id("trk"),
            name,
            asset_id: asset_id.to_owned(),
            volume: 1.0,
            pan: 0.0,
            muted: false,
            mode: mode.unwrap_or(TrackMode::Buffer),
        };
        let scene = self.scene_mut(scene_id)?;
        scene
            .tracks
            .retain(|entry| entry.asset_id != BUILTIN_SILENCE);
        scene.tracks.push(track.clone());
        Ok(track)
    }

    pub fn update_track(
        &mut self,
        scene_id: &str,
        track_id: &str,
        patch: TrackPatch,
    ) -> Result<Track, ApiError> {
        let name = patch.name.as_deref().map(clean_name).transpose()?;
        let volume = patch.volume.map(check_volume).transpose()?;
        let pan = patch.pan.map(check_pan).transpose()?;

        let track = self
            .scene_mut(scene_id)?
            .tracks
            .iter_mut()
            .find(|track| track.id == track_id)
            .ok_or(ApiError::NotFound)?;
        if let Some(name) = name {
            track.name = name;
        }
        if let Some(volume) = volume {
            track.volume = volume;
        }
        if let Some(pan) = pan {
            track.pan = pan;
        }
        if let Some(muted) = patch.muted {
            track.muted = muted;
        }
        if let Some(mode) = patch.mode {
            track.mode = mode;
        }
        Ok(track.clone())
    }

    pub fn remove_track(&mut self, scene_id: &str, track_id: &str) -> Result<(), ApiError> {
        let scene = self.scene_mut(scene_id)?;
        if !scene.tracks.iter().any(|track| track.id == track_id) {
            return Err(ApiError::NotFound);
        }
        scene.tracks.retain(|track| track.id != track_id);
        if scene.tracks.is_empty() {
            scene.tracks.push(placeholder_track());
        }
        Ok(())
    }

    // Effekte

    pub fn create_effect(
        &mut self,
        asset_id: &str,
        name: Option<&str>,
        volume: Option<f64>,
    ) -> Result<Effect, ApiError> {
        let asset = self.require_asset(asset_id, AssetKind::Audio)?;
        let effect = Effect {
            id: new_id("fx"),
            name: clean_name(name.unwrap_or(&asset.name))?,
            asset_id: asset_id.to_owned(),
            volume: check_volume(volume.unwrap_or(1.0))?,
        };
        self.app.effects.push(effect.clone());
        Ok(effect)
    }

    pub fn update_effect(&mut self, id: &str, patch: EffectPatch) -> Result<Effect, ApiError> {
        let name = patch.name.as_deref().map(clean_name).transpose()?;
        let volume = patch.volume.map(check_volume).transpose()?;
        let effect = self
            .app
            .effects
            .iter_mut()
            .find(|effect| effect.id == id)
            .ok_or(ApiError::NotFound)?;
        if let Some(name) = name {
            effect.name = name;
        }
        if let Some(volume) = volume {
            effect.volume = volume;
        }
        Ok(effect.clone())
    }

    pub fn delete_effect(&mut self, id: &str) -> Result<(), ApiError> {
        let before = self.app.effects.len();
        self.app.effects.retain(|effect| effect.id != id);
        if self.app.effects.len() == before {
            return Err(ApiError::NotFound);
        }
        Ok(())
    }

    // Dateien

    pub fn asset_in_use(&self, asset_id: &str) -> bool {
        let in_effects = self.app.effects.iter().any(|e| e.asset_id == asset_id);
        let in_scenes = self
            .projects
            .values()
            .flat_map(|project| project.scenes.iter())
            .any(|scene| {
                scene.images.iter().any(|image| image.asset_id == asset_id)
                    || scene.tracks.iter().any(|track| track.asset_id == asset_id)
            });
        in_effects || in_scenes
    }

    pub fn delete_asset(&mut self, asset_id: &str) -> Result<Asset, ApiError> {
        if asset_id == BUILTIN_BLACK || asset_id == BUILTIN_SILENCE {
            return Err(ApiError::InvalidValue);
        }
        if !self.assets.contains_key(asset_id) {
            return Err(ApiError::NotFound);
        }
        if self.asset_in_use(asset_id) {
            return Err(ApiError::AssetInUse);
        }
        self.assets.remove(asset_id).ok_or(ApiError::NotFound)
    }

    // Reihenfolge

    pub fn reorder_scenes(&mut self, project_id: &str, ids: &[String]) -> Result<(), ApiError> {
        reorder_by_id(&mut self.project_mut(project_id)?.scenes, ids, |s| &s.id)
    }

    pub fn reorder_images(&mut self, scene_id: &str, ids: &[String]) -> Result<(), ApiError> {
        reorder_by_id(&mut self.scene_mut(scene_id)?.images, ids, |i| &i.id)
    }

    pub fn reorder_tracks(&mut self, scene_id: &str, ids: &[String]) -> Result<(), ApiError> {
        reorder_by_id(&mut self.scene_mut(scene_id)?.tracks, ids, |t| &t.id)
    }

    pub fn reorder_effects(&mut self, ids: &[String]) -> Result<(), ApiError> {
        reorder_by_id(&mut self.app.effects, ids, |e| &e.id)
    }

    // Einstellungen

    pub fn set_master_fade(&mut self, ms: u32) -> Result<(), ApiError> {
        self.app.master_fade_ms = check_range(ms, 0, MAX_MASTER_FADE_MS)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> Store {
        let mut store = Store::new(new_app_data("hash".into()));
        for (id, kind) in [
            ("bild", AssetKind::Image),
            ("bild2", AssetKind::Image),
            ("ton", AssetKind::Audio),
            ("ton2", AssetKind::Audio),
        ] {
            store.assets.insert(
                id.into(),
                Asset {
                    id: id.into(),
                    kind,
                    name: format!("{id}.dat"),
                    mime: "application/octet-stream".into(),
                    size_bytes: 1,
                    ext: "dat".into(),
                },
            );
        }
        store
    }

    #[test]
    fn das_erste_projekt_wird_aktiv_weitere_nicht() {
        let mut store = store();
        let first = store.create_project("Eins").unwrap();
        let second = store.create_project("Zwei").unwrap();
        assert_eq!(store.app.active_project_id, Some(first.id.clone()));
        assert_ne!(store.app.active_project_id, Some(second.id));
    }

    #[test]
    fn geloeschtes_aktives_projekt_laesst_keines_aktiv() {
        let mut store = store();
        let first = store.create_project("Eins").unwrap();
        store.create_project("Zwei").unwrap();
        store.delete_project(&first.id).unwrap();
        assert_eq!(store.app.active_project_id, None);
        assert!(store.content().scene.is_none());
    }

    #[test]
    fn neue_szene_startet_mit_platzhaltern() {
        let mut store = store();
        let project = store.create_project("P").unwrap();
        let scene = store.create_scene(&project.id, "S").unwrap();
        assert_eq!(scene.images[0].asset_id, BUILTIN_BLACK);
        assert_eq!(scene.tracks[0].asset_id, BUILTIN_SILENCE);
        assert_eq!(scene.slide_duration_ms, 30_000);
        assert_eq!(scene.slide_fade_ms, 2_000);
    }

    #[test]
    fn echte_medien_ersetzen_platzhalter_und_umgekehrt() {
        let mut store = store();
        let project = store.create_project("P").unwrap();
        let scene = store.create_scene(&project.id, "S").unwrap();

        let image = store.add_image(&scene.id, "bild").unwrap();
        let track = store.add_track(&scene.id, "ton", None, None).unwrap();
        let current = store.projects[&project.id].scenes[0].clone();
        assert_eq!(current.images.len(), 1);
        assert_eq!(current.images[0].asset_id, "bild");
        assert_eq!(current.tracks.len(), 1);
        assert_eq!(current.tracks[0].name, "ton.dat");

        store.remove_image(&scene.id, &image.id).unwrap();
        store.remove_track(&scene.id, &track.id).unwrap();
        let current = store.projects[&project.id].scenes[0].clone();
        assert_eq!(current.images[0].asset_id, BUILTIN_BLACK);
        assert_eq!(current.tracks[0].asset_id, BUILTIN_SILENCE);
    }

    #[test]
    fn falsche_dateiart_wird_abgelehnt() {
        let mut store = store();
        let project = store.create_project("P").unwrap();
        let scene = store.create_scene(&project.id, "S").unwrap();
        assert_eq!(
            store.add_image(&scene.id, "ton"),
            Err(ApiError::InvalidValue)
        );
        assert_eq!(
            store.add_track(&scene.id, "bild", None, None),
            Err(ApiError::InvalidValue)
        );
        assert_eq!(
            store.create_effect("bild", None, None),
            Err(ApiError::InvalidValue)
        );
    }

    #[test]
    fn aktive_szene_laesst_sich_nicht_loeschen() {
        let mut store = store();
        let project = store.create_project("P").unwrap();
        let scene = store.create_scene(&project.id, "S").unwrap();
        store.activate_scene(&scene.id).unwrap();
        assert_eq!(store.delete_scene(&scene.id), Err(ApiError::SceneActive));
    }

    #[test]
    fn gemerkte_szene_eines_inaktiven_projekts_darf_weg() {
        let mut store = store();
        let first = store.create_project("Eins").unwrap();
        let second = store.create_project("Zwei").unwrap();
        let scene = store.create_scene(&first.id, "S").unwrap();
        store.activate_scene(&scene.id).unwrap();
        store.activate_project(&second.id).unwrap();

        store.delete_scene(&scene.id).unwrap();
        store.activate_project(&first.id).unwrap();
        assert_eq!(store.active_scene_id(), None);
        assert!(store.content().scene.is_none());
    }

    #[test]
    fn szene_eines_inaktiven_projekts_laesst_sich_nicht_aktivieren() {
        let mut store = store();
        store.create_project("Eins").unwrap();
        let second = store.create_project("Zwei").unwrap();
        let scene = store.create_scene(&second.id, "S").unwrap();
        assert_eq!(store.activate_scene(&scene.id), Err(ApiError::WrongProject));
    }

    #[test]
    fn projekt_merkt_sich_seine_szene() {
        let mut store = store();
        let first = store.create_project("Eins").unwrap();
        let second = store.create_project("Zwei").unwrap();
        let scene = store.create_scene(&first.id, "S").unwrap();
        store.activate_scene(&scene.id).unwrap();

        store.activate_project(&second.id).unwrap();
        assert!(store.content().scene.is_none());
        store.activate_project(&first.id).unwrap();
        assert_eq!(store.content().scene.unwrap().id, scene.id);
    }

    #[test]
    fn verwendete_datei_bleibt_und_platzhalter_sind_geschuetzt() {
        let mut store = store();
        let project = store.create_project("P").unwrap();
        let scene = store.create_scene(&project.id, "S").unwrap();
        let image = store.add_image(&scene.id, "bild").unwrap();
        let effect = store.create_effect("ton", None, None).unwrap();

        assert_eq!(store.delete_asset("bild"), Err(ApiError::AssetInUse));
        assert_eq!(store.delete_asset("ton"), Err(ApiError::AssetInUse));
        assert_eq!(
            store.delete_asset(BUILTIN_BLACK),
            Err(ApiError::InvalidValue)
        );

        store.remove_image(&scene.id, &image.id).unwrap();
        store.delete_effect(&effect.id).unwrap();
        assert!(store.delete_asset("bild").is_ok());
        assert!(store.delete_asset("ton").is_ok());
    }

    #[test]
    fn werte_ausserhalb_des_bereichs_werden_abgelehnt() {
        let mut store = store();
        let project = store.create_project("P").unwrap();
        let scene = store.create_scene(&project.id, "S").unwrap();
        let track_id = scene.tracks[0].id.clone();
        let too_loud = TrackPatch {
            volume: Some(1.5),
            ..TrackPatch::default()
        };
        let too_far = TrackPatch {
            pan: Some(-1.5),
            ..TrackPatch::default()
        };
        assert_eq!(
            store.update_track(&scene.id, &track_id, too_loud),
            Err(ApiError::InvalidValue)
        );
        assert_eq!(
            store.update_track(&scene.id, &track_id, too_far),
            Err(ApiError::InvalidValue)
        );
        assert_eq!(store.create_project("   "), Err(ApiError::InvalidValue));
        assert_eq!(store.set_master_fade(60_000), Err(ApiError::InvalidValue));
    }

    #[test]
    fn reihenfolge_braucht_alle_eintraege() {
        let mut store = store();
        let project = store.create_project("P").unwrap();
        let a = store.create_scene(&project.id, "A").unwrap();
        let b = store.create_scene(&project.id, "B").unwrap();
        assert_eq!(
            store.reorder_scenes(&project.id, std::slice::from_ref(&a.id)),
            Err(ApiError::InvalidValue)
        );
        store
            .reorder_scenes(&project.id, &[b.id.clone(), a.id.clone()])
            .unwrap();
        assert_eq!(store.projects[&project.id].scenes[0].id, b.id);
    }

    #[test]
    fn snapshot_ohne_namen_und_mit_master() {
        let mut store = store();
        let project = store.create_project("P").unwrap();
        let scene = store.create_scene(&project.id, "S").unwrap();
        store.activate_scene(&scene.id).unwrap();
        let json = serde_json::to_value(store.content()).unwrap();
        assert_eq!(json["masterOn"], true);
        assert_eq!(json["masterFadeMs"], 400);
        assert_eq!(json["scene"]["id"], scene.id.as_str());
        assert_eq!(json["scene"]["tracks"][0]["mode"], "buffer");
        assert!(json["scene"].get("name").is_none());
    }
}
