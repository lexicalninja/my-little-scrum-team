<template>
  <div :class="['mlst-gradient-accent', variant]" />
</template>

<script setup lang="ts">
/**
 * GradientAccent Component
 * Displays the MLST gradient accent bars
 * 
 * Usage in markdown:
 * <GradientAccent />
 * <GradientAccent variant="sunset" />
 * <GradientAccent variant="spring" />
 */

interface Props {
  variant?: 'sunrise' | 'sunset' | 'spring' | 'summer' | 'fall' | 'winter'
}

withDefaults(defineProps<Props>(), {
  variant: 'sunrise'
})
</script>

<style scoped>
/* Styles are defined in custom.css */
</style>
