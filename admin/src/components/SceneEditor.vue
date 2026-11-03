<script setup>
import { computed } from "vue";

import { assetUrl } from "../api.js";
import { BUILTIN_BLACK, usePult } from "../stores/pult.js";
import AddFiles from "./AddFiles.vue";
import ChannelStrip from "./ChannelStrip.vue";
import ConfirmButton from "./ConfirmButton.vue";
import DragHandle from "./DragHandle.vue";
import { FADE_STOPS_MS, SLIDE_STOPS_MS, formatDuration } from "./durations.js";
import InlineName from "./InlineName.vue";
import SliderField from "./SliderField.vue";
import { useDragSort } from "./useDragSort.js";

const props = defineProps({
  scene: { type: Object, required: true },
});

const pult = usePult();

const isLive = computed(() => pult.live.activeSceneId === props.scene.id);
const onlyPlaceholder = computed(
  () => props.scene.images.length === 1 && props.scene.images[0].assetId === BUILTIN_BLACK
);

const imageSort = useDragSort(
  () => props.scene.images.map((image) => image.id),
  (ids) => pult.reorder("images", props.scene.id, ids)
);
const trackSort = useDragSort(
  () => props.scene.tracks.map((track) => track.id),
  (ids) => pult.reorder("tracks", props.scene.id, ids)
);
const oneImage = computed(() => props.scene.images.length < 2);
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
          v-bind="imageSort.item(image.id)"
          :class="{ ziel: imageSort.over.value === image.id }"
        >
          <DragHandle
            v-if="!oneImage"
            class="griff-bild"
            v-bind="imageSort.handle(image.id)"
            label="Bild verschieben: ziehen oder Pfeiltasten"
          />
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
        <SliderField
          label="Szenenwechsel"
          :value="scene.transitionMs"
          :stops="FADE_STOPS_MS"
          :format="formatDuration"
          :commit="(transitionMs) => pult.updateScene(scene.id, { transitionMs })"
        />
        <SliderField
          label="Standzeit je Bild"
          :value="scene.slideDurationMs"
          :stops="SLIDE_STOPS_MS"
          :format="formatDuration"
          :disabled="oneImage"
          :commit="(slideDurationMs) => pult.updateScene(scene.id, { slideDurationMs })"
        />
        <SliderField
          label="Bildwechsel"
          :value="scene.slideFadeMs"
          :stops="FADE_STOPS_MS"
          :format="formatDuration"
          :disabled="oneImage"
          :commit="(slideFadeMs) => pult.updateScene(scene.id, { slideFadeMs })"
        />
      </div>
      <p v-if="onlyPlaceholder" class="klein leise">Bis zum ersten Bild zeigt die Anzeige Schwarz.</p>
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
          v-bind="trackSort.item(track.id)"
          :class="{ ziel: trackSort.over.value === track.id }"
        >
          <ChannelStrip :scene-id="scene.id" :track="track">
            <template #griff>
              <DragHandle
                v-if="scene.tracks.length > 1"
                v-bind="trackSort.handle(track.id)"
                label="Spur verschieben: ziehen oder Pfeiltasten"
              />
            </template>
          </ChannelStrip>
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

.griff-bild {
  position: absolute;
  z-index: 1;
  top: 0.25rem;
  left: 0.25rem;
  background: rgb(15 23 48 / 85%);
}

.zeiten {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
  gap: 0.75rem 1.5rem;
  max-width: 44rem;
}

.mischpult {
  display: flex;
  gap: 0.5rem;
  padding-bottom: 0.25rem;
  overflow-x: auto;
}
</style>
