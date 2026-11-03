<script setup>
import { computed } from "vue";

import { assetUrl } from "../api.js";
import ConfirmButton from "../components/ConfirmButton.vue";
import { usePult } from "../stores/pult.js";

const pult = usePult();

const usedIds = computed(() => {
  const ids = new Set(pult.effects.map((effect) => effect.assetId));
  pult.projects.forEach((project) =>
    project.scenes.forEach((scene) => {
      scene.images.forEach((image) => ids.add(image.assetId));
      scene.tracks.forEach((track) => ids.add(track.assetId));
    })
  );
  return ids;
});

const images = computed(() => pult.assets.filter((asset) => asset.kind === "image"));
const sounds = computed(() => pult.assets.filter((asset) => asset.kind === "audio"));

function size(bytes) {
  const megabytes = bytes / (1024 * 1024);
  return megabytes < 1
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${megabytes.toFixed(1).replace(".", ",")} MB`;
}
</script>

<template>
  <div class="seite">
    <div>
      <h1>Dateien</h1>
      <p class="leise">Hier liegen alle hochgeladenen Medien. Verwendete Dateien lassen sich nicht löschen.</p>
    </div>

    <p v-if="pult.assets.length === 0" class="leer">
      Noch keine Dateien. Lade Bilder und Spuren direkt in einer Szene hoch.
    </p>

    <section v-if="images.length > 0">
      <h2>Bilder</h2>
      <ul class="kacheln">
        <li v-for="asset in images" :key="asset.id">
          <img :src="assetUrl(asset.id)" alt="" loading="lazy" />
          <p class="klein name">{{ asset.name }}</p>
          <p class="klein leise">{{ size(asset.sizeBytes) }}</p>
          <ConfirmButton
            :disabled="usedIds.has(asset.id)"
            :title="usedIds.has(asset.id) ? 'Wird noch verwendet' : undefined"
            @confirm="pult.deleteAsset(asset.id)"
          />
        </li>
      </ul>
    </section>

    <section v-if="sounds.length > 0">
      <h2>Audiodateien</h2>
      <ul class="zeilen">
        <li v-for="asset in sounds" :key="asset.id">
          <div>
            <p class="name">{{ asset.name }}</p>
            <p class="klein leise">{{ size(asset.sizeBytes) }}</p>
          </div>
          <audio :src="assetUrl(asset.id)" controls preload="none"></audio>
          <ConfirmButton
            :disabled="usedIds.has(asset.id)"
            :title="usedIds.has(asset.id) ? 'Wird noch verwendet' : undefined"
            @confirm="pult.deleteAsset(asset.id)"
          />
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
ul {
  margin: 0.5rem 0 0;
  padding: 0;
  list-style: none;
}

.kacheln {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
  gap: 0.75rem;
}

.kacheln li {
  display: grid;
  gap: 0.25rem;
  justify-items: start;
}

.kacheln img {
  display: block;
  width: 100%;
  aspect-ratio: 16 / 9;
  object-fit: cover;
  border-radius: var(--radius-klein);
}

.name {
  overflow-wrap: anywhere;
}

.zeilen li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 18rem) auto;
  gap: 1rem;
  align-items: center;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--kante);
}

.zeilen audio {
  width: 100%;
  height: 2.25rem;
}

@media (max-width: 40rem) {
  .zeilen li {
    grid-template-columns: minmax(0, 1fr);
    justify-items: start;
  }
}
</style>
