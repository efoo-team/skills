# Langfuse API Reference

Complete REST API reference for Langfuse Public API v1 (self-hosted compatible). Based on OpenAPI spec from `https://cloud.langfuse.com/generated/api/openapi.yml`.

## Authentication

```bash
# HTTP Basic Auth
curl -u "LANGFUSE_PUBLIC_KEY:LANGFUSE_SECRET_KEY" "${LANGFUSE_BASE_URL}/api/public/..."
```

## Base URL

- Self-hosted: `http://localhost:4300/api/public` (configurable via `LANGFUSE_PORT`)
- Cloud: `https://cloud.langfuse.com/api/public`
- Cloud EU: `https://eu.cloud.langfuse.com/api/public`
- Cloud US: `https://us.cloud.langfuse.com/api/public`

---

## Endpoints by Category

### Traces

#### `GET /api/public/traces`

List traces with filters.

| Parameter       | Type     | Description                    |
| --------------- | -------- | ------------------------------ |
| `limit`         | int      | Items per page (default 10)    |
| `page`          | int      | Page number (starts at 1)      |
| `userId`        | string   | Filter by user ID              |
| `sessionId`     | string   | Filter by session ID           |
| `name`          | string   | Filter by trace name           |
| `tags`          | string[] | Filter by tags (JSON array)    |
| `fromTimestamp` | string   | ISO 8601 start time            |
| `toTimestamp`   | string   | ISO 8601 end time              |
| `orderBy`       | string   | Sort field (e.g., `timestamp`) |
| `environment`   | string   | Filter by environment          |

**Response shape**:

```json
{
  "data": [
    {
      "id": "string",
      "projectId": "string",
      "name": "string",
      "timestamp": "ISO8601",
      "environment": "string",
      "tags": ["string"],
      "bookmarked": false,
      "userId": "string",
      "sessionId": "string",
      "input": "any",
      "output": "any",
      "metadata": {},
      "totalCost": 0.001,
      "latency": 21.968,
      "observations": ["obs-id-1", "obs-id-2"],
      "scores": [],
      "createdAt": "ISO8601",
      "updatedAt": "ISO8601"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 10,
    "totalItems": 144,
    "totalPages": 15
  }
}
```

#### `GET /api/public/traces/{traceId}`

Get single trace with full detail.

#### `PATCH /api/public/traces/{traceId}`

Update a trace (bookmark, tags, metadata, etc.).

---

### Observations (v1)

#### `GET /api/public/observations`

| Parameter             | Type   | Description                      |
| --------------------- | ------ | -------------------------------- |
| `traceId`             | string | Filter by trace ID               |
| `parentObservationId` | string | Filter by parent observation     |
| `type`                | string | `SPAN`, `GENERATION`, or `EVENT` |
| `name`                | string | Filter by observation name       |
| `userId`              | string | Filter by user ID                |
| `level`               | string | `DEFAULT`, `WARNING`, or `ERROR` |
| `limit`               | int    | Items per page                   |
| `page`                | int    | Page number                      |

**Response shape** (GENERATION type):

```json
{
  "id": "string",
  "traceId": "string",
  "type": "GENERATION",
  "name": "string",
  "model": "openai/gpt-4o",
  "input": {},
  "output": {},
  "usage": {
    "unit": "TOKENS",
    "input": 1500,
    "output": 200,
    "total": 1700
  },
  "calculatedTotalCost": 0.001,
  "latency": 2.5,
  "promptId": "string",
  "promptName": "string",
  "promptVersion": 1,
  "startTime": "ISO8601",
  "endTime": "ISO8601",
  "metadata": {},
  "level": "DEFAULT",
  "statusMessage": null
}
```

**SPAN type**: Has `parentObservationId`, no `model`/`usage`. Represents workflow steps.
**EVENT type**: Minimal fields. Represents log points.

#### `GET /api/public/observations/{observationId}`

Get single observation detail.

#### `PATCH /api/public/observations/{observationId}`

Update an observation.

---

### Observations (v2) — Cloud Only

#### `GET /api/public/v2/observations`

Cursor-based pagination, selective field retrieval.

| Parameter       | Type   | Description                                 |
| --------------- | ------ | ------------------------------------------- |
| `traceId`       | string | Filter by trace                             |
| `type`          | string | `SPAN`, `GENERATION`, `EVENT`               |
| `fields`        | string | `core`, `basic`, `usage`, `model`, `scores` |
| `parseIoAsJson` | bool   | Default `false` (returns strings)           |
| `limit`         | int    | Default 50, max 1000                        |
| `cursor`        | string | Cursor for next page                        |

**Not available on self-hosted**: Returns `NotImplementedError`.

---

### Scores

#### `GET /api/public/scores`

