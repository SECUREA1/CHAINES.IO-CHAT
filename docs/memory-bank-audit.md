# CHAINeS Memory Bank persistence audit

## Page-by-page persistence plan

- `index.html` (feed): `feed-draft`, `feed-filters`, `preferences`, `ui-state` store composer text, category/listing controls, non-sensitive UI choices, feed view, theme, caption language, and layout. Posts remain in SQLite.
- `marketplace.html`: `marketplace-draft`, `marketplace-filters`, `marketplace-private-state` store listing drafts, search/sort/filter/tab state, dating-profile draft fields, and safe contact draft text. Listings, comments, likes, matches, contacts, and boosts are server-authoritative.
- `profile.html`: `profile` and `preferences` store profile-edit drafts and UI preferences. Completed profile fields are stored in the users table and profile updates require the authenticated session user.
- `rewards-program.html`: `rewards` is cached by Memory Bank, with durable `user_rewards` support on the server so localStorage cannot be the source of authority.
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
| `chaines_messages` | SQLite posts/messages; safe drafts in `feed-draft` |
| `chaines_rewards_v1` | `user_rewards` and `rewards` namespace cache |
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
| `chaines_session_validation` | **not migrated**; session/auth validation data |

## Required environment variables

- `DB_PATH`: path to mounted persistent SQLite storage. If omitted, startup warns that repo-local `app.db` is being used.
- `ADMIN_USERNAME`: optional administrative username; defaults to `admin`.
- `ADMIN_PASSWORD`: required to bootstrap/update the admin account. No default password is shipped.
- `SESSION_DAYS`: optional session lifetime in days; defaults to `7`.

Rotate the previously exposed wallet override and admin credentials before deployment.
