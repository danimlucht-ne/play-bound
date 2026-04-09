const { EmbedBuilder, escapeMarkdown } = require('discord.js');
const { updateUser, getSystemConfig } = require('./db');
const { automatedServerPostsEnabled } = require('./automatedPosts');

async function resolveAchievementDisplayName(client, guildId, userId) {
    const uid = String(userId);
    const guild = client.guilds.cache.get(guildId);
    if (guild) {
        const member = await guild.members.fetch(uid).catch(() => null);
        if (member?.displayName) return member.displayName;
    }
    const user = await client.users.fetch(uid).catch(() => null);
    if (user) return user.globalName || user.username || uid;
    return uid;
}

const ACHIEVEMENTS = {
    FIRST_WIN: { name: 'First Class', desc: 'Win your very first game or giveaway!', emoji: '🥇' },
    PERFECT_GUESS: { name: 'Bullseye', desc: 'Guess the exact number in a guessing game!', emoji: '🎯' },
    SPEED_DEMON: { name: 'Speed Demon', desc: 'Complete a Trivia Sprint in under 60 seconds!', emoji: '⚡' },
    WORDLE_WIZARD: { name: 'Wordle Wizard', desc: 'Solve a Serverdle in 3 or fewer guesses!', emoji: '🧠' },
    LOYAL_PLAYER: { name: 'Loyal Citizen', desc: 'Reach 50 total points on the leaderboard.', emoji: '⭐' },
    CHATTERBOX: { name: 'Chatterbox', desc: 'Send 100 messages in the server!', emoji: '💬' },
    HOPEFUL: { name: 'Hopeful', desc: 'Enter 5 giveaways!', emoji: '🎁' },
    WEEKLY_CROWN: { name: 'Weekly King or Queen', desc: 'Finish #1 in your server weekly recap.', emoji: '👑' },
    MONTHLY_CROWN: { name: 'Monthly Monarch', desc: 'Finish #1 in your server monthly recap.', emoji: '🏰' },
    FACTION_CROWN: { name: 'Faction King or Queen', desc: 'Reach #1 Arena score on your faction in this server.', emoji: '⚔️' },
    FACTION_WAR_ROOKIE: { name: 'War Rookie', desc: 'Join 1 faction war.', emoji: '🛡️' },
    FACTION_WAR_REGULAR: { name: 'War Regular', desc: 'Join 5 faction wars.', emoji: '🛡️' },
    FACTION_WAR_VETERAN: { name: 'War Veteran', desc: 'Join 10 faction wars.', emoji: '🛡️' },
    TRIVIA_ROOKIE: { name: 'Trivia Rookie', desc: 'Win 1 Trivia match.', emoji: '❓' },
    TRIVIA_STREAKER: { name: 'Trivia Streaker', desc: 'Win 3 Trivia matches.', emoji: '❓' },
    TRIVIA_KING: { name: 'Trivia King', desc: 'Win 5 Trivia matches.', emoji: '👑' },
    TRIVIA_LEGEND: { name: 'Trivia Legend', desc: 'Win 15 Trivia matches.', emoji: '❓' },
    TRIVIA_ORACLE: { name: 'Trivia Oracle', desc: 'Win 30 Trivia matches.', emoji: '❓' },
    GUESS_ROOKIE: { name: 'Guess Rookie', desc: 'Win 1 Guess the Number game.', emoji: '🎲' },
    GUESS_STREAKER: { name: 'Guess Streaker', desc: 'Win 3 Guess the Number games.', emoji: '🎲' },
    GUESS_MASTER: { name: 'Guess Master', desc: 'Win 5 Guess the Number games.', emoji: '🔮' },
    GUESS_LEGEND: { name: 'Guess Legend', desc: 'Win 15 Guess the Number games.', emoji: '🎲' },
    GUESS_MYTHIC: { name: 'Guess Mythic', desc: 'Win 30 Guess the Number games.', emoji: '🎲' },
    SERVERDLE_ROOKIE: { name: 'Serverdle Rookie', desc: 'Win 1 Serverdle game.', emoji: '🟩' },
    SERVERDLE_STREAKER: { name: 'Serverdle Streaker', desc: 'Win 3 Serverdle games.', emoji: '🟩' },
    SERVERDLE_MASTER: { name: 'Serverdle Master', desc: 'Win 5 Serverdle games.', emoji: '🧩' },
    SERVERDLE_LEGEND: { name: 'Serverdle Legend', desc: 'Win 15 Serverdle games.', emoji: '🟩' },
    SERVERDLE_MYTHIC: { name: 'Serverdle Mythic', desc: 'Win 30 Serverdle games.', emoji: '🟩' },
    SPRINT_ROOKIE: { name: 'Sprint Rookie', desc: 'Win 1 Trivia Sprint game.', emoji: '🏃' },
    SPRINT_STREAKER: { name: 'Sprint Streaker', desc: 'Win 3 Trivia Sprint games.', emoji: '🏃' },
    SPRINT_CHAMPION: { name: 'Sprint Champion', desc: 'Win 5 Trivia Sprint games.', emoji: '🏃' },
    SPRINT_LEGEND: { name: 'Sprint Legend', desc: 'Win 15 Trivia Sprint games.', emoji: '🏃' },
    SPRINT_MYTHIC: { name: 'Sprint Mythic', desc: 'Win 30 Trivia Sprint games.', emoji: '🏃' },
    CAPTION_ROOKIE: { name: 'Caption Rookie', desc: 'Win 1 Caption contest.', emoji: '📸' },
    CAPTION_STREAKER: { name: 'Caption Streaker', desc: 'Win 3 Caption contests.', emoji: '📸' },
    CAPTION_KING: { name: 'Caption King', desc: 'Win 5 Caption contests.', emoji: '🖼️' },
    CAPTION_LEGEND: { name: 'Caption Legend', desc: 'Win 15 Caption contests.', emoji: '📸' },
    CAPTION_MYTHIC: { name: 'Caption Mythic', desc: 'Win 30 Caption contests.', emoji: '📸' },
    TUNE_ROOKIE: { name: 'Tune Rookie', desc: 'Win 1 Name That Tune round.', emoji: '🎧' },
    TUNE_STREAKER: { name: 'Tune Streaker', desc: 'Win 3 Name That Tune rounds.', emoji: '🎧' },
    MAESTRO: { name: 'Maestro', desc: 'Win 5 Name That Tune rounds.', emoji: '🎵' },
    TUNE_LEGEND: { name: 'Tune Legend', desc: 'Win 15 Name That Tune rounds.', emoji: '🎧' },
    TUNE_MYTHIC: { name: 'Tune Mythic', desc: 'Win 30 Name That Tune rounds.', emoji: '🎧' },
    UNSCRAMBLE_ROOKIE: { name: 'Unscramble Rookie', desc: 'Win 1 Unscramble game.', emoji: '🔤' },
    UNSCRAMBLE_STREAKER: { name: 'Unscramble Streaker', desc: 'Win 3 Unscramble games.', emoji: '🔤' },
    UNSCRAMBLE_PRO: { name: 'Unscramble Pro', desc: 'Win 5 Unscramble games.', emoji: '📝' },
    UNSCRAMBLE_LEGEND: { name: 'Unscramble Legend', desc: 'Win 15 Unscramble games.', emoji: '🔤' },
    UNSCRAMBLE_MYTHIC: { name: 'Unscramble Mythic', desc: 'Win 30 Unscramble games.', emoji: '🔤' },
    SPELLING_BEE_ROOKIE: { name: 'Spelling Bee Rookie', desc: 'Win 1 Spelling Bee game.', emoji: '🐝' },
    SPELLING_BEE_STREAKER: { name: 'Spelling Bee Streaker', desc: 'Win 3 Spelling Bee games.', emoji: '🐝' },
    SPELLING_BEE_CHAMPION: { name: 'Spelling Bee Champion', desc: 'Win 5 Spelling Bee games.', emoji: '🐝' },
    SPELLING_BEE_LEGEND: { name: 'Spelling Bee Legend', desc: 'Win 15 Spelling Bee games.', emoji: '🐝' },
    SPELLING_BEE_MYTHIC: { name: 'Spelling Bee Mythic', desc: 'Win 30 Spelling Bee games.', emoji: '🐝' },
    MOVIE_QUOTES_ROOKIE: { name: 'Quote Rookie', desc: 'Win 1 TV & Movie Quotes game.', emoji: '🎬' },
    MOVIE_QUOTES_STREAKER: { name: 'Quote Streaker', desc: 'Win 3 TV & Movie Quotes games.', emoji: '🎬' },
    MOVIE_QUOTES_STAR: { name: 'Quote Star', desc: 'Win 5 TV & Movie Quotes games.', emoji: '🎬' },
    MOVIE_QUOTES_LEGEND: { name: 'Quote Legend', desc: 'Win 15 TV & Movie Quotes games.', emoji: '🎬' },
    MOVIE_QUOTES_MYTHIC: { name: 'Quote Mythic', desc: 'Win 30 TV & Movie Quotes games.', emoji: '🎬' },
};

