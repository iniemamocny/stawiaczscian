
# SETUP

## API
```bat
cd apps\api
npm install
copy .env.example .env
notepad .env   # ustaw BLENDER_PATH
npm run dev    # http://localhost:4000
```
Test:
```bat
curl -v -X POST http://localhost:4000/api/scans ^
  -H "Authorization: Bearer test" ^
  -F "file=@C:\Users\%USERNAME%\Desktop\test.obj"
```