| Parameter       | Type   | Description                    |
| --------------- | ------ | ------------------------------ |
| `limit`         | int    | Items per page                 |
| `page`          | int    | Page number                    |
| `userId`        | string | Filter by user                 |
| `traceId`       | string | Filter by trace                |
| `observationId` | string | Filter by observation          |
| `name`          | string | Filter by score name           |
| `configId`      | string | Filter by score config         |
| `operator`      | string | `lt`, `lte`, `gt`, `gte`, `eq` |
| `timestampFrom` | string | ISO 8601                       |
| `timestampTo`   | string | ISO 8601                       |

**Score data types**: `NUMERIC`, `CATEGORICAL`, `BOOLEAN`

#### `POST /api/public/scores`

Create a score. Body:

```json
{
  "traceId": "required",
  "observationId": "optional",
  "sessionId": "optional",
  "name": "correctness",
  "value": 0.9,
  "dataType": "NUMERIC",
  "comment": "optional explanation",
  "configId": "optional"
}
```

---

### Score Configs

#### `GET /api/public/score-configs`

List score configuration templates.

#### `POST /api/public/score-configs`

Create a score config template.

---

### Sessions

#### `GET /api/public/sessions`

| Parameter       | Type   | Description    |
| --------------- | ------ | -------------- |
| `limit`         | int    | Items per page |
| `page`          | int    | Page number    |
| `userId`        | string | Filter by user |
| `fromTimestamp` | string | ISO 8601       |
| `toTimestamp`   | string | ISO 8601       |

**Response shape**:

```json
{
  "data": [
    {
      "id": "line:user:U3f...",
      "createdAt": "ISO8601",
      "projectId": "string",
      "environment": "development"
    }
  ],
  "meta": { "totalItems": 2, "totalPages": 1, "page": 1, "limit": 5 }
}
```

---

### Projects

#### `GET /api/public/projects`

List all projects.

```json
{
  "data": [
    {
      "id": "l-shift-observability",
      "name": "l-shift-observability",
      "organization": { "id": "l-shift-local", "name": "l-shift-local" },
      "metadata": {}
    }
  ]
}
```

---

### Prompts

#### `GET /api/public/prompts`

**Requires `name` parameter** (use Langfuse Prompt MCP for listing without name).

| Parameter | Type              | Description                   |
| --------- | ----------------- | ----------------------------- |
| `name`    | string (required) | Prompt name                   |
| `version` | int               | Specific version number       |
| `label`   | string            | e.g., `production`, `staging` |

#### `POST /api/public/prompts`

Create a prompt version (text or chat type).

---

### Datasets

#### `GET /api/public/v2/datasets`

List datasets.

#### `POST /api/public/v2/datasets`

Create a dataset.

#### `GET /api/public/v2/datasets/{datasetName}`

Get a single dataset.

#### `GET /api/public/v2/datasets/{datasetName}/runs/{runName}`

Get a dataset run with its items.

#### `DELETE /api/public/v2/datasets/{datasetName}/runs/{runName}`

Delete a dataset run.

---

### Dataset Items

#### `GET /api/public/dataset-items`

| Parameter             | Type   | Description                                |
| --------------------- | ------ | ------------------------------------------ |
| `datasetName`         | string | Filter by dataset                          |
| `sourceTraceId`       | string | Filter by source trace                     |
| `sourceObservationId` | string | Filter by source observation               |
| `version`             | string | ISO 8601 timestamp for point-in-time query |
| `limit`               | int    | Items per page                             |
| `page`                | int    | Page number                                |

#### `POST /api/public/dataset-items`

Create/upsert a dataset item.

#### `GET /api/public/dataset-items/{id}`

Get a single dataset item.

#### `DELETE /api/public/dataset-items/{id}`

Delete a dataset item (irreversible).

---

### Dataset Run Items

#### `GET /api/public/dataset-run-items`

| Parameter   | Type   | Required |
| ----------- | ------ | -------- |
| `datasetId` | string | Yes      |
| `runName`   | string | Yes      |
| `limit`     | int    | No       |
| `page`      | int    | No       |

#### `POST /api/public/dataset-run-items`

Create a dataset run item.

---

### Comments

#### `GET /api/public/comments`

| Parameter      | Type   | Description                                 |
| -------------- | ------ | ------------------------------------------- |
| `limit`        | int    | Items per page                              |
| `page`         | int    | Page number                                 |
| `objectType`   | string | `trace`, `observation`, `session`, `prompt` |
| `objectId`     | string | Filter by object ID                         |
| `authorUserId` | string | Filter by author                            |

#### `POST /api/public/comments`

Create a comment.

#### `GET /api/public/comments/{commentId}`

Get a single comment.

---

