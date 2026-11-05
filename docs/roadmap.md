# Ambient Forge: Stand und offene Punkte

Die Entwicklung ruht seit November 2026 auf Wunsch des Auftraggebers. Stand ist Version 0.1.2.
Diese Datei hält fest, was offen ist, damit die Arbeit ohne Verluste weitergehen kann.
`spezifikation.md` beschreibt das Gebaute, diese Datei das Geplante.

## Stand von Version 0.1.2

Pult, Anzeige, Engine und Server sind fertig und laufen beim Auftraggeber unter Arch Linux mit KDE und Firefox.

| Prüfung | Ergebnis |
| --- | --- |
| Rust-Tests (`cargo test`) | 33 bestanden |
| Chromium (`e2e/run.cjs`) | 164 von 164 |
| Firefox (`e2e/firefox.py`) | 40 von 40 |

## Entscheidungen des Auftraggebers

Diese Punkte blockieren die nächsten Schritte. Die Empfehlung gilt, solange nichts anderes entschieden ist.

| Frage | Empfehlung |
| --- | --- |
| Video ein eigener Bildtyp in der Diashow oder ein einziger Hintergrund je Szene? | Eintrag in der Diashow, gemischt mit Bildern |
| Läuft der Ton eines Videos mit? | Nein, immer stumm. Ton kommt aus den Spuren, dort gibt es Regler, Panning und Mute |
| Wie lange steht ein Video? | Es läuft in Schleife für die Standzeit der Szene. Ein einzelnes Video läuft durchgehend |
| Wo liegen die Szenen-Sets? | Als fertige Pakete im Release des Repos, nicht als Sammlung von Links auf Fremdseiten |
| Welche Schrift bekommt das Logo? | Sechs Vorschläge liegen vor, Cinzel ist bis zur Wahl gesetzt |
| Soll es ein `./start.sh` geben, das Build und Start zusammenfasst? | Offen, kam im Gespräch nicht mehr zur Sprache |

## Video im Hintergrund

Video wird derzeit nirgends unterstützt. Der Server lehnt solche Uploads ab, weil `sniff.rs` nur JPEG, PNG,
WebP, WAV, FLAC, OGG und MP3 erkennt. `AssetKind` kennt nur `Image` und `Audio`.

Vorarbeit ist vorhanden: `ServeFile` beantwortet Range-Anfragen, das Upload-Limit liegt bei 2 GiB, und
`present()` in `slideshow.js` blendet beliebige Elemente über.

| Bereich | Änderung |
| --- | --- |
| `sniff.rs` | MP4 am `ftyp` ab Byte 4 erkennen, WebM an `1A 45 DF A3`. Reine Audio-Container wie M4A ausschließen |
| `model.rs` | `AssetKind::Video`. Ein Eintrag in `images` darf auf ein Video zeigen, die Regeln in `store.rs` prüfen das |
| Snapshot | `images` bekommt `kind`, damit die Engine das passende Element anlegt |
| `slideshow.js` | `<video muted loop playsinline>` statt `new Image()`, laden bis `canplay`, dann `play()`. Beim Abbau `pause()`, `src` entfernen, `load()` |
| Master aus | Video nach dem Ausblenden pausieren und beim Einblenden fortsetzen, das schont schwache Geräte |
| Pult | `accept` in `AddFiles.vue` erweitern, Vorschau über `<video preload="metadata">`, Art in `FilesView` zeigen |
| Fehler | Ein Browser ohne passenden Decoder meldet das wie heute bei Audio über den Status der Anzeige |
| Tests | Testvideo in `e2e/make-media.sh`, Abläufe in beiden Browsertests |

Stumme Videos dürfen in Chrome, Firefox und Safari ohne Klick starten, die Anzeige ist also nicht auf die
Tonfreigabe angewiesen. Mehrere Anzeigen laufen nicht bildgenau synchron, das ist für Hintergründe unkritisch.

**Formate:** Mozillas Hilfeseite listet H.264 für Firefox unter Windows, macOS und Android, Linux aber nicht.
VP9 in WebM und AV1 stehen dort auch für Linux. H.264 hängt unter Linux an den Systembibliotheken und muss
auf dem Arch-Rechner getestet werden. Für Smart-TVs mit Chromium 76 ist noch nichts geprüft. Bis dahin gilt:
beide Formate annehmen, kein Format vorschreiben und auf echten Geräten messen, auch die Decoderlast bei 4K.

