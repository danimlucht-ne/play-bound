const { ActionRowBuilder } = require('discord.js');

function decodeHTMLEntities(text) {
    if (!text) return text;
    const entities = {
        '&quot;': '"', '&#039;': "'", '&amp;': '&', '&lt;': '<', '&gt;': '>',
        '&shy;': '', '&Ouml;': 'Ö', '&ouml;': 'ö', '&Auml;': 'Ä', '&auml;': 'ä',
        '&Uuml;': 'Ü', '&uuml;': 'ü', '&szlig;': 'ß', '&eacute;': 'é', '&egrave;': 'è',
        '&aacute;': 'á', '&iacute;': 'í', '&oacute;': 'ó', '&uacute;': 'ú', '&ntilde;': 'ñ'
    };
    return text.replace(/&[#\w]+;/g, match => {
        if (entities[match]) return entities[match];
        if (match.startsWith('&#')) {
            const code = parseInt(match.slice(2, -1));
            if (!isNaN(code)) return String.fromCharCode(code);
        }
        return match;
    });
}

function scramblePhrase(phrase) {
    let chars = phrase.replace(/ /g, '').split('');
    for (let i = chars.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join('');
}

/** Per-placement cap for comma-separated game `points` options (anti-inflation). */
const MAX_POINTS_PER_PLACEMENT = 1000;

function parsePointValues(str, defaultVal = '5') {
    return (str || defaultVal).split(',').map(v => {
        const n = parseInt(v.trim());
        if (isNaN(n) || n < 0) return 0;
        return Math.min(n, MAX_POINTS_PER_PLACEMENT);
    });
}

/** When the host omits `thread_name`: `Game label — Apr 3, 2026` (Discord thread names max 100 chars). */
function defaultGameThreadName(gameLabel) {
    const dateStr = new Date().toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    });
    const s = `${gameLabel} — ${dateStr}`;
    return s.length > 100 ? `${s.slice(0, 97)}...` : s;
}

function getLevenshteinDistance(a, b) {
    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) matrix[i][j] = matrix[i - 1][j - 1];
            else matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
        }
    }
    return matrix[b.length][a.length];
}

function normalizeText(t) {
    return t.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Strip common suffixes so "Song (feat. X)" matches chat guesses. */
function normalizeSongTitle(t) {
    if (!t) return '';
    let s = String(t).toLowerCase();
    s = s.replace(/\s*\(feat[^)]*\)/gi, '');
    s = s.replace(/\s*\[[^\]]*remaster[^\]]*\]/gi, '');
    return s.trim();
}

function isFuzzyMatch(guess, target) {
    const ng = normalizeText(guess);
    const nt = normalizeText(target);
    if (ng === nt) return true;
    if (nt.length < 4) return ng === nt;
    const distance = getLevenshteinDistance(ng, nt);
    const threshold = Math.floor(nt.length * 0.2);
    return distance <= Math.max(1, threshold);
}

/** Integer economy amounts with en-US thousands separators for user-facing text. */
function formatPoints(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return '0';
    return Math.trunc(x).toLocaleString('en-US');
}

async function disableComponentsInThread(thread) {
    if (!thread) return;
    try {
        const messages = await thread.messages.fetch({ limit: 50 });
        for (const message of messages.values()) {
            if (message.components.length > 0) {
                const newComponents = message.components.map((row) => {
                    const newRow = ActionRowBuilder.from(row);
                    for (const component of newRow.components) {
                        if (typeof component.setDisabled === 'function') {
                            component.setDisabled(true);
                        }
                    }
                    return newRow;
                });
                await message.edit({ components: newComponents });
            }
        }
    } catch (err) {
        console.error(`Could not disable components in thread ${thread.id}:`, err);
    }
}

module.exports = {
    decodeHTMLEntities,
    scramblePhrase,
    parsePointValues,
    defaultGameThreadName,
    MAX_POINTS_PER_PLACEMENT,
    getLevenshteinDistance,
    normalizeText,
    normalizeSongTitle,
    isFuzzyMatch,
    disableComponentsInThread,
    formatPoints,
};