const STAT_ACHIEVEMENT_MILESTONES = {
    triviaWins: { thresholds: [1, 3, 5, 15, 30], keys: ['TRIVIA_ROOKIE', 'TRIVIA_STREAKER', 'TRIVIA_KING', 'TRIVIA_LEGEND', 'TRIVIA_ORACLE'] },
    guessWins: { thresholds: [1, 3, 5, 15, 30], keys: ['GUESS_ROOKIE', 'GUESS_STREAKER', 'GUESS_MASTER', 'GUESS_LEGEND', 'GUESS_MYTHIC'] },
    serverdleWins: { thresholds: [1, 3, 5, 15, 30], keys: ['SERVERDLE_ROOKIE', 'SERVERDLE_STREAKER', 'SERVERDLE_MASTER', 'SERVERDLE_LEGEND', 'SERVERDLE_MYTHIC'] },
    sprintWins: { thresholds: [1, 3, 5, 15, 30], keys: ['SPRINT_ROOKIE', 'SPRINT_STREAKER', 'SPRINT_CHAMPION', 'SPRINT_LEGEND', 'SPRINT_MYTHIC'] },
    captionWins: { thresholds: [1, 3, 5, 15, 30], keys: ['CAPTION_ROOKIE', 'CAPTION_STREAKER', 'CAPTION_KING', 'CAPTION_LEGEND', 'CAPTION_MYTHIC'] },
    tuneWins: { thresholds: [1, 3, 5, 15, 30], keys: ['TUNE_ROOKIE', 'TUNE_STREAKER', 'MAESTRO', 'TUNE_LEGEND', 'TUNE_MYTHIC'] },
    unscrambleWins: { thresholds: [1, 3, 5, 15, 30], keys: ['UNSCRAMBLE_ROOKIE', 'UNSCRAMBLE_STREAKER', 'UNSCRAMBLE_PRO', 'UNSCRAMBLE_LEGEND', 'UNSCRAMBLE_MYTHIC'] },
    spellingBeeWins: { thresholds: [1, 3, 5, 15, 30], keys: ['SPELLING_BEE_ROOKIE', 'SPELLING_BEE_STREAKER', 'SPELLING_BEE_CHAMPION', 'SPELLING_BEE_LEGEND', 'SPELLING_BEE_MYTHIC'] },
    movieQuoteWins: { thresholds: [1, 3, 5, 15, 30], keys: ['MOVIE_QUOTES_ROOKIE', 'MOVIE_QUOTES_STREAKER', 'MOVIE_QUOTES_STAR', 'MOVIE_QUOTES_LEGEND', 'MOVIE_QUOTES_MYTHIC'] },
    factionWarsJoined: { thresholds: [1, 5, 10], keys: ['FACTION_WAR_ROOKIE', 'FACTION_WAR_REGULAR', 'FACTION_WAR_VETERAN'] },
};

