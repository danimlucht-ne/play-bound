require('dotenv').config();
const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { MAX_POINTS_PER_PLACEMENT } = require('./lib/utils');
const { GAME_REGISTRY, PLATFORM_GAME_TAGS } = require('./lib/gamePlatform/registry');
const { FACTION_SLASH_CHOICES } = require('./lib/globalFactions');

/** When `1`, registers dev-only slash pieces (e.g. `/playgame ignore_rotation`). Omit in production deploy. */
const INCLUDE_DEV_PLAYGAME_EXTRAS = process.env.PLAYBOUND_REGISTER_DEV_SLASH_OPTIONS === '1';

/** Faction dropdown: legacy + platform tags that count toward war scoring (Discord max 25 choices with fixed rows + “all”). */
const FACTION_PLATFORM_GAME_CHOICES = PLATFORM_GAME_TAGS.filter((t) => GAME_REGISTRY[t]?.warScoringEligible === true).map((t) => ({
    name: String(GAME_REGISTRY[t].displayName).slice(0, 100),
    value: t,
}));

/** Discord string option descriptions must be ≤100 chars. */
const POINTS_OPT_DESC = `Comma-separated podium (1st,2nd…). Defaults vary by game. Max ${MAX_POINTS_PER_PLACEMENT}/placement.`;
const THREAD_NAME_OPT_DESC =
    'Optional. Default: game name + date (e.g. Name That Tune — Apr 3, 2026).';

/** Shared slash copy for hosted games (≤100 chars per Discord). */
const HOST_DELAY_HRS_OPT_DESC = 'Hours to wait before start (omit or 0 = none).';
const HOST_DELAY_DAYS_OPT_DESC = 'Whole days to wait before start (omit or 0 = none).';
const HOST_REPEAT_HRS_OPT_DESC = 'Premium: repeat every N hours (use with repeat_days).';
const HOST_REPEAT_DAYS_OPT_DESC = 'Premium: repeat every N whole days.';
const HOST_GAME_DURATION_MINUTES_DESC = 'How long the game runs (minutes).';
const HOST_GIVEAWAY_DURATION_MINUTES_DESC = 'How long the giveaway stays open (minutes).';
const HOST_GUESS_NUMBER_DURATION_DESC = 'How long the game runs (minutes; default 60).';