### Annotation Queues

#### `GET /api/public/annotation-queues`

List annotation queues.

#### `POST /api/public/annotation-queues`

Create an annotation queue.

#### `GET /api/public/annotation-queues/{queueId}`

Get a single queue.

#### `GET /api/public/annotation-queues/{queueId}/items`

List items in a queue.

#### `POST /api/public/annotation-queues/{queueId}/items`

Add an item to a queue.

#### `PATCH /api/public/annotation-queues/{queueId}/items/{itemId}`

Update a queue item.

#### `DELETE /api/public/annotation-queues/{queueId}/items/{itemId}`

Remove an item from a queue.

---

### Blob Storage Integrations

#### `GET /api/public/integrations/blob-storage`

List blob storage integrations (requires organization-scoped API key).

#### `PUT /api/public/integrations/blob-storage`

Create or update a blob storage integration.

#### `GET /api/public/integrations/blob-storage/{id}`

Get sync status.

#### `DELETE /api/public/integrations/blob-storage/{id}`

Delete a blob storage integration.

---

## Metrics (v2) — Cloud Only

#### `POST /api/public/v2/metrics`

Aggregated analytics query. Body:

```json
{
  "view": "observations",
  "dimensions": ["name", "model"],
  "metrics": [
    { "metric": "count", "aggregation": "sum" },
    { "metric": "cost", "aggregation": "sum" }
  ],
  "filter": {
    "operator": "and",
    "filters": [{ "field": "type", "operator": "eq", "value": "GENERATION" }]
  },
  "dateRange": {
    "from": "2026-03-01T00:00:00Z",
    "to": "2026-03-21T23:59:59Z"
  },
  "orderBy": { "desc": true }
}
```

**Available views**: `observations`, `scores`
**Available dimensions**: `name`, `model`, `type`, `environment`, `userId`, `tags`, etc.
**Available metrics**: `count`, `cost`, `latency`, `input_tokens`, `output_tokens`, `total_tokens`
**Note**: High-cardinality dimensions (id, traceId, userId, sessionId) cannot be used for grouping in v2.

**Not available on self-hosted**: May return `MethodNotAllowedError` or `NotImplementedError`.

---

## SDK Alternatives

For programmatic access from application code, prefer SDKs over raw HTTP:

### Python SDK

```python
from langfuse import Langfuse

langfuse = Langfuse()

# Traces
traces = langfuse.api.trace.list(limit=100, user_id="user_123")

# Observations (v2 high-performance)
observations = langfuse.api.observations.get_many(
    trace_id="abc",
    type="GENERATION",
    limit=100,
    fields="core,basic,usage"
)

# Scores
langfuse.api.scores.get_many(score_ids="score-id")

# Sessions
sessions = langfuse.api.sessions.list(limit=50)
```

### TypeScript SDK

```typescript
import { LangfuseClient } from '@langfuse/client'

const langfuse = new LangfuseClient()

// Traces
const traces = await langfuse.api.trace.list({ limit: 100 })

// Observations
const observations = await langfuse.api.observations.getMany({
  traceId: 'abc',
  type: 'GENERATION',
  limit: 100,
  fields: 'core,basic,usage',
})

// Scores
await langfuse.api.scores.getMany({ scoreIds: 'score-id' })

// Sessions
const sessions = await langfuse.api.sessions.list()
```

---

## Third-Party MCP Servers (for extended tool access)

If you need MCP-based access to traces/observations/scores (beyond prompts), consider these community MCP servers:

| Server                        | Tools                                                       | Language   | Install                              |
| ----------------------------- | ----------------------------------------------------------- | ---------- | ------------------------------------ |
| `avivsinai/langfuse-mcp`      | 25 (traces, obs, sessions, exceptions, prompts, datasets)   | Python     | `pip install langfuse-mcp` or Docker |
| `@therealsachin/langfuse-mcp` | 32+ (analytics, traces, obs, scores, datasets, comments)    | TypeScript | `npx @therealsachin/langfuse-mcp`    |
| `langfuse-mcp-extended`       | 22 (traces, obs, scores, score configs, datasets, sessions) | TypeScript | `npx langfuse-mcp-extended`          |

**Note**: The built-in Langfuse Prompt MCP (`/api/public/mcp`) covers prompt management. These third-party servers complement it with observability tools.

---

## Langfuse Docs MCP (unauthenticated)

For Langfuse documentation queries, use the official Docs MCP:

```
URL: https://langfuse.com/api/mcp
Transport: streamableHttp
```

Tools:

- `searchLangfuseDocs` — Semantic search over Langfuse docs (RAG)
- `getLangfuseDocsPage` — Fetch raw markdown for a specific docs page
- `getLangfuseOverview` — High-level docs index
