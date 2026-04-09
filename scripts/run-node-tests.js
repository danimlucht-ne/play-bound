const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function collectTestFiles(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...collectTestFiles(fullPath));
            continue;
        }
        if (entry.isFile() && entry.name.endsWith('.test.js')) {
            out.push(fullPath);
        }
    }
    return out;
}

const repoRoot = path.resolve(__dirname, '..');
const testsDir = path.join(repoRoot, 'tests');
const includeIntegration = process.argv.includes('--include-integration');
const onlyIntegration = process.argv.includes('--only-integration');
const files = collectTestFiles(testsDir)
    .filter((file) => {
        const isIntegration = file.endsWith('.integration.test.js');
        if (onlyIntegration) return isIntegration;
        return includeIntegration || !isIntegration;
    })
    .sort();

if (files.length === 0) {
    console.error('No test files found under tests/');
    process.exit(1);
}

/**
 * Some suites (notably interactionCreate.commands) finish all subtests but keep the event loop
 * alive (stray timers / library internals). Node's --test-force-exit ends the process after the
 * runner reports completion. Set PLAYBOUND_TEST_FORCE_EXIT=0 to disable (e.g. debugging handles).
 */
function testRunnerArgs(file) {
    const args = ['--test'];
    const raw = process.env.PLAYBOUND_TEST_FORCE_EXIT;
    const off = raw === '0' || raw === 'false' || raw === 'off';
    if (!off) {
        args.push('--test-force-exit');
    }
    args.push(file);
    return args;
}

/** Per-file spawn budget (ms). The interaction suite reloads the full router many times and can exceed 10m on slow CI runners. */
function spawnTimeoutMs(rel) {
    if (rel.replace(/\\/g, '/').endsWith('tests/interactionCreate.commands.test.js')) {
        const n = Number(process.env.PLAYBOUND_INTERACTION_TEST_TIMEOUT_MS);
        return Number.isFinite(n) && n > 0 ? n : 2_400_000;
    }
    const n = Number(process.env.PLAYBOUND_TEST_FILE_TIMEOUT_MS);
    return Number.isFinite(n) && n > 0 ? n : 600_000;
}

for (const file of files) {
    const rel = path.relative(repoRoot, file);
    const relPosix = rel.split(path.sep).join('/');
    console.log(`\n=== ${rel} ===`);
    const result = spawnSync(process.execPath, testRunnerArgs(file), {
        cwd: repoRoot,
        stdio: 'inherit',
        env: process.env,
        timeout: spawnTimeoutMs(relPosix),
    });

    if (result.error) {
        throw result.error;
    }
    if ((result.status ?? 1) !== 0) {
        process.exit(result.status ?? 1);
    }
}

process.exit(0);
