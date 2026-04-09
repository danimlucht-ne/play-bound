const mongoRouter = require('./mongoRouter');
const { automatedServerPostsEnabled } = require('./automatedPosts');

function M(guildId) {
    return mongoRouter.getModelsForGuild(guildId);
}

/**
 * Active game lookup when AsyncLocalStorage has no guild (e.g. timer callbacks): scan prod/test in dual mode.
 */
async function findActiveGameDocument(threadId) {
    const gid = mongoRouter.getCurrentGuildId();
    if (gid != null || !mongoRouter.isDualMode()) {
        return M(gid).Game.findOne({ threadId, status: 'active' });
    }
    for (const models of mongoRouter.listModelBags()) {
        const game = await models.Game.findOne({ threadId, status: 'active' });
        if (game) return game;
    }
    return null;
}
const { recordFactionChallengePoints } = require('./factionChallenge');
const { FactionCreditReasonCode } = require('./gameClassification');
const { formatPoints } = require('./utils');
const { isGuildExcludedFromGlobalCounts } = require('./publicStatsExclude');
const { isCompetitiveLedgerLabel } = require('./competitivePoints');
const { throwIfImmediateGameStartBlockedByMaintenance } = require('./maintenanceScheduling');
const {
    STREAK_BONUS_CAP_FREE,
    STREAK_BONUS_CAP_PREMIUM,
    HOST_AURA_MULTIPLIER,
} = require('./premiumPerks');
const { CREDITS } = require('./pointBranding');

let leaderboardCache = new Map();

async function getUser(guildId, userId) {
    return mongoRouter.runWithGuild(guildId, async () => {
        const { User } = M(guildId);
        let user = await User.findOne({ guildId, userId });
        if (!user) {
            try {
                user = await User.create({ guildId, userId });
            } catch (err) {
                if (err.code === 11000) {
                    user = await User.findOne({ guildId, userId });
                } else {
                    throw err;
                }
            }
        }
        return user;
    });
}

async function updateUser(guildId, userId, updateFn) {
    return mongoRouter.runWithGuild(guildId, async () => {
        const user = await getUser(guildId, userId);
        await updateFn(user);
        await user.save();
        return user;
    });
}

const INTERRUPT_LEDGER_PREFIX = 'interrupt:';

/**
 * Flat goodwill credits when a game is ended by bot restart (no faction-war tag; no competitive/streak multipliers).
 * Idempotent per (guild, user, game Mongo id) via pointLedger.reason.
 * @returns {Promise<{ granted: boolean }>}
 */
async function grantInterruptedGameGoodwill(guildId, userId, gameMongoId, amount) {
    const n = Math.round(Number(amount));
    if (!Number.isFinite(n) || n <= 0) {
        return { granted: false };
    }
    const uid = String(userId);
    if (uid === 'SYSTEM') {
        return { granted: false };
    }
    const marker = `${INTERRUPT_LEDGER_PREFIX}${String(gameMongoId)}`;
    const user = await getUser(guildId, uid);
    const { User } = M(guildId);
    const result = await User.updateOne(
        {
            _id: user._id,
            isBlacklisted: { $ne: true },
            'pointLedger.reason': { $ne: marker },
        },
        {
            $inc: {
                points: n,
                weeklyPoints: n,
                monthlyPoints: n,
            },
            $push: {
                pointLedger: {
                    $each: [{
                        at: new Date(),
                        amount: n,
                        label: 'crash_goodwill',
                        reason: marker,
                    }],
                    $position: 0,
                    $slice: 25,
                },
            },
        },
    );
    return { granted: Boolean(result.modifiedCount) };
}

