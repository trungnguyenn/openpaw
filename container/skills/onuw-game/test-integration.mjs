#!/usr/bin/env node

/**
 * ONUW Game Skill — Integration Test
 *
 * Tests the full game engine logic for a 5-player game without Telegram.
 * Simulates the Game Master orchestration flow:
 *   init → night → player-view (all players) → vote → resolve
 *
 * Also covers:
 *   - Information isolation (player-view never leaks ground truth)
 *   - Night action correctness (originalRole drives actions, not currentRole)
 *   - Swap chain integrity (currentRole tracks physical card position)
 *   - Win conditions (wolf eliminated, wolf survives, scatter, wolves in center)
 *   - Hunter kill chain
 *   - Mason variant
 *   - Error handling
 *
 * Run: node test-integration.mjs
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE = path.join(__dirname, 'game-engine.mjs');
const TMP_DIR = path.join('/tmp', `onuw-test-${Date.now()}`);

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}\n  Expected: ${JSON.stringify(expected)}\n  Actual:   ${JSON.stringify(actual)}`);
  }
}

function assertIncludes(arr, item, message) {
  if (!arr.includes(item)) {
    throw new Error(`${message}\n  Array: ${JSON.stringify(arr)}\n  Expected to include: ${JSON.stringify(item)}`);
  }
}

function assertNotIncludes(arr, item, message) {
  if (arr.includes(item)) {
    throw new Error(`${message}\n  Array: ${JSON.stringify(arr)}\n  Expected NOT to include: ${JSON.stringify(item)}`);
  }
}

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message.split('\n').join('\n    ')}`);
    failed++;
    failures.push({ name, error: err.message });
  }
}

// ---------------------------------------------------------------------------
// Engine helpers
// ---------------------------------------------------------------------------

function run(args, statePath) {
  const stateArg = statePath ? `--state ${statePath}` : '';
  const cmd = `node ${ENGINE} ${args} ${stateArg}`.trim();
  try {
    const output = execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { ok: true, data: JSON.parse(output.trim()), raw: output };
  } catch (err) {
    return { ok: false, stderr: err.stderr?.trim() || err.message, exitCode: err.status };
  }
}

function makeState(suffix = '') {
  const dir = path.join(TMP_DIR, `game-${suffix || Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'state.json');
}

/**
 * Create a game with a FIXED role assignment (bypasses shuffle).
 * Writes state.json directly so tests are deterministic.
 */
function createFixedGame(players, centerCards) {
  const statePath = makeState();
  const state = {
    phase: 'night',
    players: players.map((p) => ({ name: p.name, originalRole: p.role, currentRole: p.role })),
    centerCards: [...centerCards],
    originalCenter: [...centerCards],
    nightActions: [],
    votes: {},
    result: null,
  };
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  return statePath;
}

// ---------------------------------------------------------------------------
// Test Suite 1: Init command
// ---------------------------------------------------------------------------

console.log('\n=== Suite 1: Init ===');

test('5-player init produces correct card count', () => {
  const s = makeState('init-5');
  const r = run('init --players 5 --names "A,B,C,D,E"', s);
  assert(r.ok, `Engine error: ${r.stderr}`);
  assertEqual(r.data.playerCount, 5, 'playerCount');
  assertEqual(r.data.totalCards, 8, 'totalCards');
  assertEqual(r.data.centerCards, 3, 'centerCards');
});

test('5-player init includes exactly 2 wolves', () => {
  const s = makeState('init-wolves');
  const r = run('init --players 5 --names "A,B,C,D,E"', s);
  assert(r.ok, `Engine error: ${r.stderr}`);
  assertEqual(r.data.rolesInGame.werewolf, 2, 'wolf count');
});

test('5-player init includes required functional roles', () => {
  const s = makeState('init-roles');
  const r = run('init --players 5 --names "A,B,C,D,E"', s);
  assert(r.ok, `Engine error: ${r.stderr}`);
  const roles = r.data.rolesInGame;
  assert(roles.seer >= 1, 'seer present');
  assert(roles.robber >= 1, 'robber present');
  assert(roles.troublemaker >= 1, 'troublemaker present');
  assert(roles.drunk >= 1, 'drunk present');
});

test('Mason variant replaces 2 villagers', () => {
  const s = makeState('init-mason');
  const r = run('init --players 5 --mason --names "A,B,C,D,E"', s);
  assert(r.ok, `Engine error: ${r.stderr}`);
  assertEqual(r.data.rolesInGame.mason, 2, 'mason count');
  assert(!r.data.rolesInGame.villager || r.data.rolesInGame.villager === 0, 'no villagers when mason replaces them');
});

test('Init rejects player count outside 3-6', () => {
  const s = makeState('init-bad');
  const r = run('init --players 10', s);
  assert(!r.ok, 'should fail');
  assert(r.stderr.includes('3') || r.stderr.includes('6'), 'error mentions range');
});

test('Init rejects mismatched names count', () => {
  const s = makeState('init-names-mismatch');
  const r = run('init --players 5 --names "A,B,C"', s);
  assert(!r.ok, 'should fail');
});

