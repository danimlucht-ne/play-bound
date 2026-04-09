'use strict';

/**
 * Viral / referral growth helpers.
 *
 * Discord OAuth bot install does not reliably preserve arbitrary query parameters on the authorize URL,
 * so we do NOT rely on `?referrer=` on the invite link. Practical flow:
 * 1. User runs `/invite` → gets bot URL + their **referral code**.
 * 2. After the bot is added elsewhere, a server **Administrator** runs `/claim_referral code:PB…` in that server.
 * 3. First completed **qualifying** game there pays the referrer (idempotent per guild).
 */

const { EmbedBuilder } = require('discord.js');
const {
    ReferralProfile,
    ReferralFirstGamePayout,
    FactionRecruitToken,
    FactionRecruitReward,
    SystemConfig,
} = require('../models');
const { getBotInviteUrl } = require('./supportPanels');
const { getSystemConfig, updateSystemConfig, addReferralEconomyPoints } = require('./db');
const { isGuildExcludedFromGlobalCounts, getExcludedGuildIds } = require('./publicStatsExclude');

const { GLOBAL_FACTION_KEYS, formatOfficialFactionListOxford } = require('./globalFactions');
const GLOBAL_FACTIONS = new Set(GLOBAL_FACTION_KEYS);

const QUALIFYING_GAME_TYPES = new Set([
    'GuessTheNumber',
    'Trivia',
    'Serverdle',
    'NameThatTune',
    'MovieQuotes',
    'CaptionContest',
    'TriviaSprint',
    'UnscrambleSprint',
    'Giveaway',
    'SpellingBee',
]);

const FIRST_GAME_REFERRAL_BASE = 500;
const FIRST_GAME_REFERRAL_BONUS = 250;
const FACTION_RECRUIT_BASE = 100;
const FACTION_RECRUIT_MILESTONE_BASE = 500;

