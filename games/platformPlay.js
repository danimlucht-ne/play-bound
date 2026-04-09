'use strict';

const crypto = require('crypto');
const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
} = require('discord.js');
const { getUser, checkAndIncrementDailyPlaygame } = require('../lib/db');
const { defaultGameThreadName } = require('../lib/utils');
const { ensureRotationForDate } = require('../lib/gamePlatform/rotation');
const { resolveGame, getSettings } = require('../lib/gamePlatform/configStore');
const { awardPlatformGameScore } = require('../lib/gamePlatform/scoring');
const { recordSessionStarted, recordSessionCompleted } = require('../lib/gamePlatform/analytics');
const {
    getFactionChallengeOverlapWarning,
    isUserEnrolledInActiveFactionChallenge,
} = require('../lib/factionChallenge');
const { FactionCreditReasonCode } = require('../lib/gameClassification');
const { isBotDeveloper } = require('../lib/isBotDeveloper');
const { throwIfImmediateGameStartBlockedByMaintenance } = require('../lib/maintenanceScheduling');
const { createPlatformGameThread, finalizeHostedGameThread } = require('../lib/gameThreadLifecycle');
const { fetchOpenTdbMultipleChoice } = require('../lib/openTriviaFetch');

/** Upper bound for maintenance overlap checks. */
const PLATFORM_SESSION_MAINTENANCE_ASSUME_MS = 60 * 60000;

/** Reaction / reveal games: wait so users can open the thread before the timed challenge. */
const SPEED_GAME_TAGS = new Set(['high_card_blitz']);

/** Single-player games that use ephemeral messages instead of threads. */
const THREADLESS_PLATFORM_TAGS = new Set([
    'risk_roll',
    'target_21',
    'dice_duel',
    'high_card_blitz',
    'push_luck_deck',
    'combo_builder',
    'five_card_draw',
    'reaction_rush',
    'last_man_standing',
    'pattern_memory',
    'logic_grid_mini',
    'multi_step_trivia',
    'lie_detector',
    'sabotage_mode',
]);

function getSpeedPrepDelayMs() {
    if (process.env.PLAYBOUND_SPEED_DELAY_MS === '0') return 0;
    return 30 * 1000;
}

function isThreadlessPlatformTag(tag) {
    return THREADLESS_PLATFORM_TAGS.has(tag);
}

function withEphemeral(payload) {
    const body = typeof payload === 'string' ? { content: payload } : { ...(payload || {}) };
    return { ...body, ephemeral: true };
}

function createEphemeralTransport(interaction) {
    let first = true;
    return {
        async send(payload) {
            const body = withEphemeral(payload);
            if (first) {
                first = false;
                return interaction.editReply(body);
            }
            return interaction.followUp(body);
        },
    };
}

function makeStepSender(interaction, session) {
    if (!session.threadless) return interaction.channel;
    return {
        send(payload) {
            return interaction.followUp(withEphemeral(payload));
        },
    };
}

const sessions = new Map();

function newSessionId() {
    return crypto.randomBytes(5).toString('hex');
}

function cid(tag, sessionId, action, extra = '') {
    const e = String(extra).replace(/\|/g, '');
    return `pg|${tag}|${sessionId}|${action}|${e}`;
}

function rollDie(sides) {
    return 1 + Math.floor(Math.random() * sides);
}

function dieFaceUnicode(n) {
    return null;
}

const DICE_GAME_EMOJI = '\ud83c\udfb2';

function formatDieRoll(n, sides = 6) {
    return `\ud83c\udfb2 **${n}**`;
}

function formatTwoD6(a, b) {
    const arrow = '\u2192';
    return `\ud83c\udfb2**${a}** + \ud83c\udfb2**${b}** ${arrow} **${a + b}**`;
}

function rulesEmbed(tag, def) {
    const title = `${def.displayName} \u2014 quick guide`;
    const warFooter =
        '\n\nFaction war: your score stops there.\n' +
        'Non-ranked: bonuses, multipliers, and host aura can still raise your Credits.';
    const byTag = {
        risk_roll:
            'Roll a d6 each turn.\n\n' +
            'Roll a **1**: bust for **3** points.\n' +
            'Roll **2\u20136**: add it to your total.\n' +
            'Stop anytime to keep your run.\n\n' +
            'Safe stop: **8 + your total**.\n' +
            'Match max: **20** points.\n\n' +
            'Total points = your final locked total.',
        target_21:
            'You have **3 hands** to get as close to **21** as possible.\n\n' +
            'Start each hand at **0** and roll a **d6**.\n\n' +
            'Stand: **4 + half your total (rounded down)** for that hand.\n' +
            'Hit **21**: **12** for that hand.\n' +
            'Go over **21**: bust for **1**.\n\n' +
            'Total points = the sum of all **3** hands.',
        dice_duel:
            'You play **3 duels** against the house.\n\n' +
            'Roll 3 dice.\n' +
            'You may reroll **one** die once.\n' +
            'Lock your dice to reveal the house roll.\n\n' +
            'Beat the house: **10**\n' +
            'Tie the house: **6**\n' +
            'Lose: **2**\n' +
            'Triples: **+3** bonus (ranked) or **+5** (casual).\n\n' +
            'Total points = the sum of all **3** duels.',
        king_of_the_hill:
            'You get **4 tries** to beat the king roll.\n\n' +
            'Each try rolls **2d6**.\n' +
            'Beat the current king: your score goes up.\n' +
            'Do not beat the king: no gain that round.\n\n' +
            'Start at **9**.\n' +
            'Each time you take the crown: **+3**.\n' +
            'Possible total: **9\u201321**.',
        high_card_blitz:
            'You play **3 hands** against the house.\n\n' +
            'Each hand draws a hidden card (1\u201313).\n' +
            'Choose **Reveal** or **Double down** first, then reveal.\n\n' +
            'Win the hand: **10**\n' +
            'Lose the hand: **2**\n' +
            'Double down win: **+6** bonus (casual) or **+3** (ranked).\n\n' +
            'Total points = the sum of all **3** hands.',
        push_luck_deck:
            'You play **3 hands**.\n\n' +
            'Goal: build the biggest bank you can before **BUST**.\n' +
            'There is **no target number**.\n' +
            'Each draw is either **+2, +3, +4, +5, or BUST**.\n' +
            'Stop anytime to keep your bank.\n\n' +
            'Stop safely: **4 + your bank** for that hand.\n' +
            'Bust: **1** for that hand.\n\n' +
            'Total points = the sum of all **3** hands.',
        combo_builder:
            'You play **3 hands** of video poker.\n\n' +
            'Each hand deals **5 cards** and scores automatically.\n' +
            'Better combos earn more.\n\n' +
            'High card: **5**\n' +
            'Pair: **8**\n' +
            'Two pair / trips / straight / better: climbs from there up to **20**.\n\n' +
            'Total points = the sum of all **3** hands.',
        five_card_draw:
            'You play **3 hands** of five-card draw poker.\n\n' +
            'Each hand: get **5 cards**, tap to **hold** the ones you want, press **Draw** to replace the rest.\n\n' +
            'High card: **8** \u00b7 Pair: **10** \u00b7 Two pair: **13**\n' +
            'Trips: **15** \u00b7 Straight: **17** \u00b7 Flush: **19**\n' +
            'Full house: **21** \u00b7 Four of a kind: **23** \u00b7 Straight flush: **25**\n\n' +
            'Total points = the sum of all **3** hands.',
        reaction_rush:
            'Answer the math prompt within **5 seconds**.\n\n' +
            'You play **3 rounds** back-to-back.\n' +
            'One wrong answer or timeout ends the run.\n\n' +
            'Each round correct: **12**.\n' +
            'All 3 perfect: **36**.\n' +
            'Wrong or too slow: you keep what you earned (minimum **2**).',
        closest_guess:
            'Send **one guess** from **1\u201350**.\n\n' +
            'Closest guess wins.\n' +
            'Exact hit earns the biggest reward.\n\n' +
            'Exact hit: **17**\n' +
            'Closest without exact: **7\u201314** depending on distance.\n' +
            'No winner: **2**.\n\n' +
            'Possible total: **2\u201317**.\n' +
            'Timer: **2 minutes** for others to join and guess.',
        last_man_standing:
            'You face **6 bots**.\n\n' +
            'Each round everyone rolls **2d6**.\n' +
            'Lowest total is eliminated (ties survive).\n' +
            'Survive until only one remains.\n\n' +
            'Win: **12**.\n' +
            'Second place: **6**.\n' +
            'Out first: **3**.\n\n' +
            'Possible total: **3\u201312**.',
        pattern_memory:
            'Memorize the pattern, then repeat it in order.\n' +
            'You play **3 rounds** of **8 steps** each.\n\n' +
            'Get every step right: big reward.\n' +
            'Miss a step: the run ends.\n\n' +
            'Perfect round: **~36** points.\n' +
            'All 3 rounds perfect: **~108** points.\n' +
            'Mistake: you keep what you earned so far (minimum **2**).',
        logic_grid_mini:
            'Answer each logic question in order.\n\n' +
            'Get one right: keep going and earn more.\n' +
            'Miss one: the run ends.\n\n' +
            'Each correct answer: **4** points.\n' +
            'Miss the first one: **3** points.\n\n' +
            'Perfect run: **12** points.\n' +
            'Total points = everything you earned before the run ends.',
        multi_step_trivia:
            'Answer the trivia chain one question at a time.\n\n' +
            'Correct answer: move to the next step.\n' +
            'Wrong answer: the run ends.\n\n' +
            'Tier rewards: **4, 6, 7, 8, 10**.\n' +
            'Wrong on the first step: **2**.\n\n' +
            'Possible total: **2\u201310**.\n' +
            'Total points = the tier you reached before the run ended.',
        lie_detector:
            'Find the **one true statement**.\n\n' +
            'Pick correctly: **10**\n' +
            'Pick wrong: **3**\n\n' +
            'Possible total: **3\u201310**.',
        vote_the_winner:
            'Vote once before the timer ends.\n\n' +
            'More total votes = a bigger reward.\n' +
            'If the host picked the winning side, the host gets a bonus.\n\n' +
            'Start at **5**.\n' +
            'Turnout bonus: up to **+10**.\n' +
            'Host picked the winner: **+5**.\n\n' +
            'Possible total: **5\u201320**.\n' +
            'Timer: **2 minutes** for others to join and vote.',
        sabotage_mode:
            'Pick the button that matches your role.\n\n' +
            'Crew should complete the mission.\n' +
            'Saboteur should sabotage.\n\n' +
            'Crew correct: **12**.\n' +
            'Saboteur correct: **18**.\n' +
            'Wrong choice: **10**.\n\n' +
            'Possible total: **10\u201318**.',
    };
    const body = (byTag[tag] || 'Use the buttons to finish the match. Your result decides your score.') + warFooter;
    return new EmbedBuilder().setTitle(title).setDescription(body.slice(0, 3900)).setColor('#5865F2');
}

function scheduleSpeedPrepIfNeeded(thread, session, startActual) {
    if (session.threadless) {
        return startActual();
    }
    const delayMs = getSpeedPrepDelayMs();
    if (!SPEED_GAME_TAGS.has(session.tag) || delayMs <= 0) {
        return startActual();
    }
    const mr = session.platformMatchRounds || 1;
    const roundPhrase =
        mr > 1
            ? `**${mr}** back-to-back timed rounds (still **one** match).`
            : '**one** timed challenge posts.';
    const tail =
        mr > 1
            ? '_The next bot message starts **round 1**; complete every round before **Match finished**._'
            : '_The next message from the bot is the **start** of that timed challenge (after it resolves, this match is **over**)._';
    return (async () => {
        await thread.send({
            embeds: [
                new EmbedBuilder()
                    .setTitle('\u23f1\ufe0f Speed round \u2014 30-second ready window')
                    .setDescription(
                        `This mini-game rewards **quick reactions**. You have **30 seconds** to open this thread; then ${roundPhrase}\n\n${tail}`,
                    )
                    .setColor('#ED4245'),
            ],
        });
        const sid = session.id;
        const tid = session.threadId;
        setTimeout(() => {
            const s = sessions.get(sid);
            if (!s || s.threadId !== tid) return;
            startActual().catch((e) => console.error('[platformPlay speed start]', e));
        }, delayMs);
    })();
}

async function pickOnboardingGameTag() {
    const settings = await getSettings();
    for (const t of ['reaction_rush', 'risk_roll']) {
        const def = resolveGame(t, settings);
        if (def && def.enabled) return t;
    }
    return null;
}