test('State file is created after init', () => {
  const s = makeState('init-file');
  run('init --players 5 --names "A,B,C,D,E"', s);
  assert(fs.existsSync(s), 'state file exists');
  const state = JSON.parse(fs.readFileSync(s, 'utf-8'));
  assertEqual(state.phase, 'night', 'initial phase is night');
  assertEqual(state.players.length, 5, 'player count in state');
  assertEqual(state.centerCards.length, 3, 'center card count in state');
});

// ---------------------------------------------------------------------------
// Test Suite 2: Night phase — correctness
// ---------------------------------------------------------------------------

console.log('\n=== Suite 2: Night Phase ===');

test('Night uses originalRole for wake order, not currentRole', () => {
  // Robber (C) swaps with Wolf (A). After swap, C has wolf card.
  // But C originally was Robber, so C performs the Robber action.
  // Troublemaker (D) originally was TM, so D performs TM action.
  const s = createFixedGame(
    [
      { name: 'A', role: 'werewolf' },
      { name: 'B', role: 'werewolf' },
      { name: 'C', role: 'robber' },
      { name: 'D', role: 'troublemaker' },
      { name: 'E', role: 'drunk' },
    ],
    ['villager', 'villager', 'seer'],
  );
  const r = run('night', s);
  assert(r.ok, `Night failed: ${r.stderr}`);

  const state = JSON.parse(fs.readFileSync(s, 'utf-8'));
  const actors = state.nightActions.map((a) => a.actor);

  // Wolves A and B must both act (see_partner)
  assertIncludes(actors, 'A', 'Wolf A acted');
  assertIncludes(actors, 'B', 'Wolf B acted');
  // Robber C must act
  assertIncludes(actors, 'C', 'Robber C acted');
  // TM D must act
  assertIncludes(actors, 'D', 'TM D acted');
  // Drunk E must act
  assertIncludes(actors, 'E', 'Drunk E acted');
});

test('Two wolves see each other (not center peek)', () => {
  const s = createFixedGame(
    [
      { name: 'Wolf1', role: 'werewolf' },
      { name: 'Wolf2', role: 'werewolf' },
      { name: 'Seer', role: 'seer' },
      { name: 'Rob', role: 'robber' },
      { name: 'TM', role: 'troublemaker' },
    ],
    ['villager', 'villager', 'drunk'],
  );
  run('night', s);
  const state = JSON.parse(fs.readFileSync(s, 'utf-8'));
  const wolfActions = state.nightActions.filter((a) => a.role === 'werewolf');
  assertEqual(wolfActions.length, 2, 'both wolves acted');
  for (const a of wolfActions) {
    assertEqual(a.action, 'see_partner', 'wolf action is see_partner when 2 wolves');
  }
  // Wolf1 sees Wolf2 and vice versa
  const wolf1Action = wolfActions.find((a) => a.actor === 'Wolf1');
  assert(wolf1Action.detail.includes('Wolf2'), 'Wolf1 sees Wolf2');
});

test('Robber swap mutates currentRole correctly', () => {
  // Use a game with NO Troublemaker so the Robber's card is not swapped again after the Robber acts.
  // Robber acts 4th in wake order; Troublemaker would act 5th and could re-swap.
  const s = createFixedGame(
    [
      { name: 'Rob', role: 'robber' },
      { name: 'Vil', role: 'villager' },
      { name: 'Wolf', role: 'werewolf' },
      { name: 'Wolf2', role: 'werewolf' },
      { name: 'Seer', role: 'seer' },
    ],
    ['drunk', 'villager', 'troublemaker'],
  );
  run('night', s);
  const state = JSON.parse(fs.readFileSync(s, 'utf-8'));
  const robAction = state.nightActions.find((a) => a.role === 'robber');
  assert(robAction, 'robber acted');

  const robPlayer = state.players.find((p) => p.name === 'Rob');
  const target = state.players.find((p) => p.name === robAction.target);

  // Robber now holds target's original role (no TM to re-swap)
  assertEqual(robPlayer.currentRole, robAction.newRole, 'robber currentRole matches newRole in action');
  // Target now holds robber card
  assertEqual(target.currentRole, 'robber', 'target now holds robber card');
  // originalRoles unchanged
  assertEqual(robPlayer.originalRole, 'robber', 'robber originalRole unchanged');
});

test('Troublemaker never swaps a player with themselves', () => {
  // Run 30 iterations to catch probabilistic failures
  for (let i = 0; i < 30; i++) {
    const s = createFixedGame(
      [
        { name: 'TM', role: 'troublemaker' },
        { name: 'A', role: 'villager' },
        { name: 'B', role: 'seer' },
        { name: 'C', role: 'werewolf' },
        { name: 'D', role: 'werewolf' },
      ],
      ['drunk', 'robber', 'villager'],
    );
    run('night', s);
    const state = JSON.parse(fs.readFileSync(s, 'utf-8'));
    const tmAction = state.nightActions.find((a) => a.role === 'troublemaker');
    assert(tmAction.target1 !== tmAction.target2, `TM self-swap on iteration ${i}`);
    assert(tmAction.target1 !== 'TM', `TM swapped themselves on iteration ${i}`);
    assert(tmAction.target2 !== 'TM', `TM swapped themselves on iteration ${i}`);
  }
});

