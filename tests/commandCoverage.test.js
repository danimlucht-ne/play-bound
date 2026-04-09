const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { commands } = require('../deploy-commands.js');

function extractCommandNamesFromSource(source) {
    const names = new Set();
    const regex = /commandName\s*(?:===|!==)\s*'([^']+)'/g;
    let match;
    while ((match = regex.exec(source))) {
        names.add(match[1]);
    }
    return names;
}

test('all registered slash commands have runtime handlers', () => {
    const interactionSource = fs.readFileSync(
        path.join(__dirname, '..', 'src', 'events', 'interactionCreate.js'),
        'utf8',
    );
    const supportSource = fs.readFileSync(
        path.join(__dirname, '..', 'lib', 'supportServerAdminCommands.js'),
        'utf8',
    );
    const gameSources = fs
        .readdirSync(path.join(__dirname, '..', 'games'))
        .filter((file) => file.endsWith('.js'))
        .map((file) =>
            fs.readFileSync(path.join(__dirname, '..', 'games', file), 'utf8'),
        );

    const handledNames = new Set([
        ...extractCommandNamesFromSource(interactionSource),
        ...extractCommandNamesFromSource(supportSource),
        ...gameSources.flatMap((source) => [...extractCommandNamesFromSource(source)]),
    ]);

    const registeredNames = new Set(commands.map((cmd) => cmd.name));
    const missingHandlers = [...registeredNames].filter((name) => !handledNames.has(name));

    assert.deepEqual(
        missingHandlers,
        [],
        `Registered commands without runtime handlers: ${missingHandlers.join(', ')}`,
    );
});

test('runtime command handlers correspond to registered slash commands', () => {
    const interactionSource = fs.readFileSync(
        path.join(__dirname, '..', 'src', 'events', 'interactionCreate.js'),
        'utf8',
    );
    const supportSource = fs.readFileSync(
        path.join(__dirname, '..', 'lib', 'supportServerAdminCommands.js'),
        'utf8',
        );
    const gameSources = fs
        .readdirSync(path.join(__dirname, '..', 'games'))
        .filter((file) => file.endsWith('.js'))
        .map((file) =>
            fs.readFileSync(path.join(__dirname, '..', 'games', file), 'utf8'),
        );

    const handledNames = new Set([
        ...extractCommandNamesFromSource(interactionSource),
        ...extractCommandNamesFromSource(supportSource),
        ...gameSources.flatMap((source) => [...extractCommandNamesFromSource(source)]),
    ]);
    const registeredNames = new Set(commands.map((cmd) => cmd.name));

    const allowedUnregistered = new Set([
        // `duel_trivia` is registered; some branches still compare `commandName === 'duel'`.
        'duel',
    ]);

    const unexpectedHandlers = [...handledNames].filter(
        (name) => !registeredNames.has(name) && !allowedUnregistered.has(name),
    );

    assert.deepEqual(
        unexpectedHandlers,
        [],
        `Runtime handlers without registered slash commands: ${unexpectedHandlers.join(', ')}`,
    );
});
