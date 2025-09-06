# apps/api

API requires an `API_TOKEN` environment variable. Clients must send this
token in the `Authorization: Bearer` header with each request.

## Health check

`GET /health` returns `{"status":"ok"}` and does not require an
`Authorization` header. Use it to verify that the service is running.

## Configuration

The API can be configured with the following environment variables:

- `API_TOKEN` – secret token used for Bearer authentication. Clients must
  send it in the `Authorization: Bearer` header with each request.
- `STORAGE_DIR` – directory where converted scans are stored. Defaults to
  `storage`.
- `UPLOAD_DIR` – directory for temporary uploads. Defaults to `uploads`.
- `STORAGE_MAX_AGE_MS` – files older than this many milliseconds are removed
  by a periodic cleanup job. Defaults to `86400000` (24 hours).
- `MAX_UPLOAD_BYTES` – maximum allowed upload size in bytes. Defaults to
  `52428800` (50 MB).
- `MAX_META_BYTES` – maximum allowed metadata size in bytes. Defaults to
  `16384` (16 kB).
- `CONCURRENCY` – maximum number of conversions processed in parallel.
  Defaults to `2`.
- `QUEUE_LIMIT` – how many conversion requests may wait in queue. When the
  limit is reached, new requests are rejected with `429`. Defaults to `10`.
- `ALLOWED_ORIGINS` – comma-separated list of allowed CORS origins (URLs).
- `BLENDER_PATH` – path to the Blender executable. Defaults to `blender`. The
  server verifies Blender is available on startup.
- `LOG_FORMAT` – format for HTTP request logs. Defaults to `combined`.

The upload and storage directories are created automatically if they do not exist.

Requests are limited to 30 per minute. When a limit is exceeded the server
responds with `429` and includes a `Retry-After: 60` header telling clients how
many seconds to wait before retrying.

## Allowed formats

Uploads are accepted only in the following file formats:

- `.obj`
- `.ply`
- `.usd`
- `.usda`
- `.usdz`

Files with other extensions are rejected.

## Cleanup

Uploaded source files are deleted after conversion.

## Metadata

Send additional metadata in a `meta` field when uploading scans. The value
can be JSON or a URL-encoded string. The server stores the parsed data next
to the generated model as `info.json`. Metadata larger than `MAX_META_BYTES`
is rejected.

```bash
curl -H "Authorization: Bearer $API_TOKEN" \
  -F file=@scan.zip \
  -F 'meta={"author":"jan"}' \
  http://localhost:4000/api/scans
```

The response contains the scan `id` (UUID) and `url`, for example
`http://localhost:4000/api/scans/{id}/room.glb`. Use this `url` or the
`id` with `GET http://localhost:4000/api/scans/{id}/room.glb` to download
the converted model. Read the saved metadata with:

```js
import fs from 'fs/promises';
const dir = process.env.STORAGE_DIR || 'storage';
const info = JSON.parse(await fs.readFile(`${dir}/${id}/info.json`, 'utf8'));
console.log(info.author);
```

## Responses

Both `POST http://localhost:4000/api/scans` and
`GET http://localhost:4000/api/scans/{id}/room.glb` may return:

- `401` – Unauthorized
- `400` – Bad request
- `500` – Server error
- `429` – Too many requests (rate limit exceeded)

`POST http://localhost:4000/api/scans` may also return:

- `429` – Too many requests (conversion queue full)
  (includes a `Retry-After` header with wait time in seconds)

`GET http://localhost:4000/api/scans/{id}/room.glb` may also return:

- `404` – Not found
- `429` – Too many requests

## Graceful shutdown

Terminate the process with `SIGINT` or `SIGTERM` (for example by pressing
`Ctrl+C`). The server clears the conversion queue and runs cleanup tasks
before exiting, ensuring temporary uploads and old files are removed.
