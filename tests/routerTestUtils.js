const path = require('node:path');
const express = require('express');

function makeCacheModule(absPath, exports) {
    return {
        id: absPath,
        filename: absPath,
        loaded: true,
        exports,
    };
}

function withMockedModules(mockMap, loadFn) {
    const touched = [];
    try {
        for (const [absPath, exports] of Object.entries(mockMap)) {
            touched.push([absPath, require.cache[absPath]]);
            require.cache[absPath] = makeCacheModule(absPath, exports);
        }
        return loadFn();
    } finally {
        for (const [absPath, previous] of touched.reverse()) {
            if (previous) require.cache[absPath] = previous;
            else delete require.cache[absPath];
        }
    }
}

async function withServer(router, opts, run) {
    const app = express();
    app.use(express.json());
    app.locals.playbound = opts?.locals?.playbound || {};
    if (opts?.session !== undefined) {
        app.use((req, res, next) => {
            req.pbSession = opts.session;
            next();
        });
    }
    app.use('/api', router);

    const server = await new Promise((resolve) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });

    try {
        const { port } = server.address();
        const baseUrl = `http://127.0.0.1:${port}/api`;
        return await run(baseUrl);
    } finally {
        await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
}

function clearModule(absPath) {
    delete require.cache[absPath];
}

function repoPath(...parts) {
    return path.join(__dirname, '..', ...parts);
}

module.exports = {
    clearModule,
    repoPath,
    withMockedModules,
    withServer,
};
