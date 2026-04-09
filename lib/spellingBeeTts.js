'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');

function espeakBinary() {
    for (const b of ['espeak-ng', 'espeak']) {
        try {
            const cmd = process.platform === 'win32' ? 'where' : 'which';
            const r = spawnSync(cmd, [b], { encoding: 'utf8' });
            if (r.status === 0 && r.stdout.trim()) return b;
        } catch (_) {
            /* ignore */
        }
    }
    return null;
}

let cachedBin = undefined;
function getEspeakBin() {
    if (cachedBin === undefined) cachedBin = espeakBinary();
    return cachedBin;
}

function isTtsAvailable() {
    return getEspeakBin() != null;
}

/**
 * Renders a single word to a WAV via espeak-ng/espeak (install on the bot host).
 * @returns {{ wavPath: string, cleanup: () => void } | null}
 */
function synthesizeEnglishWord(word) {
    const bin = getEspeakBin();
    if (!bin) return null;
    const safe = String(word)
        .trim()
        .replace(/[^a-zA-Z'-]/g, '')
        .slice(0, 64);
    if (!safe) return null;
    const wavPath = path.join(os.tmpdir(), `playbound-spell-${randomUUID()}.wav`);
    const r = spawnSync(bin, ['-s', '120', '-v', 'en', '-w', wavPath, safe], { encoding: 'utf8' });
    if (r.status !== 0 || !fs.existsSync(wavPath)) return null;
    return {
        wavPath,
        cleanup: () => {
            try {
                fs.unlinkSync(wavPath);
            } catch (_) {
                /* ignore */
            }
        },
    };
}

module.exports = { synthesizeEnglishWord, isTtsAvailable, getEspeakBin };
