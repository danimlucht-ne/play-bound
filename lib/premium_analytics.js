'use strict';

const {
    getPremiumConversionStats,
    getPremiumConversionStatsForTrigger,
    getPremiumPeriodComparison,
} = require('./premiumAnalytics');

function pct(n) {
    return `${(n * 100).toFixed(2)}%`;
}

function fmtTs(d) {
    if (!d) return '—';
    try {
        return `<t:${Math.floor(new Date(d).getTime() / 1000)}:R>`;
    } catch {
        return '—';
    }
}

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function executePremiumAnalytics(interaction) {
    const days = interaction.options.getInteger('days') ?? 30;
    const triggerOpt = interaction.options.getString('trigger');

    if (triggerOpt) {
        const d = await getPremiumConversionStatsForTrigger({ trigger: triggerOpt, days });
        const lines = [
            `✨ **Premium analytics — \`${d.trigger}\`** (${days}d)`,
            `• **Views:** ${d.views.toLocaleString()}`,
            `• **Conversions:** ${d.conversions.toLocaleString()}`,
            `• **Rate:** ${pct(d.conversionRate)}`,
            `• **Last shown:** ${fmtTs(d.lastShownAt)}`,
            `• **Last converted:** ${fmtTs(d.lastConvertedAt)}`,
        ];
        return interaction.reply({ content: lines.join('\n'), ephemeral: true });
    }

    const stats = await getPremiumConversionStats({ days });
    const cmp = await getPremiumPeriodComparison(7).catch(() => null);

    let text = `✨ **Premium analytics** (${days}d, since <t:${Math.floor(stats.since.getTime() / 1000)}:d>)\n\n`;

    for (const row of stats.byTrigger) {
        text += `**${row.trigger}**\n• Views: **${row.views.toLocaleString()}**\n• Conversions: **${row.conversions.toLocaleString()}**\n• Rate: **${pct(row.conversionRate)}**\n\n`;
    }

    text += `**TOTAL**\n• Views: **${stats.totals.views.toLocaleString()}**\n• Conversions: **${stats.totals.conversions.toLocaleString()}**\n• Rate: **${pct(stats.totals.conversionRate)}**`;

    const ranked = [...stats.byTrigger].filter((r) => r.views >= 5);
    if (ranked.length > 0) {
        ranked.sort((a, b) => b.conversionRate - a.conversionRate);
        const top = ranked[0];
        const low = ranked[ranked.length - 1];
        text += `\n\n_**Top rate** (≥5 views): ${top.trigger} (${pct(top.conversionRate)})_`;
        if (low && low.trigger !== top.trigger) {
            text += `\n_**Lowest rate** (≥5 views): ${low.trigger} (${pct(low.conversionRate)})_`;
        }
    }

    const pc = stats.byTrigger.find((r) => r.trigger === 'premium_command');
    if (pc) {
        text += `\n\n_**/premium** views: **${pc.views}** · attributed conversions: **${pc.conversions}**_`;
    }

    if (cmp) {
        text += `\n\n**Last 7d vs prior 7d (all triggers)**\n• Views: **${cmp.current.views}** vs **${cmp.previous.views}**\n• Conversions: **${cmp.current.conversions}** vs **${cmp.previous.conversions}**\n• Rate: **${pct(cmp.current.rate)}** vs **${pct(cmp.previous.rate)}**`;
    }

    if (text.length > 1900) {
        text = text.slice(0, 1890) + '\n…';
    }

    return interaction.reply({ content: text, ephemeral: true });
}

module.exports = { executePremiumAnalytics };
