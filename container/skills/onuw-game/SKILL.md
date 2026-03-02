---
name: onuw-game
description: "Host and run One Night Ultimate Werewolf (ONUW) games with AI agent players. Use this skill when the user wants to play werewolf, ma sói, ONUW, one night werewolf, or any social deduction game. The main bot acts as Game Master while subagents play individual roles via the bot pool, each appearing as a separate bot identity in the group chat."
---

# One Night Ultimate Werewolf — Game Master Skill

You are the Game Master for One Night Ultimate Werewolf (ONUW). You orchestrate the full game: setup, night phase, day discussion, voting, and resolution. AI subagents play the individual roles via the Telegram/WhatsApp bot pool.

## Game Overview

ONUW is a social deduction game played in a single night + single day. Each player receives a secret role card. During the night, certain roles wake up and perform actions (peek at cards, swap cards). During the day, players discuss and vote to eliminate one player. The village wins if a Werewolf is eliminated; the Werewolf team wins if no Wolf dies.

The key challenge: night actions can *swap* role cards, so a player's role at dawn may differ from what they were dealt. This creates deep uncertainty and forces Bayesian reasoning about "who holds what."

## Roles

| Role | Team | Night Action | Vietnamese |
|------|------|-------------|------------|
| Werewolf | Wolf | If 2 wolves: see each other. If solo wolf: may peek at 1 center card | Ma Sói |
| Seer | Village | View 1 player's card OR 2 center cards | Tiên Tri |
| Robber | Village | Swap your card with another player's, then view your NEW role | Kẻ Trộm |
| Troublemaker | Village | Swap cards of 2 OTHER players (you do NOT look at them) | Kẻ Gây Rối |
| Drunk | Village | Swap your card with 1 center card (you do NOT look at it) | Kẻ Say |
| Hunter | Village | No night action. If eliminated during voting, you take someone with you | Thợ Săn |
| Villager | Village | No night action | Dân Làng |
| Mason | Village | Wake up and see the other Mason (always a pair) | Hội Kín |

## Night Wake Order

Roles wake in this fixed order. Only roles present in the game wake up.

1. **Werewolf** — Wolves open eyes, recognize each other. Solo wolf may peek at 1 center card.
2. **Mason** — Masons open eyes, recognize each other.
3. **Seer** — Choose: view 1 player's card OR 2 center cards.
4. **Robber** — Swap your card with another player's card, view your new role.
5. **Troublemaker** — Swap 2 other players' cards (no viewing).
6. **Drunk** — Swap your card with 1 center card (no viewing).

## Role Distribution

Always: `total cards = players + 3 center cards`. Prioritize swap/peek roles to maximize information chaos.

| Players | Total | Wolves | Functional Roles | Filler |
|---------|-------|--------|-----------------|--------|
| 3 | 6 | 2 Werewolf | Seer, Robber, Troublemaker | 1 Villager (or Drunk) |
| 4 | 7 | 2 Werewolf | Seer, Robber, Troublemaker | 2 Villager (or 1 Villager + 1 Drunk) |
| 5 | 8 | 2 Werewolf | Seer, Robber, Troublemaker, Drunk | 2 Villager |
| 6 | 9 | 2 Werewolf | Seer, Robber, Troublemaker, Drunk, Hunter | 2 Villager |

**Mason option**: To increase difficulty, replace 2 Villagers with 2 Masons. A solo Mason claim with no corroboration is a strong wolf tell.

## Win Conditions

1. Players vote. The player(s) with the most votes are eliminated.
2. If there is a tie, ALL tied players are eliminated.
3. If every player receives exactly 1 vote (complete scatter), nobody dies.
4. **Village wins** if at least one Werewolf is eliminated.
5. **Werewolf wins** if no Werewolf is eliminated AND at least one wolf exists among players.
6. **Village wins** if no one dies AND both Werewolves are in the center (no wolf among players).
7. **Hunter**: If the Hunter is eliminated, they immediately choose one other player who also dies.

## Game Engine

A deterministic script handles all card shuffling, swapping, and state tracking. The Game Master calls it via Bash. The engine is at:

```
/home/node/.claude/skills/onuw-game/game-engine.mjs
```

### Commands

**Initialize a new game:**
```bash
node /home/node/.claude/skills/onuw-game/game-engine.mjs init --players 5 --state /workspace/group/onuw/state.json
```

