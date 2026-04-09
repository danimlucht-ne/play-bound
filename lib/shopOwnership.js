'use strict';

/**
 * @param {object} user — User doc / lean: `inventory` array, `currentCosmetics` Map or plain object
 * @param {string} itemId
 * @returns {boolean}
 */
function userHasCosmeticOrEquipped(user, itemId) {
    const id = String(itemId);
    const inv = user.inventory || [];
    if (inv.some((x) => String(x) === id)) return true;
    const cc = user.currentCosmetics;
    if (!cc) return false;
    if (typeof cc.get === 'function') {
        for (const v of cc.values()) {
            if (String(v) === id) return true;
        }
    } else if (typeof cc === 'object') {
        for (const k of Object.keys(cc)) {
            if (String(cc[k]) === id) return true;
        }
    }
    return false;
}

/**
 * Omit from catalog / block duplicate purchase: non-consumables (badges, colors, misc) the user already
 * has in inventory or has equipped, and role shop rows when the member already has that Discord role.
 *
 * @param {object} user
 * @param {import('discord.js').GuildMember|null|undefined} member
 * @param {{ id: string, type?: string, roleId?: string|null }} item
 */
function shouldHideShopItemForUser(user, member, item) {
    const t = item.type || 'consumable';
    if (t === 'consumable') return false;
    if (t === 'role') {
        const rid = item.roleId;
        if (!rid || !member?.roles?.cache?.has) return false;
        return member.roles.cache.has(rid);
    }
    return userHasCosmeticOrEquipped(user, item.id);
}

/**
 * @param {object[]} items — plain `{ id, type, roleId, ... }`
 * @param {object} user
 * @param {import('discord.js').GuildMember|null|undefined} member
 */
function filterOwnedShopItems(items, user, member) {
    if (!user || !Array.isArray(items)) return items || [];
    return items.filter((it) => !shouldHideShopItemForUser(user, member, it));
}

/**
 * Block buying another copy of a non-consumable (or role) the user already has.
 */
function isDuplicateShopPurchase(user, member, item) {
    return shouldHideShopItemForUser(user, member, item);
}

module.exports = {
    userHasCosmeticOrEquipped,
    shouldHideShopItemForUser,
    filterOwnedShopItems,
    isDuplicateShopPurchase,
};
