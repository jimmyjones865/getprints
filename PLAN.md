# Plan: getprints — CUPS print drop app

**Status:** Draft

## Context

Single-page web app for submitting files to a LAN CUPS server. Drop a PDF or image, pick a printer (populated from CUPS), set options, print. No history, no auth.

## Stack

- **Frontend:** Vanilla HTML + JS + CSS (no framework, no build step)
- **Backend:** Node.js + Express, minimal
- **CUPS:** `cups-client` Alpine package → shell out to `lpstat` / `lp`
- **Docker:** single-stage Alpine Node.js container

## Project structure

```
getprints/
  public/
    index.html        single page, all markup
    app.js            all frontend logic (~200 lines)
    style.css         Nord dark theme, hand-rolled
  index.js            Express server — serves public/ + API routes
  cups.js             lpstat / lp wrappers (execFile, no shell injection)
  package.json
  Dockerfile
  docker-compose.yml
  .env                user-edited, not committed
```

Express serves `public/` as static and handles `/api/*` routes. No proxy, no build step.

## Configuration (.env)

```
CUPS_HOST=192.168.x.x
CUPS_PORT=631
PORT=3000
```

## Backend API

**GET /api/printers**
- Runs: `lpstat -a -h $CUPS_HOST:$CUPS_PORT`
- Parses: first word of each line = printer name
- Returns: `{ok: true, printers: ["HP_LaserJet", ...]}` or `{ok: false, printers: [], error: "unreachable"}`
- Always returns 200; `ok: false` signals server down

**POST /api/analyze** (multipart/form-data)
- Field: `file` (binary)
- Detects orientation:
  - PDF: regex scan on first ~4KB for `MediaBox` — compare width vs height
  - Image: `image-size` npm package reads header bytes
- Returns: `{orientation: "portrait"|"landscape"}`

**POST /api/print** (multipart/form-data)
- Fields: `file`, `printer`, `copies` (int), `pages` (string, optional), `orientation`, `scale`
- Saves to `/tmp` via multer diskStorage, calls `lp`, cleans up
- Returns: `{ok: true, jobId}` or `{error: "..."}`

## CUPS option mapping

| UI option | lp flag |
|---|---|
| Copies | `-n N` |
| Page range (empty = all) | `-P pages` — omit entirely if empty |
| Portrait | `-o orientation-requested=3` |
| Landscape | `-o orientation-requested=4` |
| Fit to page | `-o print-scaling=fit` |
| 100% | `-o print-scaling=none` |

## Frontend behavior

1. Drop zone (native drag/drop + click-to-browse): PDF and images only, reject others inline
2. After drop:
   - Preview: `<iframe>` for PDF blob URL, `<img>` for images
   - POST to `/api/analyze` → set orientation default
   - Defaults: copies=1, pages="" (all), scale=none, orientation=detected
3. On load and on refresh (↺ button):
   - GET /api/printers → green dot "Connected" or red dot "Unreachable"
   - Populate printer `<select>` or clear it
4. Print button disabled until printer chosen + server reachable
5. Print → POST → inline success/error message
6. After success: reset drop zone, keep printer selection

## Docker

```dockerfile
FROM node:22-alpine
RUN apk add --no-cache cups-client
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 3000
CMD ["node", "index.js"]
```

```yaml
# docker-compose.yml
services:
  getprints:
    build: .
    ports:
      - "3000:3000"
    env_file: .env
    restart: unless-stopped
```

## Verification

1. `docker compose build && docker compose up -d`
2. Open `http://localhost:3000`
3. Check printer list loads (GET /api/printers returns array)
4. Drop a PDF, check preview and auto-detected orientation
5. Print, verify job appears: `lpstat -h CUPS_HOST`
