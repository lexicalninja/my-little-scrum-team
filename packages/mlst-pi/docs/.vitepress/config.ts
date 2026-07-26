import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'MLST User Guide',
  description: 'Multi-agent orchestration for pi.dev',
  // Served from a subpath so the repo's Pages root stays free for other docs.
  // The deploy workflow stages this build into an `mlst-pi/` directory before
  // upload — the two must stay in sync or every asset 404s.
  base: '/my-little-scrum-team/mlst-pi/',
  
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/' },
      { text: 'Advanced', link: '/advanced/' },
      { text: 'Reference', link: '/reference/' },
      {
        text: 'Links',
        items: [
          { text: 'GitHub', link: 'https://github.com/lexicalninja/my-little-scrum-team' },
          { text: 'Pi.dev', link: 'https://pi.dev' },
        ]
      }
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Getting Started',
          collapsed: false,
          items: [
            { text: 'What is MLST?', link: '/guide/what-is-mlst' },
            { text: 'Quick Start', link: '/guide/quick-start' },
            { text: 'Dashboard', link: '/guide/dashboard' },
          ]
        },
        {
          text: 'Core Usage',
          collapsed: false,
          items: [
            { text: 'Input Formats', link: '/guide/input-formats' },
            { text: 'Build Phases', link: '/guide/phases' },
            { text: 'Quality Gates', link: '/guide/gates' },
          ]
        },
        {
          text: 'Configuration',
          collapsed: false,
          items: [
            { text: 'Configuration', link: '/guide/configuration' },
          ]
        }
      ],

      '/advanced/': [
        {
          text: 'Advanced Topics',
          collapsed: false,
          items: [
            { text: 'Overview', link: '/advanced/' },
            { text: 'Specialist Agents', link: '/advanced/agents' },
            { text: 'Orchestration', link: '/advanced/orchestration' },
            { text: 'Customization', link: '/advanced/customization' },
            { text: 'Debugging', link: '/advanced/debugging' },
            { text: 'Cost Tracking', link: '/advanced/cost-tracking' },
            { text: 'Monorepo Setup', link: '/advanced/monorepo' },
          ]
        }
      ],

      '/reference/': [
        {
          text: 'Reference',
          collapsed: false,
          items: [
            { text: 'Commands', link: '/reference/commands' },
            { text: 'Schemas', link: '/reference/schemas' },
            { text: 'FAQ', link: '/reference/faq' },
          ]
        }
      ]
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/lexicalninja/my-little-scrum-team' }
    ],

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2026 Patrick Saxton'
    },

    search: {
      provider: 'local'
    }
  },
  
  head: [
    // No webfont links. This block previously pulled Inter and Source Serif Pro
    // from Google Fonts as a stand-in for a commercial brand face. VitePress
    // already bundles Inter locally, so that was a duplicate download plus a
    // third-party request on every page view — awkward next to the privacy
    // claims in reference/faq.md. The serif now falls back to Georgia.

    // Meta tags
    ['meta', { name: 'theme-color', content: '#73628a' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'MLST User Guide' }],
    ['meta', { property: 'og:description', content: 'Multi-agent orchestration for pi.dev' }]
  ]
})
