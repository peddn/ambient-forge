# Ambient Forge: Datenmodell und WebSocket-Protokoll

Stand: 3. November 2026

## Grundprinzipien

Der Server hält den gesamten Zustand, Admin-Oberfläche und Anzeigen sind austauschbare Clients. Nach einem Verbindungsabbruch bringt ein neuer Snapshot jeden Client wieder auf Stand.

```text
Admin-Oberfläche              Rust-Server                  Anzeigen
(Vue 3, eingeloggt)           (Zustand, Speicher)          (Browser mit Engine)

      --- REST: Verwaltung ------>
      --- WebSocket: Befehle ---->
      <-- WebSocket: Zustand -----
                                    --- WebSocket: Befehle -->
                                    <-- WebSocket: Status ----
                                    --- HTTP: Medien -------->
```

Die Admin-Oberfläche spricht nie direkt mit einer Anzeige. Der Server prüft jeden Befehl und verteilt ihn an alle verbundenen Browser.

- **Zwei Rollen:** `admin` ist eingeloggt und darf alles. `display` kommt über den Token im Link, empfängt nur und meldet seinen Status.
- **Zwei Wege:** REST übernimmt Verwaltung, Uploads und Medien. Der WebSocket trägt alles, was sofort wirken muss.
- **Zwei Arten von Daten:** Gespeicherte Daten überstehen einen Neustart. Laufzeitdaten wie die Liste der verbundenen Anzeigen entstehen neu.
- **Unabhängige Engine:** Nur die Anzeigeseite kennt Token und WebSocket. Die Engine bekommt daraus einfache Aufrufe.

Für alle Felder gelten dieselben Konventionen:

- Feldnamen sind in JSON camelCase, in Rust über `#[serde(rename_all = "camelCase")]`.
- Zeiten stehen in Millisekunden, Lautstärken zwischen 0.0 und 1.0, Panning zwischen -1.0 und 1.0.
- IDs vergibt immer der Server.

## Datenmodell

Die Anwendung enthält genau einen Link, einen Master-Schalter, die globalen Effekte und alle Projekte. Medien liegen zentral und werden nur über ihre `assetId` referenziert.

```text
Anwendung (aktives Projekt, Master-Schalter)
├── Link (genau einer)
├── Effect (viele, global) ---------------> Asset
└── Project (viele, eines aktiv)
    └── Scene (viele, eine aktiv)
        ├── Image (mindestens 1) ---------> Asset
        └── Track (mindestens 1) ---------> Asset
```

Der Baum zeigt, was ein Objekt enthält. Die Pfeile sind Verweise auf eine Datei über `assetId`.

### Anwendung

| Feld | Typ | Standard | Bedeutung |
| --- | --- | --- | --- |
| `schemaVersion` | Zahl | 1 | Version des Speicherformats |
| `activeProjectId` | ID oder `null` | `null` | Aktives Projekt |
| `masterOn` | Boolean | `true` | Zustand des Master-Schalters |
| `masterFadeMs` | Zahl | 400 | Dauer des Master-Fades |
| `link` | Link | neu erzeugt | Der einzige Anzeige-Link |
| `effects` | Liste von Effect | leer | Globale Effekte in Button-Reihenfolge |

### Link

| Feld | Typ | Standard | Bedeutung |
| --- | --- | --- | --- |
| `token` | String | neu erzeugt | 128 Bit Zufall, Base64URL-kodiert, 22 Zeichen |
| `enabled` | Boolean | `true` | `false` sperrt den Link, ohne ihn zu ändern |
| `host` | String oder `null` | `null` | Gewählte LAN-Adresse, `null` bedeutet automatisch |

### Project

| Feld | Typ | Standard | Bedeutung |
| --- | --- | --- | --- |
| `id` | ID | vom Server | Kennung |
| `name` | String | Pflichtfeld | Anzeigename |
| `activeSceneId` | ID oder `null` | `null` | Zuletzt aktive Szene dieses Projekts |
| `scenes` | Liste von Scene | leer | Szenen in Listen-Reihenfolge |

### Scene

