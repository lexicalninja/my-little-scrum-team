import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'MLS User Guide',
  description: 'Multi-agent orchestration for pi.dev',
  base: '/my-little-scrum-team/',
  
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
            { text: 'What is MLS?', link: '/guide/what-is-mls' },
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
      message: 'Built with purpose. Delivered with impact.',
      copyright: 'Copyright © 2025 Ad Hoc'
    },

    search: {
      provider: 'local'
    }
  },
  
  head: [
    // Add Google Fonts as fallback for Proxima Nova/Sera
    ['link', { 
      rel: 'preconnect', 
      href: 'https://fonts.googleapis.com' 
    }],
    ['link', { 
      rel: 'preconnect', 
      href: 'https://fonts.gstatic.com', 
      crossorigin: '' 
    }],
    ['link', { 
      href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&family=Source+Serif+Pro:wght@400;600&display=swap', 
      rel: 'stylesheet' 
    }],
    
    // Meta tags
    ['meta', { name: 'theme-color', content: '#31B67B' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'MLS User Guide' }],
    ['meta', { property: 'og:description', content: 'Multi-agent orchestration for pi.dev' }]
  ]
})
