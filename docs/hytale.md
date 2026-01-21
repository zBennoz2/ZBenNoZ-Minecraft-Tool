# Hytale Server

This document describes how to install and operate a Hytale server instance in the Minecraft Software panel.

## Requirements

- Java 25 (Adoptium/Temurin 25 required).
- UDP port **5520** open for player traffic.
- No container runtime is required for Hytale. Use a local Java 25 install.

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

3. The downloader archive contains **only** the downloader binary (no server files).
4. The downloaded `game.zip` is unpacked into the instance server directory. The panel searches for the server
   JAR (prefers names containing `server`, otherwise the largest JAR) and records the path alongside
   `Assets.zip`.

### Import Existing Files

If you already have a Hytale server bundle:

1. Provide a path to the `Server/` directory and `Assets.zip`.
2. The panel copies the contents into the instance server directory.
3. Validation searches for the server JAR (name contains `server` or the largest JAR) and confirms
   `Assets.zip` exists.

## Start Command

The panel launches Hytale with:

```bash
java -jar <server-jar> --assets <assets-path> --bind 0.0.0.0:5520
```

Optional settings include:

- Bind address
- UDP port
- Auth mode (`authenticated` by default; `offline` only when explicitly set)
- JVM args (memory, AOT cache, etc.)

## Authentication (Device Code Flow)

During Prepare (Downloader CLI):

1. The panel shows **Authentication required** and displays a URL + code (with expiration countdown).
2. Open `https://accounts.hytale.com/device`.
3. Enter the code from the panel.
4. The panel detects success automatically and continues the download.

Credentials are stored per instance at:

```
<instance>/.hytale-downloader-credentials.json
```

They are reused on subsequent prepares.

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

Use the **Update** button in the dashboard instance widget to fetch the latest Hytale bundle
from the configured release manifest URL. The panel runs:

```bash
curl $HYTALE_RELEASE_MANIFEST_URL
```

and re-installs server files and assets. Configure the manifest source via:

```
HYTALE_RELEASE_MANIFEST_URL=https://example.com/hytale/releases.json
```

Manifest example (JSON):

```json
{
  "latest": "1.4.0",
  "releases": [
    {
      "version": "1.4.0",
      "server": {
        "url": "https://cdn.example.com/hytale/1.4.0/server.zip",
        "sha256": "0123456789abcdef..."
      }
    }
  ]
}
```

## Troubleshooting

- **Code expired** → Run Prepare again to generate a new code.
- **Clock/Timezone issues** → Ensure the host clock is accurate; device flow depends on timestamps.
- **Invalid credentials** → Delete `<instance>/.hytale-downloader-credentials.json` and retry Prepare.
- **Server JAR not found** → Check the server directory for a `*.jar` file. The panel picks a JAR
  containing `server` or the largest JAR available.
