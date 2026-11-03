<script setup>
import { computed, ref, watch } from "vue";

const props = defineProps({
  label: { type: String, required: true },
  value: { type: Number, required: true },
  format: { type: Function, required: true },
  commit: { type: Function, required: true },
  // Mit `stops` rastet der Regler auf diesen Werten ein, sonst gelten min, max und step.
  stops: { type: Array, default: null },
  min: { type: Number, default: 0 },
  max: { type: Number, default: 1 },
  step: { type: Number, default: 0.01 },
  disabled: { type: Boolean, default: false },
});

// Der Wert während des Ziehens. Gespeichert wird erst beim Loslassen.
const draft = ref(null);

const shown = computed(() => (draft.value === null ? props.value : draft.value));

function nearestStop(value) {
  let best = 0;
  props.stops.forEach((stop, index) => {
    if (Math.abs(stop - value) < Math.abs(props.stops[best] - value)) best = index;
  });
  return best;
}

const position = computed(() => (props.stops ? nearestStop(shown.value) : shown.value));

function onInput(event) {
  const raw = Number(event.target.value);
  draft.value = props.stops ? props.stops[raw] : raw;
}

async function onChange() {
  const value = draft.value;
  if (value === null) return;
  if (value === props.value) {
    draft.value = null;
    return;
  }
  const saved = await props.commit(value);
  if (!saved) draft.value = null;
}

watch(
  () => props.value,
  () => {
    draft.value = null;
  }
);
</script>

<template>
  <label class="regler" :class="{ aus: disabled }">
    <span class="zeile">
      <span class="klein leise">{{ label }}</span>
      <span class="wert">{{ format(shown) }}</span>
    </span>
    <input
      type="range"
      :min="stops ? 0 : min"
      :max="stops ? stops.length - 1 : max"
      :step="stops ? 1 : step"
      :value="position"
      :disabled="disabled"
      :aria-valuetext="format(shown)"
      @input="onInput"
      @change="onChange"
    />
  </label>
</template>

<style scoped>
.regler {
  display: grid;
  gap: 0.2rem;
  min-width: 0;
}

.regler.aus {
  opacity: 0.55;
}

.zeile {
  display: flex;
  gap: 0.75rem;
  align-items: baseline;
  justify-content: space-between;
}

.wert {
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  white-space: nowrap;
}

input {
  width: 100%;
  margin: 0;
  accent-color: var(--go);
}
</style>
