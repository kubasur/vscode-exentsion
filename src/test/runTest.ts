import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runTests } from '@vscode/test-electron';

/**
 * Builds a fresh fixture repository in a temp folder and runs the integration tests in VS Code
 * with that repository open.
 *
 * Environment variables:
 *   TASKBENCH_VSCODE_PATH     use this VS Code executable instead of downloading one
 *   TASKBENCH_VSCODE_VERSION  download this VS Code version (default: latest stable)
 *   TASKBENCH_KEEP_FIXTURE=1  keep the temp folder afterwards, for debugging
 */
async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, '../..');
  const extensionTestsPath = path.resolve(__dirname, './suite/index');
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'taskbench-test-')));
  const repo = path.join(tmp, 'repo');
  execFileSync('bash', [path.join(extensionDevelopmentPath, 'test', 'fixtures', 'create-fixture.sh'), repo], {
    stdio: 'inherit',
  });

  try {
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      vscodeExecutablePath: process.env.TASKBENCH_VSCODE_PATH || undefined,
      version: process.env.TASKBENCH_VSCODE_VERSION || undefined,
      extensionTestsEnv: { TASKBENCH_FIXTURE_REPO: repo },
      launchArgs: [
        repo,
        '--disable-extensions',
        '--disable-workspace-trust',
        '--skip-welcome',
        '--skip-release-notes',
        `--user-data-dir=${path.join(tmp, 'user-data')}`,
        // Electron refuses to run as root (e.g. in CI containers) unless the sandbox is off.
        ...(process.getuid?.() === 0 ? ['--no-sandbox', '--disable-gpu'] : []),
      ],
    });
  } finally {
    if (process.env.TASKBENCH_KEEP_FIXTURE === '1') {
      console.log(`Fixture kept at ${tmp}`);
    } else {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
