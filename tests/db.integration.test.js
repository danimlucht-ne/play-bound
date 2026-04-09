const test = require('node:test');
const assert = require('node:assert/strict');
const { GLOBAL_FACTION_KEYS, CANONICAL_FACTION_EMOJI } = require('../lib/globalFactions');

const {
    RUN_DB_TESTS,
    TEST_DB_NAME,
    connectTestDb,
    clearTestDb,
    disconnectTestDb,
} = require('./support/liveMongoHarness');

const maybeTest = RUN_DB_TESTS ? test : test.skip;

/** Models and db are required only after mongoose.connect — see models.js proxy + mongoRouter. */
let User;
let SystemConfig;
let Game;
let Faction;
let FactionChallenge;
let FactionSeasonStats;
let getUser;
let getSystemConfig;
let createActiveGame;
let updateActiveGame;
let endActiveGame;
let addScore;
let addManualPointAdjustment;
let transferCreditsAtomic;
let joinFactionAtomic;
let claimDailyAtomic;
let resolveFactionDocForJoin;
let grantInterruptedGameGoodwill;
let recordFactionChallengePoints;
let applyEndedChallengeToGlobalTotals;
let FactionCreditReasonCode;

if (RUN_DB_TESTS) {
    test.before(async () => {
        await connectTestDb();
        const models = require('../models');
        User = models.User;
        SystemConfig = models.SystemConfig;
        Game = models.Game;
        Faction = models.Faction;
        FactionChallenge = models.FactionChallenge;
        FactionSeasonStats = models.FactionSeasonStats;
        const db = require('../lib/db');
        getUser = db.getUser;
        getSystemConfig = db.getSystemConfig;
        createActiveGame = db.createActiveGame;
        updateActiveGame = db.updateActiveGame;
        endActiveGame = db.endActiveGame;
        addScore = db.addScore;
        addManualPointAdjustment = db.addManualPointAdjustment;
        transferCreditsAtomic = db.transferCreditsAtomic;
        joinFactionAtomic = db.joinFactionAtomic;
        claimDailyAtomic = db.claimDailyAtomic;
        grantInterruptedGameGoodwill = db.grantInterruptedGameGoodwill;
        resolveFactionDocForJoin = require('../lib/officialFactionJoin').resolveFactionDocForJoin;
        const factionChallenge = require('../lib/factionChallenge');
        recordFactionChallengePoints = factionChallenge.recordFactionChallengePoints;
        applyEndedChallengeToGlobalTotals = factionChallenge.applyEndedChallengeToGlobalTotals;
        FactionCreditReasonCode = require('../lib/gameClassification').FactionCreditReasonCode;
    });

    test.afterEach(async () => {
        await clearTestDb();
    });

    test.after(async () => {
        await disconnectTestDb();
    });
}

async function seedOfficialFactions(names = [...GLOBAL_FACTION_KEYS]) {
    await Faction.insertMany(
        names.map((name) => ({
            name,
            emoji: CANONICAL_FACTION_EMOJI[name] || '⭐',
            desc: `${name} test faction`,
        })),
        { ordered: false },
    ).catch((err) => {
        if (err?.code !== 11000) throw err;
    });
}

maybeTest('real DB: concurrent getUser calls collapse to a single persisted row', async () => {
    const results = await Promise.all(
        Array.from({ length: 20 }, () => getUser('guild-race', 'user-race')),
    );

    assert.equal(results.length, 20);
    assert.equal(results.every((doc) => doc.guildId === 'guild-race' && doc.userId === 'user-race'), true);

    const docs = await User.find({ guildId: 'guild-race', userId: 'user-race' });
    assert.equal(docs.length, 1);
});

maybeTest('real DB: concurrent getSystemConfig calls collapse to a single persisted row', async () => {
    const results = await Promise.all(
        Array.from({ length: 20 }, () => getSystemConfig('guild-config-race')),
    );

    assert.equal(results.length, 20);

    const docs = await SystemConfig.find({ guildId: 'guild-config-race' });
    assert.equal(docs.length, 1);
});

