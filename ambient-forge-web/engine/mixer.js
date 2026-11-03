// Audio-Mixer auf Basis der Web Audio API.
//
// Signalweg einer Spur: Quelle -> Lautstärke -> Mute -> Panner -> Szenen-Bus -> Master.
// Effekte laufen über einen eigenen Bus, damit sie Szenenwechsel überstehen.
// Dieser Ordner läuft ohne Build: nur Syntax bis ES2019 verwenden.

import { createRamp } from "./ramp.js";

const CONTROL_RAMP_MS = 50;
const REMOVE_FADE_MS = 200;
const STREAM_TIMEOUT_MS = 20000;

// Ein Fader klingt gleichmäßiger, wenn die Verstärkung quadratisch steigt.
function faderToGain(volume) {
  return volume * volume;
}

export function createMixer(options) {
  const context = options.context;
  const resolveAsset = options.resolveAsset;

  const masterNode = context.createGain();
  masterNode.connect(context.destination);
  const master = createRamp(context, masterNode.gain, 1);

  const effectBus = context.createGain();
  effectBus.connect(masterNode);

  const buffers = new Map();
  const retiring = new Set();
  let effects = new Map();
  let bus = null;

  function decode(data) {
    return new Promise((resolve, reject) => {
      const failed = () =>
        reject(new Error("Dieser Browser kann das Audioformat nicht abspielen"));
      // Neuere Browser liefern zusätzlich ein Promise, das ebenfalls abgelehnt wird.
      const pending = context.decodeAudioData(data, resolve, failed);
      if (pending) pending.catch(failed);
    });
  }

  function loadBuffer(assetId) {
    const known = buffers.get(assetId);
    if (known) return known.promise;

    const entry = { buffer: null, promise: null };
    entry.promise = fetch(resolveAsset(assetId))
      .then((response) => {
        if (!response.ok) throw new Error("HTTP " + response.status);
        return response.arrayBuffer();
      })
      .then(decode)
      .then((buffer) => {
        entry.buffer = buffer;
        return buffer;
      })
      .catch((error) => {
        buffers.delete(assetId);
        throw error;
      });
    buffers.set(assetId, entry);
    return entry.promise;
  }

  function loadStream(assetId) {
    return new Promise((resolve, reject) => {
      const element = new Audio();
      const timeout = setTimeout(
        () => reject(new Error("Audiodatei antwortet nicht")),
        STREAM_TIMEOUT_MS
      );
      element.preload = "auto";
      element.loop = true;
      element.addEventListener(
        "canplay",
        () => {
          clearTimeout(timeout);
          resolve(element);
        },
        { once: true }
      );
      element.addEventListener(
        "error",
        () => {
          clearTimeout(timeout);
          reject(new Error("Dieser Browser kann das Audioformat nicht abspielen"));
        },
        { once: true }
      );
      element.src = resolveAsset(assetId);
      element.load();
    });
  }

  function createChannel(track, output) {
    const gainNode = context.createGain();
    const muteNode = context.createGain();
    const panNode = context.createStereoPanner ? context.createStereoPanner() : null;

    gainNode.connect(muteNode);
    if (panNode) {
      muteNode.connect(panNode);
      panNode.connect(output);
    } else {
      muteNode.connect(output);
    }

    return {
      id: track.id,
      assetId: track.assetId,
      mode: track.mode,
      input: gainNode,
      nodes: [gainNode, muteNode, panNode].filter(Boolean),
      volume: createRamp(context, gainNode.gain, faderToGain(track.volume)),
      mute: createRamp(context, muteNode.gain, track.muted ? 0 : 1),
      pan: panNode ? createRamp(context, panNode.pan, track.pan) : null,
      buffer: null,
      source: null,
      element: null,
      elementNode: null,
    };
  }

  function prepareChannel(track, output) {
    const channel = createChannel(track, output);
    if (track.mode === "stream") {
      return loadStream(track.assetId).then((element) => {
        channel.element = element;
        channel.elementNode = context.createMediaElementSource(element);
        channel.elementNode.connect(channel.input);
        return channel;
      });
    }
    return loadBuffer(track.assetId).then((buffer) => {
      channel.buffer = buffer;
      return channel;
    });
  }

  function startChannel(channel) {
    if (channel.element) {
      if (context.state === "running") {
        channel.element.play().catch(() => {});
      }
      return;
    }
    if (channel.source) return;
    const source = context.createBufferSource();
    source.buffer = channel.buffer;
    source.loop = true;
    source.connect(channel.input);
    source.start();
    channel.source = source;
  }

  function destroyChannel(channel) {
    if (channel.source) {
      try {
        channel.source.stop();
      } catch (error) {
        // Die Quelle war bereits gestoppt.
      }
      channel.source.disconnect();
      channel.source = null;
    }
    if (channel.element) {
      channel.element.pause();
      channel.element.removeAttribute("src");
      channel.element.load();
      channel.elementNode.disconnect();
      channel.element = null;
    }
    channel.nodes.forEach((node) => node.disconnect());
  }

  function destroyBus(target) {
    target.channels.forEach(destroyChannel);
    target.channels.clear();
    target.node.disconnect();
    retiring.delete(target);
  }

  function prepareScene(tracks, report) {
    const node = context.createGain();
    node.connect(masterNode);
    const target = {
      node,
      level: createRamp(context, node.gain, 0),
      channels: new Map(),
    };
    const tasks = tracks.map((track) =>
      prepareChannel(track, node).then(
        (channel) => {
          target.channels.set(track.id, channel);
          report(track.assetId, null);
        },
        (error) => report(track.assetId, error)
      )
    );
    return Promise.all(tasks).then(() => target);
  }

  function retire(target, fadeMs) {
    retiring.add(target);
    target.level.to(0, fadeMs);
    setTimeout(() => destroyBus(target), fadeMs + 100);
  }

  function activateScene(target, fadeMs) {
    const previous = bus;
    bus = target;
    target.channels.forEach(startChannel);
    target.level.to(1, fadeMs);
    if (previous) retire(previous, fadeMs);
  }

  function leaveScene(fadeMs) {
    if (!bus) return;
    const previous = bus;
    bus = null;
    retire(previous, fadeMs);
  }

  function applyTrack(channel, patch) {
    if (typeof patch.volume === "number") {
      channel.volume.to(faderToGain(patch.volume), CONTROL_RAMP_MS);
    }
    if (typeof patch.muted === "boolean") {
      channel.mute.to(patch.muted ? 0 : 1, CONTROL_RAMP_MS);
    }
    if (typeof patch.pan === "number" && channel.pan) {
      channel.pan.to(patch.pan, CONTROL_RAMP_MS);
    }
  }

  function removeChannel(channel) {
    bus.channels.delete(channel.id);
    channel.volume.to(0, REMOVE_FADE_MS);
    setTimeout(() => destroyChannel(channel), REMOVE_FADE_MS + 50);
  }

  // Gleicht die Spuren der laufenden Szene ab, ohne weiterlaufende Spuren neu zu starten.
  function syncTracks(tracks, report) {
    const target = bus;
    if (!target) return Promise.resolve();

    const wanted = new Map(tracks.map((track) => [track.id, track]));
    Array.from(target.channels.values()).forEach((channel) => {
      const track = wanted.get(channel.id);
      if (!track || track.assetId !== channel.assetId || track.mode !== channel.mode) {
        removeChannel(channel);
      }
    });

    const tasks = tracks.map((track) => {
      const channel = target.channels.get(track.id);
      if (channel) {
        applyTrack(channel, track);
        report(track.assetId, null);
        return Promise.resolve();
      }
      return prepareChannel(track, target.node).then(
        (added) => {
          report(track.assetId, null);
          if (bus !== target) {
            destroyChannel(added);
            return;
          }
          target.channels.set(track.id, added);
          startChannel(added);
        },
        (error) => report(track.assetId, error)
      );
    });
    return Promise.all(tasks).then(() => undefined);
  }

  function updateTrack(trackId, patch) {
    const channel = bus && bus.channels.get(trackId);
    if (channel) applyTrack(channel, patch);
  }

  function syncEffects(list, report) {
    effects = new Map(list.map((effect) => [effect.id, effect]));
    const tasks = list.map((effect) =>
      loadBuffer(effect.assetId).then(
        () => report(effect.assetId, null),
        (error) => report(effect.assetId, error)
      )
    );
    return Promise.all(tasks).then(() => undefined);
  }

  function playEffect(effectId) {
    const effect = effects.get(effectId);
    const entry = effect && buffers.get(effect.assetId);
    if (!entry || !entry.buffer || context.state !== "running") return false;

    const source = context.createBufferSource();
    const gain = context.createGain();
    gain.gain.value = faderToGain(effect.volume);
    source.buffer = entry.buffer;
    source.connect(gain);
    gain.connect(effectBus);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
    };
    source.start();
    return true;
  }

  // Gibt Audiodaten frei, die weder die Szene noch ein Effekt noch brauchen.
  function retain(assetIds) {
    Array.from(buffers.keys()).forEach((assetId) => {
      if (!assetIds.has(assetId)) buffers.delete(assetId);
    });
  }

  function resumeStreams() {
    if (bus) bus.channels.forEach(startChannel);
  }

  function setMaster(level, fadeMs) {
    master.to(level, fadeMs);
  }

  function stopAll() {
    Array.from(retiring).forEach(destroyBus);
    if (bus) destroyBus(bus);
    bus = null;
    effects = new Map();
    buffers.clear();
  }

  return {
    prepareScene,
    discardScene: destroyBus,
    activateScene,
    leaveScene,
    syncTracks,
    updateTrack,
    syncEffects,
    playEffect,
    retain,
    resumeStreams,
    setMaster,
    stopAll,
  };
}
