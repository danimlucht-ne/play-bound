# Real DB Testing

This repo now has an opt-in integration layer for testing against a real Mongo database without touching production.

## Safety model

- These tests do **not** run under `npm test`.
- They only run when both of these are set:
  - `PLAYBOUND_ALLOW_DB_TESTS=1`
  - `TEST_MONGO_URI=<dedicated test or staging Mongo URI>`
- The harness also refuses URIs that do not look isolated unless they clearly look like a test/staging target.

## Command

```powershell
$env:PLAYBOUND_ALLOW_DB_TESTS = "1"
$env:TEST_MONGO_URI = "mongodb://127.0.0.1:27017"
$env:TEST_MONGO_DB = "playbound_integration_local"
npm run test:db:integration
```

## What it covers right now

- concurrent `getUser()` creation
- concurrent `getSystemConfig()` creation
- active game create/update/end roundtrip
- manual point-adjustment persistence

## What this is for

Use this layer for:

- Mongo write/read behavior that mocks can hide
- duplicate-key race checks
- state persistence checks
- future concurrent economy/faction/game lifecycle tests

## What should come next

- concurrent economy tests for `/pay`, `/daily`, and giveaway entry
- faction enrollment races
- leaderboard snapshot/reset tests against real Mongo
- staging integration runs against a dedicated non-production Atlas database
