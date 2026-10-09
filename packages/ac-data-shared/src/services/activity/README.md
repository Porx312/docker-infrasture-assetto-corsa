# Activity feed

Canonical implementation: `packages/ac-data-backend/src/services/activity/`.

Edge no longer hosts Activity UI or `/admin/activity` routes (fleet hub-only).
Edge publishes `worker_error` events via `ac-data-edge/src/services/workerErrorPublish.ts`.
