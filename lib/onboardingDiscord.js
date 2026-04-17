'use strict';

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const onboarding = require('./onboardingService');
const { joinOfficialFactionInGuild } = require('./officialFactionJoin');
const { launchPlatformGameThread, pickOnboardingGameTag } = require('../games/platformPlay');
const { ensureRotationForDate } = require('./gamePlatform/rotation');
const { getActiveChallenge } = require('./factionChallenge');
const { getSettings, resolveGame } = require('./gamePlatform/configStore');
const { defaultGameThreadName } = require('./utils');
const {
    OFFICIAL_FACTIONS,
    formatOfficialFactionListOxford,
    onboardingButtonCustomIdForFaction,
    onboardingButtonIdToFactionName,
} = require('./globalFactions');

const COLOR = '#2dd4bf';

/** @param {string} id @param {string} label @param {import('discord.js').ButtonStyle} [style] */
function obBtn(id, label, style = ButtonStyle.Primary) {
    return new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
}

async function buildOnboardingUI(interaction) {
    const uid = interaction.user.id;
    const guildId = interaction.guildId;

    if (!guildId) {
        const embed = new EmbedBuilder()
            .setColor(COLOR)
            .setTitle('PlayBound')
            .setDescription('Run this in a **server** with the bot.\n\nThen try `/onboarding` again.');
        return { embeds: [embed], components: [] };
    }

    const snap = await onboarding.getOnboardingSnapshot(uid);

    if (snap.complete) {
        const embed = new EmbedBuilder()
            .setColor(COLOR)
            .setTitle("You're in")
            .setDescription('You’re all set.\n\nJump in anytime with `/playgame`.');
        return { embeds: [embed], components: [] };
    }

    if (snap.skipped) {
        const embed = new EmbedBuilder()
            .setColor(0x7a8fa3)
            .setTitle('Tour paused')
            .setDescription('The tour is paused.\n\nTap **Resume** when you want to continue.');
        const row = new ActionRowBuilder().addComponents(
            obBtn('ob_resume', 'Resume', ButtonStyle.Success),
            obBtn('ob_dismiss', 'OK', ButtonStyle.Secondary),
        );
        return { embeds: [embed], components: [row] };
    }

    const step = snap.step;
    const embeds = [];
    const rows = [];

    if (step === onboarding.STEP_WELCOME) {
        embeds.push(
            new EmbedBuilder()
                .setColor(COLOR)
                .setTitle('Welcome')
                .setDescription('Short steps — then you play.\n\nOne tap at a time.'),
        );
        rows.push(
            new ActionRowBuilder().addComponents(
                obBtn('ob_start', 'Start playing'),
                obBtn('ob_skip', 'Skip tour', ButtonStyle.Secondary),
            ),
        );
    } else if (step === onboarding.STEP_FACTION) {
        embeds.push(
            new EmbedBuilder()
                .setColor(COLOR)
                .setTitle('Pick your team')
                .setDescription(
                    `${formatOfficialFactionListOxford()}.\n\n_Servers can **rename the label** you see locally; your **official** team name stays the same._`,
                ),
        );
        const facRows = [];
        let current = new ActionRowBuilder();
        for (let i = 0; i < OFFICIAL_FACTIONS.length; i++) {
            const f = OFFICIAL_FACTIONS[i];
            const id = onboardingButtonCustomIdForFaction(f.name);
            const label = `${f.emoji} ${f.name}`.slice(0, 80);
            current.addComponents(obBtn(id, label));
            if (current.components.length >= 5 || i === OFFICIAL_FACTIONS.length - 1) {
                facRows.push(current);
                current = new ActionRowBuilder();
            }
        }
        rows.push(...facRows);
        rows.push(new ActionRowBuilder().addComponents(obBtn('ob_skip', 'Skip tour', ButtonStyle.Secondary)));
    } else if (step === onboarding.STEP_FIRST_GAME) {
        embeds.push(
            new EmbedBuilder()
                .setColor(COLOR)
                .setTitle('Play once')
                .setDescription(
                    '**`/playgame`** is the official path (and what **ranked** faction wars count).\n\nThis **Quick game** opens a thread — finish the round there.',
                ),
        );
        rows.push(
            new ActionRowBuilder().addComponents(
                obBtn('ob_play', 'Quick game'),
                obBtn('ob_skip', 'Skip tour', ButtonStyle.Secondary),
            ),
        );
    } else if (step === onboarding.STEP_POST_GAME) {
        embeds.push(
            new EmbedBuilder()
                .setColor(COLOR)
                .setTitle('Nice run')
                .setDescription(
                    'You earned **credits** (and maybe **Arena score**) — that’s normal.\n\nKeep playing to climb.',
                ),
        );
        rows.push(new ActionRowBuilder().addComponents(obBtn('ob_next', 'Next')));
        rows.push(new ActionRowBuilder().addComponents(obBtn('ob_skip', 'Skip tour', ButtonStyle.Secondary)));
    } else if (step === onboarding.STEP_WARS) {
        const ch = await getActiveChallenge(guildId);
        const warLine = ch
            ? 'A **faction challenge** is live — try `/faction_challenge join`.'
            : 'When a war runs, use `/faction_challenge join`.';
        embeds.push(
            new EmbedBuilder()
                .setColor(COLOR)
                .setTitle('Faction wars')
                .setDescription(
                    `${warLine}\n\n**Ranked** wars feed **global** standings — only **/playgame** scores count.\n\nHosted games (/trivia, etc.) stay casual.`,
                ),
        );
        rows.push(new ActionRowBuilder().addComponents(obBtn('ob_next', 'Next')));
        rows.push(new ActionRowBuilder().addComponents(obBtn('ob_skip', 'Skip tour', ButtonStyle.Secondary)));
    } else if (step === onboarding.STEP_ROTATION) {
        const rot = await ensureRotationForDate();
        const pool = rot.activeTags.length ? rot.activeTags.join(', ') : '—';
        embeds.push(
            new EmbedBuilder()
                .setColor(COLOR)
                .setTitle("Today’s games")
                .setDescription(`**UTC pool:** ${pool}\n\nDifferent games rotate in — worth trying more than one.`),
        );
        rows.push(new ActionRowBuilder().addComponents(obBtn('ob_next', 'Next')));
        rows.push(new ActionRowBuilder().addComponents(obBtn('ob_skip', 'Skip tour', ButtonStyle.Secondary)));
    } else if (step === onboarding.STEP_EXPLORE) {
        embeds.push(
            new EmbedBuilder()
                .setColor(COLOR)
                .setTitle('Explore')
                .setDescription('**Leaderboards** on this site · `/factions` in Discord.\n\nYour stats are above.'),
        );
        rows.push(
            new ActionRowBuilder().addComponents(
                obBtn('ob_done', 'Done', ButtonStyle.Success),
                obBtn('ob_skip', 'Skip tour', ButtonStyle.Secondary),
            ),
        );
    }

    return { embeds, components: rows };
}

