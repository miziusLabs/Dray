# Desktop app guidance

Read the [repository guidance](../../AGENTS.md) first. Before changing the desktop UI, read [DESIGN.md](DESIGN.md). Before changing the remote server protocol, read [SERVE-PLAN.md](SERVE-PLAN.md). For iOS protocol work, read [the iOS plan](../ios/PLAN.md).

Harness-specific wire parsing belongs under `src-tauri/src/harness/<harness>/`. Map those messages into the normalized event model in `src-tauri/src/events/events.rs`; keep raw harness payloads out of the frontend and persisted event model.