maybeTest('real DB: active game lifecycle persists and ends correctly', async () => {
    const created = await createActiveGame(
        'guild-1',
        'channel-1',
        'thread-1',
        'Trivia',
        { question: 1, players: {} },
        15,
        true,
    );

    assert.equal(created.status, 'active');
    assert.equal(created.hostIsPremium, true);

    await updateActiveGame('thread-1', (state) => {
        if (!state.players) state.players = {};
        state.players.userA = { score: 5 };
        state.question = 2;
    });

    const mid = await Game.findOne({ threadId: 'thread-1', status: 'active' });
    assert.equal(mid.state.question, 2);
    assert.deepEqual(mid.state.players.userA, { score: 5 });

    const ended = await endActiveGame('thread-1');
    assert.equal(ended.status, 'ended');
    assert.ok(ended.endTime instanceof Date);
});

maybeTest('real DB: manual point adjustments persist to the isolated test database', async () => {
    const client = { channels: { cache: new Map() } };
    const first = await addManualPointAdjustment(
        client,
        'guild-ledger',
        'user-ledger',
        25,
        'db_integration_adjust',
        'initial credit',
    );
    const second = await addManualPointAdjustment(
        client,
        'guild-ledger',
        'user-ledger',
        -10,
        'db_integration_adjust',
        'rollback',
    );

    assert.deepEqual(first, { applied: 25, newTotal: 25 });
    assert.deepEqual(second, { applied: -10, newTotal: 15 });

    const user = await User.findOne({ guildId: 'guild-ledger', userId: 'user-ledger' }).lean();
    assert.equal(user.points, 15);
    assert.equal(user.weeklyPoints, 15);
    assert.equal(user.monthlyPoints, 15);
    assert.equal(Array.isArray(user.pointLedger), true);
    assert.equal(user.pointLedger.length, 2);
    assert.equal(user.pointLedger[0].reason, 'rollback');
    assert.equal(user.pointLedger[1].reason, 'initial credit');
});

maybeTest('real DB: concurrent manual adjustments do not lose increments', async () => {
    const client = { channels: { cache: new Map() } };

    const results = await Promise.all(
        Array.from({ length: 10 }, (_, idx) =>
            addManualPointAdjustment(
                client,
                'guild-concurrency',
                'user-concurrency',
                1,
                'db_concurrency_adjust',
                `increment-${idx + 1}`,
            ),
        ),
    );

    assert.equal(results.length, 10);
    assert.equal(results.every((result) => result.applied === 1), true);

    const user = await User.findOne({ guildId: 'guild-concurrency', userId: 'user-concurrency' }).lean();
    assert.equal(user.points, 10);
    assert.equal(user.weeklyPoints, 10);
    assert.equal(user.monthlyPoints, 10);
    assert.equal(user.pointLedger.length, 10);
});

maybeTest('real DB: concurrent credit transfers do not overspend the sender', async () => {
    await User.create({
        guildId: 'guild-transfer',
        userId: 'sender-1',
        points: 10,
        weeklyPoints: 0,
        monthlyPoints: 0,
    });

    const results = await Promise.all(
        Array.from({ length: 5 }, () =>
            transferCreditsAtomic('guild-transfer', 'sender-1', 'receiver-1', 3),
        ),
    );

    assert.equal(results.filter((r) => r.ok).length, 3);
    assert.equal(results.filter((r) => !r.ok && r.reason === 'insufficient_funds').length, 2);

    const sender = await User.findOne({ guildId: 'guild-transfer', userId: 'sender-1' }).lean();
    const receiver = await User.findOne({ guildId: 'guild-transfer', userId: 'receiver-1' }).lean();
    assert.equal(sender.points, 1);
    assert.equal(receiver.points, 9);
    assert.equal(receiver.weeklyPoints, 9);
    assert.equal(receiver.monthlyPoints, 9);
});

