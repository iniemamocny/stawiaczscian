# apps/api

API requires an `API_TOKEN` environment variable. Clients must send this
token in the `Authorization: Bearer` header with each request.

## Configuration

The API can be configured with the following environment variables:

- `STORAGE_DIR` – directory where converted scans are stored. Defaults to
  `storage`.
- `STORAGE_MAX_AGE_MS` – files older than this many milliseconds are removed
  by a periodic cleanup job. Defaults to `86400000` (24 hours).
- `MAX_UPLOAD_BYTES` – maximum allowed upload size in bytes. Defaults to
  `52428800` (50 MB).

## Metadata

Send additional metadata in a `meta` field when uploading scans. The value
can be JSON or a URL-encoded string. The server stores the parsed data next
to the generated model as `info.json`.

```bash
curl -H "Authorization: Bearer $API_TOKEN" \
  -F file=@scan.zip \
  -F 'meta={"author":"jan"}' \
  http://localhost:4000/api/scans
```

The response contains the scan `id`. Read the saved metadata with:

```js
import fs from 'fs/promises';
const dir = process.env.STORAGE_DIR || 'storage';
const info = JSON.parse(await fs.readFile(`${dir}/${id}/info.json`, 'utf8'));
console.log(info.author);
```

## Responses

Both `POST /api/scans` and `GET /api/scans/{id}/room.glb` may return:

- `401` – Unauthorized
- `400` – Bad request
- `500` – Server error

`GET /api/scans/{id}/room.glb` may also return:

- `404` – Not found
