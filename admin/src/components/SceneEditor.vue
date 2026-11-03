<script setup>
import { computed } from "vue";

import { assetUrl } from "../api.js";
import { BUILTIN_BLACK, usePult } from "../stores/pult.js";
import AddFiles from "./AddFiles.vue";
import ChannelStrip from "./ChannelStrip.vue";
import ConfirmButton from "./ConfirmButton.vue";
import InlineName from "./InlineName.vue";
import { moved, useDragSort } from "./useDragSort.js";

const props = defineProps({
  scene: { type: Object, required: true },
});

const pult = usePult();

const isLive = computed(() => pult.live.activeSceneId === props.scene.id);
const onlyPlaceholder = computed(
  () => props.scene.images.length === 1 && props.scene.images[0].assetId === BUILTIN_BLACK
);

const imageSort = useDragSort((from, to) => {
  const ids = props.scene.images.map((image) => image.id);
  pult.reorder("images", props.scene.id, moved(ids, from, to));
});
const trackSort = useDragSort((from, to) => {
  const ids = props.scene.tracks.map((track) => track.id);
  pult.reorder("tracks", props.scene.id, moved(ids, from, to));
});

const timing = computed(() => [
  { key: "transitionMs", label: "Szenenwechsel", min: 0, value: props.scene.transitionMs },
  { key: "slideDurationMs", label: "Standzeit je Bild", min: 1, value: props.scene.slideDurationMs },
  { key: "slideFadeMs", label: "Bildwechsel", min: 0, value: props.scene.slideFadeMs },
]);

function saveTiming(key, seconds, input) {
  const ms = Math.round(Number(seconds) * 1000);
  if (Number.isNaN(ms)) return;
  pult.updateScene(props.scene.id, { [key]: ms }).then((saved) => {
    if (!saved) input.value = props.scene[key] / 1000;
  });
}
</script>

<template>
  <section class="editor" aria-label="Szene bearbeiten">
    <header class="kopf">
      <InlineName
        class="titel"
        :model-value="scene.name"
        label="Name der Szene"
        @commit="pult.updateScene(scene.id, { name: $event })"
      />
      <ConfirmButton
        label="Szene löschen"
        :disabled="isLive"
        :title="isLive ? 'Die laufende Szene kann nicht gelöscht werden' : undefined"
        @confirm="pult.deleteScene(scene.id)"
      />
    </header>

    <section class="abschnitt">
      <div class="zeile">
        <h2>Bilder</h2>
        <AddFiles kind="image" label="Bilder hochladen" @picked="pult.addImage(scene.id, $event.id)" />
      </div>

      <ul class="bilder">
        <li
          v-for="image in scene.images"
          :key="image.id"
          v-bind="imageSort.handlers(image.id)"
          :class="{ ziel: imageSort.over.value === image.id }"
        >
          <img
            v-if="image.assetId !== BUILTIN_BLACK"
            :src="assetUrl(image.assetId)"
            alt=""
            draggable="false"
          />
          <span v-else class="platzhalter">Schwarzer Hintergrund</span>
          <button
            v-if="image.assetId !== BUILTIN_BLACK"
            class="weg"
            type="button"
            :aria-label="`Bild ${scene.images.indexOf(image) + 1} entfernen`"
            @click="pult.removeImage(scene.id, image.id)"
          >
            Entfernen
          </button>
        </li>
      </ul>

      <div class="zeiten">
        <label v-for="field in timing" :key="field.key">
          <span class="klein leise">{{ field.label }}</span>
          <span class="eingabe">
            <input
              class="feld"
              type="number"
              step="0.5"
              :min="field.min"
              :value="field.value / 1000"
              :disabled="field.key !== 'transitionMs' && scene.images.length < 2"
              @change="saveTiming(field.key, $event.target.value, $event.target)"
            />
            <span class="klein leise">Sek.</span>
          </span>
        </label>
        <p v-if="onlyPlaceholder" class="klein leise hinweis">
          Bis zum ersten Bild zeigt die Anzeige Schwarz.
        </p>
      </div>
    </section>

    <section class="abschnitt">
      <div class="zeile">
        <h2>Soundspuren</h2>
        <AddFiles kind="audio" label="Spuren hochladen" @picked="pult.addTrack(scene.id, $event)" />
      </div>

      <div class="mischpult">
        <div
          v-for="track in scene.tracks"
          :key="track.id"
          v-bind="trackSort.handlers(track.id)"
          :class="{ ziel: trackSort.over.value === track.id }"
        >
          <ChannelStrip :scene-id="scene.id" :track="track" />
        </div>
      </div>
    </section>
  </section>
</template>

<style scoped>
.editor {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  min-width: 0;
}

.kopf {
  display: flex;
  gap: 1rem;
  align-items: center;
}

.titel {
  flex: 1;
  font-size: 1.5rem;
  font-weight: 700;
}

.abschnitt {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.zeile {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1rem;
  align-items: center;
  justify-content: space-between;
}

.bilder {
  display: flex;
  gap: 0.5rem;
  margin: 0;
  padding: 0 0 0.25rem;
  overflow-x: auto;
  list-style: none;
}

.bilder li {
  position: relative;
  flex: none;
  width: 9.5rem;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border: 1px solid var(--kante);
  border-radius: var(--radius-klein);
  background: #000;
}

.bilder li.ziel,
.mischpult > .ziel {
  outline: 2px solid var(--standby);
}

.bilder img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.platzhalter {
  display: grid;
  height: 100%;
  padding: 0.5rem;
  color: var(--arbeitslicht);
  font-size: 0.875rem;
  place-items: center;
  text-align: center;
}

.weg {
  position: absolute;
  right: 0.25rem;
  bottom: 0.25rem;
  padding: 0.1rem 0.45rem;
  border: 0;
  border-radius: var(--radius-klein);
  background: rgb(15 23 48 / 85%);
  font-size: 0.8rem;
  opacity: 0;
}

.bilder li:hover .weg,
.bilder li:focus-within .weg {
  opacity: 1;
}

@media (hover: none) {
  .weg {
    opacity: 1;
  }
}

.zeiten {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem 1.5rem;
  align-items: flex-end;
}

.zeiten label {
  display: grid;
  gap: 0.15rem;
}

.eingabe {
  display: flex;
  gap: 0.35rem;
  align-items: center;
}

.eingabe .feld {
  width: 5.5rem;
}

.mischpult {
  display: flex;
  gap: 0.5rem;
  padding-bottom: 0.25rem;
  overflow-x: auto;
}
</style>
