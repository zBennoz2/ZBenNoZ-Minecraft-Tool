# Minecraft AMP – Setup & Installation Guide

## Voraussetzungen (alle Betriebssysteme)

Die Anwendung wird **plattformübergreifend identisch über den Agent (Web-Modus)** betrieben.  
Bitte installiere die folgenden Abhängigkeiten abhängig von deinem Betriebssystem.

> 💡 Hinweis:  
> Die Desktop-Version (Electron) wird aktuell **nicht unterstützt**.  
> **Windows, macOS und Ubuntu nutzen ausschließlich den Agent (Web-Version).**

---

## Abhängigkeiten installieren

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
npm --prefix backend install
npm --prefix frontend install
```

---

## Lizenzhinweis (WICHTIG)

🔑 **Beim ersten Start muss eine gültige Lizenz angegeben werden.**

- Die Lizenz wird **direkt beim Start des Agents abgefragt**
- Ohne gültige Lizenz startet die Anwendung nicht
- Stelle sicher, dass du deine Lizenzdatei bzw. deinen Lizenzschlüssel bereit hast

---

## Start der Anwendung (Agent – Web)

```bash
npm run agent:web
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

> Für Download/Entpacken werden keine zusätzlichen System-Tools (wie `unzip` oder `wget`) benötigt, da dies direkt in Node.js erledigt wird.

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
ExecStart=/usr/bin/npm run agent:web
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
PORT=4000 npm run agent:web
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
