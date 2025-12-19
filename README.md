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

### Ubuntu Server / Desktop

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

---

## Download

Repository klonen:

```bash
git clone https://github.com/zBennoz2/ZBenNoZ-Minecraft-Tool.git
cd ZBenNoZ-Minecraft-Tool
```

---

## Installation (einmalig)

### Abhängigkeiten installieren

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

## Start der Anwendung (Windows / macOS / Ubuntu)

### Agent im Web-Modus starten

```bash
npm run agent:web
```

Der Agent startet standardmäßig auf **Port 3001**.

### Weboberfläche öffnen

Im Browser aufrufen:

```
http://SERVER_IP:3001
```

Beispiele:
- Lokal: `http://127.0.0.1:3001`
- Server im LAN: `http://192.168.x.x:3001`
- Öffentlicher Server: `http://DEINE_DOMAIN:3001`

---

## Firewall / Netzwerk

### Windows
- Stelle sicher, dass **Port 3001** in der Firewall freigegeben ist, falls extern zugegriffen wird.

### Ubuntu (UFW)
```bash
sudo ufw allow 3001/tcp
```

---

## Häufige Probleme (Troubleshooting)

### ❌ Port 3001 bereits belegt
```bash
PORT=4000 npm run agent:web
```

---

### ❌ Keine Verbindung zur Weboberfläche
- Prüfe:
  - Läuft der Agent?
  - Firewall-Regeln
  - Richtige IP / Domain

---

### ❌ Lizenz wird nicht akzeptiert
- Stelle sicher, dass:
  - Die Lizenz vollständig und korrekt eingegeben wurde
  - Datum/Uhrzeit des Systems korrekt sind
  - Keine manipulierten Dateien verwendet werden

---

## Support & Hilfe

Bei Problemen, Fragen oder Feedback erreichst du uns über:

- 💬 **Discord:**  
  **ZCronus** (empfohlen für schnelle Antworten)  
  **ZBenNoz**

- 🌐 **Webseite:**  
  https://zbennoz.com

- 📧 **E-Mail:**  
  service.zbennoz@gmail.com

---

## Copyright

© ZBenNoZ Gaming  
Alle Rechte vorbehalten.
