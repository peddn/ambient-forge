<script setup>
import { computed } from "vue";

import { BUILTIN_SILENCE, usePult } from "../stores/pult.js";
import InlineName from "./InlineName.vue";

const props = defineProps({
  sceneId: { type: String, required: true },
  track: { type: Object, required: true },
});

const pult = usePult();
const placeholder = computed(() => props.track.assetId === BUILTIN_SILENCE);
const percent = computed(() => Math.round(props.track.volume * 100));
const panLabel = computed(() => {
  const value = Math.round(props.track.pan * 100);
  if (value === 0) return "Mitte";
  return value < 0 ? `links ${-value}` : `rechts ${value}`;
});

function move(fields) {
  pult.moveTrack(props.sceneId, props.track.id, fields);
}
</script>

<template>
  <article class="kanal" :class="{ stumm: track.muted }">
    <div class="griffzelle"><slot name="griff" /></div>

    <p v-if="placeholder" class="kanalname leise">
      {{ track.name }}. Die erste hochgeladene Spur ersetzt sie.
    </p>

    <template v-else>
      <InlineName
        class="kanalname"
        :model-value="track.name"
        label="Name der Spur"
        @commit="pult.updateTrack(sceneId, track.id, { name: $event })"
      />

      <button
        class="taste mute"
        type="button"
        :aria-pressed="track.muted"
        @click="move({ muted: !track.muted })"
      >
        {{ track.muted ? "Stumm" : "Mute" }}
      </button>

      <label class="regelzelle lautstaerke">
        <span class="spaltentitel klein leise">Lautstärke</span>
        <input
          class="fader"
          type="range"
          min="0"
          max="1"
          step="0.01"
          :value="track.volume"
          :aria-label="`Lautstärke von ${track.name}`"
          :aria-valuetext="`${percent} Prozent`"
          @input="move({ volume: Number($event.target.value) })"
        />
        <span class="wert">{{ percent }} %</span>
      </label>

      <label class="regelzelle pan">
        <span class="spaltentitel klein leise">Panning</span>
        <input
          type="range"
          min="-1"
          max="1"
          step="0.01"
          :value="track.pan"
          :aria-label="`Panning von ${track.name}`"
          :aria-valuetext="panLabel"
          title="Doppelklick stellt auf die Mitte"
          @input="move({ pan: Number($event.target.value) })"
          @dblclick="move({ pan: 0 })"
        />
        <span class="wert">{{ panLabel }}</span>
      </label>

      <label class="modus">
        <span class="nur-sr">Wiedergabe von {{ track.name }}</span>
        <select
          class="feld"
          :value="track.mode"
          @change="pult.updateTrack(sceneId, track.id, { mode: $event.target.value })"
        >
          <option value="buffer">Lückenlos im Loop</option>
          <option value="stream">Lange Musik</option>
        </select>
      </label>

      <button
        class="entfernen klein"
        type="button"
        :aria-label="`Spur ${track.name} entfernen`"
        @click="pult.removeTrack(sceneId, track.id)"
      >
        Entfernen
      </button>
    </template>
  </article>
</template>

<style scoped>
.kanal {
  display: grid;
  grid-template-areas: "griff name mute laut pan modus entf";
  grid-template-columns: var(--spuren-spalten);
  gap: 0.5rem 0.75rem;
  align-items: center;
  padding: 0.5rem 0.25rem 0.5rem 0;
}

.griffzelle {
  grid-area: griff;
}

.kanalname {
  grid-area: name;
  min-width: 0;
  font-weight: 700;
  overflow-wrap: anywhere;
}

p.kanalname {
  grid-column: name / -1;
  font-weight: 400;
}

.mute {
  grid-area: mute;
  padding-inline: 0.4rem;
}

.mute[aria-pressed="true"] {
  border-color: var(--standby);
  background: var(--standby);
  color: var(--nacht);
  font-weight: 700;
}

.regelzelle {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 4.6rem;
  gap: 0 0.5rem;
  align-items: center;
  min-width: 0;
}

.lautstaerke {
  grid-area: laut;
}

.pan {
  grid-area: pan;
}

.spaltentitel {
  display: none;
  grid-column: 1 / -1;
}

.regelzelle input {
  width: 100%;
  margin: 0;
  accent-color: var(--go);
}

.pan input {
  accent-color: var(--arbeitslicht);
}

.stumm .fader {
  accent-color: var(--standby);
}

.wert {
  font-size: 0.875rem;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.modus {
  grid-area: modus;
  min-width: 0;
}

.modus .feld {
  padding-block: 0.35rem;
  font-size: 0.875rem;
}

.entfernen {
  grid-area: entf;
  justify-self: end;
  padding: 0;
  border: 0;
  background: none;
  color: var(--arbeitslicht);
  text-decoration: underline;
}

.entfernen:hover {
  color: var(--blackout);
}

/* Bei wenig Platz stehen die Regler unter dem Namen und tragen eigene Titel. */
@container spuren (max-width: 54rem) {
  .kanal {
    grid-template-areas:
      "griff name name mute"
      ".     laut pan  pan"
      ".     modus modus entf";
    grid-template-columns: 1.5rem minmax(0, 1fr) minmax(0, 1fr) 4.6rem;
    padding-block: 0.75rem;
  }

  .spaltentitel {
    display: block;
  }
}

@container spuren (max-width: 30rem) {
  .kanal {
    grid-template-areas:
      "griff name mute"
      ".     laut laut"
      ".     pan  pan"
      ".     modus entf";
    grid-template-columns: 1.5rem minmax(0, 1fr) 5rem;
  }
}
</style>