maybeTest('real DB: concurrent faction joins only allow one winning faction assignment', async () => {
    await resolveFactionDocForJoin('Dragons');
    await resolveFactionDocForJoin('Wolves');
    await User.create({
        guildId: 'guild-faction',
        userId: 'user-faction',
        points: 0,
        weeklyPoints: 0,
        monthlyPoints: 0,
        faction: null,
    });

    const results = await Promise.all([
        joinFactionAtomic('guild-faction', 'user-faction', 'Dragons'),
        joinFactionAtomic('guild-faction', 'user-faction', 'Wolves'),
    ]);

    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.equal(results.filter((r) => !r.ok && r.reason === 'already_in_faction').length, 1);

    const user = await User.findOne({ guildId: 'guild-faction', userId: 'user-faction' }).lean();
    assert.ok(user.faction === 'Dragons' || user.faction === 'Wolves');

    const dragons = await Faction.findOne({ name: 'Dragons' }).lean();
    const wolves = await Faction.findOne({ name: 'Wolves' }).lean();
    assert.equal((dragons.members || 0) + (wolves.members || 0), 1);
});

maybeTest('real DB: addScore credits faction wars with base game points, not boosted economy points', async () => {
    await User.create({
        guildId: 'guild-war-base',
        userId: 'user-dragon',
        faction: 'Dragons',
        points: 0,
        weeklyPoints: 0,
        monthlyPoints: 0,
        isPremium: true,
        inventory: ['double_points'],
        currentStreak: 2,
        lastActiveDate: new Date(Date.now() - 86400000).toISOString().slice(0, 10),
    });
    await FactionChallenge.create({
        guildId: 'guild-war-base',
        challengeMode: 'ranked',
        factionA: 'Dragons',
        factionB: 'Wolves',
        participantsA: ['user-dragon'],
        participantsB: ['user-wolf'],
        gameTypes: ['risk_roll'],
        scoringMode: 'top_n_avg',
        topN: 5,
        maxPerTeam: 7,
        createdBy: 'staff',
        endAt: new Date(Date.now() + 60000),
    });

    const result = await addScore(
        { channels: { cache: new Map() } },
        'guild-war-base',
        'user-dragon',
        5,
        null,
        true,
        'risk_roll',
    );

    assert.equal(result.factionChallengeCredit.credited, true);
    assert.equal(result.factionChallengeCredit.pointsAdded, 5);
    assert.equal(result.factionChallengeCredit.rawPointsAdded, 5);

    const user = await User.findOne({ guildId: 'guild-war-base', userId: 'user-dragon' }).lean();
    assert.ok(user.points > 5, 'premium, streak, double-points, and host aura should still boost economy points');

    const challenge = await FactionChallenge.findOne({ guildId: 'guild-war-base' });
    assert.equal(challenge.rawScoresByUser.get('user-dragon'), 5);
    assert.equal(challenge.scoresByUser.get('user-dragon'), 5);
    assert.equal(challenge.countedPointsByUserTag.get('user-dragon::risk_roll'), undefined);
});

maybeTest('real DB: ranked faction caps preserve raw points while limiting official counted points', async () => {
    await FactionChallenge.create({
        guildId: 'guild-war-caps',
        challengeMode: 'ranked',
        factionA: 'Dragons',
        factionB: 'Wolves',
        participantsA: ['user-dragon'],
        participantsB: ['user-wolf'],
        gameTypes: ['risk_roll'],
        scoringMode: 'top_n_avg',
        topN: 5,
        maxPerTeam: 7,
        contributionCapsByTag: { risk_roll: 10 },
        createdBy: 'staff',
        endAt: new Date(Date.now() + 60000),
    });

    const first = await recordFactionChallengePoints({
        client: null,
        guildId: 'guild-war-caps',
        userId: 'user-dragon',
        factionName: 'Dragons',
        points: 7,
        gameTag: 'risk_roll',
    });
    const second = await recordFactionChallengePoints({
        client: null,
        guildId: 'guild-war-caps',
        userId: 'user-dragon',
        factionName: 'Dragons',
        points: 7,
        gameTag: 'risk_roll',
    });

    assert.equal(first.pointsAdded, 7);
    assert.equal(second.pointsAdded, 3);
    assert.equal(second.rawPointsAdded, 7);

    const challenge = await FactionChallenge.findOne({ guildId: 'guild-war-caps' });
    assert.equal(challenge.rawScoresByUser.get('user-dragon'), 14);
    assert.equal(challenge.scoresByUser.get('user-dragon'), 10);
    assert.equal(challenge.countedPointsByUserTag.get('user-dragon::risk_roll'), 10);
});

