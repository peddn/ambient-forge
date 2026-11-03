<script setup>
import { computed } from "vue";

import { assetUrl } from "../api.js";
import { BUILTIN_BLACK, BUILTIN_SILENCE, usePult } from "../stores/pult.js";
import AddFiles from "./AddFiles.vue";
import ConfirmButton from "./ConfirmButton.vue";
import DragHandle from "./DragHandle.vue";
import { FADE_STOPS_MS, SLIDE_STOPS_MS, formatDuration } from "./durations.js";
import InlineName from "./InlineName.vue";
import PanelBox from "./PanelBox.vue";
import SliderField from "./SliderField.vue";
import TrackRow from "./TrackRow.vue";
import { useDragSort } from "./useDragSort.js";

const props = defineProps({
  scene: { type: Object, required: true },
  projectActive: { type: Boolean, required: true },
});

const pult = usePult();

const isLive = computed(() => props.projectActive && pult.live.activeSceneId === props.scene.id);
const onlyPlaceholder = computed(
  () => props.scene.images.length === 1 && props.scene.images[0].assetId === BUILTIN_BLACK
);
const oneImage = computed(() => props.scene.images.length < 2);
const realTracks = computed(() => props.scene.tracks.some((track) => track.assetId !== BUILTIN_SILENCE));

const imageSort = useDragSort(
  () => props.scene.images.map((image) => image.id),
  (ids) => pult.reorder("images", props.scene.id, ids)
);
const trackSort = useDragSort(
  () => props.scene.tracks.map((track) => track.id),
  (ids) => pult.reorder("tracks", props.scene.id, ids)
);
</script>

<template>
  <div class="editor">
    <PanelBox>
      <div class="szene-kopf">
        <InlineName
          class="titel"
          :model-value="scene.name"
          label="Name der Szene"
          @commit="pult.updateScene(scene.id, { name: $event })"
        />
        <span v-if="isLive" class="laeuft"><span class="licht"></span>Läuft</span>
        <button
          v-else
          class="taste taste-go"
          type="button"
          :disabled="!projectActive || !pult.online"
          :title="projectActive ? undefined : 'Aktiviere zuerst dieses Projekt'"
          @click="pult.activateScene(scene.id)"
        >
          Zeigen
        </button>
        <ConfirmButton
          label="Szene löschen"
          :disabled="isLive"
          :title="isLive ? 'Die laufende Szene kann nicht gelöscht werden' : undefined"
          @confirm="pult.deleteScene(scene.id)"
        />
      </div>
      <div class="szenenwechsel">
        <SliderField
          label="Überblendung beim Wechsel in diese Szene"
          :value="scene.transitionMs"
          :stops="FADE_STOPS_MS"
          :format="formatDuration"
          :commit="(transitionMs) => pult.updateScene(scene.id, { transitionMs })"
        />
      </div>
    </PanelBox>

    <PanelBox title="Bilder">
      <template #aktionen>
        <AddFiles kind="image" label="Bilder hochladen" @picked="pult.addImage(scene.id, $event.id)" />
      </template>

      <ul class="bildliste">
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

      <p v-if="onlyPlaceholder" class="klein leise hinweis">Bis zum ersten Bild zeigt die Anzeige Schwarz.</p>

      <div class="zeiten" :title="oneImage ? 'Die Diashow beginnt ab zwei Bildern' : undefined">
        <SliderField
          label="Standzeit je Bild"
          :value="scene.slideDurationMs"
          :stops="SLIDE_STOPS_MS"
          :format="formatDuration"
          :disabled="oneImage"
          :commit="(slideDurationMs) => pult.updateScene(scene.id, { slideDurationMs })"
        />
        <SliderField
          label="Überblendung zwischen Bildern"
          :value="scene.slideFadeMs"
          :stops="FADE_STOPS_MS"
          :format="formatDuration"
          :disabled="oneImage"
          :commit="(slideFadeMs) => pult.updateScene(scene.id, { slideFadeMs })"
        />
      </div>
    </PanelBox>

    <PanelBox title="Soundspuren">
      <template #aktionen>
        <AddFiles kind="audio" label="Spuren hochladen" @picked="pult.addTrack(scene.id, $event)" />
      </template>

      <div class="spuren">
        <div v-if="realTracks" class="spaltenkopf klein leise" aria-hidden="true">
          <span class="s-name">Spur</span>
          <span class="s-laut">Lautstärke</span>
          <span class="s-pan">Panning</span>
          <span class="s-modus">Wiedergabe</span>
        </div>
        <div
          v-for="track in scene.tracks"
          :key="track.id"
          v-bind="trackSort.item(track.id)"
          class="spur"
          :class="{ ziel: trackSort.over.value === track.id }"
        >
          <TrackRow :scene-id="scene.id" :track="track">
            <template #griff>
              <DragHandle
                v-if="scene.tracks.length > 1"
                v-bind="trackSort.handle(track.id)"
                label="Spur verschieben: ziehen oder Pfeiltasten"
              />
            </template>
          </TrackRow>
        </div>
      </div>
    </PanelBox>
  </div>