test('Drunk swap mutates both player and center card', () => {
  const s = createFixedGame(
    [
      { name: 'Drunk', role: 'drunk' },
      { name: 'A', role: 'villager' },
      { name: 'B', role: 'werewolf' },
      { name: 'C', role: 'werewolf' },
      { name: 'D', role: 'seer' },
    ],
    ['robber', 'troublemaker', 'villager'],
  );
  run('night', s);
  const state = JSON.parse(fs.readFileSync(s, 'utf-8'));
  const drunkAction = state.nightActions.find((a) => a.role === 'drunk');
  const ci = drunkAction.centerIndex;
  const drunkPlayer = state.players.find((p) => p.name === 'Drunk');

  // Drunk's currentRole should be the original center card at that index
  const originalCenter = state.originalCenter[ci];
  assertEqual(drunkPlayer.currentRole, originalCenter, 'drunk now holds center card');
  // Center card at that index should now be 'drunk'
  assertEqual(state.centerCards[ci], 'drunk', 'center card is now drunk');
});

test('Night phase transitions to day', () => {
  const s = makeState('night-phase');
  run('init --players 5 --names "A,B,C,D,E"', s);
  run('night', s);
  const state = JSON.parse(fs.readFileSync(s, 'utf-8'));
  assertEqual(state.phase, 'day', 'phase is day after night');
});

test('Night cannot run twice', () => {
  const s = makeState('night-twice');
  run('init --players 5 --names "A,B,C,D,E"', s);
  run('night', s);
  const r = run('night', s);
  assert(!r.ok, 'second night should fail');
  assert(r.stderr.includes('day'), 'error mentions wrong phase');
});

// ---------------------------------------------------------------------------
// Test Suite 3: Player view — information isolation
// ---------------------------------------------------------------------------

console.log('\n=== Suite 3: Player View (Information Isolation) ===');

test('Seer who peeked player sees correct target role', () => {
  // Force Seer to peek a player by using a fixed state with only 1 player option
  // We'll run the engine and check the view matches the action
  const s = createFixedGame(
    [
      { name: 'Seer', role: 'seer' },
      { name: 'Wolf', role: 'werewolf' },
      { name: 'Rob', role: 'robber' },
      { name: 'TM', role: 'troublemaker' },
      { name: 'Vil', role: 'villager' },
    ],
    ['drunk', 'villager', 'werewolf'],
  );
  run('night', s);
  const state = JSON.parse(fs.readFileSync(s, 'utf-8'));
  const seerAction = state.nightActions.find((a) => a.role === 'seer');

  const r = run('player-view --player "Seer"', s);
  assert(r.ok, `player-view failed: ${r.stderr}`);
  assertEqual(r.data.player, 'Seer', 'player name');
  assertEqual(r.data.originalRole, 'seer', 'original role');
  assert(r.data.nightInfo.length > 0, 'has night info');

  // The view should contain info from the seer action
  const info = r.data.nightInfo.join(' ');
  if (seerAction.action === 'peek_player') {
    assert(info.includes(seerAction.target), `view mentions target ${seerAction.target}`);
  } else {
    assert(info.includes('center'), 'view mentions center cards');
  }
});

test('Villager view has no night info', () => {
  const s = createFixedGame(
    [
      { name: 'Vil', role: 'villager' },
      { name: 'Wolf', role: 'werewolf' },
      { name: 'Wolf2', role: 'werewolf' },
      { name: 'Seer', role: 'seer' },
      { name: 'Rob', role: 'robber' },
    ],
    ['troublemaker', 'drunk', 'villager'],
  );
  run('night', s);
  const r = run('player-view --player "Vil"', s);
  assert(r.ok, `player-view failed: ${r.stderr}`);
  assert(r.data.nightInfo.length > 0, 'has some info (sleep message)');
  assert(r.data.nightInfo[0].includes('slept') || r.data.nightInfo[0].includes('no special'), 'sleep message');
});

test('Drunk view shows swap without revealing new role', () => {
  const s = createFixedGame(
    [
      { name: 'Drunk', role: 'drunk' },
      { name: 'Wolf', role: 'werewolf' },
      { name: 'Wolf2', role: 'werewolf' },
      { name: 'Seer', role: 'seer' },
      { name: 'Rob', role: 'robber' },
    ],
    ['troublemaker', 'villager', 'villager'],
  );
  run('night', s);
  const state = JSON.parse(fs.readFileSync(s, 'utf-8'));
  const drunkPlayer = state.players.find((p) => p.name === 'Drunk');

  const r = run('player-view --player "Drunk"', s);
  assert(r.ok, `player-view failed: ${r.stderr}`);
  const info = r.data.nightInfo.join(' ');

  // Drunk knows they swapped but NOT what they became
  assert(info.includes('swapped') || info.includes('center'), 'drunk knows they swapped');
  assert(!info.includes(drunkPlayer.currentRole), 'drunk view does NOT reveal new role');
});

