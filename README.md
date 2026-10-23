# Xodus Nexus Neo

An independent Apple Silicon macOS fork of [Xodus Nexus](https://github.com/domsvoboda/xodus-nexus) by domsvoboda, built on [Xodus](https://github.com/xodus-gaming/xodus).

Neo adds Xbox Series X|S console Remote Play, Xbox Cloud Gaming, native macOS controller support, and a faster, cached game browser. It is unofficial and is not affiliated with Microsoft, Xbox, or the upstream Xodus projects. Please report Neo problems in [this repository](https://github.com/northbridgetechnology/xodus-nexus-neo/issues).

## Features

- Stream from your Xbox console over your home network.
- Stream Game Pass and other supported cloud titles directly to your Mac.
- Use controllers through macOS GameController, including Nintendo Switch Pro over Bluetooth.
- Browse cloud games in batches; filter by console generation, genre, publisher and play style, and sort by Game Pass addition or release date.
- Open game descriptions and screenshot galleries from covers and titles.
- View Xbox account history in Recently Played, independently of downloads.
- Restore encrypted catalog/history caches immediately after restarting.
- Configure optional Discord Rich Presence with your own public application ID.
- Browse the Microsoft Store and download games your account is licensed to access.

**Local Windows PC game execution is not implemented on macOS.** Console and cloud streaming are the supported ways to play in this preview. Microphone chat and controller vibration are not included. Availability and streaming rights depend on your Microsoft account, region, subscription and Xbox services.

## Build on Apple Silicon

Requires macOS 14 or newer, Xcode Command Line Tools, Node.js 22.14 or newer with npm, and Rust/Cargo compatible with the pinned backend recipe. The native backend is downloaded from its pinned source and built locally; no account credentials are needed to build.

```sh
git clone https://github.com/northbridgetechnology/xodus-nexus-neo.git
cd xodus-nexus-neo
npm ci
npm run backend:mac
npm run pack:mac
```

Open `release/mac-arm64/Xodus Nexus Neo.app`. Builds are locally ad-hoc signed and are not notarized. [macOS notes](README_MACOS.md) describe the streaming account, controller mapping, cache behavior and current limitations.

```sh
npm run typecheck
npm run test:mac
```

The original Linux source and runtime tooling remain available but Neo's current validation targets Apple Silicon macOS. Backend/runtime pins still identify their upstream dependencies; they are not Neo launcher update sources.

## Accounts and privacy

Store credentials use the backend's system Keychain storage. Remembered streaming credentials and account-scoped browser caches use Electron Safe Storage encryption; caching credentials in plaintext is not supported. Sign-out removes the saved streaming account and browser snapshots. Discord integration is off by default and needs only a public Discord application ID, never a Discord bot or account token.

Neo retains the preview's internal `xodus-nexus` profile and encryption-service identity so upgrading does not discard existing sign-ins, settings or cached history. The app bundle has a distinct Neo identifier and visible name.

Do not commit game downloads, profiles, diagnostic logs, credentials, signing keys or packaged builds. See [SECURITY.md](SECURITY.md).

## Upstream and licensing

This fork began from Xodus Nexus commit `e8f33dd` (see [UPSTREAM.md](UPSTREAM.md)). Original copyright and MIT license notices are retained. Runtime/backend patches and bundled third-party components retain their own license notices under `assets/licenses/` and their source recipes. See [LICENSE](LICENSE).
