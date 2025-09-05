# apps/api

API requires an `API_TOKEN` environment variable. Clients must send this
token in the `Authorization: Bearer` header with each request.

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
const info = JSON.parse(await fs.readFile(`storage/${id}/info.json`, 'utf8'));
console.log(info.author);
```