function capBase(tag, settings, raw) {
    const g = resolveGame(tag, settings);
    const cap = g && g.balancingConfig && g.balancingConfig.sessionCapFaction;
    const n = Math.max(0, Math.floor(Number(raw) || 0));
    if (cap != null && Number.isFinite(Number(cap)) && Number(cap) > 0) {
        return Math.min(n, Math.round(Number(cap)));
    }
    return n;
}

/** Repeat mini-games inside one `/playgame` match (e.g. 3 duels). Capped 1\u201310. */
function platformMatchRounds(def) {
    const raw = def?.balancingConfig?.matchRounds;
    if (raw == null || !Number.isFinite(Number(raw))) return 1;
    return Math.max(1, Math.min(10, Math.floor(Number(raw))));
}

/**
 * Explains how match scores feed ranked faction wars (not Credits multipliers).
 * @returns {EmbedBuilder|null}
 */
function factionWarCreditExplainerEmbed(tag, def) {
    if (!def.rankedEligible || !def.warScoringEligible) {
        return new EmbedBuilder()
            .setTitle('\u2694\ufe0f Faction war credit')
            .setColor(0x95a5a6)
            .setDescription(
                'This mini-game is **not ranked-war eligible**.\n\nIt won\u2019t add to **ranked** war tallies (unranked wars may still count it if configured).',
            );
    }
    const part = def.defaultCasualRewards?.participate ?? 2;
    const db = def.defaultBasePoints;
    const lines = [
        '**Faction war score (ranked)** uses your **match score** from this game.',
        '\u2022 **Credits** on your profile can still get streak / Premium / boosts \u2014 those **do not** inflate the **war** tally.',
        '\u2022 You must **`/faction_challenge join`** while a war is live, and this game\u2019s **tag** must be allowed in that war.',
    ];
    const mr = platformMatchRounds(def);
    if (tag === 'dice_duel') {
        lines.push('');
        lines.push(`**${def.displayName}** \u2014 **${mr}** dice duels vs the house (scores **add up**):`);
        lines.push(`\u2022 **Beat** the house \u00b7 ~**${db + 4}** per duel (**+3\u20135** triples bonus)`);
        lines.push(`\u2022 **Tie** \u00b7 ~**${db}**`);
        lines.push(`\u2022 **Lose** \u00b7 ~**${part}**`);
    } else if (tag === 'high_card_blitz') {
        lines.push('');
        lines.push(`**${def.displayName}** \u2014 **${mr}** hands vs the house (scores **sum**):`);
        lines.push(`\u2022 **Win** reveal \u00b7 ~**${db + 4}** (double-down adds more in casual; ranked uses config)`);
        lines.push(`\u2022 **Lose** \u00b7 ~**2**`);
    } else if (tag === 'push_luck_deck') {
        lines.push('');
        lines.push(`**${def.displayName}** \u2014 **${mr}** separate push hands (scores **sum**):`);
        lines.push(`\u2022 **Stop** with bank \u00b7 **${db}** + your bank (capped per design)`);
        lines.push(`\u2022 **Bust** \u00b7 ~**1** that hand`);
    } else if (tag === 'target_21') {
        lines.push('');
        lines.push(`**${def.displayName}** \u2014 **${mr}** hands toward one match total:`);
        lines.push(`\u2022 **Hit 21** \u00b7 ~**${db + (def.defaultCasualRewards?.exact21Bonus || 8)}** that hand`);
        lines.push(`\u2022 **Stand** \u00b7 scales with total (\u2248 **${db}** + half your total)`);
        lines.push(`\u2022 **Bust** \u00b7 ~**${def.defaultCasualRewards?.bust || 1}** that hand`);
    } else if (tag === 'reaction_rush') {
        lines.push('');
        lines.push(`**${def.displayName}** \u2014 **${mr}** quick math rounds in this thread:`);
        if (mr > 1) {
            lines.push(
                '\u2022 **Multi-round:** only whoever **started this thread** can buzz in \u2014 scores **add**; war credit stays on **their** faction.',
            );
        } else {
            lines.push('\u2022 **Single round:** first correct click wins; war credit follows whoever earns the match (host or guest).');
        }
        const fr = def.defaultCasualRewards?.first || 12;
        lines.push(
            `\u2022 Each round cleared \u00b7 ~**${fr}** points toward the match total (all **${mr}** rounds \u2248 **${fr * mr}** before server cap).`,
        );
    } else if (tag === 'combo_builder') {
        lines.push('');
        lines.push(`**${def.displayName}** \u2014 **${mr}** random draws (tier adds points each time, then **summed**).`);
    } else if (tag === 'logic_grid_mini') {
        lines.push('');
        lines.push(`**${def.displayName}** \u2014 **${mr}** logic picks; each correct adds to the match total, wrong ends early with what you already earned.`);
    } else if (tag === 'multi_step_trivia') {
        const steps = def.balancingConfig?.steps || 5;
        const tiers = def.balancingConfig?.tierPoints || [4, 7, 10];
        lines.push('');
        lines.push(`**${def.displayName}** \u2014 **${steps}** steps; wrong ends the chain (partial credit from tiers):`);
        lines.push(`\u2022 Examples: **1** right \u2248 **${tiers[0] ?? 4}**, **${steps}** right \u2248 **${tiers[steps - 1] ?? db}**.`);
    } else if (tag === 'risk_roll') {
        const maxR = def.balancingConfig?.maxRounds || 6;
        lines.push('');
        lines.push(`**${def.displayName}** \u2014 up to **${maxR}** rolls; **Lock** or bust to finish. Score scales with banked total.`);
    } else if (tag === 'king_of_the_hill') {
        lines.push('');
        lines.push(`**${def.displayName}** \u2014 several challenge rolls; score scales with how often you took the crown.`);
    } else if (tag === 'last_man_standing' || tag === 'pattern_memory') {
        lines.push('');
        lines.push(`**${def.displayName}** \u2014 multi-step elimination or memory; score depends on placement / progress.`);
    } else {
        lines.push('');
        lines.push(`**${def.displayName}** \u2014 typical strong outcome \u2248 **${db}**+; weak \u2248 **${part}**.`);
    }
    return new EmbedBuilder()
        .setTitle('\u2694\ufe0f How this helps your faction (ranked wars)')
        .setColor(0xf0b232)
        .setDescription(lines.filter((l) => l !== '').join('\n\n').slice(0, 3900));
}

async function finishSession(client, session, factionBase, interaction, meta = {}) {
    const settings = await getSettings();
    const base = capBase(session.tag, settings, factionBase);
    const publicExtra = meta.publicExtra || '';
    const rot = await ensureRotationForDate();

    // If a guest (non-host) is being credited, check their daily play cap
    let countsForPoints = session.countsForPoints !== false;
    const isGuestWinner = session._originalHostId && session.userId !== session._originalHostId;
    if (isGuestWinner && countsForPoints) {
        try {
            const guestDaily = await checkAndIncrementDailyPlaygame(session.guildId, session.userId, false);
            countsForPoints = guestDaily.countsForPoints;
        } catch (_) { /* best-effort */ }
    }

    const award = await awardPlatformGameScore({
        client,
        guildId: session.guildId,
        userId: session.userId,
        gameTag: session.tag,
        factionBasePoints: base,
        interaction,
        hostIsPremium: session.hostAura,
        settingsDoc: settings,
        rotationFeaturedTag: rot.featuredTag,
        countsForPoints: countsForPoints,
        isWarSession: !!session.isWarSession,
    });
    await recordSessionCompleted(session.tag, base, 0);
    sessions.delete(session.id);

    const fc = award?.factionChallengeCredit;
    const showWarHint = new Set([
        FactionCreditReasonCode.HOSTED_EXCLUDED_FROM_RANKED,
        FactionCreditReasonCode.NOT_RANKED_ELIGIBLE_PLATFORM,
        FactionCreditReasonCode.SOCIAL_RANKED_DISABLED,
        FactionCreditReasonCode.TAG_NOT_IN_WAR_POOL,
    ]);
    if (interaction && fc?.credited && (fc.pointsAdded ?? 0) > 0) {
        await interaction
            .followUp({
                content: `\u2694\ufe0f **+${fc.pointsAdded}** toward this server's **active faction war** (official formula decides the winner).`,
                ephemeral: true,
            })
            .catch(() => {});
    } else if (interaction && fc && !fc.credited && fc.userMessage && showWarHint.has(fc.reasonCode)) {
        await interaction.followUp({ content: `\u2139\ufe0f ${fc.userMessage}`, ephemeral: true }).catch(() => {});
    }

    if (session.threadless) {
        if (interaction) {
            await interaction
                .followUp(
                    withEphemeral({
                        content:
                            `\ud83c\udfc1 **Match finished.** This playthrough is **over** \u2014 your result is saved (**${base}** points).` +
                            (publicExtra ? `\n${publicExtra}` : ''),
                    }),
                )
                .catch(() => {});
        }
        return;
    }

    try {
        const ch = await client.channels.fetch(session.threadId).catch(() => null);
        if (ch && typeof ch.send === 'function') {
            await ch
                .send({
                    content:
                        `\ud83c\udfc1 **Match finished.** This playthrough is **over** \u2014 your result is saved (**${base}** points).` +
                        (publicExtra ? `\n${publicExtra}` : ''),
                })
                .catch(() => {});
        }
        await finalizeHostedGameThread(ch, { disableComponents: true });
    } catch (_) {
        /* ignore */
    }
}

/**
 * @param {object} opts
 * @param {import('discord.js').ChatInputCommandInteraction} opts.interaction
 * @param {import('discord.js').Client} opts.client
 * @param {string} opts.tag
 * @param {string} [opts.threadName]
 * @param {boolean} [opts.bypassRotation]
 */