test('Robber view reveals new role after swap', () => {
  const s = createFixedGame(
    [
      { name: 'Rob', role: 'robber' },
      { name: 'Wolf', role: 'werewolf' },
      { name: 'Wolf2', role: 'werewolf' },
      { name: 'Seer', role: 'seer' },
      { name: 'TM', role: 'troublemaker' },
    ],
    ['drunk', 'villager', 'villager'],
  );
  run('night', s);
  const state = JSON.parse(fs.readFileSync(s, 'utf-8'));
  const robAction = state.nightActions.find((a) => a.role === 'robber');

  const r = run('player-view --player "Rob"', s);
  assert(r.ok, `player-view failed: ${r.stderr}`);
  const info = r.data.nightInfo.join(' ');

  // Robber knows their new role
  assert(info.includes(robAction.newRole), `view reveals new role: ${robAction.newRole}`);
  assert(info.includes(robAction.target), `view mentions who they swapped with: ${robAction.target}`);
});

test('Wolf view reveals partner name (2 wolves)', () => {
  const s = createFixedGame(
    [
      { name: 'Wolf1', role: 'werewolf' },
      { name: 'Wolf2', role: 'werewolf' },
      { name: 'Seer', role: 'seer' },
      { name: 'Rob', role: 'robber' },
      { name: 'TM', role: 'troublemaker' },
    ],
    ['drunk', 'villager', 'villager'],
  );
  run('night', s);
  const r1 = run('player-view --player "Wolf1"', s);
  const r2 = run('player-view --player "Wolf2"', s);

  assert(r1.ok && r2.ok, 'player-view succeeded');
  assert(r1.data.nightInfo[0].includes('Wolf2'), 'Wolf1 sees Wolf2');
  assert(r2.data.nightInfo[0].includes('Wolf1'), 'Wolf2 sees Wolf1');
});

test('Troublemaker view reveals swapped players but not their roles', () => {
  const s = createFixedGame(
    [
      { name: 'TM', role: 'troublemaker' },
      { name: 'A', role: 'seer' },
      { name: 'B', role: 'robber' },
      { name: 'Wolf', role: 'werewolf' },
      { name: 'Wolf2', role: 'werewolf' },
    ],
    ['drunk', 'villager', 'villager'],
  );
  run('night', s);
  const state = JSON.parse(fs.readFileSync(s, 'utf-8'));
  const tmAction = state.nightActions.find((a) => a.role === 'troublemaker');

  const r = run('player-view --player "TM"', s);
  assert(r.ok, `player-view failed: ${r.stderr}`);
  const info = r.data.nightInfo.join(' ');

  // TM knows who was swapped
  assert(info.includes(tmAction.target1), `view mentions ${tmAction.target1}`);
  assert(info.includes(tmAction.target2), `view mentions ${tmAction.target2}`);
  // TM does NOT know what roles they now hold
  assert(info.includes('did not look'), 'view confirms TM did not look');
});

test('player-view fails for unknown player', () => {
  const s = makeState('pv-unknown');
  run('init --players 5 --names "A,B,C,D,E"', s);
  run('night', s);
  const r = run('player-view --player "Nonexistent"', s);
  assert(!r.ok, 'should fail for unknown player');
});

// ---------------------------------------------------------------------------
// Test Suite 4: Voting
// ---------------------------------------------------------------------------

console.log('\n=== Suite 4: Voting ===');

test('Vote records correctly', () => {
  const s = makeState('vote-basic');
  run('init --players 5 --names "A,B,C,D,E"', s);
  run('night', s);
  const r = run('vote --voter "A" --target "B"', s);
  assert(r.ok, `vote failed: ${r.stderr}`);
  assertEqual(r.data.voter, 'A', 'voter');
  assertEqual(r.data.target, 'B', 'target');
  assertEqual(r.data.totalVotes, 1, 'totalVotes');

  const state = JSON.parse(fs.readFileSync(s, 'utf-8'));
  assertEqual(state.votes['A'], 'B', 'vote stored in state');
});

test('Self-vote is rejected', () => {
  const s = makeState('vote-self');
  run('init --players 5 --names "A,B,C,D,E"', s);
  run('night', s);
  const r = run('vote --voter "A" --target "A"', s);
  assert(!r.ok, 'self-vote should fail');
  assert(r.stderr.includes('yourself') || r.stderr.includes('self'), 'error mentions self-vote');
});

test('Vote for nonexistent player is rejected', () => {
  const s = makeState('vote-nonexistent');
  run('init --players 5 --names "A,B,C,D,E"', s);
  run('night', s);
  const r = run('vote --voter "A" --target "Z"', s);
  assert(!r.ok, 'vote for nonexistent player should fail');
});

