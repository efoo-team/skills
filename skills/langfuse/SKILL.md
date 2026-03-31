---
name: langfuse
description: 'Query, debug, and analyze LLM observability data from Langfuse via REST API. Covers traces, observations, sessions, scores, prompts, and datasets. Use when investigating agent behavior, debugging LLM calls, analyzing costs/latency, reviewing prompt versions, or auditing Mastra agent runs.'
allowed-tools: Read, Grep, Glob, Bash, WebFetch
metadata:
  author: efoo-team
  version: '1.0.0'
  tags: [observability, llm, debugging, api]
  api-spec: https://cloud.langfuse.com/generated/api/openapi.yml
  api-reference: https://api.reference.langfuse.com
---

# Langfuse Observability Skill

Query Langfuse observability data via REST API to debug agent runs, analyze LLM costs, and inspect prompt versions. This skill complements the Langfuse Prompt MCP (built-in) which handles prompt CRUD — this skill covers everything else.

## Prerequisites

**Authentication**: All API calls require HTTP Basic Auth.

- Username: `LANGFUSE_PUBLIC_KEY` (e.g., `pk-lf-...`)
- Password: `LANGFUSE_SECRET_KEY` (e.g., `sk-lf-...`)

**Base URL**: Read from `.env`:

```bash
grep LANGFUSE_BASE_URL .env  # e.g., http://localhost:4300
```

**Quick connectivity check**:

```bash
curl -s -u "pk-lf-...:sk-lf-..." "${LANGFUSE_BASE_URL:-http://localhost:4300}/api/public/projects" | jq '.'
```

## Self-Hosted vs Cloud API Differences

| Feature                            | Self-Hosted            | Cloud |
| ---------------------------------- | ---------------------- | ----- |
| Traces (v1)                        | ✅                     | ✅    |
| Observations (v1)                  | ✅                     | ✅    |
| Observations (v2, cursor-based)    | ❌ Cloud-only beta     | ✅    |
| Metrics (v2, aggregated analytics) | ❌ Limited/unsupported | ✅    |
| Scores                             | ✅                     | ✅    |
| Sessions                           | ✅                     | ✅    |
| Prompts                            | ✅                     | ✅    |
| Datasets                           | ✅                     | ✅    |
| Comments                           | ✅                     | ✅    |
| Annotation Queues                  | ✅                     | ✅    |
| Score Configs                      | ✅                     | ✅    |

**Always use v1 endpoints for self-hosted.** V2 endpoints return `NotImplementedError` on local instances.

## Core API Endpoints

### Setup (run once per session)

```bash
# Read credentials from .env
LANGFUSE_BASE_URL=$(grep LANGFUSE_BASE_URL .env | cut -d'"' -f2)
LANGFUSE_PK=$(grep LANGFUSE_PUBLIC_KEY .env | cut -d'"' -f2)
LANGFUSE_SK=$(grep LANGFUSE_SECRET_KEY .env | cut -d'"' -f2)
AUTH="-u ${LANGFUSE_PK}:${LANGFUSE_SK}"
BASE="${LANGFUSE_BASE_URL}/api/public"
```

### 1. Traces — Agent run overviews

List traces with pagination and filters:

```bash
# Recent traces (default: 10 per page)
curl -s $AUTH "$BASE/traces?limit=10" | jq '.data[] | {id, name, timestamp, totalCost, latency, userId}'

# Filter by user, tags, time range
curl -s $AUTH "$BASE/traces?limit=10&userId=<user-id>&fromTimestamp=2026-03-20T00:00:00Z&toTimestamp=2026-03-21T23:59:59Z"

# Single trace detail (includes full input/output/metadata)
curl -s $AUTH "$BASE/traces/<trace-id>" | jq '.'
```

**Key fields**: `name` (agent/workflow name), `input`/`output`, `metadata` (agent config, instructions), `totalCost`, `latency`, `observations` (child IDs), `scores`, `sessionId`, `userId`

### 2. Observations — Spans, Generations, Events

```bash
# Observations for a specific trace
curl -s $AUTH "$BASE/observations?traceId=<trace-id>&limit=50" | jq '.data[] | {id, type, name, model, startTime, endTime, latency, calculatedTotalCost, usage}'

# Filter by type (SPAN, GENERATION, EVENT)
curl -s $AUTH "$BASE/observations?traceId=<trace-id>&type=GENERATION&limit=20"

# Single observation detail
curl -s $AUTH "$BASE/observations/<observation-id>" | jq '.'
```

**Key fields**: `type` (SPAN/GENERATION/EVENT), `name`, `model`, `input`/`output`, `usage` (promptTokens, completionTokens), `calculatedTotalCost`, `latency`, `parentObservationId`, `metadata`, `level` (DEFAULT/WARNING/ERROR)

### 3. Sessions — Conversation threads

```bash
# List sessions
curl -s $AUTH "$BASE/sessions?limit=20" | jq '.data[] | {id, createdAt, projectId, environment}'

# Get traces for a session (via trace filter)
curl -s $AUTH "$BASE/traces?sessionId=<session-id>&limit=20" | jq '.data[] | {id, name, timestamp, totalCost}'
```

### 4. Scores — Evaluations

```bash
# List scores
curl -s $AUTH "$BASE/scores?limit=20" | jq '.data[]'

# Score configs (templates)
curl -s $AUTH "$BASE/score-configs?limit=20" | jq '.data[]'
```