const CUSTOM_ACHIEVEMENT_KEY = /^CUSTOM_[A-Z0-9_]{1,40}$/;
const DISCORD_CUSTOM_EMOJI = /^<a?:\w{2,32}:\d{17,20}>$/;

function normalizeAchievementEmoji(raw) {
    if (raw == null) return null;
    const s = String(raw).trim();
    if (!s) return null;
    if (s.length > 100 || /\n|\r/.test(s)) return null;
    if (DISCORD_CUSTOM_EMOJI.test(s)) return s;
    if (s.includes('<')) return null;
    return s.length <= 64 ? s : null;
}

function resolveSeasonAchievementMeta(achKey) {
    const quarterlyChamp = /^SEASON_Q([1-4])_(\d{4})_FACTION_CHAMP$/.exec(achKey);
    if (quarterlyChamp) {
        return {
            name: `Q${quarterlyChamp[1]} ${quarterlyChamp[2]} Quarterly Champions`,
            desc: 'Your faction won the global quarterly season.',
            emoji: '🏆',
        };
    }
    const yearlyChamp = /^SEASON_YEAR_(\d{4})_FACTION_CHAMP$/.exec(achKey);
    if (yearlyChamp) {
        return {
            name: `${yearlyChamp[1]} Year Champions`,
            desc: 'Your faction won the global yearly championship.',
            emoji: '👑',
        };
    }
    const quarterlyTopServer = /^SEASON_Q([1-4])_(\d{4})_TOP_SERVER$/.exec(achKey);
    if (quarterlyTopServer) {
        return {
            name: `Q${quarterlyTopServer[1]} ${quarterlyTopServer[2]} · #1 server`,
            desc: 'You were in the Discord server that topped the quarterly server season.',
            emoji: '🌐',
        };
    }
    const quarterlyMvp = /^SEASON_Q([1-4])_(\d{4})_FACTION_MVP$/.exec(achKey);
    if (quarterlyMvp) {
        return {
            name: `Q${quarterlyMvp[1]} ${quarterlyMvp[2]} · Faction MVP`,
            desc: 'Highest Arena score among members of the winning global faction at season rollover.',
            emoji: '⭐',
        };
    }
    const yearlyTopServer = /^SEASON_YEAR_(\d{4})_TOP_SERVER$/.exec(achKey);
    if (yearlyTopServer) {
        return {
            name: `${yearlyTopServer[1]} · #1 server (year)`,
            desc: 'You were in the server that won the yearly server season aggregate.',
            emoji: '🌐',
        };
    }
    const yearlyMvp = /^SEASON_YEAR_(\d{4})_FACTION_MVP$/.exec(achKey);
    if (yearlyMvp) {
        return {
            name: `${yearlyMvp[1]} · Faction MVP (year)`,
            desc: 'Highest Arena score among members of the yearly winning global faction at rollover.',
            emoji: '⭐',
        };
    }
    return null;
}