| Feld | Typ | Standard | Bedeutung |
| --- | --- | --- | --- |
| `id` | ID | vom Server | Kennung |
| `name` | String | Pflichtfeld | Anzeigename |
| `transitionMs` | Zahl | 2000 | Überblendung beim Wechsel in diese Szene |
| `slideDurationMs` | Zahl | 30000 | Standzeit eines Bildes |
| `slideFadeMs` | Zahl | 2000 | Überblendung zwischen zwei Bildern |
| `images` | Liste von Image | `builtin-black` | Bilder in Diashow-Reihenfolge |
| `tracks` | Liste von Track | `builtin-silence` | Soundspuren der Szene |

### Image

| Feld | Typ | Standard | Bedeutung |
| --- | --- | --- | --- |
| `id` | ID | vom Server | Kennung des Eintrags |
| `assetId` | ID | Pflichtfeld | Verweis auf das Bild |

### Track

| Feld | Typ | Standard | Bedeutung |
| --- | --- | --- | --- |
| `id` | ID | vom Server | Kennung |
| `name` | String | Dateiname | Anzeigename, das Pult lässt die Endung weg |
| `assetId` | ID | Pflichtfeld | Verweis auf die Audiodatei |
| `volume` | Zahl | 1.0 | Lautstärke |
| `pan` | Zahl | 0.0 | Panning |
| `muted` | Boolean | `false` | Stummschaltung, `volume` bleibt erhalten |
| `mode` | `buffer` oder `stream` | `buffer` | `buffer` loopt lückenlos, `stream` spart Speicher bei langer Musik. Das Pult wählt `stream` für Dateien über 20 MB |

### Effect

| Feld | Typ | Standard | Bedeutung |
| --- | --- | --- | --- |
| `id` | ID | vom Server | Kennung |
| `name` | String | Dateiname | Beschriftung des Buttons |
| `assetId` | ID | Pflichtfeld | Verweis auf die Audiodatei |
| `volume` | Zahl | 1.0 | Lautstärke des Effekts |

### Asset

| Feld | Typ | Bedeutung |
| --- | --- | --- |
| `id` | ID | SHA-256-Hash des Inhalts, gekürzt auf 32 Hex-Zeichen |
| `kind` | `image` oder `audio` | Art der Datei |
| `name` | String | Ursprünglicher Dateiname |
| `mime` | String | Vom Server am Inhalt erkannter Typ |
| `sizeBytes` | Zahl | Dateigröße |
| `ext` | String | Dateiendung in `media/` |

Der Hash als ID speichert gleiche Dateien nur einmal und erlaubt Browsern dauerhaftes Caching.

Die Platzhalter `builtin-black` und `builtin-silence` liegen als Dateien in `ambient-forge-web/builtin/`. Sie stehen nicht in `assets.json` und lassen sich nicht löschen. Der Medienpfad und `/api/assets/<id>` liefern sie wie normale Dateien aus.

### Regeln

- Das erste angelegte Projekt wird automatisch aktiv.
- Wird das aktive Projekt gelöscht, bleibt `activeProjectId` auf `null`, bis der Spielleiter ein anderes wählt.
- Eine Szene hat immer mindestens ein Bild und eine Spur. Eine neue Szene startet mit einem schwarzen Hintergrund (`builtin-black`) und einer leeren Tonspur (`builtin-silence`).
- Das erste echte Bild und die erste echte Spur ersetzen den jeweiligen Platzhalter. Wird das letzte Bild oder die letzte Spur entfernt, setzt der Server den Platzhalter wieder ein.
- Die aktive Szene des aktiven Projekts kann nicht gelöscht werden. Ist die gemerkte Szene beim Projektwechsel gelöscht, zeigt die Anzeige den Wartebildschirm.
- Eine Datei wird erst gelöscht, wenn kein Bild, keine Spur und kein Effekt mehr auf sie verweist.

## Laufzeitzustand und Snapshot

Der Snapshot ist der komplette Zielzustand einer Anzeige und geht direkt an `engine.apply()`. Ist `scene` gleich `null`, zeigt die Anzeige den Wartebildschirm.

```json
{
  "rev": 42,
  "masterOn": true,
  "masterFadeMs": 400,
  "scene": {
    "id": "scn_01",
    "transitionMs": 2000,
    "slideDurationMs": 30000,
    "slideFadeMs": 2000,
    "images": [
      { "id": "img_01", "assetId": "9f2c..." }
    ],
    "tracks": [
      {
        "id": "trk_01",
        "assetId": "a71d...",
        "volume": 0.8,
        "pan": -0.2,
        "muted": false,
        "mode": "buffer"
      }
    ]
  },
  "effects": [
    { "id": "fx_01", "assetId": "c03b...", "volume": 1.0 }
  ]
}
```

