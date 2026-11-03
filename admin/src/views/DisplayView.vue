<script setup>
import QRCode from "qrcode";
import { computed, ref, watch } from "vue";

import ConfirmButton from "../components/ConfirmButton.vue";
import { MASTER_STOPS_MS, formatDuration } from "../components/durations.js";
import PanelBox from "../components/PanelBox.vue";
import SliderField from "../components/SliderField.vue";
import { usePult } from "../stores/pult.js";

const pult = usePult();
const link = computed(() => pult.live.link);
const qr = ref("");
const copied = ref(false);

watch(
  () => link.value.url,
  async (url) => {
    qr.value = url
      ? await QRCode.toString(url, {
          type: "svg",
          margin: 2,
          color: { dark: "#0f1730", light: "#eef1e6" },
        })
      : "";
  },
  { immediate: true }
);

function copyFallback(text) {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  const success = document.execCommand("copy");
  area.remove();
  return success;
}

// navigator.clipboard fehlt, wenn das Pult über eine LAN-IP läuft.
async function copy() {
  let success = false;
  if (navigator.clipboard) {
    success = await navigator.clipboard.writeText(link.value.url).then(
      () => true,
      () => false
    );
  }
  if (!success) success = copyFallback(link.value.url);
  if (success) {
    copied.value = true;
    setTimeout(() => {
      copied.value = false;
    }, 2000);
  } else {
    pult.showNotice("Kopieren ging nicht. Markiere den Link und kopiere ihn von Hand.");
  }
}

function loadText(display) {
  if (display.total > 0 && display.loaded < display.total) {
    return `Lädt ${display.loaded} von ${display.total} Dateien`;
  }
  return display.sceneState === "error" ? "Szene mit Fehlern" : "Geladen";
}
</script>

<template>
  <div class="seite">
    <div>
      <h1>Anzeige</h1>
      <p class="leise">Öffne den Link in einem Browser im selben Netzwerk, zum Beispiel am Fernseher oder Beamer.</p>
    </div>

    <PanelBox title="Anzeige-Link">
      <div class="link" :class="{ gesperrt: !link.enabled }">
      <div class="qr" aria-hidden="true" v-html="qr"></div>
      <div class="linkdaten">
        <p v-if="!link.enabled" class="warnung">Der Link ist deaktiviert. Anzeigen zeigen nur einen Hinweis.</p>
        <input class="feld" type="text" readonly :value="link.url" aria-label="Anzeige-Link" @focus="$event.target.select()" />
        <div class="tasten">
          <button class="taste" type="button" @click="copy">{{ copied ? "Kopiert" : "Link kopieren" }}</button>
          <button class="taste" type="button" @click="pult.updateLink({ enabled: !link.enabled })">
            {{ link.enabled ? "Link deaktivieren" : "Link aktivieren" }}
          </button>
          <ConfirmButton
            label="Link erneuern"
            confirm-label="Alter Link wird ungültig. Erneuern?"
            @confirm="pult.renewLink()"
          />
        </div>
        <label v-if="link.hosts.length > 1" class="adresse">
          <span class="klein leise">Netzwerkadresse des Links</span>
          <select
            class="feld"
            :value="link.host || ''"
            @change="pult.updateLink({ host: $event.target.value || null })"
          >
            <option value="">Automatisch</option>
            <option v-for="host in link.hosts" :key="host" :value="host">{{ host }}</option>
          </select>
        </label>
      </div>
      </div>
    </PanelBox>

    <PanelBox title="Verbundene Anzeigen">
      <p v-if="pult.live.displays.length === 0" class="leer">
        Noch keine Anzeige verbunden. Sobald jemand den Link öffnet, erscheint sie hier.
      </p>
      <ul v-else class="anzeigen">
        <li v-for="display in pult.live.displays" :key="display.connectionId">
          <span class="licht" :class="{ an: display.audio === 'running' }" aria-hidden="true"></span>
          <div>
            <p class="name">{{ display.client }}</p>
            <p class="klein leise">
              {{ display.audio === "running" ? "Gestartet" : "Wartet auf den Klick auf Anzeige starten" }}.
              {{ loadText(display) }}<span v-if="display.rttMs !== null">. {{ display.rttMs }} ms Laufzeit</span>
            </p>
            <p v-for="error in display.errors" :key="error.assetId" class="klein warnung">
              {{ pult.assets.find((asset) => asset.id === error.assetId)?.name || error.assetId }}: {{ error.reason }}
            </p>
          </div>
        </li>
      </ul>
    </PanelBox>

    <PanelBox title="Master">
      <div class="fade">
      <SliderField
        label="Dauer der Aus- und Einblendung"
        :value="pult.live.masterFadeMs"
        :stops="MASTER_STOPS_MS"
        :format="formatDuration"
        :commit="pult.setMasterFade"
      />
      </div>
    </PanelBox>
  </div>
</template>

<style scoped>
.link {
  display: flex;
  flex-wrap: wrap;
  gap: 1.25rem;
}

.link.gesperrt .qr {
  opacity: 0.3;
}

.qr {
  flex: none;
  width: 11rem;
  height: 11rem;
}

.qr :deep(svg) {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: var(--radius-klein);
}

.linkdaten {
  display: grid;
  flex: 1 1 18rem;
  gap: 0.6rem;
  align-content: start;
  min-width: 0;
}

.tasten {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.adresse {
  display: grid;
  gap: 0.15rem;
  max-width: 20rem;
}

.warnung {
  color: var(--standby);
}

.anzeigen {
  margin: 0;
  padding: 0;
  list-style: none;
}

.anzeigen li {
  display: flex;
  gap: 0.75rem;
  align-items: baseline;
  padding: 0.5rem 0;
}

.anzeigen li + li {
  border-top: 1px solid var(--kante);
}

.licht {
  flex: none;
  width: 0.7rem;
  height: 0.7rem;
  border-radius: 50%;
  background: var(--standby);
}

.licht.an {
  background: var(--go);
}

.name {
  font-weight: 700;
}

.fade {
  max-width: 24rem;
}
</style>
