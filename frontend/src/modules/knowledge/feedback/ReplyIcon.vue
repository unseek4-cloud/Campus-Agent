<script setup lang="ts">
defineProps<{ name: string }>()
const paths: Record<string, string[]> = {
  copy:['M9 8h10v13H9z','M15 8V3H4v13h5'],
  feedback:['M3 10h3v10H3z','M6 10l4-7h2v6h6l-1 11H6','M18 13h3v8h-3'],
  positive:['M3 10h3v10H3z','M6 10l4-7h2v6h8l-2 11H6z'],
  negative:['M3 4h3v10H3z','M6 14l4 7h2v-6h8L18 4H6z'],
  share:['M12 16V3','m7 8 5-5 5 5','M4 13v8h16v-8'],
  regenerate:['M20 10a8 8 0 0 0-14-4','M4 14a8 8 0 0 0 14 4','M20 3v7h-7','M4 21v-7h7'],
  more:['M5 12h.01','M12 12h.01','M19 12h.01'],
}
</script>
<template><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path v-for="d in paths[name]" :key="d" :d="d" /></svg></template>
