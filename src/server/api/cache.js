'use strict';

/** @type {Map<string, { expires: number, payload: unknown }>} */
const buckets = new Map();

/**
 * @param {string} key
 * @param {number} ttlMs
 * @param {() => Promise<any>} producer
 */
async function cached(key, ttlMs, producer) {
    const now = Date.now();
    const hit = buckets.get(key);
    if (hit && hit.expires > now) {
        return hit.payload;
    }
    const payload = await producer();
    buckets.set(key, { expires: now + ttlMs, payload });
    return payload;
}

module.exports = { cached };