async function transferCreditsAtomic(guildId, fromUserId, toUserId, amount) {
    return mongoRouter.runWithGuild(guildId, async () => {
        const delta = Math.trunc(Number(amount));
        if (!Number.isFinite(delta) || delta <= 0) {
            return { ok: false, reason: 'invalid_amount' };
        }
        if (String(fromUserId) === String(toUserId)) {
            return { ok: false, reason: 'same_user' };
        }

        const { User } = M(guildId);
        await Promise.all([getUser(guildId, fromUserId), getUser(guildId, toUserId)]);

        const session = await User.db.startSession();
        try {
            let result = { ok: false, reason: 'unknown' };
            await session.withTransaction(async () => {
                const sender = await User.findOne({ guildId, userId: fromUserId }).session(session);
                if (!sender || Number(sender.points || 0) < delta) {
                    result = { ok: false, reason: 'insufficient_funds', balance: Number(sender?.points || 0) };
                    await session.abortTransaction();
                    return;
                }

                const debit = await User.updateOne(
                    { guildId, userId: fromUserId, points: { $gte: delta } },
                    { $inc: { points: -delta } },
                    { session },
                );
                if (!debit.modifiedCount) {
                    result = { ok: false, reason: 'insufficient_funds', balance: Number(sender.points || 0) };
                    await session.abortTransaction();
                    return;
                }

                await User.updateOne(
                    { guildId, userId: toUserId },
                    {
                        $setOnInsert: { guildId, userId: toUserId },
                        $inc: { points: delta, weeklyPoints: delta, monthlyPoints: delta },
                    },
                    { upsert: true, session },
                );

                const updatedSender = await User.findOne({ guildId, userId: fromUserId }).session(session);
                result = {
                    ok: true,
                    transferred: delta,
                    senderBalance: Number(updatedSender?.points || 0),
                };
            });
            return result;
        } finally {
            await session.endSession();
        }
    });
}

async function joinFactionAtomic(guildId, userId, factionName, { updateFactionMembers = true } = {}) {
    return mongoRouter.runWithGuild(guildId, async () => {
        const { User, Faction } = M(guildId);
        await getUser(guildId, userId);

        const session = await User.db.startSession();
        try {
            let result = { ok: false, reason: 'unknown' };
            await session.withTransaction(async () => {
                const existing = await User.findOne({ guildId, userId }).session(session);
                if (existing?.faction) {
                    result = { ok: false, reason: 'already_in_faction', currentFaction: existing.faction };
                    await session.abortTransaction();
                    return;
                }

                const userUpdate = await User.updateOne(
                    { guildId, userId, faction: null },
                    { $set: { faction: factionName } },
                    { session },
                );
                if (!userUpdate.modifiedCount) {
                    const current = await User.findOne({ guildId, userId }).session(session);
                    result = { ok: false, reason: 'already_in_faction', currentFaction: current?.faction || null };
                    await session.abortTransaction();
                    return;
                }

                if (updateFactionMembers) {
                    await Faction.updateOne({ name: factionName }, { $inc: { members: 1 } }, { session });
                }

                result = { ok: true, factionName };
            });
            return result;
        } finally {
            await session.endSession();
        }
    });
}

async function claimDailyAtomic(guildId, userId, reward, nowMs = Date.now()) {
    return mongoRouter.runWithGuild(guildId, async () => {
        const { User } = M(guildId);
        const user = await getUser(guildId, userId);
        const cooldown = user.isPremium ? 43200000 : 86400000;
        const lastClaim = Number(user.lastDailyClaim || 0);
        if (lastClaim && nowMs - lastClaim < cooldown) {
            return {
                ok: false,
                reason: 'cooldown',
                remainingMs: cooldown - (nowMs - lastClaim),
                cooldownMs: cooldown,
            };
        }

        const filter = {
            _id: user._id,
            $or: [
                { lastDailyClaim: null },
                { lastDailyClaim: { $exists: false } },
                { lastDailyClaim: { $lte: nowMs - cooldown } },
            ],
        };
        const updated = await User.findOneAndUpdate(
            filter,
            {
                $inc: {
                    points: reward,
                    weeklyPoints: reward,
                    monthlyPoints: reward,
                },
                $set: { lastDailyClaim: nowMs },
            },
            { returnDocument: 'after' },
        );

        if (!updated) {
            const fresh = await User.findById(user._id).lean();
            const freshLast = Number(fresh?.lastDailyClaim || nowMs);
            return {
                ok: false,
                reason: 'cooldown',
                remainingMs: Math.max(0, cooldown - (nowMs - freshLast)),
                cooldownMs: cooldown,
            };
        }

        return {
            ok: true,
            reward,
            isPremium: Boolean(updated.isPremium),
            lastDailyClaim: updated.lastDailyClaim,
            user: updated,
        };
    });
}

