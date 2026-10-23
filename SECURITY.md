# Security policy

Xodus Nexus Neo is an experimental, unofficial application. No formal security support window is offered. Do not open untrusted game packages or run builds from sources you do not trust.

Report vulnerabilities privately through the repository's Security tab if private vulnerability reporting is available. Otherwise contact the repository owner privately before sharing technical details. Never put credentials, tokens, XUIDs, cloud saves or unsanitized diagnostic logs in public issues.

## Credential and cache handling

- Store authentication is held by the Xodus backend in the system Keychain.
- Remembered streaming credentials and account-scoped browsing snapshots use Electron Safe Storage encryption. No plaintext credential fallback is implemented.
- Sign-out clears saved streaming credentials and browsing snapshots. Local play history is separate user-owned application data.
- Discord Rich Presence is optional, off by default, and uses local Discord IPC. It needs a public application ID, not an account or bot token.
- OAuth client IDs in the source identify public native clients and are not client secrets.

## Repository hygiene

Build outputs, dependencies, downloaded backend checkouts, Electron profiles, encrypted account files, signing material, environment files and logs are excluded by .gitignore. Ignore rules do not remove files already tracked; review the exact staged file list and scan it for secrets before every public release. Use synthetic credentials and account identifiers in fixtures.

CI should run with read-only repository permissions. Do not expose secrets to pull-request code, use pull_request_target to execute contributor code, or publish artifacts automatically from untrusted branches. Release signing credentials belong in restricted secret storage and never in the repository.

Local ad-hoc signatures are not Developer ID signatures or notarization. No security audit or universal safety guarantee is implied by passing tests or a secret scan.