async function launchPlatformGameThread({ interaction, client, tag, threadName: threadNameOpt, bypassRotation }) {
    const guildId = interaction.guildId;
    const rot = await ensureRotationForDate();
    if (!bypassRotation && !rot.activeTags.includes(tag)) {
        return {
            ok: false,
            message:
                `**${tag}** is not in **today\u2019s rotation** (UTC). Active: ${rot.activeTags.join(', ') || '\u2014'}\n` +
                'Rotation refreshes daily \u2014 try another game or ask an admin.',
        };
    }

    const settings = await getSettings();
    const def = resolveGame(tag, settings);
    if (!def || !def.enabled) {
        return { ok: false, message: 'That game is disabled.' };
    }

    const hostDoc = await getUser(guildId, interaction.user.id);
    const hostAura = !!hostDoc.isPremium;
    const isWarSession = await isUserEnrolledInActiveFactionChallenge(
        guildId,
        interaction.user.id,
        hostDoc.faction,
    );
    const dailyPlay = await checkAndIncrementDailyPlaygame(guildId, interaction.user.id, isWarSession);

    throwIfImmediateGameStartBlockedByMaintenance(Date.now(), PLATFORM_SESSION_MAINTENANCE_ASSUME_MS);
    const threadless = isThreadlessPlatformTag(tag);
    const threadName = threadNameOpt || defaultGameThreadName(def.displayName);
    const channel = interaction.channel;
    if (!channel) {
        return { ok: false, message: 'Cannot start here.' };
    }

    const overlap = await getFactionChallengeOverlapWarning(guildId, 0, tag);
    const feat =
        rot.featuredTag === tag
            ? '\n\ud83c\udf1f **Featured Game of the Day**'
            : '';

    await recordSessionStarted(tag);

    const session = {
        id: newSessionId(),
        tag,
        guildId,
        userId: interaction.user.id,
        _originalHostId: interaction.user.id,
        threadId: null,
        channelId: channel.id,
        hostAura,
        client,
        threadless,
        countsForPoints: dailyPlay.countsForPoints,
        isWarSession,
    };
    sessions.set(session.id, session);

    if (threadless) {
        const transport = createEphemeralTransport(interaction);
        const rulesRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(cid(tag, session.id, 'rules'))
                .setLabel('\ud83d\udcd6 Rules & scoring')
                .setStyle(ButtonStyle.Secondary),
        );
        const warLine = isWarSession
            ? '\n\u2694\ufe0f Enrolled in an active faction war \u2014 your score counts.'
            : (def.rankedEligible ? '\n\u2705 Counts toward ranked wars when enrolled.' : '');
        await transport.send({
            content:
                `\ud83c\udfae **${def.displayName}**${feat}${warLine}${overlap ? `\n${overlap}` : ''}`,
            components: [rulesRow],
        });
        await dispatchGameStart(transport, session, client, def, rot);
        return { ok: true, thread: null, def, threadless: true, dailyCapNote: dailyPlay.message || null };
    }

    if (!channel.threads) {
        sessions.delete(session.id);
        return { ok: false, message: 'Cannot start here.' };
    }

    let thread;
    try {
        thread = await createPlatformGameThread(channel, threadName, def.displayName, { privateThread: true });
    } catch (_) {
        thread = await createPlatformGameThread(channel, threadName, def.displayName);
    }
    session.threadId = thread.id;

    const rulesRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(cid(tag, session.id, 'rules'))
            .setLabel('\ud83d\udcd6 Rules & scoring')
            .setStyle(ButtonStyle.Secondary),
    );
    const warLine = isWarSession
        ? '\n\u2694\ufe0f Enrolled in an active faction war \u2014 your score counts.'
        : (def.rankedEligible ? '\n\u2705 Counts toward ranked wars when enrolled.' : '');
    await thread.send({
        content:
            `<@${interaction.user.id}> started **${def.displayName}**${feat}${warLine}${overlap ? `\n${overlap}` : ''}`,
        components: [rulesRow],
    });

    await dispatchGameStart(thread, session, client, def, rot);
    return { ok: true, thread, def, threadless: false, dailyCapNote: dailyPlay.message || null };
}

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function handleSlashPlaygame(interaction, client) {
    const tag = interaction.options.getString('game', true);
    if (tag === '__none__') {
        return interaction.reply({ content: 'Pick a **game** from the autocomplete list.', ephemeral: true });
    }
    const guildId = interaction.guildId;
    if (!guildId) {
        return interaction.reply({ content: 'Use this in a server.', ephemeral: true });
    }

    const dev = isBotDeveloper(interaction.user.id);
    const hasDevRotationBypass =
        process.env.PLAYBOUND_REGISTER_DEV_SLASH_OPTIONS === '1' &&
        interaction.options.data.some((o) => o.name === 'ignore_rotation');
    const ignoreRotationOpt = hasDevRotationBypass ? interaction.options.getBoolean('ignore_rotation') : null;
    const bypassRotation = dev && hasDevRotationBypass && ignoreRotationOpt !== false;
    const rot = await ensureRotationForDate();
    if (!bypassRotation && !rot.activeTags.includes(tag)) {
        return interaction.reply({
            content:
                `**${tag}** is not in **today\u2019s rotation** (UTC). Active: ${rot.activeTags.join(', ') || '\u2014'}\n` +
                'Rotation refreshes daily \u2014 try another game or ask an admin.',
            ephemeral: true,
        });
    }

    const settings = await getSettings();
    const def = resolveGame(tag, settings);
    if (!def || !def.enabled) {
        return interaction.reply({ content: 'That game is disabled.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const threadName = interaction.options.getString('thread_name') || defaultGameThreadName(def.displayName);
    const out = await launchPlatformGameThread({
        interaction,
        client,
        tag,
        threadName,
        bypassRotation,
    });
    if (!out.ok) {
        return interaction.editReply({ content: out.message });
    }
    if (out.threadless) {
        return;
    }
    let confirm = `Game thread: ${out.thread}`;
    if (bypassRotation && !rot.activeTags.includes(tag)) {
        confirm += '\n\ud83d\udd27 **Developer:** outside today\u2019s UTC rotation (testing).';
    }
    if (out.dailyCapNote) {
        confirm += `\n\n\u2139\ufe0f ${out.dailyCapNote}`;
    }
    await interaction.editReply({ content: confirm });
}

/**
 * Onboarding: start Reaction Rush or Risk Roll even if not in today\u2019s pool (still must be enabled in config).
 */
async function startOnboardingQuickGame(interaction, client) {
    const guildId = interaction.guildId;
    if (!guildId) {
        return interaction.reply({ content: 'Use this in a server.', ephemeral: true });
    }
    const tag = await pickOnboardingGameTag();
    if (!tag) {
        return interaction.reply({
            content: 'Quick games are turned off in settings. Ask an admin or use `/playgame` when one is available.',
            ephemeral: true,
        });
    }
    const settings = await getSettings();
    const def = resolveGame(tag, settings);
    const threadName = defaultGameThreadName(def.displayName);
    if (interaction.deferred || interaction.replied) {
        const out = await launchPlatformGameThread({
            interaction,
            client,
            tag,
            threadName,
            bypassRotation: true,
        });
        if (!out.ok) {
            return interaction.editReply({ content: out.message }).catch(() => {});
        }
        if (out.threadless) {
            return;
        }
        let msg = `Your game: ${out.thread}`;
        if (out.dailyCapNote) msg += `\n\n\u2139\ufe0f ${out.dailyCapNote}`;
        return interaction.editReply({ content: msg }).catch(() => {});
    }
    await interaction.deferReply({ ephemeral: true });
    const out = await launchPlatformGameThread({
        interaction,
        client,
        tag,
        threadName,
        bypassRotation: true,
    });
    if (!out.ok) {
        return interaction.editReply({ content: out.message });
    }
    if (out.threadless) {
        return;
    }
    let obMsg = `Your game: ${out.thread}`;
    if (out.dailyCapNote) obMsg += `\n\n\u2139\ufe0f ${out.dailyCapNote}`;
    return interaction.editReply({ content: obMsg });
}

async function dispatchGameStart(thread, session, client, def, rot) {
    const tag = session.tag;
    try {
        if (tag === 'risk_roll') return startRiskRoll(thread, session, client, def);
        if (tag === 'target_21') return startTarget21(thread, session, client, def);
        if (tag === 'dice_duel') return startDiceDuel(thread, session, client, def);
        if (tag === 'king_of_the_hill') return startKingHill(thread, session, client, def);
        if (tag === 'high_card_blitz') return startHighCard(thread, session, client, def);
        if (tag === 'push_luck_deck') return startPushLuck(thread, session, client, def);
        if (tag === 'combo_builder') return startComboBuilder(thread, session, client, def);
        if (tag === 'five_card_draw') return startFiveCardDraw(thread, session, client, def);
        if (tag === 'reaction_rush') return startReactionRush(thread, session, client, def);
        if (tag === 'closest_guess') return startClosestGuess(thread, session, client, def);
        if (tag === 'last_man_standing') return startLastMan(thread, session, client, def);
        if (tag === 'pattern_memory') return startPatternMemory(thread, session, client, def);
        if (tag === 'logic_grid_mini') return startLogicGrid(thread, session, client, def);
        if (tag === 'multi_step_trivia') return startMultiTrivia(thread, session, client, def);
        if (tag === 'lie_detector') return startLieDetector(thread, session, client, def);
        if (tag === 'vote_the_winner') return startVoteWinner(thread, session, client, def);
        if (tag === 'sabotage_mode') return startSabotage(thread, session, client, def);
        await thread.send('Unknown game tag.');
        sessions.delete(session.id);
    } catch (e) {
        console.error('[platformPlay]', tag, e);
        await thread.send('Game failed to start.').catch(() => {});
        sessions.delete(session.id);
    }
}

// --- Risk roll ---
function riskRollEmbed(session, def, lastRollLine) {
    const st = session.state;
    const bust = st.bustOn;
    const maxR = st.maxRounds;
    let desc = `Roll a die. Rolling **${bust}** busts to **0**. Up to **${maxR}** rounds. **Lock** to bank.\n`;
    if (lastRollLine) desc += `\n${lastRollLine}`;
    desc += `\n\n\ud83d\udcb0 **Running total: __${st.total}__** (round ${st.round}/${maxR})`;
    return new EmbedBuilder().setTitle('Risk Roll').setDescription(desc).setColor('#5865F2');
}

async function startRiskRoll(thread, session, client, def) {
    const maxR = def.balancingConfig.maxRounds || 4;
    const bust = def.balancingConfig.bustOn ?? 1;
    session.state = { round: 0, maxRounds: maxR, total: 0, bustOn: bust, busted: false };
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(cid(session.tag, session.id, 'rr_roll')).setLabel('\ud83c\udfb2 Roll').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(cid(session.tag, session.id, 'rr_stop')).setLabel('Lock score').setStyle(ButtonStyle.Success),
    );
    await thread.send({
        embeds: [riskRollEmbed(session, def, '_Tap **Roll** to start._')],
        components: [row],
    });
}

async function handleRiskRoll(interaction, session, action) {
    const settings = await getSettings();
    const def = resolveGame(session.tag, settings);
    if (interaction.user.id !== session.userId) {
        return interaction.reply({ content: 'Not your session.', ephemeral: true });
    }
    const st = session.state;
    if (st.busted || st.stopped) return interaction.reply({ content: 'Round over.', ephemeral: true });

    if (action === 'rr_roll') {
        st.round += 1;
        const d = rollDie(6);
        if (d === st.bustOn) {
            st.busted = true;
            st.total = 0;
            const bustEmbed = new EmbedBuilder()
                .setTitle('\ud83d\udca5 BUST!')
                .setDescription(`Rolled ${formatDieRoll(d)}. Total goes to **0**.`)
                .setColor('#ED4245');
            await interaction.update({ embeds: [bustEmbed], components: [] });
            const base = def.defaultCasualRewards.participate || 2;
            await finishSession(session.client, session, base, interaction);
            return;
        }
        st.total += d;
        if (st.round >= st.maxRounds) {
            st.stopped = true;
            await interaction.update({
                embeds: [riskRollEmbed(session, def, `Last roll: ${formatDieRoll(d)}. **Max rounds reached.**`)],
                components: [],
            });
            const base = Math.min(def.defaultBasePoints + st.total, def.defaultBasePoints + 12);
            await finishSession(session.client, session, base, interaction);
            return;
        }
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(cid(session.tag, session.id, 'rr_roll')).setLabel('\ud83c\udfb2 Roll').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(cid(session.tag, session.id, 'rr_stop')).setLabel('Lock score').setStyle(ButtonStyle.Success),
        );
        return interaction.update({
            embeds: [riskRollEmbed(session, def, `Rolled ${formatDieRoll(d)}.`)],
            components: [row],
        });
    }
    if (action === 'rr_stop') {
        st.stopped = true;
        await interaction.update({
            embeds: [riskRollEmbed(session, def, `\ud83d\udd12 **Locked at ${st.total}.**`)],
            components: [],
        });
        let base = def.defaultBasePoints + Math.min(st.total, 10);
        await finishSession(session.client, session, base, interaction);
    }
}

// --- Target 21 (multiple hands per match) ---
function target21Row(session) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(cid(session.tag, session.id, 't21_hit'))
            .setLabel(`Roll ${DICE_GAME_EMOJI}`)
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(cid(session.tag, session.id, 't21_stand')).setLabel('Stand').setStyle(ButtonStyle.Success),
    );
}

function target21HandEmbed(session) {
    const st = session.state;
    const r = st.handIndex + 1;
    const totalLine = `\ud83d\udcb0 **Total: __${st.sum}__**`;
    const lastLine =
        st.lastRoll != null
            ? `Last roll: +${formatDieRoll(st.lastRoll)} \u2192 **${st.sum}**`
            : '_Tap **Roll** for your first die._';
    return new EmbedBuilder()
        .setTitle(`Target 21 \u2014 hand ${r}/${st.matchRounds}`)
        .setDescription(
            'Roll a die and add to total. **Over 21 busts.** **Stand** banks this hand.\n\n' +
                `${totalLine}\n${lastLine}`,
        );
}

async function sendTarget21Hand(channel, session, def) {
    const st = session.state;
    st.sum = 0;
    st.lastRoll = null;
    await channel.send({
        embeds: [target21HandEmbed(session)],
        components: [target21Row(session)],
    });
}

async function startTarget21(thread, session, client, def) {
    const mr = platformMatchRounds(def);
    session.state = {
        matchRounds: mr,
        handIndex: 0,
        cumulativeBase: 0,
        sum: 0,
        lastRoll: null,
    };
    await sendTarget21Hand(thread, session, def);
}