async function handleOnboardingCommand(interaction) {
    const uid = interaction.user.id;
    if (interaction.options.getBoolean('skip') === true) {
        await onboarding.skipOnboarding(uid);
        return interaction.reply({
            content: 'Tour hidden. Run `/onboarding` with **resume** enabled to continue later.',
            ephemeral: true,
        });
    }
    if (interaction.options.getBoolean('resume') === true) {
        await onboarding.resumeOnboarding(uid);
    }
    const ui = await buildOnboardingUI(interaction);
    return interaction.reply({ embeds: ui.embeds, components: ui.components, ephemeral: true });
}

/**
 * @returns {Promise<boolean>} true if handled
 */
async function handleOnboardingButton(interaction, client) {
    if (!interaction.isButton() || !interaction.customId.startsWith('ob_')) return false;
    const uid = interaction.user.id;
    const id = interaction.customId;

    if (id === 'ob_dismiss') {
        await interaction.reply({ content: '👍', ephemeral: true });
        return true;
    }

    const snap0 = await onboarding.getOnboardingSnapshot(uid);

    if (id === 'ob_resume') {
        if (!snap0.skipped) {
            await interaction.reply({ content: 'Nothing to resume.', ephemeral: true });
            return true;
        }
        await onboarding.resumeOnboarding(uid);
        const ui = await buildOnboardingUI(interaction);
        return interaction.update({ embeds: ui.embeds, components: ui.components }).then(() => true);
    }

    if (snap0.skipped) {
        await interaction.reply({
            content: 'Tour is paused. Open `/onboarding` and turn on **resume**, or press **Resume** on the tour message.',
            ephemeral: true,
        });
        return true;
    }

    if (snap0.complete) {
        await interaction.reply({ content: "You're all set!", ephemeral: true });
        return true;
    }

    const respond = async (ui, content) => {
        const payload = { embeds: ui.embeds, components: ui.components };
        if (content != null) payload.content = content;
        else payload.content = '';
        return interaction.update(payload);
    };

    if (id === 'ob_start') {
        await onboarding.goToNextStep(uid);
        const ui = await buildOnboardingUI(interaction);
        return respond(ui, '').then(() => true);
    }

    if (id === 'ob_skip') {
        await onboarding.skipOnboarding(uid);
        const ui = await buildOnboardingUI(interaction);
        return respond(ui, '').then(() => true);
    }

    if (id === 'ob_next') {
        await onboarding.goToNextStep(uid);
        const ui = await buildOnboardingUI(interaction);
        return respond(ui, '').then(() => true);
    }

    if (id === 'ob_done') {
        await onboarding.setStep(uid, onboarding.STEP_COMPLETE);
        const ui = await buildOnboardingUI(interaction);
        return respond(ui, '').then(() => true);
    }

    if (id === 'ob_play') {
        await interaction.deferUpdate();
        const tag = await pickOnboardingGameTag();
        if (!tag) {
            const ui = await buildOnboardingUI(interaction);
            return interaction
                .editReply({
                    content: 'Quick games are off in settings. Use `/playgame` when the pool is open.',
                    embeds: ui.embeds,
                    components: ui.components,
                })
                .then(() => true);
        }
        const settings = await getSettings();
        const def = resolveGame(tag, settings);
        const threadName = defaultGameThreadName(def.displayName);
        const out = await launchPlatformGameThread({
            interaction,
            client,
            tag,
            threadName,
            bypassRotation: true,
        });
        const ui = await buildOnboardingUI(interaction);
        if (!out.ok) {
            return interaction
                .editReply({ content: out.message, embeds: ui.embeds, components: ui.components })
                .then(() => true);
        }
        let obContent = `**Thread:** ${out.thread}\nFinish there, then run \`/onboarding\` for the next step.`;
        if (out.dailyCapNote) obContent += `\n\nℹ️ ${out.dailyCapNote}`;
        return interaction
            .editReply({
                content: obContent,
                embeds: ui.embeds,
                components: ui.components,
            })
            .then(() => true);
    }

    if (id.startsWith('ob_fac_')) {
        await interaction.deferUpdate();
        const joinName = onboardingButtonIdToFactionName(id);
        if (!joinName) {
            return interaction.editReply({ content: 'Unknown team.', embeds: [], components: [] }).then(() => true);
        }
        const result = await joinOfficialFactionInGuild(interaction, joinName);
        if (!result.ok) {
            return interaction
                .editReply({ content: result.content, embeds: [], components: [] })
                .then(() => true);
        }
        await onboarding.recordFactionJoined(uid);
        const ui = await buildOnboardingUI(interaction);
        const headline =
            result.joinHeadline ||
            (typeof result.content === 'string' ? result.content.split('\n')[0] : '') ||
            `✅ Joined **${joinName}**!`;
        return interaction
            .editReply({
                content: headline,
                embeds: ui.embeds,
                components: ui.components,
            })
            .then(() => true);
    }

    return false;
}

module.exports = {
    buildOnboardingUI,
    handleOnboardingCommand,
    handleOnboardingButton,
};
