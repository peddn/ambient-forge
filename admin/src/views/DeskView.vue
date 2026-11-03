<script setup>
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";

import CueList from "../components/CueList.vue";
import PanelBox from "../components/PanelBox.vue";
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
  const remembered = isActive.value ? pult.live.activeSceneId : project.value.activeSceneId;
  return (
    scenes.find((entry) => entry.id === selectedSceneId.value) ||
    scenes.find((entry) => entry.id === remembered) ||
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
      <PanelBox :title="project.name">
        <template #aktionen>
          <RouterLink class="klein leise" :to="{ name: 'projects' }">Wechseln</RouterLink>
        </template>

        <div v-if="!isActive" class="inaktiv">
          <p>Die Anzeige zeigt gerade ein anderes Projekt.</p>
          <button class="taste taste-go" type="button" :disabled="!pult.online" @click="pult.activateProject(project.id)">
            Dieses Projekt aktivieren
          </button>
        </div>

        <CueList :project="project" :selected-id="scene && scene.id" @select="selectedSceneId = $event" />
      </PanelBox>
    </aside>

    <div class="arbeit">
      <SceneEditor v-if="scene" :key="scene.id" :scene="scene" :project-active="isActive" />
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
  grid-template-columns: minmax(18rem, 23rem) minmax(0, 1fr);
  gap: 1rem;
  align-items: start;
  padding: 1rem var(--abstand);
}

.spalte {
  position: sticky;
  top: 1rem;
  min-width: 0;
}

.inaktiv {
  display: grid;
  gap: 0.5rem;
  justify-items: start;
  margin-bottom: 0.75rem;
  padding: 0.65rem;
  border: 1px solid var(--standby);
  border-radius: var(--radius-klein);
}

.arbeit {
  min-width: 0;
}

@media (max-width: 52rem) {
  .pult {
    grid-template-columns: minmax(0, 1fr);
  }

  .spalte {
    position: static;
  }
}
</style>
