'use strict';

const axios = require('axios');
const { decodeHTMLEntities } = require('./utils');

const RECENT_TRIVIA_LIMIT = 500;
const MAX_FETCH_ATTEMPTS = 4;
const recentTriviaQuestionKeys = [];
const recentTriviaQuestionSet = new Set();
let openTdbSessionToken = null;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeTriviaKey(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/&[^;\s]+;/g, ' ')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function rememberTriviaQuestions(rows) {
    for (const row of rows) {
        const key = normalizeTriviaKey(row.question);
        if (!key || recentTriviaQuestionSet.has(key)) continue;
        recentTriviaQuestionSet.add(key);
        recentTriviaQuestionKeys.push(key);
        if (recentTriviaQuestionKeys.length > RECENT_TRIVIA_LIMIT) {
            const oldest = recentTriviaQuestionKeys.shift();
            if (oldest) recentTriviaQuestionSet.delete(oldest);
        }
    }
}

async function fetchOpenTdbToken(forceReset = false) {
    const url = forceReset && openTdbSessionToken
        ? `https://opentdb.com/api_token.php?command=reset&token=${encodeURIComponent(openTdbSessionToken)}`
        : 'https://opentdb.com/api_token.php?command=request';
    const res = await axios.get(url);
    if (!res?.data?.token) {
        throw new Error('OpenTDB: failed to acquire session token');
    }
    openTdbSessionToken = res.data.token;
    return openTdbSessionToken;
}

function buildTriviaUrl(amount, opts = {}, token = '') {
    let url = `https://opentdb.com/api.php?amount=${amount}&type=multiple`;
    if (opts.category) url += `&category=${encodeURIComponent(opts.category)}`;
    if (opts.difficulty) url += `&difficulty=${encodeURIComponent(opts.difficulty)}`;
    if (token) url += `&token=${encodeURIComponent(token)}`;
    return url;
}

function mapTriviaResults(results) {
    return results.map((q) => {
        const question = decodeHTMLEntities(q.question);
        const correct = decodeHTMLEntities(q.correct_answer);
        const incorrect = (q.incorrect_answers || []).map(decodeHTMLEntities);
        const answers = [...incorrect, correct].sort(() => Math.random() - 0.5);
        return { question, correct, answers };
    });
}

function splitFreshAndFallback(rows) {
    const fresh = [];
    const fallback = [];
    for (const row of rows) {
        const key = normalizeTriviaKey(row.question);
        if (!key || recentTriviaQuestionSet.has(key)) fallback.push(row);
        else fresh.push(row);
    }
    return { fresh, fallback };
}

async function fetchTriviaBatch(requestAmount, opts, token) {
    let res;
    try {
        res = await axios.get(buildTriviaUrl(requestAmount, opts, token));
    } catch (e) {
        if (e.response?.status === 429) {
            await sleep(5000);
            res = await axios.get(buildTriviaUrl(requestAmount, opts, token));
        } else {
            throw e;
        }
    }

    if (res?.data?.response_code === 3 || res?.data?.response_code === 4) {
        const nextToken = await fetchOpenTdbToken(true);
        res = await axios.get(buildTriviaUrl(requestAmount, opts, nextToken));
    }
    return res;
}

async function fetchOpenTdbMultipleChoice(amount, opts = {}) {
    const n = Math.max(1, Math.min(50, Math.floor(Number(amount) || 1)));
    const requestAmount = Math.min(50, Math.max(n + 12, n * 4));
    const category = opts.category && String(opts.category) !== 'any' ? String(opts.category) : '';
    const difficulty = opts.difficulty && String(opts.difficulty) !== 'any' ? String(opts.difficulty) : '';
    const variants = [
        { category, difficulty },
        { category, difficulty: '' },
        { category: '', difficulty },
        { category: '', difficulty: '' },
    ];

    if (!openTdbSessionToken) {
        await fetchOpenTdbToken();
    }

    const chosen = [];
    const seenThisCall = new Set();
    let fallbackPool = [];

    for (let attempt = 0; attempt < MAX_FETCH_ATTEMPTS && chosen.length < n; attempt += 1) {
        const variant = variants[Math.min(attempt, variants.length - 1)];
        const res = await fetchTriviaBatch(requestAmount, variant, openTdbSessionToken);

        if (!Array.isArray(res?.data?.results) || res.data.results.length === 0) {
            continue;
        }

        const mapped = mapTriviaResults(res.data.results);
        const { fresh, fallback } = splitFreshAndFallback(mapped);
        fallbackPool = fallbackPool.concat(fallback);

        for (const row of fresh) {
            const key = normalizeTriviaKey(row.question);
            if (!key || seenThisCall.has(key)) continue;
            seenThisCall.add(key);
            chosen.push(row);
            if (chosen.length >= n) break;
        }
    }

    if (chosen.length < n) {
        for (const row of fallbackPool) {
            const key = normalizeTriviaKey(row.question);
            if (!key || seenThisCall.has(key)) continue;
            seenThisCall.add(key);
            chosen.push(row);
            if (chosen.length >= n) break;
        }
    }

    if (chosen.length === 0) {
        throw new Error('OpenTDB: no results after retries');
    }

    const picked = chosen.slice(0, n);
    rememberTriviaQuestions(picked);
    return picked;
}

module.exports = {
    fetchOpenTdbMultipleChoice,
};
