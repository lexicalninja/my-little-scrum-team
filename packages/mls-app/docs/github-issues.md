# GitHub Issue Resolution

MLS can fetch a GitHub issue and use its title and body as the build description, so the AI agents receive meaningful context instead of a bare `#25` reference.

## Feature Overview

When you pass an issue reference to `mls build`, the CLI:

1. Detects the `#N` or `owner/repo#N` pattern in your input.
2. Checks that the `gh` CLI is installed and authenticated.
3. Infers the current repo from `git remote get-url origin` when no explicit `owner/repo` is given.
4. Fetches the issue via `gh issue view`.
5. Replaces the raw reference with a structured string containing the issue title, body, labels, and milestone.
6. Passes the resolved string to the orchestrator as the build description.

The orchestrator and all downstream agents receive the full issue content — no raw `#25` reaches them.

## Supported Input Patterns

| Input pattern | Meaning |
|---|---|
| `mls build '#25'` | Issue 25 in the current repo (inferred from `git remote origin`) |
| `mls build --from-issue 25` | Same as above via flag |
| `mls build 'owner/repo#25'` | Issue 25 in the named repo (no git remote lookup needed) |
| `mls build 'implement the feature from #25'` | Inline reference — `#25` is expanded in place within the text |

`owner/repo#N` is matched before bare `#N` when both patterns could apply. Only the **first** match is resolved per invocation (see [Known Limitations](#known-limitations)).

## Example Commands

```bash
# Bare issue number — current repo inferred from git remote
mls build '#25'

# Flag form — equivalent to the bare #25 syntax above
mls build --from-issue 25

# Cross-repo reference — no git remote required
mls build 'owner/repo#25'

# Inline reference embedded in a description
mls build 'implement the feature described in #25'
```

All four forms produce the same resolved input format (see [Resolved Output Format](#resolved-output-format)).

## Resolved Output Format

The structured string passed to the orchestrator:

```
GitHub Issue #25: <title>

<body>

Labels: bug, enhancement
Milestone: v2.0
```

`Labels:` and `Milestone:` lines are omitted when the values are empty or null.

## Prerequisites

### Install the GitHub CLI

Issue resolution requires the [GitHub CLI (`gh`)](https://cli.github.com). Install it with your package manager:

```bash
# macOS
brew install gh

# Ubuntu / Debian
sudo apt install gh

# Windows (winget)
winget install --id GitHub.cli
```

Full installation options: <https://cli.github.com>

### Authenticate

After installation, authenticate once:

```bash
gh auth login
```

Follow the prompts to complete the OAuth flow. You can verify your session at any time:

```bash
gh auth status
```

MLS checks authentication before every issue fetch. If the check fails you will see a clear error message (see [Error Reference](#error-reference)).

## Known Limitations

- **Only the first `#N` match is resolved.** If you pass `fix #12 and #34`, only `#12` is fetched. Inputs with multiple issue references are uncommon; support for them is out of scope for this version.
- **Only `github.com` remotes are supported.** GitLab, Bitbucket, and self-hosted Git servers are not recognised when inferring the repo from the git remote; use the explicit `owner/repo#N` syntax instead.
- **Natural-language patterns are not recognised.** Strings like `"work on issue 25"` or `"gh issue 25"` are passed through unchanged. Only the `#N` and `owner/repo#N` regex patterns trigger resolution.

## Error Reference

| Situation | Error message | Resolution |
|---|---|---|
| `gh` not in `$PATH` | `'gh' CLI not found. Install it from https://cli.github.com and run 'gh auth login'.` | Install the GitHub CLI. |
| Not authenticated | `Not authenticated with GitHub CLI. Run 'gh auth login' first.` | Run `gh auth login`. |
| Issue does not exist | `GitHub issue #N not found in owner/repo.` | Check the issue number and repo name. |
| No git remote | `Could not determine GitHub repo from git remote. Use 'owner/repo#N' syntax instead.` | Add a GitHub remote or use the explicit `owner/repo#N` form. |
| Non-GitHub remote | `Remote origin is not a github.com URL. Use 'owner/repo#N' syntax instead.` | Use the explicit `owner/repo#N` form. |
| Subprocess timeout (10 s) | `GitHub issue fetch timed out.` | Check network connectivity; try again. |

All errors are printed to `stderr` and the process exits with code `1`.
