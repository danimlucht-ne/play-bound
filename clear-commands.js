require('dotenv').config({ path: process.env.DOTENV_CONFIG_PATH || '.env' });
const { REST, Routes } = require('discord.js');

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
    try {
        console.log('Started clearing application (/) commands.');

        // You need your Client ID to clear global commands. 
        // We'll decode it from the token or just ask the user to provide it.
        // Actually, the easiest way is to let the user pass it as an argument:
        const clientId = process.argv[2];
        if (!clientId) {
            console.error('Please provide your Bot Client ID. Usage: node clear-commands.js <CLIENT_ID>');
            process.exit(1);
        }

        // Clear global commands
        await rest.put(
            Routes.applicationCommands(clientId),
            { body: [] }
        );

        console.log('Successfully cleared all global application (/) commands.');
        console.log('You can now restart your bot to freshly register the new commands!');
    } catch (error) {
        console.error('Error clearing commands:', error);
    }
})();