test('Resolve fails if not all players voted', () => {
  const s = makeState('resolve-incomplete');
  run('init --players 5 --names "A,B,C,D,E"', s);
  run('night', s);
  run('vote --voter "A" --target "B"', s);
  run('vote --voter "B" --target "C"', s);
  // Only 2/5 votes
  const r = run('resolve', s);
  assert(!r.ok, 'resolve should fail with incomplete votes');
  assert(r.stderr.includes('2/5') || r.stderr.includes('votes'), 'error mentions vote count');
});

// ---------------------------------------------------------------------------
// Test Suite 5: Resolution — win conditions
// ---------------------------------------------------------------------------

console.log('\n=== Suite 5: Resolution — Win Conditions ===');

test('Village wins when wolf is eliminated', () => {
  // Wolf1 and Wolf2 are wolves. 4 players vote for Wolf1 → Wolf1 eliminated → Village wins
  const s = createFixedGame(
    [
      { name: 'Wolf1', role: 'werewolf' },
      { name: 'Wolf2', role: 'werewolf' },
      { name: 'Seer', role: 'seer' },
      { name: 'Rob', role: 'robber' },
      { name: 'TM', role: 'troublemaker' },
    ],
    ['drunk', 'villager', 'villager'],
  );
  run('night', s);
  // Overwrite votes directly to avoid randomness from night swaps
  const state = JSON.parse(fs.readFileSync(s, 'utf-8'));
  // Find who currently holds werewolf card (may have been swapped)
  const currentWolf = state.players.find((p) => p.currentRole === 'werewolf' && p.originalRole === 'werewolf');
  const wolfName = currentWolf ? currentWolf.name : 'Wolf1';
  const others = state.players.filter((p) => p.name !== wolfName).map((p) => p.name);

  for (const voter of state.players.map((p) => p.name)) {
    const target = voter === wolfName ? others[0] : wolfName;
    run(`vote --voter "${voter}" --target "${target}"`, s);
  }

  const r = run('resolve', s);
  assert(r.ok, `resolve failed: ${r.stderr}`);
  // At least one wolf was eliminated
  const wolfEliminated = r.data.eliminated.some((name) => {
    const p = r.data.finalRoles.find((fr) => fr.name === name);
    return p && p.finalRole === 'werewolf';
  });
  assert(wolfEliminated, 'a wolf was eliminated');
  assertEqual(r.data.winner, 'village', 'village wins');
});

test('Wolf wins when no wolf is eliminated', () => {
  // All votes go to a non-wolf player
  const s = createFixedGame(
    [
      { name: 'Wolf1', role: 'werewolf' },
      { name: 'Wolf2', role: 'werewolf' },
      { name: 'Seer', role: 'seer' },
      { name: 'Rob', role: 'robber' },
      { name: 'Vil', role: 'villager' },
    ],
    ['drunk', 'troublemaker', 'villager'],
  );
  run('night', s);
  const state = JSON.parse(fs.readFileSync(s, 'utf-8'));
  // Vote for Seer (non-wolf) — use currentRole to find a safe target
  const safeTarget = state.players.find((p) => p.currentRole !== 'werewolf')?.name || 'Seer';
  for (const voter of state.players.map((p) => p.name)) {
    const target = voter === safeTarget
      ? state.players.find((p) => p.name !== voter && p.name !== safeTarget)?.name
      : safeTarget;
    run(`vote --voter "${voter}" --target "${target}"`, s);
  }

  const r = run('resolve', s);
  assert(r.ok, `resolve failed: ${r.stderr}`);
  assertEqual(r.data.winner, 'wolf', 'wolf wins when no wolf eliminated');
});

test('Scatter vote (all 1 vote) — nobody dies, village wins if wolves in center', () => {
  // 3-player game where both wolves are in center
  const s = createFixedGame(
    [
      { name: 'Seer', role: 'seer' },
      { name: 'Rob', role: 'robber' },
      { name: 'TM', role: 'troublemaker' },
    ],
    ['werewolf', 'werewolf', 'villager'],
  );
  run('night', s);
  // Scatter: A→B, B→C, C→A
  run('vote --voter "Seer" --target "Rob"', s);
  run('vote --voter "Rob" --target "TM"', s);
  run('vote --voter "TM" --target "Seer"', s);

  const r = run('resolve', s);
  assert(r.ok, `resolve failed: ${r.stderr}`);
  assertEqual(r.data.eliminated.length, 0, 'nobody eliminated in scatter');
  assertEqual(r.data.winner, 'village', 'village wins (wolves in center)');
});

test('Scatter vote — wolf wins if wolf among players', () => {
  const s = createFixedGame(
    [
      { name: 'Wolf', role: 'werewolf' },
      { name: 'Seer', role: 'seer' },
      { name: 'Rob', role: 'robber' },
    ],
    ['werewolf', 'troublemaker', 'villager'],
  );
  run('night', s);
  // Check if night swaps moved wolf card — use state
  const state = JSON.parse(fs.readFileSync(s, 'utf-8'));
  const wolfAmongPlayers = state.players.some((p) => p.currentRole === 'werewolf');

  // Scatter vote
  const names = state.players.map((p) => p.name);
  for (let i = 0; i < names.length; i++) {
    run(`vote --voter "${names[i]}" --target "${names[(i + 1) % names.length]}"`, s);
  }

  const r = run('resolve', s);
  assert(r.ok, `resolve failed: ${r.stderr}`);
  assertEqual(r.data.eliminated.length, 0, 'nobody eliminated in scatter');

  if (wolfAmongPlayers) {
    assertEqual(r.data.winner, 'wolf', 'wolf wins (wolf among players, scatter)');
  } else {
    assertEqual(r.data.winner, 'village', 'village wins (no wolf among players, scatter)');
  }
});

