'use strict';

const {
  ChannelType,
  PermissionFlagsBits,
  OverwriteType,
  PermissionsBitField,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { GLOBAL_FACTION_KEYS } = require('./globalFactions');

const SETUP_PIN_VER = 'v5';
const SUPPORT_BOOTSTRAP_TEMPLATE_VERSION = 8;
const ADMIN_TOOLS_PUBLIC_VIEW = true;
const MAX_WIPE_MESSAGE_FETCH = 10000;

const ROLE_KEYS = {
  admin: 'admin',
  mod: 'mod',
  factionLeader: 'faction_leader',
  botManager: 'bot_manager',
};

const ROLE_DEFS = [
  { key: ROLE_KEYS.admin, defaultName: 'PlayBound Admin' },
  { key: ROLE_KEYS.mod, defaultName: 'PlayBound Moderator' },
  { key: ROLE_KEYS.factionLeader, defaultName: 'Faction Leader' },
  { key: ROLE_KEYS.botManager, defaultName: 'Bot Manager' },
];

const REQUIRED_BOT_PERMS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.AddReactions,
  PermissionFlagsBits.PinMessages,
  PermissionFlagsBits.Connect,
];

const COLORS = {
  cyan: 0x00ced1,
  blue: 0x3b82f6,
  purple: 0x8b5cf6,
  gold: 0xf59e0b,
  green: 0x22c55e,
  red: 0xef4444,
};

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function pinMarker(slug) {
  return `[PLAYBOUND_SETUP_PIN:${slug}:${SETUP_PIN_VER}]`;
}

function hiddenPinMarker(slug) {
  return `||${pinMarker(slug)}||`;
}

function markerRegexForChannelSlugs(chDef) {
  const slugs = [chDef.slug, ...(chDef.legacySlugs || [])];
  const inner = slugs.map(escapeRegex).join('|');
  return new RegExp(`\\[PLAYBOUND_SETUP_PIN:(?:${inner}):v\\d+\\]`);
}

function stripSetupPinBody(messageContent, slug) {
  let s = String(messageContent || '');
  const esc = escapeRegex(slug);
  const spoiler = new RegExp(`\\n\\n\\|\\|\\[PLAYBOUND_SETUP_PIN:${esc}:v\\d+\\]\\|\\|\\s*$`, 'i');
  const plain = new RegExp(`\\n\\n\\[PLAYBOUND_SETUP_PIN:${esc}:v\\d+\\]\\s*$`, 'i');
  s = s.replace(spoiler, '').replace(plain, '');
  return s.trim();
}

function stripSetupPinBodyAnySlug(messageContent, chDef) {
  let s = String(messageContent || '');
  const slugs = [...new Set([...(chDef.legacySlugs || []), chDef.slug])];
  for (const slug of slugs) s = stripSetupPinBody(s, slug);
  return s.trim();
}

function hasAnySetupMarker(content, chDef) {
  const slugs = [chDef.slug, ...(chDef.legacySlugs || [])];
  const inner = slugs.map(escapeRegex).join('|');
  return new RegExp(`\\[PLAYBOUND_SETUP_PIN:(?:${inner}):v\\d+\\]`).test(String(content || ''));
}

function fullPinContent(slug, body) {
  return `${body.trim()}\n\n${hiddenPinMarker(slug)}`;
}

function buildPinText(spec) {
  const lines = [];
  lines.push(`**${spec.title}**`);
  lines.push('');
  lines.push(spec.description);
  lines.push('');
  for (const bullet of spec.bullets || []) {
    lines.push(`• ${bullet}`);
  }
  if (spec.important) {
    lines.push('');
    lines.push(`**Heads up:** ${spec.important}`);
  }
  if (spec.action) {
    lines.push('');
    lines.push(`**Do this now:** ${spec.action}`);
  }
  lines.push('');
  lines.push(`_${spec.footer}_`);
  return lines.join('\n');
}

function buildPinPayload(spec) {
  return {
    pin: buildPinText(spec),
    embed: {
      title: spec.title,
      description: [
        spec.description,
        '',
        ...(spec.bullets || []).map((b) => `• ${b}`),
        ...(spec.important ? ['', `**Heads up:** ${spec.important}`] : []),
        ...(spec.action ? ['', `**Do this now:** ${spec.action}`] : []),
      ].join('\n'),
      footer: spec.footer,
      color: spec.color || COLORS.cyan,
    },
  };
}