/**
 * @param {string|null} [challengeGameTag] - e.g. 'trivia', 'serverdle'. Omit for non-game point sources.
 */
async function addScore(
    client,
    guildId,
    userId,
    points,
    interaction = null,
    hostIsPremium = false,
    challengeGameTag = null,
    extras = {},
) {
    return mongoRouter.runWithGuild(guildId, async () => {
    const { User } = M(guildId);
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    const user = await getUser(guildId, userId);
    if (extras && extras.flatEconomyGrant) {
        const grant = Math.max(0, Math.floor(Number(points)));
        if (grant) {
            user.points = (user.points || 0) + grant;
            user.weeklyPoints = (user.weeklyPoints || 0) + grant;
            user.monthlyPoints = (user.monthlyPoints || 0) + grant;
            const ledgerLabel = String((extras && extras.flatEconomyLedgerLabel) || 'flat_economy').slice(0, 64);
            if (!user.pointLedger) user.pointLedger = [];
            user.pointLedger.unshift({ at: new Date(), amount: grant, label: ledgerLabel });
            if (user.pointLedger.length > 25) user.pointLedger = user.pointLedger.slice(0, 25);
            user.markModified('pointLedger');
        }
        if (user.points >= 50 && !user.achievements.includes('LOYAL_PLAYER')) {
            await user.save();
            const { awardAchievement } = require('./achievements');
            await awardAchievement(client, guildId, null, userId, 'LOYAL_PLAYER');
        } else {
            await user.save();
        }
        return {
            factionChallengeCredit: {
                credited: false,
                reasonCode: FactionCreditReasonCode.NO_GAME_TAG,
                userMessage: null,
            },
        };
    }

    const suppressPersonal = !!(extras && extras.suppressPersonalCredits);
    let streakBonus = 0;

    // --- Premium Check (Global) ---
    let premiumMultiplier = user.isPremium ? 2 : 1;

    // --- Host Aura: Premium host boosts everyone in that game session ---
    let hostAuraMultiplier = hostIsPremium ? HOST_AURA_MULTIPLIER : 1;

    // --- Streak Shield Check ---
    if (user.lastActiveDate && user.lastActiveDate !== yesterday && user.lastActiveDate !== today) {
        if (user.inventory && user.inventory.includes('streak_shield')) {
            const shieldIndex = user.inventory.indexOf('streak_shield');
            user.inventory.splice(shieldIndex, 1); // Consume shield
            // Streak preserved!
            console.log(`[Streak Shield] User ${userId} used a shield! Streak preserved.`);
        } else {
            user.currentStreak = 0; // Lost streak
        }
    }

    if (user.lastActiveDate === yesterday) {
        user.currentStreak = (user.currentStreak || 0) + 1;
        const streakCap = user.isPremium ? STREAK_BONUS_CAP_PREMIUM : STREAK_BONUS_CAP_FREE;
        streakBonus = Math.min(user.currentStreak, streakCap);
    } else if (user.lastActiveDate !== today) {
        user.currentStreak = 1;
    }

    // --- Double Points Pass Check ---
    let multiplier = 1;
    if (!suppressPersonal && user.inventory && user.inventory.includes('double_points')) {
        multiplier = 2;
        const passIndex = user.inventory.indexOf('double_points');
        user.inventory.splice(passIndex, 1); // Consume pass
        console.log(`[Double Points] User ${userId} used a pass! Multiplier applied.`);
    }

    const casualOnlyBonus = Math.max(0, Math.floor(Number(extras && extras.casualOnlyBonus) || 0));
    const totalPoints = suppressPersonal
        ? 0
        : Math.floor((points + streakBonus) * multiplier * premiumMultiplier * hostAuraMultiplier) + casualOnlyBonus;

    const warCapActive = !!(extras && extras.warPlaygamePersonalCreditCap);
    let grant = totalPoints;
    if (warCapActive && grant > 0) {
        let used = 0;
        if (user.warPlaygamePersonalDay === today) {
            used = Math.max(0, Math.floor(Number(user.warPlaygamePersonalPoints) || 0));
        } else {
            user.warPlaygamePersonalDay = today;
            user.warPlaygamePersonalPoints = 0;
        }
        const room = Math.max(0, WAR_PLAYGAME_PERSONAL_CREDITS_CAP - used);
        grant = Math.min(grant, room);
        user.warPlaygamePersonalPoints = used + grant;
    }

    const economyBasePoints = Math.max(0, Math.floor(Number(points)));
    const ledgerOverride = extras && extras.factionChallengeBasePoints;
    /** Faction wars only credit the base game award (no streak / premium / pass / aura), so balances can’t be inflated into war scores. */
    const factionLedgerBase =
        ledgerOverride != null && Number.isFinite(Number(ledgerOverride))
            ? Math.max(0, Math.floor(Number(ledgerOverride)))
            : economyBasePoints;
    user.points = (user.points || 0) + grant;
    user.weeklyPoints = (user.weeklyPoints || 0) + grant;
    user.monthlyPoints = (user.monthlyPoints || 0) + grant;

    const competitiveDelta =
        challengeGameTag != null && isCompetitiveLedgerLabel(challengeGameTag) ? grant : 0;
    if (competitiveDelta !== 0) {
        user.competitivePoints = Math.max(0, Number(user.competitivePoints || 0) + competitiveDelta);
    }
    user.lastActiveDate = today;

    if (grant !== 0) {
        const label = challengeGameTag || (interaction ? 'interaction' : 'other');
        if (!user.pointLedger) user.pointLedger = [];
        user.pointLedger.unshift({ at: new Date(), amount: grant, label: String(label).slice(0, 64) });
        if (user.pointLedger.length > 25) user.pointLedger = user.pointLedger.slice(0, 25);
        user.markModified('pointLedger');
    }

    let factionChallengeCredit;
    if (challengeGameTag != null && challengeGameTag !== '') {
        factionChallengeCredit = await recordFactionChallengePoints({
            client,
            guildId,
            userId,
            factionName: user.faction,
            points: factionLedgerBase,
            gameTag: challengeGameTag,
        });
    } else {
        factionChallengeCredit = {
            credited: false,
            reasonCode: FactionCreditReasonCode.NO_GAME_TAG,
            userMessage: null,
        };
    }

    if (user.points >= 50 && !user.achievements.includes('LOYAL_PLAYER')) {
        await user.save(); // Save first to ensure points are updated
        const { awardAchievement } = require('./achievements');
        await awardAchievement(client, guildId, null, userId, 'LOYAL_PLAYER');
    } else {
        await user.save();
    }

    if (competitiveDelta > 0 && user.faction) {
        const { awardAchievement } = require('./achievements');
        const factionLeader = await User.findOne({
            guildId,
            faction: user.faction,
            userId: { $ne: 'SYSTEM' },
        })
            .sort({ competitivePoints: -1, userId: 1 })
            .select('userId competitivePoints')
            .lean();
        if (factionLeader?.userId === userId && Number(factionLeader.competitivePoints || 0) > 0) {
            await awardAchievement(client, guildId, null, userId, 'FACTION_CROWN');
        }
    }

    if (totalPoints > 0 && challengeGameTag) {
        const { recordFirstGamePlayed } = require('./onboardingService');
        await recordFirstGamePlayed(userId).catch(() => {});
    }

    if (
        interaction &&
        interaction.user &&
        interaction.user.id === userId &&
        !user.isPremium &&
        user.currentStreak >= 3
    ) {
        const { tryPremiumStreakFollowUp } = require('./premiumUpsell');
        await tryPremiumStreakFollowUp(interaction, guildId, userId, {
            pointsAwarded: grant,
            gameType: challengeGameTag || null,
            streak: user.currentStreak,
        }).catch(() => {});
    }

    return { factionChallengeCredit };
    });
}

