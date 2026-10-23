# Xodus Nexus Neo — Apple Silicon preview

Updated locally on October 22, 2026. This is an experimental macOS port, not an upstream macOS release.

## Run

Open `release-neo/mac-arm64/Xodus Nexus Neo.app` in this source folder, or unzip the accompanying Apple Silicon preview archive and open its app. The app is locally ad-hoc signed, not Developer ID signed or notarized.

The launcher and both backend executables are ARM64 Mach-O binaries. Rosetta is not needed for these components. Tested on this Mac only; the controller helper targets macOS 14 or later. Compatibility with other macOS releases is unverified.

## Verified

- Packaged app starts and renders the real launcher, first-run wizard, Home, Store and Settings.
- Live Microsoft Store featured products and artwork load without signing in.
- The bundled native backend is detected as validated after first-run setup.
- The backend exposes account, login, profile, library, streaming download, progress/control and package selection commands.
- Native CLI and service dynamically link only to macOS system libraries/frameworks.
- macOS Keychain is selected by the upstream backend; the launcher no longer tries to set up Linux D-Bus wallets.
- Mac suite: 804 tests in 93 files. TypeScript checks and production bundling pass.
- Four Linux-only suites are excluded from `test:mac`: AppImage bootstrap, /proc-based download deletion, Linux install IPC integration and .desktop shortcuts. The Linux `test` command remains available.

## Xbox Remote Play and controllers

Open Remote Play in the sidebar or the native Xbox menu. Sign in with the displayed Microsoft device code, enable Remote features on your Xbox, refresh consoles and connect. The original Store account and downloads remain separate. Remote Play credentials can be remembered using Electron safeStorage encryption in the existing app profile, with no plaintext fallback.

Verified with the user's Series X on the home network: connected video at 2560 × 1440 and about 60 fps. The user verified Store sign-in, game searches and licensed downloads, then confirmed live input indicators and Xbox control using a Nintendo Switch Pro controller over Bluetooth.

The ARM64 native helper reads controllers already paired with macOS through Apple's GameController framework. Remote Play prefers this over browser detection, which did not expose this Switch controller correctly. The Controller panel shows the active device, buttons and stick values, supports rescanning and selection, and offers Xbox positions or Nintendo face-button labels. Default: Switch B acts as Xbox A. Input reaches the console only when Remote Play is visible and the app has focus; click the video before playing. Rumble and microphone/party-chat input are not included.

Fullscreen, mute, Xbox/View/Menu buttons and disconnect controls are provided. Disconnect ends the streaming session without shutting down the console or quitting its game. Video bitrate choices are Automatic, 10 Mbps and 20 Mbps. Quality depends on the console and network.

## Cloud Gaming

Open the separate Cloud Gaming sidebar tab, the Home quick-access card or Xbox → Cloud Gaming (Cmd+Shift+C). This streams supported Game Pass and other eligible cloud games directly from Xbox Cloud Gaming servers; the home console can stay off. It uses the same streaming account as Remote Play and the same native media player and controller bridge. The page has its own searchable catalog, artwork, game-access filter, bitrate choice, queue/cancel handling, fullscreen, mute and disconnect controls.

Live verification: the user's account loaded 650 playable cloud games from the WESTUS region. Halo Infinite streamed at 1920 × 1080 with approximately 23 ms network RTT. The user confirmed both audio and Nintendo Switch Pro Bluetooth controller input worked. Catalog details load in pages of 40 games, prioritizing playable titles. The first completed page is published immediately and its Play buttons work while three background workers load remaining pages. A slow later page does not hold earlier cards, and new pages append without moving cards already shown. A progress indicator shows how much of the catalog is ready. Refresh keeps the previous catalog usable until the first new page arrives. The 60-second artwork deadline remains; missing details do not prevent streaming. Games and access flags come from the service, rather than the local download library. Xbox checks access again when starting a session. Availability, streaming limits and queues follow the account's Microsoft subscription and region.

Only one Xbox stream is active in Xodus at a time. Disconnect the console stream before starting a cloud game, or disconnect the cloud game before connecting to your console. Sign-out clears the account-specific cloud catalog as well as streaming credentials. The existing Store account remains separate. Controller selection and Nintendo face-button mapping are shared between streaming tabs. No xbox.com page or website wrapper is embedded.

## Catalog filters and Store details

Cloud Gaming now filters by Original Xbox, Xbox 360, Xbox One, Xbox Series X|S, genre, publisher and play style. Filters combine with search and the playable-games switch, persist across app restarts, and can be reset. Sort by title, Game Pass added date or release date in either direction; Catalog order preserves the incremental loading order. Unknown dates sort last. Game Pass added dates use the earliest valid entry Microsoft reports across plans; this is not necessarily the date a game became cloud-streamable.

Generation describes the streamed edition, including cross-generation games. Legacy packages use an Original Xbox title index based on Xbox's backward-compatibility announcements because Microsoft's legacy package prefix covers both Xbox and Xbox 360. Ambiguous editions such as Splinter Cell Double Agent remain unclassified. Remakes use their current-edition generation. Generation details enrich cards after they appear, preserving first-batch loading. Play-style tags describe the game's capabilities; Xodus still sends one controller.

Click cloud cover art or titles to open native Microsoft Store information, including descriptions and screenshots with a full-screen image gallery. The same view is available from Home artwork, Store cards, account-library cards and the Store page button on installed-game details. Opening a dialog sends neutral streaming input so browsing screenshots does not control a game behind it. The Xbox Store link opens the exact product in the browser. Entries without a supplied Store ID offer a Store search rather than guessing an edition.

