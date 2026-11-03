//! Ambient Forge: Bild und Ton für Rollenspielrunden im lokalen Netzwerk.

mod app;
mod auth;
mod error;
mod model;
mod net;
mod rest;
mod saver;
mod sniff;
mod store;
mod token;
mod ws;

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::sync::Arc;

use axum::Router;
use axum::extract::Request;
use axum::http::{HeaderValue, header};
use axum::middleware::{self, Next};
use axum::response::{Redirect, Response};
use axum::routing::{any_service, get};
use clap::Parser;
use serde::Deserialize;
use tower_http::services::{ServeDir, ServeFile};

use crate::app::{App, Paths};
use crate::model::{AppData, Asset, PROTOCOL, Project, SCHEMA_VERSION};
use crate::saver::{Saver, write_atomic};
use crate::store::{Store, new_app_data};

const REQUIRED_WEB_FILES: &[&str] = &[
    "admin/index.html",
    "display/index.html",
    "display/display.js",
    "display/display.css",
    "engine/index.js",
    "engine/mixer.js",
    "engine/ramp.js",
    "engine/slideshow.js",
    "builtin/black.png",
    "builtin/silence.wav",
    "version.json",
];

#[derive(Parser)]
#[command(
    name = "ambient-forge",
    version,
    about = "Bild und Ton für Rollenspielrunden im lokalen Netzwerk"
)]
struct Cli {
    /// Port des Webservers
    #[arg(long, default_value_t = 8080)]
    port: u16,

    /// Frontend-Ordner, Standard: ambient-forge-web neben der Binary
    #[arg(long, value_name = "PFAD")]
    web_dir: Option<PathBuf>,

    /// Datenordner, Standard: ambient-forge-data neben der Binary
    #[arg(long, value_name = "PFAD")]
    data_dir: Option<PathBuf>,

    /// Erzeugt ein neues Admin-Passwort und zeigt es im Terminal
    #[arg(long)]
    reset_password: bool,
}

#[derive(Deserialize)]
struct WebVersion {
    protocol: u32,
}

fn folder_next_to_binary(name: &str) -> Result<PathBuf, String> {
    let binary = std::env::current_exe()
        .map_err(|error| format!("Der Pfad der Binary ist unbekannt: {error}"))?;
    let folder = binary
        .parent()
        .ok_or("Der Ordner der Binary ist unbekannt.")?;
    Ok(folder.join(name))
}

fn check_web_dir(web: &Path) -> Result<(), String> {
    let missing: Vec<&str> = REQUIRED_WEB_FILES
        .iter()
        .copied()
        .filter(|file| !web.join(file).is_file())
        .collect();
    if !missing.is_empty() {
        return Err(format!(
            "Im Frontend-Ordner {} fehlen Dateien: {}\n\
             Prüfe den Pfad oder wähle ihn mit --web-dir. Die Admin-Oberfläche entsteht mit `npm run build`.",
            web.display(),
            missing.join(", ")
        ));
    }

    let version_file = web.join("version.json");
    let text = fs::read_to_string(&version_file)
        .map_err(|error| format!("{} ist nicht lesbar: {error}", version_file.display()))?;
    let version: WebVersion = serde_json::from_str(&text)
        .map_err(|error| format!("{} ist ungültig: {error}", version_file.display()))?;
    if version.protocol != PROTOCOL {
        return Err(format!(
            "Server und Frontend passen nicht zusammen: Der Server spricht Protokoll {PROTOCOL}, \
             das Frontend in {} Protokoll {}.\nInstalliere beide aus demselben Paket.",
            web.display(),
            version.protocol
        ));
    }
    Ok(())
}

fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T, String> {
    let text = fs::read_to_string(path)
        .map_err(|error| format!("{} ist nicht lesbar: {error}", path.display()))?;
    serde_json::from_str(&text)
        .map_err(|error| format!("{} ist beschädigt: {error}", path.display()))
}

fn write_json<T: serde::Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(value).map_err(|error| error.to_string())?;
    write_atomic(path, &bytes)
        .map_err(|error| format!("{} ist nicht beschreibbar: {error}", path.display()))
}

