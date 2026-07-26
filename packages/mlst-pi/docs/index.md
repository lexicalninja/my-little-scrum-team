---
layout: home

hero:
  name: MLST
  text: Multi-agent orchestration for pi.dev
  tagline: Turn a natural-language description into a complete, tested, reviewed feature
  actions:
    - theme: brand
      text: Get Started
      link: /guide/what-is-mlst
    - theme: alt
      text: View on GitHub
      link: https://github.com/lexicalninja/my-little-scrum-team
---

<GradientAccent variant="sunrise" />

## Why MLST?

<div class="features-grid">
  <FeatureCard title="Five-Phase Workflow" variant="sunset">
    From idea refinement through completion, MLST coordinates specialist agents across a full software development cycle
  </FeatureCard>
  
  <FeatureCard title="Intelligent Orchestration" variant="spring">
    Automatically chooses the right tool (deterministic code, fast LLM calls, or full agents) for each task
  </FeatureCard>
  
  <FeatureCard title="Real-Time Dashboard" variant="spring">
    Watch your build progress in real-time with live event logs, task status, and test results
  </FeatureCard>
  
  <FeatureCard title="Quality Gates" variant="sunset">
    Automatic validation of specification completeness and task breakdown structure
  </FeatureCard>
  
  <FeatureCard title="Cost-Aware Routing" variant="winter">
    Role-based model routing and rate limiting optimized for your provider
  </FeatureCard>
  
  <FeatureCard title="Data Storage is Local" variant="default">
    Data storage is local. LLM calls use your provider. No telemetry or hidden uploads
  </FeatureCard>
</div>

<GradientAccent variant="sunset" />

## Get Started in 5 Minutes

<div class="cta-section">

1. **Install** the extension
2. **Run** `/build add a feature`
3. **Watch** the real-time dashboard
4. **Review** the results

See the **[Quick Start Guide](/guide/quick-start.md)** for detailed instructions.

</div>

<style scoped>
.features-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 2rem;
  margin: 3rem 0;
}

.cta-section {
  background: linear-gradient(135deg, var(--mlst-brand-pale) 0%, rgba(115, 98, 138, 0.1) 100%);
  border-left: 4px solid var(--mlst-brand);
  padding: 2rem;
  border-radius: 8px;
  margin: 2rem 0;
}

.cta-section ol {
  margin: 1rem 0;
  padding-left: 1.5rem;
}

.cta-section li {
  margin: 0.5rem 0;
  line-height: 1.6;
}
</style>
