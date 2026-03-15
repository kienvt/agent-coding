# /init-plan — Phase 1: Analyze requirements and initialize project

Read the requirement file(s), generate planning documents, UI mockups, create GitLab issues, and notify the team for review.

## Context (provided in prompt)

- `requirementFile` — one or more absolute paths, comma-separated. Supported: `.md`, `.txt`, `.pdf`
- `repoName` — project name
- `projectId` — GitLab project ID

## Steps

### Step 1 — Read & analyze requirements

`requirementFile` may be a single path or a comma-separated list of paths.
Read **all** files. PDFs are supported — use the Read tool directly on `.pdf` files.

```
for each path in requirementFile.split(',').map(s => s.trim()):
  Read the file at that path
```

Merge all content, then identify and extract:
- Core features and user stories
- Data entities and relationships
- User roles and permissions
- Integration points (APIs, services, databases)
- Non-functional requirements (performance, security, scale)
- Technology constraints (if any specified)

### Step 2 — Create planning branch

```bash
git fetch origin
git checkout -b docs/init-plan origin/main
```

### Step 3 — Generate documentation

Create the following files in `docs/`:

**`docs/architecture.md`** — System overview
- High-level component diagram (Mermaid)
- Data flow between components
- Technology stack decisions with rationale
- Deployment topology

**`docs/database-schema.md`** — Data model
- ERD diagram (Mermaid)
- Table/collection definitions with field types
- Indexes and constraints
- Migration notes

**`docs/api-documentation.md`** — API contracts
- All endpoints with method, path, description
- Request body schemas with field types and validation rules
- Response schemas for success and error cases
- Authentication requirements per endpoint

**`docs/test-cases.md`** — Test scenarios
- Unit test scenarios for core business logic
- Integration test scenarios for API endpoints
- E2E test scenarios for critical user flows
- Edge cases and error scenarios

**`docs/implementation-plan.md`** — Phased task list
- Group tasks by phase (Setup → Core → Features → Polish)
- Order by dependency (foundation before features)
- Each task: title, description, acceptance criteria, estimated complexity
- Mark parallel tasks where possible

**`docs/README.md`** — Index
- Links to all documents above
- Quick start guide
- Key decisions summary

### Step 4 — Generate UI mockup

Create self-contained HTML mockups in `docs/mockup/`:

**`docs/mockup/index.html`** — Navigation hub with links to all screens

**`docs/mockup/assets/style.css`** — Shared design system (colors, typography, components)

**`docs/mockup/assets/mock-data.js`** — Realistic placeholder data as JS constants

**`docs/mockup/screens/{screen-name}.html`** — One file per major UI screen (minimum 4 screens)

Rules:
- Self-contained: no CDN dependencies, all CSS/JS inline or in assets/
- Responsive: works on desktop and mobile
- Realistic fake data: use plausible names, dates, amounts
- Inline navigation: each screen links to related screens

### Step 5 — Commit all documents

```bash
git add docs/
git commit -m "docs: initialize project planning documents and UI mockups"
```

### Step 6 — Create GitLab issues

Use `/create-issues` skill:
- Source file: `docs/implementation-plan.md`
- Creates one issue per task, ordered by dependency
- Output: `ISSUE_IIDS: {comma-separated list}`

### Step 7 — Push and notify

```bash
git push -u origin docs/init-plan
```

Post summary on the first created issue:
```bash
glab issue note {firstIssueIid} --message "## Phase 1 Complete

Planning documents and UI mockups have been created in \`docs/\`.

**Please review:**
- [Architecture](docs/architecture.md)
- [Implementation Plan](docs/implementation-plan.md)
- [UI Mockups](docs/mockup/index.html)

Comment **'approve'** on this issue to start implementation."
```

## Output

Must output on its own line (used by orchestrator to track issues):
```
ISSUE_IIDS: {number},{number},...
```