function buildPinComponents(guild, chDef) {
  const defs = Array.isArray(chDef.buttonDefs) ? chDef.buttonDefs : [];
  if (!defs.length) return [];

  const buttons = defs
    .map((def) => {
      const targetName = String(def.targetChannelName || '').toLowerCase();
      const target = guild.channels.cache.find((c) => c.name.toLowerCase() === targetName);
      if (!target) return null;
      return new ButtonBuilder()
        .setLabel(def.label)
        .setStyle(ButtonStyle.Link)
        .setURL(`https://discord.com/channels/${guild.id}/${target.id}`);
    })
    .filter(Boolean);

  if (!buttons.length) return [];

  const rows = [];
  for (let i = 0; i < buttons.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
  }
  return rows;
}

function embedMatchesChDef(emb, chDef) {
  if (!chDef.embed || !emb) return false;
  return (
    emb.title === chDef.embed.title &&
    emb.description === chDef.embed.description &&
    (emb.footer?.text ?? '') === chDef.embed.footer
  );
}

function bootstrapPinMatchesTemplate(message, chDef) {
  if (chDef.embed && message.embeds.length > 0 && embedMatchesChDef(message.embeds[0], chDef)) {
    return true;
  }
  if (!hasAnySetupMarker(message.content, chDef)) return false;
  const stripped = stripSetupPinBodyAnySlug(message.content, chDef);
  if (stripped === chDef.pin.trim()) return true;
  return false;
}

async function iterChannelMessages(channel) {
  const out = [];
  let before;
  while (out.length < MAX_WIPE_MESSAGE_FETCH) {
    const batch = await channel.messages.fetch({ limit: 100, before }).catch(() => null);
    if (!batch || batch.size === 0) break;
    out.push(...batch.values());
    before = batch.last()?.id;
  }
  return out;
}

async function wipeBootstrapMarkedInChannel(channel, chDef, client, summary) {
  const re = markerRegexForChannelSlugs(chDef);
  const msgs = await iterChannelMessages(channel);
  let n = 0;
  for (const m of msgs) {
    if (m.author.id !== client.user.id) continue;
    const hasMarker = re.test(m.content || '');
    const hasBootstrapEmbed =
      chDef.embed && m.embeds?.length > 0 && embedMatchesChDef(m.embeds[0], chDef);
    if (!hasMarker && !hasBootstrapEmbed) continue;
    try {
      await m.unpin().catch(() => {});
      await m.delete().catch(() => {});
      n += 1;
    } catch (e) {
      summary.failures.push(`Wipe setup #${channel.name}: ${e.message}`);
    }
  }
  return n;
}

async function wipeAllMessagesInTextChannel(channel) {
  let deleted = 0;
  let failed = 0;
  let rounds = 0;
  const maxRounds = 300;
  const twoWeeksMs = 13 * 24 * 60 * 60 * 1000;

  while (rounds < maxRounds) {
    rounds += 1;
    const batch = await channel.messages.fetch({ limit: 100 }).catch(() => null);
    if (!batch || batch.size === 0) break;

    const arr = [...batch.values()];
    const recent = arr.filter((m) => Date.now() - m.createdTimestamp < twoWeeksMs);
    const old = arr.filter((m) => Date.now() - m.createdTimestamp >= twoWeeksMs);

    if (recent.length > 0) {
      try {
        await channel.bulkDelete(recent, false);
        deleted += recent.length;
      } catch {
        for (const m of recent) {
          try {
            await m.delete();
            deleted += 1;
          } catch {
            failed += 1;
          }
        }
      }
    }

    for (const m of old) {
      try {
        await m.delete();
        deleted += 1;
      } catch {
        failed += 1;
      }
    }
  }

  return { deleted, failed };
}

function buildThemeEmbed(chDef) {
  return new EmbedBuilder()
    .setColor(chDef.embed.color || COLORS.cyan)
    .setTitle(chDef.embed.title)
    .setDescription(chDef.embed.description.slice(0, 4096))
    .setFooter({ text: chDef.embed.footer.slice(0, 2048) })
    .setTimestamp();
}