**Günstige Alternative:** Ein langsamer Zoom über Standbilder bringt Bewegung ohne Videodateien und fügt sich
in `slideshow.js` als CSS-Transform ein. Das lohnt sich unabhängig von Video, weil die Sets zunächst ohne
Video auskommen müssen, siehe `freie-inhalte.md`.

## Szenen-Browser

Ein neuer Menüpunkt zeigt fertige Szenen. Ein Klick legt daraus eine Szene im aktiven Projekt an, mit Bild,
Spuren, Lautstärken und Quellenangaben. Die Recherche in `freie-inhalte.md` zeigt: Für alle vier Themen gibt
es brauchbares Material unter CC0, Public Domain oder CC BY, für Video jedoch nichts, das wir weitergeben dürfen.

**Pakete statt Links.** Ein Set ist eine ZIP-Datei mit `set.json` und den Medien. Wir bereiten es einmal vor
und legen es als Release-Anhang ab. Der Server lädt nur noch von dieser einen Stelle.

- Fremde Seiten können Dateien verschieben oder sperren, unser Paket bleibt.
- Vorbereitete Loops gibt es nur im Paket. Viele gute Aufnahmen sind keine Loops, und ein harter Schnitt ist hörbar.
- Bilder lassen sich auf 16:9 zuschneiden, Lautstärken angleichen.
- Eine ZIP-Datei lässt sich auch ohne Internet im Pult importieren, das passt zum Betrieb im lokalen Netz.

**Paketinhalt.**

```json
{
  "format": 1,
  "id": "fantasy-taverne",
  "name": "Fantasy-Taverne",
  "scene": {
    "transitionMs": 2000,
    "slideDurationMs": 30000,
    "slideFadeMs": 2000,
    "images": [{ "file": "bild.jpg", "credit": 0 }],
    "tracks": [
      { "file": "musik.flac", "name": "Musik", "volume": 0.6, "pan": 0, "muted": false, "mode": "buffer", "credit": 1 }
    ]
  },
  "credits": [
    { "title": "Tavern Scene", "author": "Adriaen van Ostade", "license": "Public Domain", "url": "https://www.nga.gov/artworks/56291-tavern-scene" },
    { "title": "Medieval: The Old Tower Inn", "author": "RandomMind", "license": "CC0-1.0", "url": "https://opengameart.org/content/medieval-the-old-tower-inn" }
  ]
}
```

**Schritte.**

1. Import: `POST /api/sets/import` nimmt eine ZIP an, prüft Pfade, Größen und jede Datei mit `sniff.rs`, legt
   Assets über die vorhandene Hash-Logik an und erzeugt die Szene. Der erste echte Inhalt ersetzt wie gewohnt
   die Platzhalter.
2. Quellenangaben: `Asset` bekommt ein optionales Feld `credit`. Das Pult zeigt es in der Dateiansicht und
   beim Set, weil die Anzeige nur das Bild zeigt. CC BY verlangt eine auffindbare Nennung.
3. Vier Sets bauen: Dateien laden, anhören, Loops mit ffmpeg überblenden, Bilder zuschneiden.
   Loops nicht als MP3 ausliefern, weil MP3 am Anfang und Ende Stille mitbringt.
4. Katalog: `catalog.json` mit Vorschaubild, Größe und SHA-256 je Set. Der Server lädt und prüft das Paket.
   Dafür braucht er einen HTTP-Client, das vergrößert die Binary. Ohne Internet bleibt der ZIP-Import.
5. Später eine Suche über Openverse im Pult. Das ist optional und nicht Teil der ersten Fassung.

Die Sets kommen voraussichtlich ohne Video unter 20 MB je Set aus.

## Kleinere offene Punkte

- Echter Test im LAN mit einem zweiten Gerät. Die Sandbox lässt WebSockets aus Chromium zu LAN-Adressen nicht
  durch, Browsertests laufen deshalb über 127.0.0.1.
- Test auf Smart-TV, Safari und iOS steht aus, ebenso die Tonfreigabe dort.
- Lückenlose Loops wurden gemessen, aber nicht angehört. Ein Hörtest mit echter Musik steht aus.
- Sortieren per Griff in Firefox von Hand ausprobieren. WebDriver liefert in Firefox kein `drop`, der Test ergänzt es künstlich.
- Sortieren per Griff geht auf Touchgeräten nicht, HTML5 Drag and Drop greift dort nicht.
- Das Pult hat keine Vorschau der Anzeige.
- Sitzungen leben nur im Speicher, nach einem Serverneustart meldet sich das Pult neu an.
- Die Kopie der Spezifikation als Claude-Dokument verweist nur noch auf `docs/spezifikation.md`, das Repo gilt.
