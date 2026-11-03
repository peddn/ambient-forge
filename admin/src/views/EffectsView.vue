<script setup>
import AddFiles from "../components/AddFiles.vue";
import ConfirmButton from "../components/ConfirmButton.vue";
import InlineName from "../components/InlineName.vue";
import { moved, useDragSort } from "../components/useDragSort.js";
import { usePult } from "../stores/pult.js";

const pult = usePult();
const sort = useDragSort((from, to) => {
  const ids = pult.effects.map((effect) => effect.id);
  pult.reorder("effects", null, moved(ids, from, to));
});
</script>

<template>
  <div class="seite">
    <div class="zeile">
      <div>
        <h1>Effekte</h1>
        <p class="leise">Effekte gehören zu keinem Projekt. Die Tasten unten funktionieren in jeder Ansicht.</p>
      </div>
      <AddFiles kind="audio" label="Effekte hochladen" @picked="pult.createEffect($event)" />
    </div>

    <p v-if="pult.effects.length === 0" class="leer">Lade eine Audiodatei hoch, und sie erscheint als Taste unten.</p>

    <ul v-else class="liste">
      <li
        v-for="effect in pult.effects"
        :key="effect.id"
        v-bind="sort.handlers(effect.id)"
        :class="{ ziel: sort.over.value === effect.id }"
      >
        <InlineName
          class="name"
          :model-value="effect.name"
          label="Name des Effekts"
          @commit="pult.updateEffect(effect.id, { name: $event })"
        />
        <label class="regler">
          <span class="klein leise">Lautstärke {{ Math.round(effect.volume * 100) }} %</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            :value="effect.volume"
            @change="pult.updateEffect(effect.id, { volume: Number($event.target.value) })"
          />
        </label>
        <ConfirmButton @confirm="pult.deleteEffect(effect.id)" />
      </li>
    </ul>
  </div>
</template>

<style scoped>
.zeile {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem 1.5rem;
  align-items: flex-end;
  justify-content: space-between;
}

.liste {
  margin: 0;
  padding: 0;
  list-style: none;
}

.liste li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(10rem, 16rem) auto;
  gap: 1rem;
  align-items: center;
  padding: 0.6rem 0;
  border-bottom: 1px solid var(--kante);
}

.liste li.ziel {
  border-top: 1px solid var(--standby);
}

.name {
  font-weight: 700;
}

.regler {
  display: grid;
  gap: 0.1rem;
}

.regler input {
  width: 100%;
  margin: 0;
  accent-color: var(--go);
}

@media (max-width: 40rem) {
  .liste li {
    grid-template-columns: minmax(0, 1fr);
    justify-items: start;
  }

  .regler {
    width: 100%;
  }
}
</style>