async function getSystemConfig(guildId) {
    return mongoRouter.runWithGuild(guildId, async () => {
        const { SystemConfig } = M(guildId);
        let config = await SystemConfig.findOne({ guildId });
        if (!config) {
            try {
                config = await SystemConfig.create({ 
                    guildId,
                    announcePingEveryone: false,
                    welcomeMessages: [
                        "Welcome {user}! 🎮 Can you climb to the top of the /leaderboard?",
                        "Player {user} has entered the arena! ⚔️ Type /help to gear up!",
                        "Welcome {user}! 🌟 We've started you off with 5 points!"
                    ],
                    birthdayMessages: [
                        "Level Up! 🎂 Happy Birthday {user}! Enjoy your +5 point gift!",
                        "Happy Birthday {user}! 🎈 Another year in the simulation survived! (+5 pts)"
                    ]
                });
            } catch (err) {
                if (err.code === 11000) {
                    config = await SystemConfig.findOne({ guildId });
                } else {
                    throw err;
                }
            }
        }
        return config;
    });
}

async function updateSystemConfig(guildId, updateFn) {
    return mongoRouter.runWithGuild(guildId, async () => {
        const config = await getSystemConfig(guildId);
        await updateFn(config);
        await config.save();
        return config;
    });
}

/**
 * @param {import('../models').SystemConfig} config
 * @returns {{ sort: Record<string, 1 | -1>, scoreKey: string, title: string }}
 */
