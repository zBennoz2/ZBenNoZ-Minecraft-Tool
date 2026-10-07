# Minecraft AMP – Setup & Installation Guide

## Voraussetzungen (alle Betriebssysteme)

Die Anwendung wird **plattformübergreifend identisch über den Agent (Web-Modus)** betrieben.  
Bitte installiere die folgenden Abhängigkeiten abhängig von deinem Betriebssystem.

> 💡 Hinweis:  
> Die Desktop-Version (Electron) wird aktuell **nicht unterstützt**.  
> **Windows, macOS und Ubuntu nutzen ausschließlich den Agent (Web-Version).**

---

## Abhängigkeiten installieren

### System-Tools (empfohlen)

Für Downloads und Archive sind folgende Tools hilfreich (teilweise bereits installiert):

- `curl` oder `wget` (Downloads)
- `unzip` / `tar` (Archive für manuelle Importe)

### Windows (schnell & empfohlen)

> Voraussetzung: Windows 10 / 11

Öffne **PowerShell als Administrator** und führe aus:

```powershell
winget install OpenJS.NodeJS.LTS
winget install Git.Git
winget install EclipseAdoptium.Temurin.17.JDK
```

Danach PowerShell **neu öffnen** und prüfen:

```powershell
node -v
npm -v
git --version
java -version
```

---

### macOS

#### Variante A: Mit Homebrew (empfohlen)

```bash
brew install node git
brew install --cask temurin@17
```

#### Variante B: Ohne Homebrew
- Node.js: https://nodejs.org
- Git: https://git-scm.com
- Java 17: https://adoptium.net

Prüfen:

```bash
node -v
npm -v
git --version
java -version
```

---

### Ubuntu Server / Desktop (Linux Install Guide)

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl
```

#### Node.js 20 LTS installieren

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

#### Java 17 installieren

```bash
sudo apt install -y openjdk-17-jre
```

Prüfen:

```bash
node -v
npm -v
git --version
java -version
```

> Hinweis für Hytale: Für Hytale-Server wird **Java 25** benötigt. Installiere zusätzlich eine passende Java-Version (z.B. Temurin 25) oder setze den Java-Pfad in den Instanz-Settings.

---

## Download

Repository klonen:

```bash
git clone https://github.com/zBennoz2/ZBenNoZ-Minecraft-Tool.git
cd ZBenNoZ-Minecraft-Tool
```

---

## Installation (einmalig)

```bash
npm install
npm run build
npm start
```

`npm install` installs both backend and frontend dependencies automatically. `npm run build` builds the React frontend first and then the backend. `npm start` serves both at the same origin on port `3001` by default; no `.env` file is required.

---

## Lizenzhinweis (WICHTIG)

🔑 **Beim ersten Öffnen meldest du dich im Panel mit deinem zbennoz.com-Account an.**

- Die Lizenz und das Gerät werden beim zentralen Login geprüft.
- Bei erfolgreichem ersten Login wird der lokale `license_admin` automatisch erstellt.
- Es ist weder eine `.env`-Datei noch ein vorab angelegter lokaler Benutzer erforderlich.

---

## Start der Anwendung (Agent – Web)

```bash
npm start
```

Der Agent startet standardmäßig auf **Port 3001**.

Weboberfläche im Browser öffnen:

```
http://SERVER_IP:3001
```

---

## Hytale Downloader (optional)

Der Hytale-Downloader wird per URL geladen. Die Priorität ist:

1. **Instanz-Setting** (Settings → Downloader URL)
2. **Globale Settings**
3. **ENV** `HYTALE_DOWNLOADER_URL`
4. **Default** `https://downloader.hytale.com/hytale-downloader.zip`

Wenn nichts gesetzt ist, nutzt der Agent automatisch die Default-URL.

> Hinweis: Die offizielle `hytale-downloader.zip` enthält **keinen Server-JAR**. Sie enthält nur die Downloader-Binaries und eine QUICKSTART-Datei. Der eigentliche Server kommt erst über den Downloader.

### Prepare-Logs vs. Server-Console

- **Prepare-Logs** sind ein eigener Stream für den Download-/Installations-Workflow und laufen **auch dann, wenn der Server nicht startet**.
- **Server-Console** zeigt nur die laufende Serverausgabe.
- Der OAuth-Code erscheint sofort im **Hytale-Prepare-Panel** (nicht mehr nur in der Console).
- Die Prepare-Logs sind unabhängig von der Server-Console und bleiben sichtbar, auch wenn noch kein Server läuft.

