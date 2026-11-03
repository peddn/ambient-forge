// Engine von Ambient Forge: rendert eine Szene aus Bildern und Soundspuren in einen Container.
//
// Die Engine kennt weder Server noch WebSocket. Sie bekommt einen Zielzustand und
// kümmert sich selbst um Laden und Überblenden, siehe docs/spezifikation.md.
//
//   const engine = createEngine({ container, resolveAsset });
//   engine.unlock();              // im Klick-Handler aufrufen
//   await engine.apply(snapshot); // Zielzustand setzen
//   engine.playOneShot(effectId);
//   engine.dispose();
//
// Dieser Ordner läuft ohne Build: nur Syntax bis ES2019 verwenden.

import { createMixer } from "./mixer.js";
import { createSlideshow } from "./slideshow.js";

const LAYER_STYLE =
  "position:absolute;top:0;left:0;width:100%;height:100%;overflow:hidden;background:#000;";
const LEAVE_FADE_MS = 1000;

function assetIdsOf(snapshot) {
  const scene = snapshot.scene;
  const sceneIds = scene
    ? scene.images.map((image) => image.assetId).concat(scene.tracks.map((track) => track.assetId))
    : [];
  const effectIds = (snapshot.effects || []).map((effect) => effect.assetId);
  return { scene: new Set(sceneIds), all: new Set(sceneIds.concat(effectIds)) };
}

export function createEngine(options) {
  const container = options.container;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const context = new AudioContextClass();

  const imageLayer = document.createElement("div");
  imageLayer.style.cssText = LAYER_STYLE;
  const blackLayer = document.createElement("div");
  blackLayer.style.cssText = LAYER_STYLE + "opacity:0;pointer-events:none;";
  container.appendChild(imageLayer);
  container.appendChild(blackLayer);

  const slideshow = createSlideshow({
    root: imageLayer,
    resolveAsset: options.resolveAsset,
    fit: options.fit,
  });
  const mixer = createMixer({ context, resolveAsset: options.resolveAsset });

  const listeners = new Set();
  const status = {
    audio: "locked",
    sceneId: null,
    sceneState: "ready",
    loaded: 0,
    total: 0,
    errors: [],
  };

  let generation = 0;
  let activeScene = null;
  let firstApply = true;
  let outputOn = true;
  let lastTransitionMs = LEAVE_FADE_MS;

  function emit() {
    const copy = Object.assign({}, status, { errors: status.errors.slice() });
    listeners.forEach((listener) => listener(copy));
  }

  function syncAudioState() {
    const next = context.state === "running" ? "running" : "locked";
    if (next !== status.audio) {
      status.audio = next;
      emit();
    }
  }
  context.onstatechange = syncAudioState;

  function createTracker(gen, sceneIds, total) {
    const failed = new Map();
    const done = new Set();
    return {
      report(assetId, error) {
        if (gen !== generation) return;
        done.add(assetId);
        if (error) {
          failed.set(assetId, (error && error.message) || String(error));
        }
        status.loaded = done.size;
        status.total = total;
        status.errors = Array.from(failed, (entry) => ({ assetId: entry[0], reason: entry[1] }));
        emit();
      },
      sceneFailed() {
        return Array.from(failed.keys()).some((assetId) => sceneIds.has(assetId));
      },
    };
  }

  function setOutput(on, settings) {
    const fadeMs = settings && settings.fadeMs ? settings.fadeMs : 0;
    if (on === outputOn && !(settings && settings.force)) return;
    outputOn = on;
    blackLayer.style.transition = "opacity " + fadeMs + "ms linear";
    blackLayer.style.opacity = on ? "0" : "1";
    mixer.setMaster(on ? 1 : 0, fadeMs);
  }

  function finish(gen, tracker, assetIds, sceneId) {
    if (gen !== generation) return;
    mixer.retain(assetIds);
    status.sceneId = sceneId;
    status.sceneState = tracker.sceneFailed() ? "error" : "ready";
    emit();
  }

  function apply(snapshot) {
    generation += 1;
    const gen = generation;
    const scene = snapshot.scene;
    const ids = assetIdsOf(snapshot);
    const tracker = createTracker(gen, ids.scene, ids.all.size);
    const report = tracker.report;

    setOutput(snapshot.masterOn !== false, {
      fadeMs: firstApply ? 0 : snapshot.masterFadeMs,
      force: firstApply,
    });
    firstApply = false;

    status.loaded = 0;
    status.total = ids.all.size;
    status.errors = [];
    status.sceneState = "loading";
    status.sceneId = scene ? scene.id : null;
    emit();

    const effectsReady = mixer.syncEffects(snapshot.effects || [], report);

    if (!scene) {
      activeScene = null;
      slideshow.clear(lastTransitionMs);
      mixer.leaveScene(lastTransitionMs);
      return effectsReady.then(() => finish(gen, tracker, ids.all, null));
    }

    lastTransitionMs = scene.transitionMs;

    if (activeScene && activeScene.id === scene.id) {
      activeScene = scene;
      return Promise.all([
        slideshow.update(scene, report),
        mixer.syncTracks(scene.tracks, report),
        effectsReady,
      ]).then(() => finish(gen, tracker, ids.all, scene.id));
    }

    return Promise.all([
      slideshow.prepare(scene.images, report),
      mixer.prepareScene(scene.tracks, report),
    ]).then((results) => {
      const slides = results[0];
      const bus = results[1];
      if (gen !== generation) {
        mixer.discardScene(bus);
        return undefined;
      }
      activeScene = scene;
      slideshow.show(slides, scene, scene.transitionMs);
      mixer.activateScene(bus, scene.transitionMs);
      return effectsReady.then(() => finish(gen, tracker, ids.all, scene.id));
    });
  }

  // Muss direkt im Klick-Handler laufen, sonst blockiert der Browser den Ton.
  function unlock() {
    const silent = context.createBufferSource();
    silent.buffer = context.createBuffer(1, 1, 22050);
    silent.connect(context.destination);
    silent.start(0);
    return context.resume().then(() => {
      syncAudioState();
      mixer.resumeStreams();
    });
  }

  function stop() {
    generation += 1;
    activeScene = null;
    firstApply = true;
    slideshow.clear(0);
    mixer.stopAll();
    status.sceneId = null;
    status.sceneState = "ready";
    status.loaded = 0;
    status.total = 0;
    status.errors = [];
    emit();
  }

  function on(event, listener) {
    if (event !== "status") throw new Error("Unbekanntes Ereignis: " + event);
    listeners.add(listener);
    listener(Object.assign({}, status, { errors: status.errors.slice() }));
    return () => listeners.delete(listener);
  }

  function dispose() {
    stop();
    listeners.clear();
    container.removeChild(imageLayer);
    container.removeChild(blackLayer);
    return context.close();
  }

  return {
    apply,
    unlock,
    updateTrack: mixer.updateTrack,
    playOneShot: mixer.playEffect,
    setOutput,
    stop,
    on,
    dispose,
  };
}