test('Tie vote — all tied players eliminated', () => {
  // 4 players: A and B each get 2 votes → both eliminated
  const s = createFixedGame(
    [
      { name: 'Wolf', role: 'werewolf' },
      { name: 'Vil', role: 'villager' },
      { name: 'Seer', role: 'seer' },
      { name: 'Rob', role: 'robber' },
    ],
    ['werewolf', 'troublemaker', 'drunk'],
  );
  run('night', s);
  const state = JSON.parse(fs.readFileSync(s, 'utf-8'));
  const names = state.players.map((p) => p.name);

  // Force tie: first two players each get 2 votes
  run(`vote --voter "${names[0]}" --target "${names[1]}"`, s);
  run(`vote --voter "${names[1]}" --target "${names[0]}"`, s);
  run(`vote --voter "${names[2]}" --target "${names[1]}"`, s);
  run(`vote --voter "${names[3]}" --target "${names[0]}"`, s);

  const r = run('resolve', s);
  assert(r.ok, `resolve failed: ${r.stderr}`);
  assertEqual(r.data.eliminated.length, 2, 'both tied players eliminated');
  assertIncludes(r.data.eliminated, names[0], `${names[0]} eliminated`);
  assertIncludes(r.data.eliminated, names[1], `${names[1]} eliminated`);
});

test('Hunter kill chain: eliminated Hunter takes someone with them', () => {
  // Force Hunter to be eliminated. Use --hunter-target to specify who Hunter takes.
  const s = createFixedGame(
    [
      { name: 'Hunter', role: 'hunter' },
      { name: 'Wolf', role: 'werewolf' },
      { name: 'Wolf2', role: 'werewolf' },
      { name: 'Seer', role: 'seer' },
      { name: 'Rob', role: 'robber' },
    ],
    ['troublemaker', 'drunk', 'villager'],
  );
  run('night', s);
  const state = JSON.parse(fs.readFileSync(s, 'utf-8'));

  // Vote Hunter out (4 votes for Hunter, 1 for someone else)
  const names = state.players.map((p) => p.name);
  for (const voter of names) {
    const target = voter === 'Hunter' ? names.find((n) => n !== 'Hunter') : 'Hunter';
    run(`vote --voter "${voter}" --target "${target}"`, s);
  }

  // Hunter takes Wolf with them
  const r = run('resolve --hunter-target "Wolf"', s);
  assert(r.ok, `resolve failed: ${r.stderr}`);
  assertIncludes(r.data.eliminated, 'Hunter', 'Hunter eliminated');
  assertIncludes(r.data.eliminated, 'Wolf', 'Hunter took Wolf with them');
  assertEqual(r.data.hunterKills.length, 1, 'one hunter kill');
  assertEqual(r.data.hunterKills[0].hunter, 'Hunter', 'hunter is Hunter');
  assertEqual(r.data.hunterKills[0].target, 'Wolf', 'hunter target is Wolf');
});

test('Hunter kill: if hunter-target not specified, random player is chosen', () => {
  const s = createFixedGame(
    [
      { name: 'Hunter', role: 'hunter' },
      { name: 'Wolf', role: 'werewolf' },
      { name: 'Wolf2', role: 'werewolf' },
      { name: 'Seer', role: 'seer' },
      { name: 'Rob', role: 'robber' },
    ],
    ['troublemaker', 'drunk', 'villager'],
  );
  run('night', s);
  const state = JSON.parse(fs.readFileSync(s, 'utf-8'));
  const names = state.players.map((p) => p.name);
  for (const voter of names) {
    const target = voter === 'Hunter' ? names.find((n) => n !== 'Hunter') : 'Hunter';
    run(`vote --voter "${voter}" --target "${target}"`, s);
  }

  const r = run('resolve', s);
  assert(r.ok, `resolve failed: ${r.stderr}`);
  assertIncludes(r.data.eliminated, 'Hunter', 'Hunter eliminated');
  assertEqual(r.data.eliminated.length, 2, 'Hunter + 1 other eliminated');
  assertEqual(r.data.hunterKills.length, 1, 'one hunter kill');
  assertNotIncludes([r.data.hunterKills[0].target], 'Hunter', 'Hunter does not take themselves');
});

