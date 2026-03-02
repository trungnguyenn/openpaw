# ONUW Strategy Guide — Theory of Mind for AI Agents

This reference is injected into player subagent prompts to improve reasoning quality during One Night Ultimate Werewolf games.

## Theory of Mind (ToM) Levels

Social deduction requires modeling what others know and believe. Reason at multiple levels:

- **Level 0 — Self**: What do I know about my own role and night actions?
- **Level 1 — Others' knowledge**: What does each player know based on their claimed role?
- **Level 2 — Others' beliefs about me**: What do they think I know? Do my claims make me look suspicious?
- **Level 3 — Nested reasoning**: What does Player A think Player B believes about Player C?

Wolves must reason at L2+ to construct believable lies. Village roles should reason at L1+ to spot inconsistencies.

## Bayesian Reasoning Framework

After hearing each player's claim, update your beliefs about role assignments:

**Prior probability**: Before anyone speaks, each player has an equal chance of holding any role. With N players and N+3 cards, each role has a N/(N+3) chance of being held by a player.

**Likelihood update**: When Player X claims Role R, consider:
- P(X claims R | X is R) — high for Village, they usually tell the truth
- P(X claims R | X is Wolf) — wolves claim Village roles, especially safe ones
- P(X claims R | R is in center) — if R is in the center, X's claim is false

**Key heuristic**: Count the claims. If more players claim a role than copies exist, at least one is lying. Two Seer claims when only one Seer exists means one is almost certainly a Wolf.

## Contradiction Detection

Look for these logical impossibilities in the discussion:

### Overclaimed roles
If two players both claim Seer and only one Seer card exists, one is lying. The one whose "evidence" contradicts the game engine's constraints is more likely the Wolf.

### Impossible night sequences
Night actions happen in a fixed order (Werewolf → Mason → Seer → Robber → Troublemaker → Drunk). If a claim implies an action happened out of order, it is fabricated.

### Swap chain conflicts
Track swap chains carefully:
- Robber swaps BEFORE Troublemaker
- If Robber claims to have swapped with Player A and now holds Role X, Player A should now hold Robber (unless Troublemaker subsequently swapped Player A with someone else)
- If Troublemaker swapped players B and C, their roles changed AFTER Seer/Robber acted

### Information that shouldn't exist
- A Villager claiming to have night information (Villagers sleep through the night)
- A Drunk claiming to know their new role (Drunk does NOT look at the swapped card)
- A Troublemaker claiming to know what roles were swapped (Troublemaker does NOT look)

## Per-Role Strategies

### Werewolf (Bluffing)

**Goal**: Survive the vote. Never admit you are a Wolf.

**Best claims**:
- Villager — safe but unverifiable; multiple Villagers are expected
- A role you know is in the center — if you peeked as solo Wolf, claim that center role
- Seer (risky) — claim you saw someone as a Villager; if the real Seer exists, you'll be caught

**Tactics**:
- Claim early and confidently; hesitation is suspicious
- If your co-Wolf is accused, do NOT immediately defend them (looks coordinated)
- Redirect suspicion: "Why is nobody questioning Player X?"
- If caught in a contradiction, pivot to accusing your accuser as the real Wolf

**Solo Wolf advantage**: If you peeked at a center card, you know one role that is NOT in play. Use this to catch others in false claims.

### Seer (Information advantage)

**Goal**: Use your evidence to identify Wolves without being discredited.

**If you saw a player's card**:
- Revealing a Wolf immediately is powerful but may be dismissed as a Wolf bluff
- Build supporting evidence first: "I have information, but I want to hear others' claims first"
- If the player you saw claims a different role, call them out with specifics

**If you saw two center cards**:
- You know which roles are NOT among the players
- Use this to debunk false claims: "The Robber is in the center, so whoever claims Robber is lying"
- This is harder to fake because it produces verifiable constraints

### Robber (Dual knowledge)

**Goal**: Leverage knowing both your original role and your stolen role.

- You WERE the Robber. You now HOLD the role you stole.
- If you stole a Wolf card: you are now a Wolf, BUT you still win with the Village (your original team)
- Your target now holds the Robber card
- If your target claims to still be their original role, they may not realize they were robbed (Robber acts before Troublemaker, so if TM didn't swap them, they genuinely don't know)

**Key power**: You can confirm or deny other claims. If you stole from Player A and saw they were Seer, but Player B also claims Seer, one of them is lying.

### Troublemaker (Chaos agent)

**Goal**: Use your swap knowledge to create productive confusion.

- You know WHO you swapped, but not WHAT roles they now hold
- The two swapped players may not know they were swapped
- If Player A claims to be the Seer and you swapped Player A, they might no longer BE the Seer
- Use this strategically: "I swapped A and B, so their claims about being {role} might be outdated"

**Caution**: Revealing your swap too early lets Wolves adapt their story. Consider withholding until contradictions emerge.

### Drunk (Uncertainty)

**Goal**: Be honest about your uncertainty; it establishes Village credibility.

- You swapped with a center card and do NOT know your new role
- You could now be anything, including a Werewolf
- Your honesty about not knowing is a strong Village signal (Wolves would claim a specific role)
- Focus on analyzing others' claims since you cannot contribute role information

### Hunter (Deterrent)

**Goal**: Make yourself a costly target for elimination.

- If you are eliminated, you take one player with you
- Remind others: "If you vote me out and I'm not a Wolf, you lose another Villager"
- This deters Wolves from pushing to eliminate you
- Use your survivability to be bold in accusations

### Mason (Mutual verification)

**Goal**: Establish a trust anchor with your partner.

- You and your partner can vouch for each other as Village
- If only one Mason is among players (other in center), you have no corroborator — be cautious about claiming Mason without support
- A false Mason claim is extremely risky: the real Masons will immediately expose it
- **Watch for Troublemaker**: If TM swapped one Mason, that Mason's role changed but they don't know it

## Common Meta-Strategies

### The "claim train"
When multiple players rapidly claim roles, it pressures Wolves to commit to a story before they can adapt. Encourage fast claiming.

### The silent player trap
Players who stay quiet are often Wolves trying to avoid contradictions. Ask them direct questions to force a claim.

### Vote splitting
Wolves benefit from scattered votes (nobody dies). If you suspect vote manipulation, rally behind a single target.

### The Robber paradox
If someone claims Robber and says "I stole Wolf from Player X", Player X is now the Robber, not a Wolf. But if Player X disputes this, who do you believe? The answer often depends on the consistency of their earlier claims.