async function sendPinnedSetupMessage(channel, chDef, summary) {
  const plain = fullPinContent(chDef.slug, chDef.pin);
  if (plain.length > 2000) throw new Error('Pin exceeds 2000 chars');

  const components = buildPinComponents(channel.guild, chDef);
  let msg;
  if (chDef.embed) {
    try {
      msg = await channel.send({
        embeds: [buildThemeEmbed(chDef)],
        ...(components.length ? { components } : {}),
      });
    } catch (e) {
      summary.notes.push(`Embed pin #${chDef.name} failed (${e.message}) — used plain text.`);
      msg = await channel.send({ content: plain });
    }
  } else {
    msg = await channel.send({ content: plain });
  }

  await msg.pin('PlayBound bootstrap');
  return msg;
}

function findRoleByConfiguredName(guild, name) {
  const n = String(name || '').trim();
  if (!n) return null;
  return (
    guild.roles.cache.find((r) => r.name === n) ||
    guild.roles.cache.find((r) => r.name.toLowerCase() === n.toLowerCase()) ||
    null
  );
}

function findCategoryByName(guild, name) {
  return (
    guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name === name) ||
    guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === name.toLowerCase()) ||
    null
  );
}

function findChannelInCategory(category, name, type) {
  return category.children.cache.find((c) => c.type === type && c.name.toLowerCase() === name.toLowerCase()) || null;
}

function findChannelInCategoryWithLegacy(category, chDef) {
  let ch = findChannelInCategory(category, chDef.name, chDef.type);
  if (ch) return ch;
  for (const legacy of chDef.legacyNames || []) {
    ch = findChannelInCategory(category, legacy, chDef.type);
    if (ch) return ch;
  }
  return null;
}

function assertBotPermissions(me) {
  const missing = [];
  for (const bit of REQUIRED_BOT_PERMS) {
    if (!me.permissions.has(bit)) missing.push(bit);
  }
  if (!missing.length) return;
  const names = missing.map((b) => Object.keys(PermissionFlagsBits).find((k) => PermissionFlagsBits[k] === b) || String(b));
  const err = new Error(`Bot is missing required permissions: ${names.join(', ')}`);
  err.code = 'MISSING_BOT_PERMS';
  throw err;
}

function buildOverwrites(guild, rolesByKey, perm) {
  const everyone = guild.roles.everyone;
  const admin = rolesByKey[ROLE_KEYS.admin];
  const mod = rolesByKey[ROLE_KEYS.mod];

  const publicText = {
    id: everyone.id,
    type: OverwriteType.Role,
    allow: new PermissionsBitField([
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.AttachFiles,
      PermissionFlagsBits.EmbedLinks,
      PermissionFlagsBits.AddReactions,
    ]).bitfield,
    deny: 0n,
  };

  const publicReadOnly = {
    id: everyone.id,
    type: OverwriteType.Role,
    allow: new PermissionsBitField([
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.AddReactions,
    ]).bitfield,
    deny: new PermissionsBitField([PermissionFlagsBits.SendMessages]).bitfield,
  };

  const staffText = (role, manageChannels = false) => ({
    id: role.id,
    type: OverwriteType.Role,
    allow: new PermissionsBitField([
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.AttachFiles,
      PermissionFlagsBits.EmbedLinks,
      PermissionFlagsBits.ManageMessages,
      PermissionFlagsBits.PinMessages,
      ...(manageChannels ? [PermissionFlagsBits.ManageChannels] : []),
    ]).bitfield,
    deny: 0n,
  });

  const publicVoice = {
    id: everyone.id,
    type: OverwriteType.Role,
    allow: new PermissionsBitField([
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.Connect,
      PermissionFlagsBits.Speak,
    ]).bitfield,
    deny: 0n,
  };

  const hiddenEveryone = {
    id: everyone.id,
    type: OverwriteType.Role,
    allow: 0n,
    deny: new PermissionsBitField([PermissionFlagsBits.ViewChannel]).bitfield,
  };

  switch (perm) {
    case 'public_text':
      return [publicText, staffText(mod), staffText(admin, true)];
    case 'rules_text':
      return [publicReadOnly, staffText(mod), staffText(admin, true)];
    case 'announce':
      return [publicReadOnly, staffText(mod), staffText(admin, true)];
    case 'admin_tools':
      if (ADMIN_TOOLS_PUBLIC_VIEW) {
        return [
          {
            id: everyone.id,
            type: OverwriteType.Role,
            allow: new PermissionsBitField([
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.ReadMessageHistory,
            ]).bitfield,
            deny: new PermissionsBitField([PermissionFlagsBits.SendMessages]).bitfield,
          },
          staffText(mod),
          staffText(admin, true),
        ];
      }
      return [hiddenEveryone, staffText(mod), staffText(admin, true)];
    case 'admin_only_text':
      return [hiddenEveryone, staffText(mod), staffText(admin, true)];
    case 'admin_category':
      return [hiddenEveryone, staffText(mod), staffText(admin, true)];
    case 'public_voice':
      return [
        publicVoice,
        {
          id: mod.id,
          type: OverwriteType.Role,
          allow: new PermissionsBitField([
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.Connect,
            PermissionFlagsBits.Speak,
            PermissionFlagsBits.MuteMembers,
            PermissionFlagsBits.MoveMembers,
          ]).bitfield,
          deny: 0n,
        },
        {
          id: admin.id,
          type: OverwriteType.Role,
          allow: new PermissionsBitField([
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.Connect,
            PermissionFlagsBits.Speak,
            PermissionFlagsBits.MuteMembers,
            PermissionFlagsBits.DeafenMembers,
            PermissionFlagsBits.MoveMembers,
            PermissionFlagsBits.ManageChannels,
          ]).bitfield,
          deny: 0n,
        },
      ];
    default:
      return [publicText, staffText(mod), staffText(admin, true)];
  }
}

