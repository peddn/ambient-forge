<script setup>
import { computed, ref } from "vue";

import { assetUrl } from "../api.js";
import { usePult } from "../stores/pult.js";

const props = defineProps({
  kind: { type: String, required: true },
  label: { type: String, required: true },
});
const emit = defineEmits(["picked"]);

const pult = usePult();
const input = ref(null);
const dialog = ref(null);
const progress = ref(null);

const accept = computed(() =>
  props.kind === "image"
    ? "image/jpeg,image/png,image/webp"
    : "audio/wav,audio/mpeg,audio/ogg,audio/opus,audio/flac,.wav,.mp3,.ogg,.opus,.flac"
);
const existing = computed(() => pult.assets.filter((asset) => asset.kind === props.kind));

async function uploadAll(files) {
  const list = Array.from(files);
  for (const [index, file] of list.entries()) {
    const prefix = list.length > 1 ? `${index + 1} von ${list.length}: ` : "";
    progress.value = `${prefix}${file.name}`;
    const asset = await pult.upload(file, (share) => {
      progress.value = `${prefix}${file.name} (${Math.round(share * 100)} %)`;
    });
    if (asset && asset.kind !== props.kind) {
      pult.showNotice(`${file.name} passt hier nicht. Gesucht ist ${props.kind === "image" ? "ein Bild" : "eine Audiodatei"}.`);
    } else if (asset) {
      emit("picked", asset);
    }
  }
  progress.value = null;
}

function onFiles(event) {
  uploadAll(event.target.files);
  event.target.value = "";
}

function pick(asset) {
  dialog.value.close();
  emit("picked", asset);
}

defineExpose({ uploadAll });
</script>

<template>
  <div class="hinzufuegen">
    <input ref="input" class="nur-sr" type="file" multiple :accept="accept" tabindex="-1" @change="onFiles" />
    <button class="taste" type="button" :disabled="progress !== null" @click="input.click()">
      {{ label }}
    </button>
    <button
      v-if="existing.length > 0"
      class="taste"
      type="button"
      :disabled="progress !== null"
      @click="dialog.showModal()"
    >
      Aus Dateien wählen
    </button>
    <span v-if="progress" class="leise klein" role="status">Lade hoch: {{ progress }}</span>

    <dialog ref="dialog">
      <div class="kopfzeile">
        <h2>{{ kind === "image" ? "Bild wählen" : "Audiodatei wählen" }}</h2>
        <button class="taste" type="button" @click="dialog.close()">Schließen</button>
      </div>
      <ul :class="kind === 'image' ? 'bilder' : 'zeilen'">
        <li v-for="asset in existing" :key="asset.id">
          <button type="button" @click="pick(asset)">
            <img v-if="kind === 'image'" :src="assetUrl(asset.id)" alt="" loading="lazy" />
            <span>{{ asset.name }}</span>
          </button>
        </li>
      </ul>
    </dialog>
  </div>
</template>

<style scoped>
.hinzufuegen {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}

dialog {
  width: min(44rem, calc(100vw - 2rem));
  max-height: 80vh;
  padding: 1rem;
  border: 1px solid var(--kante);
  border-radius: var(--radius-taste);
  background: var(--pult);
  color: var(--kreide);
}

dialog::backdrop {
  background: rgb(5 8 20 / 70%);
}

.kopfzeile {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.75rem;
}

ul {
  margin: 0;
  padding: 0;
  list-style: none;
}

.bilder {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
  gap: 0.5rem;
}

.zeilen li + li {
  margin-top: 0.25rem;
}

li button {
  display: block;
  width: 100%;
  padding: 0.4rem;
  border: 1px solid var(--kante);
  border-radius: var(--radius-klein);
  background: var(--nacht);
  overflow-wrap: anywhere;
  text-align: left;
}

li button:hover {
  border-color: var(--arbeitslicht);
}

li img {
  display: block;
  width: 100%;
  aspect-ratio: 16 / 9;
  margin-bottom: 0.25rem;
  object-fit: cover;
}
</style>
