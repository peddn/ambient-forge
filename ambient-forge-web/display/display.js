// Anzeigeseite: verbindet die Engine mit dem Server.
// Nur diese Datei kennt Token und WebSocket, die Engine bleibt unabhängig davon.
// Dieser Ordner läuft ohne Build: nur Syntax bis ES2019 verwenden.

import { createEngine } from "/engine/index.js";

const PROTOCOL = 1;
const RECONNECT_DELAYS_MS = [500, 1000, 2000, 5000];
const RECEIVE_TIMEOUT_MS = 12000;
const STATUS_INTERVAL_MS = 250;
const RELOAD_GUARD_MS = 10000;
const CLOSE_INVALID_TOKEN = 4001;

const token = location.pathname.split("/")[2] || "";

const elements = {
  stage: document.getElementById("stage"),
  wait: document.getElementById("wait"),
  notice: document.getElementById("notice"),
  noticeTitle: document.getElementById("notice-title"),
  noticeText: document.getElementById("notice-text"),
  start: document.getElementById("start"),
  startButton: document.getElementById("start-button"),
  progress: document.getElementById("progress"),
};

const engine = createEngine({
  container: elements.stage,
  resolveAsset: (assetId) => "/d/" + token + "/media/" + assetId,
});

const view = { started: false, sceneKnown: false, hasScene: false, masterOn: true, blocked: false };

let socket = null;
let attempts = 0;
let lastRev = 0;
let lastReceived = Date.now();
let reconnectTimer = null;
let allowReconnect = true;
let latestStatus = null;
let statusDirty = false;
let statusTimer = null;
let wakeLock = null;

function render() {
  const showWait = view.sceneKnown && !view.hasScene && view.masterOn && !view.blocked;
  elements.wait.hidden = !showWait;
  elements.start.hidden = view.started;
  document.body.classList.toggle("running", view.started);
}

function showNotice(title, text) {
  elements.noticeTitle.textContent = title;
  elements.noticeText.textContent = text;
  elements.notice.hidden = false;
  view.blocked = true;
  render();
}

function hideNotice() {
  elements.notice.hidden = true;
  view.blocked = false;
  render();
}

function send(type, data) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type, data }));
  }
}

function flushStatus() {
  statusTimer = null;
  if (!statusDirty || !latestStatus) return;
  statusDirty = false;
  send("status", latestStatus);
}

function queueStatus() {
  statusDirty = true;
  if (statusTimer === null) {
    statusTimer = setTimeout(flushStatus, STATUS_INTERVAL_MS);
  }
}

function acceptRev(rev) {
  if (typeof rev !== "number") return true;
  if (rev < lastRev) return false;
  lastRev = rev;
  return true;
}

function handleSnapshot(snapshot) {
  hideNotice();
  view.sceneKnown = true;
  view.hasScene = Boolean(snapshot.scene);
  view.masterOn = snapshot.masterOn !== false;
  render();
  engine.apply(snapshot);
}

function reloadOnce() {
  try {
    const last = Number(sessionStorage.getItem("ambient-forge-reload") || 0);
    if (Date.now() - last < RELOAD_GUARD_MS) return;
    sessionStorage.setItem("ambient-forge-reload", String(Date.now()));
  } catch (error) {
    // Ohne Speicher wird trotzdem neu geladen.
  }
  location.reload();
}

const handlers = {
  snapshot(data) {
    if (acceptRev(data.rev)) handleSnapshot(data);
  },
  "track.update"(data) {
    if (!acceptRev(data.rev)) return;
    const patch = {};
    ["volume", "pan", "muted"].forEach((key) => {
      if (key in data) patch[key] = data[key];
    });
    engine.updateTrack(data.trackId, patch);
  },
  "effect.play"(data) {
    engine.playOneShot(data.effectId);
  },
  "master.set"(data) {
    if (!acceptRev(data.rev)) return;
    view.masterOn = data.on;
    render();
    engine.setOutput(data.on, { fadeMs: data.fadeMs });
  },
  "link.disabled"() {
    view.sceneKnown = false;
    engine.stop();
    showNotice("Die Anzeige ist deaktiviert.", "Sie läuft weiter, sobald der Spielleiter sie aktiviert.");
  },
  "link.revoked"() {
    allowReconnect = false;
    engine.stop();
  },
  ping(data) {
    send("pong", { t: data.t });
  },
  reload: reloadOnce,
};

function scheduleReconnect() {
  if (!allowReconnect || reconnectTimer !== null) return;
  const delay = RECONNECT_DELAYS_MS[Math.min(attempts, RECONNECT_DELAYS_MS.length - 1)];
  attempts += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

function connect() {
  const scheme = location.protocol === "https:" ? "wss://" : "ws://";
  const current = new WebSocket(scheme + location.host + "/ws/display/" + token);
  socket = current;

  current.onopen = () => {
    lastReceived = Date.now();
    lastRev = 0;
    send("hello", { protocol: PROTOCOL });
    statusDirty = true;
    flushStatus();
  };

  current.onmessage = (event) => {
    lastReceived = Date.now();
    attempts = 0;
    const message = JSON.parse(event.data);
    const handler = handlers[message.type];
    if (handler) handler(message.data || {});
  };

  current.onclose = (event) => {
    if (socket !== current) return;
    if (event.code === CLOSE_INVALID_TOKEN) {
      allowReconnect = false;
      engine.stop();
      showNotice("Dieser Link ist ungültig.", "Frage den Spielleiter nach dem aktuellen Link.");
      return;
    }
    scheduleReconnect();
  };
}

function watchConnection() {
  const open = socket && socket.readyState === WebSocket.OPEN;
  if (open && Date.now() - lastReceived > RECEIVE_TIMEOUT_MS) {
    socket.close();
  }
}

function requestFullscreen() {
  const root = document.documentElement;
  const request = root.requestFullscreen || root.webkitRequestFullscreen;
  if (request && !document.fullscreenElement) {
    const result = request.call(root);
    if (result && result.catch) result.catch(() => {});
  }
}

function keepAwake() {
  if (!("wakeLock" in navigator) || document.visibilityState !== "visible") return;
  navigator.wakeLock
    .request("screen")
    .then((lock) => {
      wakeLock = lock;
    })
    .catch(() => {});
}

function begin() {
  view.started = true;
  render();
  engine.unlock().catch(() => {});
  requestFullscreen();
  keepAwake();
}

elements.startButton.addEventListener("click", begin);

// Ein weiterer Klick holt den Vollbildmodus zurück, wenn ihn jemand verlassen hat.
elements.stage.addEventListener("click", () => {
  if (!view.started) return;
  engine.unlock().catch(() => {});
  requestFullscreen();
});

document.addEventListener("visibilitychange", () => {
  if (view.started && !wakeLock) keepAwake();
  if (document.visibilityState === "hidden") wakeLock = null;
});

engine.on("status", (status) => {
  latestStatus = status;
  queueStatus();
  const loading = status.total > 0 && status.loaded < status.total;
  elements.progress.hidden = !loading;
  elements.progress.textContent = "Medien werden geladen: " + status.loaded + " von " + status.total;
});

setInterval(watchConnection, 1000);
render();
connect();