async function handleTarget21(interaction, session, action, def) {
    if (interaction.user.id !== session.userId) {
        return interaction.reply({ content: 'Not your session.', ephemeral: true });
    }
    const st = session.state;
    const finishHand = async (handBase, note, bustEmbed) => {
        st.cumulativeBase += handBase;
        st.handIndex += 1;
        const updatePayload = { components: [] };
        if (bustEmbed) {
            updatePayload.content = '';
            updatePayload.embeds = [bustEmbed];
        } else {
            updatePayload.content = `${note}\n\n**This hand:** **${handBase}** points \u00b7 **Running total:** **${st.cumulativeBase}** points.`;
            updatePayload.embeds = [];
        }
        await interaction.update(updatePayload);
        if (st.handIndex >= st.matchRounds) {
            await finishSession(session.client, session, st.cumulativeBase, interaction, {
                publicExtra: `_All **${st.matchRounds}** hands were added together._`,
            });
        } else {
            await sendTarget21Hand(makeStepSender(interaction, session), session, def);
        }
    };
    if (action === 't21_hit') {
        const d = rollDie(6);
        st.sum += d;
        st.lastRoll = d;
        if (st.sum > 21) {
            const bustPts = def.defaultCasualRewards.bust || 1;
            const bustEmbed = new EmbedBuilder()
                .setTitle('\ud83d\udca5 BUST!')
                .setDescription(
                    `You rolled ${formatDieRoll(d)} and went to **${st.sum}** \u2014 over 21.\n\n` +
                    `**This hand:** **${bustPts}** point \u00b7 **Running total:** **${st.cumulativeBase + bustPts}** points.`,
                )
                .setColor('#ED4245');
            await finishHand(bustPts, null, bustEmbed);
            return;
        }
        if (st.sum === 21) {
            await finishHand(def.defaultBasePoints + (def.defaultCasualRewards.exact21Bonus || 8), `\ud83c\udfaf **21!** Perfect.`);
            return;
        }
        return interaction.update({
            embeds: [target21HandEmbed(session)],
            components: [target21Row(session)],
        });
    }
    if (action === 't21_stand') {
        const base = def.defaultBasePoints + Math.floor(st.sum / 2);
        await finishHand(base, `\ud83d\udd12 Stood with **${st.sum}**.`);
    }
}

// --- Dice duel (multiple hands per match) ---
function resolveDiceDuelHandBase(def, dice) {
    const sum = dice.reduce((a, b) => a + b, 0);
    const house = rollDie(6) + rollDie(6) + rollDie(6);
    let base = def.defaultCasualRewards.participate || 2;
    let outcome = '';
    if (sum > house) {
        base = def.defaultBasePoints + 4;
        outcome = '\ud83c\udf89 **You beat the house.**';
    } else if (sum === house) {
        base = def.defaultBasePoints;
        outcome = '\ud83e\udd1d **Tie.**';
    } else {
        outcome = '\ud83c\udfe0 **House wins** this time.';
    }
    const trip = dice[0] === dice[1] && dice[1] === dice[2];
    if (trip && def.balancingConfig.comboBonusRanked) base += 3;
    else if (trip) base += 5;
    return { house, sum, base, outcome };
}

async function sendDiceDuelHand(channel, session, def) {
    const st = session.state;
    st.dice = [rollDie(6), rollDie(6), rollDie(6)];
    st.rerolled = false;
    st.locked = false;
    const r = st.handIndex + 1;
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(cid(session.tag, session.id, 'dd', 'reroll')).setLabel('Reroll one').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(cid(session.tag, session.id, 'dd', 'lock')).setLabel('Lock dice').setStyle(ButtonStyle.Primary),
    );
    await channel.send({
        content: `**Duel ${r}/${st.matchRounds}** \u2014 Your dice: **${st.dice.map((d) => formatDieRoll(d)).join(' ')}**. Reroll one or lock.`,
        components: [row],
    });
}

async function startDiceDuel(thread, session, client, def) {
    const mr = platformMatchRounds(def);
    session.state = { matchRounds: mr, handIndex: 0, cumulativeBase: 0, dice: [], rerolled: false, locked: false };
    await sendDiceDuelHand(thread, session, def);
}

async function handleDiceDuel(interaction, session, action, extra, def) {
    if (interaction.user.id !== session.userId) {
        return interaction.reply({ content: 'Not your session.', ephemeral: true });
    }
    const st = session.state;
    if (st.locked) return interaction.reply({ content: 'Already locked.', ephemeral: true });
    if (action === 'dd' && extra === 'reroll') {
        if (st.rerolled) return interaction.reply({ content: 'Already rerolled once.', ephemeral: true });
        st.rerolled = true;
        const idx = st.dice.indexOf(Math.min(...st.dice));
        st.dice[idx] = rollDie(6);
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(cid(session.tag, session.id, 'dd', 'lock')).setLabel('Lock dice').setStyle(ButtonStyle.Primary),
        );
        return interaction.update({
            content: `Rerolled \u2014 dice now: **${st.dice.map((d) => formatDieRoll(d)).join(' ')}**. Lock to reveal house.`,
            components: [row],
        });
    }
    if (action === 'dd' && extra === 'lock') {
        st.locked = true;
        const res = resolveDiceDuelHandBase(def, st.dice);
        st.cumulativeBase += res.base;
        st.handIndex += 1;
        await interaction.update({
            content:
                `**Duel ${st.handIndex}/${st.matchRounds}** \u2014 You **${res.sum}** vs house **${res.house}**. ${res.outcome}\n` +
                `**This duel:** **${res.base}** points. **Running total:** **${st.cumulativeBase}** points.`,
            components: [],
        });
        if (st.handIndex >= st.matchRounds) {
            await finishSession(session.client, session, st.cumulativeBase, interaction, {
                publicExtra: `_All **${st.matchRounds}** duels were added together._`,
            });
        } else {
            await sendDiceDuelHand(makeStepSender(interaction, session), session, def);
        }
    }
}

// --- King of the hill ---
async function startKingHill(thread, session, client, def) {
    const k1 = rollDie(6);
    const k2 = rollDie(6);
    const maxR = def.balancingConfig.rounds || 4;
    session.state = {
        king: k1 + k2,
        kingDice: [k1, k2],
        round: 0,
        maxR,
        bestBeat: 0,
    };
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(cid(session.tag, session.id, 'kh_roll')).setLabel('Challenge roll (2d6)').setStyle(ButtonStyle.Primary),
    );
    await thread.send({
        content: `\ud83d\udc51 King opened with ${formatTwoD6(k1, k2)}. Roll **2d6** to beat the king (**${session.state.maxR}** tries).`,
        components: [row],
    });
}

async function handleKingHill(interaction, session, action, def) {
    if (interaction.user.id !== session.userId) {
        return interaction.reply({ content: 'Not your session.', ephemeral: true });
    }
    const st = session.state;
    if (st.done) return interaction.reply({ content: 'Done.', ephemeral: true });
    if (action === 'kh_roll') {
        st.round += 1;
        const d1 = rollDie(6);
        const d2 = rollDie(6);
        const r = d1 + d2;
        const row =
            st.round >= st.maxR
                ? []
                : [
                      new ActionRowBuilder().addComponents(
                          new ButtonBuilder()
                              .setCustomId(cid(session.tag, session.id, 'kh_roll'))
                              .setLabel('Challenge roll (2d6)')
                              .setStyle(ButtonStyle.Primary),
                      ),
                  ];
        if (r > st.king) {
            st.bestBeat += 1;
            st.king = r;
            await interaction.update({
                content:
                    st.round >= st.maxR
                        ? `\ud83d\udc51 New king ${formatTwoD6(d1, d2)}!`
                        : `\ud83d\udc51 New king ${formatTwoD6(d1, d2)}! **Try ${st.round}/${st.maxR}** complete. Press again to challenge the new king **${st.king}**.`,
                components: row,
            });
        } else {
            await interaction.update({
                content: `Rolled ${formatTwoD6(d1, d2)} \u2014 didn't beat **${st.king}**.`,
                components: row,
            });
        }
        if (st.round >= st.maxR) {
            st.done = true;
            const base = def.defaultBasePoints + st.bestBeat * 3;
            await finishSession(session.client, session, base, interaction);
        }
    }
}

// --- High card (multiple hands per match) ---
function highCardRow(session) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(cid(session.tag, session.id, 'hc_dd')).setLabel('Double down').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(cid(session.tag, session.id, 'hc_show')).setLabel('Reveal').setStyle(ButtonStyle.Primary),
    );
}

async function startHighCard(thread, session, client, def) {
    session.platformMatchRounds = platformMatchRounds(def);
    await scheduleSpeedPrepIfNeeded(thread, session, async () => {
        const mr = session.platformMatchRounds;
        session.state = {
            matchRounds: mr,
            handIndex: 0,
            cumulativeBase: 0,
            card: rollDie(13),
            doubled: false,
            phase: 'choose',
        };
        await thread.send({
            content: `**Hand 1/${mr}** \u2014 **Go time.** Secret card **1\u201313** drawn. Double down for higher risk/reward.`,
            components: [highCardRow(session)],
        });
    });
}

async function handleHighCard(interaction, session, action, def) {
    if (interaction.user.id !== session.userId) {
        return interaction.reply({ content: 'Not your session.', ephemeral: true });
    }
    const st = session.state;
    if (action === 'hc_dd' && st.phase === 'choose') {
        st.doubled = true;
        return interaction.update({
            content: `**Hand ${st.handIndex + 1}/${st.matchRounds}** \u2014 Double down locked in. Press **Reveal**.`,
            components: [highCardRow(session)],
        });
    }
    if (action === 'hc_show') {
        const house = rollDie(13);
        const win = st.card > house;
        let base = win ? def.defaultBasePoints + 4 : 2;
        if (st.doubled && def.balancingConfig.doubleDownRanked) base += win ? 3 : -1;
        else if (st.doubled) base += win ? 6 : 0;
        base = Math.max(1, base);
        st.cumulativeBase += base;
        st.handIndex += 1;
        await interaction.update({
            content: `You **${st.card}** vs house **${house}** \u2014 ${win ? 'WIN' : 'LOSS'}\n**This hand:** **${base}** points. **Running total:** **${st.cumulativeBase}** points.`,
            components: [],
        });
        if (st.handIndex >= st.matchRounds) {
            await finishSession(session.client, session, st.cumulativeBase, interaction, {
                publicExtra: `_All **${st.matchRounds}** hands were added together._`,
            });
        } else {
            st.card = rollDie(13);
            st.doubled = false;
            st.phase = 'choose';
            await makeStepSender(interaction, session).send({
                content: `**Hand ${st.handIndex + 1}/${st.matchRounds}** \u2014 New secret card. Double down optional.`,
                components: [highCardRow(session)],
            });
        }
    }
}

// --- Push luck deck (multiple hands per match) ---
function pushLuckRow(session) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(cid(session.tag, session.id, 'pl_draw')).setLabel('Draw').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(cid(session.tag, session.id, 'pl_stop')).setLabel('Stop').setStyle(ButtonStyle.Success),
    );
}

function pushLuckBoardContent(session, def) {
    const st = session.state;
    const r = st.handIndex + 1;
    const cap = def.balancingConfig.rankedBankCap || 99;
    let s =
        `**Push hand ${r}/${st.matchRounds}**\n\n\ud83d\udcb0 **Bank: __${st.bank}__** / cap **${cap}** \u2014 Deck: +2\u2013+5 or **BUST**.`;
    if (st.lastDrawDelta != null) {
        s += `\n_Last draw: **+${st.lastDrawDelta}**_`;
    }
    return s;
}

async function sendPushLuckHand(channel, session, def) {
    const st = session.state;
    st.bank = 0;
    st.bust = false;
    st.handDone = false;
    st.lastDrawDelta = null;
    await channel.send({
        content: pushLuckBoardContent(session, def),
        components: [pushLuckRow(session)],
    });
}

async function startPushLuck(thread, session, client, def) {
    const mr = platformMatchRounds(def);
    session.state = {
        matchRounds: mr,
        handIndex: 0,
        cumulativeBase: 0,
        bank: 0,
        bust: false,
        handDone: false,
        lastDrawDelta: null,
    };
    await sendPushLuckHand(thread, session, def);
}

async function advancePushLuckHand(interaction, session, def, handBase, note) {
    const st = session.state;
    st.cumulativeBase += handBase;
    st.handIndex += 1;
    await interaction.update({
        content: `${note}\n**This hand:** **${handBase}** points. **Running total:** **${st.cumulativeBase}** points.`,
        components: [],
    });
    if (st.handIndex >= st.matchRounds) {
        await finishSession(session.client, session, st.cumulativeBase, interaction, {
            publicExtra: `_All **${st.matchRounds}** hands were added together._`,
        });
    } else {
        await sendPushLuckHand(makeStepSender(interaction, session), session, def);
    }
}

