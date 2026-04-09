# 🛠️ Self-Hosting Guide for PlayBound

This guide explains how to configure PlayBound for your own Discord bot instance.

## 💳 Stripe Integration (Premium Features)

PlayBound uses Stripe to manage premium subscriptions. When setting this up in your Stripe Dashboard, please follow these instructions carefully:

1.  **Use Payment Links:** Stripe provides several ways to accept payments. Since PlayBound is a Discord bot and not a traditional website, you **must** use the **"Payment Links"** feature.
2.  **Ignore Code Snippets:** You may see buttons to "add this to the code" with snippets of HTML or JavaScript (Stripe Checkout). **Ignore these.** They are for websites and will not work within Discord.
3.  **Copy the URL:** Create a Payment Link in your Stripe dashboard and copy the shareable URL (it usually starts with `https://buy.stripe.com/...`).
4.  **Update `.env`:** Paste this URL into your `.env` file under the `STRIPE_PAYMENT_LINK` variable.

## 🔧 Environment Variables

Make sure to fill out all the fields in your `.env` file:

- `DISCORD_TOKEN`: Your bot's token from the Discord Developer Portal.
- `CLIENT_ID`: Your bot's application ID.
- `MONGO_URI`: A connection string for your MongoDB database.
- `STRIPE_PAYMENT_LINK`: The shareable URL from Stripe (as explained above).
- `STRIPE_SECRET_KEY`: Your Stripe secret API key (for webhooks).
- `STRIPE_WEBHOOK_SECRET`: The secret used to verify Stripe webhooks.
