<script setup>
import { computed } from "vue";

import { usePult } from "../stores/pult.js";

const pult = usePult();
const on = computed(() => pult.live.masterOn);
</script>

<template>
  <button
    class="master"
    :class="on ? 'an' : 'aus'"
    type="button"
    role="switch"
    :aria-checked="on"
    aria-label="Master: Bild und Ton aller Anzeigen"
    :disabled="!pult.online"
    @click="pult.setMaster(!on)"
  >
    <span class="titel">{{ on ? "Master an" : "Master aus" }}</span>
    <span class="hinweis">{{ on ? "Klicken blendet alles aus" : "Klicken blendet wieder ein" }}</span>
  </button>
</template>

<style scoped>
.master {
  --farbe: var(--go);

  display: grid;
  flex: none;
  gap: 0.1rem;
  align-content: center;
  justify-items: center;
  width: 15rem;
  min-height: 4.75rem;
  padding: 0.35rem 1rem;
  border: 0;
  border-bottom: 6px solid color-mix(in srgb, #000 35%, var(--farbe));
  border-radius: 12px;
  background: var(--farbe);
  color: var(--nacht);
}

.master.aus {
  --farbe: var(--blackout);
}

.master:hover:not(:disabled) {
  background: color-mix(in srgb, var(--kreide) 14%, var(--farbe));
}

.master:active:not(:disabled) {
  border-bottom-width: 2px;
  transform: translateY(4px);
}

.titel {
  font-family: var(--logo);
  font-size: 1.5rem;
  font-weight: 700;
  line-height: 1.1;
}

.hinweis {
  font-size: 0.85rem;
}

@media (max-width: 40rem) {
  .master {
    width: 7.5rem;
    min-height: 4rem;
    padding-inline: 0.5rem;
  }

  .titel {
    font-size: 1.05rem;
    text-align: center;
  }

  .hinweis {
    display: none;
  }
}
</style>