async function handlePushLuck(interaction, session, action, def) {
    if (interaction.user.id !== session.userId) {
        return interaction.reply({ content: 'Not your session.', ephemeral: true });
    }
    const st = session.state;
    if (st.handDone) return interaction.reply({ content: 'Hand done.', ephemeral: true });
    if (action === 'pl_draw') {
        if (Math.random() < 0.2) {
            st.bust = true;
            st.handDone = true;
            await advancePushLuckHand(interaction, session, def, 1, '\ud83d\udca5 **BUST**');
            return;
        }
        const delta = 2 + Math.floor(Math.random() * 4);
        st.bank += delta;
        st.lastDrawDelta = delta;
        const cap = def.balancingConfig.rankedBankCap || 99;
        if (st.bank >= cap) {
            st.handDone = true;
            await advancePushLuckHand(
                interaction,
                session,
                def,
                def.defaultBasePoints + cap,
                `\ud83c\udfe6 Bank hit cap **${cap}**.`,
            );
            return;
        }
        return interaction.update({
            content: pushLuckBoardContent(session, def),
            components: [pushLuckRow(session)],
        });
    }
    if (action === 'pl_stop') {
        st.handDone = true;
        await advancePushLuckHand(
            interaction,
            session,
            def,
            def.defaultBasePoints + st.bank,
            `\ud83d\udd12 Stopped with bank **${st.bank}**.`,
        );
    }
}

// --- Combo builder ---
function handTier(nums) {
    const counts = {};
    for (const n of nums) counts[n] = (counts[n] || 0) + 1;
    const vals = Object.values(counts).sort((a, b) => b - a);
    if (vals[0] >= 4) return 5;
    if (vals[0] === 3 && vals[1] === 2) return 4;
    const sorted = [...nums].sort((a, b) => a - b);
    const isSeq = sorted.every((v, i) => i === 0 || v === sorted[i - 1] + 1);
    if (isSeq) return 3;
    if (vals[0] === 3) return 3;
    if (vals[0] === 2 && vals[1] === 2) return 2;
    if (vals[0] === 2) return 1;
    return 0;
}

async function postComboBuilderDraw(channel, session, def, interaction) {
    const st = session.state;
    const draws = def.balancingConfig.drawSize || 5;
    const cards = [];
    for (let i = 0; i < draws; i++) cards.push(rollDie(13));
    const tier = handTier(cards.slice(0, 5));
    const tierNames = ['High', 'Pair', 'Two pair', 'Trips/Straight', 'Full house', 'Quads+'];
    const handBase = def.defaultBasePoints + tier * 3;
    st.cumulativeBase += handBase;
    st.handIndex += 1;
    const CARD_FACES = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
    const SUITS = ['\u2660', '\u2665', '\u2666', '\u2663'];
    const cardStr = cards.map((n) => `**${CARD_FACES[n] || n}${SUITS[n % 4]}**`).join('  ');
    const line = `**Draw ${st.handIndex}/${st.matchRounds}** \u2014 ${cardStr} \u2192 **${tierNames[tier]}** (**+${handBase}** points this draw)`;
    if (st.handIndex >= st.matchRounds) {
        const summary = `${line}\n\n**Match total: ${st.cumulativeBase} points**`;
        if (interaction) await interaction.update({ content: summary, components: [] });
        else await channel.send(summary);
        await finishSession(session.client, session, st.cumulativeBase, interaction, {
            publicExtra: `_All **${st.matchRounds}** draws were added together._`,
        });
    } else {
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(cid(session.tag, session.id, 'cb_next')).setLabel('Next draw').setStyle(ButtonStyle.Primary),
        );
        if (interaction) await interaction.update({ content: line, components: [row] });
        else await channel.send({ content: line, components: [row] });
    }
}

async function startComboBuilder(thread, session, client, def) {
    const mr = platformMatchRounds(def);
    session.state = { matchRounds: mr, handIndex: 0, cumulativeBase: 0 };
    await postComboBuilderDraw(thread, session, def, null);
}

async function handleComboNext(interaction, session, def) {
    if (interaction.user.id !== session.userId) {
        return interaction.reply({ content: 'Not your session.', ephemeral: true });
    }
    await postComboBuilderDraw(interaction.channel, session, def, interaction);
}

// --- Five Card Draw (true poker draw) ---
const FCD_SUITS = ['\u2660\ufe0f', '\u2665\ufe0f', '\u2666\ufe0f', '\u2663\ufe0f'];
const FCD_RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

function fcdDeck() {
    const d = [];
    for (let s = 0; s < 4; s++) {
        for (let r = 0; r < 13; r++) {
            d.push({ rank: r, suit: s, label: `**${FCD_RANKS[r]}**${FCD_SUITS[s]}` });
        }
    }
    return d.sort(() => Math.random() - 0.5);
}

function fcdHandTier(cards) {
    const ranks = cards.map((c) => c.rank);
    const suits = cards.map((c) => c.suit);
    const counts = {};
    for (const r of ranks) counts[r] = (counts[r] || 0) + 1;
    const vals = Object.values(counts).sort((a, b) => b - a);
    const flush = suits.every((s) => s === suits[0]);
    const sorted = [...ranks].sort((a, b) => a - b);
    const straight =
        sorted.every((v, i) => i === 0 || v === sorted[i - 1] + 1) ||
        (sorted[0] === 0 && sorted[1] === 9 && sorted[2] === 10 && sorted[3] === 11 && sorted[4] === 12);
    if (flush && straight) return { tier: 8, name: 'Straight Flush' };
    if (vals[0] === 4) return { tier: 7, name: 'Four of a Kind' };
    if (vals[0] === 3 && vals[1] === 2) return { tier: 6, name: 'Full House' };
    if (flush) return { tier: 5, name: 'Flush' };
    if (straight) return { tier: 4, name: 'Straight' };
    if (vals[0] === 3) return { tier: 3, name: 'Three of a Kind' };
    if (vals[0] === 2 && vals[1] === 2) return { tier: 2, name: 'Two Pair' };
    if (vals[0] === 2) return { tier: 1, name: 'Pair' };
    return { tier: 0, name: 'High Card' };
}

function fcdHandDisplay(cards, held) {
    return cards.map((c, i) => {
        const h = held && held.has(i) ? '\u2705' : '';
        return `${c.label}${h}`;
    }).join('  ');
}

function fcdHoldRow(session, cards) {
    const row1 = new ActionRowBuilder();
    for (let i = 0; i < cards.length; i++) {
        const held = session.state.held.has(i);
        row1.addComponents(
            new ButtonBuilder()
                .setCustomId(cid(session.tag, session.id, 'fcd_hold', String(i)))
                .setLabel(`${held ? '\u2705 ' : ''}${FCD_RANKS[cards[i].rank]}${FCD_SUITS[cards[i].suit]}`)
                .setStyle(held ? ButtonStyle.Success : ButtonStyle.Secondary),
        );
    }
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(cid(session.tag, session.id, 'fcd_draw'))
            .setLabel('\ud83c\udccf Draw')
            .setStyle(ButtonStyle.Primary),
    );
    return [row1, row2];
}

async function startFiveCardDraw(thread, session, client, def) {
    const mr = platformMatchRounds(def);
    const deck = fcdDeck();
    const hand = deck.splice(0, 5);
    session.state = {
        matchRounds: mr,
        handIndex: 0,
        cumulativeBase: 0,
        deck,
        hand,
        held: new Set(),
        phase: 'hold',
    };
    const display = fcdHandDisplay(hand, session.state.held);
    await thread.send({
        content: `\ud83c\udccf **Hand 1/${mr}** \u2014 Tap cards to **hold**, then press **Draw** to replace the rest.\n\n${display}`,
        components: fcdHoldRow(session, hand),
    });
}

async function handleFiveCardDraw(interaction, session, action, extra, def) {
    if (interaction.user.id !== session.userId) {
        return interaction.reply({ content: 'Not your session.', ephemeral: true });
    }
    const st = session.state;

    if (action === 'fcd_hold' && st.phase === 'hold') {
        const idx = parseInt(extra, 10);
        if (idx >= 0 && idx < st.hand.length) {
            if (st.held.has(idx)) st.held.delete(idx);
            else st.held.add(idx);
        }
        const display = fcdHandDisplay(st.hand, st.held);
        return interaction.update({
            content: `\ud83c\udccf **Hand ${st.handIndex + 1}/${st.matchRounds}** \u2014 Tap cards to **hold**, then press **Draw**.\n\n${display}`,
            components: fcdHoldRow(session, st.hand),
        });
    }

    if (action === 'fcd_draw') {
        // Replace non-held cards
        for (let i = 0; i < st.hand.length; i++) {
            if (!st.held.has(i) && st.deck.length > 0) {
                st.hand[i] = st.deck.pop();
            }
        }
        const result = fcdHandTier(st.hand);
        const tierPoints = [3, 5, 8, 10, 12, 14, 16, 18, 20];
        const handBase = def.defaultBasePoints + (tierPoints[result.tier] || 3);
        st.cumulativeBase += handBase;
        st.handIndex += 1;
        const display = fcdHandDisplay(st.hand, null);

        if (st.handIndex >= st.matchRounds) {
            await interaction.update({
                content: `\ud83c\udccf **Hand ${st.handIndex}/${st.matchRounds}** \u2014 ${display} \u2192 **${result.name}** (**+${handBase}**)\n\n**Match total: ${st.cumulativeBase} points**`,
                components: [],
            });
            await finishSession(session.client, session, st.cumulativeBase, interaction, {
                publicExtra: `_All **${st.matchRounds}** hands added together._`,
            });
        } else {
            await interaction.update({
                content: `\ud83c\udccf **Hand ${st.handIndex}/${st.matchRounds}** \u2014 ${display} \u2192 **${result.name}** (**+${handBase}** \u00b7 running **${st.cumulativeBase}**)`,
                components: [],
            });
            // Deal next hand
            const newDeck = fcdDeck();
            const newHand = newDeck.splice(0, 5);
            st.deck = newDeck;
            st.hand = newHand;
            st.held = new Set();
            st.phase = 'hold';
            const nextDisplay = fcdHandDisplay(newHand, st.held);
            await makeStepSender(interaction, session).send({
                content: `\ud83c\udccf **Hand ${st.handIndex + 1}/${st.matchRounds}** \u2014 Tap cards to **hold**, then press **Draw**.\n\n${nextDisplay}`,
                components: fcdHoldRow(session, newHand),
            });
        }
    }
}

// --- Reaction rush ---
function shuffleList(list) {
    return [...list].sort(() => Math.random() - 0.5);
}

function uniqueNumericChoices(correct, extras) {
    const values = [];
    for (const v of [correct, ...extras]) {
        const n = Math.floor(Number(v));
        if (!Number.isFinite(n)) continue;
        if (values.includes(n)) continue;
        values.push(n);
        if (values.length >= 3) break;
    }
    while (values.length < 3) {
        const bump = correct + values.length + 2;
        if (!values.includes(bump)) values.push(bump);
    }
    return shuffleList(values.slice(0, 3));
}

function buildReactionRushPrompt() {
    const types = ['sum', 'difference', 'double', 'sequence', 'compare'];
    const type = types[Math.floor(Math.random() * types.length)];

    if (type === 'sum') {
        const a = 7 + Math.floor(Math.random() * 23);
        const b = 6 + Math.floor(Math.random() * 19);
        const answer = a + b;
        return {
            prompt: `Quick: **What is ${a} + ${b}?**`,
            choices: uniqueNumericChoices(answer, [answer - 2, answer + 3, answer + 5]),
            answer,
        };
    }

    if (type === 'difference') {
        const b = 6 + Math.floor(Math.random() * 17);
        const answer = 8 + Math.floor(Math.random() * 16);
        const a = answer + b;
        return {
            prompt: `Quick: **What is ${a} - ${b}?**`,
            choices: uniqueNumericChoices(answer, [answer - 3, answer + 2, answer + 4]),
            answer,
        };
    }

    if (type === 'double') {
        const n = 6 + Math.floor(Math.random() * 19);
        const answer = n * 2;
        return {
            prompt: `Quick: **What is double ${n}?**`,
            choices: uniqueNumericChoices(answer, [answer - 2, answer + 2, answer + 6]),
            answer,
        };
    }

    if (type === 'sequence') {
        const start = 2 + Math.floor(Math.random() * 8);
        const step = 2 + Math.floor(Math.random() * 5);
        const answer = start + step * 3;
        return {
            prompt: `Quick: **What comes next? ${start}, ${start + step}, ${start + step * 2}, ?**`,
            choices: uniqueNumericChoices(answer, [answer - step, answer + step, answer + step * 2]),
            answer,
        };
    }

    const a = 10 + Math.floor(Math.random() * 20);
    const b = 10 + Math.floor(Math.random() * 20);
    const answer = Math.max(a, b);
    return {
        prompt: `Quick: **Which number is larger: ${a} or ${b}?**`,
        choices: uniqueNumericChoices(answer, [Math.min(a, b), answer + 2, answer + 4]),
        answer,
    };
}

