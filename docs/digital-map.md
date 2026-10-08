# DND Dijital Harita

The `/digital-map` module persists one shared IT infrastructure graph, independently of the organization chart. The browser loads infrastructure only from the protected API; no real topology template is embedded in client JavaScript. An absent document opens an empty editor for ADMIN. The explicit installer can seed the confirmed topology; startup and page loads do not seed the database.

## Access

Map reads/saves and image uploads/downloads require an active ADMIN account. MANAGER and every other role are denied. The module checks the authenticated identity and current database account on each request, so an old ADMIN token stops granting access if the account is deactivated or its current role changes. PREVIEW identities, including identities marked `originalRole: PREVIEW` or `isPreview: true`, are rejected before infrastructure is read. The global preview role-rewriting interceptor does not grant access.

Row-level security is enabled without direct-client policies, matching the organization module. Supabase client roles cannot bypass the Nest API permissions; Prisma accesses the table as its owner.

## API and concurrency

- `GET /digital-map` returns `{ id, name, nodes, edges, version, updatedAt, updatedByName, canEdit }`.
- A document that has never been saved returns ID `dnd-digital-map`, name `DND Dijital Harita`, empty arrays, version `0`, null update metadata, and `canEdit: true`.
- `PUT /digital-map` accepts `{ name, nodes, edges, version }` and returns the newly saved workspace.
- Each successful save increments the version. Send the version returned by the most recent GET/PUT. A stale version returns HTTP 409 with code `DIGITAL_MAP_VERSION_CONFLICT`; reload before retrying. The database primary key also arbitrates concurrent initial saves.
- HTTP 400 with code `DIGITAL_MAP_INVALID` identifies malformed graphs. Unknown fields are discarded. Nodes and edges are replaced together, never partially.
- `updatedById` and `updatedByName` capture the actual database account at save time. They are snapshots, not a revision history.

Allowed nodes: SERVER, MACHINE, CLOUD, SERVICE, BACKEND, DATABASE, WEBSITE, PANEL, SYSTEM, GROUP, GATEWAY. Allowed connections: ACCESS, API, DATABASE, NETWORK, DATA. Optional edge `bidirectional` is a boolean. Parents must exist, parent cycles are forbidden, nesting is limited to eight levels, and connections must reference distinct existing nodes.

| Container | Allowed children                                                             |
| --------- | ---------------------------------------------------------------------------- |
| SERVER    | MACHINE, SERVICE, BACKEND, DATABASE, WEBSITE, PANEL, SYSTEM                  |
| MACHINE   | SERVICE, BACKEND, DATABASE, WEBSITE, PANEL, SYSTEM                           |
| CLOUD     | SERVER, MACHINE, SERVICE, BACKEND, DATABASE, WEBSITE, PANEL, SYSTEM, GATEWAY |
| SERVICE   | BACKEND, DATABASE, WEBSITE, PANEL, SYSTEM                                    |

Optional node fields: `systemKey` (80 characters), `url` (2,048 characters, absolute HTTP/HTTPS without credentials), `imageId` (an existing uploaded image ID). An empty URL or image ID clears that field. Old records without these fields remain valid. Graph saves check all referenced image IDs before storing the document.

Validation limits: 250 nodes, 1,000 edges; IDs of 1–120 ASCII letters/digits/underscore/dot/colon/hyphen; names of 1–160 characters; finite coordinates from -100,000 to 100,000; dimensions from 80 to 10,000. Notes allow 4,000 characters, addresses 2,048, technology/edge label/access 240, owner/protocol 160. Environment and status use the enum values in `digital-map.dto.ts`. The existing application/proxy HTTP body limits still apply.

## Private screenshots

- `POST /digital-map/images` accepts multipart field `file`, exactly one PNG/JPEG/WebP image up to 5 MiB (5,242,880 bytes). It returns HTTP 201 with `{ id, name, mimeType, size, createdAt }`. Send the Bearer token; let the browser set the multipart Content-Type boundary.
- File signatures must match the declared image MIME. SVG, other file types, empty uploads, and mismatched content are rejected with HTTP 400/code `DIGITAL_MAP_IMAGE_INVALID`. Oversize uploads return HTTP 413. These are raster signature checks, not server-side image decoding or resizing.
- `GET /digital-map/images/:id` authenticates again and streams the bytes with the stored image MIME, `Cache-Control: private, no-store` and `X-Content-Type-Options: nosniff`. Missing images return 404. Clients fetch with Authorization and display the resulting blob URL; there is no public asset URL.
- `DigitalMapImage` stores metadata and `BYTEA` content separately from graph JSON. RLS is enabled without direct-client policies. Uploader ID/name are saved as snapshots from the actual account.
- Uploading creates an image without changing the map version. Set the node's `imageId` and save the map to persist the association. Removing/replacing that reference does not delete images, including unsaved uploads, so other open drafts keep working. There is no deletion endpoint or automatic cleanup in this module.

## Database rollout

The base migration `prisma/migrations/20260915120000_add_digital_map/migration.sql` adds `DigitalMapDocument`. The additive migration `prisma/migrations/20260915140000_add_digital_map_images/migration.sql` adds the private `DigitalMapImage` table with MIME/size constraints and RLS. The image migration does not alter the already-applied base migration or existing data. No database migration runs on application startup.

Before deploying, review pending migrations for the target environment and its database backup. From `api`, run the normal deployment migrations and regenerate the Prisma client:

