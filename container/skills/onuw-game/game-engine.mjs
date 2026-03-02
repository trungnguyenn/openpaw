#!/usr/bin/env node

/**
 * One Night Ultimate Werewolf — Deterministic Game Engine
 *
 * Manages card distribution, night-phase swaps/peeks, voting, and resolution.
 * All randomness happens at action time; state file is the single source of truth.
 *
 * Usage:
 *   node game-engine.mjs <command> [options]
 *
 * Commands:
 *   init         Create a new game
 *   night        Process all night actions (automatic random targets)
 *   player-view  Show what a specific player knows
 *   vote         Record a player's vote
 *   resolve      Tally votes and determine winner
 *   state        Dump full state (Game Master only)
 *   log          Append a structured event to the game log (Vietnamese)
 *   log-message  Append a player's day-phase message to the game log
 *   log-view     Print the full game log in readable Vietnamese format
 */

import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// Role definitions
// ---------------------------------------------------------------------------

const ROLE_DEFS = {
  werewolf:      { team: 'wolf',    nightOrder: 1 },
  mason:         { team: 'village', nightOrder: 2 },
  seer:          { team: 'village', nightOrder: 3 },
  robber:        { team: 'village', nightOrder: 4 },
  troublemaker:  { team: 'village', nightOrder: 5 },
  drunk:         { team: 'village', nightOrder: 6 },
  hunter:        { team: 'village', nightOrder: null },
  villager:      { team: 'village', nightOrder: null },
};