</template>

<style scoped>
.editor {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  min-width: 0;
}

.szene-kopf {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 0.75rem;
  align-items: center;
}

.titel {
  flex: 1 1 14rem;
  font-size: 1.5rem;
  font-weight: 700;
}

.laeuft {
  display: inline-flex;
  gap: 0.4rem;
  align-items: center;
  color: var(--go);
  font-weight: 700;
}

.licht {
  width: 0.7rem;
  height: 0.7rem;
  border-radius: 50%;
  background: var(--go);
}

.szenenwechsel {
  max-width: 26rem;
  margin-top: 0.75rem;
}

.bildliste {
  display: flex;
  gap: 0.5rem;
  margin: 0;
  padding: 0 0 0.25rem;
  overflow-x: auto;
  list-style: none;
}

.bildliste li {
  position: relative;
  flex: none;
  width: 9.5rem;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border: 1px solid var(--kante);
  border-radius: var(--radius-klein);
  background: #000;
}

.bildliste li.ziel {
  outline: 2px solid var(--standby);
}

.bildliste img {
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

.griff-bild {
  position: absolute;
  z-index: 1;
  top: 0.25rem;
  left: 0.25rem;
  background: rgb(15 23 48 / 85%);
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

.bildliste li:hover .weg,
.bildliste li:focus-within .weg {
  opacity: 1;
}

@media (hover: none) {
  .weg {
    opacity: 1;
  }
}

.hinweis {
  margin-top: 0.5rem;
}

.zeiten {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
  gap: 0.75rem 2rem;
  max-width: 44rem;
  margin-top: 0.75rem;
}

/* Spalten für Griff, Name, Mute, Lautstärke, Panning, Wiedergabe und Entfernen. */
.spuren {
  --spuren-spalten: 1.5rem minmax(7rem, 1.2fr) 4.6rem minmax(10rem, 1.6fr) minmax(10rem, 1.3fr) 10.5rem 4.6rem;

  container: spuren / inline-size;
}

.spaltenkopf {
  display: grid;
  grid-template-areas: ". name . laut pan modus .";
  grid-template-columns: var(--spuren-spalten);
  gap: 0 0.75rem;
  padding: 0 0.25rem 0.35rem 0;
  border-bottom: 1px solid var(--kante);
}

.s-name {
  grid-area: name;
}

.s-laut {
  grid-area: laut;
}

.s-pan {
  grid-area: pan;
}

.s-modus {
  grid-area: modus;
}

@container spuren (max-width: 54rem) {
  .spaltenkopf {
    display: none;
  }
}

.spur + .spur {
  border-top: 1px solid var(--kante);
}

.spur.ziel {
  outline: 2px solid var(--standby);
  outline-offset: -2px;
}
</style>