### Hytale Prepare Ablauf

1. **Prepare** klicken → der Device-Flow startet.
2. UI zeigt **Verification URL + Code** sofort inkl. Ablauf-Countdown.
3. Code bestätigen → Download & Extract laufen automatisch.
4. Sobald der JAR/Assets-Pfad gespeichert ist, ist der Server **Configured** und kann gestartet werden.

### OAuth-Flow (Device Flow)

1. Beim ersten **Prepare** startet der Downloader den OAuth-Device-Flow.
2. Im Prepare-Log erscheint eine URL + Code (z.B. `https://accounts.hytale.com/device`) inklusive Ablaufhinweis.
3. Code bestätigen → der Downloader erkennt den Erfolg automatisch und setzt den Download fort.
4. Die Credentials werden anschließend wiederverwendet.

**Polling-Details (RFC 8628):**

- Das Tool respektiert `expires_in` und `interval` aus dem Device-Flow.
- Bei `authorization_pending` wird weiter gepollt, bei `slow_down` wird das Intervall um +5s erhöht.
- `expired_token` → Code abgelaufen (neuen Code generieren).
- `access_denied` → Benutzer hat den Zugriff abgelehnt.

**Credentials-Speicherort (pro Instanz):**

```
<instance>/.hytale-downloader-credentials.json
```

Wenn die Datei beschädigt oder unvollständig ist, wird sie beim nächsten Prepare verworfen und neu erzeugt.

### Typische Fehler (Hytale)

- **"Loading forever"** → der Device-Flow wird nicht weiter gepollt (z.B. `slow_down`/`interval` ignoriert).
- **Code abgelaufen** → sofort **Retry Prepare** klicken, um einen neuen Code zu erhalten.
- **Uhrzeit / Zeitzone** → Stelle sicher, dass die Host-Zeit korrekt ist.
- **Credentials löschen** → `<instance>/.hytale-downloader-credentials.json` entfernen und Prepare erneut ausführen.

### Globale Settings (optional)

Lege eine Datei unter `data/settings.json` an:

```json
{
  "hytale": {
    "downloaderUrl": "https://downloader.hytale.com/hytale-downloader.zip"
  }
}
```

### ENV-Variable (optional)

```bash
export HYTALE_DOWNLOADER_URL="https://downloader.hytale.com/hytale-downloader.zip"
```

---

## Autostart unter Linux (systemd – empfohlen)

### systemd Service anlegen

```bash
sudo nano /etc/systemd/system/ZBenNoZ-Minecraft-Tool.service
```

Inhalt:

```ini
[Unit]
Description=ZBenNoZ-Minecraft-Tool
After=network.target

[Service]
Type=simple
User=lager
WorkingDirectory=/home/user/ZBenNoZ-Minecraft-Tool
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

> ⚠️ Passe **User** und **WorkingDirectory** an dein System an.

---

### Service aktivieren & starten

```bash
sudo systemctl daemon-reload
sudo systemctl enable ZBenNoZ-Minecraft-Tool
sudo systemctl start ZBenNoZ-Minecraft-Tool
```

Status prüfen:

```bash
sudo systemctl status ZBenNoZ-Minecraft-Tool
```

Logs anzeigen:

```bash
journalctl -u ZBenNoZ-Minecraft-Tool -f
```

Service stoppen:

```bash
sudo systemctl stop ZBenNoZ-Minecraft-Tool
```

---

## Firewall

### Ubuntu (UFW)

```bash
sudo ufw allow 3001/tcp
```

---

## Häufige Probleme (Troubleshooting)

### ❌ Port bereits belegt
```bash
PORT=4000 npm start
```

---

### ❌ Keine Verbindung zur Weboberfläche
- Läuft der Agent?
- Firewall-Regeln prüfen
- Richtige IP / Domain verwenden

---

### ❌ Lizenz wird nicht akzeptiert
- Lizenz korrekt eingegeben
- Systemzeit korrekt
- Keine manipulierten Dateien

---

## Support & Hilfe

- 💬 Discord: **ZCronus** (empfohlen), **ZBenNoZ**
- 🌐 Webseite: https://zbennoz.com
- 📧 E-Mail: service.zbennoz@gmail.com

---

## Copyright

© ZBenNoZ Gaming  
Alle Rechte vorbehalten.
