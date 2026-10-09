# Redis-free room migration

The deployed Vercel frontend must keep using `/api/room` until a Cloudflare
Worker URL is configured and tested. Do not remove the Redis variables before
that cutover.

## Target

- One Durable Object instance named `tower-war-global` owns the single shared
  match.
- The object stores the authoritative room, seat tokens, revision, and a bounded
  command/delta log in Durable Object storage.
- WebSocket clients receive one full snapshot after connect/resync, then ordered
  deltas. The object ticks only while a match is active.
- `NEXT_PUBLIC_ROOM_WS_URL` is the explicit frontend switch. When absent, the
  existing HTTP/Redis transport remains active.

## Wire protocol

Client messages:

```json
{ "type": "join", "name": "Анна", "team": "you", "seatToken": null }
{ "type": "resume", "seatToken": "...", "revision": 42 }
{ "type": "command", "seatToken": "...", "commandId": "...", "action": {} }
{ "type": "resync", "seatToken": "..." }
```

Server messages:

```json
{ "type": "snapshot", "revision": 42, "seatToken": "...", "room": {} }
{ "type": "delta", "baseRevision": 42, "revision": 43, "room": {}, "game": {} }
{ "type": "ack", "commandId": "...", "revision": 43 }
{ "type": "resync-required", "revision": 43 }
```

The client applies a delta only when `baseRevision` equals its current revision.
Any gap, duplicate seat conflict, decode failure, or reconnect without a usable
revision requests a snapshot. Commands are idempotent by `commandId`.

## Cloudflare resources

Create a separate Worker package only when the Cloudflare account is available.
Its `wrangler.jsonc` needs:

```json
{
  "name": "tower-war-room",
  "main": "src/worker.ts",
  "compatibility_date": "2026-10-01",
  "durable_objects": {
    "bindings": [
      {
        "name": "ROOM",
        "class_name": "RoomObject"
      }
    ]
  },
  "migrations": [
    {
      "tag": "v1",
      "new_sqlite_classes": ["RoomObject"]
    }
  ]
}
```

The Worker routes every WebSocket upgrade to
`env.ROOM.getByName("tower-war-global")`. The object validates commands with the
existing `applyPlay` rules, persists each accepted revision before broadcast,
and stores seat tokens server-side. Tokens are opaque random values; the browser
keeps only its own token in local storage.

## Cutover checklist

1. Deploy the Worker to a staging hostname and configure its allowed frontend
   origin.
2. Run protocol tests for snapshot/delta, revision gaps, reconnect with the same
   seat token, two simultaneous players, duplicate commands, and object restart.
3. Soak a four-player match through a Worker restart and browser refresh.
4. Set `NEXT_PUBLIC_ROOM_WS_URL` only in a Vercel preview deployment. Verify that
   absence of the variable still selects `/api/room`.
5. Promote the variable to production and monitor reconnect/resync rates.
6. Keep Redis configured for rollback through at least one full release.
7. Remove `/api/room` and Redis credentials only after the WebSocket path has
   proven seat restoration and single-room behavior in production.
