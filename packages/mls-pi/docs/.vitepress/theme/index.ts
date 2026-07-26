// .vitepress/theme/index.ts
import { h } from 'vue'
import type { Theme } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import './custom.css'

// Import custom components
import GradientAccent from './components/GradientAccent.vue'
import FeatureCard from './components/FeatureCard.vue'

export default {
  extends: DefaultTheme,
  Layout: () => {
    return h(DefaultTheme.Layout, null, {
      // Custom layout slots
      // Add a gradient accent at the top of every page
      'layout-top': () => h('div', { class: 'mls-gradient-accent' })
    })
  },
  enhanceApp({ app, router, siteData }) {
    // Register custom components globally for use in markdown
    app.component('GradientAccent', GradientAccent)
    app.component('FeatureCard', FeatureCard)
  }
} satisfies Theme