const CONFIGS = {
  3: ['werewolf', 'werewolf', 'seer', 'robber', 'troublemaker', 'villager'],
  4: ['werewolf', 'werewolf', 'seer', 'robber', 'troublemaker', 'villager', 'villager'],
  5: ['werewolf', 'werewolf', 'seer', 'robber', 'troublemaker', 'drunk', 'villager', 'villager'],
  6: ['werewolf', 'werewolf', 'seer', 'robber', 'troublemaker', 'drunk', 'hunter', 'villager', 'villager'],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickRandom(arr, excludeNames = []) {
  const candidates = arr.filter((x) => {
    const name = typeof x === 'object' && x.name ? x.name : x;
    return !excludeNames.includes(name);
  });
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function loadState(statePath) {
  if (!fs.existsSync(statePath)) {
    console.error(`Error: State file not found at ${statePath}`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(statePath, 'utf-8'));
}

function saveState(statePath, state) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

function defaultStatePath() {
  return path.join(process.cwd(), 'onuw', 'state.json');
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function cmdInit(args) {
  const playerCount = parseInt(args.players, 10);
  if (!playerCount || playerCount < 3 || playerCount > 6) {
    console.error('Error: --players must be 3–6');
    process.exit(1);
  }

  let rolePool = [...(CONFIGS[playerCount] || CONFIGS[6])];

  if (args.mason) {
    let replaced = 0;
    for (let i = rolePool.length - 1; i >= 0 && replaced < 2; i--) {
      if (rolePool[i] === 'villager') {
        rolePool[i] = 'mason';
        replaced++;
      }
    }
    if (replaced < 2) {
      console.error('Error: Not enough Villagers to replace with Masons');
      process.exit(1);
    }
  }

  const shuffled = shuffle(rolePool);
  const playerNames = args.names
    ? args.names.split(',').map((n) => n.trim())
    : Array.from({ length: playerCount }, (_, i) => `Player ${i + 1}`);

  if (playerNames.length !== playerCount) {
    console.error(`Error: --names has ${playerNames.length} names but --players is ${playerCount}`);
    process.exit(1);
  }

  const players = playerNames.map((name, i) => ({
    name,
    originalRole: shuffled[i],
    currentRole: shuffled[i],
  }));

  const centerCards = shuffled.slice(playerCount);

  const state = {
    phase: 'night',
    players,
    centerCards,
    originalCenter: [...centerCards],
    nightActions: [],
    votes: {},
    result: null,
  };

  const statePath = args.state || defaultStatePath();
  saveState(statePath, state);

  const roleCounts = {};
  for (const r of rolePool) roleCounts[r] = (roleCounts[r] || 0) + 1;

  console.log(JSON.stringify({
    status: 'ok',
    playerCount,
    totalCards: rolePool.length,
    centerCards: 3,
    rolesInGame: roleCounts,
    players: players.map((p) => p.name),
    statePath,
  }, null, 2));
}

function cmdNight(args) {
  const statePath = args.state || defaultStatePath();
  const state = loadState(statePath);

  if (state.phase !== 'night') {
    console.error(`Error: Game is in "${state.phase}" phase, not "night"`);
    process.exit(1);
  }

  const players = state.players;
  const center = state.centerCards;
  const actions = [];

  // Night actions are performed by whoever was ORIGINALLY dealt the role,
  // regardless of swaps that happen during the night.
  const rolesPresent = new Set(players.map((p) => p.originalRole));
  const wakeOrder = Object.entries(ROLE_DEFS)
    .filter(([role, def]) => def.nightOrder !== null && rolesPresent.has(role))
    .sort((a, b) => a[1].nightOrder - b[1].nightOrder)
    .map(([role]) => role);

  for (const role of wakeOrder) {
    const holders = players.filter((p) => p.originalRole === role);
    if (holders.length === 0) continue;

    switch (role) {
      case 'werewolf': {
        const wolves = holders;
        if (wolves.length >= 2) {
          const names = wolves.map((w) => w.name);
          for (const w of wolves) {
            actions.push({
              role: 'werewolf',
              actor: w.name,
              action: 'see_partner',
              detail: `Saw fellow wolf(s): ${names.filter((n) => n !== w.name).join(', ')}`,
            });
          }
        } else {
          const wolf = wolves[0];
          const ci = Math.floor(Math.random() * center.length);
          actions.push({
            role: 'werewolf',
            actor: wolf.name,
            action: 'peek_center',
            centerIndex: ci,
            detail: `Peeked at center card ${ci}: ${center[ci]}`,
          });
        }
        break;
      }

      case 'mason': {
        const masons = holders;
        const names = masons.map((m) => m.name);
        for (const m of masons) {
          actions.push({
            role: 'mason',
            actor: m.name,
            action: 'see_partner',
            detail: names.length >= 2
              ? `Saw fellow Mason(s): ${names.filter((n) => n !== m.name).join(', ')}`
              : 'No other Mason found (partner may be in center)',
          });
        }
        break;
      }

      case 'seer': {
        const seer = holders[0];
        const peekCenter = Math.random() < 0.4;
        if (peekCenter && center.length >= 2) {
          const indices = shuffle([0, 1, 2]).slice(0, 2);
          actions.push({
            role: 'seer',
            actor: seer.name,
            action: 'peek_two_center',
            centerIndices: indices,
            detail: `Peeked at center cards ${indices[0]} and ${indices[1]}: ${center[indices[0]]}, ${center[indices[1]]}`,
          });
        } else {
          const target = pickRandom(players.filter((p) => p.name !== seer.name));
          actions.push({
            role: 'seer',
            actor: seer.name,
            action: 'peek_player',
            target: target.name,
            detail: `Peeked at ${target.name}'s card: ${target.currentRole}`,
          });
        }
        break;
      }

      case 'robber': {
        const robber = holders[0];
        const target = pickRandom(players.filter((p) => p.name !== robber.name));
        const oldRole = robber.currentRole;
        const stolenRole = target.currentRole;
        robber.currentRole = stolenRole;
        target.currentRole = oldRole;
        actions.push({
          role: 'robber',
          actor: robber.name,
          action: 'swap_and_view',
          target: target.name,
          newRole: stolenRole,
          detail: `Swapped with ${target.name} and saw new role: ${stolenRole}`,
        });
        break;
      }

      case 'troublemaker': {
        const tm = holders[0];
        const others = players.filter((p) => p.name !== tm.name);
        const t1 = pickRandom(others);
        const t2 = pickRandom(others, [t1.name]);
        const tmp = t1.currentRole;
        t1.currentRole = t2.currentRole;
        t2.currentRole = tmp;
        actions.push({
          role: 'troublemaker',
          actor: tm.name,
          action: 'swap_others',
          target1: t1.name,
          target2: t2.name,
          detail: `Swapped ${t1.name} and ${t2.name}'s cards`,
        });
        break;
      }

      case 'drunk': {
        const drunk = holders[0];
        const ci = Math.floor(Math.random() * center.length);
        const tmp = drunk.currentRole;
        drunk.currentRole = center[ci];
        center[ci] = tmp;
        actions.push({
          role: 'drunk',
          actor: drunk.name,
          action: 'swap_center',
          centerIndex: ci,
          detail: `Swapped own card with center card ${ci} (did not look)`,
        });
        break;
      }
    }
  }

  state.nightActions = actions;
  state.phase = 'day';
  saveState(statePath, state);

  console.log(JSON.stringify({
    status: 'ok',
    phase: 'day',
    actionsPerformed: actions.length,
    wakeOrder,
  }, null, 2));
}

function cmdPlayerView(args) {
  const statePath = args.state || defaultStatePath();
  const state = loadState(statePath);
  const playerName = args.player;

  if (!playerName) {
    console.error('Error: --player is required');
    process.exit(1);
  }

  const player = state.players.find((p) => p.name === playerName);
  if (!player) {
    console.error(`Error: Player "${playerName}" not found`);
    process.exit(1);
  }

  const myActions = state.nightActions.filter((a) => a.actor === playerName);

  const view = {
    player: playerName,
    originalRole: player.originalRole,
    nightInfo: [],
  };

  for (const action of myActions) {
    switch (action.action) {
      case 'see_partner':
        view.nightInfo.push(action.detail);
        break;
      case 'peek_center':
        view.nightInfo.push(`You peeked at center card ${action.centerIndex} and saw: ${state.nightActions.find((a) => a.actor === playerName && a.action === 'peek_center').detail.split(': ')[1]}`);
        break;
      case 'peek_player':
        view.nightInfo.push(`You looked at ${action.target}'s card and saw: ${action.detail.split(': ')[1]}`);
        break;
      case 'peek_two_center': {
        const indices = action.centerIndices;
        const roles = action.detail.split(': ')[1];
        view.nightInfo.push(`You looked at center cards ${indices[0]} and ${indices[1]} and saw: ${roles}`);
        break;
      }
      case 'swap_and_view':
        view.nightInfo.push(`You swapped your card with ${action.target}'s card. Your new role is: ${action.newRole}`);
        break;
      case 'swap_others':
        view.nightInfo.push(`You swapped ${action.target1}'s card with ${action.target2}'s card. You did not look at either card.`);
        break;
      case 'swap_center':
        view.nightInfo.push(`You swapped your card with a center card. You did NOT look at your new card.`);
        break;
    }
  }

  if (view.nightInfo.length === 0) {
    if (['villager', 'hunter'].includes(player.originalRole)) {
      view.nightInfo.push('You slept through the night. You have no special information.');
    }
  }

  console.log(JSON.stringify(view, null, 2));
}

function cmdVote(args) {
  const statePath = args.state || defaultStatePath();
  const state = loadState(statePath);

  if (!args.voter || !args.target) {
    console.error('Error: --voter and --target are required');
    process.exit(1);
  }

  const voter = state.players.find((p) => p.name === args.voter);
  const target = state.players.find((p) => p.name === args.target);

  if (!voter) {
    console.error(`Error: Voter "${args.voter}" not found`);
    process.exit(1);
  }
  if (!target) {
    console.error(`Error: Target "${args.target}" not found`);
    process.exit(1);
  }
  if (args.voter === args.target) {
    console.error('Error: Cannot vote for yourself');
    process.exit(1);
  }

  state.votes[args.voter] = args.target;
  saveState(statePath, state);

  console.log(JSON.stringify({
    status: 'ok',
    voter: args.voter,
    target: args.target,
    totalVotes: Object.keys(state.votes).length,
    totalPlayers: state.players.length,
  }, null, 2));
}

function cmdResolve(args) {
  const statePath = args.state || defaultStatePath();
  const state = loadState(statePath);

  const votes = state.votes;
  const voteCount = Object.keys(votes).length;

  if (voteCount < state.players.length) {
    console.error(`Error: Only ${voteCount}/${state.players.length} votes recorded. All players must vote.`);
    process.exit(1);
  }

  // Tally
  const tally = {};
  for (const target of Object.values(votes)) {
    tally[target] = (tally[target] || 0) + 1;
  }

  const maxVotes = Math.max(...Object.values(tally));
  const allSame = Object.values(tally).every((v) => v === maxVotes) && Object.keys(tally).length === state.players.length;

  let eliminated = [];

  if (allSame && maxVotes === 1) {
    // Complete scatter — nobody dies
    eliminated = [];
  } else {
    eliminated = Object.entries(tally)
      .filter(([, count]) => count === maxVotes)
      .map(([name]) => name);
  }

  // Hunter chain: if a Hunter is eliminated, they take someone with them.
  // Use --hunter-target to specify who the Hunter chooses. If not provided,
  // a random surviving player is selected.
  const hunterKills = [];
  for (const name of eliminated) {
    const p = state.players.find((pl) => pl.name === name);
    if (p && p.currentRole === 'hunter') {
      const otherPlayers = state.players
        .filter((pl) => pl.name !== name && !eliminated.includes(pl.name))
        .map((pl) => pl.name);
      if (otherPlayers.length > 0) {
        let hunterTarget = args['hunter-target'];
        if (hunterTarget && otherPlayers.includes(hunterTarget)) {
          // Use specified target
        } else {
          hunterTarget = otherPlayers[Math.floor(Math.random() * otherPlayers.length)];
        }
        hunterKills.push({ hunter: name, target: hunterTarget });
        eliminated.push(hunterTarget);
      }
    }
  }

  // Determine winner
  const wolvesAmongPlayers = state.players.filter((p) => p.currentRole === 'werewolf');
  const wolfEliminated = eliminated.some((name) => {
    const p = state.players.find((pl) => pl.name === name);
    return p && p.currentRole === 'werewolf';
  });

  let winner;
  if (eliminated.length === 0) {
    winner = wolvesAmongPlayers.length === 0 ? 'village' : 'wolf';
  } else {
    winner = wolfEliminated ? 'village' : 'wolf';
  }

  const result = {
    status: 'ok',
    votes: Object.entries(votes).map(([voter, target]) => ({ voter, target })),
    tally: Object.entries(tally).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    eliminated,
    hunterKills,
    winner,
    winnerTeam: winner === 'village' ? 'Village (Dân Làng)' : 'Werewolf (Ma Sói)',
    explanation: buildExplanation(winner, eliminated, wolvesAmongPlayers, wolfEliminated),
    finalRoles: state.players.map((p) => ({
      name: p.name,
      originalRole: p.originalRole,
      finalRole: p.currentRole,
      wasSwapped: p.originalRole !== p.currentRole,
    })),
    centerCards: state.centerCards,
  };

  state.result = result;
  state.phase = 'end';
  saveState(statePath, state);

  console.log(JSON.stringify(result, null, 2));
}

function buildExplanation(winner, eliminated, wolvesAmongPlayers, wolfEliminated) {
  if (eliminated.length === 0 && wolvesAmongPlayers.length === 0) {
    return 'No one was eliminated and both Werewolves were in the center. Village wins by default!';
  }
  if (eliminated.length === 0) {
    return 'No one was eliminated (votes were scattered). At least one Werewolf survived among the players. Werewolf team wins!';
  }
  if (wolfEliminated) {
    return `${eliminated.join(' and ')} eliminated. At least one was a Werewolf. Village wins!`;
  }
  return `${eliminated.join(' and ')} eliminated, but none were Werewolves. The wolves survive! Werewolf team wins!`;
}

function cmdState(args) {
  const statePath = args.state || defaultStatePath();
  const state = loadState(statePath);
  console.log(JSON.stringify(state, null, 2));
}

// ---------------------------------------------------------------------------
// Localisation (i18n)
// ---------------------------------------------------------------------------

const I18N = {
  vi: {
    roles: {
      werewolf:     'Ma Sói',
      seer:         'Tiên Tri',
      robber:       'Kẻ Trộm',
      troublemaker: 'Kẻ Gây Rối',
      drunk:        'Kẻ Say',
      hunter:       'Thợ Săn',
      villager:     'Dân Làng',
      mason:        'Hội Kín',
    },
    teams: { wolf: 'Phe Ma Sói', village: 'Phe Dân Làng' },
    rounds: {
      opening:        'Phát biểu mở đầu',
      'discussion-1': 'Thảo luận vòng 1',
      'discussion-2': 'Thảo luận vòng 2',
      vote:           'Bỏ phiếu',
    },
    gameTitle:        'Ván Chơi Ma Sói Một Đêm',
    startTime:        'Thời gian bắt đầu',
    playerCount:      'Số người chơi',
    playerList:       'Danh sách người chơi',
    rolesInGame:      'Vai trò trong ván (bao gồm 3 lá ở giữa)',
    rolesSecret:      '*(Vai trò cụ thể của từng người là bí mật cho đến khi kết thúc)*',
    nightPhase:       'Pha Đêm',
    nightFalls:       'Màn đêm buông xuống. Tất cả nhắm mắt.',
    nightLog:         'Diễn biến đêm (bí mật — chỉ Người Dẫn Chuyện biết)',
    dawn:             'Bình minh ló dạng. Mọi người mở mắt.',
    dayPhase:         'Pha Ngày — Thảo Luận',
    dayStarts:        'Mọi người thức dậy và bắt đầu thảo luận.',
    votePhase:        'Pha Bỏ Phiếu',
    voteStarts:       'Thời gian thảo luận kết thúc. Bắt đầu bỏ phiếu.',
    voteResults:      'Kết quả bỏ phiếu',
    votedFor:         'bỏ phiếu cho →',
    gameEnd:          'Kết Thúc Ván Chơi',
    eliminated:       'Người bị loại',
    noneEliminated:   'Không ai bị loại',
    hunterDrags:      (hunter, target) => `**${hunter}** (Thợ Săn) kéo theo **${target}** khi bị loại`,
    wins:             (team) => `${team} chiến thắng!`,
    roleTable:        'Bảng vai trò thực sự',
    colPlayer:        'Người chơi',
    colOrigRole:      'Vai trò ban đầu',
    colFinalRole:     'Vai trò cuối đêm',
    colSwapped:       'Bị tráo?',
    swappedYes:       '✅ Có',
    swappedNo:        '—',
    centerCards:      'Lá ở giữa',
    endTime:          'Kết thúc lúc',
    cardCount:        (n) => `${n} lá`,
    explainAllCenter: 'Không ai bị loại và cả hai Ma Sói đều nằm ở giữa bàn. Phe Dân Làng thắng mặc định!',
    explainScatter:   'Không ai bị loại (phiếu bầu bị phân tán). Ít nhất một Ma Sói còn sống trong số người chơi. Phe Ma Sói chiến thắng!',
    explainVillageWin:(names) => `${names} bị loại. Ít nhất một người trong số đó là Ma Sói. Phe Dân Làng chiến thắng!`,
    explainWolfWin:   (names) => `${names} bị loại nhưng không ai là Ma Sói. Những con sói sống sót! Phe Ma Sói chiến thắng!`,
    nightActions: {
      see_partner:     (prefix, detail) => `${prefix}: Nhìn thấy đồng đội — ${detail.split(': ')[1]}`,
      peek_center:     (prefix, action, roleStr) => `${prefix}: Nhìn trộm lá giữa #${action.centerIndex} → thấy *${roleStr}*`,
      peek_player:     (prefix, action, roleStr) => `${prefix}: Nhìn trộm bài của **${action.target}** → thấy *${roleStr}*`,
      peek_two_center: (prefix, action, rolesStr) => `${prefix}: Nhìn trộm 2 lá giữa (#${action.centerIndices[0]}, #${action.centerIndices[1]}) → thấy *${rolesStr}*`,
      swap_and_view:   (prefix, action, roleStr) => `${prefix}: Đổi bài với **${action.target}** → vai trò mới của mình là *${roleStr}*`,
      swap_others:     (prefix, action) => `${prefix}: Tráo bài của **${action.target1}** và **${action.target2}** (không nhìn)`,
      swap_center:     (prefix, action) => `${prefix}: Đổi bài của mình với lá giữa #${action.centerIndex} (không nhìn)`,
    },
    locale: 'vi-VN',
  },

  en: {
    roles: {
      werewolf:     'Werewolf',
      seer:         'Seer',
      robber:       'Robber',
      troublemaker: 'Troublemaker',
      drunk:        'Drunk',
      hunter:       'Hunter',
      villager:     'Villager',
      mason:        'Mason',
    },
    teams: { wolf: 'Werewolf Team', village: 'Village Team' },
    rounds: {
      opening:        'Opening Claim',
      'discussion-1': 'Discussion Round 1',
      'discussion-2': 'Discussion Round 2',
      vote:           'Vote',
    },
    gameTitle:        'One Night Ultimate Werewolf — Game Log',
    startTime:        'Start time',
    playerCount:      'Players',
    playerList:       'Players',
    rolesInGame:      'Roles in game (including 3 center cards)',
    rolesSecret:      '*(Individual role assignments are secret until the game ends)*',
    nightPhase:       'Night Phase',
    nightFalls:       'Night falls. Everyone closes their eyes.',
    nightLog:         'Night actions (secret — Game Master only)',
    dawn:             'Dawn breaks. Everyone opens their eyes.',
    dayPhase:         'Day Phase — Discussion',
    dayStarts:        'Everyone wakes up and discussion begins.',
    votePhase:        'Voting Phase',
    voteStarts:       'Discussion time is over. Voting begins.',
    voteResults:      'Vote results',
    votedFor:         'voted for →',
    gameEnd:          'Game Over',
    eliminated:       'Eliminated',
    noneEliminated:   'Nobody eliminated',
    hunterDrags:      (hunter, target) => `**${hunter}** (Hunter) takes **${target}** down with them`,
    wins:             (team) => `${team} wins!`,
    roleTable:        'True role reveal',
    colPlayer:        'Player',
    colOrigRole:      'Starting role',
    colFinalRole:     'Role at dawn',
    colSwapped:       'Swapped?',
    swappedYes:       '✅ Yes',
    swappedNo:        '—',
    centerCards:      'Center cards',
    endTime:          'Ended at',
    cardCount:        (n) => `${n} card${n !== 1 ? 's' : ''}`,
    explainAllCenter: 'Nobody was eliminated and both Werewolves were in the center. Village wins by default!',
    explainScatter:   'Nobody was eliminated (votes scattered). At least one Werewolf survived among the players. Werewolf team wins!',
    explainVillageWin:(names) => `${names} eliminated. At least one was a Werewolf. Village wins!`,
    explainWolfWin:   (names) => `${names} eliminated, but none were Werewolves. The wolves survive! Werewolf team wins!`,
    nightActions: {
      see_partner:     (prefix, detail) => `${prefix}: Saw partner(s) — ${detail.split(': ')[1]}`,
      peek_center:     (prefix, action, roleStr) => `${prefix}: Peeked at center card #${action.centerIndex} → saw *${roleStr}*`,
      peek_player:     (prefix, action, roleStr) => `${prefix}: Peeked at **${action.target}**'s card → saw *${roleStr}*`,
      peek_two_center: (prefix, action, rolesStr) => `${prefix}: Peeked at center cards #${action.centerIndices[0]} and #${action.centerIndices[1]} → saw *${rolesStr}*`,
      swap_and_view:   (prefix, action, roleStr) => `${prefix}: Swapped with **${action.target}** → new role is *${roleStr}*`,
      swap_others:     (prefix, action) => `${prefix}: Swapped **${action.target1}** and **${action.target2}**'s cards (did not look)`,
      swap_center:     (prefix, action) => `${prefix}: Swapped own card with center card #${action.centerIndex} (did not look)`,
    },
    locale: 'en-US',
  },
};

function getLang(args) {
  const l = (args.lang || 'vi').toLowerCase();
  return I18N[l] || I18N.vi;
}

function t(lang, role) {
  return lang.roles[role] || role;
}

function tTeam(lang, team) {
  return lang.teams[team] || team;
}

/** Derive log file path from state file path */
function logPath(statePath) {
  return statePath.replace(/state\.json$/, 'game.log.md');
}

/** Append a raw line to the log file */
function appendLog(statePath, line) {
  fs.appendFileSync(logPath(statePath), line + '\n');
}

/** Format ISO timestamp as HH:MM:SS */
function fmtTime(iso) {
  return new Date(iso).toTimeString().slice(0, 8);
}

// ---------------------------------------------------------------------------
// Log commands
// ---------------------------------------------------------------------------

/**
 * log --event <type> [--lang vi|en] [--state <path>]
 *
 * Appends a structured section to game.log.md in the chosen language.
 * Defaults to Vietnamese (--lang vi) for backward compatibility.
 *
 * Supported event types:
 *   game-start   — after init, lists all roles in game
 *   night-start  — before night phase
 *   night-end    — after night phase, logs all night actions
 *   day-start    — opening of day discussion
 *   vote-start   — before voting phase
 *   vote-end     — after all votes recorded, before resolve
 *   game-end     — after resolve, full reveal
 */
function cmdLog(args) {
  const statePath = args.state || defaultStatePath();
  const state = loadState(statePath);
  const event = args.event;
  const ts = new Date().toISOString();
  const lang = getLang(args);

  if (!event) {
    console.error('Error: --event is required');
    process.exit(1);
  }

  switch (event) {
    case 'game-start': {
      const roleCounts = {};
      for (const p of state.players) {
        roleCounts[p.originalRole] = (roleCounts[p.originalRole] || 0) + 1;
      }
      for (const c of state.centerCards) {
        roleCounts[c] = (roleCounts[c] || 0) + 1;
      }

      const lines = [
        '',
        '---',
        `# 🐺 ${lang.gameTitle}`,
        `**${lang.startTime}:** ${new Date(ts).toLocaleString(lang.locale)}`,
        `**${lang.playerCount}:** ${state.players.length}`,
        '',
        `## ${lang.playerList}`,
        ...state.players.map((p) => `- ${p.name}`),
        '',
        `## ${lang.rolesInGame}`,
        ...Object.entries(roleCounts).map(([r, n]) => `- ${t(lang, r)}: ${lang.cardCount(n)}`),
        '',
        `> ${lang.rolesSecret}`,
      ];
      for (const l of lines) appendLog(statePath, l);
      break;
    }

    case 'night-start': {
      const lines = [
        '',
        `## 🌙 ${lang.nightPhase}`,
        `*${fmtTime(ts)}* — ${lang.nightFalls}`,
      ];
      for (const l of lines) appendLog(statePath, l);
      break;
    }

    case 'night-end': {
      const lines = [
        '',
        `### ${lang.nightLog}`,
        '',
      ];

      for (const action of state.nightActions) {
        const actorRole = state.players.find((p) => p.name === action.actor)?.originalRole || action.role;
        const prefix = `*${fmtTime(ts)}* **${action.actor}** (${t(lang, actorRole)})`;
        const na = lang.nightActions;

        switch (action.action) {
          case 'see_partner':
            lines.push(na.see_partner(prefix, action.detail));
            break;
          case 'peek_center': {
            const roleStr = t(lang, action.detail.split(': ')[1]);
            lines.push(na.peek_center(prefix, action, roleStr));
            break;
          }
          case 'peek_player': {
            const roleStr = t(lang, action.detail.split(': ')[1]);
            lines.push(na.peek_player(prefix, action, roleStr));
            break;
          }
          case 'peek_two_center': {
            const rolesStr = action.detail.split(': ')[1].split(', ').map((r) => t(lang, r)).join(', ');
            lines.push(na.peek_two_center(prefix, action, rolesStr));
            break;
          }
          case 'swap_and_view': {
            const roleStr = t(lang, action.newRole);
            lines.push(na.swap_and_view(prefix, action, roleStr));
            break;
          }
          case 'swap_others':
            lines.push(na.swap_others(prefix, action));
            break;
          case 'swap_center':
            lines.push(na.swap_center(prefix, action));
            break;
          default:
            lines.push(`${prefix}: ${action.detail}`);
        }
      }

      lines.push('');
      lines.push(`*${lang.dawn}*`);
      for (const l of lines) appendLog(statePath, l);
      break;
    }

    case 'day-start': {
      const lines = [
        '',
        `## ☀️ ${lang.dayPhase}`,
        `*${fmtTime(ts)}* — ${lang.dayStarts}`,
        '',
      ];
      for (const l of lines) appendLog(statePath, l);
      break;
    }

    case 'vote-start': {
      const lines = [
        '',
        `## 🗳️ ${lang.votePhase}`,
        `*${fmtTime(ts)}* — ${lang.voteStarts}`,
        '',
      ];
      for (const l of lines) appendLog(statePath, l);
      break;
    }

    case 'vote-end': {
      const lines = [
        '',
        `### ${lang.voteResults}`,
        '',
        ...Object.entries(state.votes).map(([voter, target]) => `- **${voter}** ${lang.votedFor} **${target}**`),
        '',
      ];
      for (const l of lines) appendLog(statePath, l);
      break;
    }

    case 'game-end': {
      if (!state.result) {
        console.error('Error: game not resolved yet (run resolve first)');
        process.exit(1);
      }
      const r = state.result;
      const eliminatedStr = r.eliminated.length > 0 ? r.eliminated.join(', ') : lang.noneEliminated;
      const lines = [
        '',
        `## 🏆 ${lang.gameEnd}`,
        '',
        `**${lang.eliminated}:** ${eliminatedStr}`,
      ];

      if (r.hunterKills.length > 0) {
        for (const hk of r.hunterKills) {
          lines.push(lang.hunterDrags(hk.hunter, hk.target));
        }
      }

      const winTeam = tTeam(lang, r.winnerTeam === 'Village' ? 'village' : 'wolf');
      lines.push('');
      lines.push(`### 🎯 ${lang.wins(winTeam)}`);
      lines.push('');

      let explain;
      if (r.eliminated.length === 0 && r.finalRoles.every((fr) => ROLE_DEFS[fr.finalRole]?.team !== 'wolf')) {
        explain = lang.explainAllCenter;
      } else if (r.eliminated.length === 0) {
        explain = lang.explainScatter;
      } else if (r.winnerTeam === 'Village') {
        explain = lang.explainVillageWin(r.eliminated.join(', '));
      } else {
        explain = lang.explainWolfWin(r.eliminated.join(', '));
      }
      lines.push(`*${explain}*`);
      lines.push('');
      lines.push(`### ${lang.roleTable}`);
      lines.push('');
      lines.push(`| ${lang.colPlayer} | ${lang.colOrigRole} | ${lang.colFinalRole} | ${lang.colSwapped} |`);
      lines.push('|---|---|---|---|');
      for (const fr of r.finalRoles) {
        const swapped = fr.wasSwapped ? lang.swappedYes : lang.swappedNo;
        lines.push(`| ${fr.name} | ${t(lang, fr.originalRole)} | ${t(lang, fr.finalRole)} | ${swapped} |`);
      }
      lines.push('');
      lines.push(`**${lang.centerCards}:**`);
      lines.push(r.centerCards.map((c) => t(lang, c)).join(' • '));
      lines.push('');
      lines.push(`*${lang.endTime} ${new Date(ts).toLocaleString(lang.locale)}*`);
      for (const l of lines) appendLog(statePath, l);
      break;
    }

    default:
      console.error(`Error: Unknown event type "${event}". Valid: game-start, night-start, night-end, day-start, vote-start, vote-end, game-end`);
      process.exit(1);
  }

  console.log(JSON.stringify({ status: 'ok', event, lang: args.lang || 'vi', logFile: logPath(statePath) }));
}

/**
 * log-message --player <name> --round <round> --text <text> [--lang vi|en] [--state <path>]
 *
 * Appends a single player's spoken line to the game log during the day phase.
 * Called by the Game Master after each subagent speaks.
 *
 * --round: "opening" | "discussion-1" | "discussion-2" | "vote"
 * --lang:  "vi" (default) | "en"
 */
function cmdLogMessage(args) {
  const statePath = args.state || defaultStatePath();
  const state = loadState(statePath);
  const ts = new Date().toISOString();
  const lang = getLang(args);

  if (!args.player || !args.text) {
    console.error('Error: --player and --text are required');
    process.exit(1);
  }

  const player = state.players.find((p) => p.name === args.player);
  if (!player) {
    console.error(`Error: Player "${args.player}" not found`);
    process.exit(1);
  }

  const round = args.round || 'discussion';
  const roundLabel = lang.rounds[round] || round;

  const text = args.text.replace(/\n+/g, ' ').trim();

  const line = `*${fmtTime(ts)}* [${roundLabel}] **${args.player}**: ${text}`;
  appendLog(statePath, line);
  appendLog(statePath, '');

  console.log(JSON.stringify({ status: 'ok', player: args.player, round, logFile: logPath(statePath) }));
}

/**
 * log-view [--state <path>]
 *
 * Prints the full game log to stdout.
 */
function cmdLogView(args) {
  const statePath = args.state || defaultStatePath();
  const lp = logPath(statePath);
  if (!fs.existsSync(lp)) {
    console.log('(No game log found)');
    return;
  }
  process.stdout.write(fs.readFileSync(lp, 'utf-8'));
}

// ---------------------------------------------------------------------------
// CLI dispatch
// ---------------------------------------------------------------------------

const [command, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);

switch (command) {
  case 'init':
    cmdInit(args);
    break;
  case 'night':
    cmdNight(args);
    break;
  case 'player-view':
    cmdPlayerView(args);
    break;
  case 'vote':
    cmdVote(args);
    break;
  case 'resolve':
    cmdResolve(args);
    break;
  case 'state':
    cmdState(args);
    break;
  case 'log':
    cmdLog(args);
    break;
  case 'log-message':
    cmdLogMessage(args);
    break;
  case 'log-view':
    cmdLogView(args);
    break;
  default:
    console.error(`Unknown command: ${command || '(none)'}`);
    console.error('Usage: node game-engine.mjs <init|night|player-view|vote|resolve|state|log|log-message|log-view> [options]');
    process.exit(1);
}
