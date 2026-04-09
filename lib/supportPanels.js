'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
} = require('discord.js');
const { GLOBAL_FACTION_KEYS } = require('./globalFactions');

/** Env key suffix for error messages (matches SUPPORT_PANEL_<SUFFIX>_CHANNEL_ID). */
const PANEL_ENV_SUFFIX = {
  quickStart: 'QUICK_START',
  learn: 'LEARN',
  helpDeskAndSuggestions: 'HELP_DESK_AND_SUGGESTIONS',
  playHere: 'PLAY_HERE',
  premium: 'PREMIUM',
};

const COLORS = {
  quickStart: 0x05c7c8,
  learn: 0x8b5cf6,
  helpDesk: 0xef6461,
  playHere: 0x11d1a9,
  premium: 0x38bdf8,
};

/** Legacy panel posts put `[PLAYBOUND_SUPPORT_PANEL:<slug>:vN]` in message content; current posts are embed-only. */
const MAX_PANEL_WIPE_FETCH = 10000;

function markerRegexForPanel(slug) {
  return new RegExp(`\\[PLAYBOUND_SUPPORT_PANEL:${slug}:v\\d+\\]`);
}

function getSupportPanelChannelIds() {
  const ids = {
    quickStart: process.env.SUPPORT_PANEL_QUICK_START_CHANNEL_ID,
    learn: process.env.SUPPORT_PANEL_LEARN_CHANNEL_ID,
    helpDeskAndSuggestions: process.env.SUPPORT_PANEL_HELP_DESK_AND_SUGGESTIONS_CHANNEL_ID,
    playHere: process.env.SUPPORT_PANEL_PLAY_HERE_CHANNEL_ID,
    premium: process.env.SUPPORT_PANEL_PREMIUM_CHANNEL_ID,
  };

  const missing = Object.entries(ids)
    .filter(([, v]) => !v || !String(v).trim())
    .map(([k]) => k);

  return { ids, missing };
}

function channelUrl(guildId, channelId) {
  return `https://discord.com/channels/${guildId}/${channelId}`;
}

function channelMention(channelId) {
  return `<#${channelId}>`;
}

const PANEL_BOT_INVITE_PERMISSIONS =
  PermissionFlagsBits.ViewChannel |
  PermissionFlagsBits.SendMessages |
  PermissionFlagsBits.EmbedLinks |
  PermissionFlagsBits.AttachFiles |
  PermissionFlagsBits.ReadMessageHistory |
  PermissionFlagsBits.AddReactions |
  PermissionFlagsBits.Connect |
  PermissionFlagsBits.Speak |
  PermissionFlagsBits.UseVAD |
  PermissionFlagsBits.CreatePublicThreads |
  PermissionFlagsBits.SendMessagesInThreads |
  PermissionFlagsBits.ManageThreads |
  PermissionFlagsBits.ManageMessages;

function getBotInviteUrl() {
  const custom = process.env.BOT_INVITE_URL || process.env.DISCORD_BOT_INVITE_URL;
  if (custom && String(custom).trim()) return String(custom).trim();

  const clientId = process.env.CLIENT_ID;
  if (!clientId || !String(clientId).trim()) return null;

  return `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(
    String(clientId).trim(),
  )}&permissions=${PANEL_BOT_INVITE_PERMISSIONS.toString()}&scope=bot%20applications.commands`;
}

function linkButton(label, guildId, channelId) {
  return new ButtonBuilder().setLabel(label).setStyle(ButtonStyle.Link).setURL(channelUrl(guildId, channelId));
}

function inviteButton() {
  const url = getBotInviteUrl();
  if (!url) return null;
  return new ButtonBuilder().setLabel('Invite PlayBound').setStyle(ButtonStyle.Link).setURL(url);
}

function rowsFor(buttons) {
  const rows = [];
  for (let i = 0; i < buttons.length; i += 5) {
    const slice = buttons.slice(i, i + 5).filter(Boolean);
    if (slice.length) rows.push(new ActionRowBuilder().addComponents(slice));
  }
  return rows;
}

