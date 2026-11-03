<script setup>
import { computed, ref } from "vue";

import { usePult } from "../stores/pult.js";
import DragHandle from "./DragHandle.vue";
import { useDragSort } from "./useDragSort.js";

const props = defineProps({
  project: { type: Object, required: true },
  selectedId: { type: String, default: null },
});
const emit = defineEmits(["select"]);

const pult = usePult();
const newName = ref("");

const isActiveProject = computed(() => pult.live.activeProjectId === props.project.id);
const sort = useDragSort(
  () => props.project.scenes.map((scene) => scene.id),
  (ids) => pult.reorder("scenes", props.project.id, ids)
);

function isLive(scene) {
  return isActiveProject.value && pult.live.activeSceneId === scene.id;
}

async function create() {
  const name = newName.value.trim();
  if (!name) return;
  const scene = await pult.createScene(props.project.id, name);
  if (scene) {
    newName.value = "";
    emit("select", scene.id);
  }
}
</script>

<template>
  <section class="cues" aria-label="Szenen">
    <ol>
      <li
        v-for="(scene, index) in project.scenes"
        :key="scene.id"
        v-bind="sort.item(scene.id)"
        class="cue"
        :class="{
          gewaehlt: scene.id === selectedId,
          live: isLive(scene),
          ziel: sort.over.value === scene.id,
        }"
      >
        <DragHandle
          v-if="project.scenes.length > 1"
          v-bind="sort.handle(scene.id)"
          label="Szene verschieben: ziehen oder Pfeiltasten"
        />
        <button class="auswahl" type="button" @click="emit('select', scene.id)">
          <span class="nummer" aria-hidden="true">{{ index + 1 }}</span>
          <span class="titel">{{ scene.name }}</span>
        </button>
        <span v-if="isLive(scene)" class="laeuft"><span class="licht"></span>Läuft</span>
        <button
          v-else
          class="taste taste-go zeigen"
          type="button"
          :disabled="!isActiveProject || !pult.online"
          :title="isActiveProject ? undefined : 'Aktiviere zuerst dieses Projekt'"
          @click="pult.activateScene(scene.id)"
        >
          Zeigen
        </button>
      </li>
    </ol>

    <p v-if="project.scenes.length === 0" class="leer">
      Dieses Projekt hat noch keine Szene. Lege unten die erste an.
    </p>

    <form class="neu" @submit.prevent="create">
      <label class="nur-sr" for="neue-szene">Name der neuen Szene</label>
      <input id="neue-szene" v-model="newName" class="feld" type="text" maxlength="200" placeholder="Neue Szene" />
      <button class="taste" type="submit" :disabled="!newName.trim()">Anlegen</button>
    </form>
  </section>
</template>

<style scoped>
.cues {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

ol {
  margin: 0;
  padding: 0;
  list-style: none;
}

.cue {
  display: flex;
  gap: 0.25rem;
  align-items: center;
  padding-right: 0.6rem;
  border: 1px solid transparent;
  border-left: 4px solid transparent;
  border-bottom-color: var(--kante);
}

.cue.gewaehlt {
  border-left-color: var(--standby);
  background: var(--pult);
}

.cue.live {
  border-left-color: var(--go);
  background: color-mix(in srgb, var(--go) 12%, var(--pult));
}

.cue.ziel {
  border-top-color: var(--standby);
}

.auswahl {
  display: flex;
  flex: 1;
  gap: 0.75rem;
  align-items: center;
  min-width: 0;
  padding: 0.55rem 0.5rem;
  border: 0;
  background: none;
  text-align: left;
}

.nummer {
  flex: none;
  width: 2.1rem;
  font-family: var(--stencil);
  font-size: 2rem;
  font-weight: 700;
  line-height: 1;
  text-align: right;
}

.titel {
  min-width: 0;
  overflow-wrap: anywhere;
}

.laeuft {
  display: inline-flex;
  flex: none;
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

.zeigen {
  flex: none;
}

.neu {
  display: flex;
  gap: 0.5rem;
}
</style>
