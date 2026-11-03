<script setup>
import { computed } from "vue";

import { usePult } from "../stores/pult.js";

const pult = usePult();
const on = computed(() => pult.live.masterOn);
</script>

<template>
  <button
    class="master"
    :class="{ aus: !on }"
    type="button"
    role="switch"
    :aria-checked="on"
    aria-label="Master: Bild und Ton aller Anzeigen"
    :disabled="!pult.online"
    @click="pult.setMaster(!on)"
  >
    <span class="schild">Master</span>
    <span class="wert">{{ on ? "An" : "Aus" }}</span>
    <span class="hinweis">{{ on ? "Bild und Ton laufen" : "Alles ist dunkel" }}</span>
  </button>
</template>

<style scoped>
.master {
  display: grid;
  flex: none;
  grid-template-columns: auto 1fr;
  grid-template-rows: auto auto;
  column-gap: 0.75rem;
  align-items: baseline;
  width: 13.5rem;
  padding: 0.7rem 1rem;
  border: 0;
  border-left: 1px solid var(--kante);
  background: color-mix(in srgb, var(--go) 16%, var(--pult));
  text-align: left;
  transition: background-color 120ms linear;
}

.master:hover:not(:disabled) {
  background: color-mix(in srgb, var(--go) 26%, var(--pult));
}

.master.aus {
  background: var(--blackout);
  color: var(--nacht);
}

.master.aus:hover:not(:disabled) {
  background: color-mix(in srgb, var(--blackout) 86%, var(--kreide));
}

.schild {
  font-family: var(--stencil);
  font-size: 2rem;
  font-weight: 700;
  line-height: 1;
}

.wert {
  font-family: var(--stencil);
  font-size: 2.6rem;
  font-weight: 700;
  line-height: 1;
  text-align: right;
}

.hinweis {
  grid-column: 1 / -1;
  margin-top: 0.2rem;
  font-size: 0.85rem;
}

@media (max-width: 40rem) {
  .master {
    width: 7rem;
    padding: 0.5rem 0.65rem;
  }

  .schild {
    display: none;
  }

  .hinweis {
    display: none;
  }

  .wert {
    grid-column: 1 / -1;
    text-align: center;
  }
}
</style>
