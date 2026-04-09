require('dotenv').config();
const mongoose = require('mongoose');
const { User, SystemConfig } = require('./models');

async function migrate() {
    const guildIds = process.argv.slice(2);
    if (guildIds.length === 0) {
        console.error('Please provide at least one Server ID as an argument.');
        console.error('Usage: node migrate.js <SERVER_ID_1> <SERVER_ID_2> ...');
        process.exit(1);
    }

    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to database.');

        const primaryGuildId = guildIds[0];

        // 1. Find all unassigned users
        const unassignedUsers = await User.find({ guildId: { $exists: false } });
        console.log(`Found ${unassignedUsers.length} users with no assigned server.`);

        if (unassignedUsers.length > 0) {
            // Assign them to the primary guild
            await User.updateMany(
                { guildId: { $exists: false } },
                { $set: { guildId: primaryGuildId } }
            );
            console.log(`Migrated ${unassignedUsers.length} users to primary server: ${primaryGuildId}.`);

            // If there are other guilds, duplicate the users for those guilds
            for (let i = 1; i < guildIds.length; i++) {
                const otherGuildId = guildIds[i];
                const newUsers = unassignedUsers.map(u => ({
                    userId: u.userId,
                    guildId: otherGuildId,
                    points: u.points,
                    weeklyPoints: u.weeklyPoints,
                    monthlyPoints: u.monthlyPoints,
                    achievements: u.achievements,
                    stats: u.stats,
                    birthday: u.birthday
                }));
                if (newUsers.length > 0) {
                    await User.insertMany(newUsers);
                    console.log(`Duplicated ${newUsers.length} users for server: ${otherGuildId}.`);
                }
            }
        }

        // 2. Find unassigned config
        const unassignedConfig = await SystemConfig.findOne({ guildId: { $exists: false } });
        if (unassignedConfig) {
            // Assign to primary guild
            await SystemConfig.updateOne(
                { guildId: { $exists: false } },
                { $set: { guildId: primaryGuildId } }
            );
            console.log(`Migrated system config to primary server: ${primaryGuildId}.`);

            // Duplicate for other guilds
            for (let i = 1; i < guildIds.length; i++) {
                const otherGuildId = guildIds[i];
                const newConfig = {
                    guildId: otherGuildId,
                    announceChannel: unassignedConfig.announceChannel,
                    welcomeChannel: unassignedConfig.welcomeChannel,
                    welcomeMessage: unassignedConfig.welcomeMessage,
                    welcomeMessages: unassignedConfig.welcomeMessages || [],
                    birthdayChannel: unassignedConfig.birthdayChannel,
                    birthdayMessage: unassignedConfig.birthdayMessage,
                    birthdayMessages: unassignedConfig.birthdayMessages || [],
                    achievementChannel: unassignedConfig.achievementChannel,
                    leaderboardChannel: unassignedConfig.leaderboardChannel,
                    redirects: unassignedConfig.redirects
                };
                await SystemConfig.create(newConfig);
                console.log(`Duplicated system config for server: ${otherGuildId}.`);
            }
        }

        // 3. Initialize Arrays for Welcome/Birthday messages for all specified guilds
        for (const gId of guildIds) {
            const config = await SystemConfig.findOne({ guildId: gId });
            if (config) {
                let changed = false;
                if (!config.welcomeMessages) {
                    config.welcomeMessages = [];
                    if (config.welcomeMessage) {
                        config.welcomeMessages.push(config.welcomeMessage);
                        config.welcomeMessage = null;
                    }
                    changed = true;
                }
                if (!config.birthdayMessages) {
                    config.birthdayMessages = [];
                    if (config.birthdayMessage) {
                        config.birthdayMessages.push(config.birthdayMessage);
                        config.birthdayMessage = null;
                    }
                    changed = true;
                }
                if (changed) {
                    await config.save();
                    console.log(`Migrated old welcome/birthday messages into arrays for server: ${gId}.`);
                }
            }
        }

        console.log('Migration complete!');
        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    }
}

migrate();