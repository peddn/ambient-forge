import { defineStore } from "pinia";
import { computed, ref } from "vue";

import { ApiError, api, errorMessage, setUnauthorizedHandler, uploadFile } from "../api.js";
import { createSocket } from "../socket.js";

const SLIDER_INTERVAL_MS = 33;
const LARGE_AUDIO_BYTES = 20 * 1024 * 1024;
const NOTICE_MS = 6000;

export const BUILTIN_BLACK = "builtin-black";
export const BUILTIN_SILENCE = "builtin-silence";

const withoutExtension = (name) => name.replace(/\.[^.]+$/, "") || name;

const emptyLive = () => ({
  activeProjectId: null,
  activeSceneId: null,
  masterOn: true,
  masterFadeMs: 400,
  link: { url: "", enabled: true, host: null, hosts: [] },
  displays: [],
});

export const usePult = defineStore("pult", () => {
  const signedIn = ref(false);
  const online = ref(false);
  const projects = ref([]);
  const effects = ref([]);
  const assets = ref([]);
  const live = ref(emptyLive());
  const notice = ref(null);
  const lastEffect = ref(null);

  let lastRev = 0;
  let socket = null;
  let signedOutHandler = () => {};
  let noticeTimer = null;
  let reloadQueued = false;
  const sliderPatches = new Map();
  let sliderTimer = null;

  const activeProject = computed(() =>
    projects.value.find((project) => project.id === live.value.activeProjectId)
  );

  const readyDisplays = computed(() =>
    live.value.displays.filter((display) => display.audio === "running")
  );

  const displaySummary = computed(() => {
    const total = live.value.displays.length;
    const ready = readyDisplays.value.length;
    if (!live.value.link.enabled) return { tone: "warn", text: "Anzeige-Link deaktiviert" };
    if (total === 0) return { tone: "warn", text: "Keine Anzeige verbunden" };
    if (ready === 0) {
      return { tone: "warn", text: total === 1 ? "Anzeige wartet auf Start" : `${total} Anzeigen warten auf Start` };
    }
    const failed = live.value.displays.some((display) => display.errors.length > 0);
    if (failed) return { tone: "warn", text: "Anzeige meldet Dateifehler" };
    const label = ready === 1 ? "1 Anzeige bereit" : `${ready} Anzeigen bereit`;
    return { tone: "ok", text: ready < total ? `${label}, ${total - ready} wartet` : label };
  });

  // Warum ein Effekt gerade nicht zu hören wäre.
  const silentReason = computed(() => {
    if (!online.value) return "Keine Verbindung zum Server";
    if (!live.value.masterOn) return "Master ist aus, Effekte bleiben stumm";
    if (!live.value.link.enabled) return "Anzeige-Link ist deaktiviert";
    if (live.value.displays.length === 0) return "Keine Anzeige verbunden";
    if (readyDisplays.value.length === 0) return "Auf der Anzeige wurde noch nicht gestartet";
    return null;
  });

  function showNotice(text) {
    clearTimeout(noticeTimer);
    notice.value = text;
    noticeTimer = setTimeout(() => {
      notice.value = null;
    }, NOTICE_MS);
  }

  function clearNotice() {
    clearTimeout(noticeTimer);
    notice.value = null;
  }

  function showError(error) {
    showNotice(errorMessage(error));
  }

  function acceptRev(rev) {
    if (typeof rev !== "number") return true;
    if (rev < lastRev) return false;
    lastRev = rev;
    return true;
  }

  async function loadData() {
    const data = await api("GET", "/data");
    projects.value = data.projects;
    effects.value = data.effects;
    assets.value = data.assets;
  }

  function queueReload() {
    if (reloadQueued) return;
    reloadQueued = true;
    queueMicrotask(() => {
      reloadQueued = false;
      loadData().catch(showError);
    });
  }

  function findTrack(sceneId, trackId) {
    for (const project of projects.value) {
      const scene = project.scenes.find((entry) => entry.id === sceneId);
      if (scene) return scene.tracks.find((track) => track.id === trackId);
    }
    return undefined;
  }

  function applyTrackFields(track, fields) {
    if (!track) return;
    ["volume", "pan", "muted"].forEach((key) => {
      if (key in fields) track[key] = fields[key];
    });
  }

  function onMessage(message) {
    const data = message.data || {};
    if (!acceptRev(data.rev)) return;
    if (message.type === "state") {
      live.value = data;
    } else if (message.type === "displays") {
      live.value = { ...live.value, displays: data };
    } else if (message.type === "track.updated") {
      applyTrackFields(findTrack(data.sceneId, data.trackId), data);
    } else if (message.type === "data.changed") {
      queueReload();
    }
  }

  function expire() {
    stop();
    signedOutHandler();
  }

  function stop() {
    if (socket) socket.stop();
    socket = null;
    signedIn.value = false;
    online.value = false;
  }

  function connect() {
    socket = createSocket({
      onMessage,
      onOpen() {
        lastRev = 0;
        online.value = true;
        queueReload();
      },
      onClose() {
        online.value = false;
      },
      onExpired: expire,
    });
    socket.start();
  }

  async function start() {
    setUnauthorizedHandler(() => {
      if (signedIn.value) expire();
    });
    try {
      await loadData();
    } catch (error) {
      if (error instanceof ApiError && error.code === "unauthorized") return false;
      throw error;
    }
    signedIn.value = true;
    connect();
    return true;
  }

  async function login(password) {
    await api("POST", "/login", { password });
    return start();
  }

  async function logout() {
    await api("POST", "/logout").catch(() => {});
    stop();
    signedOutHandler();
  }

  function onSignedOut(handler) {
    signedOutHandler = handler;
  }

  // Führt eine Änderung aus und meldet Fehler in der Oberfläche.
  async function run(action) {
    try {
      const result = await action();
      return result === undefined ? true : result;
    } catch (error) {
      showError(error);
      return false;
    }
  }

  function liveRequest(type, data) {
    return run(() => {
      if (!socket) throw new ApiError("offline");
      return socket.request(type, data);
    });
  }

  // Projekte und Szenen

  const createProject = (name) => run(() => api("POST", "/projects", { name }));
  const renameProject = (id, name) => run(() => api("PATCH", `/projects/${id}`, { name }));
  const deleteProject = (id) => run(() => api("DELETE", `/projects/${id}`));
  const activateProject = (projectId) => liveRequest("project.activate", { projectId });

  const createScene = (projectId, name) =>
    run(() => api("POST", `/projects/${projectId}/scenes`, { name }));
  const updateScene = (id, patch) => run(() => api("PATCH", `/scenes/${id}`, patch));
  const deleteScene = (id) => run(() => api("DELETE", `/scenes/${id}`));
  const activateScene = (sceneId) => liveRequest("scene.activate", { sceneId });

  const reorder = (scope, parentId, ids) =>
    run(() => api("PUT", "/order", { scope, parentId, ids }));

  // Bilder, Spuren, Effekte

  const addImage = (sceneId, assetId) =>
    run(() => api("POST", `/scenes/${sceneId}/images`, { assetId }));
  const removeImage = (sceneId, imageId) =>
    run(() => api("DELETE", `/scenes/${sceneId}/images/${imageId}`));

  function addTrack(sceneId, asset) {
    const mode = asset.sizeBytes > LARGE_AUDIO_BYTES ? "stream" : "buffer";
    const name = withoutExtension(asset.name);
    return run(() => api("POST", `/scenes/${sceneId}/tracks`, { assetId: asset.id, name, mode }));
  }

  const updateTrack = (sceneId, trackId, patch) =>
    run(() => api("PATCH", `/scenes/${sceneId}/tracks/${trackId}`, patch));
  const removeTrack = (sceneId, trackId) =>
    run(() => api("DELETE", `/scenes/${sceneId}/tracks/${trackId}`));

  function flushSliders() {
    sliderTimer = null;
    sliderPatches.forEach((patch) => socket && socket.send("track.update", patch));
    sliderPatches.clear();
  }

  // Regler wirken sofort und senden höchstens 30-mal pro Sekunde.
  function moveTrack(sceneId, trackId, fields) {
    applyTrackFields(findTrack(sceneId, trackId), fields);
    const key = `${sceneId}/${trackId}`;
    const previous = sliderPatches.get(key) || { sceneId, trackId };
    sliderPatches.set(key, { ...previous, ...fields });
    if (sliderTimer === null) sliderTimer = setTimeout(flushSliders, SLIDER_INTERVAL_MS);
  }

  const createEffect = (asset) =>
    run(() => api("POST", "/effects", { assetId: asset.id, name: withoutExtension(asset.name) }));
  const updateEffect = (id, patch) => run(() => api("PATCH", `/effects/${id}`, patch));
  const deleteEffect = (id) => run(() => api("DELETE", `/effects/${id}`));

  async function playEffect(effectId) {
    if (!socket) return;
    const startedAt = performance.now();
    try {
      const result = await socket.request("effect.play", { effectId });
      lastEffect.value = {
        effectId,
        delivered: result.delivered,
        ms: Math.round(performance.now() - startedAt),
        at: Date.now(),
      };
    } catch (error) {
      showError(error);
    }
  }

  // Dateien

  async function upload(file, onProgress) {
    try {
      return await uploadFile(file, onProgress);
    } catch (error) {
      if (error.code === "invalid_value") {
        showNotice(`${file.name}: Erlaubt sind JPEG, PNG, WebP, WAV, MP3, OGG, Opus und FLAC.`);
      } else {
        showError(error);
      }
      return null;
    }
  }

  const deleteAsset = (id) => run(() => api("DELETE", `/assets/${id}`));

  // Anzeige

  const setMaster = (on) => liveRequest("master.set", { on });
  const updateLink = (patch) => run(() => api("PATCH", "/link", patch));
  const renewLink = () => run(() => api("POST", "/link/renew"));
  const setMasterFade = (masterFadeMs) => run(() => api("PATCH", "/settings", { masterFadeMs }));

  return {
    signedIn,
    online,
    projects,
    effects,
    assets,
    live,
    notice,
    lastEffect,
    activeProject,
    readyDisplays,
    displaySummary,
    silentReason,
    start,
    login,
    logout,
    onSignedOut,
    showNotice,
    clearNotice,
    createProject,
    renameProject,
    deleteProject,
    activateProject,
    createScene,
    updateScene,
    deleteScene,
    activateScene,
    reorder,
    addImage,
    removeImage,
    addTrack,
    updateTrack,
    removeTrack,
    moveTrack,
    createEffect,
    updateEffect,
    deleteEffect,
    playEffect,
    upload,
    deleteAsset,
    setMaster,
    updateLink,
    renewLink,
    setMasterFade,
  };
});