const INVITE_NUDGE_COOLDOWN_MS = 72 * 3600 * 1000;

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomSuffix(len) {
    let s = '';
    for (let i = 0; i < len; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    return s;
}

function normalizeReferralCode(raw) {
    return String(raw || '')
        .trim()
        .toUpperCase()
        .replace(/\s+/g, '');
}

async function ensureReferralProfile(userId) {
    let p = await ReferralProfile.findOne({ userId });
    if (p) return p;
    for (let attempt = 0; attempt < 8; attempt++) {
        const referralCode = `PB${randomSuffix(8)}`;
        try {
            p = await ReferralProfile.create({ userId, referralCode });
            return p;
        } catch (e) {
            if (e.code !== 11000) throw e;
        }
    }
    throw new Error('Could not allocate referral code');
}

/** Lock economy guild for referral payouts (first `/invite` or `/faction_recruit` wins). */
async function ensureReferralRewardsGuildId(userId, guildId) {
    const p = await ensureReferralProfile(userId);
    if (!p.referralRewardsGuildId) {
        p.referralRewardsGuildId = guildId;
        await p.save();
    }
    return p;
}

function buildInviteHelpText(profile, reqUserIsPremium) {
    const multLine =
        reqUserIsPremium === true
            ? '💎 **Premium:** you earn **2×** on all referral rewards (server invites, faction recruits, milestones).'
            : '💎 **Premium** earns **2×** on referral rewards — `/premium`.';
    return (
        `**Invite PlayBound to another server**\n` +
        `Discord’s bot install flow **does not reliably keep custom URL parameters**, so attribution uses your **referral code** after install.\n\n` +
        `**Rewards (referrer):**\n` +
        `• **+${FIRST_GAME_REFERRAL_BASE}** + **+${FIRST_GAME_REFERRAL_BONUS}** when that server finishes its **first qualifying mini-game**.\n` +
        `${multLine}\n\n` +
        `**In the new server:** an admin runs \`/claim_referral\` with your code after adding the bot.\n` +
        `Track with \`/invites\` · leaderboard: \`/invite_leaderboard\`.\n\n` +
        `**Your code:** \`${profile.referralCode}\``
    );
}

async function handleInviteCommand(interaction) {
    const { getUser } = require('./db');
    const guildId = interaction.guildId;
    const user = await getUser(guildId, interaction.user.id);
    const p = await ensureReferralRewardsGuildId(interaction.user.id, guildId);

    const url = getBotInviteUrl();
    if (!url) {
        return interaction.reply({
            content:
                'Bot invite URL is not configured (`BOT_INVITE_URL` / `CLIENT_ID`). Ask the bot owner to set env vars.',
            ephemeral: true,
        });
    }

    const embed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle('📣 Invite PlayBound')
        .setDescription(buildInviteHelpText(p, user.isPremium === true))
        .addFields({
            name: 'Add the bot',
            value: `[Open Discord authorize (add to server)](${url})`,
        });

    return interaction.reply({
        content:
            `Your referral code: \`${p.referralCode}\`\n` +
            `Invite link: ${url}`,
        embeds: [embed],
        ephemeral: true,
    });
}

async function handleInvitesCommand(interaction) {
    const p = await ReferralProfile.findOne({ userId: interaction.user.id });
    if (!p) {
        return interaction.reply({
            content: 'You don’t have a referral profile yet. Run `/invite` once to get your code.',
            ephemeral: true,
        });
    }
    const ex = getExcludedGuildIds();
    const notEx = ex.length ? { guildId: { $nin: ex } } : {};
    const successfulServerReferrals = await ReferralFirstGamePayout.countDocuments({
        referrerUserId: interaction.user.id,
        ...notEx,
    });
    const pending = await SystemConfig.countDocuments({
        referralReferredByUserId: interaction.user.id,
        referralFirstGameRewardGranted: { $ne: true },
        ...notEx,
    });
    const serverPts = p.referralServerPointsEarned || 0;
    const facPts = p.referralFactionPointsEarned || 0;
    const totalPts = serverPts + facPts;
    const embed = new EmbedBuilder()
        .setColor('#57F287')
        .setTitle('📊 Your referrals')
        .setDescription(
            `**Successful server referrals** (first game done, test servers excluded): **${successfulServerReferrals}**\n\n` +
                `**Pending servers** (code claimed, waiting on first game): **${pending}**\n\n` +
                `**Points from server referrals:** **${serverPts}**\n\n` +
                `**Points from faction recruits:** **${facPts}**\n\n` +
                `**Total referral points:** **${totalPts}**`,
        );
    return interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleClaimReferralCommand(interaction) {
    const { PermissionFlagsBits } = require('discord.js');
    if (!interaction.guild) {
        return interaction.reply({ content: 'Use this command inside a server.', ephemeral: true });
    }
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: '❌ **Administrator** only.', ephemeral: true });
    }
    const code = normalizeReferralCode(interaction.options.getString('code'));
    if (!code.startsWith('PB') || code.length < 6) {
        return interaction.reply({ content: '❌ Invalid code format.', ephemeral: true });
    }
    const profile = await ReferralProfile.findOne({ referralCode: code });
    if (!profile) {
        return interaction.reply({ content: '❌ Unknown referral code.', ephemeral: true });
    }
    if (profile.userId === interaction.user.id) {
        return interaction.reply({ content: '❌ You can’t claim your own code.', ephemeral: true });
    }
    const guildId = interaction.guild.id;
    const config = await getSystemConfig(guildId);
    if (config.referralReferredByUserId) {
        return interaction.reply({ content: '❌ This server already has referral attribution.', ephemeral: true });
    }
    await updateSystemConfig(guildId, (c) => {
        c.referralReferredByUserId = profile.userId;
        c.referralClaimedAt = new Date();
        c.referralFirstGameRewardGranted = false;
    });
    return interaction.reply({
        content:
            `✅ Referral saved. When this server completes its **first qualifying game**, <@${profile.userId}> earns **+${FIRST_GAME_REFERRAL_BASE}** + **+${FIRST_GAME_REFERRAL_BONUS}** base points (**×2** if they have **Premium**).`,
        allowedMentions: { users: [profile.userId] },
        ephemeral: true,
    });
}

async function onQualifyingGameEnded(client, game) {
    if (!game || game.status !== 'ended') return;
    if (!QUALIFYING_GAME_TYPES.has(game.type)) return;

    const guildId = game.guildId;
    const sys = await SystemConfig.findOne({ guildId });
    if (!sys?.referralReferredByUserId) return;

    if (isGuildExcludedFromGlobalCounts(guildId)) {
        await SystemConfig.updateOne({ guildId }, { $set: { referralFirstGameRewardGranted: true } }).catch(() => {});
        return;
    }

    const referrerUserId = sys.referralReferredByUserId;

    try {
        await ReferralFirstGamePayout.create({
            guildId,
            referrerUserId,
        });
    } catch (e) {
        if (e.code === 11000) return;
        throw e;
    }

    const refProfile = await ReferralProfile.findOne({ userId: referrerUserId });
    const rewardGuildId = refProfile?.referralRewardsGuildId;
    if (!rewardGuildId) {
        await ReferralFirstGamePayout.deleteOne({ guildId }).catch(() => {});
        console.warn(`[referrals] No referralRewardsGuildId for referrer ${referrerUserId}; skipped first-game payout`);
        return;
    }

    const baseTotal = FIRST_GAME_REFERRAL_BASE + FIRST_GAME_REFERRAL_BONUS;
    try {
        await addReferralEconomyPoints(
            client,
            rewardGuildId,
            referrerUserId,
            baseTotal,
            'Referral: first game in invited server',
            'server',
        );
        await ReferralProfile.updateOne(
            { userId: referrerUserId },
            {
                $addToSet: { referralCompletedGuildIds: guildId },
                $inc: { referralSuccessfulCount: 1 },
            },
        );
        await SystemConfig.updateOne({ guildId }, { $set: { referralFirstGameRewardGranted: true } });
    } catch (e) {
        await ReferralFirstGamePayout.deleteOne({ guildId }).catch(() => {});
        throw e;
    }
}