async function findExistingSetupPinAny(channel, chDef, client) {
  try {
    const pins = await channel.messages.fetchPinned();
    const re = markerRegexForChannelSlugs(chDef);
    for (const m of pins.values()) {
      if (m.author.id !== client.user.id) continue;
      if (re.test(m.content || '')) return m;
      if (chDef.embed && m.embeds?.length > 0 && embedMatchesChDef(m.embeds[0], chDef)) return m;
    }
  } catch {
    return null;
  }
  return null;
}

// ONLY showing the PART YOU NEED TO REPLACE (CATEGORY_LAYOUT)
// Your core logic stays the same

const CATEGORY_LAYOUT = [
  {
    name: 'terms-rules',
    channels: [
      {
        slug: 'rules',
        name: 'rules',
        type: ChannelType.GuildText,
        perm: 'rules_text',
        ...buildPinPayload({
          title: '📜 Rules',
          description: 'Keep it fun. Keep it fair.',
          bullets: [
            'Be respectful',
            'No spam or trolling',
            'Use the right channels',
            'Don’t abuse or exploit the system',
          ],
          action: 'Read it once — then go play 🎮',
          footer: 'PlayBound • Don’t make it weird',
          color: COLORS.gold,
        }),
      },
    ],
  },

  {
    name: 'welcome',
    channels: [
      { slug: 'quick-start', name: 'quick-start', type: ChannelType.GuildText, perm: 'public_text', pin: null, embed: null },
      { slug: 'how-playbound-works', name: 'how-playbound-works', type: ChannelType.GuildText, perm: 'public_text', pin: null, embed: null },
      { slug: 'help-desk-and-suggestions', name: 'help-desk-and-suggestions', type: ChannelType.GuildText, perm: 'public_text', pin: null, embed: null },

      {
        slug: 'why-cant-i-start-games',
        name: 'why-cant-i-start-games',
        type: ChannelType.GuildText,
        perm: 'public_text',
        ...buildPinPayload({
          title: '🤔 Why Can’t I Start Games?',
          description: 'Usually one of these:',
          bullets: [
            'Missing permissions',
            'Wrong channel',
            'Hosting disabled',
            'Setup incomplete',
          ],
          action: 'Ask in help-desk-and-suggestions if stuck',
          footer: 'PlayBound',
          color: COLORS.blue,
        }),
      },
    ],
  },

  {
    name: 'bot-playground',
    channels: [
      {
        slug: 'admin-tools',
        name: 'admin-tools',
        type: ChannelType.GuildText,
        perm: 'admin_tools',
        ...buildPinPayload({
          title: '🛠️ Admin Tools',
          description: 'Your PlayBound control room.',
          bullets: [
            'Set bot channels',
            'Manage factions',
            'Run events',
            'Handle maintenance',
          ],
          important: 'Public read-only; staff can send',
          action: 'Set up your server',
          footer: 'PlayBound • Staff',
          color: COLORS.red,
        }),
      },

      { slug: 'factions', name: 'factions', type: ChannelType.GuildText, perm: 'public_text', pin: null, embed: null },
      { slug: 'play-here', name: 'play-here', type: ChannelType.GuildText, perm: 'public_text', pin: null, embed: null },
      { slug: 'premium', name: 'premium', type: ChannelType.GuildText, perm: 'public_text', pin: null, embed: null },

      {
        slug: 'economy',
        name: 'economy',
        type: ChannelType.GuildText,
        perm: 'public_text',
        ...buildPinPayload({
          title: '💰 Economy',
          description: 'Play → earn → spend → flex.',
          bullets: [
            'Earn credits from games',
            'Spend in shop',
            'Progress your profile',
          ],
          action: 'Use /shop and /profile',
          footer: 'PlayBound',
        }),
      },
    ],
  },

  {
    name: 'admin',
    channels: [
      {
        slug: 'moderator-only',
        name: 'moderator-only',
        type: ChannelType.GuildText,
        perm: 'admin_only_text',
        pin: null,
        embed: null,
      },
    ],
  },
];