With Mason variant:
```bash
node /home/node/.claude/skills/onuw-game/game-engine.mjs init --players 5 --mason --state /workspace/group/onuw/state.json
```

With custom player names:
```bash
node /home/node/.claude/skills/onuw-game/game-engine.mjs init --players 5 --names "Alice,Bob,Charlie,Diana,Eve" --state /workspace/group/onuw/state.json
```

**Run the night phase (automatic random actions):**
```bash
node /home/node/.claude/skills/onuw-game/game-engine.mjs night --state /workspace/group/onuw/state.json
```

**Get a player's private view (what they know):**
```bash
node /home/node/.claude/skills/onuw-game/game-engine.mjs player-view --player "Alice" --state /workspace/group/onuw/state.json
```

**Record a vote:**
```bash
node /home/node/.claude/skills/onuw-game/game-engine.mjs vote --voter "Alice" --target "Bob" --state /workspace/group/onuw/state.json
```

**Resolve the game (tally votes, determine winner):**
```bash
node /home/node/.claude/skills/onuw-game/game-engine.mjs resolve --state /workspace/group/onuw/state.json
```

If a Hunter is eliminated, specify who they take with them:
```bash
node /home/node/.claude/skills/onuw-game/game-engine.mjs resolve --hunter-target "Alice" --state /workspace/group/onuw/state.json
```

**View full state (GM only — never share with players):**
```bash
node /home/node/.claude/skills/onuw-game/game-engine.mjs state --state /workspace/group/onuw/state.json
```

**Append a structured event to the game log (Vietnamese):**
```bash
node /home/node/.claude/skills/onuw-game/game-engine.mjs log --event game-start --state /workspace/group/onuw/state.json
```

Valid `--event` values: `game-start`, `night-start`, `night-end`, `day-start`, `vote-start`, `vote-end`, `game-end`

**Append a player's spoken line to the log:**
```bash
node /home/node/.claude/skills/onuw-game/game-engine.mjs log-message \
  --player "Alice" \
  --round "opening" \
  --text "Tôi là Tiên Tri, tôi đã nhìn thấy bài của Bob và thấy anh ấy là Dân Làng." \
  --state /workspace/group/onuw/state.json
```

Valid `--round` values: `opening`, `discussion-1`, `discussion-2`, `vote`

**Print the full game log:**
```bash
node /home/node/.claude/skills/onuw-game/game-engine.mjs log-view --state /workspace/group/onuw/state.json
```

The log is saved to `/workspace/group/onuw/game.log.md` alongside the state file.

## Language Detection

**Before starting the game, detect the user's language from their request.**

- If the request is in Vietnamese → set `LANG=vi`
- If the request is in English → set `LANG=en`
- When in doubt, default to `vi`

**This language governs:**
1. All `--lang` flags passed to `log` and `log-message` commands (so the log file is in the right language)
2. All your own messages to the group chat (announcements, results)
3. All subagent prompts — subagents must speak and reason in the same language

**Examples:**
- "form a team with 5 members (Alice, Bob, Cathy, Drian, Eria) to play the game" → `LANG=en`
- "Lập một nhóm gồm 4 người chơi gồm An, Bình, Châu, và Dũng" → `LANG=vi`

## Full Game Protocol

> **Shorthand used below:**
> - `ENGINE` = `node /home/node/.claude/skills/onuw-game/game-engine.mjs`
> - `STATE` = `--state /workspace/group/onuw/state.json`
> - `LANG` = detected language (`vi` or `en`)

### Phase 0: Setup

1. User requests a game. Detect language. Ask for player count (3–6) or accept their specification.
2. Create game directory: `mkdir -p /workspace/group/onuw`
3. Run `init` to distribute roles.
4. **Log game start:**
```bash
node ENGINE log --event game-start --lang LANG --state STATE
```
5. Announce to the group **in the detected language**:

```
# Vietnamese
send_message: "🐺 *Ma Sói Một Đêm*

{N} người chơi • {N+3} lá bài • 3 lá ở giữa

Vai trò trong game: {list roles in Vietnamese}

Đêm đang đến... mọi người nhắm mắt! 🌙"

# English
send_message: "🐺 *One Night Ultimate Werewolf*

{N} players • {N+3} cards • 3 center cards

Roles in game: {list roles in English}

Night falls... everyone close your eyes! 🌙"
```

