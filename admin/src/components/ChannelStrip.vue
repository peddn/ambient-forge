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
  return value < 0 ? `${-value} % links` : `${value} % rechts`;
});

function move(fields) {
  pult.moveTrack(props.sceneId, props.track.id, fields);
}
</script>

<template>
  <article class="kanal" :class="{ stumm: track.muted }">
    <div class="kopfzeile">
      <slot name="griff" />
      <InlineName
        v-if="!placeholder"
        class="kanalname"
        :model-value="track.name"
        label="Name der Spur"
        @commit="pult.updateTrack(sceneId, track.id, { name: $event })"
      />
      <p v-else class="kanalname leise">{{ track.name }}</p>
    </div>

    <div class="regler">
      <input
        class="fader"
        type="range"
        min="0"
        max="1"
        step="0.01"
        :value="track.volume"
        :disabled="placeholder"
        :aria-label="`Lautstärke von ${track.name}`"
        :aria-valuetext="`${percent} Prozent`"
        @input="move({ volume: Number($event.target.value) })"
      />

      <div class="bedienung">
        <span class="wert">{{ percent }} %</span>
        <button
          class="taste mute"
          type="button"
          :aria-pressed="track.muted"
          :disabled="placeholder"
          @click="move({ muted: !track.muted })"
        >
          {{ track.muted ? "Stumm" : "Mute" }}
        </button>
        <label class="pan">
          <span class="klein leise">{{ panLabel }}</span>
          <input
            type="range"
            min="-1"
            max="1"
            step="0.01"
            :value="track.pan"
            :disabled="placeholder"
            :aria-label="`Panning von ${track.name}`"
            @input="move({ pan: Number($event.target.value) })"
            @dblclick="move({ pan: 0 })"
          />
        </label>
      </div>
    </div>

    <label v-if="!placeholder" class="modus klein">
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
      v-if="!placeholder"
      class="entfernen klein"
      type="button"
      @click="pult.removeTrack(sceneId, track.id)"
    >
      Spur entfernen
    </button>
  </article>
</template>

<style scoped>
.kanal {
  display: flex;
  flex: none;
  flex-direction: column;
  gap: 0.5rem;
  width: 12rem;
  padding: 0.6rem;
  border: 1px solid var(--kante);
  border-radius: var(--radius-klein);
  background: var(--pult);
}

.kanal.stumm {
  border-color: var(--standby);
}

.kopfzeile {
  display: flex;
  gap: 0.25rem;
  align-items: center;
}

.kanalname {
  flex: 1;
  min-width: 0;
  min-height: 1.9rem;
  font-weight: 700;
  overflow-wrap: anywhere;
}

.regler {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 0.6rem;
}

.fader {
  width: 2.25rem;
  height: 8.5rem;
  margin: 0;
  accent-color: var(--go);
  direction: rtl;
  writing-mode: vertical-lr;
}

.stumm .fader {
  accent-color: var(--standby);
}

.bedienung {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  justify-content: space-between;
  min-width: 0;
}

.wert {
  font-size: 1.15rem;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
}

.pan {
  display: grid;
  gap: 0.1rem;
}

.pan input {
  width: 100%;
  margin: 0;
  accent-color: var(--arbeitslicht);
}

.mute[aria-pressed="true"] {
  border-color: var(--standby);
  background: var(--standby);
  color: var(--nacht);
  font-weight: 700;
}

.entfernen {
  padding: 0;
  border: 0;
  background: none;
  color: var(--arbeitslicht);
  text-align: left;
  text-decoration: underline;
}

.entfernen:hover {
  color: var(--blackout);
}
</style>
