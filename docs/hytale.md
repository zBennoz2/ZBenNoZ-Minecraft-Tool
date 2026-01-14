# Hytale Server

This document describes how to install and operate a Hytale server instance in the Minecraft Software panel.

## Requirements

- Java 25 (Adoptium/Temurin 25 required).
- UDP port **5520** open for player traffic.
- Optional: Docker runtime via `docker/hytale/Dockerfile` for reproducible Java 25.

## Default Ports

| Purpose | Port | Protocol |
| --- | --- | --- |
| Game traffic | 5520 | UDP |

## Install Methods

### Downloader CLI (recommended)

1. Provide the downloader URL in the create wizard or set `HYTALE_DOWNLOADER_URL`.
2. The panel downloads `hytale-downloader.zip`, extracts it, and runs:

   ```bash
   ./hytale-downloader -download-path game.zip
   ```

3. The archive is unpacked so `HytaleServer.jar` and `Assets.zip` live in the instance server directory.

### Import Existing Files

If you already have a Hytale server bundle:

1. Provide a path to the `Server/` directory and `Assets.zip`.
2. The panel copies the contents into the instance server directory.
3. Validation ensures `HytaleServer.jar` and `Assets.zip` exist.

## Start Command

The panel launches Hytale with:

```bash
java -jar HytaleServer.jar --assets ./Assets.zip --bind 0.0.0.0:5520
```

Optional settings include:

- Bind address
- UDP port
- Auth mode (`authenticated` by default; `offline` only when explicitly set)
- JVM args (memory, AOT cache, etc.)

## Authentication (Device Code Flow)

After the first boot:

1. In the Console tab, click **Console Quick Command** to send:
   ```
   /auth login device
   ```
2. Open `https://accounts.hytale.com/device`.
3. Enter the device code shown in the panel logs.
4. Once the log shows **Authentication successful!**, the panel status switches to authenticated.

> Note: The Hytale manual states a limit of 100 servers per license.

## Persistent Data

The following paths should be persisted in volume mounts:

- `universe/`
- `config.json`
- `whitelist.json`
- `permissions.json`
- `mods/`
- `logs/`
- `.cache/`

## Updates

Use the **Check version** and **Update** buttons in Settings. The panel runs:

```bash
./hytale-downloader -print-version
./hytale-downloader -download-path game.zip
```

and re-installs server files and assets.

## Docker

The provided Dockerfile uses Temurin 25:

```bash
docker build -t hytale-server -f docker/hytale/Dockerfile .
```

At runtime, mount `/server` with your instance files and expose UDP 5520.
