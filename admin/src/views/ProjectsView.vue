<script setup>
import { ref } from "vue";
import { useRouter } from "vue-router";

import ConfirmButton from "../components/ConfirmButton.vue";
import InlineName from "../components/InlineName.vue";
import PanelBox from "../components/PanelBox.vue";
import { usePult } from "../stores/pult.js";

const pult = usePult();
const router = useRouter();
const newName = ref("");

const isActive = (project) => project.id === pult.live.activeProjectId;
const sceneCount = (project) =>
  project.scenes.length === 1 ? "1 Szene" : `${project.scenes.length} Szenen`;

function open(project) {
  router.push({ name: "project", params: { projectId: project.id } });
}

async function create() {
  const name = newName.value.trim();
  if (!name) return;
  const project = await pult.createProject(name);
  if (project) {
    newName.value = "";
    open(project);
  }
}
</script>

<template>
  <div class="seite">
    <div>
      <h1>Projekte</h1>
      <p class="leise">Ein Projekt fasst die Szenen einer Kampagne zusammen. Die Anzeige zeigt immer das aktive Projekt.</p>
    </div>

    <PanelBox title="Neues Projekt">
      <form class="neu" @submit.prevent="create">
        <label class="nur-sr" for="neues-projekt">Name des neuen Projekts</label>
        <input
          id="neues-projekt"
          v-model="newName"
          class="feld"
          type="text"
          maxlength="200"
          placeholder="Zum Beispiel: Die Gruft von Wetterstein"
        />
        <button class="taste taste-go" type="submit" :disabled="!newName.trim()">Projekt anlegen</button>
      </form>
    </PanelBox>

    <PanelBox title="Alle Projekte">
      <p v-if="pult.projects.length === 0" class="leer">Noch keine Projekte. Lege oben das erste an.</p>
      <ul v-else class="liste">
        <li v-for="project in pult.projects" :key="project.id" :class="{ aktiv: isActive(project) }">
          <InlineName
            class="name"
            :model-value="project.name"
            label="Name des Projekts"
            @commit="pult.renameProject(project.id, $event)"
          />
          <span class="klein leise">{{ sceneCount(project) }}</span>
          <span v-if="isActive(project)" class="laeuft"><span class="licht"></span>Aktiv</span>
          <button
            v-else
            class="taste taste-go"
            type="button"
            :disabled="!pult.online"
            @click="pult.activateProject(project.id)"
          >
            Aktivieren
          </button>
          <button class="taste" type="button" @click="open(project)">Szenen öffnen</button>
          <ConfirmButton
            :title="isActive(project) ? 'Die Anzeige zeigt danach den Wartebildschirm' : undefined"
            @confirm="pult.deleteProject(project.id)"
          />
        </li>
      </ul>
    </PanelBox>
  </div>
</template>

<style scoped>
.neu {
  display: flex;
  gap: 0.5rem;
}

.liste {
  margin: 0;
  padding: 0;
  list-style: none;
}

.liste li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 5.5rem 6.5rem auto 9.5rem;
  gap: 0.5rem 0.75rem;
  align-items: center;
  padding: 0.6rem 0.25rem;
}

.liste li + li {
  border-top: 1px solid var(--kante);
}

.name {
  font-weight: 700;
}

.laeuft {
  display: inline-flex;
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

@media (max-width: 44rem) {
  .liste li {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .name {
    grid-column: 1 / -1;
  }
}
</style>