function resolveAchievementMeta(achKey, config) {
    const seasonal = resolveSeasonAchievementMeta(achKey);
    if (seasonal) return seasonal;
    if (ACHIEVEMENTS[achKey]) return ACHIEVEMENTS[achKey];
    const list = config.customAchievements || [];
    const found = list.find((c) => c.key === achKey);
    if (!found) return null;
    return {
        name: found.name,
        desc: found.desc,
        emoji: found.emoji || null,
    };
}

function formatAchievementLabel(ach) {
    const emojiLead = ach.emoji ? `${ach.emoji} ` : '';
    return `${emojiLead}${ach.name}`;
}

async function getAchievementMeta(guildId, achKey) {
    const config = await getSystemConfig(guildId);
    return resolveAchievementMeta(achKey, config);
}

function milestoneAchievementKeys(statKey, value) {
    const config = STAT_ACHIEVEMENT_MILESTONES[statKey];
    if (!config) return [];
    const n = Number(value || 0);
    return config.thresholds.flatMap((threshold, idx) => (n >= threshold && config.keys[idx] ? [config.keys[idx]] : []));
}

async function awardAchievement(client, guildId, channel, userId, achKey) {
    const config = await getSystemConfig(guildId);
    const ach = resolveAchievementMeta(achKey, config);
    if (!ach) return;

    const uid = String(userId);
    let newlyGranted = false;
    await updateUser(guildId, uid, async (user) => {
        if (user.achievements.includes(achKey)) return;
        user.achievements.push(achKey);
        newlyGranted = true;
    });
    if (!newlyGranted) return;

    const who = escapeMarkdown(await resolveAchievementDisplayName(client, guildId, uid));
    const emojiLead = ach.emoji ? `${ach.emoji} ` : '';
    const embed = new EmbedBuilder()
        .setColor('#FFD700')
        .setTitle('Achievement Unlocked!')
        .setDescription(`${emojiLead}**${who}** earned **${escapeMarkdown(ach.name)}**\n\n*${escapeMarkdown(ach.desc)}*`);

    if (config.roleRewards && (config.roleRewards.has?.(achKey) || config.roleRewards[achKey])) {
        const roleId = config.roleRewards.get ? config.roleRewards.get(achKey) : config.roleRewards[achKey];
        const guild = client.guilds.cache.get(guildId);
        if (guild) {
            try {
                const member = await guild.members.fetch(uid);
                const role = await guild.roles.fetch(roleId);
                if (member && role) {
                    await member.roles.add(role);
                    embed.addFields({ name: 'Role Granted', value: `<@&${roleId}>` });
                }
            } catch (e) {
                console.error(`Failed to grant role ${roleId} to ${uid}:`, e);
            }
        }
    }

    if (config.achievementChannel && automatedServerPostsEnabled(config)) {
        const achChannel = client.channels.cache.get(config.achievementChannel);
        if (achChannel) {
            achChannel.send({ embeds: [embed] }).catch(() => {});
            return;
        }
    }
    if (channel) {
        channel.send({ embeds: [embed] }).catch(() => {});
    }
}

async function revokeAchievement(client, guildId, userId, achKey) {
    const config = await getSystemConfig(guildId);
    await updateUser(guildId, userId, async (user) => {
        user.achievements = (user.achievements || []).filter((k) => k !== achKey);
    });

    const roleId = config.roleRewards?.get?.(achKey) ?? config.roleRewards?.[achKey];
    if (roleId && client) {
        const guild = client.guilds.cache.get(guildId);
        if (guild) {
            try {
                const member = await guild.members.fetch(userId);
                if (member.roles.cache.has(roleId)) await member.roles.remove(roleId);
            } catch (e) {
                console.error(`Failed to remove role ${roleId} from ${userId}:`, e);
            }
        }
    }
}

module.exports = {
    ACHIEVEMENTS,
    CUSTOM_ACHIEVEMENT_KEY,
    normalizeAchievementEmoji,
    resolveSeasonAchievementMeta,
    resolveAchievementMeta,
    formatAchievementLabel,
    getAchievementMeta,
    milestoneAchievementKeys,
    awardAchievement,
    revokeAchievement,
};