function panelEmbed({ color, title, description, fields = [], footer }) {
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description.filter((line) => line !== '').join('\n\n'))
    .setFooter({ text: footer })
    .setTimestamp();

  for (const field of fields) {
    embed.addFields({ name: field.name, value: field.value, inline: field.inline !== false });
  }

  return embed;
}

function panelSpecs(guildId, ids) {
  const invite = inviteButton();
  const hd = ids.helpDeskAndSuggestions;
  return [
    {
      slug: 'quick-start',
      legacyPanelSlugs: ['welcome'],
      channelId: ids.quickStart,
      embed: panelEmbed({
        color: COLORS.quickStart,
        title: 'Welcome to PlayBound · Quick start',
        description: [
          'Discord game night without the calendar negotiation — official games, hosted nights, factions, and a scoreboard that actually moves.',
          '',
          '**Fast path:**',
          '1. Run `/playgame` for an official game.',
          '2. Run `/faction join` when you want the team layer.',
          '3. Run `/faction_challenge status` or `/faction_challenge join` when a war is live.',
          '4. Use hosted commands for party games and custom server nights.',
          '',
          `Questions or setup pain: ${channelMention(hd)} · Deeper tour: ${channelMention(ids.learn)} · Jump in: ${channelMention(ids.playHere)}`,
        ],
        fields: [
          { name: 'Official games', value: '`/playgame` rotates fast, fair mini-games built for rewards and faction wars.' },
          { name: 'Hosted nights', value: 'Trivia, captions, quotes, Serverdle, giveaways, audio games, and more.' },
          { name: 'Factions', value: `${GLOBAL_FACTION_KEYS.join(', ')} — global ranked standings.` },
        ],
        footer: 'PlayBound - quick to start, dangerous to underestimate',
      }),
      buttons: [
        linkButton('Play here', guildId, ids.playHere),
        linkButton('How it works', guildId, ids.learn),
        linkButton('Help & suggestions', guildId, hd),
        linkButton('Premium', guildId, ids.premium),
        invite,
      ],
    },
    {
      slug: 'learn',
      channelId: ids.learn,
      embed: panelEmbed({
        color: COLORS.learn,
        title: 'How PlayBound Works',
        description: [
          'The whole product in one breath:',
          '',
          '`/playgame` launches official mini-games. Hosted commands create custom game nights. Credits fuel progression. Factions turn individual play into global team competition.',
          '',
          'Ranked faction wars are deliberately stricter than casual play so the leaderboard stays fair.',
        ],
        fields: [
          { name: 'Economy', value: 'Credits are your regular rewards and spending balance.' },
          { name: 'Competitive scoring', value: 'Faction war scoring uses base game points, not premium/streak/double-point boosted economy totals.' },
          { name: 'Global standings', value: 'Ranked wins award match points: win = 3, tie = 1, loss = 0.' },
          { name: 'Server setup', value: 'Admins configure channels and automation in **admin-tools** on this server.' },
        ],
        footer: 'PlayBound - simple at the surface, structured underneath',
      }),
      buttons: [
        linkButton('Play here', guildId, ids.playHere),
        linkButton('Quick start', guildId, ids.quickStart),
        linkButton('Help & suggestions', guildId, hd),
        linkButton('Premium', guildId, ids.premium),
        invite,
      ],
    },
    {
      slug: 'help-desk-and-suggestions',
      legacyPanelSlugs: ['help'],
      channelId: hd,
      embed: panelEmbed({
        color: COLORS.helpDesk,
        title: 'Help desk & suggestions',
        description: [
          'Something weird? Good — weird gives us a trail.',
          '',
          'Post setup questions, confusion, or **public product ideas** here. Screenshots and exact error text help.',
          '',
          'For private bugs, account issues, or sensitive reports, use **`/ticket`** from any server where PlayBound is installed.',
        ],
        fields: [
          { name: 'Fastest useful report', value: '`Command + server + channel + screenshot/error + steps to reproduce`', inline: false },
          { name: 'Before you ask', value: `Skim ${channelMention(ids.quickStart)} and ${channelMention(ids.learn)} — many “broken bot” moments are permissions or the wrong channel.` },
        ],
        footer: 'PlayBound - more context, faster fixes',
      }),
      buttons: [
        linkButton('Play here', guildId, ids.playHere),
        linkButton('How it works', guildId, ids.learn),
        linkButton('Quick start', guildId, ids.quickStart),
      ],
    },
    {
      slug: 'play-here',
      legacyPanelSlugs: ['play', 'try-commands', 'party-mode', 'tournament'],
      channelId: ids.playHere,
      embed: panelEmbed({
        color: COLORS.playHere,
        title: 'Play here',
        description: [
          'Official games, command practice, tournaments, and casual hosted nights — one channel for the loud part of the operation.',
          '',
          '**Official `/playgame` games** are the cleanest path for fair scoring, daily rotation, featured games, and ranked faction eligibility.',
          '',
          '**Hosted games:** Trivia Sprint, Serverdle, Guess the Number, Movie Quotes, Unscramble, Caption Contest, Name That Tune, Spelling Bee, Giveaways, and more.',
        ],
        fields: [
          { name: 'Ranked war note', value: 'Official ranked wars count eligible `/playgame` games unless a local unranked challenge explicitly allows hosted games.', inline: false },
          { name: 'Crash recovery', value: 'Resumable games resume after a restart; unresumable games close safely with goodwill handling where configured.' },
        ],
        footer: 'PlayBound - fair games, loud wins',
      }),
      buttons: [
        linkButton('How it works', guildId, ids.learn),
        linkButton('Premium', guildId, ids.premium),
        linkButton('Help & suggestions', guildId, hd),
        invite,
      ],
    },
    {
      slug: 'premium',
      channelId: ids.premium,
      embed: panelEmbed({
        color: COLORS.premium,
        title: 'Premium Without Pay-to-Win',
        description: [
          'Premium should feel good without wrecking competitive integrity.',
          '',
          'You get better reward flow, profile perks, host aura/session upgrades, and smoother server-night tools. Ranked faction wars still use base scoring so paid boosts do not inflate war totals.',
        ],
        fields: [
          { name: 'Good for players', value: 'More convenience, more profile flavor, more reward momentum.' },
          { name: 'Good for hosts', value: 'Better session controls and event-night polish.' },
          { name: 'Still fair', value: 'Faction war scoring ignores premium/streak/pass multipliers.' },
        ],
        footer: 'PlayBound - shiny perks, fair fights',
      }),
      buttons: [
        linkButton('Play here', guildId, ids.playHere),
        linkButton('Learn more', guildId, ids.learn),
        invite,
      ],
    },
  ];
}

