# Threadlight

Threadlight turns long-form text, pasted social threads, web articles, and supported documents into editable infographics or carousel slides. It includes a browser-based editor, a local JSON project store, image/document exports, and an optional Anthropic-powered analysis path.


## Features

- Accept pasted text, pasted thread text, public web pages, and PDF, DOCX, TXT, or MD uploads.
- Review and edit extracted source text before generating a visual.
- Analyze text using the built-in offline analyzer or an optional Anthropic API integration.
- Generate structured sections with quotes and numbers checked against the supplied source; uncertain claims can be flagged for review.
- Edit titles and section content, reorder sections, add or remove sections, switch layouts and themes, and use undo/redo.
- Render four templates (`explainer`, `steps`, `compare`, and `stats`) and four themes (`daylight`, `midnight`, `moss`, and `coral`).
- Export infographic PNG, SVG with embedded fonts, or PDF. Export carousels as a ZIP of PNG slides or as a multi-page PDF.
- Save projects locally and reopen them later.
- Fetch public web pages with protections against private-network requests and unsafe redirects.

## Requirements

- Node.js 20 or later.
- npm.
- A modern browser for using the app.
- Google Chrome or Microsoft Edge to run the browser E2E test on Windows. Set `CHROME_PATH` if the browser is not in a standard installation directory. On other platforms the E2E runner uses its packaged Chromium binary by default.

## Install and run

From the project directory, install the locked dependencies and start the server:

```bash
npm ci
npm start
```

Open <http://localhost:3000> in your browser. The port can be changed with the `PORT` environment variable.

For development, run the server directly with Node:

```bash
node server/index.js
```

The application serves its web UI and API from the same Express server. The frontend is static content in `public/` and does not have a separate build step.

## Configuration
![Diagram](docs/diagram.png)
The application reads configuration from process environment variables. `.env.example` is a reference template; this project does not load `.env` automatically.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port used by the server. |
| `ANTHROPIC_API_KEY` | empty | Optional credential that enables Anthropic analysis. If unset, the offline analyzer is used. |
| `ANTHROPIC_MODEL` | `claude-sonnet-5-5` | Model identifier sent to the Anthropic Messages API when an API key is configured. |
| `THREADLIGHT_DATA` | `./data` in the project | Directory for locally stored project JSON files. |
| `THREADLIGHT_ALLOW_PRIVATE` | unset | Test-only switch. Setting this to `1` disables private-network URL protection; do not use it in a real deployment. |

Example on PowerShell:

```powershell
$env:ANTHROPIC_API_KEY = "your-api-key"
$env:PORT = "3000"
npm start
```

Example on macOS or Linux:

```bash
export ANTHROPIC_API_KEY="your-api-key"
export PORT=3000
npm start
```

Keep API keys out of source control, browser code, logs, and container images. The server reads the key from its environment; the browser does not need it.

## Using the app

1. Start a new project from the home screen.
2. Choose a source tab and provide pasted text, thread text, a URL, or a supported file.
3. Review the extracted text and correct it before continuing.
4. Generate the infographic. Threadlight validates generated data against its schema and checks source quotes and numbers.
5. Edit the title and sections, adjust the theme or layout, and switch to carousel mode if desired.
6. Export the result and save the project to reopen it later.

The offline analyzer works without network credentials. It is rule-based, so its headings and categorization can be less polished than generated results from the optional AI integration. Always review generated content before publishing it.

## Input and processing limits

- Uploaded files are limited to 10 MiB.
- Accepted upload types are PDF, DOCX, TXT, and MD. The file contents are checked, rather than trusting the filename alone.
- Source text is capped at 400,000 characters when submitted to the source endpoints; text used for generation is processed up to the configured 60,000-character limit.
- At least 80 characters of usable text are required.
- PDF text extraction does not include OCR. Scanned pages with no embedded text may produce warnings or fail extraction.
- Public web pages are limited to 3 MiB per fetch, use a 10-second request timeout, and may follow up to three redirects. Every redirect is revalidated.
- Automatic fetching of X threads is not supported. Paste the thread text instead.
- The Anthropic path reduces long inputs before sending them to the model. This is sentence selection, not chunk-by-chunk summarization.

## HTTP API

The app exposes a JSON API on the same host and port as the UI. Most POST routes accept JSON and return JSON. Uploads use `multipart/form-data`.

| Method and route | Purpose |
|---|---|
| `GET /api/health` | Health status and active analysis provider. |
| `GET /api/meta` | Available templates, themes, and active analysis provider. |
| `POST /api/sources/text` | Normalize pasted text. Body: `{ "text": "...", "title": "..." }`. |
| `POST /api/sources/thread` | Parse pasted thread text. Body: `{ "text": "..." }`. |
| `POST /api/sources/url` | Fetch and extract a public web page. Body: `{ "url": "https://..." }`. |
| `POST /api/sources/upload` | Extract an uploaded PDF, DOCX, TXT, or MD file. Form field: `file`. |
| `POST /api/generate` | Generate a schema-validated infographic document. Body includes `text`, with optional `title`, `sourceNote`, and `settings`. |
| `POST /api/render` | Render an infographic or carousel preview. Body includes `doc`, with optional `mode` and `preview`. |
| `POST /api/export` | Create an export. Body includes `doc`, `mode`, `format`, and optional `scale` and `projectId`. |
| `GET /api/projects` | List saved projects. |
| `POST /api/projects` | Save a new project. |
| `GET /api/projects/:id` | Read a saved project. |
| `PUT /api/projects/:id` | Update a saved project. |
| `DELETE /api/projects/:id` | Delete a saved project. |

