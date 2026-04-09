require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const mongoose = require('mongoose');
const { User } = require('./models');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
    console.log('Bot logged in for cleanup.');
    try {
        await mongoose.connect(process.env.MONGO_URI);
        
        // Find users with points
        const users = await User.find({ points: { $gt: 0 } });
        console.log(`Checking ${users.length} users with points...`);
        
        let deadCount = 0;
        for (const u of users) {
            try {
                // Attempt to fetch the user from Discord's API
                await client.users.fetch(u.userId);
            } catch (e) {
                // Error code 10013 means Unknown User
                console.log(`Deleting dead account: ${u.userId} (${u.points} pts)`);
                await User.deleteOne({ _id: u._id });
                deadCount++;
            }
        }
        
        console.log(`Cleanup complete. Removed ${deadCount} dead accounts.`);
    } catch (err) {
        console.error('Cleanup failed:', err);
    } finally {
        process.exit(0);
    }
});

client.login(process.env.DISCORD_TOKEN);