async function runBootstrapSupportServer(guild, botMember, client, opts = {}) {
  const dryRun = !!opts.dryRun;
  const forceRepin = !!opts.forceRepin;
  const createMissingOnly = opts.createMissingOnly !== false;
  const wipeBootstrapMessages = opts.wipeBootstrapMessages === true;
  const wipeAllMessagesInBootstrapChannels =
    opts.wipeAllMessagesInBootstrapChannels === true &&
    opts.wipeAllMessagesAuthorized === true;

  const adminRoleName = (opts.adminRoleName && String(opts.adminRoleName).trim()) || 'PlayBound Admin';
  const modRoleName = (opts.modRoleName && String(opts.modRoleName).trim()) || 'PlayBound Moderator';

  const summary = {
    dryRun,
    rolesCreated: [],
    rolesSkipped: [],
    categoriesCreated: [],
    categoriesSkipped: [],
    channelsCreated: [],
    channelsSkipped: [],
    channelsUpdated: [],
    channelsRenamed: [],
    conflicts: [],
    wipedSetupMessages: 0,
    channelsCleared: [],
    wouldWipeSetup: [],
    wouldWipeChannels: [],
    pinsCreated: [],
    pinsSkipped: [],
    pinsRefreshed: [],
    failures: [],
    notes: [],
    permissionSyncCount: 0,
    templateVersion: SUPPORT_BOOTSTRAP_TEMPLATE_VERSION,
    noteAdminTools: ADMIN_TOOLS_PUBLIC_VIEW
      ? 'admin-tools: public read-only, staff can send.'
      : 'admin-tools: staff-only.',
  };

  if (!dryRun) assertBotPermissions(botMember);

  const roleNameByKey = {
    [ROLE_KEYS.admin]: adminRoleName,
    [ROLE_KEYS.mod]: modRoleName,
    [ROLE_KEYS.factionLeader]: 'Faction Leader',
    [ROLE_KEYS.botManager]: 'Bot Manager',
  };

  const rolesByKey = {};

  for (const def of ROLE_DEFS) {
    const targetName = roleNameByKey[def.key];
    const existing = findRoleByConfiguredName(guild, targetName);
    if (existing) {
      rolesByKey[def.key] = existing;
      summary.rolesSkipped.push(targetName);
      continue;
    }
    if (dryRun) {
      summary.rolesCreated.push(targetName);
      continue;
    }
    try {
      const role = await guild.roles.create({
        name: targetName,
        mentionable: false,
        permissions: [],
        reason: 'PlayBound support bootstrap',
      });
      rolesByKey[def.key] = role;
      summary.rolesCreated.push(targetName);
    } catch (e) {
      summary.failures.push(`Role "${targetName}": ${e.message}`);
    }
  }

  if (!dryRun) {
    for (const def of ROLE_DEFS) {
      if (!rolesByKey[def.key]) {
        const role = findRoleByConfiguredName(guild, roleNameByKey[def.key]);
        if (role) rolesByKey[def.key] = role;
      }
    }
    for (const def of ROLE_DEFS) {
      if (!rolesByKey[def.key]) {
        summary.failures.push(`Missing role "${roleNameByKey[def.key]}" — fix role creation and rerun.`);
      }
    }
    if (ROLE_DEFS.some((d) => !rolesByKey[d.key])) return summary;
  }

  const categoryMap = new Map();

  for (const catDef of CATEGORY_LAYOUT) {
    let cat = findCategoryByName(guild, catDef.name);
    if (!cat && catDef.legacyNames?.length) {
      for (const legacy of catDef.legacyNames) {
        const legacyCat = findCategoryByName(guild, legacy);
        if (legacyCat) {
          cat = legacyCat;
          break;
        }
      }
    }

    if (cat) {
      summary.categoriesSkipped.push(catDef.name);
    } else if (dryRun) {
      summary.categoriesCreated.push(catDef.name);
    } else {
      try {
        cat = await guild.channels.create({
          name: catDef.name,
          type: ChannelType.GuildCategory,
          reason: 'PlayBound support bootstrap',
        });
        summary.categoriesCreated.push(catDef.name);
      } catch (e) {
        summary.failures.push(`Category "${catDef.name}": ${e.message}`);
        continue;
      }
    }

    if (cat && !dryRun) {
      if (cat.name !== catDef.name) {
        try {
          const prev = cat.name;
          await cat.setName(catDef.name, 'PlayBound support bootstrap: category rename');
          summary.channelsRenamed.push(`category:${prev} → ${catDef.name}`);
        } catch (e) {
          summary.failures.push(`Category rename "${cat.name}": ${e.message}`);
        }
      }

      try {
        const preset = catDef.name === 'admin' ? 'admin_category' : 'public_text';
        const overwrites = buildOverwrites(guild, rolesByKey, preset);
        await cat.permissionOverwrites.set(overwrites, 'PlayBound bootstrap: category permissions');
        categoryMap.set(catDef.name, cat);
      } catch (e) {
        summary.failures.push(`Category perms "${catDef.name}": ${e.message}`);
      }
    }
  }

  await guild.channels.fetch().catch(() => {});

  if (dryRun) {
    if (opts.wipeAllMessagesInBootstrapChannels === true && !opts.wipeAllMessagesAuthorized) {
      summary.failures.push('wipe_all_messages_in_bootstrap_channels requires explicit authorization.');
    }

    for (const catDef of CATEGORY_LAYOUT) {
      const cat =
        findCategoryByName(guild, catDef.name) ||
        (catDef.legacyNames || []).map((n) => findCategoryByName(guild, n)).find(Boolean);

      if (!cat) {
        for (const chDef of catDef.channels) {
          summary.channelsCreated.push(`${catDef.name}/#${chDef.name} (needs category)`);
          if (chDef.type === ChannelType.GuildText && chDef.pin) summary.pinsCreated.push(chDef.slug);
        }
        continue;
      }

      for (const chDef of catDef.channels) {
        const existing = findChannelInCategoryWithLegacy(cat, chDef);

        if (existing && chDef.type === ChannelType.GuildText) {
          if (wipeAllMessagesInBootstrapChannels) {
            const msgs = await iterChannelMessages(existing).catch(() => []);
            summary.wouldWipeChannels.push(`#${existing.name}: ${msgs.length} messages`);
          } else if (wipeBootstrapMessages && chDef.pin) {
            const re = markerRegexForChannelSlugs(chDef);
            const msgs = await iterChannelMessages(existing).catch(() => []);
            const n = msgs.filter(
              (m) =>
                m.author.id === client.user.id &&
                (re.test(m.content || '') ||
                  (chDef.embed &&
                    m.embeds?.length > 0 &&
                    embedMatchesChDef(m.embeds[0], chDef))),
            ).length;
            if (n > 0) summary.wouldWipeSetup.push(`#${existing.name}: ${n} setup message(s)`);
          }
        }

        if (!existing) {
          summary.channelsCreated.push(`${catDef.name}/#${chDef.name}`);
          if (chDef.type === ChannelType.GuildText && chDef.pin) summary.pinsCreated.push(chDef.slug);
        } else {
          summary.channelsSkipped.push(`${catDef.name}/#${chDef.name}`);
          if (existing.name.toLowerCase() !== chDef.name.toLowerCase()) {
            summary.channelsRenamed.push(`would rename #${existing.name} → #${chDef.name}`);
          }
          if (chDef.type === ChannelType.GuildText && chDef.pin) summary.pinsSkipped.push(chDef.slug);
        }
      }
    }

    return summary;
  }

  for (const catDef of CATEGORY_LAYOUT) {
    const cat =
      findCategoryByName(guild, catDef.name) ||
      (catDef.legacyNames || []).map((n) => findCategoryByName(guild, n)).find(Boolean) ||
      categoryMap.get(catDef.name);

    if (!cat) continue;

    for (const chDef of catDef.channels) {
      let ch = findChannelInCategoryWithLegacy(cat, chDef);

      if (ch && ch.name.toLowerCase() !== chDef.name.toLowerCase()) {
        const taken = findChannelInCategory(cat, chDef.name, chDef.type);
        if (taken && taken.id !== ch.id) {
          summary.conflicts.push(`#${chDef.name} already exists; leaving legacy #${ch.name} in place`);
          ch = taken;
        } else {
          try {
            const prev = ch.name;
            await ch.setName(chDef.name, 'PlayBound support bootstrap: channel rename');
            summary.channelsRenamed.push(`#${prev} → #${chDef.name}`);
          } catch (e) {
            summary.failures.push(`Rename #${ch.name}: ${e.message}`);
          }
        }
      }

      if (!ch) {
        try {
          ch = await guild.channels.create({
            name: chDef.name,
            type: chDef.type,
            parent: cat.id,
            topic: chDef.type === ChannelType.GuildText ? (chDef.topic || undefined) : undefined,
            reason: 'PlayBound support bootstrap',
          });
          summary.channelsCreated.push(`#${chDef.name}`);
        } catch (e) {
          summary.failures.push(`Channel #${chDef.name}: ${e.message}`);
          continue;
        }
      } else {
        summary.channelsSkipped.push(`#${chDef.name}`);
        if (!createMissingOnly && chDef.type === ChannelType.GuildText && chDef.topic && ch.topic !== chDef.topic) {
          try {
            await ch.setTopic(chDef.topic, 'PlayBound support bootstrap');
            summary.channelsUpdated.push(`#${chDef.name} topic`);
          } catch (e) {
            summary.failures.push(`Topic #${chDef.name}: ${e.message}`);
          }
        }
      }

      try {
        const overwrites = buildOverwrites(guild, rolesByKey, chDef.perm);
        await ch.permissionOverwrites.set(overwrites, 'PlayBound bootstrap: channel perms');
        summary.permissionSyncCount += 1;
        summary.channelsUpdated.push(`#${chDef.name} (permissions)`);
      } catch (e) {
        summary.failures.push(`Perms #${chDef.name}: ${e.message}`);
      }

      if (chDef.type !== ChannelType.GuildText || !chDef.pin) continue;

      if (wipeAllMessagesInBootstrapChannels) {
        const { deleted, failed } = await wipeAllMessagesInTextChannel(ch);
        summary.channelsCleared.push(`#${chDef.name}: deleted ${deleted}${failed ? `, ${failed} failed` : ''}`);
      } else if (wipeBootstrapMessages) {
        summary.wipedSetupMessages += await wipeBootstrapMarkedInChannel(ch, chDef, client, summary);
      }

      try {
        const existingPin = await findExistingSetupPinAny(ch, chDef, client);
        const upToDate = existingPin && bootstrapPinMatchesTemplate(existingPin, chDef);

        if (existingPin && !forceRepin) {
          if (upToDate) {
            summary.pinsSkipped.push(chDef.slug);
            continue;
          }
          if (!hasAnySetupMarker(existingPin.content, chDef) && stripSetupPinBodyAnySlug(existingPin.content, chDef) === chDef.pin.trim()) {
            await existingPin.edit({ content: fullPinContent(chDef.slug, chDef.pin) });
            summary.pinsRefreshed.push(`${chDef.slug} (marker upgrade)`);
            continue;
          }
          summary.pinsSkipped.push(chDef.slug);
          continue;
        }

        if (existingPin && forceRepin) {
          await existingPin.unpin().catch(() => {});
          await existingPin.delete().catch(() => {});
          await sendPinnedSetupMessage(ch, chDef, summary);
          summary.pinsRefreshed.push(chDef.slug);
          continue;
        }

        await sendPinnedSetupMessage(ch, chDef, summary);
        summary.pinsCreated.push(chDef.slug);
      } catch (e) {
        summary.failures.push(`Pin #${chDef.name}: ${e.message}`);
      }
    }
  }

  try {
    const all = await guild.channels.fetch();
    let pos = 0;
    for (const catDef of CATEGORY_LAYOUT) {
      const cat = all.find((c) => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === catDef.name.toLowerCase());
      if (!cat) continue;
      await cat.setPosition(pos++, { relative: false }).catch(() => {});
      for (const chDef of catDef.channels) {
        const child = cat.children.cache.find((c) => c.name.toLowerCase() === chDef.name.toLowerCase());
        if (child) await child.setPosition(pos++, { relative: false }).catch(() => {});
      }
    }
  } catch (e) {
    summary.failures.push(`Reorder: ${e.message}`);
  }

  summary.notes.push('Channels with full support panels do not also get redundant bootstrap pins.');
  summary.notes.push('Voice channels cannot have pinned posts; voice instructions live in #voice-channel-game-instructions.');
  if (wipeAllMessagesInBootstrapChannels) summary.notes.push('Full wipe mode was enabled for managed text channels.');

  return summary;
}

