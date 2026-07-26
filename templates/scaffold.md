## Project Scaffolding

Set up the project skeleton so the tech stack works end-to-end. Do NOT implement features — only wire the foundation.

## Steps

1. Initialize the project (package.json / pyproject.toml / Cargo.toml / go.mod)
2. Install all dependencies from the spec
3. Create the entry point with a minimal health check endpoint (or equivalent)
4. Connect the database (if the spec uses one) with the real driver — no mocks, no fakes
5. Create a single integration test that starts the app, hits the health check, and asserts success
6. Run the test and confirm it passes

## Rules

- Use the REAL database driver, not an in-memory fake
- The test must exercise the actual server and database connection
- Do not implement any business logic, routes, or features beyond a health check
- Do not write unit tests — write one integration test that proves the stack is wired
- Do NOT commit — the orchestrator handles commits
- Do NOT summarize with "complete" or "done" language — just list what files you created