async function launchReactionRushRound(channel, session, def) {
    const st = session.state;
    const r = st.roundIndex + 1;
    const round = buildReactionRushPrompt();
    st.ans = round.answer;
    st.roundSolved = false;
    const row = new ActionRowBuilder();
    for (const choice of round.choices) {
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(cid(session.tag, session.id, 'rru', String(choice)))
                .setLabel(String(choice))
                .setStyle(ButtonStyle.Primary),
        );
    }
    const foot = `_Round **${r}/${st.matchRounds}** \u2014 **5 seconds** to answer. Wrong or too slow ends the run._`;
    await channel.send({ content: `\u26a1 ${round.prompt}\n${foot}`, components: [row] });

    // 5-second timeout — auto-fail if no answer
    const sid = session.id;
    const roundIdx = st.roundIndex;
    st._roundTimer = setTimeout(async () => {
        const s = sessions.get(sid);
        if (!s || s.state.roundSolved || s.state.roundIndex !== roundIdx) return;
        s.state.roundSolved = true;
        const floor = def.defaultCasualRewards?.participate ?? 2;
        const finalB = s.state.cumulativeBase > 0 ? s.state.cumulativeBase : floor;
        try {
            await channel.send(`\u23f0 **Time\u2019s up** on round **${r}/${s.state.matchRounds}**. **Match total: ${finalB}**.`);
        } catch (_) {}
        await finishSession(s.client, s, finalB, null);
    }, 5000);
}

async function startReactionRush(thread, session, client, def) {
    const mr = platformMatchRounds(def);
    session.state = {
        matchRounds: mr,
        roundIndex: 0,
        cumulativeBase: 0,
    };
    await launchReactionRushRound(thread, session, def);
}

async function handleReactionRush(interaction, session, action, extra, def) {
    const st = session.state;
    if (st.roundSolved) {
        return interaction.reply({ content: 'Round already answered.', ephemeral: true });
    }
    if (interaction.user.id !== session.userId) {
        return interaction.reply({ content: 'Not your session.', ephemeral: true });
    }
    // Clear the 5-second timeout since the player answered
    if (st._roundTimer) { clearTimeout(st._roundTimer); st._roundTimer = null; }

    const pick = parseInt(extra, 10);
    if (pick !== st.ans) {
        st.roundSolved = true;
        await interaction.update({ content: '\u23f9 Round over.', components: [] });
        const floor = def.defaultCasualRewards?.participate ?? 2;
        const finalB = st.cumulativeBase > 0 ? st.cumulativeBase : floor;
        const roundLabel = st.roundIndex + 1;
        await makeStepSender(interaction, session).send(
            `\u274c **Wrong** on round **${roundLabel}/${st.matchRounds}**. **Match total: ${finalB}**.`,
        ).catch(() => {});
        await finishSession(session.client, session, finalB, interaction);
        return;
    }
    st.roundSolved = true;
    const fr = def.defaultCasualRewards?.first || 12;
    st.cumulativeBase += fr;
    st.roundIndex += 1;
    if (st.roundIndex >= st.matchRounds) {
        await interaction.update({ content: '\u23f9 Round over.', components: [] });
        await makeStepSender(interaction, session).send(
            `\u2705 Round **${st.roundIndex}/${st.matchRounds}** correct (**+${fr}**). **Match total: ${st.cumulativeBase}**.`,
        ).catch(() => {});
        await finishSession(session.client, session, st.cumulativeBase, interaction, {
            publicExtra: `_All **${st.matchRounds}** rounds added together._`,
        });
    } else {
        await interaction.update({
            content: `\u2705 Round **${st.roundIndex}/${st.matchRounds}** correct (**+${fr}** \u00b7 running **${st.cumulativeBase}**). Next in 1s\u2026`,
            components: [],
        });
        setTimeout(() => {
            if (!sessions.has(session.id)) return;
            launchReactionRushRound(makeStepSender(interaction, session), session, def).catch((e) =>
                console.error('[platformPlay reaction_rush next]', e),
            );
        }, 1000);
    }
}

// --- Closest guess (thread messages) ---
async function startClosestGuess(thread, session, client, def) {
    const secret = 1 + Math.floor(Math.random() * 50);
    session.state = { secret, guesses: new Map() };
    await thread.send(
        'Guess a number **1\u201350** by typing a number in this thread. You have **2 minutes**. Closest wins.',
    );
    const col = thread.createMessageCollector({
        filter: (m) => !m.author.bot && /^\d{1,2}$/.test(m.content.trim()),
        time: 120000,
    });
    col.on('collect', async (m) => {
        const v = parseInt(m.content.trim(), 10);
        if (v < 1 || v > 50) return;
        if (session.state.guesses.has(m.author.id)) {
            await m.reply({ content: 'You already guessed \u2014 first number counts.', }).catch(() => {});
            return;
        }
        session.state.guesses.set(m.author.id, { v, t: Date.now() });
        await m.react('\u2705').catch(() => {});
        await m.reply({ content: `\u2705 **${v}** locked in. Good luck!`, }).catch(() => {});
    });
    col.on('end', async () => {
        if (!sessions.has(session.id)) return;
        let best = null;
        let bestDiff = Infinity;
        for (const [uid, g] of session.state.guesses) {
            const d = Math.abs(g.v - secret);
            if (d < bestDiff || (d === bestDiff && g.t < (best?.t ?? Infinity))) {
                bestDiff = d;
                best = { uid, v: g.v, t: g.t };
            }
        }
        await thread.send(`Target was **${secret}**.`).catch(() => {});
        if (!best) {
            await finishSession(client, session, 2, null);
            return;
        }
        const exact = best.v === secret;
        const base = exact
            ? def.defaultBasePoints + (def.defaultCasualRewards.exactHitBonus || 10)
            : def.defaultBasePoints + Math.max(0, 8 - bestDiff);
        await finishSession(client, { ...session, userId: best.uid }, base, null);
    });
}

// --- Last man standing (you vs 6 bots, 2d6 per round) ---
const LMS_BOT_NAMES = [
    'Ace', 'Blitz', 'Cinder', 'Dash', 'Echo', 'Flint',
    'Ghost', 'Hawk', 'Jinx', 'Knox', 'Luna', 'Maverick',
    'Nyx', 'Onyx', 'Pixel', 'Rogue', 'Spark', 'Turbo',
    'Vex', 'Wren', 'Zephyr', 'Bolt', 'Chip', 'Dusk',
];
const LMS_ELIM_PHRASES = [
    'bites the dust',
    'is out of the game',
    'rolls off the table',
    'has left the arena',
    'couldn\'t hang',
    'got sent home',
    'takes the L',
    'is toast',
    'folds under pressure',
    'won\'t be rolling again',
];

function pickLmsBotNames(count) {
    const pool = [...LMS_BOT_NAMES].sort(() => Math.random() - 0.5);
    return pool.slice(0, count);
}

function pickElimPhrase() {
    return LMS_ELIM_PHRASES[Math.floor(Math.random() * LMS_ELIM_PHRASES.length)];
}

async function startLastMan(thread, session, client, def) {
    const botCount = 6;
    const bots = new Array(botCount).fill(0);
    const alive = new Array(botCount + 1).fill(true);
    const botNames = pickLmsBotNames(botCount);
    session.state = { round: 0, you: 0, bots, alive, botNames };
    await runLmsRound(thread, session, client, def);
}

async function runLmsRound(thread, session, client, def) {
    const st = session.state;
    st.round += 1;
    const yourA = rollDie(6);
    const yourB = rollDie(6);
    st.you += yourA + yourB;
    const botRolls = [];
    for (let b = 0; b < st.bots.length; b++) {
        if (st.alive[b + 1]) {
            const a = rollDie(6);
            const bv = rollDie(6);
            st.bots[b] += a + bv;
            botRolls[b] = [a, bv];
        }
    }

    const survivors = [];
    if (st.alive[0]) survivors.push({ i: 0, label: 'You', s: st.you, roll: [yourA, yourB] });
    for (let b = 0; b < st.bots.length; b++) {
        if (st.alive[b + 1]) survivors.push({ i: b + 1, label: st.botNames[b] || `Bot ${b + 1}`, s: st.bots[b], roll: botRolls[b] });
    }
    survivors.sort((a, b) => b.s - a.s);

    const lowestScore = survivors[survivors.length - 1].s;
    const tiedAtBottom = survivors.filter((x) => x.s === lowestScore);
    let elimLine;
    if (tiedAtBottom.length === 1) {
        const elim = tiedAtBottom[0];
        st.alive[elim.i] = false;
        elimLine = `\n\ud83d\udca8 **${elim.label}** ${pickElimPhrase()} (${elim.s})`;
    } else {
        elimLine = '\nNo elimination \u2014 tied players survive this round.';
    }

    const board = survivors.map((p, idx) => {
        const out = !st.alive[p.i] ? ' \u274c' : '';
        const you = p.i === 0 ? ' \u2190 you' : '';
        const rank = idx + 1;
        const medal = rank === 1 ? '\ud83e\udd47' : rank === 2 ? '\ud83e\udd48' : rank === 3 ? '\ud83e\udd49' : '\u2022';
        const rollStr = p.roll ? ` (${formatTwoD6(p.roll[0], p.roll[1])})` : '';
        return `${medal} **${p.label}** \u2014 **${p.s}**${rollStr}${out}${you}`;
    }).join('\n');

    await thread.send(`\ud83c\udfb2 **Round ${st.round}** \u2014 everyone rolled 2 dice.\n\n${board}${elimLine}`);

    const left = st.alive.filter(Boolean).length;
    const table = def.balancingConfig.placementTable || { 1: 12, 2: 6, 3: 3 };
    if (!st.alive[0]) {
        await thread.send('\ud83d\udc80 **You were eliminated** \u2014 match over.').catch(() => {});
        await finishSession(client, session, table[3] || 3, null);
        return;
    }
    if (left === 1) {
        await thread.send('\ud83c\udfc6 **You win** \u2014 all bots are out. **Match over.**').catch(() => {});
        await finishSession(client, session, table[1] || 12, null);
        return;
    }
    if (st.round >= 6) {
        await thread
            .send('\u23f1\ufe0f **Round cap** (6 rounds) \u2014 the match stops here.')
            .catch(() => {});
        await finishSession(client, session, table[2] || 6, null);
        return;
    }
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(cid(session.tag, session.id, 'lms_next')).setLabel('Next round').setStyle(ButtonStyle.Primary),
    );
    await thread.send({
        content: `\u25b6\ufe0f **Still in?** Press **Next round** (${left} survivors \u2014 ends when **one** remains or after **6** rounds).`,
        components: [row],
    });
}

async function handleLmsNext(interaction, session, client, def) {
    if (interaction.user.id !== session.userId) {
        return interaction.reply({ content: 'Not your session.', ephemeral: true });
    }
    await interaction.update({ content: '\u23f9 Rolling\u2026', components: [] });
    await runLmsRound(makeStepSender(interaction, session), session, client, def);
}

// --- Pattern memory (3 rounds, 8 steps; mixed symbols) ---
const PAT_SYMBOLS = [
    { id: 0, show: 'A', label: 'A' },
    { id: 1, show: 'Z', label: 'Z' },
    { id: 2, show: '7', label: '7' },
    { id: 3, show: '4', label: '4' },
    { id: 4, show: '\u25a0', label: '\u25a0' },
    { id: 5, show: '\u25b3', label: '\u25b3' },
];