fn show_password(password: &str) {
    println!();
    println!("Admin-Passwort: {password}");
    println!("Es wird nur jetzt angezeigt. Ein neues erzeugt --reset-password.");
    println!();
}

fn new_password_hash() -> Result<String, String> {
    let password = token::new_password();
    let hash = auth::hash_password(&password)?;
    show_password(&password);
    Ok(hash)
}

/// Lädt die gespeicherten Daten oder legt sie beim ersten Start an.
fn load_store(paths: &Paths, reset_password: bool) -> Result<Store, String> {
    for folder in [&paths.data, &paths.projects, &paths.media] {
        fs::create_dir_all(folder)
            .map_err(|error| format!("{} lässt sich nicht anlegen: {error}", folder.display()))?;
    }

    let app_file = paths.app_file();
    let mut app: AppData = if app_file.exists() {
        read_json(&app_file)?
    } else {
        new_app_data(new_password_hash()?)
    };
    if app.schema_version > SCHEMA_VERSION {
        return Err(format!(
            "Die Daten in {} stammen aus einer neueren Version (Schema {}).",
            paths.data.display(),
            app.schema_version
        ));
    }
    if reset_password {
        app.password_hash = new_password_hash()?;
    }
    write_json(&app_file, &app)?;

    let mut store = Store::new(app);

    let assets_file = paths.assets_file();
    if assets_file.exists() {
        let assets: Vec<Asset> = read_json(&assets_file)?;
        store.assets = assets.into_iter().map(|a| (a.id.clone(), a)).collect();
    }

    let mut projects = BTreeMap::new();
    let entries = fs::read_dir(&paths.projects)
        .map_err(|error| format!("{} ist nicht lesbar: {error}", paths.projects.display()))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path
            .extension()
            .is_some_and(|extension| extension == "json")
        {
            let project: Project = read_json(&path)?;
            projects.insert(project.id.clone(), project);
        }
    }
    store.projects = projects;

    // Verweist das aktive Projekt ins Leere, zeigt die Anzeige den Wartebildschirm.
    if store.active_project().is_none() {
        store.app.active_project_id = None;
    }
    Ok(store)
}

async fn cache_headers(request: Request, next: Next) -> Response {
    let path = request.uri().path().to_owned();
    let mut response = next.run(request).await;
    let is_page = path == "/admin"
        || path.starts_with("/admin/")
        || path.starts_with("/display/")
        || path.starts_with("/engine/")
        || (path.starts_with("/d/") && !path.contains("/media/"));
    if path.starts_with("/admin/assets/") {
        response.headers_mut().insert(
            header::CACHE_CONTROL,
            HeaderValue::from_static("public, max-age=31536000, immutable"),
        );
    } else if is_page {
        response
            .headers_mut()
            .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    }
    response
}

fn router(app: Arc<App>) -> Router {
    let web = app.paths.web.clone();
    let admin =
        ServeDir::new(web.join("admin")).fallback(ServeFile::new(web.join("admin/index.html")));
    let display_page = ServeFile::new(web.join("display/index.html"));

    Router::new()
        .route("/", get(|| async { Redirect::temporary("/admin") }))
        .nest("/api", rest::routes())
        .route("/ws/admin", get(ws::admin_socket))
        .route("/ws/display/{token}", get(ws::display_socket))
        .route("/d/{token}", any_service(display_page))
        .route("/d/{token}/media/{asset}", get(rest::display_media))
        .nest_service("/admin", admin)
        .nest_service("/display", ServeDir::new(web.join("display")))
        .nest_service("/engine", ServeDir::new(web.join("engine")))
        .layer(middleware::from_fn(cache_headers))
        .with_state(app)
}

fn print_addresses(app: &App, port: u16) {
    let hosts = net::lan_hosts();
    let token = app.lock().store.app.link.token.clone();
    let host = hosts.first().map_or("localhost", String::as_str);
    let admin = format!("http://{host}:{port}/admin");

    println!("Ambient Forge läuft.");
    println!("  Admin-Oberfläche: {admin}");
    println!("  Auf diesem Rechner: http://localhost:{port}/admin");
    println!("  Anzeige-Link: http://{host}:{port}/d/{token}");
    if let Ok(code) = qrcode::QrCode::new(admin.as_bytes()) {
        let image = code
            .render::<qrcode::render::unicode::Dense1x2>()
            .quiet_zone(true)
            .build();
        println!("\n{image}");
    }
    println!("Beenden mit Strg+C.");
}

