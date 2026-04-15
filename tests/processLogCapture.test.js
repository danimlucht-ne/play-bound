'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { install, getRuntimeLogSnapshot, _resetForTests } = require('../lib/processLogCapture');

test('runtime log snapshot: tail mode then incremental', () => {
    _resetForTests();
    install();
    console.log('pb-test-process-log-capture-1');
    const tail = getRuntimeLogSnapshot({ afterSeq: 0, limit: 50 });
    assert.ok(tail.lines.length >= 1);
    assert.ok(tail.lines.some((l) => String(l.text).includes('pb-test-process-log-capture-1')));
    const lastSeq = tail.newestSeq;
    const empty = getRuntimeLogSnapshot({ afterSeq: lastSeq, limit: 50 });
    assert.equal(empty.lines.length, 0);
    console.warn('pb-test-process-log-capture-2');
    const more = getRuntimeLogSnapshot({ afterSeq: lastSeq, limit: 50 });
    assert.ok(more.lines.length >= 1);
    assert.ok(more.lines.some((l) => String(l.text).includes('pb-test-process-log-capture-2')));
});
