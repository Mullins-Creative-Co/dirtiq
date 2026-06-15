# Railway deployment notes

This app stores its data in a SQLite database named `dirtiq.db`. On Railway, regular app files are rebuilt on every deploy, so SQLite data only persists if the database is written to a Railway Volume.

## Persistent data setup

1. In Railway, open the deployed app service.
2. Go to **Settings → Volumes** and add a volume.
3. Mount the volume at `/data`.
4. Redeploy the service.

At runtime, Railway automatically exposes `RAILWAY_VOLUME_MOUNT_PATH` for attached volumes. The app uses that path first, so the deployed database will be stored at `/data/dirtiq.db` when the volume is mounted at `/data`.

If you want to override the location manually, set `DIRTIQ_DATABASE_DIR` to the directory that should contain `dirtiq.db`.

## Local development

Without Railway volume variables, the app keeps using `data/dirtiq.db` relative to the project root. The `data/` directory is intentionally ignored by Git.
