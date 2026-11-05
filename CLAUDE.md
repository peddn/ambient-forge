# Arbeitshinweise für Ambient Forge

Kommuniziert wird auf Deutsch. Spezifikation: `docs/spezifikation.md`. Offene Punkte und Pläne: `docs/roadmap.md`.
Lizenzrecherche für Szenen-Sets: `docs/freie-inhalte.md`. Vor neuer Arbeit zuerst die Roadmap lesen.

## Zusammenarbeit

- Der Auftraggeber arbeitet unter Arch Linux mit KDE und Firefox und kann Claude-Artefakte nicht öffnen.
  Ergebnisse kommen deshalb über das Repo oder als Dateien.
- Neue Versionen direkt nach `main` pushen und die Patch-Version erhöhen, damit `git pull` genügt.
  Betroffen sind `crates/server/Cargo.toml`, `admin/package.json` und die Lockdateien.
- Zahlenwerte im Pult sind Schieberegler, wo immer das geht.
- HTML und Vorlagen liegen extern in `ambient-forge-web/`, nicht in der Binary.

## Technische Regeln

- Rust nur für Server und Webserver. Pult in Vue mit Vite. Anzeige und Engine ohne Build.
- `ambient-forge-web/display/` und `ambient-forge-web/engine/` dürfen nur Syntax bis ES2019 nutzen, wegen
  Smart-TVs mit Chromium 76. Prüfung: `npm run check:plain` in `admin/`.
- `ambient-forge-web/admin/` ist Build-Ausgabe und nicht versioniert.
- Griffe sind `span`, keine `button`, weil Firefox Buttons nicht ziehen lässt.

## Prüfen

```sh
cargo test
cd admin && npm ci && npm run build && npm run check:plain && cd ..
cargo build --release
./e2e/make-media.sh
node e2e/run.cjs
FIREFOX_ENV=/pfad python3 e2e/firefox.py
```

Die Firefox-Umgebung braucht firefox, geckodriver und pulseaudio aus conda-forge. In der Sandbox lag sie unter
`/tmp/claude-0/ff/env` und muss neu angelegt werden, wenn der Container gewechselt hat.

## Stolperfallen

- Prozesse mit `pkill -x ambient-forge` beenden. `pkill -f` trifft die eigene Shell.
- WebDriver liefert in Firefox kein `drop`. Der Test nutzt echtes `dragstart` und `dragover` und ergänzt `drop`.
  Testdaten müssen im Ausgangszustand von Soll abweichen, sonst besteht der Test ohne Aussage.
- In der Sandbox laufen WebSockets aus Chromium zu LAN-Adressen in den Proxy und enden mit 403. Das ist kein
  Fehler des Servers. Browsertests laufen über 127.0.0.1, `LIKE_LAN` entfernt Wake Lock und Zwischenablage.
- Proxy-Einstellungen nicht umgehen, siehe `/root/.ccr/README.md`.
- Aus der Shell sind Seiten wie Openverse, Commons und Freesound nicht erreichbar.