maybeTest('real DB: ranked faction wars reject hosted commands and non-enrolled players', async () => {
    await FactionChallenge.create({
        guildId: 'guild-war-hosted',
        challengeMode: 'ranked',
        factionA: 'Dragons',
        factionB: 'Wolves',
        participantsA: ['user-dragon'],
        participantsB: ['user-wolf'],
        gameTypes: ['trivia'],
        scoringMode: 'top_n_avg',
        topN: 5,
        maxPerTeam: 7,
        createdBy: 'staff',
        endAt: new Date(Date.now() + 60000),
    });

    const hosted = await recordFactionChallengePoints({
        client: null,
        guildId: 'guild-war-hosted',
        userId: 'user-dragon',
        factionName: 'Dragons',
        points: 5,
        gameTag: 'trivia',
    });
    await FactionChallenge.create({
        guildId: 'guild-war-not-enrolled',
        challengeMode: 'ranked',
        factionA: 'Dragons',
        factionB: 'Wolves',
        participantsA: ['user-dragon'],
        participantsB: ['user-wolf'],
        gameTypes: ['all'],
        scoringMode: 'top_n_avg',
        topN: 5,
        maxPerTeam: 7,
        createdBy: 'staff',
        endAt: new Date(Date.now() + 60000),
    });
    const notEnrolled = await recordFactionChallengePoints({
        client: null,
        guildId: 'guild-war-not-enrolled',
        userId: 'spectator',
        factionName: 'Dragons',
        points: 5,
        gameTag: 'risk_roll',
    });

    assert.equal(hosted.credited, false);
    assert.equal(hosted.reasonCode, FactionCreditReasonCode.HOSTED_EXCLUDED_FROM_RANKED);
    assert.equal(notEnrolled.credited, false);
    assert.equal(notEnrolled.reasonCode, FactionCreditReasonCode.NOT_ENROLLED);

    const challenges = await FactionChallenge.find({
        guildId: { $in: ['guild-war-hosted', 'guild-war-not-enrolled'] },
    });
    assert.equal(challenges.every((challenge) => challenge.rawScoresByUser.size === 0), true);
    assert.equal(challenges.every((challenge) => challenge.scoresByUser.size === 0), true);
});

maybeTest('real DB: unranked point-cap challenges end locally without changing global match standings', async () => {
    await seedOfficialFactions(['Dragons', 'Wolves']);
    const challenge = await FactionChallenge.create({
        guildId: 'guild-war-unranked',
        challengeMode: 'unranked',
        factionA: 'Dragons',
        factionB: 'Wolves',
        participantsA: ['user-dragon'],
        participantsB: ['user-wolf'],
        gameTypes: ['trivia'],
        scoringMode: 'total_points',
        pointCap: 10,
        createdBy: 'staff',
        endAt: new Date(Date.now() + 60000),
    });

    const result = await recordFactionChallengePoints({
        client: null,
        guildId: 'guild-war-unranked',
        userId: 'user-dragon',
        factionName: 'Dragons',
        points: 10,
        gameTag: 'trivia',
    });

    assert.equal(result.credited, true);
    const ended = await FactionChallenge.findById(challenge._id).lean();
    assert.equal(ended.status, 'ended');
    assert.equal(ended.winnerFaction, 'Dragons');
    assert.equal(ended.globalTotalsApplied, true);
    assert.deepEqual(ended.matchPointsAwarded, { Dragons: 3, Wolves: 0 });

    const dragons = await Faction.findOne({ name: 'Dragons' }).lean();
    const wolves = await Faction.findOne({ name: 'Wolves' }).lean();
    assert.equal(dragons.matchPoints, 0);
    assert.equal(dragons.rawWarContributionTotal, 0);
    assert.equal(wolves.matchPoints, 0);
});