async function generateFactionRecruitCode() {
    for (let i = 0; i < 8; i++) {
        const code = `FR${randomSuffix(7)}`;
        const exists = await FactionRecruitToken.findOne({ code }).select('_id').lean();
        if (!exists) return code;
    }
    throw new Error('faction recruit code gen failed');
}

async function handleFactionRecruitCommand(interaction) {
    const { getUser } = require('./db');
    const guildId = interaction.guildId;
    const user = await getUser(guildId, interaction.user.id);
    const faction = user.faction;
    if (!faction || !GLOBAL_FACTIONS.has(faction)) {
        return interaction.reply({
            content:
                `❌ Join a global faction first: \`/faction join\` (${formatOfficialFactionListOxford()}). Then run \`/faction_recruit\` again.`,
            ephemeral: true,
        });
    }
    await ensureReferralRewardsGuildId(interaction.user.id, guildId);
    const code = await generateFactionRecruitCode();
    await FactionRecruitToken.create({
        code,
        recruiterUserId: interaction.user.id,
        factionName: faction,
        sourceGuildId: guildId,
    });

    const multNote =
        user.isPremium === true
            ? '💎 **Premium:** you earn **2×** on recruit rewards and milestones.'
            : '💎 **Premium** doubles recruit rewards — `/premium`.';

    const text =
        `🏴 **Recruit for ${faction}**\n\n` +
        `When someone **joins ${faction}** in this server and redeems your code, you get **+${FACTION_RECRUIT_BASE}** points, plus **+${FACTION_RECRUIT_MILESTONE_BASE}** every **5** successful recruits.\n` +
        `${multNote}\n\n` +
        `**Share this:**\n` +
        `1. \`/faction join\` → **${faction}**\n` +
        `2. \`/faction_redeem code:${code}\`\n\n` +
        `_Code expires in ~14 days. Generate a new one anytime._`;

    return interaction.reply({ content: text, ephemeral: true });
}

async function handleFactionRedeemCommand(interaction, client) {
    const guildId = interaction.guildId;
    const { getUser } = require('./db');
    const raw = String(interaction.options.getString('code') || '').trim().toUpperCase();
    const code = raw.replace(/\s+/g, '');
    if (!code.startsWith('FR') || code.length < 4) {
        return interaction.reply({ content: '❌ Invalid code.', ephemeral: true });
    }
    const token = await FactionRecruitToken.findOne({ code });
    if (!token) {
        return interaction.reply({ content: '❌ Unknown or expired code.', ephemeral: true });
    }
    if (token.recruiterUserId === interaction.user.id) {
        return interaction.reply({ content: '❌ You can’t redeem your own code.', ephemeral: true });
    }

    const recruitUser = await getUser(guildId, interaction.user.id);
    if (recruitUser.faction !== token.factionName) {
        return interaction.reply({
            content: `❌ You must be in **${token.factionName}** (\`/faction join\`) before redeeming.`,
            ephemeral: true,
        });
    }
    if (token.sourceGuildId !== guildId) {
        return interaction.reply({
            content: '❌ This code was created in another server — redeem it there.',
            ephemeral: true,
        });
    }

    try {
        await FactionRecruitReward.create({
            recruiterUserId: token.recruiterUserId,
            recruitUserId: interaction.user.id,
            factionName: token.factionName,
            guildId,
        });
    } catch (e) {
        if (e.code === 11000) {
            return interaction.reply({ content: '❌ You already counted as a recruit for this recruiter.', ephemeral: true });
        }
        throw e;
    }

    await FactionRecruitToken.deleteOne({ _id: token._id });

    const excluded = isGuildExcludedFromGlobalCounts(guildId);
    if (!excluded) {
        await ensureReferralRewardsGuildId(token.recruiterUserId, guildId);
        const recruiterProf = await ReferralProfile.findOne({ userId: token.recruiterUserId });
        const rewardGuildId = recruiterProf?.referralRewardsGuildId || guildId;

        await ReferralProfile.updateOne({ userId: token.recruiterUserId }, { $inc: { factionRecruitSuccessCount: 1 } });

        await addReferralEconomyPoints(
            client,
            rewardGuildId,
            token.recruiterUserId,
            FACTION_RECRUIT_BASE,
            'Referral: faction recruit',
            'faction',
        );

        await tryPayRecruitMilestones(client, rewardGuildId, token.recruiterUserId);
    }

    return interaction.reply({
        content: excluded
            ? `✅ Redeemed. _(This server is excluded from global referral rewards — no points or milestones were applied.)_`
            : `✅ Redeemed. <@${token.recruiterUserId}> earned recruit points (and any milestone bonuses).`,
        ephemeral: true,
        allowedMentions: excluded ? undefined : { users: [token.recruiterUserId] },
    });
}

