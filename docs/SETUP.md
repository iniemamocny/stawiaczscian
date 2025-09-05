
# SETUP

## API
```bat
cd apps\api
npm install
copy .env.example .env
notepad .env   # ustaw BLENDER_PATH i API_TOKEN
npm run dev    # http://localhost:4000
```
Test:
```bat
curl -v -X POST http://localhost:4000/api/scans ^
  -H "Authorization: Bearer <API_TOKEN>" ^
  -F "file=@C:\Users\%USERNAME%\Desktop\test.obj"
```

## Konfiguracja aplikacji

### Android

W pliku `apps/android/local.properties` ustaw:

```
API_URL=http://10.0.2.2:4000/api/scans
API_TOKEN=REPLACE_WITH_API_TOKEN
```

Wartości te zostaną udostępnione w `BuildConfig` jako `API_URL` oraz `API_TOKEN`.

### iOS

W pliku `apps/ios/Info.plist` ustaw klucze `API_URL` i `API_TOKEN`.

### Web

Komponent `web-snippets/ImportRoom.tsx` oczekuje adresu API w propsie `apiUrl` lub w zmiennej środowiskowej `REACT_APP_API_URL`.

## Limity czasowe połączeń

Aplikacje mobilne używają domyślnego limitu czasu wynoszącego 30 s na nawiązanie, odczyt i zapis danych podczas komunikacji z API.
