# 🚀 PlayBound Quick Start Guide for Server Owners

Welcome to PlayBound! This guide will help you set up your server for maximum engagement in under 5 minutes.

## 1️⃣ Basic Channel Setup
First, tell the bot where to send its messages. Run these commands in your preferred channels:

*   **/set_announcement_channel** - (Crucial) Game starts and winner summaries post here. **`@everyone` is off by default** for new setups; use **`/set_announce_everyone`** with `enabled: true` if you want server-wide pings.
*   **/set_welcome_channel** - Where new members are greeted.
*   **/set_birthday_channel** - Where the bot shouts out birthdays and gives a +5 point gift.
*   **/set_leaderboard_channel** - The bot will post a Top 10 board here that updates automatically.
*   **/set_story_channel** - Enable the "One-Word Story" game in a specific channel.

## 2️⃣ Add Variety to Greetings
Don't settle for boring defaults! Add several messages to the rotation:

### Recommended Welcome Messages
*   `/add_welcome_message message: Welcome {user}! 🎮 Can you climb to the top of the /leaderboard?`
*   `/add_welcome_message message: Player {user} has entered the arena! ⚔️ Type /help to gear up!`
*   `/add_welcome_message message: Welcome {user}! 🌟 We've started you off with 5 points!`

### Recommended Birthday Messages
*   `/add_birthday_message message: Level Up! 🎂 Happy Birthday {user}! Enjoy your +5 point gift!`
*   `/add_birthday_message message: Happy Birthday {user}! 🎈 Another year in the simulation survived! (+5 pts)`

## 3️⃣ Set Up Role Rewards (Engagement Booster)
Give your players social status! You can link achievements to Discord roles:

1. Create a role in your Discord Server (e.g., "Trivia Master").
2. Use `/set_role_reward achievement:TRIVIA_KING role:@Trivia Master`
3. Now, anyone who wins 5 Trivia matches automatically gets that role!

**Common Achievement Keys:**
*   `FIRST_WIN` - First time winning anything.
*   `TRIVIA_KING` - 5 Trivia wins.
*   `SERVERDLE_MASTER` - 5 Serverdle wins.
*   `GUESS_MASTER` - 5 Guess The Number wins.
*   `LOYAL_PLAYER` - Reaching 50 total points.

## 4️⃣ Points, Economy & Factions
Users earn points by winning games, maintaining their **Daily Streak**, or claiming their `/daily` reward (**[💎 Premium]** users get more!).

*   **Trading:** Users can use `/pay` to tip each other or `/duel` to wager their points in 1v1 Trivia matches.
*   **The Shop:** Users can use `/shop` and `/buy` to spend points on game items, cosmetic badges, and name colors! (Some premium items require a subscription).
*   **Equipping Items:** After buying cosmetics, users can apply them to their profile and leaderboard ranking using `/equip`.
*   **Server Pro Shops [💎 Premium]:** If your server has Premium status, you can create your own custom economy! Use `/server_shop_add` to create custom Discord roles, badges, or colors that users can buy exclusively in your server.
*   **Global Factions:** Encourage your users to join a team with `/faction join` (Phoenixes, Unicorns, Fireflies, Dragons, Wolves, or Eagles). Every point they earn in your server contributes to the global `/factions` leaderboard!

## 5️⃣ Start Your First Game!
Try starting a community game to get the hype going:
*   `/startserverdle` - A community Wordle game.
*   `/guessthenumber min:1 max:100` - A quick and easy classic.
*   `/trivia questions:10` - A live, fast-paced match.
*   `/tournament pot:100 entry_fee:5` - Start a bracketed Dice Roll tournament!

### 🤖 Autopilot Setup [💎 Premium]
If you have Premium, you can schedule games to run on a repeating loop without you having to lift a finger!
*   Run `/startserverdle repeat_hrs:12` to automatically post a new Serverdle game every 12 hours!
*   Run `/trivia repeat_hrs:24` to automatically host a daily Trivia match!

---
*Need more help? Type `/help` or use `/report` to contact the bot admin.*
