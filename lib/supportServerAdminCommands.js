'use strict';

const { PermissionFlagsBits } = require('discord.js');
const {
  runBootstrapSupportServer,
  formatBootstrapSummary,
} = require('./bootstrapSupportServer');
const supportPanels = require('./supportPanels');
const postSupportPanels = supportPanels.postSupportPanels;
const formatSupportPanelSummary =
  supportPanels.formatSupportPanelSummary ||
  ((summary) => `Panels updated successfully. Created: ${summary?.created?.length || 0}. Updated: ${summary?.updated?.length || 0}.`);

async function handleSupportServerAdminCommands(interaction) {
  if (!interaction.isChatInputCommand()) return false;

  const { commandName } = interaction;

  if (commandName === 'bootstrap_support_server') {
    const dryRun = interaction.options.getBoolean('dry_run') ?? false;
    const forceRepin = interaction.options.getBoolean('force_repin') ?? false;
    const createMissingOnly =
      interaction.options.getBoolean('create_missing_only') ?? true;
    const wipeBootstrapMessages =
      interaction.options.getBoolean('wipe_bootstrap_messages') ?? false;
    const wipeAllManagedChannels =
      interaction.options.getBoolean('wipe_all_managed_channels') ?? false;

    const adminRoleName = interaction.options.getString('admin_role_name') || undefined;
    const modRoleName = interaction.options.getString('mod_role_name') || undefined;

    await interaction.reply({
      content: dryRun
        ? 'Running bootstrap preview...'
        : 'Bootstrapping PlayBound support server...',
      ephemeral: true,
    });

    try {
      const summary = await runBootstrapSupportServer(
        interaction.guild,
        interaction.guild.members.me,
        interaction.client,
        {
          dryRun,
          forceRepin,
          createMissingOnly,
          wipeBootstrapMessages,
          wipeAllMessagesInBootstrapChannels: wipeAllManagedChannels,
          wipeAllMessagesAuthorized:
            interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false,
          adminRoleName,
          modRoleName,
        },
      );

      await interaction.editReply({
        content: formatBootstrapSummary(summary),
      });
    } catch (err) {
      await interaction.editReply({
        content:
          `bootstrap_support_server failed.\n\n` +
          `Details: ${err?.message || 'Unknown error'}`,
      });
    }

    return true;
  }

  if (commandName === 'setup_panels') {
    const wipePanelChannels = interaction.options.getBoolean('wipe_panel_channels') ?? false;

    await interaction.reply({
      content: wipePanelChannels
        ? 'Resetting panel channels and posting fresh PlayBound panels...'
        : 'Setting up PlayBound panels...',
      ephemeral: true,
    });

    try {
      const summary = await postSupportPanels(interaction.guild, { wipePanelChannels });

      await interaction.editReply({
        content: formatSupportPanelSummary(summary),
      });
    } catch (err) {
      await interaction.editReply({
        content:
          `setup_panels failed.\n\n` +
          `Details: ${err?.message || 'Unknown error'}`,
      });
    }

    return true;
  }

  return false;
}

module.exports = { handleSupportServerAdminCommands };