function resolveLeaderboardSort(config) {
    const cadence = config.leaderboardCadence || 'all_time';
    if (cadence === 'weekly') {
        return { sort: { weeklyPoints: -1 }, scoreKey: 'weeklyPoints', title: 'this week' };
    }
    if (cadence === 'monthly') {
        return { sort: { monthlyPoints: -1 }, scoreKey: 'monthlyPoints', title: 'this month' };
    }
    return { sort: { points: -1 }, scoreKey: 'points', title: 'all-time' };
}

async function refreshLeaderboard(client, guildId) {
    return mongoRouter.runWithGuild(guildId, async () => {
    const { User, ShopItem } = M(guildId);
    const config = await getSystemConfig(guildId);
    const { sort, scoreKey, title } = resolveLeaderboardSort(config);
    const topUsers = await User.find({ guildId, userId: { $ne: 'SYSTEM' } }).sort(sort).limit(10);
    leaderboardCache.set(guildId, topUsers);

    if (!config.leaderboardChannel) return;
    if (!automatedServerPostsEnabled(config)) return;

    const shopItems = await ShopItem.find().lean();
    const itemById = new Map(shopItems.map((i) => [i.id, i]));

    let r = `**🏆 Leaderboard (${title}) 🏆** — _${CREDITS} in this server_\n`;
    if (topUsers.length === 0) r += 'No scores yet.';
    else {
        for (let i = 0; i < topUsers.length; i++) {
            const u = topUsers[i];
            let prefix = '';
            const badgeId = u.currentCosmetics && u.currentCosmetics.get && u.currentCosmetics.get('badge');
            if (badgeId) {
                const bi = itemById.get(badgeId);
                if (bi && bi.leaderboardEmoji) {
                    prefix = `${bi.leaderboardEmoji} `;
                } else if (badgeId === 'premium_badge_diamond') {
                    prefix = '💎 ';
                } else if (badgeId === 'badge_star') {
                    prefix = '⭐ ';
                } else if (bi) {
                    prefix = `[${bi.name}] `;
                }
            } else if (u.isPremium) {
                prefix = '💎 ';
            }
            const pts = u[scoreKey] ?? 0;
            r += `${i + 1}. ${prefix}<@${u.userId}> — **${pts}** ${CREDITS}\n`;
        }
    }
    
    const chan = client.channels.cache.get(config.leaderboardChannel);
    if (!chan) return;

    if (config.leaderboardMessageId) {
        try {
            const msg = await chan.messages.fetch(config.leaderboardMessageId);
            if (msg) {
                await msg.edit({ content: r, allowedMentions: { users: [] } });
                return;
            }
        } catch(e) {}
    }
    const newMsg = await chan.send({ content: r, allowedMentions: { users: [] } });
    await updateSystemConfig(guildId, c => c.leaderboardMessageId = newMsg.id);
    });
}