Generation settings include a section count, optional template and theme, and a `short` or `detailed` output detail setting. The server validates request data and returns structured error responses for invalid requests.

Example health check:

```bash
curl http://localhost:3000/api/health
```

Example generation request:

```bash
curl -X POST http://localhost:3000/api/generate \
  -H "Content-Type: application/json" \
  -d '{"title":"Focus habits","text":"Paste at least 80 characters of source material here..."}'
```

## Project structure

```text
server/
  app.js             Express app, API routes, and static file serving
  index.js           Server entry point
  config.js          Environment-based runtime configuration
  ai/                Offline analyzer, Anthropic provider, and prompts
  export/            PNG, SVG, PDF, and ZIP export generation
  lib/               Input extraction, validation, SSRF checks, and project storage
  render/            SVG layouts, themes, and font metrics
public/              Browser application and styles
samples/             Sample input text
scripts/              Browser E2E test and screenshot capture
 tests/                Node.js unit and API tests
 data/projects/        Locally saved project JSON files
 docs/                 Roadmap and generated E2E screenshots
```

Saved projects are stored as JSON files under `data/projects/` by default. Choose a persistent writable directory with `THREADLIGHT_DATA` if the process runs in an environment where the project directory is not persistent.

## Tests and browser checks

Run the unit and API test suite:

```bash
npm test
```

Run the browser-based end-to-end workflow:

```bash
npm run e2e
```

Run both checks in sequence:

```bash
npm run check
```

The E2E script drives the real UI, checks key workflows, and writes screenshots to `docs/screenshots/`. On Windows it searches common Chrome and Edge locations; if needed, point it to a browser executable:

```powershell
$env:CHROME_PATH = "C:\Program Files\Google\Chrome\Application\chrome.exe"
npm run e2e
```

## Security and deployment notes

- This is a single-user local application. It has no accounts, authentication, or per-user project permissions. Anyone who can reach the server can access its project API. Do not expose it publicly as-is.
- Link fetching blocks private and special-use addresses, restricts ports, checks DNS results when connecting, and validates each redirect. Keep `THREADLIGHT_ALLOW_PRIVATE` unset outside isolated tests.
- The rate limiter is stored in process memory; it is not shared between multiple server instances.
- Projects contain source text and generated content. Protect the data directory with appropriate filesystem permissions and backups.
- For a hosted deployment, add authentication and authorization, use durable shared storage and production-grade rate limiting, serve behind HTTPS, and review network egress and SSRF controls for the hosting environment.
- Do not put `ANTHROPIC_API_KEY` in client-side code or commit it to the repository.

## Current limitations

- No login, accounts, or multi-user separation.
- No PostgreSQL, Redis, or background job queue; project storage is JSON on disk and rendering runs in the request.
- No OCR for scanned PDFs.
- The editor changes content and presentation settings; it is not a drag-and-drop canvas editor.
- No JPEG export. Current export formats are PNG, SVG, PDF, and ZIP of carousel PNGs.
- No automatic X thread retrieval.
- Very long AI inputs are reduced by selecting sentences; the content is not summarized in a multi-stage map/reduce pipeline.
- Visuals focus on text, statistics, steps, timelines, and comparisons; uploaded images, charts, and a general icon library are not included.
- The live Anthropic integration has automated tests with a mocked API. Validate behavior with your own configured API access before relying on it in production.
- Bundled fonts primarily cover Latin scripts; multilingual rendering has not been fully tested.

See [`docs/ROADMAP.md`](docs/ROADMAP.md) for the fuller proposal gap list.

## Troubleshooting

### `npm start` uses the offline analyzer

Check that `ANTHROPIC_API_KEY` is set in the same shell that starts the server, then restart it. The health endpoint reports the active provider:

```bash
curl http://localhost:3000/api/health
```

### A URL cannot be fetched

The URL must use HTTP or HTTPS and resolve only to allowed public addresses. Private-network hosts, unsupported ports, unsafe redirects, unsupported content types, oversized pages, and slow responses are refused. X thread URLs are intentionally unsupported; paste the thread text instead.

### A PDF upload has little or no extracted text

The PDF may contain scanned page images rather than embedded text. OCR is not included; use a text-based PDF or extract its text before uploading.

### The browser E2E check cannot find Chrome on Windows

Install Chrome or Edge, or set `CHROME_PATH` to the browser executable and rerun `npm run e2e`.

### Projects do not persist after restart

Check that the configured `THREADLIGHT_DATA` directory is writable and persistent. The default is the repository's `data/` directory.
