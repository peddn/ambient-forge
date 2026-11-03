<script setup>
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";

import ConfirmButton from "../components/ConfirmButton.vue";
import CueList from "../components/CueList.vue";
import InlineName from "../components/InlineName.vue";
import SceneEditor from "../components/SceneEditor.vue";
import { usePult } from "../stores/pult.js";

const props = defineProps({
  projectId: { type: String, default: null },
});

const pult = usePult();
const router = useRouter();

const newProject = ref("");
const selectedSceneId = ref(null);

const project = computed(() => {
  const wanted = props.projectId || pult.live.activeProjectId;
  return pult.projects.find((entry) => entry.id === wanted) || pult.projects[0] || null;
});
const isActive = computed(() => project.value && project.value.id === pult.live.activeProjectId);
const scene = computed(() => {
  if (!project.value) return null;
  const scenes = project.value.scenes;
  return (
    scenes.find((entry) => entry.id === selectedSceneId.value) ||
    scenes.find((entry) => entry.id === project.value.activeSceneId) ||
    scenes[0] ||
    null
  );
});

watch(
  () => project.value && project.value.id,
  () => {
    selectedSceneId.value = null;
  }
);

function openProject(id) {
  router.push({ name: "project", params: { projectId: id } });
}

async function createProject() {
  const name = newProject.value.trim();
  if (!name) return;
  const created = await pult.createProject(name);
  if (created) {
    newProject.value = "";
    openProject(created.id);
  }
}

async function removeProject() {
  if (await pult.deleteProject(project.value.id)) router.push({ name: "desk" });
}
</script>

<template>
  <div v-if="pult.projects.length === 0" class="start">
    <h1>Lege dein erstes Projekt an</h1>
    <p class="leise">Ein Projekt fasst die Szenen einer Kampagne oder eines Abends zusammen.</p>
    <form class="neu" @submit.prevent="createProject">
      <label class="nur-sr" for="erstes-projekt">Name des Projekts</label>
      <input
        id="erstes-projekt"
        v-model="newProject"
        class="feld"
        type="text"
        maxlength="200"
        placeholder="Zum Beispiel: Die Gruft von Wetterstein"
      />
      <button class="taste taste-go" type="submit" :disabled="!newProject.trim()">Projekt anlegen</button>
    </form>
  </div>

  <div v-else-if="project" class="pult">
    <aside class="spalte">
      <div class="projekt">
        <label class="klein leise" for="projektwahl">Projekt</label>
        <select
          id="projektwahl"
          class="feld"
          :value="project.id"
          @change="openProject($event.target.value)"
        >
          <option v-for="entry in pult.projects" :key="entry.id" :value="entry.id">
            {{ entry.name }}{{ entry.id === pult.live.activeProjectId ? " (aktiv)" : "" }}
          </option>
        </select>
      </div>

      <div v-if="!isActive" class="inaktiv">
        <p>Die Anzeige zeigt gerade ein anderes Projekt.</p>
        <button class="taste taste-go" type="button" :disabled="!pult.online" @click="pult.activateProject(project.id)">
          Dieses Projekt aktivieren
        </button>
      </div>

      <CueList :project="project" :selected-id="scene && scene.id" @select="selectedSceneId = $event" />

      <details class="projektverwaltung">
        <summary class="klein leise">Projekte verwalten</summary>
        <div class="verwaltung">
          <InlineName
            class="feld"
            :model-value="project.name"
            label="Name des Projekts"
            @commit="pult.renameProject(project.id, $event)"
          />
          <ConfirmButton label="Projekt löschen" @confirm="removeProject" />
          <form class="neu" @submit.prevent="createProject">
            <label class="nur-sr" for="neues-projekt">Name des neuen Projekts</label>
            <input
              id="neues-projekt"
              v-model="newProject"
              class="feld"
              type="text"
              maxlength="200"
              placeholder="Neues Projekt"
            />
            <button class="taste" type="submit" :disabled="!newProject.trim()">Anlegen</button>
          </form>
        </div>
      </details>
    </aside>

    <div class="arbeit">
      <SceneEditor v-if="scene" :key="scene.id" :scene="scene" />
      <p v-else class="leer">Lege links eine Szene an, dann kannst du hier Bilder und Soundspuren hinzufügen.</p>
    </div>
  </div>
</template>

<style scoped>
.start {
  display: grid;
  gap: 0.75rem;
  max-width: 34rem;
  margin: 12vh auto 0;
  padding: var(--abstand);
}

.neu {
  display: flex;
  gap: 0.5rem;
}

.pult {
  display: grid;
  grid-template-columns: minmax(18rem, 24rem) minmax(0, 1fr);
  min-height: 100%;
}

.spalte {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1rem var(--abstand);
  border-right: 1px solid var(--kante);
}

.projekt {
  display: grid;
  gap: 0.15rem;
}

.inaktiv {
  display: grid;
  gap: 0.5rem;
  justify-items: start;
  padding: 0.65rem;
  border: 1px solid var(--standby);
  border-radius: var(--radius-klein);
}

.projektverwaltung {
  margin-top: auto;
  padding-top: 1rem;
}

.projektverwaltung summary {
  cursor: pointer;
}

.verwaltung {
  display: grid;
  gap: 0.5rem;
  justify-items: start;
  margin-top: 0.5rem;
}

.verwaltung .neu {
  width: 100%;
}

.arbeit {
  min-width: 0;
  padding: 1rem var(--abstand) 2rem;
}

@media (max-width: 52rem) {
  .pult {
    grid-template-columns: minmax(0, 1fr);
  }

  .spalte {
    border-right: 0;
    border-bottom: 1px solid var(--kante);
  }
}
</style>
