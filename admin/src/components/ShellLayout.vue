<script setup>
import { usePult } from "../stores/pult.js";
import EffectRail from "./EffectRail.vue";
import MasterSwitch from "./MasterSwitch.vue";

const pult = usePult();
</script>

<template>
  <div class="shell" :class="{ dunkel: !pult.live.masterOn }">
    <header class="kopf">
      <RouterLink class="marke" :to="{ name: 'desk' }">Ambient Forge</RouterLink>

      <nav aria-label="Hauptmenü">
        <RouterLink :to="{ name: 'desk' }">Pult</RouterLink>
        <RouterLink :to="{ name: 'effects' }">Effekte</RouterLink>
        <RouterLink :to="{ name: 'files' }">Dateien</RouterLink>
        <RouterLink :to="{ name: 'display' }">Anzeige</RouterLink>
      </nav>

      <RouterLink class="status" :class="pult.displaySummary.tone" :to="{ name: 'display' }">
        <span class="licht" aria-hidden="true"></span>
        {{ pult.online ? pult.displaySummary.text : "Keine Verbindung zum Server" }}
      </RouterLink>

      <button class="abmelden" type="button" @click="pult.logout()">Abmelden</button>
    </header>

    <main class="inhalt">
      <RouterView />
    </main>

    <p v-if="pult.notice" class="meldung" role="alert">{{ pult.notice }}</p>

    <footer class="fuss">
      <EffectRail />
      <MasterSwitch />
    </footer>
  </div>
</template>

<style scoped>
.shell {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: auto minmax(0, 1fr) auto;
  height: 100dvh;
}

/* Bei ausgeschaltetem Master liegt ein roter Rahmen um das ganze Pult. */
.shell.dunkel::after {
  position: absolute;
  z-index: 30;
  inset: 0;
  border: 4px solid var(--blackout);
  content: "";
  pointer-events: none;
}

.kopf {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 1.25rem;
  align-items: center;
  padding: 0.5rem var(--abstand);
  border-bottom: 1px solid var(--kante);
  background: var(--pult);
}

.marke {
  font-family: var(--stencil);
  font-size: 1.6rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-decoration: none;
}

nav {
  display: flex;
  gap: 0.25rem;
}

nav a {
  padding: 0.3rem 0.65rem;
  border-radius: var(--radius-klein);
  color: var(--arbeitslicht);
  text-decoration: none;
}

nav a:hover {
  color: var(--kreide);
}

nav a.router-link-exact-active {
  background: var(--pult-hell);
  color: var(--kreide);
}

.status {
  display: inline-flex;
  gap: 0.5rem;
  align-items: center;
  margin-left: auto;
  text-decoration: none;
}

.licht {
  width: 0.7rem;
  height: 0.7rem;
  border-radius: 50%;
  background: var(--standby);
}

.status.ok .licht {
  background: var(--go);
}

.abmelden {
  padding: 0.25rem 0.5rem;
  border: 0;
  background: none;
  color: var(--arbeitslicht);
}

.abmelden:hover {
  color: var(--kreide);
}

.inhalt {
  min-height: 0;
  overflow: auto;
}

.meldung {
  position: absolute;
  z-index: 20;
  right: var(--abstand);
  bottom: 7.5rem;
  max-width: min(32rem, calc(100% - 2rem));
  padding: 0.65rem 0.9rem;
  border: 1px solid var(--standby);
  border-radius: var(--radius-klein);
  background: var(--pult-hell);
}

.fuss {
  display: flex;
  align-items: stretch;
  border-top: 1px solid var(--kante);
  background: var(--pult);
}
</style>
