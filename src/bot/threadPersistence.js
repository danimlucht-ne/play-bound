'use strict';

const fs = require('fs');
const path = require('path');

const THREADS_FILE = path.join(__dirname, '..', '..', 'data', 'active_threads.json');

function getActiveThreads() {
    if (!fs.existsSync(THREADS_FILE)) return [];
    return JSON.parse(fs.readFileSync(THREADS_FILE, 'utf8'));
}

function addActiveThread(threadId, gameName) {
    const threads = getActiveThreads();
    if (!threads.find((t) => t.threadId === threadId)) {
        threads.push({ threadId, gameName });
        fs.mkdirSync(path.dirname(THREADS_FILE), { recursive: true });
        fs.writeFileSync(THREADS_FILE, JSON.stringify(threads, null, 2));
    }
}

function removeActiveThread(threadId) {
    let threads = getActiveThreads();
    threads = threads.filter((t) => t.threadId !== threadId);
    fs.mkdirSync(path.dirname(THREADS_FILE), { recursive: true });
    fs.writeFileSync(THREADS_FILE, JSON.stringify(threads, null, 2));
}

module.exports = { THREADS_FILE, getActiveThreads, addActiveThread, removeActiveThread };
