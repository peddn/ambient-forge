<script setup>
import { ref, watch } from "vue";

import { usePult } from "../stores/pult.js";

const FLASH_MS = 350;

const pult = usePult();
const flashing = ref(null);
let flashTimer = null;
let pressedWithMouse = false;

function trigger(effect) {
  pult.playEffect(effect.id);
  flashing.value = effect.id;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    flashing.value = null;
  }, FLASH_MS);
}

// Die Maus löst schon beim Drücken aus. Beim Finger wäre das falsch, weil sonst
// jedes Wischen durch die Effektleiste einen Sound abspielt.
function onPointerDown(event, effect) {
  pressedWithMouse = event.pointerType === "mouse";
  if (pressedWithMouse && event.button === 0) trigger(effect);
}

// Tastatur (detail 0) und Finger lösen hier aus, die Maus hat es schon getan.
function onClick(event, effect) {
  if (event.detail === 0 || !pressedWithMouse) trigger(effect);
}

watch(
  () => pult.lastEffect,
  (result) => {
    if (result && result.delivered === 0 && pult.silentReason) {
      pult.showNotice(pult.silentReason);
    }
  }
);

// Ist die Ursache behoben, verschwindet auch der Hinweis.
watch(
  () => pult.silentReason,
  (reason) => {
    if (!reason) pult.clearNotice();
  }
);
</script>

<template>
  <section class="schiene" aria-label="Soundeffekte">
    <p v-if="pult.effects.length === 0" class="leise">
      Noch keine Effekte.
      <RouterLink :to="{ name: 'effects' }">Effekt anlegen</RouterLink>
    </p>
    <button
      v-for="effect in pult.effects"
      :key="effect.id"
      class="effekt"
      :class="{ blitz: flashing === effect.id }"
      type="button"
      :title="pult.silentReason || effect.name"
      @pointerdown="onPointerDown($event, effect)"
      @click="onClick($event, effect)"
    >
      {{ effect.name }}
    </button>
  </section>
</template>

<style scoped>
.schiene {
  display: flex;
  flex: 1;
  gap: 0.5rem;
  align-items: stretch;
  min-width: 0;
  min-height: 5.75rem;
  padding: 0.6rem var(--abstand);
  overflow-x: auto;
}

.schiene p {
  align-self: center;
}

.effekt {
  flex: none;
  min-width: 7.5rem;
  max-width: 13rem;
  padding: 0.5rem 0.85rem;
  overflow: hidden;
  border: 1px solid var(--kante);
  border-bottom-width: 4px;
  border-radius: var(--radius-taste);
  background: var(--pult-hell);
  font-weight: 700;
  text-overflow: ellipsis;
  touch-action: manipulation;
  user-select: none;
}

.effekt:hover {
  border-color: var(--arbeitslicht);
}

.effekt:active,
.effekt.blitz {
  border-color: var(--go);
  border-bottom-width: 1px;
  background: color-mix(in srgb, var(--go) 30%, var(--pult-hell));
  transform: translateY(3px);
}
</style>
