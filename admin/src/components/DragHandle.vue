<script setup>
defineProps({
  label: { type: String, required: true },
});
</script>

<template>
  <!-- Ein span, weil Firefox Buttons nicht ziehen lässt. -->
  <span class="griff" role="button" tabindex="0" :aria-label="label" :title="label">
    <svg viewBox="0 0 8 14" width="8" height="14" fill="currentColor" aria-hidden="true">
      <circle cx="1.5" cy="2" r="1.5" />
      <circle cx="6.5" cy="2" r="1.5" />
      <circle cx="1.5" cy="7" r="1.5" />
      <circle cx="6.5" cy="7" r="1.5" />
      <circle cx="1.5" cy="12" r="1.5" />
      <circle cx="6.5" cy="12" r="1.5" />
    </svg>
  </span>
</template>

<style scoped>
.griff {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 2rem;
  border-radius: var(--radius-klein);
  color: var(--arbeitslicht);
  cursor: grab;
}

.griff:hover {
  background: var(--pult-hell);
  color: var(--kreide);
}

.griff:active {
  cursor: grabbing;
}
</style>