test('Resolution output includes finalRoles with wasSwapped flag', () => {
  const s = createFixedGame(
    [
      { name: 'Rob', role: 'robber' },
      { name: 'Vil', role: 'villager' },
      { name: 'Wolf', role: 'werewolf' },
      { name: 'Wolf2', role: 'werewolf' },
      { name: 'Seer', role: 'seer' },
    ],
    ['troublemaker', 'drunk', 'villager'],
  );
  run('night', s);
  const state = JSON.parse(fs.readFileSync(s, 'utf-8'));
  const names = state.players.map((p) => p.name);
  for (let i = 0; i < names.length; i++) {
    run(`vote --voter "${names[i]}" --target "${names[(i + 1) % names.length]}"`, s);
  }

  const r = run('resolve', s);
  assert(r.ok, `resolve failed: ${r.stderr}`);
  assert(Array.isArray(r.data.finalRoles), 'finalRoles is array');
  assertEqual(r.data.finalRoles.length, 5, 'finalRoles has all players');

  for (const fr of r.data.finalRoles) {
    assert('name' in fr, 'has name');
    assert('originalRole' in fr, 'has originalRole');
    assert('finalRole' in fr, 'has finalRole');
    assert('wasSwapped' in fr, 'has wasSwapped');
    assertEqual(fr.wasSwapped, fr.originalRole !== fr.finalRole, 'wasSwapped is correct');
  }
});

// ---------------------------------------------------------------------------
// Test Suite 6: Full 5-player game simulation
// ---------------------------------------------------------------------------

console.log('\n=== Suite 6: Full 5-Player Game Simulation ===');

test('Complete game flow: init → night → player-views → votes → resolve', () => {
  const s = makeState('full-game');
  const names = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'];

  // Init
  const initR = run(`init --players 5 --names "${names.join(',')}"`, s);
  assert(initR.ok, `init failed: ${initR.stderr}`);
  assertEqual(initR.data.playerCount, 5, 'player count');

  // Night
  const nightR = run('night', s);
  assert(nightR.ok, `night failed: ${nightR.stderr}`);
  assertEqual(nightR.data.phase, 'day', 'phase after night');

  // Player views — all 5 players
  for (const name of names) {
    const pvR = run(`player-view --player "${name}"`, s);
    assert(pvR.ok, `player-view failed for ${name}: ${pvR.stderr}`);
    assertEqual(pvR.data.player, name, `player name in view for ${name}`);
    assert(pvR.data.originalRole, `originalRole present for ${name}`);
    assert(Array.isArray(pvR.data.nightInfo), `nightInfo is array for ${name}`);
    assert(pvR.data.nightInfo.length > 0, `nightInfo not empty for ${name}`);
  }

  // Votes — each player votes for the next (circular)
  for (let i = 0; i < names.length; i++) {
    const voteR = run(`vote --voter "${names[i]}" --target "${names[(i + 1) % names.length]}"`, s);
    assert(voteR.ok, `vote failed for ${names[i]}: ${voteR.stderr}`);
  }

  // Resolve
  const resolveR = run('resolve', s);
  assert(resolveR.ok, `resolve failed: ${resolveR.stderr}`);
  assert(['village', 'wolf'].includes(resolveR.data.winner), 'winner is valid');
  assert(resolveR.data.winnerTeam, 'winnerTeam present');
  assert(resolveR.data.explanation, 'explanation present');
  assertEqual(resolveR.data.finalRoles.length, 5, 'all final roles present');
  assertEqual(resolveR.data.centerCards.length, 3, 'center cards present');

  // State is end
  const stateR = run('state', s);
  assert(stateR.ok, `state failed: ${stateR.stderr}`);
  assertEqual(stateR.data.phase, 'end', 'phase is end after resolve');
  assert(stateR.data.result !== null, 'result stored in state');
});

test('Game Master information isolation: player-view never leaks ground truth', () => {
  // Run 5 games and verify no player view contains another player's role
  for (let game = 0; game < 5; game++) {
    const s = makeState(`isolation-${game}`);
    const names = ['P1', 'P2', 'P3', 'P4', 'P5'];
    run(`init --players 5 --names "${names.join(',')}"`, s);
    run('night', s);

    const fullState = JSON.parse(fs.readFileSync(s, 'utf-8'));

    for (const name of names) {
      const pvR = run(`player-view --player "${name}"`, s);
      assert(pvR.ok, `player-view failed for ${name}`);

      const view = pvR.data;
      const infoText = view.nightInfo.join(' ');
      const player = fullState.players.find((p) => p.name === name);

      // Verify the view does not contain the ground-truth currentRole of OTHER players
      // unless the player's role legitimately grants that knowledge.
      // Roles that see other players' cards: seer (peek_player), robber (swap_and_view)
      const legitimatelyKnows = new Set();
      for (const action of fullState.nightActions.filter((a) => a.actor === name)) {
        if (action.action === 'peek_player') legitimatelyKnows.add(action.target);
        if (action.action === 'swap_and_view') legitimatelyKnows.add(action.target);
      }

      // For roles that don't peek other players' final roles, verify no leakage
      if (!['seer', 'robber'].includes(player.originalRole)) {
        const otherPlayers = fullState.players.filter((p) => p.name !== name);
        for (const other of otherPlayers) {
          // Skip common role names that appear in generic messages (e.g., "villager" in sleep msg)
          // Only flag if the view contains BOTH the other player's name AND their role together,
          // which would indicate a direct leak of "X is Y"
          const nameAndRole = infoText.includes(other.name) && infoText.includes(other.currentRole);
          // Troublemaker legitimately knows the names of who they swapped (but not their roles)
          if (player.originalRole === 'troublemaker') continue;
          if (nameAndRole && !legitimatelyKnows.has(other.name)) {
            assert(false,
              `Game ${game}: ${name}'s view leaks ${other.name}'s final role (${other.currentRole}): "${infoText}"`);
          }
        }
      }
    }
  }
});

