# Paper-Katalog und Downloads

Der Web-Agent verwendet die aktuelle PaperMC-API v3 unter `https://fill.papermc.io/v3/projects/paper`.
Die API liefert Versionsgruppen und Build-Listen; der Agent wandelt sie in das bisherige interne API-Format um.
Der User-Agent identifiziert das Projekt mit einer gültigen Kontakt-URL.

Für den Betrieb benötigt der **Backend-Server** ausgehenden HTTPS-Zugriff auf:

- `fill.papermc.io` – Versions- und Build-Katalog
- `fill-data.papermc.io` – Server-JARs

Der Installer wählt den neuesten stabilen Build der **ausgewählten Minecraft-Version**.
Er wechselt weder ungefragt auf eine andere Minecraft-Version noch auf experimentelle Builds.
JARs werden anhand der SHA-256-Prüfsumme aus den API-Metadaten geprüft. Fehlerhafte Dateien werden gelöscht.

Bei einer Störung zeigt die Server-Erstellung eine Fehlermeldung und „Erneut versuchen“.
Bleibt die Meldung bestehen, im Backend-Log den Upstream-Status prüfen: 403 deutet auf eine abgelehnte Anfrage bzw. einen Netzwerkproxy hin; 429 auf ein Anfrage-Limit.
Kataloganfragen haben ein Zeitlimit und wiederholen vorübergehende Netzwerk-/Serverfehler maximal zweimal.
Ein Wechsel der Server-Software verwirft verspätete Antworten des vorherigen Katalogs.

`npm test` enthält Regressionstests für das v3-Format, Cache, Fehlerantworten, stabile Builds und Prüfsummen.
Die Tests verwenden kontrollierte API-Antworten und benötigen keine PaperMC-Verbindung.

Referenz: https://docs.papermc.io/misc/downloads-service/