async function launchPatternRound(thread, session, def) {
    const len = 8;
    const seq = [];
    for (let i = 0; i < len; i++) seq.push(Math.floor(Math.random() * PAT_SYMBOLS.length));
    session.state.seq = seq;
    session.state.step = 0;
    session.state.phase = 'show';
    const shown = seq.map((i) => PAT_SYMBOLS[i].show).join(' \u2192 ');
    const showMs = Math.min(14000, 4000 + len * 850);
    const sec = Math.round(showMs / 1000);
    const roundLabel = session.state.roundIndex + 1;
    const msg = await thread.send(`\ud83e\udde0 **Round ${roundLabel}/${session.state.totalRounds}** \u2014 Memorize: **${shown}** \u2014 you have **${sec}s**`);
    setTimeout(async () => {
        try {
            await msg.edit(`\ud83d\udd12 Sequence hidden. Tap **the same symbols** in order (round ${roundLabel}/${session.state.totalRounds}).`);
        } catch (_) {}
        const rows = [];
        for (let r = 0; r < 2; r++) {
            const row = new ActionRowBuilder();
            for (let c = 0; c < 3; c++) {
                const idx = r * 3 + c;
                if (idx >= PAT_SYMBOLS.length) break;
                const sym = PAT_SYMBOLS[idx];
                row.addComponents(
                    new ButtonBuilder()
                        .setCustomId(cid(session.tag, session.id, 'pm', String(sym.id)))
                        .setLabel(sym.label.slice(0, 80))
                        .setStyle(ButtonStyle.Secondary),
                );
            }
            rows.push(row);
        }
        await thread.send({ components: rows });
    }, showMs);
}

async function startPatternMemory(thread, session, client, def) {
    const totalRounds = 3;
    session.state = { seq: [], step: 0, phase: 'show', roundIndex: 0, totalRounds, cumulativeBase: 0 };
    await launchPatternRound(thread, session, def);
}

async function handlePatternMem(interaction, session, action, extra) {
    const settings = await getSettings();
    const def = resolveGame(session.tag, settings);
    if (interaction.user.id !== session.userId) {
        return interaction.reply({ content: 'Not your session.', ephemeral: true });
    }
    const st = session.state;
    const n = parseInt(extra, 10);
    if (!Number.isFinite(n)) return interaction.reply({ content: 'Invalid input.', ephemeral: true });
    const expect = st.seq[st.step];
    if (n !== expect) {
        await interaction.update({ content: '\u23f9 Round over.', components: [] });
        const floor = def.defaultCasualRewards.participate || 2;
        const finalB = st.cumulativeBase > 0 ? st.cumulativeBase : floor;
        await makeStepSender(interaction, session).send(
            `\u274c Wrong at step ${st.step + 1}/${st.seq.length} (round ${st.roundIndex + 1}/${st.totalRounds}). **Match total: ${finalB}**.`,
        ).catch(() => {});
        await finishSession(session.client, session, finalB, interaction);
        return;
    }
    st.step += 1;
    if (st.step >= st.seq.length) {
        await interaction.update({ content: '\u23f9 Round over.', components: [] });
        const roundBase = def.defaultBasePoints + st.seq.length * (def.balancingConfig.factionPointsPerRound || 4);
        st.cumulativeBase += roundBase;
        st.roundIndex += 1;
        if (st.roundIndex >= st.totalRounds) {
            await makeStepSender(interaction, session).send(
                `\u2705 **All ${st.totalRounds} rounds perfect!** **Match total: ${st.cumulativeBase}**.`,
            ).catch(() => {});
            await finishSession(session.client, session, st.cumulativeBase, interaction, {
                publicExtra: `_All **${st.totalRounds}** pattern rounds were added together._`,
            });
        } else {
            await makeStepSender(interaction, session).send(
                `\u2705 Round ${st.roundIndex}/${st.totalRounds} cleared! (**+${roundBase}** points, running **${st.cumulativeBase}**). Next round starting\u2026`,
            ).catch(() => {});
            await launchPatternRound(makeStepSender(interaction, session), session, def);
        }
        return;
    }
    // Intermediate correct step — update the message content with progress, keep buttons
    const progress = st.seq.slice(0, st.step).map((i) => PAT_SYMBOLS[i].show).join(' ');
    const remaining = st.seq.length - st.step;
    return interaction.update({
        content: `\u2705 ${progress} \u2014 **${st.step}**/${st.seq.length} correct (${remaining} left)`,
    });
}

// --- Logic grid ---
const LOGIC_Q = [
    { q: 'Red house owns the **cat**. Blue is left of Red. Who has the cat?', opts: ['Red', 'Blue', 'Neither'], a: 0 },
    { q: 'Alex runs faster than Sam. Sam runs faster than Jo. Who is slowest?', opts: ['Alex', 'Sam', 'Jo'], a: 2 },
    { q: 'All Bloops are Razzies. No Razzies are Fuzzles. Can a Bloop be a Fuzzle?', opts: ['Yes', 'No', 'Cannot tell'], a: 1 },
    { q: 'Tom is taller than Pat. Pat is taller than Kai. Who is **not** the shortest?', opts: ['Tom', 'Pat', 'Kai'], a: 0 },
    { q: 'If it rains, the field is wet. The field is wet. Did it necessarily rain?', opts: ['Yes', 'No', 'Maybe'], a: 1 },
    { q: 'Lane finished before Morgan. Morgan finished before Quinn. Who finished **last**?', opts: ['Lane', 'Morgan', 'Quinn'], a: 2 },
    { q: 'No birds are mammals. All crows are birds. Is every crow a mammal?', opts: ['Yes', 'No', 'Some are'], a: 1 },
    { q: 'A > B, B > C, C > D. Which is **largest**?', opts: ['A', 'B', 'D'], a: 0 },
    { q: 'Either the key is in the bowl **or** in the drawer (not both). It is **not** in the bowl. Where is it?', opts: ['Drawer', 'Bowl', 'Lost'], a: 0 },
    { q: 'Every winner got a medal. Sam got no medal. Is Sam a winner?', opts: ['Yes', 'No', 'Unknown'], a: 1 },
    { q: 'All squares are rectangles. Figure **S** is a square. Is **S** a rectangle?', opts: ['Yes', 'No', 'Cannot tell'], a: 0 },
    { q: 'At least one of A or B is true. A is false. What about B?', opts: ['True', 'False', 'Unknown'], a: 0 },
];

function pickLogicChain(n) {
    const shuf = [...LOGIC_Q].sort(() => Math.random() - 0.5);
    return shuf.slice(0, Math.max(1, Math.min(n, shuf.length)));
}

async function postLogicStep(channel, session, def) {
    const st = session.state;
    const pick = st.chain[st.step];
    const row = new ActionRowBuilder().addComponents(
        ...pick.opts.map((label, i) =>
            new ButtonBuilder()
                .setCustomId(cid(session.tag, session.id, 'lg', String(i)))
                .setLabel(label.slice(0, 80))
                .setStyle(ButtonStyle.Primary),
        ),
    );
    await channel.send({
        content: `\ud83e\udde9 **Step ${st.step + 1}/${st.chain.length}** \u2014 ${pick.q}`,
        components: [row],
    });
}

async function startLogicGrid(thread, session, client, def) {
    const mr = platformMatchRounds(def);
    const chain = pickLogicChain(mr);
    session.state = { chain, step: 0, cumulativeBase: 0 };
    await postLogicStep(thread, session, def);
}

async function handleLogicGrid(interaction, session, action, extra, def) {
    if (interaction.user.id !== session.userId) {
        return interaction.reply({ content: 'Not your session.', ephemeral: true });
    }
    const st = session.state;
    const pick = st.chain[st.step];
    const i = parseInt(extra, 10);
    const ok = i === pick.a;
    const perCorrect = Math.max(3, Math.round(def.defaultBasePoints / st.chain.length) + 1);
    await interaction.update({ content: '\u23f9 Answered.', components: [] });
    if (!ok) {
        const finalB = st.cumulativeBase > 0 ? st.cumulativeBase : 3;
        await makeStepSender(interaction, session).send(`\u274c **Wrong** \u2014 run ends here. **Match total: ${finalB} points**.`);
        await finishSession(session.client, session, finalB, interaction);
        return;
    }
    st.cumulativeBase += perCorrect;
    st.step += 1;
    if (st.step >= st.chain.length) {
        await makeStepSender(interaction, session).send(`\u2705 **All ${st.chain.length} correct!** **Match total: ${st.cumulativeBase} points**.`);
        await finishSession(session.client, session, st.cumulativeBase, interaction, {
            publicExtra: `_All **${st.chain.length}** logic steps were added together._`,
        });
    } else {
        await postLogicStep(makeStepSender(interaction, session), session, def);
    }
}

// --- Multi-step trivia (Open TDB; fallback pool if API fails) ---
const TRIVIA_POOL_FALLBACK = [
    ['Capital of France?', ['London', 'Paris', 'Berlin'], 1],
    ['2\u00b3 = ?', ['6', '8', '9'], 1],
    ['Chemical formula of water?', ['CO2', 'H2O', 'NaCl'], 1],
    ['How many sides on a standard cube?', ['4', '6', '8'], 1],
    ['Which planet is known as the Red Planet?', ['Venus', 'Mars', 'Jupiter'], 1],
    ['Speed of light in vacuum (approx)?', ['300,000 km/s', '3 km/s', '30 km/s'], 0],
    ['Largest ocean on Earth?', ['Atlantic', 'Indian', 'Pacific'], 2],
    ['Freezing point of water (\u00b0C, 1 atm)?', ['100', '0', '\u221240'], 1],
    ['How many continents are there (common model)?', ['5', '6', '7'], 2],
    ['Which gas do plants absorb for photosynthesis?', ['Oxygen', 'Nitrogen', 'Carbon dioxide'], 2],
    ['What is HCl?', ['Table salt', 'Hydrochloric acid', 'Water'], 1],
    ['Smallest prime number?', ['0', '1', '2'], 2],
    ['12 \u00d7 11 = ?', ['121', '132', '144'], 1],
    ['Square root of 81?', ['7', '8', '9'], 2],
    ['Capital of Japan?', ['Seoul', 'Beijing', 'Tokyo'], 2],
    ['Capital of Canada?', ['Toronto', 'Ottawa', 'Vancouver'], 1],
    ['Which metal is liquid at room temperature?', ['Iron', 'Mercury', 'Copper'], 1],
    ['Earth\u2019s primary source of energy?', ['The Moon', 'The Sun', 'Jupiter'], 1],
    ['How many legs does an insect have?', ['4', '6', '8'], 1],
    ['Which blood type is universal donor (RBCs)?', ['AB', 'A', 'O negative'], 2],
    ['Distance Earth\u2013Moon (order of magnitude)?', ['~4,000 km', '~400,000 km', '~40 million km'], 1],
    ['Which organ pumps blood?', ['Liver', 'Heart', 'Lung'], 1],
    ['Boiling point of water at sea level (\u00b0C)?', ['90', '100', '120'], 1],
    ['Which gas makes up most of Earth\u2019s atmosphere?', ['Oxygen', 'Carbon dioxide', 'Nitrogen'], 2],
    ['A dozen equals?', ['10', '12', '20'], 1],
    ['How many degrees in a circle?', ['180', '360', '400'], 1],
    ['Which is a mammal?', ['Shark', 'Salmon', 'Dolphin'], 2],
    ['Which planet has prominent rings (easiest to see)?', ['Mars', 'Saturn', 'Neptune'], 1],
    ['Atomic number of hydrogen?', ['0', '1', '2'], 1],
    ['Which warms the planet via greenhouse effect?', ['Helium', 'Argon', 'Carbon dioxide'], 2],
];

function buildRandomTriviaChain(pool, stepCount) {
    const want = Math.max(1, Math.min(stepCount, pool.length));
    const idx = pool.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    return idx.slice(0, want).map((i) => pool[i]);
}

function shuffleTriviaOptions(entry) {
    const [q, opts, correctIdx] = entry;
    const tagged = opts.map((label, i) => ({ label, correct: i === correctIdx }));
    tagged.sort(() => Math.random() - 0.5);
    const newIdx = tagged.findIndex((x) => x.correct);
    return [q, tagged.map((x) => x.label), newIdx];
}

async function startMultiTrivia(thread, session, client, def) {
    const steps = Math.max(1, Math.min(50, def.balancingConfig.steps || 3));
    let chain;
    try {
        const rows = await fetchOpenTdbMultipleChoice(steps, {});
        chain = rows.map((r) => {
            const correctIdx = r.answers.findIndex((a) => a === r.correct);
            return [r.question, r.answers, correctIdx >= 0 ? correctIdx : 0];
        });
    } catch (e) {
        console.error('[platformPlay] multi_step_trivia OpenTDB failed, using fallback pool', e);
        const fallbackSteps = Math.min(steps, TRIVIA_POOL_FALLBACK.length);
        chain = buildRandomTriviaChain(TRIVIA_POOL_FALLBACK, fallbackSteps);
    }
    session.state = { step: 0, correct: 0, chain };
    await postTriviaStep(thread, session, def);
}

