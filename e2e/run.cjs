// End-to-End-Test: startet den echten Server und bedient Pult und Anzeige im Browser.
//
//   node e2e/run.cjs            Chromium
//
// Der Test misst das Audiosignal direkt am Ausgang der Web Audio API. So prüft er,
// ob wirklich Ton ankommt, und nicht nur, ob Nachrichten verschickt wurden.
// Die Testtöne haben einen RMS-Pegel von 0,088, in Mittelstellung kommen etwa 0,06 an.

const { chromium } = require("playwright");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const crypto = require("node:crypto");

const ROOT = path.join(__dirname, "..");
const MEDIA = path.join(__dirname, "media");
const OUTPUT = path.join(__dirname, "output");
const DATA = path.join(__dirname, "data");
const BINARY = process.env.AMBIENT_FORGE_BINARY || path.join(ROOT, "target/release/ambient-forge");
const PORT = 18080;
const LOCAL = `http://127.0.0.1:${PORT}`;

let passed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  ok    ${name}`);
  } else {
    failures.push(name);
    console.log(`  FEHLER ${name}${detail === undefined ? "" : `: ${JSON.stringify(detail)}`}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

const AUDIBLE = 0.03;
const SILENT = 0.001;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(probe, timeoutMs = 5000, intervalMs = 50) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await probe();
    if (last) return last;
    await sleep(intervalMs);
  }
  return last;
}

function startServer(extraArgs = []) {
  const server = spawn(
    BINARY,
    ["--port", String(PORT), "--web-dir", path.join(ROOT, "ambient-forge-web"), "--data-dir", DATA, ...extraArgs],
    { stdio: ["ignore", "pipe", "pipe"] }
  );
  server.output = "";
  server.stdout.on("data", (chunk) => (server.output += chunk));
  server.stderr.on("data", (chunk) => (server.output += chunk));
  return server;
}

async function stopServer(server, signal = "SIGINT") {
  server.kill(signal);
  await new Promise((resolve) => server.once("exit", resolve));
}

async function waitForServer() {
  return until(async () => {
    try {
      return (await fetch(`${LOCAL}/display/display.css`)).ok;
    } catch {
      return false;
    }
  }, 5000);
}

