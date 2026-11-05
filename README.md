# Ambient Forge

Bild und Ton für Rollenspielrunden im lokalen Netzwerk. Der Spielleiter steuert alles am Pult,
ein beliebiger Browser im selben Netz zeigt die Szene im Vollbild und spielt den Ton.

## Starten

Das Paket entpacken und die Datei `ambient-forge` starten. Eine Installation ist nicht nötig.

```sh
tar -xzf ambient-forge-*-linux-x86_64.tar.gz
cd ambient-forge-*-linux-x86_64
./ambient-forge
```

Beim ersten Start zeigt das Terminal das Admin-Passwort, die Adresse des Pults und einen QR-Code.
Das Passwort erscheint nur dieses eine Mal. Im Ordner `ambient-forge-data/` neben der Binary liegen alle
Daten, ein Backup ist eine Kopie dieses Ordners.

```text
ambient-forge [--port <port>] [--web-dir <pfad>] [--data-dir <pfad>] [--reset-password]
```

| Parameter | Bedeutung |
| --- | --- |
| `--port` | Port des Webservers, Standard 8080 |
| `--web-dir` | Frontend-Ordner, Standard `ambient-forge-web/` neben der Binary |
| `--data-dir` | Datenordner, Standard `ambient-forge-data/` neben der Binary |
| `--reset-password` | Erzeugt ein neues Admin-Passwort und zeigt es im Terminal |

Nach einem Neustart des Servers muss sich das Pult neu anmelden. Anzeigen verbinden sich von selbst.

## So geht ein Spielabend

1. Im Pult unter **Anzeige** den Link kopieren oder den QR-Code scannen.
2. Den Link am Fernseher, Beamer oder Tablet öffnen und **Anzeige starten** drücken.
   Ohne diesen Klick lassen Browser keinen Ton zu.
3. Im **Pult** eine Szene mit **Zeigen** starten.
4. Effekt-Tasten und der **Master** bleiben in jeder Ansicht unten erreichbar.

## Gut zu wissen

- **Lückenlose Loops:** WAV und Opus eignen sich am besten. MP3-Dateien enthalten oft Füll-Samples
  und erzeugen dann eine kleine Lücke am Loop-Punkt.
- **Lange Musik:** Der Modus *Lückenlos im Loop* hält die ganze Datei dekodiert im Speicher, zehn
  Minuten Stereo brauchen etwa 115 MB. Für lange Stücke gibt es den Modus *Lange Musik*. Dateien über
  20 MB bekommen ihn automatisch, dafür entsteht am Loop-Punkt eine kleine Lücke.
- **Bildschirm wach halten:** Über eine LAN-Adresse sperren Browser die Wake-Lock-API. Stelle das
  Einschlafen des Bildschirms am Anzeigegerät in den Energieeinstellungen ab.
- **Vollbild:** Auf dem iPhone gibt es für Webseiten keinen Vollbildmodus. Die Anzeige füllt dort das
  Browserfenster.
- **Sicherheit:** Die Anwendung nutzt unverschlüsseltes HTTP und ist für das Heimnetz gedacht, nicht
  für das offene Internet.

## Aufbau

```text
crates/server/   Rust: axum, REST, WebSocket, Uploads, Speicherung
admin/           Vue 3 und Vite: Quellcode des Pults, baut nach ambient-forge-web/admin/
ambient-forge-web/     Alles, was der Browser bekommt
  display/       Anzeige, handgeschrieben ohne Build
  engine/        Engine, handgeschrieben ohne Build, unabhängig von Server und Vue
  builtin/       Schwarzes Bild und leere Tonspur
  version.json   Protokollversion des Frontends
docs/            Spezifikation
e2e/             Tests im echten Browser
scripts/         Paket bauen, Syntax prüfen
```

Die Engine lässt sich auch ohne diesen Server verwenden:

```js
import { createEngine } from "/engine/index.js";

const engine = createEngine({ container, resolveAsset: (id) => `/medien/${id}` });
engine.unlock();              // im Klick-Handler aufrufen
await engine.apply(snapshot); // Zielzustand setzen, Aufbau siehe docs/spezifikation.md
engine.playOneShot("fx_01");
engine.on("status", console.log);
```

## Entwickeln

Gebraucht werden Rust und Node.js. Das Paket selbst braucht beides nicht.

```sh
cd admin && npm install && npm run build && cd ..
cargo run -- --web-dir ambient-forge-web --data-dir ambient-forge-data
```

Für Hot Reload zusätzlich `npm run dev` in `admin/` starten und `http://localhost:5173/admin/` öffnen.
Vite leitet `/api` und `/ws` an den Server auf Port 8080 weiter.

Dateien in `ambient-forge-web/display/` und `ambient-forge-web/engine/` wirken nach dem Neuladen im Browser, ohne
Build und ohne Neustart. Sie laufen ohne Transpiler und dürfen deshalb nur Syntax bis ES2019 nutzen,
damit auch ältere Smart-TVs sie ausführen können. Das prüft `npm run check:plain` in `admin/`.

## Testen

```sh
cargo test                 # Fachregeln, Speicherung, Dateierkennung
./e2e/make-media.sh        # Testmedien erzeugen, braucht ffmpeg
node e2e/run.cjs           # Alle Abläufe in Chromium, braucht Playwright
FIREFOX_ENV=/pfad python3 e2e/firefox.py   # Kernabläufe in Firefox, braucht Selenium
```

Die Browsertests messen das Audiosignal am Ausgang der Web Audio API.

## Paket bauen

```sh
./scripts/package.sh
```

Das Skript legt in `dist/` ein statisch gelinktes Paket für Linux x86-64 und ein Quellcode-Archiv an.

## Weiterlesen

- `docs/spezifikation.md`: Datenmodell, Protokoll und Abläufe
- `docs/roadmap.md`: offene Punkte, Pläne für Video und Szenen-Browser
- `docs/freie-inhalte.md`: freie Medien und ihre Lizenzen
