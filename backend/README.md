# Minecraft Server Manager – Backend
## Phase 4A – Modded Support (Fabric real)

Dieses Projekt ist das Backend eines Minecraft Server Managers, der über eine REST-API das Erstellen, Vorbereiten und Starten von Minecraft-Servern ermöglicht.

Aktueller Stand: Phase 4A  
→ Vanilla und Modded (Fabric) laufen real, Forge & NeoForge sind katalogisiert und vorbereitet für Installer-/Run-Skripte.

---

## Features (aktueller Stand)

### Core
- REST-API (Express / Node.js)
- Instanzen anlegen & verwalten
- Automatische EULA-Akzeptanz
- Konfigurierbarer RAM (z. B. 2G)
- Headless-Server (nogui)

### Vanilla
- Vanilla Version Catalog
- Server vorbereiten (prepare)
- Server starten (start)

### Modded (Phase 4A)
- Fabric – vollständig real
  - Version Catalog
  - Installer Download
  - Prepare & Start
- Forge – vorbereitet
  - Version Catalog
  - Installer-basierte Installation
- NeoForge – vorbereitet
  - Version Catalog
  - Installer-basierte Installation

---

## Unterstützte Servertypen

| Typ       | Status |
|----------|--------|
| vanilla  | ✅ vollständig |
| fabric   | ✅ vollständig |
| forge    | 🟡 vorbereitet |
| neoforge | 🟡 vorbereitet |

---

## API – Catalog Endpunkte

### Vanilla
GET /api/catalog/vanilla/versions

### Fabric
GET /api/catalog/fabric/versions

### Forge
GET /api/catalog/forge/versions

### NeoForge
GET /api/catalog/neoforge/versions

---

## API – Instanzen

### Instanz erstellen
POST /api/instances

Body (Beispiel):
{
  "name": "FabricTest",
  "serverType": "fabric",
  "memory": { "max": "2G" }
}

---

### Instanz vorbereiten (Prepare)

Lädt Server-JAR / Installer und bereitet das Serververzeichnis vor.

POST /api/instances/:id/prepare

Body:
{
  "serverType": "fabric"
}

Unterstützte serverType-Werte:
- vanilla
- fabric
- forge
- neoforge

---

### Server starten
POST /api/instances/:id/start

### Command an laufende Instanz senden
POST /api/instances/:id/command

Body:
{
  "command": "say Hello"
}

### Server stoppen (graceful)
POST /api/instances/:id/stop

### Server neu starten
POST /api/instances/:id/restart

Antwort: { "id": "...", "status": "running", "pid": 1234 }

Hinweise:
- Bei JAR-Starts (vanilla/paper/fabric) funktionieren Console Commands über stdin und der Stop erfolgt zunächst über `stop`.
- Bei Forge/NeoForge mit Script-Start (run.sh/run.bat) reicht das Skript stdin ggf. nicht durch. In diesem Fall greift der Stop auf Kill zurück, wenn das Command nicht funktioniert.

### Live-Logs (Server-Sent Events)
GET /api/instances/:id/logs/stream

- Content-Type: `text/event-stream`
- Mehrere Clients können parallel lauschen
- Event-Typen:
  - `log` – einzelne Log-Zeile (String)
  - `status` – optionaler Statuswechsel (`starting` | `running` | `stopped` | `error`)

Beispiel (curl):

```
curl -N http://localhost:3001/api/instances/<id>/logs/stream
```

### server.properties lesen & schreiben

GET /api/instances/:id/server-properties

PUT /api/instances/:id/server-properties

Beispiele (HTTPie):

```
http GET http://localhost:3001/api/instances/<ID>/server-properties
http PUT http://localhost:3001/api/instances/<ID>/server-properties set:='{"motd":"Hello"}'
```

### Files API (Server-Verzeichnis)

Alle Pfade beziehen sich auf data/instances/<ID>/server/ und werden gegen Pfadausbrüche abgesichert.

- Liste anzeigen: `GET /api/instances/:id/files?path=/`
- Datei herunterladen: `GET /api/instances/:id/files/download?path=/server.properties`
- Datei(en) hochladen (multipart): `POST /api/instances/:id/files/upload?path=/mods&overwrite=false` (Feld: `file`)
- Ordner anlegen: `POST /api/instances/:id/files/mkdir`
- Datei/Ordner löschen: `DELETE /api/instances/:id/files?path=/mods/Old.jar`
- Textdatei lesen: `GET /api/instances/:id/files/text?path=/config/some.cfg&maxBytes=200000`
- Textdatei schreiben: `PUT /api/instances/:id/files/text`

Beispiele (HTTPie):

```
http GET "http://localhost:3001/api/instances/<ID>/files?path=/"
http --download GET "http://localhost:3001/api/instances/<ID>/files/download?path=/server.properties"
http -f POST "http://localhost:3001/api/instances/<ID>/files/upload?path=/mods&overwrite=false" file@./SomeMod.jar
http POST http://localhost:3001/api/instances/<ID>/files/mkdir path=/ name=config
http DELETE "http://localhost:3001/api/instances/<ID>/files?path=/mods/Old.jar"
```

**Hinweis:** Server-Sent Events (SSE) halten eine offene HTTP-Verbindung und liefern neue Events, sobald sie entstehen. Es ist kein Polling nötig, die Verbindung bleibt mit `keep-alive` offen, bis der Client trennt.

---

## Projektstruktur (vereinfacht)

backend/
├─ src/
│  ├─ api/
│  │  ├─ catalog/
│  │  │  ├─ vanilla.ts
│  │  │  ├─ fabric.ts
│  │  │  ├─ forge.ts
│  │  │  └─ neoforge.ts
│  │  ├─ instances.ts
│  ├─ services/
│  │  ├─ installers/
│  │  │  ├─ fabricInstaller.ts
│  │  │  ├─ forgeInstaller.ts
│  │  │  └─ neoforgeInstaller.ts
│  │  └─ processManager.ts
│  └─ index.ts
└─ data/
   └─ instances/

---

## Phase Roadmap

### Phase 4A (aktuell)
- Vanilla vollständig
- Fabric vollständig
- Forge & NeoForge Katalog + Prepare-Struktur

### Phase 4B
- Mods-Upload (Fabric)
- mods/-Verzeichnis Verwaltung
- Server Stop / Restart

### Phase 5
- Web-UI
- Logs & Live-Konsole
- Backup-System

---

## Hinweis
Dieses Projekt ist ein reines API-Backend und kein klassisches Panel.
Gedacht für Web-UIs, CLI-Tools oder externe Panels.

---

## Lizenz
Internes Projekt / private Nutzung