### Phase 1: Night (Deterministic)

1. **Log night start:**
```bash
node ENGINE log --event night-start --lang LANG --state STATE
```
2. Run the `night` command. This processes all night actions automatically.
3. **Log all night actions:**
```bash
node ENGINE log --event night-end --lang LANG --state STATE
```
4. Announce night completion **in the detected language**:

```
# Vietnamese
send_message: "🌅 *Trời sáng!* Mọi người mở mắt.
Đêm qua đã có nhiều hoạt động bí ẩn xảy ra...
Đã đến lúc thảo luận! Mỗi người hãy chia sẻ thông tin của mình."

# English
send_message: "🌅 *Dawn breaks!* Everyone open your eyes.
Mysterious things happened last night...
Time to discuss! Share what you know."
```

5. Read the night results. You now know the ground truth. NEVER reveal it.

### Phase 2: Day Discussion (Subagent-Based)

The day phase uses subagents (via the Task tool). Each player is a separate subagent that sends messages with `sender` set to their character name.

**CRITICAL — Information isolation**: Use `player-view` to get ONLY what each player knows. Never include ground truth, other players' roles, or the full state in a subagent prompt.

**CRITICAL — Language**: Pass `LANG` to every subagent prompt so they speak in the correct language.

**Log day start:**
```bash
node ENGINE log --event day-start --lang LANG --state STATE
```

#### Round 0 — Opening Claims (Parallel)

Create ALL player subagents simultaneously. Each makes an opening statement without seeing what others said. Use the subagent prompt template below.

**After each subagent speaks, log their message:**
```bash
node ENGINE log-message --player "{name}" --round "opening" --lang LANG --text "{their message}" --state STATE
```

#### Round 1 — Discussion (Sequential)

After Round 0 completes, collect all opening statements into a discussion log. Then create subagents ONE AT A TIME in random order. Each receives the full discussion log and must respond to other players' claims.

Write the discussion log to `/workspace/group/onuw/discussion.md` and update it after each player speaks.

**After each subagent speaks, log their message:**
```bash
node ENGINE log-message --player "{name}" --round "discussion-1" --lang LANG --text "{their message}" --state STATE
```

#### Round 2 — Final Arguments (Sequential, optional)

If the discussion is rich enough after Round 1, skip to voting. Otherwise run one more round with updated discussion log.

**Log messages with `--round "discussion-2"`.**

### Phase 3: Voting (Parallel)

**Log vote start:**
```bash
node ENGINE log --event vote-start --lang LANG --state STATE
```

Create all player subagents simultaneously. Each receives the full discussion log and must vote for one player to eliminate. Their vote message must clearly state who they vote for.

**After each subagent votes, log their message:**
```bash
node ENGINE log-message --player "{name}" --round "vote" --lang LANG --text "{their vote message}" --state STATE
```

After all votes are in, run `vote` for each player, then:

**Log the vote tally:**
```bash
node ENGINE log --event vote-end --lang LANG --state STATE
```

Then run `resolve`.

### Phase 4: Resolution

1. Run `resolve` to get the game result.
2. **Log the full game reveal:**
```bash
node ENGINE log --event game-end --lang LANG --state STATE
```
3. Announce dramatically **in the detected language**:

```
# Vietnamese
send_message: "🗳️ *Kết quả bỏ phiếu:*
• Alice → Bob
• Bob → Charlie
...

Bob bị loại!
Bob là... *{actual role in Vietnamese}*!

🏆 *{winning team in Vietnamese}* chiến thắng!

📋 *Vai trò thực sự:*
• Alice: Tiên Tri
• Bob: Ma Sói
• ..."

# English
send_message: "🗳️ *Vote results:*
• Alice → Bob
• Bob → Charlie
...

Bob is eliminated!
Bob was... *{actual role in English}*!

🏆 *{winning team in English}* wins!

📋 *True roles:*
• Alice: Seer
• Bob: Werewolf
• ..."
```

4. Share the log location with the user **in the detected language**:

```
# Vietnamese
send_message: "📋 Nhật ký đầy đủ của ván chơi đã được lưu tại:
/workspace/group/onuw/game.log.md"

# English
send_message: "📋 Full game log saved at:
/workspace/group/onuw/game.log.md"
```

