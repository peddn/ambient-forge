<script setup>
defineProps({
  title: { type: String, default: null },
});
</script>

<template>
  <section class="panel" :aria-label="title">
    <header v-if="title || $slots.aktionen" class="panel-kopf">
      <h2 v-if="title">{{ title }}</h2>
      <div v-if="$slots.aktionen" class="aktionen"><slot name="aktionen" /></div>
    </header>
    <div class="panel-inhalt"><slot /></div>
  </section>
</template>

<style scoped>
.panel {
  border: 1px solid var(--kante);
  border-radius: var(--radius-taste);
  background: var(--pult);
}

.panel-kopf {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1rem;
  align-items: center;
  justify-content: space-between;
  min-height: 3.25rem;
  padding: 0.5rem 1rem;
  border-bottom: 1px solid var(--kante);
}

.aktionen {
  margin-left: auto;
}

.panel-inhalt {
  padding: 1rem;
}
</style>