async fn shutdown_signal() {
    let interrupt = tokio::signal::ctrl_c();
    let mut terminate =
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()).ok();
    let terminated = async {
        match terminate.as_mut() {
            Some(signal) => {
                signal.recv().await;
            }
            None => std::future::pending().await,
        }
    };
    tokio::select! {
        _ = interrupt => {}
        _ = terminated => {}
    }
}

async fn serve(cli: Cli) -> Result<(), String> {
    let web = match cli.web_dir {
        Some(path) => path,
        None => folder_next_to_binary("ambient-forge-web")?,
    };
    let data = match cli.data_dir {
        Some(path) => path,
        None => folder_next_to_binary("ambient-forge-data")?,
    };
    check_web_dir(&web)?;

    let paths = Paths::new(web, data);
    let store = load_store(&paths, cli.reset_password)?;
    let saver = Saver::start();
    let app = Arc::new(App::new(store, paths, cli.port, saver.clone()));

    let listener = tokio::net::TcpListener::bind(("0.0.0.0", cli.port))
        .await
        .map_err(|error| {
            format!(
                "Port {} lässt sich nicht öffnen: {error}\nWähle einen anderen mit --port.",
                cli.port
            )
        })?;

    print_addresses(&app, cli.port);

    let publisher = app.clone();
    tokio::spawn(async move { publisher.publish_display_list().await });

    tokio::select! {
        result = axum::serve(listener, router(app)) => {
            result.map_err(|error| format!("Der Server wurde beendet: {error}"))?;
        }
        _ = shutdown_signal() => {}
    }
    saver.flush();
    Ok(())
}

#[tokio::main]
async fn main() -> ExitCode {
    match serve(Cli::parse()).await {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("{message}");
            ExitCode::FAILURE
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn complete_web_dir() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        for file in REQUIRED_WEB_FILES {
            let path = dir.path().join(file);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, "").unwrap();
        }
        fs::write(
            dir.path().join("version.json"),
            format!("{{ \"protocol\": {PROTOCOL} }}"),
        )
        .unwrap();
        dir
    }

    #[test]
    fn startpruefung_akzeptiert_vollstaendigen_ordner() {
        assert!(check_web_dir(complete_web_dir().path()).is_ok());
    }

    #[test]
    fn startpruefung_nennt_fehlende_dateien() {
        let dir = complete_web_dir();
        fs::remove_file(dir.path().join("engine/index.js")).unwrap();
        assert!(
            check_web_dir(dir.path())
                .unwrap_err()
                .contains("engine/index.js")
        );
    }

    #[test]
    fn startpruefung_erkennt_falsche_protokollversion() {
        let dir = complete_web_dir();
        fs::write(dir.path().join("version.json"), r#"{ "protocol": 999 }"#).unwrap();
        assert!(check_web_dir(dir.path()).unwrap_err().contains("999"));
    }

    #[test]
    fn daten_ueberstehen_einen_neustart() {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::new(dir.path().join("web"), dir.path().join("data"));
        let first = load_store(&paths, false).unwrap();
        let hash = first.app.password_hash.clone();
        let token = first.app.link.token.clone();

        let second = load_store(&paths, false).unwrap();
        assert_eq!(second.app.password_hash, hash);
        assert_eq!(second.app.link.token, token);

        let third = load_store(&paths, true).unwrap();
        assert_ne!(third.app.password_hash, hash);
        assert_eq!(third.app.link.token, token);
    }

    #[test]
    fn beschaedigte_daten_werden_nicht_ueberschrieben() {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::new(dir.path().join("web"), dir.path().join("data"));
        fs::create_dir_all(&paths.data).unwrap();
        fs::write(paths.app_file(), "kein json").unwrap();
        assert!(
            load_store(&paths, false)
                .unwrap_err()
                .contains("beschädigt")
        );
        assert_eq!(fs::read_to_string(paths.app_file()).unwrap(), "kein json");
    }
}
