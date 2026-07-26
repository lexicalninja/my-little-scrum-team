# Specification: [Feature Name]

## Overview

[High-level description - what are we building and why?]

## Requirements

### Functional Requirements

- [ ] FR-1: [Requirement]
- [ ] FR-2: [Requirement]
- [ ] FR-3: [Requirement]

### Non-Functional Requirements

- [ ] NFR-1: [Performance requirement]
- [ ] NFR-2: [Security requirement]
- [ ] NFR-3: [Accessibility requirement]

## Technical Specifications

### Architecture

[How components fit together - describe the overall structure]

### Data Models

[Key entities and their relationships]

```
Entity: [Name]
- field1: type
- field2: type
- relationship: [related entity]
```

### APIs

[Endpoints, inputs, outputs]

```
POST /api/[resource]
- Input: { field1, field2 }
- Output: { id, field1, field2, createdAt }
- Errors: 400 (validation), 401 (unauthorized), 500 (server error)
```

### Technology Stack

- **Language:** [e.g., TypeScript, Python]
- **Framework:** [e.g., Next.js, FastAPI]
- **Database:** [e.g., PostgreSQL, MongoDB]
- **Libraries:** [key libraries needed]

## Dependencies

- [External service or API]
- [Library or package]
- [Prerequisite that must exist first]

## User Experience

### User Flows

1. User does X
2. System responds with Y
3. User sees Z

### UI Components Needed

- [Component 1]
- [Component 2]

## Edge Cases

- [Scenario 1]: [How to handle]
- [Scenario 2]: [How to handle]
- [Error case]: [How to handle]

## Success Criteria

- [ ] [Measurable criterion 1]
- [ ] [Measurable criterion 2]
- [ ] [Measurable criterion 3]

## Assumptions

[Document any assumptions made during specification]

- [Assumption 1]
- [Assumption 2]

## Open Questions

[IMPORTANT: If any of these exist, STOP and ask before proceeding]

- [ ] [Question that needs clarification]
- [ ] [Ambiguity that needs resolution]
