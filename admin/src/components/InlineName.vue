<script setup>
import { ref, watch } from "vue";

const props = defineProps({
  modelValue: { type: String, required: true },
  label: { type: String, required: true },
});
const emit = defineEmits(["commit"]);

const draft = ref(props.modelValue);

watch(
  () => props.modelValue,
  (value) => {
    draft.value = value;
  }
);

function commit() {
  const value = draft.value.trim();
  if (value && value !== props.modelValue) {
    emit("commit", value);
  } else {
    draft.value = props.modelValue;
  }
}

function cancel(event) {
  draft.value = props.modelValue;
  event.target.blur();
}
</script>

<template>
  <input
    v-model="draft"
    class="name"
    type="text"
    maxlength="200"
    :aria-label="label"
    @blur="commit"
    @keydown.enter="$event.target.blur()"
    @keydown.esc="cancel"
  />
</template>

<style scoped>
.name {
  width: 100%;
  min-width: 0;
  padding: 0.15rem 0.3rem;
  border: 1px solid transparent;
  border-radius: var(--radius-klein);
  background: transparent;
}

.name:hover {
  border-color: var(--kante);
}

.name:focus {
  border-color: var(--arbeitslicht);
  background: var(--nacht);
}
</style>