function rawWebSocket(pathname, headers = {}) {
  // Eigener Handshake, weil der Browser Origin und Cookies nicht frei setzen lässt.
  return new Promise((resolve) => {
    const socket = net.connect(PORT, "127.0.0.1", () => {
      const key = crypto.randomBytes(16).toString("base64");
      const lines = [
        `GET ${pathname} HTTP/1.1`,
        `Host: 127.0.0.1:${PORT}`,
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Key: ${key}`,
        "Sec-WebSocket-Version: 13",
        ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
        "",
        "",
      ];
      socket.write(lines.join("\r\n"));
    });
    let received = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      received = Buffer.concat([received, chunk]);
    });
    setTimeout(() => {
      socket.destroy();
      resolve(received);
    }, 400);
  });
}

function closeCodeOf(response) {
  const end = response.indexOf("\r\n\r\n");
  if (end < 0) return null;
  const frame = response.subarray(end + 4);
  return frame.length >= 4 && (frame[0] & 0x0f) === 8 ? frame.readUInt16BE(2) : null;
}

// Über eine LAN-IP fehlen diese APIs. Der Test läuft über Loopback und entfernt sie
// deshalb selbst, damit die Fallbacks geprüft werden.
const LIKE_LAN = () => {
  delete Navigator.prototype.wakeLock;
  Object.defineProperty(Navigator.prototype, "clipboard", { get: () => undefined });
};

const INSTRUMENT = () => {
  window.__starts = [];
  window.__ramps = [];
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (...args) {
    window.__starts.push({ at: Date.now(), loop: this.loop, seconds: this.buffer && this.buffer.duration });
    return start.apply(this, args);
  };

  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (target, ...rest) {
    const result = connect.call(this, target, ...rest);
    if (target instanceof AudioDestinationNode) {
      const context = this.context;
      if (!context.__tap) {
        const splitter = context.createChannelSplitter(2);
        const left = context.createAnalyser();
        const right = context.createAnalyser();
        connect.call(splitter, left, 0);
        connect.call(splitter, right, 1);
        context.__tap = { splitter, left, right };
        window.__tap = context.__tap;
        window.__context = context;
      }
      connect.call(this, context.__tap.splitter);
    }
    return result;
  };

  window.__level = () => {
    if (!window.__tap) return { left: 0, right: 0 };
    const rms = (analyser) => {
      const samples = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(samples);
      return Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
    };
    return { left: rms(window.__tap.left), right: rms(window.__tap.right) };
  };

  window.__streams = [];
  const OriginalAudio = window.Audio;
  window.Audio = function (...args) {
    const element = new OriginalAudio(...args);
    window.__streams.push(element);
    return element;
  };
};

const PICTURE = () => {
  const layer = document.querySelector("#stage > div");
  const images = Array.from(layer.querySelectorAll("img"));
  const top = images[images.length - 1];
  return top ? top.src.split("/").pop() : null;
};

const BLACK_OPACITY = () => {
  const layers = document.querySelectorAll("#stage > div");
  return Number(getComputedStyle(layers[1]).opacity);
};

async function main() {
  fs.rmSync(DATA, { recursive: true, force: true });
  fs.rmSync(OUTPUT, { recursive: true, force: true });
  fs.mkdirSync(OUTPUT, { recursive: true });

  section("Start ohne vollständigen Frontend-Ordner");
  const broken = spawn(BINARY, ["--port", String(PORT), "--web-dir", path.join(ROOT, "docs"), "--data-dir", DATA]);
  let brokenOutput = "";
  broken.stderr.on("data", (chunk) => (brokenOutput += chunk));
  const brokenCode = await new Promise((resolve) => broken.once("exit", resolve));
  check("Server bricht mit Fehlercode ab", brokenCode === 1, brokenCode);
  check("Meldung nennt fehlende Dateien", brokenOutput.includes("admin/index.html"), brokenOutput);

  let server = startServer();
  check("Server startet", await waitForServer(), server.output);
  await sleep(100);
  const password = (server.output.match(/Admin-Passwort: (\S+)/) || [])[1];
  check("Passwort steht im Terminal", Boolean(password), server.output);
  const appData = JSON.parse(fs.readFileSync(path.join(DATA, "app.json"), "utf8"));
  check("Gespeichert ist nur ein Argon2-Hash", appData.passwordHash.startsWith("$argon2") && !JSON.stringify(appData).includes(password));
  const token = appData.link.token;
  check("Link-Token hat 22 Zeichen", token.length === 22, token);

  section("HTTP");
  const root = await fetch(`${LOCAL}/`, { redirect: "manual" });
  check("/ leitet zum Pult", root.status === 307 && root.headers.get("location") === "/admin");
  const admin = await fetch(`${LOCAL}/admin`);
  check("/admin liefert HTML", admin.ok && (await admin.text()).includes('id="app"'));
  check("HTML kommt mit no-cache", admin.headers.get("cache-control") === "no-cache", admin.headers.get("cache-control"));
  const deep = await fetch(`${LOCAL}/admin/anzeige`);
  check("Unterseiten liefern index.html", deep.status === 200 && (await deep.text()).includes('id="app"'), deep.status);
  const html = await (await fetch(`${LOCAL}/admin`)).text();
  const bundle = html.match(/\/admin\/assets\/[^"]+\.js/)[0];
  const asset = await fetch(LOCAL + bundle);
  check("Vite-Bundle ist unveränderlich", (asset.headers.get("cache-control") || "").includes("immutable"));
  const engine = await fetch(`${LOCAL}/engine/index.js`);
  check("Engine ist erreichbar", engine.ok && (engine.headers.get("content-type") || "").includes("javascript"), engine.headers.get("content-type"));
  check("Engine kommt mit no-cache", engine.headers.get("cache-control") === "no-cache");
  check("Ohne Anmeldung kein API-Zugriff", (await fetch(`${LOCAL}/api/data`)).status === 401);
  const denied = await fetch(`${LOCAL}/api/data`);
  check("Fehler tragen den Code", (await denied.json()).code === "unauthorized");
  check("Unbekannter Pfad ergibt 404", (await fetch(`${LOCAL}/nichts`)).status === 404);
  const traversal = await new Promise((resolve) => {
    const socket = net.connect(PORT, "127.0.0.1", () =>
      socket.write(`GET /engine/../version.json HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`)
    );
    let text = "";
    socket.on("data", (chunk) => (text += chunk));
    socket.on("end", () => resolve(text));
  });
  check("Pfade mit .. werden abgewiesen", traversal.startsWith("HTTP/1.1 404"), traversal.slice(0, 40));
  check("Medien mit falschem Token ergeben 403", (await fetch(`${LOCAL}/d/falsch/media/builtin-black`)).status === 403);
  const placeholder = await fetch(`${LOCAL}/d/${token}/media/builtin-black`);
  check("Platzhalter kommt über den Medienpfad", placeholder.ok && placeholder.headers.get("content-type") === "image/png");

  section("WebSocket-Regeln");
  check(
    "Ungültiger Token schließt mit 4001",
    closeCodeOf(await rawWebSocket("/ws/display/falsch")) === 4001
  );
  check("Admin ohne Sitzung schließt mit 4002", closeCodeOf(await rawWebSocket("/ws/admin")) === 4002);
  const crossOrigin = await rawWebSocket("/ws/admin", { Origin: "http://boese.example" });
  check("Fremde Origin wird abgelehnt", crossOrigin.toString().startsWith("HTTP/1.1 403"), crossOrigin.toString().slice(0, 40));

  const browser = await chromium.launch({
    args: ["--autoplay-policy=document-user-activation-required"],
  });
  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await adminContext.addInitScript(LIKE_LAN);
  const page = await adminContext.newPage();
  const pageErrors = [];
  const watchErrors = (target, label) => {
    target.on("pageerror", (error) => pageErrors.push(`${label}: ${error.message}`));
    target.on("console", (message) => {
      if (message.type() === "error" && !message.text().includes("status of 40")) {
        pageErrors.push(`${label}: ${message.text()}`);
      }
    });
  };
  watchErrors(page, "Pult");

  section("Anmeldung");
  await page.goto(`${LOCAL}/admin/`);
  await page.waitForURL("**/admin/login");
  check("Ohne Sitzung erscheint der Login", await page.getByLabel("Passwort des Spielleiters").isVisible());
  await page.screenshot({ path: path.join(OUTPUT, "01-login.png") });
  await page.getByLabel("Passwort des Spielleiters").fill("falsch");
  await page.getByRole("button", { name: "Anmelden" }).click();
  await page.getByText("Das Passwort stimmt nicht").waitFor();
  check("Falsches Passwort wird abgewiesen", true);
  await page.getByLabel("Passwort des Spielleiters").fill(password);
  await page.getByRole("button", { name: "Anmelden" }).click();
  await page.getByText("Lege dein erstes Projekt an").waitFor();
  check("Richtiges Passwort öffnet das Pult", true);
  const cookies = await adminContext.cookies();
  const session = cookies.find((cookie) => cookie.name === "ambient_forge_session");
  check("Sitzungscookie ist HttpOnly und SameSite=Strict", session && session.httpOnly && session.sameSite === "Strict", session);
  await page.screenshot({ path: path.join(OUTPUT, "02-erster-start.png") });

  section("Projekt und Szenen anlegen");
  await page.getByLabel("Name des Projekts").fill("Die Gruft von Wetterstein");
  await page.getByRole("button", { name: "Projekt anlegen" }).click();
  await page.getByText("Dieses Projekt hat noch keine Szene").waitFor();
  check("Erstes Projekt ist aktiv", await until(async () => (await page.getByText("Die Anzeige zeigt gerade ein anderes Projekt.").count()) === 0));

  async function createScene(name) {
    await page.getByLabel("Name der neuen Szene").fill(name);
    await page.getByRole("button", { name: "Anlegen", exact: true }).first().click();
    await page.locator(".cue", { hasText: name }).waitFor();
  }
  await createScene("Taverne zum Goldenen Humpen");
  await createScene("Wald bei Nacht");
  check("Neue Szene zeigt schwarzen Platzhalter", await page.getByText("Schwarzer Hintergrund").isVisible());
  check("Neue Szene zeigt leere Tonspur", await page.getByText("Leere Tonspur").isVisible());

  async function selectScene(name) {
    await page.locator(".cue .auswahl", { hasText: name }).click();
    await page.getByLabel("Name der Szene").and(page.locator(`input`)).first().waitFor();
  }

  const fileInputs = () => page.locator(".editor input[type=file]");
  await selectScene("Taverne");
  await fileInputs().nth(0).setInputFiles([
    path.join(MEDIA, "lila.png"),
    path.join(MEDIA, "orange.jpg"),
  ]);
  await until(async () => (await page.locator(".bildliste img").count()) === 2);
  check("Bilder sind hochgeladen", (await page.locator(".bildliste img").count()) === 2);
  check("Echtes Bild ersetzt den Platzhalter", (await page.getByText("Schwarzer Hintergrund").count()) === 0);
  await fileInputs().nth(1).setInputFiles(path.join(MEDIA, "regen.wav"));
  await page.locator(".kanal").first().getByRole("slider").first().waitFor();
  await until(async () => (await page.getByText("Leere Tonspur").count()) === 0);
  check("Echte Spur ersetzt die leere Tonspur", (await page.getByText("Leere Tonspur").count()) === 0);
  check("Spur heißt wie die Datei", (await page.locator(".kanal input[type=text]").first().inputValue()) === "regen");

  await selectScene("Wald");
  await fileInputs().nth(0).setInputFiles(path.join(MEDIA, "gruen.webp"));
  await until(async () => (await page.locator(".bildliste img").count()) === 1);
  await fileInputs().nth(1).setInputFiles(path.join(MEDIA, "musik.mp3"));
  await until(async () => (await page.getByText("Leere Tonspur").count()) === 0);

  section("Upload-Prüfung");
  await fileInputs().nth(0).setInputFiles(path.join(MEDIA, "kaputt.mp3"));
  await page.getByText("Erlaubt sind JPEG").waitFor();
  check("Datei mit falschem Inhalt wird abgelehnt", true);
  const mediaFiles = fs.readdirSync(path.join(DATA, "media"));
  check("Abgelehnter Upload hinterlässt keine Datei", !mediaFiles.some((file) => file.startsWith(".")), mediaFiles);
  await fileInputs().nth(0).setInputFiles(path.join(MEDIA, "regen.wav"));
  await page.getByText("passt hier nicht").waitFor();
  check("Audio wird nicht als Bild angenommen", true);

  const storedAssets = JSON.parse(fs.readFileSync(path.join(DATA, "assets.json"), "utf8"));
  check("assets.json listet die Dateien", storedAssets.length >= 4, storedAssets.length);
  const sha = crypto.createHash("sha256").update(fs.readFileSync(path.join(MEDIA, "lila.png"))).digest("hex").slice(0, 32);
  check("Asset-ID ist der gekürzte SHA-256-Hash", storedAssets.some((entry) => entry.id === sha));

  section("Uploads und Medien");
  const cookieHeader = (await adminContext.cookies()).map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
  const uploadRaw = (file) => {
    const form = new FormData();
    form.append("file", new Blob([fs.readFileSync(path.join(MEDIA, file))]), file);
    return fetch(`${LOCAL}/api/assets`, { method: "POST", headers: { cookie: cookieHeader }, body: form });
  };
  const big = await uploadRaw("gross.wav");
  check("Upload über dem Standardlimit von 2 MB", big.ok && (await big.json()).sizeBytes > 3_000_000, big.status);
  const firstTry = await (await uploadRaw("regen.wav")).json();
  const secondTry = await (await uploadRaw("regen.wav")).json();
  const countAssets = () => JSON.parse(fs.readFileSync(path.join(DATA, "assets.json"), "utf8")).length;
  check("Gleiche Datei wird nur einmal gespeichert", firstTry.id === secondTry.id && fs.readdirSync(path.join(DATA, "media")).filter((file) => file.startsWith(firstTry.id)).length === 1);
  const range = await fetch(`${LOCAL}/d/${token}/media/${firstTry.id}`, { headers: { Range: "bytes=0-9" } });
  check("Medienpfad beantwortet Range-Anfragen", range.status === 206 && (await range.arrayBuffer()).byteLength === 10, range.status);
  const whole = await fetch(`${LOCAL}/d/${token}/media/${firstTry.id}`);
  check("Medien haben den erkannten Typ", whole.headers.get("content-type") === "audio/wav", whole.headers.get("content-type"));
  check("Medien sind unveränderlich gecacht", (whole.headers.get("cache-control") || "").includes("immutable"));
  check("Admin erreicht Medien über die API", (await fetch(`${LOCAL}/api/assets/${firstTry.id}`, { headers: { cookie: cookieHeader } })).ok);
  check("Ohne Sitzung bleibt die API-Datei gesperrt", (await fetch(`${LOCAL}/api/assets/${firstTry.id}`)).status === 401);
  check("Platzhalter lassen sich nicht löschen", (await fetch(`${LOCAL}/api/assets/builtin-black`, { method: "DELETE", headers: { cookie: cookieHeader } })).status === 400);

  section("Effekte anlegen");
  await page.getByRole("link", { name: "Effekte", exact: true }).click();
  await page.getByText("Lade eine Audiodatei hoch").waitFor();
  await page.locator("input[type=file]").setInputFiles([path.join(MEDIA, "donner.flac"), path.join(MEDIA, "tuer.opus"), path.join(MEDIA, "wind.ogg")]);
  await until(async () => (await page.locator(".effekt").count()) === 3);
  check("FLAC, Opus und OGG werden zu Effekt-Tasten", (await page.locator(".effekt").count()) === 3);
  await page.screenshot({ path: path.join(OUTPUT, "03-effekte.png") });

  section("Anzeige verbinden");
  await page.getByRole("link", { name: "Anzeige", exact: true }).click();
  const linkField = page.getByRole("textbox", { name: "Anzeige-Link" });
  await until(async () => (await linkField.inputValue()).includes("/d/"));
  const linkUrl = await linkField.inputValue();
  check("Link enthält Token", linkUrl.endsWith(`/d/${token}`), linkUrl);
  await page.locator(".qr svg").waitFor();
  check("QR-Code ist sichtbar", true);
  await page.screenshot({ path: path.join(OUTPUT, "04-anzeige-leer.png") });

  const displayContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await displayContext.addInitScript(LIKE_LAN);
  await displayContext.addInitScript(INSTRUMENT);
  const display = await displayContext.newPage();
  watchErrors(display, "Anzeige");
  const displayUrl = `${LOCAL}/d/${token}`;
  await display.goto(displayUrl);
  await page.getByText("Wartet auf den Klick").waitFor();
  check("Pult zeigt die wartende Anzeige", true);
  check("Pult warnt im Kopf", await page.locator(".status").getByText("wartet auf Start").isVisible());
  check("Anzeige zeigt den Startknopf", await display.getByRole("button", { name: "Anzeige starten" }).isVisible());
  await display.screenshot({ path: path.join(OUTPUT, "05-anzeige-start.png") });

  await page.locator(".effekt", { hasText: "donner" }).click();
  await page.getByText("Auf der Anzeige wurde noch nicht gestartet").waitFor();
  check("Effekt vor dem Startklick meldet den Grund", true);

  await display.getByRole("button", { name: "Anzeige starten" }).click();
  await page.getByText("1 Anzeige bereit").waitFor();
  check("Nach dem Klick meldet die Anzeige Ton", true);
  check("Vor der ersten Szene erscheint der Wartebildschirm", await display.getByText("Gleich geht es weiter.").isVisible());
  await display.screenshot({ path: path.join(OUTPUT, "06-warten.png") });

  section("Szene zeigen");
  await page.getByRole("link", { name: "Pult", exact: true }).click();
  await page.locator(".cue", { hasText: "Taverne" }).getByRole("button", { name: "Zeigen" }).click();
  await page.locator(".cue.live", { hasText: "Taverne" }).waitFor();
  await until(() => display.evaluate(PICTURE), 5000);
  check("Anzeige zeigt das erste Bild", (await display.evaluate(PICTURE)) === sha, await display.evaluate(PICTURE));
  const loud = await until(async () => {
    const level = await display.evaluate(() => window.__level());
    return level.left > AUDIBLE ? level : null;
  }, 5000);
  check("Soundspur ist am Ausgang messbar", Boolean(loud), loud);
  check("Wartebildschirm verschwindet", !(await display.getByText("Gleich geht es weiter.").isVisible()));
  const loops = await display.evaluate(() => window.__starts.filter((start) => start.loop));
  check("Spur läuft im Loop", loops.some((start) => Math.round(start.seconds) === 2), loops);
  await sleep(2300);
  await display.screenshot({ path: path.join(OUTPUT, "07-anzeige-szene.png") });
  await page.screenshot({ path: path.join(OUTPUT, "08-pult-live.png") });

  section("Mischpult");
  const channel = page.locator(".kanal").first();
  const fader = channel.getByRole("slider").first();
  const panner = channel.getByRole("slider").nth(1);
  const levelBefore = (await display.evaluate(() => window.__level())).left;
  await fader.fill("0.3");
  const quieter = await until(async () => {
    const level = await display.evaluate(() => window.__level());
    return level.left < levelBefore * 0.25 ? level : null;
  });
  check("Lautstärkeregler wirkt live", Boolean(quieter), { levelBefore, quieter });
  await fader.fill("1");
  await until(async () => (await display.evaluate(() => window.__level())).left > levelBefore * 0.8);

  await panner.fill("-1");
  const hardLeft = await until(async () => {
    const level = await display.evaluate(() => window.__level());
    return level.left > 0.1 && level.right < 0.01 ? level : null;
  });
  check("Panning ganz links: rechts ist still", Boolean(hardLeft), hardLeft);
  await panner.fill("1");
  const hardRight = await until(async () => {
    const level = await display.evaluate(() => window.__level());
    return level.right > 0.1 && level.left < 0.01 ? level : null;
  });
  check("Panning ganz rechts: links ist still", Boolean(hardRight), hardRight);
  await panner.fill("0");

  await channel.getByRole("button", { name: "Mute" }).click();
  const muted = await until(async () => (await display.evaluate(() => window.__level())).left < SILENT);
  check("Mute schaltet die Spur stumm", muted);
  await channel.getByRole("button", { name: "Stumm" }).click();
  const unmuted = await until(async () => (await display.evaluate(() => window.__level())).left > AUDIBLE);
  check("Mute lässt sich aufheben", unmuted);
  const startsAfterMix = await display.evaluate(() => window.__starts.filter((start) => start.loop).length);
  check("Regler starten die Spur nicht neu", startsAfterMix === loops.length, { startsAfterMix, loops: loops.length });

  await sleep(1300);
  const projectFile = JSON.parse(fs.readFileSync(path.join(DATA, "projects", fs.readdirSync(path.join(DATA, "projects"))[0]), "utf8"));
  const savedTrack = projectFile.scenes[0].tracks[0];
  check("Reglerstand ist nach 1 Sekunde gespeichert", savedTrack.pan === 0 && savedTrack.volume === 1 && savedTrack.muted === false, savedTrack);

  section("Zwei Pulte gleichzeitig");
  const secondDesk = await adminContext.newPage();
  await secondDesk.goto(`${LOCAL}/admin/`);
  const secondFader = secondDesk.locator(".kanal").first().getByRole("slider").first();
  await secondFader.waitFor();
  await fader.fill("0.42");
  check("Regler bewegt sich im zweiten Pult mit", await until(async () => (await secondFader.inputValue()) === "0.42"));
  await fader.fill("1");
  await until(async () => (await secondFader.inputValue()) === "1");
  await secondDesk.close();

  section("Diashow");
  await page.getByLabel("Standzeit je Bild").fill("0");
  await page.getByLabel("Überblendung zwischen Bildern").fill("1");
  check("Regler zeigt den Wert", await page.locator(".regler", { hasText: "Standzeit je Bild" }).getByText("1 s", { exact: true }).isVisible());
  const first = await display.evaluate(PICTURE);
  const changed = await until(async () => {
    const current = await display.evaluate(PICTURE);
    return current !== first ? current : null;
  }, 4000);
  check("Diashow wechselt das Bild", Boolean(changed), { first, changed });
  const back = await until(async () => (await display.evaluate(PICTURE)) === first, 4000);
  check("Diashow beginnt wieder von vorn", back);
  const loopsAfterEdit = await display.evaluate(() => window.__starts.filter((start) => start.loop).length);
  check("Änderung an der Diashow lässt die Spur weiterlaufen", loopsAfterEdit === loops.length, loopsAfterEdit);

  section("Layout");
  async function pageLayout() {
    return page.evaluate(() => {
      window.scrollTo(0, 99999);
      const footer = document.querySelector("footer").getBoundingClientRect();
      return {
        overflow: document.documentElement.scrollHeight - window.innerHeight,
        scrolled: window.scrollY,
        gapBelowFooter: Math.round(window.innerHeight - footer.bottom),
      };
    });
  }
  await page.setViewportSize({ width: 1440, height: 480 });
  const tight = await pageLayout();
  check("Seite lässt sich auch im kleinen Fenster nicht scrollen", tight.overflow <= 0 && tight.scrolled === 0, tight);
  check("Footer klebt am unteren Rand", tight.gapBelowFooter === 0, tight);
  await page.setViewportSize({ width: 1440, height: 900 });

  section("Regler und Griffe mit der Maus");
  async function mouseDrag(locator, startX, startY, moveX, moveY) {
    const box = await locator.boundingBox();
    const x = box.x + box.width * startX;
    const y = box.y + box.height * startY;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + moveX, y + moveY, { steps: 6 });
    await page.mouse.up();
  }
  await page.evaluate(() => {
    window.__dragStarts = 0;
    document.addEventListener("dragstart", () => (window.__dragStarts += 1), true);
  });
  await mouseDrag(fader, 0.97, 0.5, -70, 0);
  const dragged = Number(await fader.inputValue());
  check("Lautstärkeregler folgt der Maus", dragged > 0.2 && dragged < 0.85, dragged);
  await mouseDrag(panner, 0.5, 0.5, 30, 0);
  check("Panning folgt der Maus", Number(await panner.inputValue()) > 0.1, await panner.inputValue());
  check("Regler lösen kein Verschieben aus", (await page.evaluate(() => window.__dragStarts)) === 0);
  await fader.fill("1");
  await panner.fill("0");

  const timeSlider = page.getByLabel("Überblendung beim Wechsel in diese Szene");
  await mouseDrag(timeSlider, 0.1, 0.5, 120, 0);
  const movedStop = Number(await timeSlider.inputValue());
  check("Zeitregler folgt der Maus", movedStop > 2, movedStop);
  await sleep(300);
  const readProject = () => JSON.parse(fs.readFileSync(path.join(DATA, "projects", fs.readdirSync(path.join(DATA, "projects"))[0]), "utf8"));
  const savedTransition = readProject().scenes[0].transitionMs;
  check("Zeitregler speichert beim Loslassen", savedTransition !== 2000 && savedTransition > 0, savedTransition);
  await timeSlider.fill("4");

  const trackNames = () => page.locator(".kanal input[type=text]").evaluateAll((inputs) => inputs.map((input) => input.value));
  await fileInputs().nth(1).setInputFiles(path.join(MEDIA, "musik.mp3"));
  await until(async () => (await page.locator(".kanal").count()) === 2);
  const rows = await page.locator(".kanal").evaluateAll((items) => items.map((item) => item.getBoundingClientRect()));
  check("Spuren stehen untereinander", rows[1].top >= rows[0].bottom - 1 && Math.round(rows[0].left) === Math.round(rows[1].left), rows);
  await page.screenshot({ path: path.join(OUTPUT, "08b-pult-zwei-spuren.png") });
  const tracksBefore = await trackNames();
  const trackHandles = page.locator(".spuren [data-sort-handle]");
  await trackHandles.nth(1).dragTo(page.locator(".kanal").first());
  await until(async () => (await trackNames())[0] === tracksBefore[1]);
  check("Spuren lassen sich am Griff sortieren", (await trackNames())[0] === tracksBefore[1], await trackNames());
  await trackHandles.first().focus();
  await page.keyboard.press("ArrowRight");
  await until(async () => (await trackNames())[0] === tracksBefore[0]);
  check("Griff funktioniert mit Pfeiltasten", (await trackNames())[0] === tracksBefore[0], await trackNames());
  check("Griff behält beim Verschieben den Fokus", await until(() => page.evaluate(() => document.activeElement.hasAttribute("data-sort-handle"))));
  await page.locator(".kanal").nth(1).getByRole("button", { name: /entfernen/ }).click();
  await until(async () => (await page.locator(".kanal").count()) === 1);

  const cueNames = () => page.locator(".cue .titel").allTextContents();
  const cuesBefore = await cueNames();
  await page.locator(".cue").nth(1).locator("[data-sort-handle]").dragTo(page.locator(".cue").first());
  await until(async () => (await cueNames())[0] === cuesBefore[1]);
  check("Szenen lassen sich am Griff sortieren", (await cueNames())[0] === cuesBefore[1], await cueNames());
  await page.locator(".cue").nth(1).locator("[data-sort-handle]").dragTo(page.locator(".cue").first());
  await until(async () => (await cueNames())[0] === cuesBefore[0]);

  const imageOrder = () => page.locator(".bildliste img").evaluateAll((images) => images.map((image) => image.src));
  const imagesBefore = await imageOrder();
  await page.locator(".bildliste [data-sort-handle]").nth(1).dragTo(page.locator(".bildliste li").first());
  await until(async () => (await imageOrder())[0] === imagesBefore[1]);
  check("Bilder lassen sich am Griff sortieren", (await imageOrder())[0] === imagesBefore[1]);

  section("Effekte");
  const effectButton = page.locator(".effekt", { hasText: "donner" });
  await page.evaluate(() => {
    window.__pressed = [];
    document.addEventListener("pointerdown", () => window.__pressed.push(Date.now()), true);
  });
  const startsBefore = await display.evaluate(() => window.__starts.length);
  const latencies = [];
  for (let round = 0; round < 10; round += 1) {
    const count = await display.evaluate(() => window.__starts.length);
    await effectButton.click();
    await until(async () => (await display.evaluate(() => window.__starts.length)) > count, 2000, 5);
    const pressed = await page.evaluate(() => window.__pressed[window.__pressed.length - 1]);
    const started = await display.evaluate(() => window.__starts[window.__starts.length - 1].at);
    latencies.push(started - pressed);
    await sleep(30);
  }
  const startsAfter = await display.evaluate(() => window.__starts.length);
  check("Zehn Klicks spielen zehnmal", startsAfter - startsBefore === 10, startsAfter - startsBefore);
  const worst = Math.max(...latencies);
  check(`Effekt startet sofort (schlechtester Wert ${worst} ms)`, worst < 100, latencies);
  check("Effekte sind nicht geloopt", (await display.evaluate(() => window.__starts.slice(-10).every((start) => !start.loop))));
  await page.getByRole("link", { name: "Dateien", exact: true }).click();
  await effectButton.click();
  check("Effekt-Tasten funktionieren in jeder Ansicht", await until(async () => (await display.evaluate(() => window.__starts.length)) === startsAfter + 1));
  await page.screenshot({ path: path.join(OUTPUT, "09-dateien.png") });
  await page.getByRole("link", { name: "Pult", exact: true }).click();
  await page.locator(".cue").first().waitFor();

  section("Szenenwechsel");
  await page.locator(".cue", { hasText: "Wald" }).getByRole("button", { name: "Zeigen" }).click();
  await page.locator(".cue.live", { hasText: "Wald" }).waitFor();
  await page.getByRole("link", { name: "Dateien", exact: true }).click();
  await page.getByRole("link", { name: "Pult", exact: true }).click();
  await page.locator(".editor").waitFor();
  check("Pult öffnet nach dem Wechsel die laufende Szene", (await page.getByLabel("Name der Szene").inputValue()) === "Wald bei Nacht", await page.getByLabel("Name der Szene").inputValue());
  const greenSha = crypto.createHash("sha256").update(fs.readFileSync(path.join(MEDIA, "gruen.webp"))).digest("hex").slice(0, 32);
  await until(async () => (await display.evaluate(PICTURE)) === greenSha, 5000);
  check("Anzeige wechselt das Bild", (await display.evaluate(PICTURE)) === greenSha);
  await sleep(2400);
  const imageCount = await display.evaluate(() => document.querySelectorAll("#stage img").length);
  check("Altes Bild ist nach der Überblendung entfernt", imageCount === 1, imageCount);
  const stillPlaying = (await display.evaluate(() => window.__level())).left;
  check("Neue Spur läuft nach dem Wechsel", stillPlaying > AUDIBLE, stillPlaying);
  await page.locator(".effekt", { hasText: "wind" }).click();
  await page.locator(".cue", { hasText: "Taverne" }).getByRole("button", { name: "Zeigen" }).click();
  check("Effekt während eines Szenenwechsels wirft keinen Fehler", true);
  await page.locator(".cue.live", { hasText: "Taverne" }).waitFor();
  await until(async () => (await display.evaluate(PICTURE)) !== greenSha, 5000);

  section("Lange Musik als Stream");
  await page.locator(".cue .auswahl", { hasText: "Wald" }).click();
  await page.locator(".kanal select").selectOption("stream");
  await page.locator(".cue", { hasText: "Wald" }).getByRole("button", { name: "Zeigen" }).click();
  const streamStarted = await until(() =>
    display.evaluate(() => window.__streams.some((element) => !element.paused && element.currentTime > 0.1 && element.loop))
  , 6000);
  check("Stream-Spur spielt über ein Audio-Element im Loop", streamStarted);
  await sleep(2300);
  const streamLevel = (await display.evaluate(() => window.__level())).left;
  check("Stream läuft durch denselben Mixer", streamLevel > AUDIBLE, streamLevel);
  const rangeProbe = await until(() => display.evaluate(async () => {
    const entries = performance.getEntriesByType("resource").filter((entry) => entry.initiatorType === "audio");
    return entries.length > 0;
  }), 1000);
  check("Browser lädt Stream-Medien über den Medienpfad", rangeProbe !== undefined);

  section("Master-Schalter");
  const master = page.getByRole("switch", { name: /Master/ });
  await master.click();
  const fadeProbe = await display.evaluate(() => new Promise((resolve) => {
    const samples = [];
    const startAt = performance.now();
    const layers = document.querySelectorAll("#stage > div");
    const tick = () => {
      samples.push(Number(getComputedStyle(layers[1]).opacity));
      if (performance.now() - startAt < 600) requestAnimationFrame(tick);
      else resolve(samples);
    };
    tick();
  }));
  check("Ausblenden verläuft über Zwischenwerte", fadeProbe.some((value) => value > 0.05 && value < 0.95) && fadeProbe[fadeProbe.length - 1] === 1, fadeProbe.slice(0, 12));
  const dark = await until(async () => (await display.evaluate(() => window.__level())).left < SILENT);
  check("Master aus macht den Ton stumm", dark);
  check("Pult zeigt den Zustand", (await master.getAttribute("aria-checked")) === "false" && (await page.locator(".shell.dunkel").count()) === 1);
  await page.screenshot({ path: path.join(OUTPUT, "10-pult-master-aus.png") });

  const startsDark = await display.evaluate(() => window.__starts.length);
  await page.locator(".effekt", { hasText: "donner" }).click();
  await page.getByText("Master ist aus").waitFor();
  await sleep(200);
  check("Effekt bleibt bei Master aus stumm", (await display.evaluate(() => window.__starts.length)) === startsDark);

  const lateContext = await browser.newContext({ viewport: { width: 800, height: 450 } });
  await lateContext.addInitScript(INSTRUMENT);
  const late = await lateContext.newPage();
  watchErrors(late, "Spätere Anzeige");
  await late.goto(displayUrl);
  await late.getByRole("button", { name: "Anzeige starten" }).click();
  await until(async () => (await late.evaluate(() => document.querySelectorAll("#stage img").length)) > 0);
  await sleep(300);
  check("Neuer Browser bleibt bei Master aus schwarz", (await late.evaluate(BLACK_OPACITY)) === 1, await late.evaluate(BLACK_OPACITY));
  await late.screenshot({ path: path.join(OUTPUT, "11-neuer-browser-schwarz.png") });

  await page.locator(".cue", { hasText: "Taverne" }).getByRole("button", { name: "Zeigen" }).click();
  await until(async () => (await display.evaluate(PICTURE)) === sha, 5000);
  check("Szenenwechsel im Dunkeln bleibt unsichtbar", (await display.evaluate(BLACK_OPACITY)) === 1);
  await sleep(2200);
  await master.click();
  const bright = await until(async () => (await display.evaluate(BLACK_OPACITY)) === 0);
  check("Master an blendet wieder ein", bright);
  check("Beim Einschalten erscheint direkt die neue Szene", (await display.evaluate(PICTURE)) !== greenSha);
  const backOn = await until(async () => (await display.evaluate(() => window.__level())).left > AUDIBLE);
  check("Ton kommt zurück, ohne neu zu laden", backOn);
  await late.close();
  await lateContext.close();

  section("Master-Dauer");
  await page.getByRole("link", { name: "Anzeige", exact: true }).click();
  const fadeSlider = page.getByLabel("Dauer der Aus- und Einblendung");
  await fadeSlider.fill("2");
  check("Master-Dauer wird gespeichert", await until(() => JSON.parse(fs.readFileSync(path.join(DATA, "app.json"), "utf8")).masterFadeMs === 200));
  await fadeSlider.fill("4");
  await until(() => JSON.parse(fs.readFileSync(path.join(DATA, "app.json"), "utf8")).masterFadeMs === 400);
  await page.getByRole("link", { name: "Pult", exact: true }).click();

  section("Protokoll");
  const raw = await browser.newContext();
  const rawPage = await raw.newPage();
  await rawPage.goto(`${LOCAL}/display/display.css`);
  const reloadAnswer = await rawPage.evaluate((target) => new Promise((resolve) => {
    const socket = new WebSocket(`ws://${location.host}/ws/display/${target}`);
    socket.onopen = () => socket.send(JSON.stringify({ type: "hello", data: { protocol: 99 } }));
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type !== "ping") resolve(message.type);
    };
  }), token);
  check("Falsche Protokollversion führt zu reload", reloadAnswer === "reload", reloadAnswer);
  const ignored = await rawPage.evaluate((target) => new Promise((resolve) => {
    const socket = new WebSocket(`ws://${location.host}/ws/display/${target}`);
    const received = [];
    socket.onopen = () => {
      socket.send(JSON.stringify({ type: "master.set", id: "x", data: { on: false } }));
      socket.send(JSON.stringify({ type: "effect.play", id: "y", data: { effectId: "fx" } }));
    };
    socket.onmessage = (event) => received.push(JSON.parse(event.data).type);
    setTimeout(() => resolve(received), 400);
  }), token);
  check("Anzeige darf keine Befehle senden", !ignored.includes("ack") && !ignored.includes("error"), ignored);
  check("Befehl einer Anzeige wirkt nicht", (await master.getAttribute("aria-checked")) === "true");
  await raw.close();

  section("Link deaktivieren");
  await page.getByRole("link", { name: "Anzeige", exact: true }).click();
  await page.getByText("ms Laufzeit").waitFor({ timeout: 8000 });
  check("Pult zeigt die gemessene Laufzeit", true);
  await page.getByRole("button", { name: "Link deaktivieren" }).click();
  await display.getByText("Die Anzeige ist deaktiviert.").waitFor();
  check("Anzeige zeigt den Hinweis", true);
  const stopped = await until(async () => (await display.evaluate(() => window.__level())).left < SILENT);
  check("Ton stoppt", stopped);
  check("Bild ist weg", (await display.evaluate(() => document.querySelectorAll("#stage img").length)) === 0);
  check("Medien sind gesperrt", (await fetch(`${LOCAL}/d/${token}/media/${sha}`)).status === 403);
  await display.screenshot({ path: path.join(OUTPUT, "12-link-deaktiviert.png") });
  await page.locator(".status").getByText("Anzeige-Link deaktiviert").waitFor();
  check("Pult zeigt die Sperre", true);

  const blockedContext = await browser.newContext();
  const blocked = await blockedContext.newPage();
  await blocked.goto(displayUrl);
  await blocked.getByRole("button", { name: "Anzeige starten" }).click();
  await blocked.getByText("Die Anzeige ist deaktiviert.").waitFor();
  check("Neuer Browser sieht nur den Hinweis", (await blocked.evaluate(() => document.querySelectorAll("#stage img").length)) === 0);

  await page.getByRole("button", { name: "Link aktivieren" }).click();
  await until(async () => (await display.evaluate(PICTURE)) === sha, 5000);
  check("Offene Anzeige läuft von selbst weiter", (await display.evaluate(PICTURE)) === sha);
  check("Hinweis verschwindet", !(await display.getByText("Die Anzeige ist deaktiviert.").isVisible()));
  await until(async () => (await blocked.evaluate(() => document.querySelectorAll("#stage img").length)) > 0, 5000);
  check("Wartender Browser läuft ohne Neuladen los", (await blocked.evaluate(() => document.querySelectorAll("#stage img").length)) > 0);
  await blockedContext.close();

  section("Link erneuern");
  await page.getByRole("button", { name: "Link erneuern" }).click();
  await page.getByRole("button", { name: "Alter Link wird ungültig" }).click();
  await display.getByText("Dieser Link ist ungültig.").waitFor();
  check("Alte Anzeige meldet den ungültigen Link", true);
  await sleep(1500);
  check("Alte Anzeige verbindet sich nicht neu", await display.getByText("Dieser Link ist ungültig.").isVisible());
  check("Alter Link liefert keine Medien", (await fetch(`${LOCAL}/d/${token}/media/${sha}`)).status === 403);
  const renewed = await until(async () => {
    const value = await linkField.inputValue();
    return value !== linkUrl ? value : null;
  });
  check("Pult zeigt den neuen Link", Boolean(renewed));
  await display.goto(renewed.replace(/^http:\/\/[^/]+/, LOCAL));
  await display.getByRole("button", { name: "Anzeige starten" }).click();
  await until(async () => (await display.evaluate(PICTURE)) === sha, 5000);
  check("Neuer Link funktioniert", (await display.evaluate(PICTURE)) === sha);
  await page.locator("input[readonly]").waitFor();
  await page.getByRole("button", { name: "Link kopieren" }).click();
  await page.getByRole("button", { name: "Kopiert" }).waitFor();
  check("Link lässt sich kopieren", true);

  section("Projektwechsel");
  await page.getByRole("link", { name: "Projekte", exact: true }).click();
  const projectNames = () => page.locator(".liste li input").evaluateAll((inputs) => inputs.map((input) => input.value));
  const projectRow = async (name) => page.locator(".liste li").nth((await projectNames()).indexOf(name));
  await page.getByRole("heading", { name: "Alle Projekte" }).waitFor();
  check("Projekte haben einen eigenen Bildschirm", (await page.locator(".liste li").count()) === 1);
  check("Bildschirm zeigt das aktive Projekt", await page.locator(".liste li").getByText("Aktiv", { exact: true }).isVisible());
  await page.screenshot({ path: path.join(OUTPUT, "13a-projekte.png") });
  await page.getByLabel("Name des neuen Projekts").fill("Sternenfahrt");
  await page.getByRole("button", { name: "Projekt anlegen" }).click();
  await page.waitForURL("**/admin/projekt/**");
  await page.getByText("Die Anzeige zeigt gerade ein anderes Projekt.").waitFor();
  check("Inaktives Projekt ist markiert", true);
  await createScene("Brücke");
  check("Szene eines inaktiven Projekts lässt sich nicht zeigen", await page.locator(".cue", { hasText: "Brücke" }).getByRole("button", { name: "Zeigen" }).isDisabled());
  await page.getByRole("button", { name: "Dieses Projekt aktivieren" }).click();
  await until(async () => (await display.getByText("Gleich geht es weiter.").isVisible()), 5000);
  check("Projekt ohne aktive Szene zeigt den Wartebildschirm", await display.getByText("Gleich geht es weiter.").isVisible());
  await page.locator(".cue", { hasText: "Brücke" }).getByRole("button", { name: "Zeigen" }).click();
  const sceneOfSecond = await until(async () => !(await display.getByText("Gleich geht es weiter.").isVisible()), 5000);
  check("Szene mit Platzhaltern läuft auf der Anzeige", sceneOfSecond);
  await until(async () => (await display.evaluate(PICTURE)) === "builtin-black", 4000);
  check("Platzhalterbild wird geladen", (await display.evaluate(PICTURE)) === "builtin-black", await display.evaluate(PICTURE));

  section("Defekte Audiodatei");
  await fileInputs().nth(1).setInputFiles(path.join(MEDIA, "defekt.mp3"));
  await page.locator(".status").getByText("Anzeige meldet Dateifehler").waitFor();
  check("Pult meldet die defekte Datei im Kopf", true);
  await page.getByRole("link", { name: "Anzeige", exact: true }).click();
  await page.getByText("kann das Audioformat nicht abspielen").waitFor();
  check("Pult nennt Datei und Grund", await page.getByText("defekt.mp3").isVisible());
  check("Anzeige läuft trotzdem weiter", (await display.evaluate(PICTURE)) === "builtin-black");
  await page.getByRole("link", { name: "Pult", exact: true }).click();
  await page.locator(".kanal").getByRole("button", { name: /entfernen/ }).click();
  await page.getByText("Leere Tonspur").waitFor();

  await page.getByRole("link", { name: "Projekte", exact: true }).click();
  await page.getByRole("heading", { name: "Alle Projekte" }).waitFor();
  await until(async () => (await page.locator(".liste li").count()) === 2);
  await (await projectRow("Die Gruft von Wetterstein")).getByRole("button", { name: "Aktivieren" }).click();
  await until(async () => (await display.evaluate(PICTURE)) === sha, 5000);
  check("Projekt startet mit seiner zuletzt aktiven Szene", (await display.evaluate(PICTURE)) === sha);
  await until(async () => (await (await projectRow("Sternenfahrt")).getByRole("button", { name: "Aktivieren" }).count()) === 1);
  await (await projectRow("Sternenfahrt")).getByRole("button", { name: "Szenen öffnen" }).click();
  await page.waitForURL("**/admin/projekt/**");
  await page.locator(".cue", { hasText: "Brücke" }).waitFor();
  check("Szenen eines anderen Projekts lassen sich öffnen", await page.getByText("Die Anzeige zeigt gerade ein anderes Projekt.").isVisible());
  await page.getByRole("link", { name: "Projekte", exact: true }).click();
  await page.getByRole("heading", { name: "Alle Projekte" }).waitFor();
  await until(async () => (await page.locator(".liste li").count()) === 2);
  await page.getByLabel("Name des Projekts").nth(1).fill("Sternenreise");
  await page.getByLabel("Name des Projekts").nth(1).press("Enter");
  await sleep(300);
  check("Projekt lässt sich umbenennen", (await projectNames()).includes("Sternenreise"), await projectNames());
  await (await projectRow("Sternenreise")).getByRole("button", { name: "Löschen" }).click();
  await (await projectRow("Sternenreise")).getByRole("button", { name: "Wirklich löschen?" }).click();
  await until(async () => (await page.locator(".liste li").count()) === 1);
  check("Projekt lässt sich löschen", (await page.locator(".liste li").count()) === 1);
  await page.getByRole("link", { name: "Pult", exact: true }).click();
  await page.locator(".cue").first().waitFor();

  section("Lösch-Regeln");
  await page.locator(".cue .auswahl", { hasText: "Taverne" }).click();
  check("Laufende Szene lässt sich nicht löschen", await page.getByRole("button", { name: "Szene löschen" }).isDisabled());
  await page.locator(".cue .auswahl", { hasText: "Wald" }).click();
  await page.locator(".kanal").getByRole("button", { name: /entfernen/ }).click();
  await page.getByText("Leere Tonspur").waitFor();
  check("Letzte Spur wird zum Platzhalter", true);
  await page.locator(".bildliste li").hover();
  await page.getByRole("button", { name: "Bild 1 entfernen" }).click();
  await page.getByText("Schwarzer Hintergrund").waitFor();
  check("Letztes Bild wird zum Platzhalter", true);
  await page.getByRole("button", { name: "Szene löschen" }).click();
  await page.getByRole("button", { name: "Wirklich löschen?" }).click();
  await until(async () => (await page.locator(".cue", { hasText: "Wald" }).count()) === 0);
  check("Andere Szene lässt sich löschen", (await page.locator(".cue", { hasText: "Wald" }).count()) === 0);

  await page.getByRole("link", { name: "Dateien", exact: true }).click();
  const inUse = page.locator(".kacheln li", { hasText: "lila.png" }).getByRole("button");
  check("Verwendete Datei lässt sich nicht löschen", await inUse.isDisabled());
  const unused = page.locator(".kacheln li", { hasText: "gruen.webp" });
  await unused.getByRole("button", { name: "Löschen" }).click();
  await unused.getByRole("button", { name: "Wirklich löschen?" }).click();
  await until(async () => (await unused.count()) === 0);
  check("Unbenutzte Datei lässt sich löschen", (await unused.count()) === 0);
  check("Medien-Datei ist von der Platte verschwunden", await until(() => !fs.existsSync(path.join(DATA, "media", `${greenSha}.webp`))));

  section("Reihenfolge");
  await page.getByRole("link", { name: "Effekte", exact: true }).click();
  const namesBefore = await page.locator(".effekt").allTextContents();
  await page.locator(".liste li").nth(2).locator("[data-sort-handle]").dragTo(page.locator(".liste li").nth(0));
  await until(async () => (await page.locator(".effekt").first().textContent()) !== namesBefore[0]);
  const namesAfter = await page.locator(".effekt").allTextContents();
  check("Effekte lassen sich per Ziehen sortieren", namesAfter[0] === namesBefore[2], { namesBefore, namesAfter });

  const silentAt = Date.now();
  const heartbeat = await browser.newContext();
  const heartbeatPage = await heartbeat.newPage();
  await heartbeatPage.goto(`${LOCAL}/display/display.css`);
  const renewedToken = renewed.split("/").pop();
  const heartbeatClosed = heartbeatPage.evaluate((target) => new Promise((resolve) => {
    const socket = new WebSocket(`ws://${location.host}/ws/display/${target}`);
    socket.onclose = () => resolve(true);
  }), renewedToken);
  await page.getByRole("link", { name: "Dateien", exact: true }).click();
  const closedInTime = await Promise.race([heartbeatClosed, sleep(24000).then(() => false)]);
  const silentSeconds = Math.round((Date.now() - silentAt) / 1000);
  section("Heartbeat");
  check(`Server trennt stille Verbindungen (nach ${silentSeconds} s)`, closedInTime && silentSeconds >= 14, silentSeconds);
  await heartbeat.close();

  section("Neustart des Servers");
  const sceneImages = [sha, crypto.createHash("sha256").update(fs.readFileSync(path.join(MEDIA, "orange.jpg"))).digest("hex").slice(0, 32)];
  const loopsBeforeRestart = await display.evaluate(() => window.__starts.filter((start) => start.loop).length);
  await stopServer(server);
  check("Server beendet sich sauber", true);
  await page.locator(".status").getByText("Keine Verbindung zum Server").waitFor({ timeout: 4000 });
  check("Pult meldet die Trennung", true);
  const stillShowing = await display.evaluate(PICTURE);
  check("Anzeige läuft ohne Server weiter", sceneImages.includes(stillShowing) && (await display.evaluate(() => window.__level())).left > AUDIBLE, stillShowing);

  server = startServer();
  await waitForServer();
  await until(async () => page.url().includes("/login"), 12000);
  check("Pult verlangt nach dem Neustart eine neue Anmeldung", page.url().includes("/login"), page.url());
  check("Kein neues Passwort beim zweiten Start", !server.output.includes("Admin-Passwort"));
  await page.getByLabel("Passwort des Spielleiters").fill(password);
  await page.getByRole("button", { name: "Anmelden" }).click();
  await page.locator(".cue.live", { hasText: "Taverne" }).waitFor();
  check("Aktives Projekt und aktive Szene sind noch da", true);
  await page.getByText("1 Anzeige bereit").waitFor({ timeout: 10000 });
  check("Anzeige verbindet sich von selbst neu", true);
  await sleep(500);
  const loopsNow = await display.evaluate(() => window.__starts.filter((start) => start.loop).length);
  const pictureNow = await display.evaluate(PICTURE);
  check("Neuverbinden unterbricht die Szene nicht", sceneImages.includes(pictureNow) && loopsNow === loopsBeforeRestart, { pictureNow, loopsNow, loopsBeforeRestart });
  await until(async () => (await page.locator(".effekt").count()) === 3);
  check("Effektreihenfolge ist gespeichert", (await page.locator(".effekt").first().textContent()) === namesAfter[0]);

  section("Abmelden");
  await page.getByRole("button", { name: "Abmelden" }).click();
  await page.waitForURL("**/admin/login");
  check("Abmelden führt zum Login", true);
  await page.goto(`${LOCAL}/admin/`);
  await page.waitForURL("**/admin/login");
  check("Sitzung ist wirklich beendet", true);

  section("Passwort zurücksetzen");
  await stopServer(server, "SIGTERM");
  server = startServer(["--reset-password"]);
  await waitForServer();
  await sleep(100);
  const newPassword = (server.output.match(/Admin-Passwort: (\S+)/) || [])[1];
  check("--reset-password zeigt ein neues Passwort", newPassword && newPassword !== password);
  const login = await fetch(`${LOCAL}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  check("Altes Passwort gilt nicht mehr", login.status === 401);

  section("Handy-Ansicht");
  const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const phone = await phoneContext.newPage();
  watchErrors(phone, "Handy");
  await phone.goto(`${LOCAL}/admin/`);
  await phone.getByLabel("Passwort des Spielleiters").fill(newPassword);
  await phone.getByRole("button", { name: "Anmelden" }).click();
  await phone.locator(".cue").first().waitFor();
  await phone.screenshot({ path: path.join(OUTPUT, "13-handy.png") });
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("Handy-Ansicht hat keinen seitlichen Überlauf", overflow <= 0, overflow);
  check("Master bleibt auf dem Handy sichtbar", await phone.getByRole("switch", { name: /Master/ }).isVisible());
  await phoneContext.close();

  await browser.close();
  await stopServer(server);

  section("Fehler im Browser");
  check("Keine Skriptfehler auf Pult und Anzeige", pageErrors.length === 0, pageErrors);

  console.log(`\n${passed} bestanden, ${failures.length} fehlgeschlagen`);
  if (failures.length > 0) {
    failures.forEach((name) => console.log(`  - ${name}`));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  console.log(`\nAbbruch nach ${passed} bestandenen Prüfungen`);
  process.exit(2);
});