Der Token steht nicht im Snapshot. Die Anzeigeseite übergibt der Engine stattdessen `resolveAsset(assetId)`, das daraus `/d/<token>/media/<assetId>` macht.

`rev` steigt bei jeder Zustandsänderung. Clients verwerfen Nachrichten mit einer kleineren `rev` als der zuletzt gesehenen.

### Zustand für die Admin-Oberfläche

Die Admin-Oberfläche erhält zusätzlich den Link und die verbundenen Anzeigen.

```json
{
  "rev": 42,
  "activeProjectId": "prj_01",
  "activeSceneId": "scn_01",
  "masterOn": true,
  "masterFadeMs": 400,
  "link": {
    "url": "http://192.168.1.20:8080/d/Yk3vT9...",
    "enabled": true,
    "host": null,
    "hosts": ["192.168.1.20", "10.0.0.5"]
  },
  "displays": []
}
```

### Status einer Anzeige

Jeder Eintrag in `displays` beschreibt eine offene Browser-Verbindung.

| Feld | Typ | Bedeutung |
| --- | --- | --- |
| `connectionId` | ID | Vom Server je Verbindung vergeben |
| `client` | String | Aus dem User-Agent abgeleitet, etwa „Chrome auf Android“ |
| `audio` | `locked` oder `running` | Zeigt, ob der Startklick erfolgt ist |
| `sceneId` | ID oder `null` | Szene, die gerade angezeigt wird |
| `sceneState` | `loading`, `ready` oder `error` | Ladezustand dieser Szene |
| `loaded` | Zahl | Bereits geladene Medien, Effekte eingeschlossen |
| `total` | Zahl | Anzahl aller benötigten Medien |
| `errors` | Liste aus `assetId` und `reason` | Dateien, die der Browser nicht laden oder abspielen konnte |
| `rttMs` | Zahl | Zuletzt gemessene Laufzeit zum Server und zurück |

## WebSocket-Protokoll

Alle Nachrichten sind JSON-Textframes mit demselben Umschlag. In Rust passt dazu ein Enum mit `#[serde(tag = "type", content = "data")]`.

```json
{ "type": "scene.activate", "id": "c-17", "data": { "sceneId": "scn_02" } }
```

| Feld | Pflicht | Bedeutung |
| --- | --- | --- |
| `type` | ja | Nachrichtentyp im Format `bereich.aktion` |
| `id` | nein | Vom Client gewählte Kennung, die in `ack` oder `error` zurückkommt |
| `data` | nein | Nutzdaten des Typs |

### Verbindungen

| Pfad | Rolle | Anmeldung |
| --- | --- | --- |
| `/ws/admin` | admin | Session-Cookie, zusätzlich prüft der Server den `Origin`-Header |
| `/ws/display/<token>` | display | Token im Pfad |

Der Server nimmt die Verbindung auch bei ungültigem Token an und schließt sie danach gezielt. Browser verraten JavaScript den HTTP-Status eines abgelehnten Upgrades nicht, die Anzeige würde den Grund sonst nie erfahren.

### Begrüßung

Der Client sendet als Erstes `hello` mit `protocol: 1`. Passt die Version nicht, antwortet der Server mit `reload`. So holen sich offene Browser nach einem Update automatisch das passende Frontend.

Server und Frontend sind getrennte Dateien und könnten deshalb verschiedene Versionen haben. Der Server prüft das beim Start über `ambient-forge-web/version.json`, sonst könnte `reload` in einer endlosen Neulade-Schleife enden.

### Heartbeat

JavaScript hat keinen Zugriff auf WebSocket-Pings, deshalb läuft der Heartbeat als normale Nachricht.

- Der Server sendet alle 5 Sekunden `ping`, der Client antwortet mit `pong`.
- Der Server schließt eine Verbindung nach 15 Sekunden ohne `pong`.
- Der Client verbindet sich neu, wenn er 12 Sekunden lang nichts empfangen hat.
- Aus `ping` und `pong` misst der Server `rttMs`.

### Wiederverbinden

