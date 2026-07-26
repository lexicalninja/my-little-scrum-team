<template>
  <div class="adhoc-hero-gradient">
    <h1 v-if="title">{{ title }}</h1>
    <div class="content">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * HeroGradient Component
 * Full-width hero section with gradient background
 * Embodies Ad Hoc's "Sunrise" concept - optimism and new beginnings
 * 
 * Usage in markdown:
 * <HeroGradient title="Welcome to Our Documentation">
 *   Your content here...
 * </HeroGradient>
 */

interface Props {
  title?: string
}

defineProps<Props>()
</script>

<style scoped>
.content {
  font-size: 1.25rem;
  line-height: 1.6;
}

.content :deep(p) {
  color: rgba(255, 255, 255, 0.95);
  margin-bottom: 1.5rem;
}

.content :deep(a) {
  color: white;
  text-decoration: underline;
  font-weight: 600;
}

.content :deep(a:hover) {
  opacity: 0.9;
}
</style>