### 5. Projects

```bash
curl -s $AUTH "$BASE/projects" | jq '.data[] | {id, name, organization}'
```

### 6. Datasets & Dataset Items

```bash
# List datasets
curl -s $AUTH "$BASE/v2/datasets?limit=20" | jq '.data[]'

# Dataset items
curl -s $AUTH "$BASE/dataset-items?datasetName=<name>&limit=20" | jq '.data[]'
```

### 7. Comments

```bash
# List comments (filter by objectType: trace, observation, session, prompt)
curl -s $AUTH "$BASE/comments?limit=20" | jq '.data[]'
```

## Common Investigation Workflows

### Workflow A: Debug a failed agent run

1. **Find the trace**: Search traces by time range or agent name
   ```bash
   curl -s $AUTH "$BASE/traces?limit=20" | jq '[.data[] | {id, name, timestamp, latency, totalCost, level: .metadata.level}]'
   ```
2. **Get trace detail**: Inspect input/output for the failed trace
   ```bash
   curl -s $AUTH "$BASE/traces/<trace-id>" | jq '.'
   ```
3. **Find errors in observations**: Look for level=WARNING or level=ERROR
   ```bash
   curl -s $AUTH "$BASE/observations?traceId=<trace-id>&limit=50" | jq '[.data[] | select(.level != "DEFAULT") | {id, type, name, level, statusMessage, startTime}]'
   ```
4. **Inspect the failing generation**: Get full model input/output
   ```bash
   curl -s $AUTH "$BASE/observations/<observation-id>" | jq '{type, name, model, input, output, usage, calculatedTotalCost, latency, statusMessage}'
   ```

### Workflow B: Analyze costs and latency

1. **Cost overview**: Summarize costs across recent traces
   ```bash
   curl -s $AUTH "$BASE/traces?limit=50" | jq '{totalCost: ([.data[].totalCost] | add), avgCost: ([.data[].totalCost] | add / length), avgLatency: ([.data[].latency] | add / length), traceCount: .meta.totalItems}'
   ```
2. **Per-model breakdown**: Extract model costs from generations
   ```bash
   curl -s $AUTH "$BASE/observations?limit=100&type=GENERATION" | jq 'group_by(.model) | map({model: .[0].model, count: length, totalCost: (map(.calculatedTotalCost) | add), avgTokens: (map(.usage.total) | add / length)})'
   ```

### Workflow C: Trace a conversation session

1. **List sessions**: Find the target session
   ```bash
   curl -s $AUTH "$BASE/sessions?limit=20" | jq '.data[]'
   ```
2. **Get all traces for a session**: Full conversation history
   ```bash
   curl -s $AUTH "$BASE/traces?sessionId=<session-id>&limit=50" | jq '[.data[] | {id, name, timestamp, input: (.input[0].content | .[0:100]), output: (.output.text // .output | tostring | .[0:100]), totalCost, latency}]'
   ```

### Workflow D: Audit prompt versions

Use the **built-in Langfuse Prompt MCP** tools for prompt CRUD:

- `langfuse_listPrompts` — list all prompts
- `langfuse_getPrompt` — get compiled prompt with dependencies resolved
- `langfuse_getPromptUnresolved` — get raw prompt with dependency tags
- `langfuse_createTextPrompt` / `langfuse_createChatPrompt` — create new versions
- `langfuse_updatePromptLabels` — manage production/staging labels

**Note**: The REST API `GET /api/public/prompts` requires a `name` parameter. Use MCP tools for listing.

## Pagination

All v1 endpoints use **page-based pagination**:

- `page` (starts at 1), `limit` (default varies, typically 10)
- Response includes `meta.totalItems` and `meta.totalPages`

```bash
# Page through results
curl -s $AUTH "$BASE/traces?limit=50&page=1" | jq '.meta'
curl -s $AUTH "$BASE/traces?limit=50&page=2" | jq '.meta'
```

**v2 Cloud endpoints** use **cursor-based pagination** (not available on self-hosted).

## Output Truncation

For large responses, always truncate when scanning:

```bash
# Truncate long text fields
curl -s $AUTH "$BASE/traces/<id>" | jq '{id, name, input: (.input | tostring | .[0:300]), output: (.output | tostring | .[0:300])}'

# Select only needed fields
curl -s $AUTH "$BASE/observations?traceId=<id>&limit=50" | jq '.data[] | {id, type, name, model, latency, calculatedTotalCost}'
```

## Important Notes

- **Data freshness**: New data appears within 15-30 seconds of ingestion
- **Cost fields**: `calculatedTotalCost` on observations, `totalCost` on traces
- **Latency**: In seconds (e.g., `21.968` = ~22 seconds)
- **Usage**: Token counts with `unit: "TOKENS"`, fields: `input`, `output`, `total`
- **Observation types**: `SPAN` (workflow step), `GENERATION` (LLM call), `EVENT` (log point)
- **Metadata fields vary** by agent/workflow — inspect raw data to discover available keys

## References

- Full API reference: See [`REFERENCE.md`](REFERENCE.md)
- OpenAPI spec: `https://cloud.langfuse.com/generated/api/openapi.yml`
- API docs: `https://api.reference.langfuse.com`
- Langfuse docs MCP (unauthenticated): `https://langfuse.com/api/mcp`