```sh
npx prisma migrate status
npx prisma migrate deploy
npm run prisma:generate
npm run build
```

`migrate deploy` applies **all pending migrations**, including any earlier migrations, so verify the full pending list before running it against a shared database. Deploy/restart the API using the generated client. Then open Dijital Harita with an authorized account, save a document, reload, and confirm its nodes, connections, metadata and version survive. The new table must exist before the endpoints can be used; it is intentionally not created on startup.

Local checks (no database required):

```sh
npm test -- --runInBand --watchman=false digital-map
npm run build
```

### Install the confirmed DND topology

`scripts/install-digital-map.cjs` reads the current Turkish topology directly from the web source and validates it with the current API validator. It defaults to a **read-only dry-run** against the database configured in `api/.env`, showing the current version, node/edge counts, topology hash and pending migrations. It does not apply migrations.

```sh
# Validate source without contacting the database.
node scripts/install-digital-map.cjs --validate-only

# Read the existing document and migration state; no writes or backup files.
node scripts/install-digital-map.cjs --dry-run

# After reviewing the dry-run, use its reported current version.
# The value 0 below is for a document that does not yet exist.
node scripts/install-digital-map.cjs --apply --expected-version 0
```

`--apply` replaces the shared diagram from the current web topology. An existing row is locked through backup and update, and the version increments once. `--expected-version` aborts if someone saved since the dry-run. Concurrent first creation is protected by the singleton primary key. An already identical graph is left unchanged.

Before any insert/update, the script writes and flushes `/private/tmp/dnd-digital-map-backup-<timestamp>.json` with mode `0600`. It contains the full `previousDocument`, or `null` if none existed. A backup failure aborts the transaction; a subsequent database failure rolls back changes and leaves the backup available. The resulting path is printed after successful apply. Keep the backup while reviewing the installed map; it contains private infrastructure details.

Changes are attributed to `system:digital-map-setup` / `DND altyapı kurulumu`, rather than impersonating a user. Existing screenshot records are retained. For restoration, use the backup's `previousDocument.name/nodes/edges` with the **current** workspace version in an authenticated `PUT /digital-map`; do not reuse the backup's stale version. A `null` previous document means there was no earlier saved map. The installer provides no automatic rollback/delete operation.

### Add the Reserve booking flow to an existing map

`scripts/add-reserve-hotelrunner-flow.cjs` defaults to a read-only dry-run. Use `--apply --expected-version N` with the reviewed current version to add/update only `data-dnd-reserve-hotelrunner`: Reserve booking engine sends reservation data to HotelRunner PMS / Channel Manager when a booking is created. It validates the merged graph and creates the same private backup before updating edges and audit/version fields. Existing nodes, links, images, layout and unrelated connections remain unchanged. Missing endpoint nodes abort the update.

`scripts/add-hotelrunner-logo-flow.cjs` uses the same dry-run / `--apply --expected-version N` workflow to update only `data-hotelrunner-logo` (HotelRunner PMS → Logo). It retains all other saved connections, including the Reserve booking flow.

`scripts/add-windows-logo-flows.cjs` applies the same workflow atomically to three connections: Talep Restoran → Logo and Talep İnşaat → Logo write data; Logo → Muhasebe CRM represents Accounting CRM reading data from Logo. Only these three edge definitions and the version/update audit fields change; all existing nodes and unrelated flows are preserved.

## Using the editor

Open **Şirket ve kalite → Dijital Harita** (`/digital-map`). An unsaved workspace starts empty; the authorized installer can load the confirmed DND infrastructure template. A saved workspace loads the shared document. The architecture and known URL sources are documented in [the topology guide](../../web/docs/digital-map-topology.md).

- **Sistem görünümü** compacts applications for review. **Teknik detay** opens backend/database components and enables arranging the layout. In technical view, drag an item from the library onto the map or click to add it. Clicking an item type adds it inside the selected compatible host. Servers contain machines/services; machines contain backends, databases and applications.
- Select an item to edit its name, address, technology, environment, status, responsible team and notes. Change **Barındırıldığı yer** to place it in another host. Drag or resize containers to organize the diagram.
- Connect the right port of a source to the left port of a target, or use **Bağlantı ekle**. Set the connection type, protocol (HTTPS, VPN, SSH, etc.) and permission. Select an existing line or its label to edit it.
- **Veri akışı** isolates the twelve business integrations, while **Erişim yolları** isolates access links; **Tüm bağlantılar** includes technical API/database links. The system filter keeps an application and its direct connections.
- **Website & paneller** provides clickable links, screenshot upload and preview. Missing URLs stay editable. Live pages are requested only after the user selects that preview mode.
- **Envanter** lists assets and their hosts. **Erişim matrisi** follows ACCESS links from groups through gateways to systems. API and database links do not imply user permissions. The editor documents access without changing actual system permissions.
- Undo/redo operates on the current draft. **Haritayı kaydet** persists the whole map. JSON export downloads the current draft. Local edits remain on this page until saved; the page warns before browser reload/close with unsaved changes.

Frontend checks, from `web`:

```sh
node --test tests/digital-map-model.test.mjs tests/navigation.test.mjs
npx eslint 'src/app/(app)/digital-map' src/app/_ui/navigation.ts
npm run build
```

`web/tests/digital-map.browser.cjs` exercises the UI against isolated API fixtures; it never reads or writes live CRM records. Set `FRONTEND_URL`, `PLAYWRIGHT_MODULE` and `CHROME_PATH` for the local browser setup.
