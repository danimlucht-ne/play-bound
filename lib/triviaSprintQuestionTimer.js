'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, InteractionWebhook } = require('discord.js');
const { getUser } = require('./db');
const { syncGameScores } = require('./gameScoreSync');

/** Per-question limit for trivia sprint (ephemeral answer UI). */
const SPRINT_QUESTION_MS = 20_000;

/**
 * @param {import('discord.js').Client} client
 * @param {string} applicationId
 * @param {string} token
 * @returns {InteractionWebhook}
 */
function sprintQuestionWebhook(client, applicationId, token) {
    return new InteractionWebhook(client, applicationId, token);
}

/**
 * @param {{ players?: Record<string, unknown> }} activeSprint
 * @param {string} userId
 */
function clearSprintQuestionTimer(activeSprint, userId) {
    const p = activeSprint?.players?.[userId];
    if (!p || typeof p !== 'object') return;
    if (p.questionTimerHandle) {
        clearTimeout(p.questionTimerHandle);
        p.questionTimerHandle = undefined;
    }
}

/**
 * @param {{ players?: Record<string, unknown> }} activeSprint
 */
function clearAllSprintQuestionTimers(activeSprint) {
    if (!activeSprint?.players) return;
    for (const uid of Object.keys(activeSprint.players)) {
        clearSprintQuestionTimer(activeSprint, uid);
    }
}

/**
 * @param {import('discord.js').Client} client
 * @param {Map<string, object>} activeSprints
 * @param {string} threadId
 * @param {string} userId
 * @param {import('discord.js').InteractionWebhook} webhook
 * @param {number} qIdxWhenScheduled
 */
async function runSprintQuestionTimeout(client, activeSprints, threadId, userId, qIdxWhenScheduled, webhook) {
    const activeSprint = activeSprints.get(threadId);
    if (!activeSprint) return;
    const p = activeSprint.players[userId];
    if (!p || p.timeTaken != null || p.qIndex !== qIdxWhenScheduled) return;

    const q = activeSprint.questions[p.qIndex];
    const f = `⏱️ **Time's up!** (${q.correct})`;

    if (p.score >= activeSprint.targetScore || p.qIndex === activeSprint.questions.length - 1) {
        p.timeTaken = Date.now() - p.startTime;
        const scoreText =
            p.score >= activeSprint.targetScore ? '🎉 **PERFECT SCORE!**' : `🏁 **FINISHED!** Score: ${p.score}/${activeSprint.targetScore}`;
        await webhook.editMessage('@original', {
            content: `${f}\n\n${scoreText}\nTime: ${(p.timeTaken / 1000).toFixed(1)}s`,
            components: [],
        });
        syncGameScores(activeSprint.threadId, activeSprint);
        return;
    }

    p.qIndex++;
    const nq = activeSprint.questions[p.qIndex];
    const row = new ActionRowBuilder();
    nq.answers.forEach((ans, i) =>
        row.addComponents(new ButtonBuilder().setCustomId(`sprintans_${i}`).setLabel(ans.substring(0, 80)).setStyle(ButtonStyle.Primary)),
    );
    const user = await getUser(activeSprint.guildId, userId);
    if (user.inventory && user.inventory.includes('trivia_skip')) {
        row.addComponents(new ButtonBuilder().setCustomId('sprint_skip').setLabel('⏭️ Skip (Uses Item)').setStyle(ButtonStyle.Secondary));
    }
    await webhook.editMessage('@original', {
        content: `${f}\n\n**Q${p.qIndex + 1}**\n\n**${nq.question}**`,
        components: [row],
    });
    syncGameScores(activeSprint.threadId, activeSprint);

    const nextQIdx = p.qIndex;
    clearSprintQuestionTimer(activeSprint, userId);
    p.questionTimerHandle = setTimeout(() => {
        void runSprintQuestionTimeout(client, activeSprints, threadId, userId, nextQIdx, webhook).catch((err) =>
            console.error('[TriviaSprint] question timer', err),
        );
    }, SPRINT_QUESTION_MS);
}

/**
 * Start (or restart) the per-question timer for one player’s ephemeral sprint UI.
 * @param {import('discord.js').Client} client
 * @param {Map<string, object>} activeSprints
 * @param {string} threadId
 * @param {string} userId
 * @param {import('discord.js').BaseInteraction} interaction
 */
function scheduleSprintQuestionTimer(client, activeSprints, threadId, userId, interaction) {
    const activeSprint = activeSprints.get(threadId);
    if (!activeSprint) return;
    const p = activeSprint.players[userId];
    if (!p || p.timeTaken != null) return;

    const applicationId = interaction.applicationId ?? client.application?.id;
    if (!applicationId || !interaction.token) return;

    clearSprintQuestionTimer(activeSprint, userId);
    const qIdxWhenScheduled = p.qIndex;
    const webhook = sprintQuestionWebhook(client, applicationId, interaction.token);
    p.questionTimerHandle = setTimeout(() => {
        void runSprintQuestionTimeout(client, activeSprints, threadId, userId, qIdxWhenScheduled, webhook).catch((err) =>
            console.error('[TriviaSprint] question timer', err),
        );
    }, SPRINT_QUESTION_MS);
}

module.exports = {
    SPRINT_QUESTION_MS,
    clearSprintQuestionTimer,
    clearAllSprintQuestionTimers,
    scheduleSprintQuestionTimer,
};
