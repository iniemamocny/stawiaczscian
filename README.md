# 3dskaner monorepo

[![CI](https://github.com/stawiaczscian/stawiaczscian/actions/workflows/ci.yml/badge.svg)](https://github.com/stawiaczscian/stawiaczscian/actions/workflows/ci.yml)

## Dozwolone rozszerzenia

| Rozszerzenie | Content-Type |
|--------------|--------------|
| `.obj` | `model/obj` |
| `.ply` | `model/x-ply` |
| `.usd` | `application/usd` |
| `.usda` | `application/usd` |
| `.usdz` | `model/vnd.usdz+zip` |

## Bezpieczeństwo

API korzysta z biblioteki [Helmet](https://helmetjs.github.io/),
która ustawia standardowe nagłówki bezpieczeństwa chroniące aplikację.

## Kompresja

Odpowiedzi API są kompresowane przy użyciu biblioteki [compression](https://www.npmjs.com/package/compression), co zmniejsza ilość przesyłanych danych.

## Cache

Pobrane modele GLB można cache'ować przez 24 godziny dzięki nagłówkowi
`Cache-Control: public, max-age=86400, immutable`.
Serwer wysyła też `Last-Modified`, więc klienci mogą użyć nagłówka
`If-Modified-Since`, aby uniknąć pobierania niezmienionych plików (odpowiedź
`304`).

## Docker

### Budowa obrazu

```bash
docker build -t stawiaczscian-api apps/api
```

### Uruchamianie

```bash
docker run -p 3000:3000 stawiaczscian-api
```