async function fetchTextChannel(guild, channelId) {
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return null;
  return channel;
}

async function iterChannelMessages(channel) {
  const out = [];
  let before;
  while (out.length < MAX_PANEL_WIPE_FETCH) {
    const batch = await channel.messages.fetch({ limit: 100, before }).catch(() => null);
    if (!batch || batch.size === 0) break;
    out.push(...batch.values());
    before = batch.last()?.id;
  }
  return out;
}

async function wipePanelChannel(channel) {
  const messages = await iterChannelMessages(channel);
  let deleted = 0;
  let failed = 0;
  const twoWeeksMs = 13 * 24 * 60 * 60 * 1000;

  for (const message of messages) {
    try {
      if (Date.now() - message.createdTimestamp < twoWeeksMs && channel.bulkDelete) {
        continue;
      }
      await message.delete();
      deleted += 1;
    } catch {
      failed += 1;
    }
  }

  const recent = messages.filter((m) => Date.now() - m.createdTimestamp < twoWeeksMs);
  for (let i = 0; i < recent.length; i += 100) {
    const slice = recent.slice(i, i + 100);
    if (!slice.length) continue;
    try {
      await channel.bulkDelete(slice, false);
      deleted += slice.length;
    } catch {
      for (const message of slice) {
        try {
          await message.delete();
          deleted += 1;
        } catch {
          failed += 1;
        }
      }
    }
  }

  return { deleted, failed };
}