async function createActiveGame(
    guildId,
    channelId,
    threadId,
    type,
    state,
    durationMinutes = 0,
    hostIsPremium = false,
    maintenanceOpts = {},
) {
    const dm = Number(durationMinutes);
    const explicitMs = Number.isFinite(dm) && dm > 0 ? dm * 60000 : null;
    const om = maintenanceOpts?.maintenanceEstimatedDurationMs;
    const overrideMs =
        om != null && Number.isFinite(Number(om)) && Number(om) > 0 ? Number(om) : null;
    throwIfImmediateGameStartBlockedByMaintenance(Date.now(), explicitMs ?? overrideMs, {
        guildId,
        channelId,
        threadId,
        gameType: type,
    });

    return mongoRouter.runWithGuild(guildId, async () => {
        const { Game } = M(guildId);
        const game = await Game.create({
            guildId,
            channelId,
            threadId,
            type,
            state,
            hostIsPremium,
            endTime: durationMinutes > 0 ? new Date(Date.now() + durationMinutes * 60000) : null
        });
        return game;
    });
}

async function updateActiveGame(threadId, updateFn) {
    const game = await findActiveGameDocument(threadId);
    if (!game) return null;
    updateFn(game.state);
    game.markModified('state');
    await game.save();
    return game;
}

async function endActiveGame(threadId, client = null) {
    const gid = mongoRouter.getCurrentGuildId();
    let game = null;
    if (gid != null || !mongoRouter.isDualMode()) {
        const { Game } = M(gid);
        game = await Game.findOneAndUpdate(
            { threadId, status: 'active' },
            { status: 'ended', endTime: new Date() },
            { returnDocument: 'after' },
        );
    } else {
        for (const models of mongoRouter.listModelBags()) {
            game = await models.Game.findOneAndUpdate(
                { threadId, status: 'active' },
                { status: 'ended', endTime: new Date() },
                { returnDocument: 'after' },
            );
            if (game) break;
        }
    }
    if (game && client) {
        mongoRouter
            .runWithGuild(game.guildId, async () => {
                const { onQualifyingGameEnded } = require('./referrals');
                await onQualifyingGameEnded(client, game);
            })
            .catch((e) => console.error('[referrals] onQualifyingGameEnded', e));
    }
    return game;
}

/**
 * Award points for referral programs only: Premium **2×** on base, no streak / double pass / host aura / faction challenge scoring.
 * @param {import('discord.js').Client} client
 * @param {string} guildId
 * @param {string} userId
 * @param {number} basePoints
 * @param {string} ledgerLabel
 * @param {'server'|'faction'} [track]
 * @returns {Promise<{ granted: number }>}
 */
async function addReferralEconomyPoints(client, guildId, userId, basePoints, ledgerLabel, track = 'server') {
    return mongoRouter.runWithGuild(guildId, async () => {
    const { awardAchievement } = require('./achievements');
    const user = await getUser(guildId, userId);
    const mult = user.isPremium ? 2 : 1;
    const totalPoints = Math.floor(Number(basePoints) * mult);
    if (!Number.isFinite(totalPoints) || totalPoints === 0) return { granted: 0 };

    user.points = (user.points || 0) + totalPoints;
    user.weeklyPoints = (user.weeklyPoints || 0) + totalPoints;
    user.monthlyPoints = (user.monthlyPoints || 0) + totalPoints;

    if (!user.pointLedger) user.pointLedger = [];
    user.pointLedger.unshift({ at: new Date(), amount: totalPoints, label: String(ledgerLabel).slice(0, 64) });
    if (user.pointLedger.length > 25) user.pointLedger = user.pointLedger.slice(0, 25);
    user.markModified('pointLedger');

    if (user.points >= 50 && !user.achievements.includes('LOYAL_PLAYER')) {
        await user.save();
        await awardAchievement(client, guildId, null, userId, 'LOYAL_PLAYER');
    } else {
        await user.save();
    }

    if (!isGuildExcludedFromGlobalCounts(guildId)) {
        const { ReferralProfile } = M(guildId);
        const inc =
            track === 'faction'
                ? { referralFactionPointsEarned: totalPoints }
                : { referralServerPointsEarned: totalPoints };
        await ReferralProfile.updateOne({ userId }, { $inc: inc }).catch(() => {});
    }

    return { granted: totalPoints };
    });
}