Der Client versucht es nach 0,5, 1, 2 und danach alle 5 Sekunden erneut. Die Anzeige läuft währenddessen mit dem letzten Zustand weiter, ein kurzer WLAN-Aussetzer bleibt also unsichtbar. Nach dem Verbinden gleicht `engine.apply()` nur die Unterschiede ab.

### Antworten und Close-Codes

Nachrichten mit `id` beantwortet der Server mit `ack` oder `error`. Beide tragen dieselbe `id`.

```json
{ "type": "error", "id": "c-17", "data": { "code": "scene_active" } }
```

| Code | Bedeutung | Verhalten des Clients |
| --- | --- | --- |
| 4001 | Token ist ungültig | Anzeige zeigt „Link ungültig“ und verbindet sich nicht neu |
| 4002 | Admin-Sitzung ist abgelaufen | Admin-Oberfläche wechselt zum Login |

## Nachrichten zwischen Admin und Server

Über den WebSocket laufen nur Aktionen, die sofort wirken müssen. Anlegen, Bearbeiten, Löschen und Uploads laufen über REST.

### Admin an Server

| Typ | Daten | Wirkung |
| --- | --- | --- |
| `hello` | `protocol` | Startet die Verbindung |
| `project.activate` | `projectId` | Macht ein Projekt aktiv und zeigt dessen `activeSceneId` |
| `scene.activate` | `sceneId` | Wechselt die Szene im aktiven Projekt |
| `track.update` | `sceneId`, `trackId`, optional `volume`, `pan`, `muted` | Ändert eine Spur und wirkt sofort, wenn die Szene aktiv ist |
| `effect.play` | `effectId` | Spielt einen Effekt auf allen Anzeigen |
| `master.set` | `on` | Blendet Bild und Ton ein oder aus |
| `pong` | `t` | Beantwortet `ping` |

Die Regler senden `track.update` höchstens 30-mal pro Sekunde und ohne `id`. Das `ack` zu `effect.play` enthält `delivered`, die Zahl der Anzeigen mit freigeschaltetem Ton. Bei 0 zeigt die Admin-Oberfläche, dass nichts zu hören ist.

### Server an Admin

| Typ | Daten | Wann |
| --- | --- | --- |
| `state` | Admin-Zustand | Nach dem Verbinden und bei Änderungen an Link, Master, aktivem Projekt oder aktiver Szene |
| `displays` | Liste der Anzeige-Status | Bei Änderungen, höchstens viermal pro Sekunde |
| `track.updated` | `rev` und die Felder von `track.update` | An alle anderen offenen Admin-Browser |
| `data.changed` | `rev`, `scope` (`project`, `effects` oder `assets`), optional `projectId` | Nach REST-Änderungen und Szenenwechseln, damit die Oberfläche diese Daten neu lädt |
| `ack` | je nach Nachricht | Bestätigt eine Nachricht mit `id` |
| `error` | `code` | Lehnt eine Nachricht mit `id` ab |
| `ping` | `t` | Heartbeat |
| `reload` | keine | Protokollversion passt nicht |

### Fehlercodes

REST-Antworten nutzen dieselben Codes.

| Code | Bedeutung |
| --- | --- |
| `not_found` | Das Objekt existiert nicht |
| `wrong_project` | Die Szene gehört nicht zum aktiven Projekt |
| `scene_active` | Die aktive Szene kann nicht gelöscht werden |
| `asset_in_use` | Die Datei wird noch verwendet |
| `invalid_value` | Ein Wert liegt außerhalb des erlaubten Bereichs |
| `unauthorized` | Keine gültige Admin-Sitzung oder falsches Passwort |
| `internal` | Der Server konnte die Aktion nicht ausführen |

## Nachrichten zwischen Server und Anzeige

Die Anzeige empfängt Befehle und meldet nur ihren Status. Alle anderen Nachrichten einer Anzeige verwirft der Server.

### Server an Anzeige

| Typ | Daten | Reaktion der Anzeige |
| --- | --- | --- |
| `snapshot` | Snapshot | `engine.apply(snapshot)` |
| `track.update` | `rev`, `trackId`, optional `volume`, `pan`, `muted` | `engine.updateTrack(trackId, patch)` |
| `effect.play` | `effectId` | `engine.playOneShot(effectId)` |
| `master.set` | `rev`, `on`, `fadeMs` | `engine.setOutput(on, { fadeMs })` |
| `link.disabled` | keine | `engine.stop()`, Hinweis zeigen, Verbindung offen lassen |
| `link.revoked` | keine | `engine.stop()`, danach schließt der Server mit Code 4001 |
| `ping` | `t` | Antwortet mit `pong` |
| `reload` | keine | Lädt die Seite neu |

