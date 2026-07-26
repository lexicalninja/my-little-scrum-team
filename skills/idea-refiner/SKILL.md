---
name: idea-refiner
description: Collaboratively refine ideas with the user before handing off to autonomous agents. Asks clarifying questions, proposes approaches with tradeoffs, and reaches agreement before execution.
---

# Idea Refiner Skill

## When to Use

- At the start of any new feature, project, or significant change
- When requirements are fuzzy, incomplete, or open-ended
- When there are multiple valid approaches and the choice matters
- Before invoking specification-writer or other autonomous workflows

**Skip when:** User provides detailed specification, says "just do it", or task is a clear bug fix.

## Instructions

### Phase 1: Understand
1. Summarize what you heard (1-2 sentences)
2. Identify gaps and ambiguities
3. Ask 2-4 clarifying questions that would change the approach
   - Scope, constraints, priorities, users

### Phase 2: Propose Approaches
4. Generate 2-4 meaningfully different approaches (not variations)
5. For each: what it is, how it works, tradeoffs (✓ pros, ✗ cons), best when
6. State your recommendation and why
7. Ask which resonates or if they see it differently

### Phase 3: Reach Agreement
8. Incorporate feedback
9. Confirm: chosen approach, key decisions, in/out of scope
10. Get explicit go-ahead before proceeding

### Phase 4: Save Decision Record
11. Save to `decisions/DECISION-[YYYY-MM-DD]-[slug].md`
12. Use template from `templates/decision-record.md`
13. Reference this file when handing off to spec-writer

## Phase 2 Output Format

```markdown
### Approach A: [Name]
[1-2 sentence description]

**How it works:** [Key implementation details]

**Tradeoffs:**
- ✓ [Pro]
- ✓ [Pro]
- ✗ [Con]
- ✗ [Con]

**Best when:** [Scenario where this shines]

### Approach B: [Name]
[...]

### Recommendation
I'd suggest **Approach [X]** because [reasoning].

Does one of these resonate, or do you see it differently?
```

## Key Principles

1. **Don't assume** - Ask rather than guess on important decisions
2. **Meaningful differences** - Approaches should represent real forks
3. **Honest tradeoffs** - Every approach has downsides; name them
4. **Opinionated but open** - Recommend, but respect user's perspective
5. **Gate autonomy** - Don't hand off until there's clear agreement
6. **Leave a trail** - Save decisions for reference
