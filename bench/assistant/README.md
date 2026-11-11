# Assistant query benchmark

Schema-constrained decoding guarantees that a query is *well-formed*. It does not guarantee that the query is *correct*. This benchmark measures correctness: for each natural-language request, does the query the assistant generates select the same nodes and edges as a hand-written gold query?

## What it runs

For every gold item and every model, `run.mjs`:

1. Loads the graph through the app's own Excel import (`IOManager.parseExcelToJson` → `preProcessData`, which covers type inference, boolean normalisation and the property hierarchy).
2. Builds the `graph_state` JSON that the assistant panel sends (`buildContextSnapshot` + `serializeSnapshot`), on a freshly loaded graph: nothing selected, no query, every element visible. The status log is empty because in the app it comes from the DOM.
3. Calls the real `generateQueries()` with the real `OllamaClient` (`/api/chat`, `format` = the hierarchy-constrained JSON schema, `temperature: 0`, `num_ctx` 16384 by default, the app's default). This includes the app's single repair pass. The intent passed in is `{summary: <question>, scope: null}`, the same as the panel's drift-recovery path.
4. Evaluates the first valid suggested query with GLL's own parser and evaluator (`QueryManager.encodeQuery` → `decodeQuery` → `QueryAST.testNode/testEdge`), which is what the panel's **Select** button does. It then compares the selected node and edge IDs with the gold selection.

The benchmark covers phase 2 only (structured query generation). Phase 1, where the chat model decides that a query is wanted and writes the intent summary, is not part of it.

## Running it

```sh
# Check the gold set: every gold query must parse and select something.
node bench/assistant/run.mjs --check-gold

# Live run
node bench/assistant/run.mjs \
  --endpoint http://localhost:11434 \
  --models qwen3:8b,llama3.1:8b,gemma3:12b \
  --repeats 3 \
  --hardware "RTX 4090 24 GB, Ollama 0.x.y"
```

| flag | default | meaning |
|---|---|---|
| `--endpoint` | `http://localhost:11434` | Ollama base URL |
| `--models` | every model in `/api/tags` | comma-separated model names |
| `--repeats` | `1` | runs per item, used to measure variance |
| `--num-ctx` | `16384` | Ollama `num_ctx`. The app's default. Raise it if `promptEvalCount` sits near this value, because that means the prompt was truncated |
| `--limit` | all | run only the first N items (for smoke tests) |
| `--hardware` | — | free text describing the Ollama host, stored in the results |
| `--gold` | `gold.json` | gold-set file |
| `--out` | `results/` | output directory |

Each run writes `results/<timestamp>.json` (metadata plus one record per item × model × repeat) and `results/<timestamp>.md` (summary tables per model and per model × tier). If a model's Ollama calls fail (model missing, out of memory, unreachable), that model's partial results are dropped and listed under `failedModels`, the other models still run, and the exit code is 1. A reply Ollama aborts for looping (`token repeat limit reached`) is not a failure of the run: the app retries once, as in the panel, and if that also loops the item is scored as no query (`degenerateCalls` in the record counts the aborted calls).

Node prints a `MODULE_TYPELESS_PACKAGE_JSON` warning because `package.json` has no `"type"` field. It is harmless; add `--no-warnings` to hide it.

## Metrics

All metrics are top-1: they score the **first** suggested query that rendered without error, which is the one the panel lists first.

| metric | meaning |
|---|---|
| **exact %** | the selected node and edge ID sets equal the gold sets exactly |
| **mean Jaccard** | \|S ∩ G\| / \|S ∪ G\| over the combined node and edge IDs (node and edge IDs are namespaced separately). 0 if no query was produced |
| **best-of Jaccard** | the highest Jaccard across *all* valid suggestions, as if an oracle picked the best one |
| **repair %** | items where the generator needed its repair pass (the first reply failed rendering or hierarchy validation) |
| **schema-valid %** | the **first** raw reply conforms to the JSON schema sent in `format` (checked by `schemaViolation()` against `buildQuerySchema(hierarchy)`, including the field enum) |
| **no-query %** | no valid query came back: empty `queries`, every entry rejected, or both attempts unparseable |
| **unknown props / item** | distinct property paths in the raw replies (first and repair) that do not exist in the graph |
| **median latency** | wall-clock time of the whole `generateQueries()` call, repair pass included |

**Impossible items** (`gold: null`) count as correct (exact = 1, Jaccard = 1) only when no valid query came back. Any emitted query scores 0, even one that selects nothing.

Each JSON record also stores the raw model outputs, the rendered query, whether it parses, `nodeJaccard`/`edgeJaccard`, the selected and gold ID lists, the call count, `promptEvalCount`/`evalCount` (summed over calls), and Ollama's `total_duration`.

Equivalent formulations score identically, because scoring compares selections rather than query strings: `BETWEEN 10 AND 999` versus `BETWEEN 10 AND <max>`, or `A NOT B` versus `A AND (B IS FALSE)`.

## What to report

- Per model: name, digest, parameter size and quantisation. These are recorded automatically from `/api/tags`.
- Ollama host hardware (GPU/VRAM or CPU/RAM) and Ollama version, passed via `--hardware`.
- `numCtx`, `repeats`, `gitCommit` and the gold-set path. All of these are recorded automatically.
- With `--repeats` > 1: the spread of exact % across repeats. `temperature` is 0 and the app sets no `seed`, so the remaining variance comes from the server (batching, GPU non-determinism).

## Gold set

`gold.json` holds 52 items across two graphs:

| tier | ADPKD | airports | total |
|---|---|---|---|
| numeric (single range, incl. LOWER THAN … OR GREATER THAN) | 6 | 3 | 9 |
| categorical (IN, IS TRUE) | 6 | 3 | 9 |
| two_clause (AND/OR, incl. node-OR-edge) | 6 | 4 | 10 |
| nested (≥ 3 leaves, nesting, binary NOT) | 5 | 3 | 8 |
| paraphrase (wording ≠ property name) | 7 | 4 | 11 |
| impossible (no property fits) | 3 | 2 | 5 |

- **adpkd**: `manuscript/2026-06-26_ADPKD_model_GLL-input_GLL-paper-version.xlsx` (263 nodes, 1,574 edges).
- **airports**: `templates/airport-network-template.xlsx` (120 nodes, 240 edges). A different domain, with both node and edge properties.

GLL's ranges are inclusive (`BETWEEN` and `LOWER THAN … OR GREATER THAN` both use ≤/≥). Inclusive thresholds are therefore worded "at least / at most". Strictly worded ones ("more than 8000 km", "below -1 or above 2", "go down") were checked to have no data value exactly on the threshold, so the strict and inclusive readings select the same set.

`tests/bench-assistant.test.js` checks the gold set on every test run: each gold query must parse and select a non-empty set. The same file runs the whole pipeline against a stubbed Ollama and asserts the scoring.