Der Server sendet `snapshot` nach dem Verbinden, beim Aktivieren des Links und bei jeder anderen Änderung am Inhalt: Szene, Projekt, Diashow, Bilder, Spurenliste oder Effektliste. Nur die häufigen Regleränderungen laufen als kleines `track.update`.

### Anzeige an Server

| Typ | Daten | Wann |
| --- | --- | --- |
| `hello` | `protocol` | Direkt nach dem Verbinden |
| `status` | `audio`, `sceneId`, `sceneState`, `loaded`, `total`, `errors` | Bei Änderungen, höchstens viermal pro Sekunde |
| `pong` | `t` | Antwort auf `ping` |

Die Felder von `status` liefert die Engine über `engine.on("status", callback)`. Das Weiterleiten übernimmt die Anzeigeseite.

## REST-Endpunkte

Alle Pfade unter `/api` außer dem Login verlangen eine Admin-Sitzung. Nach jeder Änderung meldet der Server `data.changed` an alle Admin-Browser und sendet einen neuen `snapshot`, falls die Anzeige betroffen ist.

### Seiten und Anmeldung

| Methode | Pfad | Zweck |
| --- | --- | --- |
| GET | `/` | Leitet zu `/admin` weiter |
| GET | `/admin` und `/admin/*` | Vue-Build aus `ambient-forge-web/admin/`, unbekannte Pfade liefern dessen `index.html` |
| GET | `/d/<token>` | Liefert `ambient-forge-web/display/index.html` |
| GET | `/display/<datei>` | JavaScript und CSS der Anzeige |
| GET | `/engine/<datei>` | Module der Engine |
| GET | `/d/<token>/media/<assetId>` | Medien für die Anzeige |
| POST | `/api/login` | Prüft das Passwort und setzt das Session-Cookie |
| POST | `/api/logout` | Beendet die Sitzung |

### Verwaltung

| Ressource | Pfad | Methoden |
| --- | --- | --- |
| Alle Daten | `/api/data` | GET |
| Projekte | `/api/projects` | POST |
| Ein Projekt | `/api/projects/<id>` | PATCH, DELETE |
| Szenen | `/api/projects/<id>/scenes` | POST |
| Eine Szene | `/api/scenes/<id>` | PATCH, DELETE |
| Bilder einer Szene | `/api/scenes/<id>/images` | POST |
| Ein Bild | `/api/scenes/<id>/images/<imageId>` | DELETE |
| Spuren einer Szene | `/api/scenes/<id>/tracks` | POST |
| Eine Spur | `/api/scenes/<id>/tracks/<trackId>` | PATCH, DELETE |
| Effekte | `/api/effects` | POST |
| Ein Effekt | `/api/effects/<id>` | PATCH, DELETE |
| Dateien | `/api/assets` | POST |
| Eine Datei | `/api/assets/<id>` | GET, DELETE |
| Reihenfolge | `/api/order` | PUT mit `scope`, `parentId`, `ids` |
| Link | `/api/link` | PATCH mit `enabled` oder `host` |
| Link erneuern | `/api/link/renew` | POST |
| Einstellungen | `/api/settings` | PATCH mit `masterFadeMs` |

### Hinweise

- **Frontend:** Der Server liest die Dateien mit `ServeDir` und `ServeFile` aus `tower-http` aus `ambient-forge-web/`. Erreichbar sind nur die genannten Pfade, `..` in einem Pfad führt zu 404. HTML und die Dateien unter `/display` und `/engine` kommen mit `Cache-Control: no-cache`. Die Dateien unter `/admin/assets` kommen mit `immutable`, weil Vite Hashes in ihre Namen schreibt.
- **Templates:** Serverseitige Templates sind nicht nötig. Die Seiten lesen den Token aus der URL und holen ihre Daten über die API und den WebSocket.
- **Upload:** `POST /api/assets` nimmt `multipart/form-data` an und gibt das Asset zurück. Das Standardlimit von axum liegt bei 2 MB und muss für diese Route angehoben werden.
- **Dateitypen:** Erlaubt sind JPEG, PNG und WebP sowie WAV, MP3, OGG, Opus und FLAC. Der Server prüft den Inhalt, nicht die Endung.
- **Medien:** Der Medienpfad antwortet nur bei gültigem, aktiviertem Token, sonst mit 403. Er unterstützt Range-Anfragen, die `stream`-Spuren brauchen.
- **Cache:** Weil der Hash die Datei eindeutig bestimmt, darf der Server `Cache-Control: immutable` senden.
- **Sitzung:** Das Cookie ist `HttpOnly` und `SameSite=Strict`. `Secure` entfällt, weil die Anwendung über HTTP läuft.

