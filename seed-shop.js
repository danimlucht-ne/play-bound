require('dotenv').config();
const mongoose = require('mongoose');

/**
 * Global shop catalog. Run: node seed-shop.js
 * Badges (type badge) need leaderboardEmoji for leaderboard prefix; colors need profileColorHex for profile embed.
 *
 * **Pricing anchor (2026):** ~**50** Credits ≈ one **faction war participation** payout at end; **~150** max for
 * **#1 on faction** that war. Casual `/playgame` + hosted income is separate — prices here assume **weeks** of
 * mixed play for cosmetics, not a single lucky war.
 */
const SHOP_ITEMS = [
    // --- Consumables (strong items ≈ many war participations + dailies) ---
    { id: 'hint_trivia', name: 'Trivia Hint', price: 265, desc: 'Unlock a hint for your next trivia question.', type: 'consumable', premiumOnly: false },
    { id: 'hint_movie_quotes', name: 'Movie Quote Hint', price: 310, desc: 'In an active TV & Movie Quotes game thread, type !moviehint once to reveal a letter (consumes item).', type: 'consumable', premiumOnly: false },
    { id: 'extra_guess_wordle', name: 'Wordle Extra Guess', price: 465, desc: 'Get one extra guess in Serverdle.', type: 'consumable', premiumOnly: false },
    { id: 'streak_shield', name: 'Streak Shield', price: 1680, desc: 'Protects your daily streak if you miss a day.', type: 'consumable', premiumOnly: false },
    { id: 'double_points', name: 'Double Points Pass', price: 1540, desc: 'Doubles points earned in your next game.', type: 'consumable', premiumOnly: false },
    { id: 'trivia_skip', name: 'Trivia Skip', price: 385, desc: 'Skip one question in Trivia Sprint.', type: 'consumable', premiumOnly: false },
    { id: 'mystery_box', name: 'Mystery Box', price: 820, desc: 'A surprise: bonus points or a small reward—open from your inventory in a future update!', type: 'consumable', premiumOnly: false },

    { id: 'booster_small', name: 'Point Booster (S)', price: 620, desc: 'Flavor item—shows you support the shop. (Cosmetic stash)', type: 'consumable', premiumOnly: false },
    { id: 'booster_party', name: 'Party Popper', price: 495, desc: 'Celebrate a win—purely for fun in your inventory.', type: 'consumable', premiumOnly: false },
    { id: 'fortune_cookie', name: 'Fortune Cookie', price: 225, desc: 'Crunchy luck. Collect them!', type: 'consumable', premiumOnly: false },
    { id: 'ticket_raffle', name: 'Raffle Ticket', price: 355, desc: 'Hold onto it for future server events.', type: 'consumable', premiumOnly: false },
    { id: 'token_silver', name: 'Silver Token', price: 1580, desc: 'Trade flair—stackable collectible.', type: 'consumable', premiumOnly: false },
    { id: 'token_gold', name: 'Gold Token', price: 8900, desc: 'A rarer token for dedicated grinders.', type: 'consumable', premiumOnly: false },

    // --- Faction & /playgame flavor (stash / collectibles; no extra mechanics yet) ---
    { id: 'war_merit_scroll', name: 'War Merit Scroll', price: 980, desc: 'Collectible stash item — show you save Credits for faction seasons & wars.', type: 'consumable', premiumOnly: false },
    { id: 'rotation_fan_pin', name: 'Rotation Fan Pin', price: 750, desc: 'Collectible — you follow the daily `/playgame` rotation.', type: 'consumable', premiumOnly: false },
    { id: 'playgame_favor_charm', name: 'PlayBound Mini Charm', price: 1350, desc: 'Collectible — official minis & `/playgame` grind respect.', type: 'consumable', premiumOnly: false },

    // --- Premium exclusives (existing) ---
    { id: 'premium_badge_diamond', name: 'Diamond Badge', price: 0, desc: 'Exclusive diamond badge for Premium subscribers.', type: 'badge', premiumOnly: true, leaderboardEmoji: '💎' },
    { id: 'premium_color_crystal', name: 'Crystal Name Color', price: 21800, desc: 'Crystal blue name accent on your profile embed.', type: 'color', premiumOnly: true, profileColorHex: '#AEEEEE' },

    // --- Badges (equip one; leaderboardEmoji used on boards) ---
    { id: 'badge_star', name: 'V.I.P. Star', price: 4600, desc: 'Classic star flair next to your name on leaderboards.', type: 'badge', premiumOnly: false, leaderboardEmoji: '⭐' },
    { id: 'badge_crown', name: 'Royal Crown', price: 10200, desc: 'Rule the leaderboard in style. (Premium only)', type: 'badge', premiumOnly: true, leaderboardEmoji: '👑' },
    { id: 'badge_fire', name: 'On Fire', price: 8800, desc: 'For unstoppable streaks. (Premium only)', type: 'badge', premiumOnly: true, leaderboardEmoji: '🔥' },
    { id: 'badge_lightning', name: 'Speedster', price: 8200, desc: 'Fast answers, fast climbs. (Premium only)', type: 'badge', premiumOnly: true, leaderboardEmoji: '⚡' },
    { id: 'badge_trophy', name: 'Champion Cup', price: 11800, desc: 'Winner energy. (Premium only)', type: 'badge', premiumOnly: true, leaderboardEmoji: '🏆' },
    { id: 'badge_medal', name: 'Podium Medal', price: 4400, desc: 'Top-three vibes.', type: 'badge', premiumOnly: false, leaderboardEmoji: '🥇' },
    { id: 'badge_shield', name: 'Guardian', price: 7800, desc: 'Protect the squad. (Premium only)', type: 'badge', premiumOnly: true, leaderboardEmoji: '🛡️' },
    { id: 'badge_sword', name: 'Duelist', price: 8600, desc: 'For trivia duel legends. (Premium only)', type: 'badge', premiumOnly: true, leaderboardEmoji: '⚔️' },
    { id: 'badge_moon', name: 'Night Owl', price: 4200, desc: 'Late-night grinder.', type: 'badge', premiumOnly: false, leaderboardEmoji: '🌙' },
    { id: 'badge_sun', name: 'Early Bird', price: 4200, desc: 'First in the server.', type: 'badge', premiumOnly: false, leaderboardEmoji: '☀️' },
    { id: 'badge_rainbow', name: 'Spectrum', price: 9800, desc: 'All-around player. (Premium only)', type: 'badge', premiumOnly: true, leaderboardEmoji: '🌈' },
    { id: 'badge_rocket', name: 'Moonshot', price: 9200, desc: 'Points to the moon. (Premium only)', type: 'badge', premiumOnly: true, leaderboardEmoji: '🚀' },
    { id: 'badge_clover', name: 'Lucky Clover', price: 4000, desc: 'RNG blessed.', type: 'badge', premiumOnly: false, leaderboardEmoji: '🍀' },
    { id: 'badge_dice', name: 'High Roller', price: 5000, desc: 'Tournament and giveaway vibes.', type: 'badge', premiumOnly: false, leaderboardEmoji: '🎲' },
    { id: 'badge_music', name: 'Maestro Note', price: 5400, desc: 'Name That Tune regular.', type: 'badge', premiumOnly: false, leaderboardEmoji: '🎵' },
    { id: 'badge_film', name: 'Movie Buff', price: 5400, desc: 'TV & Movie Quotes champion.', type: 'badge', premiumOnly: false, leaderboardEmoji: '🎬' },
    { id: 'badge_paint', name: 'Artist', price: 5000, desc: 'Caption contest creative.', type: 'badge', premiumOnly: false, leaderboardEmoji: '🎨' },
    { id: 'badge_book', name: 'Scholar', price: 4800, desc: 'Trivia scholar.', type: 'badge', premiumOnly: false, leaderboardEmoji: '📚' },
    { id: 'badge_globe', name: 'World Traveler', price: 9200, desc: 'Global factions warrior. (Premium only)', type: 'badge', premiumOnly: true, leaderboardEmoji: '🌐' },
    { id: 'badge_heart', name: 'Supporter', price: 3600, desc: 'Thanks for playing!', type: 'badge', premiumOnly: false, leaderboardEmoji: '💖' },
    { id: 'badge_skull', name: 'Hardcore', price: 11200, desc: 'No hints, no mercy. (Premium only)', type: 'badge', premiumOnly: true, leaderboardEmoji: '☠️' },
    { id: 'badge_palm', name: 'Chill', price: 3200, desc: 'Relaxed leaderboard energy.', type: 'badge', premiumOnly: false, leaderboardEmoji: '🌴' },
    { id: 'badge_comet', name: 'Comet', price: 9400, desc: 'Blazing up the ranks. (Premium only)', type: 'badge', premiumOnly: true, leaderboardEmoji: '☄️' },
    { id: 'badge_ruby', name: 'Ruby Insignia', price: 11600, desc: 'Rare red badge. (Premium only)', type: 'badge', premiumOnly: true, leaderboardEmoji: '♦️' },

    // --- Faction wars & official minis (/playgame) ---
    { id: 'badge_playgame_arcade', name: 'Arcade Pass', price: 5600, desc: 'Official `/playgame` minis — rotation, threads, quick matches.', type: 'badge', premiumOnly: false, leaderboardEmoji: '🕹️' },
    { id: 'badge_faction_enlisted', name: 'War Enlisted', price: 7200, desc: 'Faction challenges: roster, raw score, end-of-war payouts.', type: 'badge', premiumOnly: false, leaderboardEmoji: '🎖️' },
    { id: 'badge_war_covenant', name: 'War Covenant', price: 10800, desc: 'Ranked faction wars & global standings energy. (Premium only)', type: 'badge', premiumOnly: true, leaderboardEmoji: '📜' },
    { id: 'badge_reaction_lane', name: 'Reflex Runner', price: 6400, desc: 'Speed minis: Reaction Rush, High Card Blitz, buzz-in energy.', type: 'badge', premiumOnly: false, leaderboardEmoji: '⏱️' },
    { id: 'badge_dice_lane', name: 'Dice Lane', price: 6200, desc: 'Dice & push-luck: Risk Roll, Dice Duel, King of the Hill…', type: 'badge', premiumOnly: false, leaderboardEmoji: '🎰' },
    { id: 'badge_puzzle_lane', name: 'Brain Arcade', price: 6000, desc: 'Logic & memory: Pattern Memory, Zebra puzzles, chains & steps.', type: 'badge', premiumOnly: false, leaderboardEmoji: '🧩' },
    { id: 'badge_rotation_regular', name: 'Rotation Regular', price: 5200, desc: 'You live by the daily UTC rotation pool.', type: 'badge', premiumOnly: false, leaderboardEmoji: '🔁' },

    // --- Name colors (profile embed accent) ---
    { id: 'role_color_gold', name: 'Golden Name Color', price: 7500, desc: 'Rich gold accents on your profile embed. (Premium only)', type: 'color', premiumOnly: true, profileColorHex: '#FFD700' },
    { id: 'color_crimson', name: 'Crimson', price: 3200, desc: 'Bold red profile frame.', type: 'color', premiumOnly: false, profileColorHex: '#DC143C' },
    { id: 'color_ocean', name: 'Ocean Blue', price: 3200, desc: 'Deep sea blue.', type: 'color', premiumOnly: false, profileColorHex: '#1E90FF' },
    { id: 'color_forest', name: 'Forest Green', price: 3200, desc: 'Nature tone.', type: 'color', premiumOnly: false, profileColorHex: '#228B22' },
    { id: 'color_royal', name: 'Royal Purple', price: 3850, desc: 'Regal purple. (Premium only)', type: 'color', premiumOnly: true, profileColorHex: '#6A0DAD' },
    { id: 'color_sunset', name: 'Sunset Orange', price: 2950, desc: 'Warm orange glow.', type: 'color', premiumOnly: false, profileColorHex: '#FF6347' },
    { id: 'color_mint', name: 'Mint Fresh', price: 2950, desc: 'Cool mint green.', type: 'color', premiumOnly: false, profileColorHex: '#98FF98' },
    { id: 'color_rose', name: 'Rose Pink', price: 3200, desc: 'Soft pink accent.', type: 'color', premiumOnly: false, profileColorHex: '#FF69B4' },
    { id: 'color_midnight', name: 'Midnight', price: 5200, desc: 'Dark blue night sky. (Premium only)', type: 'color', premiumOnly: true, profileColorHex: '#191970' },
    { id: 'color_lavender', name: 'Lavender', price: 2950, desc: 'Soft purple-gray.', type: 'color', premiumOnly: false, profileColorHex: '#E6E6FA' },
    { id: 'color_amber', name: 'Amber Glow', price: 3450, desc: 'Honey amber. (Premium only)', type: 'color', premiumOnly: true, profileColorHex: '#FFBF00' },
    { id: 'color_emerald', name: 'Emerald City', price: 3850, desc: 'Jewel green. (Premium only)', type: 'color', premiumOnly: true, profileColorHex: '#50C878' },
    { id: 'color_cherry', name: 'Cherry', price: 3400, desc: 'Vibrant cherry red. (Premium only)', type: 'color', premiumOnly: true, profileColorHex: '#DE3163' },
    { id: 'color_slate', name: 'Slate Gray', price: 2750, desc: 'Minimal and clean.', type: 'color', premiumOnly: false, profileColorHex: '#708090' },
    { id: 'color_coral', name: 'Coral Reef', price: 3200, desc: 'Tropical coral.', type: 'color', premiumOnly: false, profileColorHex: '#FF7F50' },
    { id: 'color_ice', name: 'Ice Blue', price: 3600, desc: 'Frosty light blue. (Premium only)', type: 'color', premiumOnly: true, profileColorHex: '#AFEEEE' },
    { id: 'color_wine', name: 'Wine', price: 3850, desc: 'Deep burgundy. (Premium only)', type: 'color', premiumOnly: true, profileColorHex: '#722F37' },
    { id: 'color_lemon', name: 'Lemon Zest', price: 2850, desc: 'Bright yellow-green.', type: 'color', premiumOnly: false, profileColorHex: '#FFFACD' },
    { id: 'color_neon', name: 'Neon Magenta', price: 6800, desc: 'Electric stand-out. (Premium only)', type: 'color', premiumOnly: true, profileColorHex: '#FF00FF' },
    { id: 'color_steel', name: 'Steel Blue', price: 4650, desc: 'Cool industrial blue. (Premium only)', type: 'color', premiumOnly: true, profileColorHex: '#4682B4' },

    { id: 'color_war_garnet', name: 'War Garnet', price: 5600, desc: 'Deep faction-war red accent. (Premium only)', type: 'color', premiumOnly: true, profileColorHex: '#8B1538' },
    { id: 'color_arcade_teal', name: 'Arcade Teal', price: 3600, desc: 'Official minis & `/playgame` board energy.', type: 'color', premiumOnly: false, profileColorHex: '#008B8B' },
    { id: 'color_rotation_violet', name: 'Rotation Violet', price: 4200, desc: 'Daily rotation & featured-game flair.', type: 'color', premiumOnly: false, profileColorHex: '#5D3FD3' },
];

async function seedShop() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB for Shop Seed...');
        // Load models after connect — `models.js` resolves via mongoRouter, which only binds once the default connection is ready.
        const { ShopItem } = require('./models');

        for (const item of SHOP_ITEMS) {
            await ShopItem.updateOne({ id: item.id }, { $set: item }, { upsert: true });
        }

        const count = await ShopItem.countDocuments();
        console.log(`Shop Seed Complete! Upserted ${SHOP_ITEMS.length} items. Total in DB: ${count}`);
    } catch (err) {
        console.error('Seed error:', err);
    } finally {
        mongoose.connection.close();
        process.exit(0);
    }
}

seedShop();
