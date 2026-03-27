# Login & Lizenzprüfung (Desktop)

Diese Anwendung nutzt ein Login-System gegen die Webseite (z. B. `https://zbennoz.com`). Die Tokens werden lokal sicher gespeichert und die Lizenz regelmäßig geprüft.

## Konfiguration (Base-URL & Verhalten)

Setze die Base-URL des Web-Backends über ENV-Variablen im **Backend**:

| Variable | Standard | Beschreibung |
| --- | --- | --- |
| `AUTH_BASE_URL` | `https://zbennoz.com` | Base-URL der Webseite/API. Muss **HTTPS** sein. |
| `AUTH_ALLOW_INSECURE` | `false` | Nur für lokale Tests. `true` erlaubt `http://`. |
| `LICENSE_CHECK_INTERVAL_MINUTES` | `15` | Cache/Intervall der Lizenzprüfung (10–30 Minuten empfohlen). |
| `AUTH_GRACE_MODE` | `grace` | `grace` oder `hard`. Grace erlaubt Offline-Zeitraum. |
| `AUTH_GRACE_HOURS` | `24` | Länge der Grace-Period in Stunden. |
| `AUTH_REQUEST_TIMEOUT_MS` | `12000` | Timeout für externe Requests. |

## Erwartete externe API-Endpoints (Web-Backend)

> Diese Contracts sind im Desktop-Backend 1:1 gespiegelt.

### `POST /api/auth/login`
**Request**
```json
{
  "identifier": "user@domain.com",
  "password": "secret",
  "remember": true
}
```

**Response (200)**
```json
{
  "access_token": "jwt-or-opaque",
  "refresh_token": "refresh-token",
  "expires_in": 900,
  "refresh_expires_in": 2592000,
  "user": {
    "id": "123",
    "email": "user@domain.com",
    "name": "User Name"
  },
  "server_time": "2024-01-01T00:00:00Z"
}
```

**Response (401/409)**
```json
{
  "error": "DEVICE_LIMIT",
  "message": "Zu viele Geräte aktiv.",
  "device_limit": 3,
  "devices_used": 3
}
```

### `POST /api/auth/refresh`
**Request**
```json
{
  "refresh_token": "refresh-token"
}
```

**Response (200)**
```json
{
  "access_token": "jwt-or-opaque",
  "expires_in": 900,
  "refresh_token": "refresh-token-optional",
  "refresh_expires_in": 2592000,
  "server_time": "2024-01-01T00:10:00Z"
}
```

### `POST /api/device/register`
**Request**
```json
{
  "device_id": "stable-device-id",
  "device_name": "HOSTNAME",
  "platform": "win32",
  "arch": "x64",
  "os_release": "10.0.22621",
  "app_version": "1.0.0"
}
```

**Response (200)**
```json
{ "ok": true }
```

### `GET /api/license/status`
**Query**
```
?device_id=stable-device-id
```

**Headers**
```
Authorization: Bearer <access_token>
X-Device-Id: stable-device-id
X-Device-Name: HOSTNAME
X-Device-Platform: win32
X-Device-Arch: x64
```

**Response (200)**
```json
{
  "active": true,
  "expires_at": "2024-12-31T23:59:59Z",
  "plan": { "id": "pro", "name": "Pro" },
  "plan_name": "Pro",
  "limits": { "max_instances": 3, "max_devices": 2 },
  "usage": { "instances_used": 1, "devices_used": 1 },
  "support": { "contact_url": "https://zbennoz.com/support", "contact_email": "support@zbennoz.com" },
  "reason": "active",
  "server_time": "2024-01-01T00:10:00Z",
  "grace_until": null,
  "device_limit": 3,
  "devices_used": 1,
  "message": "Lizenz aktiv"
}
```

**Response (402/403)**
```json
{
  "active": false,
  "reason": "expired",
  "expires_at": "2023-12-31T23:59:59Z",
  "plan": "pro",
  "server_time": "2024-01-01T00:10:00Z",
  "grace_until": null,
  "device_limit": 3,
  "devices_used": 1,
  "message": "Lizenz abgelaufen"
}
```

## Lokale App-Endpoints (Frontend → Desktop-Backend)

| Endpoint | Zweck |
| --- | --- |
| `GET /api/auth/session` | Session + Cache-Status laden |
| `POST /api/auth/login` | Login durchführen |
| `POST /api/auth/logout` | Logout (Tokens löschen) |
| `GET /api/license/status` | Lizenzstatus prüfen (optional `?force=1`) |

## UI-Zustände

| Zustand | Beschreibung |
| --- | --- |
| **Abgemeldet** | Login-Formular sichtbar, keine Funktionen aktiv. |
| **Eingeloggt & aktiv** | App ist freigeschaltet. |
| **Gesperrt (inaktiv)** | Lizenz abgelaufen/gesperrt/keine Zuweisung/zu viele Geräte. Buttons: „Erneut prüfen“, „Abmelden“. |
| **Offline/Grace** | Letzter erfolgreicher Check < Grace-Window, UI zeigt Offline-Status, Funktionen bleiben nutzbar. |
