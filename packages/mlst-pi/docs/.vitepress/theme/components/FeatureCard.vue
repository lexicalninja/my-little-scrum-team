<template>
  <div :class="['mlst-feature-card', variant]">
    <h3 v-if="title">{{ title }}</h3>
    <div class="content">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * FeatureCard Component
 * Card with a gradient top accent, keyed to the seasonal palette variants
 * 
 * Usage in markdown:
 * <FeatureCard title="New Feature" variant="sunset">
 *   Description of the feature...
 * </FeatureCard>
 */

interface Props {
  title?: string
  variant?: 'default' | 'sunset' | 'spring' | 'winter'
}

withDefaults(defineProps<Props>(), {
  variant: 'default'
})
</script>

<style scoped>
h3 {
  margin-top: 0;
  font-size: 1.563rem;
  font-weight: 800;
}

.content {
  font-size: 1rem;
  line-height: 1.6;
}

.content :deep(p:last-child) {
  margin-bottom: 0;
}
</style>