/**
 * Manual/admin point adjustment — **economy only** (`points` / weekly / monthly). Does not change
 * `competitivePoints` or global `Faction.totalPoints` (faction totals come from challenges only).
 * @param {import('discord.js').Client} client
 * @param {string} guildId
 * @param {string} userId
 * @param {number} deltaPoints
 * @param {string} label
 * @param {string|null} [reason] — stored on ledger for audit (e.g. web admin / Discord `/adjustpoints`)
 * @returns {Promise<{ applied: number, newTotal: number }>}
 */
async function addManualPointAdjustment(client, guildId, userId, deltaPoints, label = 'admin_adjustment', reason = null) {
    return mongoRouter.runWithGuild(guildId, async () => {
    const { awardAchievement } = require('./achievements');
    const delta = Math.trunc(Number(deltaPoints));
    if (!Number.isFinite(delta) || delta === 0) {
        const user = await getUser(guildId, userId);
        return { applied: 0, newTotal: user.points || 0 };
    }

    const user = await getUser(guildId, userId);
    const { User } = M(guildId);
    const now = new Date();
    const trimmedLabel = String(label).slice(0, 64);
    const r = reason != null && String(reason).trim() ? String(reason).trim().slice(0, 180) : null;
    const ledgerEntryExpr = { at: now, amount: '$__appliedManualAdjustment', label: trimmedLabel };
    if (r) ledgerEntryExpr.reason = r;

    const result = await User.collection.findOneAndUpdate(
        { _id: user._id },
        [
            {
                $set: {
                    __currentPoints: { $ifNull: ['$points', 0] },
                    __currentWeeklyPoints: { $ifNull: ['$weeklyPoints', 0] },
                    __currentMonthlyPoints: { $ifNull: ['$monthlyPoints', 0] },
                },
            },
            {
                $set: {
                    __appliedManualAdjustment:
                        delta < 0
                            ? { $max: [delta, { $multiply: [-1, '$__currentPoints'] }] }
                            : delta,
                },
            },
            {
                $set: {
                    points: { $add: ['$__currentPoints', '$__appliedManualAdjustment'] },
                    weeklyPoints: {
                        $max: [0, { $add: ['$__currentWeeklyPoints', '$__appliedManualAdjustment'] }],
                    },
                    monthlyPoints: {
                        $max: [0, { $add: ['$__currentMonthlyPoints', '$__appliedManualAdjustment'] }],
                    },
                    pointLedger: {
                        $slice: [
                            {
                                $concatArrays: [
                                    [ledgerEntryExpr],
                                    { $ifNull: ['$pointLedger', []] },
                                ],
                            },
                            25,
                        ],
                    },
                },
            },
        ],
        { returnDocument: 'after' },
    );

    const updatedValue = result?.value ?? result;
    const applied = Number(updatedValue?.__appliedManualAdjustment || 0);
    const newTotal = Number(updatedValue?.points || 0);
    await User.collection.updateOne(
        { _id: user._id },
        {
            $unset: {
                __currentPoints: '',
                __currentWeeklyPoints: '',
                __currentMonthlyPoints: '',
                __appliedManualAdjustment: '',
            },
        },
    );

    if (applied === 0) {
        return { applied: 0, newTotal };
    }

    const updatedUser = await User.findById(user._id);
    if (updatedUser.points >= 50 && !updatedUser.achievements.includes('LOYAL_PLAYER')) {
        await awardAchievement(client, guildId, null, userId, 'LOYAL_PLAYER');
    }

    return { applied, newTotal };
    });
}

