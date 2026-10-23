import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
if (process.platform !== 'darwin' || process.arch !== 'arm64') throw Error('Build the native controller helper on an Apple Silicon Mac.');
const output = path.join(root, 'native-controller/xodus-controller');
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.mkdir(path.join(root, 'work/swift-module-cache'), { recursive: true });
const run = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit' });
  child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(Error(`${command} failed (${code}).`)));
});
await run('swiftc', ['-O', '-target', 'arm64-apple-macosx14.0', '-module-cache-path', path.join(root, 'work/swift-module-cache'), path.join(root, 'src/native/XodusController.swift'), '-o', output]);
await run('codesign', ['--force', '--sign', '-', '--identifier', 'org.xodusgaming.nexus.controller', output]);
