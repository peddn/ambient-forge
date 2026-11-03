//! Schreibt Daten in einem eigenen Thread auf die Platte.
//!
//! Dateien werden über eine temporäre Datei ersetzt, damit ein Absturz keine halbe
//! Datei hinterlässt. Reglerbewegungen werden gesammelt und erst nach einer Sekunde
//! Ruhe geschrieben.

use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

const QUIET_PERIOD: Duration = Duration::from_secs(1);
const IDLE_WAIT: Duration = Duration::from_secs(3600);

enum Job {
    Write { path: PathBuf, bytes: Vec<u8> },
    WriteLater { path: PathBuf, bytes: Vec<u8> },
    Remove { path: PathBuf },
    Flush { done: mpsc::Sender<()> },
}

#[derive(Clone)]
pub struct Saver {
    jobs: mpsc::Sender<Job>,
}

pub fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let mut temporary = path.as_os_str().to_owned();
    temporary.push(".tmp");
    let temporary = PathBuf::from(temporary);
    let mut file = fs::File::create(&temporary)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    drop(file);
    fs::rename(&temporary, path)
}

fn write_logged(path: &Path, bytes: &[u8]) {
    if let Err(error) = write_atomic(path, bytes) {
        eprintln!("Speichern von {} fehlgeschlagen: {error}", path.display());
    }
}

fn write_all(pending: &mut HashMap<PathBuf, Vec<u8>>) {
    for (path, bytes) in pending.drain() {
        write_logged(&path, &bytes);
    }
}

fn run(jobs: mpsc::Receiver<Job>) {
    let mut pending: HashMap<PathBuf, Vec<u8>> = HashMap::new();
    let mut deadline: Option<Instant> = None;

    loop {
        let wait = deadline.map_or(IDLE_WAIT, |at| at.saturating_duration_since(Instant::now()));
        match jobs.recv_timeout(wait) {
            Ok(Job::Write { path, bytes }) => {
                pending.remove(&path);
                write_logged(&path, &bytes);
            }
            Ok(Job::WriteLater { path, bytes }) => {
                pending.insert(path, bytes);
                deadline = Some(Instant::now() + QUIET_PERIOD);
            }
            Ok(Job::Remove { path }) => {
                pending.remove(&path);
                if let Err(error) = fs::remove_file(&path)
                    && error.kind() != std::io::ErrorKind::NotFound
                {
                    eprintln!("Löschen von {} fehlgeschlagen: {error}", path.display());
                }
            }
            Ok(Job::Flush { done }) => {
                write_all(&mut pending);
                deadline = None;
                let _ = done.send(());
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                write_all(&mut pending);
                deadline = None;
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                write_all(&mut pending);
                return;
            }
        }
    }
}

impl Saver {
    pub fn start() -> Self {
        let (jobs, receiver) = mpsc::channel();
        thread::spawn(move || run(receiver));
        Self { jobs }
    }

    fn send(&self, job: Job) {
        if self.jobs.send(job).is_err() {
            eprintln!("Der Speicher-Thread läuft nicht mehr.");
        }
    }

    pub fn write(&self, path: PathBuf, bytes: Vec<u8>) {
        self.send(Job::Write { path, bytes });
    }

    pub fn write_later(&self, path: PathBuf, bytes: Vec<u8>) {
        self.send(Job::WriteLater { path, bytes });
    }

    pub fn remove(&self, path: PathBuf) {
        self.send(Job::Remove { path });
    }

    pub fn flush(&self) {
        let (done, finished) = mpsc::channel();
        self.send(Job::Flush { done });
        let _ = finished.recv();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schreibt_atomar_und_hinterlaesst_keine_temporaere_datei() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("app.json");
        write_atomic(&path, b"eins").unwrap();
        write_atomic(&path, b"zwei").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"zwei");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn spaetes_schreiben_sammelt_und_flush_schreibt_den_letzten_stand() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("projekt.json");
        let saver = Saver::start();
        saver.write_later(path.clone(), b"eins".to_vec());
        saver.write_later(path.clone(), b"zwei".to_vec());
        assert!(!path.exists());
        saver.flush();
        assert_eq!(fs::read(&path).unwrap(), b"zwei");
    }

    #[test]
    fn sofortiges_schreiben_ersetzt_den_wartenden_stand() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("projekt.json");
        let saver = Saver::start();
        saver.write_later(path.clone(), b"alt".to_vec());
        saver.write(path.clone(), b"neu".to_vec());
        saver.flush();
        assert_eq!(fs::read(&path).unwrap(), b"neu");
    }
}
