# CHAINeS Cloud Memory migration

## Root cause

The stable UI mixed multiple permanent authorities: index posts were restored from
`chaines_messages`, profile data could come from repo-local JSON/profile uploads,
rewards could be awarded in browser `chaines_rewards_v1`, and Render deployed a
static service separately from the Node API/WebSocket service. That meant a
refresh, another browser, or a server restart could see different state depending
on which local cache, WebSocket history, or SQLite table answered first.

## Browser storage authority map

| Key | Classification | New authority |
| --- | --- | --- |
| `chaines_messages` | Legacy permanent feed | SQLite `posts`, `comments`, `reactions`, `feed_entries`; no confirmed post is written back to this key. |
| `chaines_post_retry_queue_v1` | Temporary unsent queue | Browser-only retry queue until `/api/posts` confirms a permanent SQLite post. |
| `chaines_profile_pic` | Legacy permanent profile | SQLite `users.profile_pic`; uploaded files use persistent `/var/data/uploads` in production. |
| `chaines_rewards_v1` | Legacy permanent rewards | SQLite `user_rewards` and `rewards_transactions`; server mutations award idempotently. |
| `chaines_marketplace_likes` | Legacy permanent marketplace interaction | Dedicated marketplace/reaction APIs; not a global memory namespace. |
| `chaines_marketplace_contacts` | Legacy permanent marketplace contact | Marketplace/contact API or authenticated user memory only for drafts. |
| `chaines_marketplace_dating_matches` | Legacy permanent marketplace match | SQLite `dating_likes` / marketplace match records. |
| `chaines_delivery_requests` | Legacy permanent delivery request | Server delivery order/notification persistence. |
| `chaines_profile_calendar_v1` | Legacy profile setting | Authenticated `user_memory` namespace for safe profile calendar state. |
| `chaines_profile_calendar_reminders_v1` | Legacy profile setting | Authenticated `user_memory` namespace for calendar reminders. |
| `chaines_profile_entry_wallets_v1` | Legacy wallet setting | Authenticated `user_memory` namespace `wallet-preferences`. |
| `chaines_profile_airdrop_wallets_v1` | Legacy wallet setting | Authenticated `user_memory` namespace `wallet-preferences`. |
| `chaines_verified_users` | Legacy identity flag | Server user/profile authority; not a browser authority. |
| `chaines_theme`, `captionLanguage`, `liveDebug` | Local UI preference | Browser storage is acceptable for local UI-only behavior. |
| `chaines_ws_url` | Local/shared API preference | Same-origin `/ws` is the default production authority. |
| `chaines_obs_key`, session validation keys | Sensitive local state | Not migrated into ordinary memory namespaces. |

## Rollback-safe sequence

1. Deploy the Node service as the single Render web service with a persistent disk.
2. Start with the new SQLite migrations; they are additive and preserve existing tables.
3. Route feed reads/writes to `/api/feeds/global` and `/api/posts` while keeping live-room WebSocket chat separate.
4. Enable profile and rewards server APIs.
5. Remove legacy browser permanent authority only after server confirmation paths are verified.
