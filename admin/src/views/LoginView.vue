<script setup>
import { ref } from "vue";
import { useRouter } from "vue-router";

import { usePult } from "../stores/pult.js";

const pult = usePult();
const router = useRouter();

const password = ref("");
const error = ref(null);
const busy = ref(false);

async function submit() {
  busy.value = true;
  error.value = null;
  try {
    await pult.login(password.value);
    router.push({ name: "desk" });
  } catch (failure) {
    error.value =
      failure.code === "unauthorized"
        ? "Das Passwort stimmt nicht. Ein neues erzeugt der Start mit --reset-password."
        : "Der Server antwortet nicht. Läuft er noch?";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <main class="anmeldung">
    <form @submit.prevent="submit">
      <h1>Ambient Forge</h1>
      <label for="passwort">Passwort des Spielleiters</label>
      <input
        id="passwort"
        v-model="password"
        class="feld"
        type="password"
        autocomplete="current-password"
        autofocus
      />
      <p v-if="error" class="fehler" role="alert">{{ error }}</p>
      <button class="taste taste-go" type="submit" :disabled="busy || !password">Anmelden</button>
    </form>
  </main>
</template>

<style scoped>
.anmeldung {
  display: grid;
  height: 100%;
  overflow: auto;
  padding: var(--abstand);
  place-items: center;
}

form {
  display: grid;
  gap: 0.75rem;
  width: min(24rem, 100%);
}

h1 {
  font-family: var(--logo);
  font-size: 2.5rem;
  line-height: 1.1;
}

.fehler {
  color: var(--standby);
}

.taste {
  justify-self: start;
}
</style>