/**
 * Match first embed to our builder (same idea as bootstrap pins — stable identity without message content).
 * @param {import('discord.js').Embed} apiEmbed
 * @param {import('discord.js').EmbedBuilder} embedBuilder
 */
function embedMatchesPanelSpec(apiEmbed, embedBuilder) {
  const d = embedBuilder.data;
  return (
    apiEmbed.title === d.title &&
    (apiEmbed.footer?.text ?? '') === (d.footer?.text ?? '')
  );
}

async function findExistingPanelMessage(channel, spec, client) {
  const markerSlugs = [spec.slug, ...(spec.legacyPanelSlugs || [])];
  const msgs = await iterChannelMessages(channel);
  for (const m of msgs) {
    if (m.author.id !== client.user.id) continue;
    for (const s of markerSlugs) {
      if (markerRegexForPanel(s).test(m.content || '')) return m;
    }
    if (m.embeds?.length > 0 && embedMatchesPanelSpec(m.embeds[0], spec.embed)) return m;
  }
  return null;
}

async function upsertPanelMessage(channel, spec, client) {
  const existing = await findExistingPanelMessage(channel, spec, client);
  const payload = { embeds: [spec.embed], components: rowsFor(spec.buttons) };

  if (existing) {
    await existing.edit({ ...payload, content: '' });
    return 'updated';
  }

  await channel.send(payload);
  return 'created';
}

async function postSupportPanels(guild, opts = {}) {
  const { ids, missing } = getSupportPanelChannelIds();
  if (missing.length) {
    throw new Error(
      `Missing env: ${missing.map((k) => `SUPPORT_PANEL_${PANEL_ENV_SUFFIX[k]}_CHANNEL_ID`).join(', ')}`,
    );
  }

  const guildId = guild.id;
  const client = guild.client;
  const specs = panelSpecs(guildId, ids);
  const summary = { created: [], updated: [], wiped: [], failures: [] };

  for (const spec of specs) {
    const channel = await fetchTextChannel(guild, spec.channelId);
    if (!channel) {
      summary.failures.push(`${spec.slug}: channel could not be loaded`);
      continue;
    }

    if (opts.wipePanelChannels === true) {
      const result = await wipePanelChannel(channel);
      summary.wiped.push(`#${channel.name}: deleted ${result.deleted}${result.failed ? `, ${result.failed} failed` : ''}`);
    }

    const action = await upsertPanelMessage(channel, spec, client);
    summary[action === 'updated' ? 'updated' : 'created'].push(`#${channel.name}`);
  }

  if (summary.failures.length) {
    throw new Error(`Panel setup incomplete: ${summary.failures.join('; ')}`);
  }

  return summary;
}

function formatSupportPanelSummary(summary) {
  const lines = ['Panels updated successfully.'];
  const sec = (title, arr) => {
    if (!arr || !arr.length) return;
    lines.push('', `**${title}** (${arr.length})`);
    for (const item of arr.slice(0, 20)) lines.push(`- ${item}`);
    if (arr.length > 20) lines.push(`- ... +${arr.length - 20} more`);
  };
  sec('Created', summary.created);
  sec('Updated', summary.updated);
  sec('Wiped', summary.wiped);
  sec('Follow-up needed', summary.failures);
  return lines.join('\n').slice(0, 1950);
}

module.exports = {
  getSupportPanelChannelIds,
  postSupportPanels,
  formatSupportPanelSummary,
  getBotInviteUrl,
};