maybeTest('real DB: ended ranked wars apply global match points, raw totals, and season stats once', async () => {
    await seedOfficialFactions(['Dragons', 'Wolves']);
    const challenge = await FactionChallenge.create({
        guildId: 'guild-war-global',
        challengeMode: 'ranked',
        factionA: 'Dragons',
        factionB: 'Wolves',
        participantsA: ['dragon-a', 'dragon-b'],
        participantsB: ['wolf-a', 'wolf-b'],
        scoresByUser: new Map([
            ['dragon-a', 18],
            ['dragon-b', 8],
            ['wolf-a', 9],
            ['wolf-b', 6],
        ]),
        rawScoresByUser: new Map([
            ['dragon-a', 18],
            ['dragon-b', 8],
            ['wolf-a', 9],
            ['wolf-b', 6],
        ]),
        gameTypes: ['risk_roll'],
        scoringMode: 'top_n_avg',
        topN: 5,
        maxPerTeam: 7,
        status: 'ended',
        endedAt: new Date('2026-04-09T12:00:00.000Z'),
        winnerFaction: 'Dragons',
        createdBy: 'staff',
        endAt: new Date('2026-04-09T12:00:00.000Z'),
    });

    await Promise.all([
        applyEndedChallengeToGlobalTotals(null, 'guild-war-global', challenge._id),
        applyEndedChallengeToGlobalTotals(null, 'guild-war-global', challenge._id),
        applyEndedChallengeToGlobalTotals(null, 'guild-war-global', challenge._id),
    ]);

    const dragons = await Faction.findOne({ name: 'Dragons' }).lean();
    const wolves = await Faction.findOne({ name: 'Wolves' }).lean();
    assert.equal(dragons.matchPoints, 3);
    assert.equal(dragons.rankedWins, 1);
    assert.equal(dragons.rawWarContributionTotal, 26);
    assert.equal(wolves.matchPoints, 0);
    assert.equal(wolves.rankedLosses, 1);
    assert.equal(wolves.rawWarContributionTotal, 15);

    const updated = await FactionChallenge.findById(challenge._id).lean();
    assert.equal(updated.globalTotalsApplied, true);
    assert.deepEqual(updated.finalRawTotalsByFaction, { Dragons: 26, Wolves: 15 });
    assert.deepEqual(updated.matchPointsAwarded, { Dragons: 3, Wolves: 0 });

    const seasonRows = await FactionSeasonStats.find({ seasonKey: '2026-Q2' }).lean();
    assert.equal(seasonRows.length, 2);
    assert.equal(seasonRows.find((row) => row.factionName === 'Dragons').matchPoints, 3);
    assert.equal(seasonRows.find((row) => row.factionName === 'Wolves').losses, 1);
});

maybeTest('real DB: tied ranked wars award one global match point to both factions', async () => {
    await seedOfficialFactions(['Dragons', 'Wolves']);
    const challenge = await FactionChallenge.create({
        guildId: 'guild-war-tie',
        challengeMode: 'ranked',
        factionA: 'Dragons',
        factionB: 'Wolves',
        participantsA: ['dragon-a'],
        participantsB: ['wolf-a'],
        scoresByUser: new Map([
            ['dragon-a', 11],
            ['wolf-a', 11],
        ]),
        rawScoresByUser: new Map([
            ['dragon-a', 11],
            ['wolf-a', 11],
        ]),
        gameTypes: ['risk_roll'],
        scoringMode: 'top_n_avg',
        topN: 5,
        maxPerTeam: 7,
        status: 'ended',
        endedAt: new Date('2026-04-09T12:00:00.000Z'),
        createdBy: 'staff',
        endAt: new Date('2026-04-09T12:00:00.000Z'),
    });

    await applyEndedChallengeToGlobalTotals(null, 'guild-war-tie', challenge._id);

    const dragons = await Faction.findOne({ name: 'Dragons' }).lean();
    const wolves = await Faction.findOne({ name: 'Wolves' }).lean();
    assert.equal(dragons.matchPoints, 1);
    assert.equal(dragons.rankedTies, 1);
    assert.equal(wolves.matchPoints, 1);
    assert.equal(wolves.rankedTies, 1);
});

