import { configDefaults, defineConfig } from 'vitest/config';
import { realpathSync } from 'node:fs';
import os from 'node:os';
// macOS /var is an OS symlink; use its canonical temp path in safety fixtures.
process.env.TMPDIR = realpathSync(os.tmpdir());
export default defineConfig({ test: {
  exclude: [...configDefaults.exclude, 'dist/**', 'dist-electron/**', 'release/**', 'work/**', 'backend/**', 'scripts/**/*.test.mjs',
    // Linux AppImage's Bash 4 bootstrap is never shipped in the Mac bundle.
    'src/main/launcher-bootstrap.test.ts',
    // Linux /proc file-descriptor deletion and .desktop launch integrations.
    'src/main/download-cleanup.test.ts', 'src/main/install-integration.test.ts', 'src/main/game-shortcuts.test.ts'],
} });
