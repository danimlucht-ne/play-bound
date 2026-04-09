'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    userHasCosmeticOrEquipped,
    shouldHideShopItemForUser,
    filterOwnedShopItems,
    isDuplicateShopPurchase,
} = require('../lib/shopOwnership');

test('userHasCosmeticOrEquipped detects inventory and equipped Map values', () => {
    assert.equal(userHasCosmeticOrEquipped({ inventory: ['a', 'b'] }, 'a'), true);
    assert.equal(userHasCosmeticOrEquipped({ inventory: ['x'] }, 'y'), false);
    const m = new Map([['slot', 'equipped-id']]);
    assert.equal(userHasCosmeticOrEquipped({ inventory: [], currentCosmetics: m }, 'equipped-id'), true);
    assert.equal(userHasCosmeticOrEquipped({ inventory: [], currentCosmetics: m }, 'other'), false);
});

test('userHasCosmeticOrEquipped reads plain-object currentCosmetics', () => {
    assert.equal(
        userHasCosmeticOrEquipped({ inventory: [], currentCosmetics: { badge: 'bid', color: 'cid' } }, 'cid'),
        true,
    );
});

test('consumables are never hidden or duplicate-blocked', () => {
    const user = { inventory: ['potion'], currentCosmetics: new Map() };
    const item = { id: 'potion', type: 'consumable' };
    assert.equal(shouldHideShopItemForUser(user, { roles: { cache: new Map() } }, item), false);
    assert.equal(isDuplicateShopPurchase(user, null, item), false);
});

test('badges/colors hide when owned or equipped', () => {
    const item = { id: 'badge_x', type: 'badge' };
    assert.equal(shouldHideShopItemForUser({ inventory: [], currentCosmetics: new Map() }, null, item), false);
    assert.equal(shouldHideShopItemForUser({ inventory: ['badge_x'], currentCosmetics: new Map() }, null, item), true);
    assert.equal(
        shouldHideShopItemForUser(
            { inventory: [], currentCosmetics: new Map([['badge', 'badge_x']]) },
            null,
            item,
        ),
        true,
    );
});

test('filterOwnedShopItems returns all items when user is missing', () => {
    const items = [{ id: '1', type: 'badge' }];
    assert.deepEqual(filterOwnedShopItems(items, null, null), items);
});

test('role shop rows hide when member already has roleId', () => {
    const user = { inventory: [], currentCosmetics: new Map() };
    const item = { id: 'vip', type: 'role', roleId: 'role-99' };
    const memberNo = { roles: { cache: new Map() } };
    const memberYes = { roles: { cache: new Map([['role-99', true]]) } };
    assert.equal(shouldHideShopItemForUser(user, memberNo, item), false);
    assert.equal(memberYes.roles.cache.has('role-99'), true);
    assert.equal(shouldHideShopItemForUser(user, memberYes, item), true);
});

test('role without roleId or member is not treated as duplicate', () => {
    const user = { inventory: [], currentCosmetics: new Map() };
    const item = { id: 'vip', type: 'role', roleId: null };
    assert.equal(shouldHideShopItemForUser(user, { roles: { cache: new Map([['r', true]]) } }, item), false);
});
