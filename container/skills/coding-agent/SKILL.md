---
name: coding-agent
description: "Delegate coding tasks to Claude Code, Codex, OpenCode, or Gemini CLI via background process. Use when: (1) building/creating new features or apps, (2) reviewing PRs (spawn in temp dir), (3) refactoring large codebases, (4) iterative coding that needs file exploration. NOT for: simple one-liner fixes (just edit), reading code (use read tool)."
metadata:
  { "nanoclaw": { "emoji": "🧩" } }
---

# Coding Agent (bash-first)

Use **bash** for all coding agent work. Since NanoClaw doesn't have the process tool, use bash background jobs for process management.

## PTY Mode Required!

Coding agents (Codex, Claude Code, OpenCode) are **interactive terminal applications** that need a pseudo-terminal (PTY) to work correctly. Without PTY, you'll get broken output, missing colors, or the agent may hang.

**Always use `pty:true`** when running coding agents:

```bash
# Correct - with PTY
bash pty:true command:"codex exec 'Your prompt'"

# Wrong - no PTY, agent may break
bash command:"codex exec 'Your prompt'"
```

---

## Quick Start: One-Shot Tasks

For quick prompts/chats, create a temp git repo and run:

```bash
# Quick chat (Codex needs a git repo!)
SCRATCH=$(mktemp -d) && cd $SCRATCH && git init && codex exec "Your prompt here"

# Or in a real project - with PTY!
bash pty:true workdir:~/Projects/myproject command:"codex exec 'Add error handling to the API calls'"
```

---

## Process Management (via Bash)

Since NanoClaw doesn't have the process tool, use these bash patterns instead:

### Start Background Agent

```bash
# Start agent in background with PTY
bash pty:true workdir:~/project background:true command:"codex exec --full-auto 'Build a snake game'"

# Capture the PID for tracking
bash pty:true workdir:~/project background:true command:"codex exec --full-auto 'Build a snake game'" &

# Store session ID (bash job number)
echo $!
```

### Check if Process Running

```bash
# Check if process is still running
ps -p <PID> > /dev/null && echo "Running" || echo "Done"

# Or use jobs
jobs
```

### Get Process Output

```bash
# For background jobs, output goes to terminal
# Use redirection to capture output
bash pty:true workdir:~/project background:true command:"codex exec 'Task' > /tmp/agent-output.txt 2>&1 &"
```

### Kill Process

```bash
# Kill by PID
kill <PID>

# Kill all agent processes
pkill -f "codex"
pkill -f "claude"
pkill -f "opencode"
pkill -f "gemini"
```

---

## Supported Agents

### Claude Code

```bash
# With PTY for proper terminal output
bash pty:true workdir:~/project command:"claude 'Your task'"

# Background
bash pty:true workdir:~/project background:true command:"claude 'Your task'"
```

### Codex CLI

```bash
# Quick one-shot (auto-approves) - remember PTY!
bash pty:true workdir:~/project command:"codex exec --full-auto 'Build a dark mode toggle'"

# Background for longer work
bash pty:true workdir:~/project background:true command:"codex --yolo 'Refactor the auth module'"
```

### OpenCode

```bash
bash pty:true workdir:~/project command:"opencode run 'Your task'"
```

### Gemini CLI

```bash
# Interactive mode (requires PTY)
bash pty:true workdir:~/project command:"gemini 'Your task'"

# Non-interactive (headless)
bash pty:true workdir:~/project command:"gemini -p 'Your task'"
```

---

## Rules

1. **Always use pty:true** - coding agents need a terminal!
2. **Respect tool choice** - if user asks for Codex, use Codex.
3. **Be patient** - don't kill sessions because they're "slow"
4. **Monitor with bash** - check progress without interfering
5. **--full-auto for building** - auto-approves changes
6. **Parallel is OK** - run many agent processes at once for batch work
7. **NEVER start agents in ~/.nanoclaw/** - it'll read your configuration!

---

## Progress Updates (Critical)

When you spawn coding agents in the background, keep the user in the loop.

- Send 1 short message when you start (what's running + where).
- Then only update again when something changes:
  - a milestone completes (build finished, tests passed)
  - the agent asks a question / needs input
  - you hit an error or need user action
  - the agent finishes (include what changed + where)
- If you kill a session, immediately say you killed it and why.

This prevents the user from seeing only "Agent failed before reply" and having no idea what happened.

---

## Parallel with Git Worktrees

For fixing multiple issues in parallel, use git worktrees:

```bash
# 1. Create worktrees for each issue
git worktree add -b fix/issue-78 /tmp/issue-78 main
git worktree add -b fix/issue-99 /tmp/issue-99 main

# 2. Launch agent in each (background + PTY!)
bash pty:true workdir:/tmp/issue-78 background:true command:"pnpm install && codex --yolo 'Fix issue #78'"
bash pty:true workdir:/tmp/issue-99 background:true command:"pnpm install && codex --yolo 'Fix issue #99'"

# 3. Monitor progress with ps
ps aux | grep codex

# 4. Create PRs after fixes
cd /tmp/issue-78 && git push -u origin fix/issue-78
gh pr create --repo user/repo --head fix/issue-78 --title "fix: ..." --body "..."

# 5. Cleanup
git worktree remove /tmp/issue-78
git worktree remove /tmp/issue-99
```