## Zentrale Abläufe

Die folgenden Abläufe zeigen, wie Nachrichten und Engine zusammenspielen.

### Anzeige verbinden

1. Der Browser öffnet `/d/<token>`, die Seite zeigt den Startknopf.
2. Die Seite verbindet sich und sendet `hello`, der Server antwortet mit `snapshot`.
3. Die Engine lädt Bilder, Spuren und Effekte vorab. Der Startknopf zeigt den Fortschritt, das Dekodieren braucht noch keinen Klick.
4. Der Klick ruft `engine.unlock()` und, falls möglich, den Vollbildmodus auf.
5. Die Anzeige meldet `audio: running`, die Admin-Oberfläche zeigt sie als bereit.

Ein Neuladen der Seite verlangt wieder einen Klick, der Status steht dann bis dahin auf `locked`.

### Szene wechseln

1. Die Admin-Oberfläche sendet `scene.activate`.
2. Der Server prüft die Regeln, setzt `activeSceneId` und speichert.
3. Der Server sendet `snapshot` an alle Anzeigen und `state` an alle Admin-Browser.
4. Die Engine lädt fehlende Medien und meldet `sceneState: loading`.
5. Danach blendet sie über `transitionMs` über und meldet `ready`.

Jeder Browser blendet über, sobald er selbst geladen hat. Mehrere Anzeigen laufen deshalb nicht sampelgenau synchron.

### Projekt wechseln

Der Ablauf entspricht dem Szenenwechsel, ausgelöst durch `project.activate`. Der Snapshot enthält die `activeSceneId` des neuen Projekts, ohne aktive Szene ist `scene` gleich `null`.

### Soundeffekt auslösen

1. Der Klick sendet `effect.play` über den bestehenden WebSocket.
2. Der Server leitet die Nachricht sofort weiter, ohne Plattenzugriff und ohne Änderung am Zustand.
3. Die Engine startet einen neuen `AudioBufferSourceNode` mit dem vorab dekodierten Buffer.
4. Der Server bestätigt mit `ack` und `delivered`.

Bei ausgeschaltetem Master oder gesperrtem Link verwirft der Server den Effekt und meldet `delivered: 0`. So setzt ein Effekt nicht mitten im Sound ein, wenn kurz danach wieder eingeschaltet wird.

### Master-Schalter

1. Die Admin-Oberfläche sendet `master.set`.
2. Der Server speichert `masterOn` und sendet `master.set` mit `fadeMs` an alle Anzeigen.
3. Die Engine blendet die schwarze Ebene und die Master-Lautstärke über `fadeMs`.

Soundspuren und Diashow laufen im ausgeschalteten Zustand weiter. Ein `snapshot` enthält `masterOn`, deshalb bleiben auch neue Browser schwarz. Szenenwechsel im ausgeschalteten Zustand bleiben unsichtbar, bis wieder eingeschaltet wird.

### Link verwalten

| Aktion | Server | Offene Anzeigen |
| --- | --- | --- |
| Deaktivieren | Setzt `enabled: false`, sendet `link.disabled`, sperrt die Medien | Zeigen den Hinweis und bleiben verbunden |
| Aktivieren | Setzt `enabled: true`, sendet `snapshot` | Laufen von selbst weiter |
| Erneuern | Erzeugt einen neuen Token, sendet `link.revoked`, schließt mit 4001 | Zeigen „Link ungültig“ |

Neue Browser verbinden sich bei deaktiviertem Link ebenfalls, sehen aber nur den Hinweis und erhalten keine Inhalte. Beim Aktivieren laufen sie ohne Neuladen los.

## Speicherung

Alle Daten liegen in einem Ordner neben der Binary, ohne Datenbank. Ein Backup ist damit eine Kopie des Ordners.

