<template>
  <div class="adhoc-color-grid">
    <div
      v-for="color in colors"
      :key="color.name"
      :style="{ backgroundColor: color.hex }"
      class="adhoc-color-swatch"
    >
      <span>{{ color.name }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * ColorPalette Component
 * Displays Ad Hoc color swatches from brand guidelines
 * 
 * Usage in markdown:
 * <ColorPalette palette="core" />
 * <ColorPalette palette="monarch" />
 * <ColorPalette palette="finch" />
 */

interface Color {
  name: string
  hex: string
}

interface Props {
  palette: 'core' | 'grays' | 'monarch' | 'finch' | 'ocean' | 'lavender' | 'hibiscus'
}

const props = defineProps<Props>()

const palettes: Record<string, Color[]> = {
  core: [
    { name: 'Medium', hex: '#31B67B' },
    { name: 'Dark', hex: '#118762' },
    { name: 'Light', hex: '#cdecdb' }
  ],
  grays: [
    { name: 'Gray 2', hex: '#EDEDED' },
    { name: 'Gray 5', hex: '#A4A4A4' },
    { name: 'Gray 8', hex: '#5F5F5F' }
  ],
  monarch: [
    { name: 'M1', hex: '#FFF9F2' },
    { name: 'M3', hex: '#FFCB92' },
    { name: 'M5', hex: '#FC8400' },
    { name: 'M7', hex: '#B05C00' },
    { name: 'M9', hex: '#743D00' }
  ],
  finch: [
    { name: 'F1', hex: '#FFFAEB' },
    { name: 'F3', hex: '#FFCC50' },
    { name: 'F5', hex: '#DD960E' },
    { name: 'F7', hex: '#9C670A' },
    { name: 'F9', hex: '#694305' }
  ],
  ocean: [
    { name: 'O1', hex: '#EDFDFF' },
    { name: 'O3', hex: '#44E8FF' },
    { name: 'O5', hex: '#0BB4D1' },
    { name: 'O7', hex: '#0A7D94' },
    { name: 'O9', hex: '#075264' }
  ],
  lavender: [
    { name: 'L1', hex: '#F9FAFE' },
    { name: 'L3', hex: '#CFD2F7' },
    { name: 'L5', hex: '#999EEB' },
    { name: 'L7', hex: '#6268CA' },
    { name: 'L9', hex: '#48447F' }
  ],
  hibiscus: [
    { name: 'H1', hex: '#FFF8FC' },
    { name: 'H3', hex: '#FAC5E6' },
    { name: 'H5', hex: '#F07BCE' },
    { name: 'H7', hex: '#B9429F' },
    { name: 'H9', hex: '#752F70' }
  ]
}

const colors = palettes[props.palette] || palettes.core
</script>

<style scoped>
/* Grid styles are defined in custom.css */
</style>
