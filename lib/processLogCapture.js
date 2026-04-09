'use strict';

const util = require('util');

/** @type {{ log: Function, error: Function, warn: Function, info: Function } | null} */
let originals = null;
let installed = false;

/** @type {{ seq: number, ts: string, level: string, text: string }[]} */
let lines = [];
let seq = 0;

function maxLines() {
    const n = parseInt(String(process.env.PLAYBOUND_UI_LOG_MAX_LINES || '2500'), 10);
    return Number.isFinite(n) && n >= 100 && n <= 20000 ? n : 2500;
}

function maxLineChars() {
    const n = parseInt(String(process.env.PLAYBOUND_UI_LOG_MAX_LINE_CHARS || '8192'), 10);
    return Number.isFinite(n) && n >= 500 && n <= 65536 ? n : 8192;
}

/**
 * @param {unknown} arg
 */
function formatArg(arg) {
    if (typeof arg === 'string') return arg;
    if (arg instanceof Error) return arg.stack || String(arg.message);
    try {
        return util.inspect(arg, { depth: 3, maxStringLength: 800, breakLength: 120, compact: false });
    } catch {
        return String(arg);
    }
}

/**
 * @param {string} level
 * @param {unknown[]} args
 */
function record(level, args) {
    const text = args.map(formatArg).join(' ');
    const cap = maxLineChars();
    const clipped = text.length > cap ? `${text.slice(0, cap)}…[truncated]` : text;
    seq += 1;
    lines.push({
        seq,
        ts: new Date().toISOString(),
        level,
        text: clipped,
    });
    const capLines = maxLines();
    if (lines.length > capLines) {
        lines = lines.slice(-capLines);
    }
}

function install() {
    if (installed) return;
    installed = true;
    originals = {
        log: console.log.bind(console),
        error: console.error.bind(console),
        warn: console.warn.bind(console),
        info: console.info.bind(console),
    };

    console.log = (...args) => {
        record('log', args);
        originals.log(...args);
    };
    console.error = (...args) => {
        record('error', args);
        originals.error(...args);
    };
    console.warn = (...args) => {
        record('warn', args);
        originals.warn(...args);
    };
    console.info = (...args) => {
        record('info', args);
        originals.info(...args);
    };
}

/**
 * @param {{ afterSeq?: number, limit?: number }} opts
 * - `afterSeq === 0` (or below oldest buffered seq): return the **tail** (most recent `limit` lines).
 * - `afterSeq > 0`: return lines with `seq > afterSeq`, newest last, capped at `limit` (for polling).
 */
function getRuntimeLogSnapshot(opts = {}) {
    const afterSeq = Math.max(0, Math.floor(Number(opts.afterSeq) || 0));
    const limitRaw = Math.floor(Number(opts.limit) || 400);
    const limit = Math.min(2000, Math.max(1, limitRaw));
    const oldestSeq = lines.length ? lines[0].seq : 0;
    const newestSeq = lines.length ? lines[lines.length - 1].seq : seq;

    let slice;
    if (lines.length === 0) {
        slice = [];
    } else if (afterSeq === 0 || (oldestSeq > 0 && afterSeq < oldestSeq)) {
        slice = lines.slice(-limit);
    } else {
        const filtered = lines.filter((l) => l.seq > afterSeq);
        slice = filtered.length > limit ? filtered.slice(-limit) : filtered;
    }

    return {
        lines: slice,
        newestSeq,
        oldestSeq,
        totalBuffered: lines.length,
        maxLines: maxLines(),
        processUptimeSec: Math.round(process.uptime()),
        pid: process.pid,
    };
}

/**
 * Test / diagnostics only.
 */
function _resetForTests() {
    lines = [];
    seq = 0;
}

module.exports = {
    install,
    getRuntimeLogSnapshot,
    _resetForTests,
};
