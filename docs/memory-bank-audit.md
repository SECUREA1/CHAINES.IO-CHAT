# CHAINeS Memory Bank persistence audit

## Page-by-page persistence plan

- `index.html` (feed): `feed-draft`, `feed-filters`, `preferences`, `ui-state`, and the shared `legacy-storage` bridge store composer text, category/listing controls, non-sensitive UI choices, feed view, theme, caption language, and the safe post cache used by mobile/offline views. Posts remain server-first in SQLite when the API is reachable.
- `marketplace.html`: `marketplace-draft`, `marketplace-filters`, `marketplace-private-state`, and the shared `legacy-storage` bridge store listing drafts, search/sort/filter/tab state, dating-profile draft fields, safe contact draft text, likes, contacts, matches, and listing/post cache data consistently on desktop and mobile. Listings, comments, likes, matches, contacts, and boosts remain server-authoritative when the API is reachable.
- `profile.html`: `profile`, `preferences`, and the shared `legacy-storage` bridge store profile-edit drafts, UI preferences, profile pictures, wallet/profile calendar state, delivery request cache, and rewards cache so profile pages hydrate the same data across desktop and mobile. Completed profile fields are stored in the users table and profile updates require the authenticated session user.
- `rewards-program.html`: `rewards` plus the shared `legacy-storage` bridge keep `chaines_rewards_v1` synchronized across pages, including feed posts, marketplace activity, video/live actions, profiles, follows, wallets, and mobile sessions. Durable server rewards remain the desired source of authority when available.
- `private-chat.html`: `private-chat-drafts` stores only draft message text and safe UI state. Delivered private messages stay in SQLite.
- `delivery-services.html`: `delivery-draft` stores delivery request form drafts and safe layout choices. Delivery order submission requires a valid server session.
- `secure.html`: `broadcast-preferences` stores non-sensitive broadcast preferences only. Temporary unlock state and credentials are excluded.
- `chaines-ar-collectibles.html`: `collectibles-preferences` stores safe AR/collectible preferences.
- `omconsole_render_single*.html`: existing local-only game settings remain outside authenticated platform identity until those pages adopt server sessions.

## Legacy storage key replacements

| Legacy key | Replacement |
| --- | --- |
| `chaines_username` | `/api/session` authenticated user (`user.id`, `username`) |
| `chaines_profile_pic` | `users.profile_pic`; cached in `profile` namespace |
| `chaines_messages` | SQLite posts/messages plus safe mobile/offline cache in `legacy-storage`; safe drafts in `feed-draft` |
| `chaines_rewards_v1` | `user_rewards`, `rewards`, and mirrored `legacy-storage` cache for all pages |
| `chaines_marketplace_likes` | server marketplace listing state |
| `chaines_marketplace_contacts` | authenticated server records; drafts in `marketplace-private-state` |
| `chaines_marketplace_dating_matches` | `dating_likes` table |
| `chaines_theme` | `preferences.theme` |
| `chaines_ws_url` | `preferences.wsUrl` |
| `chaines_autodelete` | `preferences.autodelete` |
| `chaines_obs_rpc` | re-entry or dedicated secure server storage if required |
| `chaines_obs_key` | **not migrated**; sensitive stream key |
| `chaines_verified_users` | server verified/session data; cache only |
| `mixer_current_chain` | `wallet-preferences.selectedChain` |
| `mixer_current_currency` | `wallet-preferences.selectedCurrency` |
| `chaines_delivery_requests` | `legacy-storage` shared safe delivery/profile request cache |
| `chaines_profile_calendar_v1` | `legacy-storage` shared profile calendar cache |
| `chaines_profile_calendar_reminders_v1` | `legacy-storage` shared profile calendar reminders cache |
| `chaines_profile_entry_wallets_v1` | `legacy-storage` shared profile entry wallet cache |
| `chaines_profile_airdrop_wallets_v1` | `legacy-storage` shared profile airdrop wallet cache |
| `captionLanguage` | `preferences.captionLanguage` and `legacy-storage` cache |
| `chaines_session_validation` | **not migrated**; session/auth validation data |

## Required environment variables

- `DB_PATH`: path to mounted persistent SQLite storage. If omitted, startup warns that repo-local `app.db` is being used.
- `ADMIN_USERNAME`: optional administrative username; defaults to `admin`.
- `ADMIN_PASSWORD`: required to bootstrap/update the admin account. No default password is shipped.
- `SESSION_DAYS`: optional session lifetime in days; defaults to `7`.

Rotate the previously exposed wallet override and admin credentials before deployment.
