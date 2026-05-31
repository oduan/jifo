---
name: jifo-cli
description: Use when an agent needs to query, search, paginate, filter by tag, create text notes, or inspect tags in Jifo through the project CLI
---

# Jifo CLI

## Overview

Use the `jifo` CLI to access Jifo notes and tags through the HTTP API. Prefer machine-readable `--json` output for all agent workflows.

## Before Running Commands

1. Verify the CLI is available:
   - If installed: `jifo --help`
   - From this repo: `cd cli && go run ./cmd/jifo --help`
2. Authenticate without exposing secrets:
   - Prefer environment variables in automation: `JIFO_ACCESS_TOKEN` and optional `JIFO_BASE_URL`.
   - If using `jifo login --token ...`, never print the real token in chat or logs.
3. For data retrieval or creation, use `--json` whenever available.

## Common Commands

```bash
# Search notes
jifo notes list --search "会议" --limit 20 --offset 0 --json

# Filter by tag path, including child tags on the server side
jifo notes list --tag "思考" --limit 20 --offset 0 --json

# Read the next page
jifo notes list --limit 20 --offset 20 --json

# Create a pure text note
jifo notes create --text "今天的想法 #思考" --json

# Create a note from a text file
jifo notes create --file note.txt --json

# Inspect tags
jifo tags list --json
jifo tags tree --json
```

## Output Handling

- Parse JSON with a JSON parser, not regex.
- Notes are returned in `items`; created notes are returned in `item`.
- Use `plainText` for note content summaries.
- Use tag `path` for filtering and display.

## Safety Rules

- Never include a real access token in responses, logs, examples, or committed files.
- Do not use the CLI for image notes; this CLI only creates text notes.
- Do not assume local database access. The CLI talks to the Jifo HTTP API.
- If auth is missing, ask the user to provide `JIFO_ACCESS_TOKEN` or run `jifo login --token <access-key>`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `missing access token` | Set `JIFO_ACCESS_TOKEN` or run `jifo login --token <access-key>` |
| Need another server | Set `JIFO_BASE_URL`, for example `http://localhost:8080/api` |
| Human output is hard to parse | Re-run the command with `--json` |
| Need images | Not supported by this CLI version |