async function postTriviaStep(thread, session, def) {
    const chain = session.state.chain;
    if (session.state.step >= chain.length) {
        await thread.send('\u2705 **Perfect chain** \u2014 you cleared every step.').catch(() => {});
        const tiers = def.balancingConfig.tierPoints || [4, 7, 10];
        const idx = Math.min(session.state.correct, tiers.length) - 1;
        const base = tiers[Math.max(0, idx)] || def.defaultBasePoints;
        await finishSession(session.client, session, base, null);
        return;
    }
    const raw = chain[session.state.step];
    const [q, opts, ans] = shuffleTriviaOptions(raw);
    session.state.stepCorrectIndex = ans;
    const total = chain.length;
    const row = new ActionRowBuilder().addComponents(
        ...opts.map((label, i) =>
            new ButtonBuilder()
                .setCustomId(cid(session.tag, session.id, 'mt', String(i)))
                .setLabel(label.slice(0, 80))
                .setStyle(ButtonStyle.Primary),
        ),
    );
    await thread.send({
        content: `\u2753 Step **${session.state.step + 1}/${total}** \u2014 ${q}`,
        components: [row],
    });
}

async function handleMultiTrivia(interaction, session, action, extra, def) {
    if (interaction.user.id !== session.userId) {
        return interaction.reply({ content: 'Not your session.', ephemeral: true });
    }
    const chain = session.state.chain;
    const step = session.state.step;
    const pick = parseInt(extra, 10);
    await interaction.update({ content: '\u23f9 Answered.', components: [] });
    if (pick !== session.state.stepCorrectIndex) {
        const cleared = session.state.correct;
        const line =
            cleared > 0
                ? `\u274c **Wrong answer** \u2014 chain stops at step **${step + 1}**. You had **${cleared}** correct before that (partial credit).`
                : '\u274c **Wrong** on the first step \u2014 chain ends here.';
        await makeStepSender(interaction, session).send(line).catch(() => {});
        const tiers = def.balancingConfig.tierPoints || [4, 7, 10];
        const base = cleared > 0 ? tiers[cleared - 1] : 2;
        await finishSession(session.client, session, base, interaction);
        return;
    }
    session.state.correct += 1;
    session.state.step += 1;
    await postTriviaStep(makeStepSender(interaction, session), session, def);
}

// --- Lie detector (exactly one curated true fact; rest false) ---
const LD_STATEMENTS = [
    { label: 'Water freezes at 0\u00b0C at 1 atm', t: true },
    { label: 'The Moon is made of cheese', t: false },
    { label: 'One full rotation of Earth is about 24 hours', t: true },
    { label: 'Sound travels faster in air than in water', t: false },
    { label: 'Sharks are fish', t: true },
    { label: 'Humans have gills', t: false },
    { label: 'The Pacific is an ocean', t: true },
    { label: 'Lightning never strikes the same place twice', t: false },
    { label: 'Antarctica is a desert by precipitation', t: true },
    { label: 'The Sun is a medium-sized star', t: true },
    { label: 'Bats are blind', t: false },
    { label: 'Octopuses are mollusks', t: true },
    { label: 'Gold is a liquid at room temperature', t: false },
    { label: 'There are eight planets in our solar system (IAU)', t: true },
];

function buildLieDetectorRound() {
    const truths = LD_STATEMENTS.filter((x) => x.t);
    const falses = LD_STATEMENTS.filter((x) => !x.t);
    const tpick = truths[Math.floor(Math.random() * truths.length)];
    const pool = falses.filter((f) => f.label !== tpick.label);
    const shuf = [...pool].sort(() => Math.random() - 0.5);
    const pickedFalse = shuf.slice(0, 3);
    const four = [tpick, ...pickedFalse].sort(() => Math.random() - 0.5);
    const truthIndex = four.findIndex((x) => x.t);
    return { labels: four.map((x) => x.label), truthIndex };
}

async function startLieDetector(thread, session, client, def) {
    const { labels, truthIndex } = buildLieDetectorRound();
    session.state = { truth: truthIndex };
    const row = new ActionRowBuilder().addComponents(
        ...labels.map((label, i) =>
            new ButtonBuilder()
                .setCustomId(cid(session.tag, session.id, 'ld', String(i)))
                .setLabel(label.slice(0, 80))
                .setStyle(ButtonStyle.Secondary),
        ),
    );
    await thread.send({
        content:
            '**Exactly one** of these is **actually true** in real life (fixed facts \u2014 not random \u201cAI lies\u201d). Which one?',
        components: [row],
    });
}

async function handleLieDetector(interaction, session, action, extra, def) {
    if (interaction.user.id !== session.userId) {
        return interaction.reply({ content: 'Not your session.', ephemeral: true });
    }
    const i = parseInt(extra, 10);
    const ok = i === session.state.truth;
    await interaction.update({ content: '\u23f9 Locked in.', components: [] });
    await finishSession(session.client, session, ok ? def.defaultCasualRewards.detect || 10 : 3, interaction);
}

// --- Vote the winner (question pool rotation) ---
const VOTE_QUESTIONS = [
    { a: 'Pizza party', b: 'Taco Tuesday' },
    { a: 'Beach vacation', b: 'Mountain retreat' },
    { a: 'Cats', b: 'Dogs' },
    { a: 'Morning person', b: 'Night owl' },
    { a: 'Summer', b: 'Winter' },
    { a: 'Coffee', b: 'Tea' },
    { a: 'Movies', b: 'Books' },
    { a: 'City life', b: 'Country life' },
    { a: 'Sweet snacks', b: 'Salty snacks' },
    { a: 'Superpower: flight', b: 'Superpower: invisibility' },
];

async function startVoteWinner(thread, session, client, def) {
    const q = VOTE_QUESTIONS[Math.floor(Math.random() * VOTE_QUESTIONS.length)];
    session.state = { a: 0, b: 0, voted: new Set(), picks: new Map(), closed: false };
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(cid(session.tag, session.id, 'vt', 'a')).setLabel(`Pick A: ${q.a}`).setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(cid(session.tag, session.id, 'vt', 'b')).setLabel(`Pick B: ${q.b}`).setStyle(ButtonStyle.Success),
    );
    await thread.send({
        content: `**A**: ${q.a} vs **B**: ${q.b} \u2014 vote once! Voting closes in **2 minutes**.`,
        components: [row],
    });
    setTimeout(async () => {
        if (!sessions.has(session.id)) return;
        const st = session.state;
        if (st.closed) return;
        st.closed = true;
        const totalVotes = st.a + st.b;
        const turnoutBonus = Math.min(10, totalVotes);
        const winnerSide = st.a > st.b ? 'A' : st.b > st.a ? 'B' : 'Tie';
        const hostPick = st.picks.get(session.userId) || null;
        const winnerBonus = winnerSide !== 'Tie' && hostPick === winnerSide ? 5 : 0;
        const base = def.defaultBasePoints + turnoutBonus + winnerBonus;
        const summary =
            winnerSide === 'Tie'
                ? `Vote result: **Tie** (${st.a}-${st.b}).`
                : `Vote result: **${winnerSide}** wins (${st.a}-${st.b}).${winnerBonus > 0 ? ' Host picked the winner: **+5** bonus.' : ''}`;
        await finishSession(client, session, base, null, { publicExtra: summary });
    }, 120000);
}

async function handleVoteWinner(interaction, session, action, extra, def) {
    const st = session.state;
    if (st.voted.has(interaction.user.id)) {
        return interaction.reply({ content: 'Already voted.', ephemeral: true });
    }
    st.voted.add(interaction.user.id);
    st.picks.set(interaction.user.id, extra === 'a' ? 'A' : 'B');
    if (extra === 'a') st.a += 1;
    else st.b += 1;
    return interaction.reply({ content: 'Vote counted!', ephemeral: true });
}

// --- Sabotage (narrative solo) ---
async function startSabotage(thread, session, client, def) {
    const sabotage = Math.random() < 0.35;
    session.state = { sabotage };
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(cid(session.tag, session.id, 'sb', 'ok')).setLabel('Complete mission').setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(cid(session.tag, session.id, 'sb', 'sb'))
            .setLabel('Sabotage')
            .setStyle(ButtonStyle.Danger),
    );
    await thread.send({
        content: sabotage
            ? '\ud83d\udd34 **You are the SABOTEUR** (hidden role). Your best score comes from pressing **Sabotage** \u2014 you are trying to wreck the mission.\n' +
                  '_If you press **Complete mission**, you \u201cplay crew\u201d and earn less._'
            : '\ud83d\udfe2 **You are CREW** (hidden role). Press **Complete mission** for the crew bonus.\n' +
                  '_If you press **Sabotage**, you hurt your score \u2014 only the saboteur wants that button._',
        components: [row],
    });
}

async function handleSabotage(interaction, session, action, extra, def) {
    if (interaction.user.id !== session.userId) {
        return interaction.reply({ content: 'Not your session.', ephemeral: true });
    }
    await interaction.update({ content: '\u23f9 Choice locked.', components: [] });
    await makeStepSender(interaction, session)
        .send('\ud83d\uded1 **Choice locked** \u2014 this **one-decision** match is over (scores apply next).')
        .catch(() => {});
    const st = session.state;
    let base = def.defaultCasualRewards.teamWin || 10;
    if (st.sabotage && extra === 'sb') base += def.defaultCasualRewards.sabotageSuccess || 8;
    if (!st.sabotage && extra === 'ok') base += 2;
    await finishSession(session.client, session, base, interaction);
}

// --- Button router ---
async function handlePlatformButton(interaction, client) {
    if (!interaction.isButton() || !interaction.customId.startsWith('pg|')) return false;
    const parts = interaction.customId.split('|');
    const tag = parts[1];
    const sessionId = parts[2];
    const action = parts[3];
    const extra = parts[4] || '';
    const session = sessions.get(sessionId);
    if (!session || session.tag !== tag) {
        await interaction.reply({ content: 'Session expired.', ephemeral: true });
        return true;
    }
    const settings = await getSettings();
    const def = resolveGame(tag, settings);
    if (!def) return true;

    try {
        if (action === 'rules') {
            const warExpl = factionWarCreditExplainerEmbed(tag, def);
            const embeds = [rulesEmbed(tag, def)];
            if (warExpl) embeds.push(warExpl);
            await interaction.reply({ embeds, ephemeral: true });
        } else if (tag === 'risk_roll') {
            await handleRiskRoll(interaction, session, action);
        } else if (tag === 'target_21') {
            await handleTarget21(interaction, session, action, def);
        } else if (tag === 'dice_duel') {
            await handleDiceDuel(interaction, session, action, extra, def);
        } else if (tag === 'king_of_the_hill') {
            await handleKingHill(interaction, session, action, def);
        } else if (tag === 'high_card_blitz') {
            await handleHighCard(interaction, session, action, def);
        } else if (tag === 'push_luck_deck') {
            await handlePushLuck(interaction, session, action, def);
        } else if (tag === 'combo_builder' && action === 'cb_next') {
            await handleComboNext(interaction, session, def);
        } else if (tag === 'five_card_draw' && (action === 'fcd_hold' || action === 'fcd_draw')) {
            await handleFiveCardDraw(interaction, session, action, extra, def);
        } else if (tag === 'reaction_rush') {
            await handleReactionRush(interaction, session, action, extra, def);
        } else if (tag === 'last_man_standing' && action === 'lms_next') {
            await handleLmsNext(interaction, session, client, def);
        } else if (tag === 'pattern_memory') {
            await handlePatternMem(interaction, session, action, extra);
        } else if (tag === 'logic_grid_mini') {
            await handleLogicGrid(interaction, session, action, extra, def);
        } else if (tag === 'multi_step_trivia') {
            await handleMultiTrivia(interaction, session, action, extra, def);
        } else if (tag === 'lie_detector') {
            await handleLieDetector(interaction, session, action, extra, def);
        } else if (tag === 'vote_the_winner') {
            await handleVoteWinner(interaction, session, action, extra, def);
        } else if (tag === 'sabotage_mode') {
            await handleSabotage(interaction, session, action, extra, def);
        } else {
            await interaction.reply({ content: 'Unknown action for this game.', ephemeral: true }).catch(() => {});
        }
    } catch (e) {
        console.error('[platformPlay button]', e);
        await interaction.reply({ content: 'Error.', ephemeral: true }).catch(() => {});
    }
    return true;
}

module.exports = {
    handleSlashPlaygame,
    handlePlatformButton,
    startOnboardingQuickGame,
    launchPlatformGameThread,
    pickOnboardingGameTag,
};
