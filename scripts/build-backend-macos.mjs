import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
const lock = JSON.parse(await fs.readFile(path.join(root, 'assets/backend-source.lock.json'), 'utf8'));
if (process.platform !== 'darwin' || process.arch !== 'arm64') throw Error('Build this preview on an Apple Silicon Mac.');
const run = (command, args, cwd = root) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd, env: process.env, stdio: 'inherit' });
  child.on('error', reject); child.on('close', code => code === 0 ? resolve() : reject(Error(`${command} exited ${code}`)));
});
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const source = path.join(root, 'backend');
const sourceMarker = path.join(source, '.nexus-macos-source.json');
const recipe = hash(await fs.readFile(path.join(root, 'assets/backend-source.lock.json')));
try {
  const marker = JSON.parse(await fs.readFile(sourceMarker, 'utf8'));
  if (marker.recipe !== recipe) throw Error('Backend recipe changed. Move the backend folder aside before rebuilding.');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  if (await fs.stat(source).then(() => true, () => false)) throw Error('Refusing to overwrite an existing backend source folder.');
  const staging = await fs.mkdtemp(path.join(root, '.backend-macos-'));
  try {
    const response = await fetch(`https://api.github.com/repos/xodus-gaming/xodus/tarball/${lock.commit}`);
    if (!response.ok) throw Error(`Source download failed: HTTP ${response.status}`);
    await fs.writeFile(path.join(staging, 'source.tar.gz'), Buffer.from(await response.arrayBuffer()));
    await fs.mkdir(path.join(staging, 'source'));
    await run('tar', ['-xzf', path.join(staging, 'source.tar.gz'), '--strip-components=1', '-C', path.join(staging, 'source')]);
    const extracted = path.join(staging, 'source');
    if (hash(await fs.readFile(path.join(extracted, 'Cargo.lock'))) !== lock.cargoLockSha256) throw Error('Upstream Cargo.lock checksum mismatch.');
    for (const patch of lock.patches) {
      const file = path.join(root, 'assets', patch.file);
      if (hash(await fs.readFile(file)) !== patch.sha256) throw Error(`Patch checksum mismatch: ${patch.file}`);
      await run('git', ['apply', '--check', file], extracted);
      await run('git', ['apply', file], extracted);
    }
    const macPatch = path.join(root, 'assets/xodus-macos.patch');
    if (await fs.stat(macPatch).then(() => true, () => false)) await run('git', ['apply', macPatch], extracted);
    await fs.writeFile(path.join(extracted, '.nexus-macos-source.json'), JSON.stringify({ recipe, commit: lock.commit }, null, 2));
    await fs.rename(extracted, source);
  } finally { await fs.rm(staging, { recursive: true, force: true }); }
}
await run('cargo', ['build', '--locked', '--release', '--no-default-features', '-p', 'xodus-cli', '-p', 'xodus-service'], source);
await run('scripts/package-backend-macos.sh', [source]);