function formatBootstrapSummary(s) {
  const lines = [];
  lines.push(s.dryRun ? '**Dry run complete.** No changes made.\n' : '**Bootstrap complete.**\n');
  lines.push(`Template v${s.templateVersion} · ${s.noteAdminTools}\n`);

  const sec = (title, arr) => {
    if (!arr || !arr.length) return;
    lines.push(
      `**${title}** (${arr.length})\n${arr.slice(0, 25).map((x) => `• ${x}`).join('\n')}${arr.length > 25 ? `\n• … +${arr.length - 25} more` : ''}\n`
    );
  };

  sec('Created · roles', s.rolesCreated);
  sec('Created · categories', s.categoriesCreated);
  sec('Created · channels', s.channelsCreated);
  sec('Created · pins', s.pinsCreated);
  sec('Renamed', s.channelsRenamed);

  if (s.wipedSetupMessages > 0) sec('Wiped setup messages', [`${s.wipedSetupMessages} removed`]);
  sec('Channels cleared (full wipe)', s.channelsCleared);
  sec('Updated · channels / perms', s.channelsUpdated);
  sec('Refreshed pins', s.pinsRefreshed);
  sec('Skipped · roles', s.rolesSkipped);
  sec('Skipped · categories', s.categoriesSkipped);
  sec('Skipped · channels', s.channelsSkipped);
  sec('Skipped · pins', s.pinsSkipped);
  sec('Conflicts / manual follow-ups', s.conflicts);

  if (s.dryRun) {
    sec('Would wipe · setup messages', s.wouldWipeSetup);
    sec('Would wipe · full channel history', s.wouldWipeChannels);
  }

  sec('Missing / failed', s.failures);
  sec('Notes', s.notes);

  if (!s.failures.length && !s.dryRun) lines.push('**Failures:** none\n');

  const out = lines.join('\n');
  return out.length > 1950 ? `${out.slice(0, 1880)}\n\n…(truncated)` : out;
}

module.exports = {
  runBootstrapSupportServer,
  formatBootstrapSummary,
  SUPPORT_BOOTSTRAP_TEMPLATE_VERSION,
  SETUP_PIN_VER,
  CATEGORY_LAYOUT,
};