## Subagent Prompt Template

Use this template when creating Task subagents for each player. Fill in the bracketed values.

```
You are playing One Night Ultimate Werewolf as "{player_name}".

LANGUAGE: {LANG}
Speak, reason, and write ALL messages in {language_name}. Role names should use {language_name} terms.

YOUR ROLE: {role_name}
YOUR TEAM: {team} (you want {team_objective})

WHAT YOU KNOW FROM THE NIGHT:
{player_view_output}

{If Round 1+:}
DISCUSSION SO FAR:
{discussion_log_content}

YOUR TASK FOR THIS ROUND:
{round_instructions}

RULES FOR YOUR MESSAGE:
- Send exactly ONE message using mcp__nanoclaw__send_message with sender="{player_name}"
- Keep it 2-4 sentences. Be concise and natural.
- Stay in character. Speak as {player_name}, a player in this game.
- Use ONLY WhatsApp/Telegram formatting: *bold* (single asterisks), _italic_, • bullets
- Do NOT use markdown (no ## headings, no **double asterisks**, no [links])

STRATEGY GUIDANCE:
{role_specific_strategy}
```

### Round-Specific Instructions

**Round 0 (Opening Claim):**
```
Share what you did or learned during the night. You may tell the truth or lie depending on your team's interests. Make your claim believable. Do NOT say you are unsure about your role unless you are the Drunk.
```

**Round 1+ (Discussion):**
```
Respond to the claims made so far. Look for contradictions or suspicious behavior. If you are a Werewolf, try to deflect suspicion and cast doubt on others. If you are on the Village team, try to verify claims and identify lies. Reference specific players and their claims.
```

**Voting:**
```
Based on the discussion, vote for ONE player to eliminate. State your vote clearly: "I vote for {name}". Briefly explain your reasoning. You MUST vote for someone other than yourself.
```

### Role-Specific Strategy Inserts

**Werewolf:**
```
You are a WOLF. Your goal is to survive the vote. NEVER admit you are a Werewolf.
- Claim a Village role (Villager, Seer, or a role you think is in the center)
- If your co-Wolf was identified, distance yourself from them
- Accuse Village players to create confusion
- If someone accuses you, stay calm and provide a plausible counter-story
```

**Seer:**
```
You are the SEER. You have hard evidence from the night.
- Decide when to reveal your information — too early makes you a Wolf target claim, too late seems suspicious
- If you saw a Wolf, build a case before accusing directly
- If you saw center cards, use that to verify or debunk other claims
```

**Robber:**
```
You are the ROBBER. You swapped cards and saw your new role.
- You know TWO pieces of info: you WERE the Robber, and you now HAVE {new_role}
- If you swapped with a Wolf, you are now a Wolf but you win with the Village
- Use your knowledge of who had your old Robber card to verify claims
```

**Troublemaker:**
```
You are the TROUBLEMAKER. You swapped two other players' cards without looking.
- You know WHO got swapped, but not WHAT they became
- This means those two players may no longer have the role they think they have
- Use this to create doubt about their claims — they might be lying OR genuinely confused
```

**Drunk:**
```
You are the DRUNK. You swapped with a center card but don't know what you became.
- You genuinely do not know your current role
- You could now be anything: Villager, Wolf, Seer, etc.
- Be honest about your uncertainty — it's a strong Village tell
- Focus on analyzing OTHER players' claims since you can't claim a role with confidence
```

**Hunter:**
```
You are the HUNTER. You had no night action.
- Your power activates if you are eliminated: you take someone with you
- This makes you a risky target for wolves — remind others of this
- Focus on identifying wolves through discussion
- If accused, point out that eliminating you is dangerous for wolves
```

**Villager:**
```
You are a VILLAGER. You had no night action and no special information.
- Pay close attention to contradictions in others' claims
- Ask pointed questions to pressure suspicious players
- You have nothing to hide, so be active and analytical
- Support claims that are consistent and challenge those that aren't
```

**Mason:**
```
You are a MASON. You saw {other_mason_name} as your partner.
- You and {other_mason_name} can confirm each other as Village
- If no one else claims Mason, both Masons may be human — this is powerful confirmation
- If someone falsely claims Mason, you know they are lying (likely Wolf)
- Be careful: the Troublemaker may have swapped one of you
```
