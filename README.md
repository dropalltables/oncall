# oncall

Self-hosted push notifications with REST and WebSocket APIs. Works on iOS (16.4+), Android, and desktop browsers. No Apple developer account required.

Built for agents, scripts, and automation to reach you on your phone with interactive notifications you can respond to.

## Setup

Requires `API_KEY` and `VAPID_SUBJECT` environment variables.

```bash
export API_KEY=your-secret-key
export VAPID_SUBJECT=mailto:you@example.com
npm install
npm start
```

VAPID keys are auto-generated on first run and stored in `data/vapid.json`.

### Docker

```bash
docker build -t oncall .
docker run -e API_KEY=your-secret -e VAPID_SUBJECT=mailto:you@example.com -v oncall-data:/app/data -p 3000:3000 oncall
```

### Docker Compose

```bash
docker compose up
```

Set `API_KEY` and `VAPID_SUBJECT` in your environment or in the compose file.

### Coolify

Add the repo with the **Dockerfile** build pack. Set `API_KEY` and `VAPID_SUBJECT` as environment variables in the UI. Add a persistent storage mount at `/app/data`.

## iOS

Push notifications on iOS require the app to be installed as a PWA:

1. Open the app URL in Safari
2. Tap **Share** > **Add to Home Screen**
3. Open from the home screen and tap **Enable Notifications**

## API

All endpoints require authentication via `Authorization: Bearer <key>` header or `?key=<key>` query parameter.

### Send a notification

```
POST /api/notify
```

```json
{
  "title": "Deploy",
  "body": "Ready to ship v2.1",
  "url": "/",
  "tag": "deploy-v21",
  "ui": [
    {"type": "radio", "name": "env", "label": "Environment", "options": ["staging", "prod"]},
    {"type": "checkbox", "name": "approve", "label": "Approve"},
    {"type": "text", "name": "notes", "label": "Notes"}
  ]
}
```

The `ui` field is optional. When present, interactive form elements are rendered in the app. Supported types: `text`, `select`, `radio`, `checkbox`, `button`.

Response:

```json
{
  "messageId": "uuid",
  "results": {"sent": 1, "failed": 0, "removed": 0}
}
```

### Respond to a notification

```
POST /api/respond
```

```json
{
  "messageId": "uuid",
  "text": "approved for prod",
  "data": {"env": "prod", "approve": "true", "notes": "lgtm"}
}
```

`messageId` is optional (defaults to the latest notification). `data` is optional structured data from interactive UI elements.

### Other endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/messages` | Message history (last 100) |
| `GET` | `/api/subscriptions` | List push subscriptions |
| `POST` | `/api/subscribe` | Register a push subscription |
| `DELETE` | `/api/subscribe` | Remove a push subscription |
| `POST` | `/api/purge` | Test all subscriptions, remove stale ones |
| `GET` | `/api/webhooks` | List webhooks |
| `POST` | `/api/webhooks` | Register a webhook `{"url": "...", "events": "response"}` |
| `DELETE` | `/api/webhooks` | Remove a webhook `{"url": "..."}` |
| `GET` | `/api/vapid-public-key` | Get the VAPID public key |

### WebSocket

Connect to `/ws?key=<key>`.

Send:

```json
{"type": "notify", "title": "Alert", "body": "something happened"}
```

Receive:

```json
{"type": "notification", "messageId": "uuid", "title": "...", "body": "..."}
{"type": "response", "responseId": "uuid", "messageId": "uuid", "text": "..."}
{"type": "subscription", "count": 3}
```

### Webhooks

Register a URL to receive POST requests when events occur:

```bash
# Fire on responses only (default)
curl -X POST /api/webhooks -d '{"url": "https://example.com/hook", "events": "response"}'

# Fire on all events
curl -X POST /api/webhooks -d '{"url": "https://example.com/hook", "events": "*"}'
```

Events: `notification`, `response`, `*`.

## CLI

```bash
export ONCALL_URL=https://your-instance.example.com
export ONCALL_KEY=your-api-key

./oncall.sh notify "Alert" "Server disk full"
./oncall.sh notify "Deploy?" "Ship v2.1?" '[{"type":"radio","name":"env","options":["staging","prod"]}]'
./oncall.sh respond "approved"
./oncall.sh messages
./oncall.sh wait <messageId> 60
./oncall.sh webhook-add https://example.com/hook response
```

Run `./oncall.sh help` for all commands.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `API_KEY` | Yes | Shared secret for API authentication |
| `VAPID_SUBJECT` | Yes | Contact URI for VAPID (`mailto:you@example.com`) |
| `VAPID_PUBLIC_KEY` | No | Auto-generated if not set |
| `VAPID_PRIVATE_KEY` | No | Auto-generated if not set |
| `PORT` | No | Server port (default: 3000) |

## License

AGPL-3.0
