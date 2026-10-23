# Upstream attribution

Xodus Nexus Neo is an independent fork of **Xodus Nexus** by domsvoboda:
https://github.com/domsvoboda/xodus-nexus

The starting launcher snapshot was commit `e8f33dd38699b57d664a84cdffc0e0710f3df477`. Neo adds the Apple Silicon port, console and cloud streaming, controller support, game discovery improvements and local browser caching. The initial Neo repository publishes a reviewed source snapshot rather than importing the upstream development history.

The underlying Xodus backend comes from https://github.com/xodus-gaming/xodus at the revision recorded in `assets/backend-source.lock.json`, with the listed Nexus patches and the native macOS build configuration. Backend sources are fetched by the build recipe and are not vendored as an untracked local checkout.

Original MIT copyright and license text in LICENSE is preserved. Additional bundled third-party licenses are retained in assets/licenses/. Historical upstream changelogs and release notes describe upstream releases, not Neo releases. Backend and runtime release references that still point to upstream are intentional dependency references.

Neo is not an official release of Xodus Nexus, Xodus, Microsoft or Xbox. File Neo issues at https://github.com/northbridgetechnology/xodus-nexus-neo/issues.
