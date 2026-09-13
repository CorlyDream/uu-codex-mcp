import { chmod, copyFile, mkdir, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const source = join(root, 'native', 'macos-helper', '.build', 'release', 'uu-desktop-helper');
const destination = join(homedir(), '.local', 'share', 'uu-codex-mcp', 'bin', 'uu-desktop-helper');
const directory = dirname(destination);
const temporary = `${destination}.tmp-${process.pid}`;

await mkdir(directory, { recursive: true, mode: 0o700 });
await chmod(directory, 0o700);
try {
  await copyFile(source, temporary);
  await chmod(temporary, 0o755);
  await rename(temporary, destination);
} finally {
  await rm(temporary, { force: true }).catch(() => undefined);
}

console.log(destination);
console.log('请在 macOS 系统设置 → 隐私与安全性 → 辅助功能 中添加并允许上面的 uu-desktop-helper。');
