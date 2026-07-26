<template>
  <div :class="['mls-gradient-accent', variant]" />
</template>

<script setup lang="ts">
/**
 * GradientAccent Component
 * Displays Ad Hoc's signature gradient accent bars
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