Live UI checks verified cloud generation filtering, date sorting, Store details and screenshot galleries, and account-wide Xbox recent history. The history request includes Xbox client headers required by Title Hub.

## Faster repeat visits

The cloud catalog and Xbox account history are cached in memory and in a bounded, encrypted `remote-play/browse-cache.enc` file under Electron userData. Disk caching is available only with Remember account enabled, using the same macOS encryption service as streaming credentials. A random cache ID stored inside the encrypted account file scopes snapshots to that account; cache payloads contain descriptive game data and timestamps, never authentication tokens. Sign-out clears the snapshots. Missing, corrupt, expired or unavailable caches fall back to normal loading.

A saved catalog appears immediately after launch. Opening Cloud Gaming checks automatically once the snapshot is six hours old; Refresh catalog always checks immediately. Cached games stay visible while refreshed batches arrive. Recently Played reuses its snapshot across pages and launches; after five minutes it returns saved results immediately and updates them in the background. Refresh Xbox history always checks immediately. Disk snapshots older than seven days are discarded. Failed refreshes keep the previous display available. Xbox still checks access when a stream starts; a cached listing cannot grant streaming rights.

Live restart verification on this Mac restored all 654 playable cloud games and the recent-history cards immediately, without another catalog fetch.

Store details already use a ten-minute memory cache, and Electron handles HTTP image caching. The first uncached load still needs Xbox and Microsoft metadata; later launches are where the new cache helps most.

## Recently Played

Home and a dedicated Recently Played sidebar page show games independently of downloads. Xbox account history is read through the existing Remote Play/Cloud Gaming account and includes up to 500 recent games across platforms. It is read-only, respects hidden history, and is refreshed from the account rather than inferring play from installed files. Xbox does not reliably report whether historical sessions used cloud, console streaming or a physical console, so imported entries are labeled Xbox activity.

New Xodus local-process and connected cloud sessions are recorded in a separate private game-hub.json file under the existing app profile. History survives uninstalling a game or restarting Xodus. Entries combine by verified product/title identity and retain known play methods. Local sessions from before this feature were not recorded. Xbox activity may be delayed by the service. Console-stream games appear through Xbox account history; Xodus does not guess a currently running console title from the last history entry. The list supports search and source filters. No play history is bundled in the distributed files.

## Optional Discord Rich Presence

Settings includes an off-by-default Rich Presence switch and public Discord application/client ID. Create an application named Xodus Nexus Neo in https://discord.com/developers/applications and paste its ID, then enable sharing. Discord desktop must be running with activity sharing enabled. No Discord bot token, account token or Microsoft credentials are sent to Discord.

The integration communicates only with the local Discord IPC socket and shares the active game title, play method and session start time. Local and cloud games have known titles; console sessions say Console: <console name> with Xbox console streaming as the method. It does not mislabel the user's previous game as currently running. Activity clears on disconnect, disable or app exit. Reconnection is automatic if Discord starts later. The IPC handshake, split frames, ping/pong and clear-on-disable behavior passed a synthetic local-server integration test. Live Discord publication needs the user's application ID and has not been tested with a real Discord application.

## Still experimental

Windows game playback is unavailable. Linux Proton/Wine cannot run on macOS, and the patched Xbox GameRuntime/graphics/runtime bridge still needs a separate macOS port. The preview blocks game launch and Linux runtime installation rather than treating compilation as game compatibility.

Linux AppImage updates and backend release installation are disabled on macOS. Rebuild this preview to update it. Steam/.desktop integration is not ported. Cancelling downloads keeps partial files; remove unwanted partials in Finder. Existing installed-game deletion retains the upstream explicit confirmation flow.

The app uses macOS Application Support for runtime defaults and Electron profile state. Testing used the user’s existing app profile. No account credentials, game files or save data are included in the distributed archives.

## Rebuild

Required: Apple Silicon macOS, Xcode command-line tools with Swift, Node/npm, Rust/Cargo 1.99, CMake, protoc, Git, tar. Dependencies/build tools used for this session were installed inside the Codex workspace; Homebrew and global tool installations were not changed.

```sh
cd /path/to/xodus-nexus-neo
npm ci
npm run backend:mac
npm run pack:mac
```

Put CMake and protoc on PATH, or set PROTOC explicitly. CARGO_HOME and CARGO_TARGET_DIR may point to writable absolute paths. If Electron's npm install script was not run by your npm script policy, run `node node_modules/electron/install.js` before packaging. `electron_config_cache` controls that installer's cache location.

`backend:mac` downloads the pinned upstream source, verifies Cargo.lock and the patch hashes, applies the Nexus patches, builds the ARM64 CLI/service and copies locally signed binaries into native-backend/. It preserves the source in backend/. A later invocation reuses that source. Move backend/ aside before intentionally changing the pinned recipe. `pack:mac` compiles the native controller helper and uses the installed native Electron distribution rather than downloading a second copy. The helper is bundled in Resources/controllers alongside the separate Rust backend.

## Provenance and source

- Nexus upstream: https://github.com/domsvoboda/xodus-nexus
- Nexus revision: e8f33dd38699b57d664a84cdffc0e0710f3df477 (launcher 0.3.9)
- Backend upstream: https://github.com/xodus-gaming/xodus
- Backend revision: 53ea781dcd073e31d7ea68e894134e9c959bff04
- Nexus backend recipe: 0.2.9, all 32 pinned patches in assets/backend-source.lock.json

The public Neo repository contains the reviewed source and reproducible backend recipe. Local backend checkouts, dependencies, profiles and compiled artifacts are excluded.