maybeTest('real DB: ranked royale applies winner and loss records across all global factions', async () => {
    await seedOfficialFactions([...GLOBAL_FACTION_KEYS]);
    const battle = [...GLOBAL_FACTION_KEYS];
    const userByFaction = {
        Phoenixes: 'ph-a',
        Unicorns: 'un-a',
        Fireflies: 'ff-a',
        Dragons: 'dragon-a',
        Wolves: 'wolf-a',
        Eagles: 'eagle-a',
    };
    const participants = new Map(battle.map((name) => [name, [userByFaction[name]]]));
    const scoresByUser = new Map([
        ['ph-a', 5],
        ['un-a', 6],
        ['ff-a', 7],
        ['dragon-a', 99],
        ['wolf-a', 9],
        ['eagle-a', 8],
    ]);
    const challenge = await FactionChallenge.create({
        guildId: 'guild-war-royale',
        challengeMode: 'ranked',
        challengeType: 'royale',
        factionA: 'Phoenixes',
        factionB: 'Unicorns',
        battleFactions: battle,
        participantsByFaction: participants,
        scoresByUser,
        rawScoresByUser: new Map(scoresByUser),
        gameTypes: ['risk_roll'],
        scoringMode: 'top_n_avg',
        topN: 5,
        maxPerTeam: 7,
        status: 'ended',
        endedAt: new Date('2026-04-09T12:00:00.000Z'),
        winnerFaction: 'Dragons',
        createdBy: 'staff',
        endAt: new Date('2026-04-09T12:00:00.000Z'),
    });

    await applyEndedChallengeToGlobalTotals(null, 'guild-war-royale', challenge._id);

    const dragons = await Faction.findOne({ name: 'Dragons' }).lean();
    assert.equal(dragons.matchPoints, 3);
    assert.equal(dragons.rankedWins, 1);
    for (const name of battle) {
        if (name === 'Dragons') continue;
        const row = await Faction.findOne({ name }).lean();
        assert.equal(row.matchPoints, 0, name);
        assert.equal(row.rankedLosses, 1, name);
    }
});

maybeTest('real DB: concurrent daily claims only award once per cooldown window', async () => {
    const now = Date.parse('2026-04-09T12:00:00.000Z');
    await User.create({
        guildId: 'guild-daily',
        userId: 'user-daily',
        points: 0,
        weeklyPoints: 0,
        monthlyPoints: 0,
        isPremium: false,
        lastDailyClaim: null,
    });

    const results = await Promise.all(
        Array.from({ length: 5 }, () => claimDailyAtomic('guild-daily', 'user-daily', 75, now)),
    );

    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.equal(results.filter((r) => !r.ok && r.reason === 'cooldown').length, 4);

    const user = await User.findOne({ guildId: 'guild-daily', userId: 'user-daily' }).lean();
    assert.equal(user.points, 75);
    assert.equal(user.weeklyPoints, 75);
    assert.equal(user.monthlyPoints, 75);
    assert.equal(user.lastDailyClaim, now);
});

maybeTest('real DB: concurrent interrupted-game goodwill grants are idempotent per user and game', async () => {
    await User.create({
        guildId: 'guild-interrupt',
        userId: '111111111111111111',
        points: 0,
        weeklyPoints: 0,
        monthlyPoints: 0,
    });

    const results = await Promise.all(
        Array.from({ length: 8 }, () =>
            grantInterruptedGameGoodwill('guild-interrupt', '111111111111111111', 'game-interrupt-1', 25),
        ),
    );

    assert.equal(results.filter((r) => r.granted).length, 1);
    const user = await User.findOne({ guildId: 'guild-interrupt', userId: '111111111111111111' }).lean();
    assert.equal(user.points, 25);
    assert.equal(user.weeklyPoints, 25);
    assert.equal(user.monthlyPoints, 25);
    assert.equal(user.pointLedger.filter((e) => e.reason === 'interrupt:game-interrupt-1').length, 1);
});

maybeTest('real DB harness uses an isolated database name', async () => {
    assert.match(TEST_DB_NAME, /integration|test/i);
});