```text
ambient-forge-data/
  app.json              Einstellungen, Link, Effekte, Passwort-Hash
  assets.json           Metadaten aller Dateien
  projects/
    <projectId>.json    Ein Projekt mit Szenen, Bildern und Spuren
  media/
    <assetId>.<ext>     Hochgeladene Bilder und Audiodateien
```

- **Sicher schreiben:** Der Server schreibt in eine temporäre Datei und benennt sie dann um. Ein Absturz hinterlässt so keine halbe Datei.
- **Regler sammeln:** `track.update` wirkt sofort, gespeichert wird erst nach 1 Sekunde Ruhe.
- **Passwort:** `app.json` enthält nur einen Argon2-Hash.
- **Migration:** `schemaVersion` erlaubt, ältere Daten beim Start umzuwandeln.

## Start der Anwendung

```text
ambient-forge [--port <port>] [--web-dir <pfad>] [--data-dir <pfad>] [--reset-password]
```

- Der Standardport ist 8080, `--port` ändert ihn.
- Der Server erzeugt das Admin-Passwort beim ersten Start und zeigt es einmalig im Terminal.
- `--reset-password` erzeugt ein neues Passwort und zeigt es ebenso an.
- `--web-dir` wählt einen anderen Frontend-Ordner als `ambient-forge-web/` neben der Binary.
- `--data-dir` wählt einen anderen Datenordner als `ambient-forge-data/` neben der Binary.

### Aufbau der Auslieferung

Die Anwendung wird als Ordner ausgeliefert und läuft nach dem Entpacken ohne Installation.

```text
ambient-forge/
  ambient-forge          Server-Binary
  ambient-forge-web/
    admin/               Vue-Oberfläche aus dem Vite-Build
      index.html
      assets/            Gebündeltes JavaScript und CSS
    display/             Anzeige, handgeschrieben ohne Build
      index.html
      display.js
      display.css
    engine/              Engine, handgeschrieben ohne Build
      index.js
      slideshow.js
      mixer.js
      ramp.js
    builtin/             Schwarzes Bild und leere Tonspur
    version.json         Protokollversion des Frontends
  ambient-forge-data/          Entsteht beim ersten Start
```

- **Startprüfung:** Fehlt eine Datei oder passt `version.json` nicht zur Protokollversion des Servers, bricht der Server mit einer klaren Meldung ab.
- **Builds:** Nur die Admin-Oberfläche wird gebaut. `vite build` schreibt mit `base: '/admin/'` nach `ambient-forge-web/admin/`, `cargo build --release` baut nur den Server.
- **Änderungen:** Angepasste Dateien in `display/` und `engine/` wirken nach dem Neuladen im Browser, ohne Build und ohne Neustart. Änderungen an der Admin-Oberfläche brauchen `vite build`.
- **Vorschau:** Soll die Admin-Oberfläche eine Vorschau zeigen, lädt sie die Engine zur Laufzeit von `/engine/index.js`. Es gibt also nur eine Kopie der Engine.
- **Browser-Ziel:** Engine und Anzeige laufen ohne Transpiler. Damit auch Smart-TVs ab Chromium 76 sie ausführen können, nutzen sie ES-Module und nur Syntax bis ES2019, also kein `?.`, kein `??` und kein Top-Level-`await`. Das prüft `scripts/check-plain-syntax.mjs` mit `ecmaVersion: 2019`.

## Annahmen

Diese Punkte sind festgelegt, lassen sich aber noch ändern. Offene Punkte gibt es derzeit keine.

- Der Master-Schalter, das aktive Projekt und die aktive Szene bleiben nach einem Neustart erhalten.
- Effekte, die bei ausgeschaltetem Master ausgelöst werden, gehen verloren und werden nicht nachgeholt.
- Mehrere Admin-Browser dürfen gleichzeitig offen sein, bei Konflikten gilt die zuletzt eingetroffene Änderung.
- Eine neue Szene startet mit 30 Sekunden Standzeit und 2 Sekunden Überblendung.
- Die Zeitregler im Pult decken Überblendungen bis 60 Sekunden und Standzeiten bis 10 Minuten ab.
- Sitzungen leben nur im Speicher. Nach einem Neustart des Servers meldet sich das Pult neu an.
- Die Admin-Oberfläche hat in dieser Version keine Vorschau der Anzeige.