async function tryPayRecruitMilestones(client, rewardGuildId, recruiterUserId) {
    for (;;) {
        const p = await ReferralProfile.findOne({ userId: recruiterUserId });
        if (!p) return;
        const earnedBlocks = Math.floor((p.factionRecruitSuccessCount || 0) / 5);
        const paid = p.factionRecruitMilestoneBlocksPaid || 0;
        if (earnedBlocks <= paid) return;

        const updated = await ReferralProfile.findOneAndUpdate(
            { userId: recruiterUserId, factionRecruitMilestoneBlocksPaid: paid },
            { $inc: { factionRecruitMilestoneBlocksPaid: 1 } },
            { returnDocument: 'after' },
        );
        if (!updated) continue;

        await addReferralEconomyPoints(
            client,
            rewardGuildId,
            recruiterUserId,
            FACTION_RECRUIT_MILESTONE_BASE,
            'Referral: recruit milestone (×5)',
            'faction',
        );
    }
}

async function handleInviteLeaderboardCommand(interaction, client) {
    const ex = getExcludedGuildIds();
    const match = ex.length ? { guildId: { $nin: ex } } : {};
    const rows = await ReferralFirstGamePayout.aggregate([
        { $match: match },
        { $group: { _id: '$referrerUserId', successfulReferrals: { $sum: 1 } } },
        { $match: { successfulReferrals: { $gt: 0 } } },
        { $sort: { successfulReferrals: -1 } },
        { $limit: 15 },
    ]);
    if (rows.length === 0) {
        return interaction.reply({ content: '_No completed server referrals yet._', ephemeral: true });
    }
    const bodyLines = [];
    for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        let name = `User ${r._id}`;
        try {
            const u = await client.users.fetch(r._id);
            name = u.username;
        } catch (_) {
            /* left Discord etc. */
        }
        bodyLines.push(`**${i + 1}.** ${name} — **${r.successfulReferrals}** server(s)`);
    }
    const body = bodyLines.join('\n\n');
    const embed = new EmbedBuilder()
        .setColor('#FEE75C')
        .setTitle('🏆 Top referrers (global)')
        .setDescription(
            `${body}\n\n_Excludes test / support servers configured in \`PUBLIC_STATS_EXCLUDE_GUILD_IDS\`._`,
        );
    return interaction.reply({ embeds: [embed], ephemeral: true });
}

/**
 * One nudge per guild per ~72h; does not ping users.
 * @param {import('discord.js').Client} client
 * @param {string} guildId
 * @param {import('discord.js').TextChannel|import('discord.js').ThreadChannel|import('discord.js').NewsChannel|null} channel
 */
async function sendInviteViralNudgeIfAllowed(guildId, channel) {
    if (!channel?.isTextBased?.()) return;
    const config = await getSystemConfig(guildId);
    const now = Date.now();
    if (config.lastInviteViralNudgeAt) {
        const last = new Date(config.lastInviteViralNudgeAt).getTime();
        if (now - last < INVITE_NUDGE_COOLDOWN_MS) return;
    }
    await updateSystemConfig(guildId, (c) => {
        c.lastInviteViralNudgeAt = new Date();
    });
    try {
        await channel.send({
            content:
                '👋 **Playing with friends?** Invite PlayBound to another server with `/invite` — track rewards with `/invites`.',
            allowedMentions: { parse: [] },
        });
    } catch (_) {
        /* missing perms etc. */
    }
}

// TODO: Optional “group size” participation bonuses (3+ / 5+ players) would need a single,
// well-defined hook after scores are finalized — skipped to avoid double-award risk with current flows.

module.exports = {
    QUALIFYING_GAME_TYPES,
    GLOBAL_FACTIONS,
    ensureReferralProfile,
    onQualifyingGameEnded,
    handleInviteCommand,
    handleInvitesCommand,
    handleClaimReferralCommand,
    handleFactionRecruitCommand,
    handleFactionRedeemCommand,
    handleInviteLeaderboardCommand,
    sendInviteViralNudgeIfAllowed,
};