const LEADERBOARD_SNAPSHOT_KEEP = { weekly: 60, monthly: 36 };

/**
 * Persist top standings before weekly/monthly counters are zeroed.
 * @param {string} guildId
 * @param {'weekly'|'monthly'} period
 * @param {import('mongoose').Document[]} users Mongoose User docs, sorted by score desc
 * @param {'weeklyPoints'|'monthlyPoints'} scoreKey
 */
async function recordLeaderboardPeriodSnapshot(guildId, period, users, scoreKey) {
    return mongoRouter.runWithGuild(guildId, async () => {
        const { LeaderboardPeriodSnapshot } = M(guildId);
        const entries = users.slice(0, 15).map((u, i) => ({
            userId: u.userId,
            score: u[scoreKey] || 0,
            rank: i + 1,
        }));
        await LeaderboardPeriodSnapshot.create({
            guildId,
            period,
            endedAt: new Date(),
            entries,
        });
        const maxKeep = LEADERBOARD_SNAPSHOT_KEEP[period] || 60;
        const excess = await LeaderboardPeriodSnapshot.find({ guildId, period })
            .sort({ endedAt: -1 })
            .skip(maxKeep)
            .select('_id')
            .lean();
        if (excess.length > 0) {
            await LeaderboardPeriodSnapshot.deleteMany({ _id: { $in: excess.map((d) => d._id) } });
        }
    });
}

const DAILY_PLAYGAME_LIMIT = 5;

/** Max personal Credits (points / weekly / monthly) from **war** `/playgame` per user per **UTC day**; faction war score still uses full base. */
const WAR_PLAYGAME_PERSONAL_CREDITS_CAP = 50;

async function checkAndIncrementDailyPlaygame(guildId, userId, isWarSession) {
    if (isWarSession) {
        return {
            allowed: true,
            countsForPoints: true,
            remainingPointEligible: DAILY_PLAYGAME_LIMIT,
            playsToday: 0,
        };
    }

    const today = new Date().toISOString().slice(0, 10);
    const user = await getUser(guildId, userId);
    const count = user.dailyPlaygameSessions?.get(today) || 0;

    if (!user.dailyPlaygameSessions) {
        user.dailyPlaygameSessions = new Map();
    }
    user.dailyPlaygameSessions.set(today, count + 1);
    // Clean old keys lazily
    for (const key of [...user.dailyPlaygameSessions.keys()]) {
        if (key !== today) user.dailyPlaygameSessions.delete(key);
    }
    user.markModified('dailyPlaygameSessions');
    await user.save();

    const playsToday = count + 1;
    const countsForPoints = playsToday <= DAILY_PLAYGAME_LIMIT;
    return {
        allowed: true,
        countsForPoints,
        remainingPointEligible: Math.max(0, DAILY_PLAYGAME_LIMIT - playsToday),
        playsToday,
        message: countsForPoints
            ? null
            : `Game ${playsToday} today started. Personal points stop after your first ${DAILY_PLAYGAME_LIMIT} games each UTC day.`,
    };
}

module.exports = {
    getUser,
    updateUser,
    grantInterruptedGameGoodwill,
    transferCreditsAtomic,
    joinFactionAtomic,
    claimDailyAtomic,
    addScore,
    addManualPointAdjustment,
    addReferralEconomyPoints,
    getSystemConfig,
    updateSystemConfig,
    resolveLeaderboardSort,
    refreshLeaderboard,
    leaderboardCache,
    createActiveGame,
    updateActiveGame,
    endActiveGame,
    recordLeaderboardPeriodSnapshot,
    DAILY_PLAYGAME_LIMIT,
    WAR_PLAYGAME_PERSONAL_CREDITS_CAP,
    checkAndIncrementDailyPlaygame,
};