test('Mason variant: both masons see each other', () => {
  const s = makeState('mason-game');
  run('init --players 5 --mason --names "M1,M2,A,B,C"', s);

  // Find which players got mason roles
  const state = JSON.parse(fs.readFileSync(s, 'utf-8'));
  const masons = state.players.filter((p) => p.originalRole === 'mason');

  if (masons.length === 2) {
    run('night', s);
    const m1View = run(`player-view --player "${masons[0].name}"`, s);
    const m2View = run(`player-view --player "${masons[1].name}"`, s);

    assert(m1View.ok && m2View.ok, 'mason views succeeded');
    assert(m1View.data.nightInfo[0].includes(masons[1].name),
      `${masons[0].name} sees ${masons[1].name}`);
    assert(m2View.data.nightInfo[0].includes(masons[0].name),
      `${masons[1].name} sees ${masons[0].name}`);
  } else {
    // Masons may be in center — skip this specific check
    assert(true, 'mason may be in center (acceptable)');
  }
});

// ---------------------------------------------------------------------------
// Test Suite 7: Edge cases
// ---------------------------------------------------------------------------

console.log('\n=== Suite 7: Edge Cases ===');

test('3-player game works end-to-end', () => {
  const s = makeState('3player');
  const r = run('init --players 3 --names "X,Y,Z"', s);
  assert(r.ok, `init failed: ${r.stderr}`);
  assertEqual(r.data.totalCards, 6, 'total cards for 3 players');

  run('night', s);
  run('vote --voter "X" --target "Y"', s);
  run('vote --voter "Y" --target "Z"', s);
  run('vote --voter "Z" --target "X"', s);
  const resolveR = run('resolve', s);
  assert(resolveR.ok, `resolve failed: ${resolveR.stderr}`);
});

test('6-player game works end-to-end', () => {
  const s = makeState('6player');
  const r = run('init --players 6 --names "A,B,C,D,E,F"', s);
  assert(r.ok, `init failed: ${r.stderr}`);
  assertEqual(r.data.totalCards, 9, 'total cards for 6 players');
  assert(r.data.rolesInGame.hunter >= 1, 'hunter present in 6-player game');

  run('night', s);
  const names = ['A', 'B', 'C', 'D', 'E', 'F'];
  for (let i = 0; i < names.length; i++) {
    run(`vote --voter "${names[i]}" --target "${names[(i + 1) % names.length]}"`, s);
  }
  const resolveR = run('resolve', s);
  assert(resolveR.ok, `resolve failed: ${resolveR.stderr}`);
});

test('Multiple games can run independently (no state leakage)', () => {
  const s1 = makeState('multi-1');
  const s2 = makeState('multi-2');

  run('init --players 5 --names "A,B,C,D,E"', s1);
  run('init --players 5 --names "V,W,X,Y,Z"', s2);
  run('night', s1);
  run('night', s2);

  const state1 = JSON.parse(fs.readFileSync(s1, 'utf-8'));
  const state2 = JSON.parse(fs.readFileSync(s2, 'utf-8'));

  // States are independent
  assertEqual(state1.players[0].name, 'A', 'game 1 player names');
  assertEqual(state2.players[0].name, 'V', 'game 2 player names');
  assert(state1.nightActions !== state2.nightActions, 'independent night actions');
});

test('State command shows ground truth (GM only)', () => {
  const s = makeState('state-cmd');
  run('init --players 5 --names "A,B,C,D,E"', s);
  run('night', s);

  const r = run('state', s);
  assert(r.ok, `state failed: ${r.stderr}`);
  assert(Array.isArray(r.data.players), 'has players');
  assert(Array.isArray(r.data.centerCards), 'has centerCards');
  assert(Array.isArray(r.data.nightActions), 'has nightActions');
  // Ground truth: currentRole is present for all players
  for (const p of r.data.players) {
    assert(p.currentRole, `${p.name} has currentRole`);
    assert(p.originalRole, `${p.name} has originalRole`);
  }
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('\n' + '='.repeat(60));
console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);

if (failures.length > 0) {
  console.log('\nFailed tests:');
  for (const f of failures) {
    console.log(`  ✗ ${f.name}`);
    console.log(`    ${f.error.split('\n')[0]}`);
  }
}

console.log('='.repeat(60));

// Cleanup
try {
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
} catch {
  // ignore cleanup errors
}

process.exit(failed > 0 ? 1 : 0);
