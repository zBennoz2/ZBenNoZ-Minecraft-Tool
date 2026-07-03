# Lokale Benutzer- und Instanzrechte

Daten werden lokal unter `data/users.json`, `data/instance_permissions.json` und `data/sessions.json` gespeichert. Passwörter werden mit bcrypt gehasht; Session-Tokens werden nur gehasht gespeichert.

## Rollen
- `admin`: Vollzugriff auf alle Instanzen, globale Einstellungen, System/Diagnose, Benutzerverwaltung und Instanzanlage/-löschung.
- `instance_admin`: Sieht und verwaltet nur explizit freigegebene Instanzen.

## Initialer Admin
Wenn noch kein Benutzer existiert, kann der erste Admin per `POST /api/auth/setup` erstellt werden:

```bash
curl -c cookies.txt -X POST http://localhost:3001/api/auth/setup \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"mindestens8zeichen"}'
```

Alternativ beim Backend-Start setzen: `INITIAL_ADMIN_USERNAME=admin INITIAL_ADMIN_PASSWORD=mindestens8zeichen`.

## Benutzer und Freigaben
Admins verwalten Benutzer in der UI unter `/users` oder per API:
- `GET /api/users`
- `POST /api/users`
- `PATCH /api/users/:id`
- `DELETE /api/users/:id`
- `GET /api/users/:id/permissions`
- `PUT /api/users/:id/permissions` mit `{ "instanceIds": ["..."] }`
- `GET /api/users/permissions/overview`

Alle `/api/instances/:id/*` Routen prüfen serverseitig `requireInstanceAccess`. Globale Adminbereiche nutzen `requireAdmin`.

## API-/Lizenz-Login als Hauptadmin

Der bestehende API-/Lizenz-Login bleibt der Hauptzugang für die Anwendung. Nach einem erfolgreichen API-/Lizenz-Login wird die Session serverseitig als Admin behandelt (`role: admin`, `isAdmin: true`) und die Auth-Response liefert diese Rolle eindeutig an das Frontend zurück.

Falls zu diesem Zeitpunkt noch kein lokaler Admin existiert, legt der Server automatisch genau einen lokalen Fallback-Admin mit der stabilen ID `license_admin` an. Bestehende lokale Admins werden dabei nicht überschrieben und der Fallback wird nicht doppelt erzeugt.

Nach dem ersten erfolgreichen API-/Lizenz-Login können weitere lokale Benutzer in der Benutzerverwaltung angelegt und Instanzen gezielt an `instance_admin`-Benutzer freigegeben werden. `instance_admin`-Benutzer bleiben weiterhin auf ihre zugewiesenen Instanzen beschränkt.