const commands = [
    new SlashCommandBuilder()
        .setName('onboarding')
        .setDescription('Short first-time tour — skippable. Get playing fast.')
        .addBooleanOption((o) => o.setName('skip').setDescription('Hide the tour (use resume next time)'))
        .addBooleanOption((o) => o.setName('resume').setDescription('Continue after skipping')),
    new SlashCommandBuilder().setName('help').setDescription('Bot Guide.'),
    new SlashCommandBuilder().setName('profile').setDescription('View profile stats (yours or another member’s — peek is Premium).')
        .addUserOption(o => o.setName('user').setDescription('Member to peek at (Premium; omit for your own profile)')),
    new SlashCommandBuilder().setName('leaderboard').setDescription('Server activity rankings (credits cadence — not global /factions).'),
    new SlashCommandBuilder().setName('leaderboard_history').setDescription('Past weekly or monthly point standings (saved at each reset; anyone can view).')
        .addStringOption(o => o.setName('period').setDescription('Which counter').setRequired(true).addChoices(
            { name: 'Weekly (resets Sundays)', value: 'weekly' },
            { name: 'Monthly (resets 1st of month)', value: 'monthly' },
        ))
        .addIntegerOption(o => o.setName('periods').setDescription('How many past resets to show (default 3)').setMinValue(1).setMaxValue(5)),
    new SlashCommandBuilder().setName('set_announcement_channel').setDescription('Channel for game start & winner announcements.').addChannelOption(o => o.setName('channel').setDescription('Channel to use')),
    new SlashCommandBuilder()
        .setName('set_announce_everyone')
        .setDescription('Toggle @everyone on game starts & winners in the announcement channel.')
        .addBooleanOption((o) =>
            o
                .setName('enabled')
                .setDescription('Ping @everyone for those announcement-channel posts')
                .setRequired(true),
        ),
    new SlashCommandBuilder()
        .setName('set_automated_posts')
        .setDescription('Master switch: scheduled recaps, leaderboard channel, game broadcasts, welcomes, etc.')
        .addBooleanOption((o) =>
            o
                .setName('enabled')
                .setDescription('Allow automated channel posts (off = quiet mode; games & /leaderboard still work)')
                .setRequired(true),
        ),
    new SlashCommandBuilder().setName('set_welcome_channel').setDescription('Channel for new members.').addChannelOption(o => o.setName('channel').setDescription('Channel to use')),
    new SlashCommandBuilder().setName('add_welcome_message').setDescription('Add a welcome message to rotation (use {user} for mention).').addStringOption(o => o.setName('message').setDescription('The message').setRequired(true)),
    new SlashCommandBuilder().setName('remove_welcome_message').setDescription('Remove a welcome message from rotation.').addIntegerOption(o => o.setName('index').setDescription('The index of the message to remove').setRequired(true)),
    new SlashCommandBuilder().setName('list_welcome_messages').setDescription('List all welcome messages in rotation.'),
    new SlashCommandBuilder().setName('set_birthday_channel').setDescription('Channel for birthdays.').addChannelOption(o => o.setName('channel').setDescription('Channel to use')),
    new SlashCommandBuilder().setName('add_birthday_message').setDescription('Add a birthday message to rotation (use {user} for mention).').addStringOption(o => o.setName('message').setDescription('The message').setRequired(true)),
    new SlashCommandBuilder().setName('remove_birthday_message').setDescription('Remove a birthday message from rotation.').addIntegerOption(o => o.setName('index').setDescription('The index of the message to remove').setRequired(true)),
    new SlashCommandBuilder().setName('list_birthday_messages').setDescription('List all birthday messages in rotation.'),
    new SlashCommandBuilder().setName('set_achievement_channel').setDescription('Channel for achievement announcements.').addChannelOption(o => o.setName('channel').setDescription('Channel to use')),
    new SlashCommandBuilder().setName('set_leaderboard_channel').setDescription('Channel for the server leaderboard message.').addChannelOption(o => o.setName('channel').setDescription('Channel to use')),
    new SlashCommandBuilder().setName('set_leaderboard_cadence').setDescription('How /leaderboard and the channel board rank players (Administrator or Bot Manager).')
        .addStringOption(o => o.setName('mode').setDescription('Ranking period').setRequired(true).addChoices(
            { name: 'All-time (never auto-reset)', value: 'all_time' },
            { name: 'This week (resets Sundays 8 PM bot time)', value: 'weekly' },
            { name: 'This month (resets 1st @ 8 PM bot time)', value: 'monthly' },
        )),
    new SlashCommandBuilder().setName('set_faction_reminder_channel').setDescription('Channel for a weekly Sunday “faction war” nudge (omit channel to disable).')
        .addChannelOption(o => o.setName('channel').setDescription('Text channel (omit to turn off)')),
    new SlashCommandBuilder().setName('set_faction_victory_role').setDescription('Role given to enrolled winners when a faction challenge ends (omit role to disable).')
        .addRoleOption(o => o.setName('role').setDescription('Role to grant')),
    new SlashCommandBuilder().setName('set_faction_leader_role').setDescription('Role that can manage faction challenges without full Bot Manager (omit role to clear).')
        .addRoleOption(o => o.setName('role').setDescription('Faction Leader role (omit to clear)')),
    new SlashCommandBuilder().setName('set_faction_challenge_defaults').setDescription('Defaults when /faction_challenge create omits game/scoring/top_n (Administrator or Bot Manager).')
        .addBooleanOption(o => o.setName('clear').setDescription('Reset to built-in: all games, top-5 average, top_n=5'))
        .addStringOption(o => o.setName('game_type').setDescription('Default game filter for new wars')
            .addChoices(
                { name: 'All tagged mini-games', value: 'all' },
                { name: 'Trivia', value: 'trivia' },
                { name: 'Trivia Sprint', value: 'triviasprint' },
                { name: 'Serverdle', value: 'serverdle' },
                { name: 'Guess the Number', value: 'guessthenumber' },
                { name: 'TV & Movie Quotes', value: 'moviequotes' },
                { name: 'Unscramble', value: 'unscramble' },
                { name: 'Caption', value: 'caption' },
                { name: 'Name That Tune', value: 'namethattune' },
                { name: 'Spelling Bee', value: 'spellingbee' },
                ...FACTION_PLATFORM_GAME_CHOICES,
            ))
        .addStringOption(o => o.setName('scoring_mode').setDescription('Default scoring for new wars')
            .addChoices(
                { name: 'Total points (enrolled)', value: 'total_points' },
                { name: 'Average (>0 pts only)', value: 'avg_points' },
                { name: 'Top N average', value: 'top_n_avg' },
            ))
        .addIntegerOption(o => o.setName('top_n').setDescription('Default top N for top_n_avg mode').setMinValue(1).setMaxValue(50)),
    new SlashCommandBuilder().setName('set_faction_ranked_rules').setDescription('Defaults for official ranked wars: roster cap & per-tag score caps (Administrator or Bot Manager).')
        .addBooleanOption(o => o.setName('clear').setDescription('Clear server ranked defaults (roster + caps)'))
        .addIntegerOption(o => o.setName('default_roster_cap').setDescription('When ranked create omits max_per_team (1–25)').setMinValue(1).setMaxValue(25))
        .addStringOption(o => o.setName('contribution_caps').setDescription('Counted cap per tag, e.g. trivia:500,unscramble:200')),
    new SlashCommandBuilder().setName('set_story_channel').setDescription('Channel for the One-Word Story game.').addChannelOption(o => o.setName('channel').setDescription('Channel to use')),
    new SlashCommandBuilder().setName('set_member_log_channel').setDescription('Channel for member join/leave log (omit channel to disable).').addChannelOption(o => o.setName('channel').setDescription('Text channel (omit to turn off)')),
    new SlashCommandBuilder().setName('set_manager_role').setDescription('Designate a role that can use bot manager commands.').addRoleOption(o => o.setName('role').setDescription('Role to allow')),
    new SlashCommandBuilder().setName('set_auto_role').setDescription('Set a role to automatically assign to all new members.').addRoleOption(o => o.setName('role').setDescription('Role to assign').setRequired(true)),
    new SlashCommandBuilder().setName('remove_auto_role').setDescription('Disable the auto-role feature.'),
    new SlashCommandBuilder().setName('sync_auto_role').setDescription('Backfill the auto-role to all existing members who don\'t have it.'),
    new SlashCommandBuilder().setName('strip_role').setDescription('Remove a role from all members in the server.').addRoleOption(o => o.setName('role').setDescription('Role to remove from everyone').setRequired(true)),
    new SlashCommandBuilder().setName('schedule_announcement').setDescription('Schedule a message to be sent later.')
        .addStringOption(o => o.setName('message').setDescription('The message to announce').setRequired(true))
        .addIntegerOption(o => o.setName('delay_hrs').setDescription(HOST_DELAY_HRS_OPT_DESC))
        .addIntegerOption(o => o.setName('delay_days').setDescription(HOST_DELAY_DAYS_OPT_DESC))
        .addChannelOption(o => o.setName('channel').setDescription('Channel to send to (default: current)')),
    new SlashCommandBuilder().setName('moviequotes').setDescription('Guess the movie or TV show from the quote!')
        .addIntegerOption(o => o.setName('rounds').setDescription('Number of rounds (max 25; Premium host: up to 50)').setRequired(true))
        .addIntegerOption(o => o.setName('round_seconds').setDescription('Seconds per round before reveal (default 90). Use 0 for no time limit.'))
        .addIntegerOption(o =>
            o
                .setName('session_minutes')
                .setDescription('Optional: end whole game after this many minutes (1–1440), even if rounds remain.')
                .setMinValue(1)
                .setMaxValue(1440),
        )
        .addStringOption(o => o.setName('points').setDescription(POINTS_OPT_DESC))
        .addStringOption(o => o.setName('thread_name').setDescription(THREAD_NAME_OPT_DESC))
        .addIntegerOption(o => o.setName('delay_hrs').setDescription(HOST_DELAY_HRS_OPT_DESC))
        .addIntegerOption(o => o.setName('delay_days').setDescription(HOST_DELAY_DAYS_OPT_DESC))
        .addIntegerOption(o => o.setName('repeat_hrs').setDescription(HOST_REPEAT_HRS_OPT_DESC).setMinValue(0).setMaxValue(168))
        .addIntegerOption(o => o.setName('repeat_days').setDescription(HOST_REPEAT_DAYS_OPT_DESC).setMinValue(0).setMaxValue(30)),
    new SlashCommandBuilder().setName('set_birthday').setDescription('Set birthday (MM-DD).').addStringOption(o => o.setName('date').setDescription('Your birthday (MM-DD)').setRequired(true)).addBooleanOption(o => o.setName('force').setDescription('Force override if already set').setRequired(false)),
    new SlashCommandBuilder().setName('endgame').setDescription('Force end active game.')
        .addStringOption(o => o.setName('thread_id').setDescription('Thread ID of the game to end from DB (optional)').setAutocomplete(true)),
    new SlashCommandBuilder().setName('listgames').setDescription('List all active games in the DB (Admin only).'),
    new SlashCommandBuilder().setName('support').setDescription('Get an invite to our support server.'),
    new SlashCommandBuilder().setName('invite').setDescription('Bot invite link, referral code, and reward summary.'),
    new SlashCommandBuilder().setName('invites').setDescription('Your referral stats: successful invites, pending, points earned.'),
    new SlashCommandBuilder()
        .setName('claim_referral')
        .setDescription('Link this server to a referrer using their code (Administrator).')
        .addStringOption((o) =>
            o.setName('code').setDescription('Code from the referrer’s /invite (e.g. PBXXXXXXXX)').setRequired(true),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName('faction_recruit').setDescription('Share a code to recruit players into your current faction.'),
    new SlashCommandBuilder()
        .setName('faction_redeem')
        .setDescription('After joining the recruiter’s faction, redeem their code (same server).')
        .addStringOption((o) => o.setName('code').setDescription('Code from /faction_recruit').setRequired(true)),
    new SlashCommandBuilder().setName('invite_leaderboard').setDescription('Global leaderboard: top server referrers.'),
    new SlashCommandBuilder()
        .setName('story_export')
        .setDescription('Export story as one paragraph, clear channel, and restart.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName('premium').setDescription('Learn about PlayBound Premium and get a subscription link.'),
    new SlashCommandBuilder().setName('giveaway').setDescription('Start giveaway.')
        .addIntegerOption(o => o.setName('duration').setDescription(HOST_GIVEAWAY_DURATION_MINUTES_DESC).setRequired(true))
        .addIntegerOption(o => o.setName('winners').setDescription('Number of winners')) 
        .addStringOption(o => o.setName('thread_name').setDescription(THREAD_NAME_OPT_DESC))
        .addUserOption(o => o.setName('ignore_user').setDescription('Also ignore this member (optional; stacks with list below)'))
        .addRoleOption(o => o.setName('ignore_role').setDescription('Also ignore members with this role (optional)'))
        .addStringOption(o => o.setName('ignored_users').setDescription('Extra user IDs/mentions to ignore (comma-separated)'))
        .addStringOption(o => o.setName('ignored_roles').setDescription('Extra role IDs/mentions to ignore (comma-separated)'))
        .addIntegerOption(o => o.setName('cooldown_days').setDescription('Days since last win to be eligible'))
        .addIntegerOption(o => o.setName('delay_hrs').setDescription(HOST_DELAY_HRS_OPT_DESC))
        .addIntegerOption(o => o.setName('delay_days').setDescription(HOST_DELAY_DAYS_OPT_DESC))
        .addStringOption(o => o.setName('points').setDescription(POINTS_OPT_DESC))
        .addIntegerOption(o => o.setName('repeat_hrs').setDescription(HOST_REPEAT_HRS_OPT_DESC).setMinValue(0).setMaxValue(168))
        .addIntegerOption(o => o.setName('repeat_days').setDescription(HOST_REPEAT_DAYS_OPT_DESC).setMinValue(0).setMaxValue(30)), 
    new SlashCommandBuilder().setName('guessthenumber').setDescription('Guess the number game.')
        .addIntegerOption(o => o.setName('min').setDescription('Minimum whole number').setRequired(true))
        .addIntegerOption(o => o.setName('max').setDescription('Maximum whole number').setRequired(true))
        .addStringOption(o => o.setName('win_rule').setDescription('How to pick the winner')
            .addChoices(
                { name: 'Closest (over or under)', value: 'closest' },
                { name: 'Closest without going over', value: 'without_over' },
            ))
        .addStringOption(o => o.setName('thread_name').setDescription(THREAD_NAME_OPT_DESC))
        .addIntegerOption(o => o.setName('duration').setDescription(HOST_GUESS_NUMBER_DURATION_DESC))
        .addStringOption(o => o.setName('points').setDescription('Winner points (default 25). Everyone who guessed gets +1 participation.'))
        .addIntegerOption(o => o.setName('delay_hrs').setDescription(HOST_DELAY_HRS_OPT_DESC))
        .addIntegerOption(o => o.setName('delay_days').setDescription(HOST_DELAY_DAYS_OPT_DESC)),
    new SlashCommandBuilder().setName('set_member_game_hosts').setDescription('Let any member start game commands (not only Manager/Admin).')
        .addBooleanOption(o => o.setName('enabled').setDescription('On = anyone can host listed games').setRequired(true)), 
    new SlashCommandBuilder().setName('startserverdle').setDescription('Timed Wordle Replica.')
        .addIntegerOption(o => o.setName('duration').setDescription(HOST_GAME_DURATION_MINUTES_DESC))
        .addStringOption(o => o.setName('custom_word').setDescription('Specific word to use (otherwise will use a default)')) 
        .addStringOption(o => o.setName('thread_name').setDescription(THREAD_NAME_OPT_DESC))
        .addStringOption(o => o.setName('points').setDescription(POINTS_OPT_DESC))
        .addIntegerOption(o => o.setName('delay_hrs').setDescription(HOST_DELAY_HRS_OPT_DESC))
        .addIntegerOption(o => o.setName('delay_days').setDescription(HOST_DELAY_DAYS_OPT_DESC))
        .addIntegerOption(o => o.setName('repeat_hrs').setDescription(HOST_REPEAT_HRS_OPT_DESC).setMinValue(0).setMaxValue(168))
        .addIntegerOption(o => o.setName('repeat_days').setDescription(HOST_REPEAT_DAYS_OPT_DESC).setMinValue(0).setMaxValue(30)), 
    new SlashCommandBuilder().setName('trivia').setDescription('Live match.')
        .addIntegerOption(o => o.setName('questions').setDescription('Number of questions (default 5; max 25, Premium host up to 40)'))
        .addIntegerOption(o =>
            o
                .setName('question_seconds')
                .setDescription('Seconds to answer each question (default 30; 10–900).')
                .setMinValue(10)
                .setMaxValue(900),
        )
        .addIntegerOption(o =>
            o
                .setName('break_seconds')
                .setDescription('Pause after each question before the next (default 20; 0–300).')
                .setMinValue(0)
                .setMaxValue(300),
        )
        .addStringOption(o => o.setName('thread_name').setDescription(THREAD_NAME_OPT_DESC))
        .addStringOption(o => o.setName('points').setDescription(POINTS_OPT_DESC))
        .addStringOption(o => o.setName('difficulty').setDescription('Choose difficulty').addChoices({name:'Easy',value:'easy'},{name:'Med',value:'medium'},{name:'Hard',value:'hard'}))
        .addStringOption(o => o.setName('category').setDescription('Choose a category').addChoices({name:'Any',value:'any'},{name:'General',value:'9'},{name:'Film',value:'11'},{name:'Music',value:'12'},{name:'Video Games',value:'15'},{name:'Science',value:'17'},{name:'Computers',value:'18'},{name:'Sports',value:'21'},{name:'History',value:'23'}))
        .addIntegerOption(o => o.setName('delay_hrs').setDescription(HOST_DELAY_HRS_OPT_DESC))
        .addIntegerOption(o => o.setName('delay_days').setDescription(HOST_DELAY_DAYS_OPT_DESC))
        .addIntegerOption(o => o.setName('slow_mode').setDescription('Slow mode in seconds (e.g. 5)'))
        .addIntegerOption(o => o.setName('repeat_hrs').setDescription(HOST_REPEAT_HRS_OPT_DESC).setMinValue(0).setMaxValue(168))
        .addIntegerOption(o => o.setName('repeat_days').setDescription(HOST_REPEAT_DAYS_OPT_DESC).setMinValue(0).setMaxValue(30)),
    new SlashCommandBuilder().setName('triviasprint').setDescription('Speedrun.')
        .addIntegerOption(o => o.setName('duration').setDescription(HOST_GAME_DURATION_MINUTES_DESC).setRequired(true))
        .addIntegerOption(o => o.setName('questions').setDescription('Number of questions (default 15; max 50, Premium host up to 80)'))
        .addStringOption(o => o.setName('thread_name').setDescription(THREAD_NAME_OPT_DESC))
        .addStringOption(o => o.setName('points').setDescription(POINTS_OPT_DESC))
        .addStringOption(o => o.setName('difficulty').setDescription('Choose difficulty').addChoices({name:'Easy',value:'easy'},{name:'Med',value:'medium'},{name:'Hard',value:'hard'}))
        .addStringOption(o => o.setName('category').setDescription('Choose a category').addChoices({name:'Any',value:'any'},{name:'General',value:'9'},{name:'Film',value:'11'},{name:'Music',value:'12'},{name:'Video Games',value:'15'},{name:'Science',value:'17'},{name:'Computers',value:'18'},{name:'Sports',value:'21'},{name:'History',value:'23'}))
        .addIntegerOption(o => o.setName('delay_hrs').setDescription(HOST_DELAY_HRS_OPT_DESC))
        .addIntegerOption(o => o.setName('delay_days').setDescription(HOST_DELAY_DAYS_OPT_DESC))
        .addIntegerOption(o => o.setName('repeat_hrs').setDescription(HOST_REPEAT_HRS_OPT_DESC).setMinValue(0).setMaxValue(168))
        .addIntegerOption(o => o.setName('repeat_days').setDescription(HOST_REPEAT_DAYS_OPT_DESC).setMinValue(0).setMaxValue(30)),
    new SlashCommandBuilder().setName('namethattune').setDescription('Guess the song from an iTunes preview in voice!')
        .addIntegerOption(o => o.setName('rounds').setDescription('Number of rounds').setRequired(true))
        .addIntegerOption(o =>
            o
                .setName('guess_seconds')
                .setDescription('Seconds per round to type the title after the clip (default 30; 5–600).')
                .setRequired(true)
                .setMinValue(5)
                .setMaxValue(600),
        )
        .addStringOption(o => o.setName('genre').setDescription('Choose a music genre').addChoices(
            { name: 'All Genres / Mix', value: 'mix' },
            { name: 'Pop', value: 'pop' },
            { name: 'Rock', value: 'rock' },
            { name: 'Hip-Hop', value: 'hiphop' },
            { name: '80s', value: '80s' },
            { name: 'Disney', value: 'disney' },
            { name: 'Country', value: 'country' },
            { name: 'Classical', value: 'classical' }
        ))
        .addStringOption(o => o.setName('query').setDescription('Custom search (e.g. "Taylor Swift" or "Video Game Music")'))
        .addStringOption(o => o.setName('thread_name').setDescription(THREAD_NAME_OPT_DESC))
        .addStringOption(o => o.setName('points').setDescription(POINTS_OPT_DESC))
        .addIntegerOption(o => o.setName('delay_hrs').setDescription(HOST_DELAY_HRS_OPT_DESC))
        .addIntegerOption(o => o.setName('delay_days').setDescription(HOST_DELAY_DAYS_OPT_DESC)),
    new SlashCommandBuilder().setName('spellingbee').setDescription('Bot speaks words in VC (espeak-ng); type spellings in the thread.')
        .addIntegerOption(o => o.setName('rounds').setDescription('How many words (see host caps)').setRequired(true))
        .addIntegerOption(o =>
            o
                .setName('answer_seconds')
                .setDescription('Seconds to type after audio (default 45; 10–600).')
                .setMinValue(10)
                .setMaxValue(600),
        )
        .addIntegerOption(o =>
            o
                .setName('repeat_word_seconds')
                .setDescription('Re-speak the word in VC every N sec while the round is open (0 = once; default 10).')
                .setMinValue(0)
                .setMaxValue(120),
        )
        .addStringOption(o => o.setName('thread_name').setDescription(THREAD_NAME_OPT_DESC))
        .addStringOption(o => o.setName('points').setDescription(POINTS_OPT_DESC))
        .addIntegerOption(o => o.setName('delay_hrs').setDescription(HOST_DELAY_HRS_OPT_DESC))
        .addIntegerOption(o => o.setName('delay_days').setDescription(HOST_DELAY_DAYS_OPT_DESC))
        .addIntegerOption(o => o.setName('repeat_hrs').setDescription(HOST_REPEAT_HRS_OPT_DESC).setMinValue(0).setMaxValue(168))
        .addIntegerOption(o => o.setName('repeat_days').setDescription(HOST_REPEAT_DAYS_OPT_DESC).setMinValue(0).setMaxValue(30)),
    new SlashCommandBuilder().setName('caption').setDescription('Caption contest.')
        .addIntegerOption(o => o.setName('duration').setDescription(HOST_GAME_DURATION_MINUTES_DESC).setRequired(true))
        .addStringOption(o => o.setName('thread_name').setDescription(THREAD_NAME_OPT_DESC))
        .addIntegerOption(o => o.setName('delay_hrs').setDescription(HOST_DELAY_HRS_OPT_DESC))
        .addIntegerOption(o => o.setName('delay_days').setDescription(HOST_DELAY_DAYS_OPT_DESC))
        .addStringOption(o => o.setName('points').setDescription(POINTS_OPT_DESC))
        .addIntegerOption(o => o.setName('repeat_hrs').setDescription(HOST_REPEAT_HRS_OPT_DESC).setMinValue(0).setMaxValue(168))
        .addIntegerOption(o => o.setName('repeat_days').setDescription(HOST_REPEAT_DAYS_OPT_DESC).setMinValue(0).setMaxValue(30)),
    new SlashCommandBuilder().setName('unscramble').setDescription('Unscramble phrases to win.')
        .addIntegerOption(o => o.setName('rounds').setDescription('Number of rounds (max 25; Premium host: up to 50)').setRequired(true))
        .addIntegerOption(o =>
            o
                .setName('duration_minutes')
                .setDescription('Minutes for players to finish (default rounds+1). Max 1440.')
                .setMinValue(1)
                .setMaxValue(1440),
        )
        .addStringOption(o => o.setName('thread_name').setDescription(THREAD_NAME_OPT_DESC))
        .addStringOption(o => o.setName('points').setDescription(POINTS_OPT_DESC))
        .addIntegerOption(o => o.setName('delay_hrs').setDescription(HOST_DELAY_HRS_OPT_DESC))
        .addIntegerOption(o => o.setName('delay_days').setDescription(HOST_DELAY_DAYS_OPT_DESC))
        .addIntegerOption(o => o.setName('repeat_hrs').setDescription(HOST_REPEAT_HRS_OPT_DESC).setMinValue(0).setMaxValue(168))
        .addIntegerOption(o => o.setName('repeat_days').setDescription(HOST_REPEAT_DAYS_OPT_DESC).setMinValue(0).setMaxValue(30)),
    new SlashCommandBuilder().setName('faction').setDescription('Global factions: join, leave, switch (Premium), server ranks, or stats.')
        .addSubcommand(sc => sc.setName('join').setDescription('Join a faction (see /factions).')
            .addStringOption(o => o.setName('name').setDescription('Faction name (exact spelling)').setRequired(true).setAutocomplete(true)))
        .addSubcommand(sc => sc.setName('leave').setDescription('Leave your faction. Use /faction_challenge join again after rejoining a team.'))
        .addSubcommand(sc => sc.setName('switch').setDescription('Premium: change factions (7-day cooldown). Clears faction challenge enrollment.')
            .addStringOption(o => o.setName('name').setDescription('Faction to switch to').setRequired(true).setAutocomplete(true)))
        .addSubcommand(sc => sc.setName('stats').setDescription('Your faction’s global stats. Premium: match-point board context.'))
        .addSubcommand(sc => sc.setName('server').setDescription('Server Arena activity by faction. Premium: your rank on your faction here.')),
    new SlashCommandBuilder().setName('faction_role_link').setDescription('Link a Discord role to a global faction (Administrator or Bot Manager).')
        .addStringOption(o => o.setName('faction').setDescription('Which faction').setRequired(true).addChoices(...FACTION_SLASH_CHOICES))
        .addRoleOption(o => o.setName('role').setDescription('Role to assign on join/switch').setRequired(true)),
    new SlashCommandBuilder().setName('faction_rename').setDescription('Server faction display name only — global faction unchanged (Administrator or Bot Manager).')
        .addStringOption(o => o.setName('faction').setDescription('Which faction').setRequired(true).addChoices(...FACTION_SLASH_CHOICES))
        .addStringOption(o => o.setName('name').setDescription('Server display name (shown as “Custom (Official)” in this server)').setRequired(true).setMaxLength(80)),
    new SlashCommandBuilder().setName('faction_emoji').setDescription('Server faction display emoji only — global unchanged (Administrator or Bot Manager).')
        .addStringOption(o => o.setName('faction').setDescription('Which faction').setRequired(true).addChoices(...FACTION_SLASH_CHOICES))
        .addStringOption(o => o.setName('emoji').setDescription('Unicode or <:custom:id> from this server; omit when using clear'))
        .addBooleanOption(o => o.setName('clear').setDescription('Remove custom emoji (show global default again)')),
    new SlashCommandBuilder().setName('faction_balance').setDescription('Members per faction in this server. Premium: local % split.'),
    new SlashCommandBuilder().setName('factions').setDescription('Official Faction Rankings (ranked wars). Premium: extra context for your faction.'),
    new SlashCommandBuilder().setName('season').setDescription('Quarterly faction season (UTC). Premium: your faction’s quarterly placement.'),
    (() => {
        const b = new SlashCommandBuilder()
            .setName('playgame')
            .setDescription('Platform mini-game (UTC daily rotation; autocomplete lists today’s pool).')
            .addStringOption((o) =>
                o
                    .setName('game')
                    .setDescription('Autocomplete = today’s rotation (UTC). Dev deploy: can widen the pool.')
                    .setRequired(true)
                    .setAutocomplete(true),
            );
        if (INCLUDE_DEV_PLAYGAME_EXTRAS) {
            b.addBooleanOption((o) =>
                o
                    .setName('ignore_rotation')
                    .setDescription('Dev-only: false = today’s pool; true/omit = any enabled game'),
            );
        }
        return b.addStringOption((o) => o.setName('thread_name').setDescription(THREAD_NAME_OPT_DESC));
    })(),
    new SlashCommandBuilder().setName('faction_challenge').setDescription('Premium: official ranked faction wars (global match points).')
        .addSubcommand(sc => sc.setName('create').setDescription('Start a duel (Premium + Admin/Manager/Faction Leader). Max 3 wars/server/UTC day; ≤8h.')
            .addIntegerOption(o => o.setName('duration_hours').setDescription('War length in hours (max 8)').setRequired(true).setMinValue(1).setMaxValue(8))
            .addStringOption(o => o.setName('faction_a').setDescription('First faction (omit both for auto rotation)').setRequired(false).addChoices(...FACTION_SLASH_CHOICES))
            .addStringOption(o => o.setName('faction_b').setDescription('Opponent faction (omit both for auto rotation)').setRequired(false).addChoices(...FACTION_SLASH_CHOICES))
            .addStringOption(o => o.setName('game_type').setDescription('Which games count toward this war')
                .addChoices(
                    { name: 'All tagged mini-games', value: 'all' },
                    { name: 'Trivia', value: 'trivia' },
                    { name: 'Trivia Sprint', value: 'triviasprint' },
                    { name: 'Serverdle', value: 'serverdle' },
                    { name: 'Guess the Number', value: 'guessthenumber' },
                    { name: 'TV & Movie Quotes', value: 'moviequotes' },
                    { name: 'Unscramble', value: 'unscramble' },
                    { name: 'Caption', value: 'caption' },
                    { name: 'Name That Tune', value: 'namethattune' },
                    { name: 'Spelling Bee', value: 'spellingbee' },
                    ...FACTION_PLATFORM_GAME_CHOICES,
                ))
            .addIntegerOption(o => o.setName('max_per_team').setDescription('Roster cap per side (default from server ranked rules or 7)').setMinValue(1).setMaxValue(25))
            .addStringOption(o => o.setName('contribution_caps').setDescription('Optional per-tag score ceiling (ranked), e.g. trivia:800 — stops one minigame from dominating')))
        .addSubcommand(sc => sc.setName('create_royale').setDescription('All-factions royale (same rules as duel). Max 3 wars/server/UTC day; ≤8h.')
            .addIntegerOption(o => o.setName('duration_hours').setDescription('War length in hours (max 8)').setRequired(true).setMinValue(1).setMaxValue(8))
            .addStringOption(o => o.setName('game_type').setDescription('Which games count toward this war')
                .addChoices(
                    { name: 'All tagged mini-games', value: 'all' },
                    { name: 'Trivia', value: 'trivia' },
                    { name: 'Trivia Sprint', value: 'triviasprint' },
                    { name: 'Serverdle', value: 'serverdle' },
                    { name: 'Guess the Number', value: 'guessthenumber' },
                    { name: 'TV & Movie Quotes', value: 'moviequotes' },
                    { name: 'Unscramble', value: 'unscramble' },
                    { name: 'Caption', value: 'caption' },
                    { name: 'Name That Tune', value: 'namethattune' },
                    { name: 'Spelling Bee', value: 'spellingbee' },
                    ...FACTION_PLATFORM_GAME_CHOICES,
                ))
            .addIntegerOption(o => o.setName('max_per_team').setDescription('Roster cap per faction (default from server ranked rules or 7)').setMinValue(1).setMaxValue(25))
            .addStringOption(o => o.setName('contribution_caps').setDescription('Optional per-tag score ceiling (ranked), e.g. trivia:800')))
        .addSubcommand(sc => sc.setName('join').setDescription('Enroll to score for your faction in the active challenge'))
        .addSubcommand(sc => sc.setName('status').setDescription('View scores for the active challenge'))
        .addSubcommand(sc => sc.setName('history').setDescription('Past ended challenges in this server (newest first). Premium: up to 25.')
            .addIntegerOption(o => o.setName('limit').setDescription('How many (default 10; Premium up to 25)').setMinValue(1).setMaxValue(25)))
        .addSubcommand(sc => sc.setName('end').setDescription('End the active challenge now (Premium + Admin/Manager/Faction Leader).')),
    new SlashCommandBuilder().setName('add_redirect').setDescription('Add an auto-reply word redirect.')
        .addStringOption(o => o.setName('words').setDescription('Comma-separated list of trigger words').setRequired(true))
        .addChannelOption(o => o.setName('channel').setDescription('The channel to redirect to'))
        .addStringOption(o => o.setName('link').setDescription('A specific message link or thread link to redirect to'))
        .addStringOption(o => o.setName('message').setDescription('Custom message to show (optional)')),
    new SlashCommandBuilder().setName('remove_redirect').setDescription('Remove an auto-reply word redirect.')
        .addStringOption(o => o.setName('words').setDescription('The comma-separated trigger words to remove').setRequired(true).setAutocomplete(true)),
    new SlashCommandBuilder().setName('wipe_leaderboard').setDescription('Reset Credits, cadence counters & Arena score for this server.'),
    new SlashCommandBuilder().setName('adjustpoints').setDescription('Adjust Credits only; Arena score & faction boards stay the same.')
        .addUserOption(o => o.setName('user').setDescription('Member whose Credits balance to change').setRequired(true))
        .addIntegerOption(o => o.setName('points').setDescription('Credits to add/remove (non-zero, max abs 5000)').setRequired(true).setMinValue(-5000).setMaxValue(5000))
        .addStringOption(o => o.setName('reason').setDescription('Required reason (5-180 chars)').setRequired(true).setMinLength(5).setMaxLength(180)),
    new SlashCommandBuilder().setName('shop').setDescription('Browse the Credit shop (ephemeral).'),
    new SlashCommandBuilder().setName('buy').setDescription('Buy from the shop (shows balance + menus).').addStringOption(o => o.setName('item').setDescription('Item ID (optional; omit for full list & dropdowns)').setAutocomplete(true)),
    new SlashCommandBuilder().setName('inventory').setDescription('View your items.'),
    new SlashCommandBuilder().setName('equip').setDescription('Equip a cosmetic item (Badge or Color) from your inventory.').addStringOption(o => o.setName('item').setDescription('Item ID to equip').setRequired(true).setAutocomplete(true)),
    new SlashCommandBuilder().setName('server_shop_add').setDescription('Server Pro: Add a custom role/badge to your server shop.')
        .addStringOption(o => o.setName('id').setDescription('Unique ID for the item (e.g. custom_vip)').setRequired(true))
        .addStringOption(o => o.setName('name').setDescription('Name of the item').setRequired(true))
        .addIntegerOption(o => o.setName('price').setDescription('Price in Credits').setRequired(true))
        .addStringOption(o => o.setName('desc').setDescription('Description of the item').setRequired(true))
        .addStringOption(o => o.setName('type').setDescription('Item type').addChoices({name:'Role',value:'role'},{name:'Badge',value:'badge'},{name:'Color',value:'color'}).setRequired(true))
        .addRoleOption(o => o.setName('role').setDescription('Role to grant (if type is Role)')),
    new SlashCommandBuilder().setName('server_shop_remove').setDescription('Server Pro: Remove a custom item from your server shop.')
        .addStringOption(o => o.setName('id').setDescription('ID of the item to remove').setRequired(true).setAutocomplete(true)),
    new SlashCommandBuilder().setName('daily').setDescription('Claim daily Credits (Premium: 12h cooldown).'),
    new SlashCommandBuilder().setName('pay').setDescription('Send Credits to another member.')
        .addUserOption(o => o.setName('user').setDescription('The user to pay').setRequired(true))
        .addIntegerOption(o => o.setName('amount').setDescription('Amount of Credits to send').setRequired(true)),
    new SlashCommandBuilder().setName('duel_trivia').setDescription('Challenge another user to a 1v1 trivia duel (one question, winner takes the pot).')
        .addUserOption(o => o.setName('user').setDescription('The user to challenge').setRequired(true))
        .addIntegerOption(o => o.setName('bet').setDescription('Credits each player stakes (winner takes pot)').setRequired(true)),
    new SlashCommandBuilder().setName('set_role_reward').setDescription('Set a role reward for an achievement (built-in or CUSTOM_*).')
        .addStringOption(o => o.setName('achievement').setDescription('Key: e.g. FIRST_WIN, TRIVIA_KING, or CUSTOM_BADGE').setRequired(true).setAutocomplete(true))
        .addRoleOption(o => o.setName('role').setDescription('Role to grant').setRequired(true)),
    new SlashCommandBuilder().setName('achievement').setDescription('Create and manage server-only achievements (Manager).')
        .addSubcommand(sc => sc.setName('create').setDescription('Define a custom achievement (key must be CUSTOM_*).')
            .addStringOption(o => o.setName('key').setDescription('e.g. CUSTOM_MVP_2026').setRequired(true))
            .addStringOption(o => o.setName('name').setDescription('Display title').setRequired(true))
            .addStringOption(o => o.setName('description').setDescription('Short description').setRequired(true))
            .addStringOption(o => o.setName('emoji').setDescription('Optional: Unicode emoji or <:name:id> from this server')))
        .addSubcommand(sc => sc.setName('delete').setDescription('Remove a custom achievement definition from this server.')
            .addStringOption(o => o.setName('key').setDescription('The CUSTOM_* key').setRequired(true).setAutocomplete(true)))
        .addSubcommand(sc => sc.setName('list').setDescription('List custom achievements defined for this server.'))
        .addSubcommand(sc => sc.setName('grant').setDescription('Award an achievement to a member (uses achievement channel if set).')
            .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true))
            .addStringOption(o => o.setName('key').setDescription('Built-in or CUSTOM_* key').setRequired(true).setAutocomplete(true)))
        .addSubcommand(sc => sc.setName('revoke').setDescription('Remove an achievement from a member.')
            .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true))
            .addStringOption(o => o.setName('key').setDescription('Achievement key').setRequired(true).setAutocomplete(true))),
    new SlashCommandBuilder().setName('tournament').setDescription('Start a Dice Roll Tournament bracket!')
        .addIntegerOption(o => o.setName('duration').setDescription('Registration duration in minutes (default: 5)').setRequired(false))
        .addIntegerOption(o => o.setName('entry_fee').setDescription('Credits to enter (0 = free)').setRequired(false))
        .addIntegerOption(o => o.setName('pot').setDescription('Extra Credits added to winner pot (default: 0)').setRequired(false))
        .addStringOption(o => o.setName('thread_name').setDescription(THREAD_NAME_OPT_DESC)),
    new SlashCommandBuilder().setName('ticket').setDescription('Open a private ticket in our support server.')
        .addStringOption(o => o.setName('type').setDescription('Type of ticket').addChoices(
            {name: '🐞 Bug Report', value: 'Bug'},
            {name: '💡 Suggestion', value: 'Suggestion'},
            {name: '🛠️ Support / Help', value: 'Support'},
            {name: '❓ General Question / Other', value: 'Other'}
        ).setRequired(true))
        .addStringOption(o => o.setName('reason').setDescription('Briefly describe your issue or idea').setRequired(true)),
    new SlashCommandBuilder()
        .setName('setup_panels')
        .setDescription('Post PlayBound navigation panels (support server; requires SUPPORT_PANEL_* env).')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addBooleanOption((o) =>
            o
                .setName('wipe_panel_channels')
                .setDescription('Start fresh by deleting history in the panel target channels before reposting'),
        ),
    new SlashCommandBuilder()
        .setName('bootstrap_support_server')
        .setDescription('Create the full PlayBound support server structure')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .setDMPermission(false)
        .addBooleanOption((o) => o.setName('dry_run').setDescription('Preview actions without making changes'))
        .addBooleanOption((o) => o.setName('force_repin').setDescription('Update or replace existing bot setup pins'))
        .addBooleanOption((o) =>
            o
                .setName('create_missing_only')
                .setDescription('Only fill gaps for topics; permissions always synced (default: true)'),
        )
        .addBooleanOption((o) =>
            o
                .setName('wipe_bootstrap_messages')
                .setDescription(
                    'Remove old bot setup messages (PLAYBOUND_SETUP_PIN marker) before repinning',
                ),
        )
        .addBooleanOption((o) =>
            o
                .setName('wipe_all_managed_channels')
                .setDescription(
                    'DANGEROUS: bulk-delete history in all bootstrap-managed text channels (Admin only)',
                ),
        )
        .addStringOption((o) =>
            o.setName('admin_role_name').setDescription('Admin role name (default: PlayBound Admin)').setMaxLength(100),
        )
        .addStringOption((o) =>
            o.setName('mod_role_name').setDescription('Moderator role name (default: PlayBound Moderator)').setMaxLength(100),
        ),
    new SlashCommandBuilder().setName('admin_premium').setDescription('DEVELOPER ONLY: Manually grant or revoke premium status.')
        .addUserOption(o => o.setName('user').setDescription('The user to manage').setRequired(true))
        .addStringOption(o => o.setName('action').setDescription('Grant or Revoke').addChoices({name:'Grant',value:'grant'},{name:'Revoke',value:'revoke'}).setRequired(true))
        .addStringOption(o => o.setName('source').setDescription('Source of premium').addChoices({name:'Stripe',value:'stripe'},{name:'Discord',value:'discord'})),
    new SlashCommandBuilder().setName('premium_analytics').setDescription('DEVELOPER ONLY: Premium upsell views & conversion stats by trigger.')
        .addIntegerOption(o => o.setName('days').setDescription('Lookback window in days (default 30)').setMinValue(1).setMaxValue(365))
        .addStringOption(o => o.setName('trigger').setDescription('Single trigger detail (omit for summary)')
            .addChoices(
                { name: 'game_end', value: 'game_end' },
                { name: 'daily', value: 'daily' },
                { name: 'game_start_host', value: 'game_start_host' },
                { name: 'streak', value: 'streak' },
                { name: 'session_boost_reminder', value: 'session_boost_reminder' },
                { name: 'premium_command', value: 'premium_command' },
                { name: 'other', value: 'other' },
            )),
    new SlashCommandBuilder().setName('broadcast').setDescription('DEVELOPER ONLY: Send a message to all announcement channels.')
        .addStringOption(o => o.setName('message').setDescription('Message to broadcast').setRequired(true)),
    new SlashCommandBuilder().setName('dev_points').setDescription('DEVELOPER: add or set Credits (this server only).')
        .addSubcommand(sc => sc.setName('add').setDescription('Add or subtract Credits for a user in this server.')
            .addIntegerOption(o => o.setName('amount').setDescription('Credits to add (negative subtracts)').setRequired(true))
            .addUserOption(o => o.setName('user').setDescription('Target member (default: you)')))
        .addSubcommand(sc => sc.setName('set').setDescription('Set exact Credits balance for a user in this server.')
            .addIntegerOption(o => o.setName('amount').setDescription('New Credits balance').setRequired(true).setMinValue(0))
            .addUserOption(o => o.setName('user').setDescription('Target member (default: you)'))),
    new SlashCommandBuilder().setName('blacklist').setDescription('ADMIN: Block a user from all bot interactions.')
        .addUserOption(o => o.setName('user').setDescription('The user to blacklist').setRequired(true))
        .addStringOption(o => o.setName('reason').setDescription('Reason for blacklisting').setRequired(true)),
    new SlashCommandBuilder().setName('unblacklist').setDescription('ADMIN: Unblock a previously blacklisted user.')
        .addUserOption(o => o.setName('user').setDescription('The user to unblacklist').setRequired(true))
].map(cmd => cmd.toJSON());

/** For tooling (e.g. `scripts/generate-slash-readme-tables.js`) without hitting Discord. */
module.exports = { commands };

if (require.main === module) {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

    (async () => {
        try {
            console.log('Started refreshing application (/) commands.');
            // This registers commands GLOBALLY for all servers
            await rest.put(
                Routes.applicationCommands(process.env.CLIENT_ID),
                { body: commands },
            );
            console.log('Successfully reloaded application (/) commands.');
        } catch (error) {
            console.error(error);
        }
    })();
}
