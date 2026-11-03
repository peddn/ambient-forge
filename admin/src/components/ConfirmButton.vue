<script setup>
import { onBeforeUnmount, ref } from "vue";

const CONFIRM_MS = 4000;

defineProps({
  label: { type: String, default: "Löschen" },
  confirmLabel: { type: String, default: "Wirklich löschen?" },
  disabled: { type: Boolean, default: false },
  title: { type: String, default: undefined },
});
const emit = defineEmits(["confirm"]);

const asking = ref(false);
let timer = null;

function click() {
  if (asking.value) {
    clearTimeout(timer);
    asking.value = false;
    emit("confirm");
    return;
  }
  asking.value = true;
  timer = setTimeout(() => {
    asking.value = false;
  }, CONFIRM_MS);
}

onBeforeUnmount(() => clearTimeout(timer));
</script>

<template>
  <button
    class="taste"
    :class="{ 'taste-rot': asking }"
    type="button"
    :disabled="disabled"
    :title="title"
    @click="click"
  >
    {{ asking ? confirmLabel : label }}
  </button>
</template>
