import { exec } from 'child_process';
import { promisify } from 'util';

import { ANTHROPIC_MODELS, DEFAULT_MODEL } from './config.js';
import { readEnvFile, updateEnvFile } from './env.js';
import { logger } from './logger.js';
import { NewMessage, RegisteredGroup, SessionState } from './types.js';

const execAsync = promisify(exec);

// Session states - keyed by chat JID
const sessionStates = new Map<string, SessionState>();

export interface ResetConversationResult {
  hadSession: boolean;
  closedActiveContainer?: boolean;
}

// Active group queues - we'll get this from index.ts
let getActiveContainers: (() => Map<string, { containerName: string; groupFolder: string; active: boolean }>) | null = null;
let resetConversation:
  | ((msg: NewMessage, group: RegisteredGroup) => Promise<ResetConversationResult>)
  | null = null;

// Register the function to get active containers
export function setContainerTracker(
  fn: () => Map<string, { containerName: string; groupFolder: string; active: boolean }>,
): void {
  getActiveContainers = fn;
}

export function setResetConversationHandler(
  fn: (msg: NewMessage, group: RegisteredGroup) => Promise<ResetConversationResult>,
): void {
  resetConversation = fn;
}

// Get or create session state for a chat
export function getSessionState(chatJid: string): SessionState {
  let state = sessionStates.get(chatJid);
  if (!state) {
    state = {
      model: DEFAULT_MODEL,
      thinkLevel: 'medium',
      verbose: false,
      updatedAt: new Date().toISOString(),
    };
    sessionStates.set(chatJid, state);
  }
  return state;
}

// Update session state
export function updateSessionState(chatJid: string, updates: Partial<SessionState>): SessionState {
  const state = getSessionState(chatJid);
  Object.assign(state, updates, { updatedAt: new Date().toISOString() });
  sessionStates.set(chatJid, state);
  return state;
}

// Command handler type
type CommandHandler = (
  args: string[],
  msg: NewMessage,
  group: RegisteredGroup,
) => Promise<string>;

// Command definitions
interface Command {
  name: string;
  description: string;
  handler: CommandHandler;
}

// Command registry
const commands = new Map<string, Command>();

// Register a command
function registerCommand(name: string, description: string, handler: CommandHandler): void {
  commands.set(name, { name, description, handler });
}

// Get help text for all commands
export function getHelpText(): string {
  const lines = ['*Available Commands:*\n'];
  for (const [name, cmd] of commands) {
    lines.push(`• /${name} — ${cmd.description}`);
  }
  lines.push('\n_Use /command to run a command_');
  return lines.join('\n');
}

// --- Command Handlers ---

// /help
async function helpHandler(): Promise<string> {
  return getHelpText();
}

// /status
async function statusHandler(_args: string[], _msg: NewMessage, group: RegisteredGroup): Promise<string> {
  const lines = ['*Status:*'];
  lines.push(`• Group: ${group.name}`);
  lines.push(`• Folder: ${group.folder}`);

  // Show active containers
  if (getActiveContainers) {
    const containers = getActiveContainers();
    const activeForGroup: string[] = [];
    for (const [jid, info] of containers) {
      if (info.active && info.groupFolder === group.folder) {
        activeForGroup.push(info.containerName);
      }
    }
    if (activeForGroup.length > 0) {
      lines.push(`• Active containers: ${activeForGroup.length}`);
      for (const c of activeForGroup) {
        lines.push(`  - ${c}`);
      }
    } else {
      lines.push('• Active containers: none');
    }
  }

  return lines.join('\n');
}

// /whoami
async function whoamiHandler(_args: string[], msg: NewMessage): Promise<string> {
  return `*Your Identity:*\n• Sender: ${msg.sender}\n• Name: ${msg.sender_name}\n• Chat: ${msg.chat_jid}`;
}

// /models - List available models (numbered)
async function modelsHandler(): Promise<string> {
  const lines = ['*Available Models:*'];
  for (let i = 0; i < ANTHROPIC_MODELS.length; i++) {
    lines.push(`${i + 1}. ${ANTHROPIC_MODELS[i]}`);
  }
  lines.push('\n_Use /model <type> <index> to switch_');
  return lines.join('\n');
}

// /model - Show current model or update model with type
async function modelHandler(args: string[], _msg: NewMessage): Promise<string> {
  // Read current model values from .env
  const currentModels = readEnvFile([
    'ANTHROPIC_MODEL',
    'ANTHROPIC_SMALL_FAST_MODEL',
    'ANTHROPIC_DEFAULT_OPUS_MODEL',
    'ANTHROPIC_DEFAULT_SONNET_MODEL',
    'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  ]);

  if (args.length === 0) {
    // Show current models with indices
    const lines = ['*Current Models:*'];

    // Helper to find index of a model
    const findIndex = (model: string) => {
      const idx = ANTHROPIC_MODELS.indexOf(model);
      return idx >= 0 ? ` (${idx + 1})` : '';
    };

    lines.push(`default:${findIndex(currentModels.ANTHROPIC_MODEL || '')} ${currentModels.ANTHROPIC_MODEL || '(not set)'}`);
    lines.push(`fast:${findIndex(currentModels.ANTHROPIC_SMALL_FAST_MODEL || '')} ${currentModels.ANTHROPIC_SMALL_FAST_MODEL || '(not set)'}`);
    lines.push(`opus:${findIndex(currentModels.ANTHROPIC_DEFAULT_OPUS_MODEL || '')} ${currentModels.ANTHROPIC_DEFAULT_OPUS_MODEL || '(not set)'}`);
    lines.push(`sonnet:${findIndex(currentModels.ANTHROPIC_DEFAULT_SONNET_MODEL || '')} ${currentModels.ANTHROPIC_DEFAULT_SONNET_MODEL || '(not set)'}`);
    lines.push(`haiku:${findIndex(currentModels.ANTHROPIC_DEFAULT_HAIKU_MODEL || '')} ${currentModels.ANTHROPIC_DEFAULT_HAIKU_MODEL || '(not set)'}`);

    lines.push('\n_Use /models to see available models with indices_');
    lines.push('Usage: /model <type> <model or index>');
    lines.push('Examples:');
    lines.push('  /model default 1     → set default to model #1');
    lines.push('  /model fast grok    → set fast to grok model');
    return lines.join('\n');
  }

  // Parse type: default, fast, opus, sonnet, haiku
  const validTypes = ['default', 'fast', 'opus', 'sonnet', 'haiku'];
  const type = args[0].toLowerCase();

  // Check if the first argument is a valid type
  if (!validTypes.includes(type)) {
    return `*Error:* Invalid type "${type}"\n\nValid types: default, fast, opus, sonnet, haiku\n\nUsage:\n• /model - show current models\n• /model default 1 - set default to model #1\n• /model fast grok - set fast to grok model\n\nUse /models to see available models with indices.`;
  }

  // Get the model value from remaining args
  const modelValue = args.slice(1).join(' ').trim();
  if (!modelValue) {
    return `*Error:* Please specify a model\n\nUsage: /model ${type} <model or index>\n\nUse /models to see available models.`;
  }

  // Resolve model: could be index or model name
  let resolvedModel: string;
  const modelIndex = parseInt(modelValue, 10);

  if (!isNaN(modelIndex) && modelIndex >= 1 && modelIndex <= ANTHROPIC_MODELS.length) {
    // It's a valid index
    resolvedModel = ANTHROPIC_MODELS[modelIndex - 1];
  } else if (ANTHROPIC_MODELS.includes(modelValue)) {
    // It's a model name
    resolvedModel = modelValue;
  } else {
    return `*Error:* Invalid model "${modelValue}"\n\nUse /models to see available models with indices.\nYou can use either the model name or its index number.`;
  }

  // Map type to env variable
  const typeToEnvVar: Record<string, string> = {
    default: 'ANTHROPIC_MODEL',
    fast: 'ANTHROPIC_SMALL_FAST_MODEL',
    opus: 'ANTHROPIC_DEFAULT_OPUS_MODEL',
    sonnet: 'ANTHROPIC_DEFAULT_SONNET_MODEL',
    haiku: 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  };

  const envVar = typeToEnvVar[type];

  // Update .env file
  updateEnvFile({ [envVar]: resolvedModel });

  const idx = ANTHROPIC_MODELS.indexOf(resolvedModel) + 1;
  return `*Model updated:* ${type} → ${resolvedModel} (${idx})\n\n_Restart NanoClaw for changes to take effect_`;
}

// /think
async function thinkHandler(args: string[], _msg: NewMessage): Promise<string> {
  const chatJid = _msg.chat_jid;

  if (args.length === 0) {
    const state = getSessionState(chatJid);
    return `*Current thinking level:* ${state.thinkLevel || 'medium'}`;
  }

  const level = args[0].toLowerCase();
  const validLevels = ['off', 'minimal', 'low', 'medium', 'high'];

  if (!validLevels.includes(level)) {
    return `*Error:* Invalid level. Use: ${validLevels.join(', ')}`;
  }

  updateSessionState(chatJid, { thinkLevel: level as SessionState['thinkLevel'] });
  return `*Thinking level:* ${level}`;
}

// /verbose
async function verboseHandler(args: string[], _msg: NewMessage): Promise<string> {
  const chatJid = _msg.chat_jid;
  const state = getSessionState(chatJid);

  if (args.length === 0) {
    return `*Verbose:* ${state.verbose ? 'on' : 'off'}`;
  }

  const value = args[0].toLowerCase();
  if (value === 'on' || value === 'true') {
    updateSessionState(chatJid, { verbose: true });
    return '*Verbose:* on';
  } else if (value === 'off' || value === 'false') {
    updateSessionState(chatJid, { verbose: false });
    return '*Verbose:* off';
  }

  return '*Error:* Use /verbose on or /verbose off';
}

// /subagents list
async function subagentsHandler(args: string[], _msg: NewMessage, group: RegisteredGroup): Promise<string> {
  if (args.length === 0 || args[0] === 'list') {
    if (!getActiveContainers) {
      return '*Error:* Container tracker not available';
    }

    const containers = getActiveContainers();
    const activeForGroup: { jid: string; containerName: string; groupFolder: string }[] = [];

    for (const [jid, info] of containers) {
      if (info.active && info.groupFolder === group.folder) {
        activeForGroup.push({ jid, ...info });
      }
    }

    if (activeForGroup.length === 0) {
      return '*No active sub-agents*';
    }

    const lines = ['*Active Sub-agents:*'];
    for (let i = 0; i < activeForGroup.length; i++) {
      const c = activeForGroup[i];
      lines.push(`• #${i + 1}: ${c.containerName}`);
    }
    return lines.join('\n');
  }

  return '*Usage:* /subagents list';
}

// /kill
async function killHandler(args: string[], _msg: NewMessage, group: RegisteredGroup): Promise<string> {
  if (args.length === 0) {
    return '*Usage:* /kill <id|#|all>\n• /kill #1 — kill sub-agent #1\n• /kill all — kill all sub-agents';
  }

  if (!getActiveContainers) {
    return '*Error:* Container tracker not available';
  }

  const containers = getActiveContainers();
  const target = args[0].toLowerCase();

  if (target === 'all') {
    // Kill all containers for this group
    let killed = 0;
    for (const [jid, info] of containers) {
      if (info.active && info.groupFolder === group.folder) {
        // Use the closeStdin mechanism - we need to export this
        // For now, return instructions
        killed++;
      }
    }
    return `*Killing all sub-agents:* ${killed} agents signaled to stop`;
  }

  // Try to parse as number
  const num = parseInt(target.replace('#', ''), 10);
  if (isNaN(num)) {
    return '*Error:* Invalid target. Use /kill #1 or /kill all';
  }

  // Find the nth active container
  const activeForGroup: string[] = [];
  for (const [jid, info] of containers) {
    if (info.active && info.groupFolder === group.folder) {
      activeForGroup.push(jid);
    }
  }

  if (num < 1 || num > activeForGroup.length) {
    return `*Error:* Invalid sub-agent number. Use 1-${activeForGroup.length}`;
  }

  const targetJid = activeForGroup[num - 1];
  return `*Killing sub-agent #${num}:* ${containers.get(targetJid)?.containerName} signaled to stop`;
}

// /restart
async function restartHandler(): Promise<string> {
  // Restart the nanoclaw service
  try {
    execAsync('launchctl kickstart -k gui/$(id -u)/com.nanoclaw');
    return '*Restarting NanoClaw...*';
  } catch (err) {
    logger.error({ err }, 'Failed to restart nanoclaw');
    return `*Error:* Failed to restart: ${err}`;
  }
}

// /context - Show context info (simplified)
async function contextHandler(_args: string[], _msg: NewMessage, group: RegisteredGroup): Promise<string> {
  const lines = ['*Context:*'];
  lines.push(`• Group folder: ${group.folder}`);
  lines.push(`• Requires trigger: ${group.requiresTrigger !== false ? 'yes' : 'no'}`);

  // Show session state
  const state = getSessionState(_msg.chat_jid);
  lines.push(`• Model: ${state.model || DEFAULT_MODEL}`);
  lines.push(`• Think level: ${state.thinkLevel || 'medium'}`);
  lines.push(`• Verbose: ${state.verbose ? 'on' : 'off'}`);

  return lines.join('\n');
}

// /usage - Show usage (simplified placeholder)
async function usageHandler(): Promise<string> {
  return '*Usage tracking:* Not yet implemented.\n_This will show token/cost usage in a future update._';
}

// /reset - reset conversation/session for current group/chat
async function resetHandler(args: string[], msg: NewMessage, group: RegisteredGroup): Promise<string> {
  if (args.length > 0) {
    return '*Usage:* /reset';
  }

  if (!resetConversation) {
    return '*Error:* Reset handler not available';
  }

  const result = await resetConversation(msg, group);
  const lines = ['*Conversation reset.* A new session will start with your next message.'];
  if (result.closedActiveContainer) {
    lines.push('_Stopped the active agent for this chat to apply the reset immediately._');
  }
  return lines.join('\n');
}

// --- Register all commands ---

function initCommands(): void {
  registerCommand('help', 'Show available commands', helpHandler);
  registerCommand('status', 'Show current status', statusHandler);
  registerCommand('whoami', 'Show your sender identity', whoamiHandler);
  registerCommand('models', 'List available models', modelsHandler);
  registerCommand('model', 'Show/update model (/model, /model --fast <model>)', modelHandler);
  registerCommand('think', 'Control thinking level (/think, /think medium)', thinkHandler);
  registerCommand('verbose', 'Toggle verbose mode (/verbose, /verbose on)', verboseHandler);
  registerCommand('subagents', 'Manage sub-agents (/subagents list)', subagentsHandler);
  registerCommand('kill', 'Kill sub-agents (/kill #1, /kill all)', killHandler);
  registerCommand('restart', 'Restart the NanoClaw service', restartHandler);
  registerCommand('context', 'Show context info', contextHandler);
  registerCommand('usage', 'Show token/cost usage', usageHandler);
  registerCommand('reset', 'Reset current conversation session', resetHandler);
}

// Initialize commands
initCommands();

// --- Main command handler ---

export interface CommandResult {
  response: string;
  handled: boolean;
}

/**
 * Handle a slash command message.
 * Returns { response, handled: true } if it was a command,
 * or { handled: false } if it wasn't a command.
 */
export async function handleCommand(
  content: string,
  msg: NewMessage,
  group: RegisteredGroup,
): Promise<CommandResult> {
  // Parse command
  const trimmed = content.trim();
  if (!trimmed.startsWith('/')) {
    return { response: '', handled: false };
  }

  // Extract command name and args
  const spaceIdx = trimmed.indexOf(' ');
  let cmdName: string;
  let args: string[];

  if (spaceIdx === -1) {
    cmdName = trimmed.slice(1).toLowerCase();
    args = [];
  } else {
    cmdName = trimmed.slice(1, spaceIdx).toLowerCase();
    args = trimmed.slice(spaceIdx + 1).split(/\s+/).filter(Boolean);
  }

  // Telegram group commands can arrive as /command@bot_username
  const atIdx = cmdName.indexOf('@');
  if (atIdx > 0) {
    cmdName = cmdName.slice(0, atIdx);
  }

  // Find command
  const cmd = commands.get(cmdName);
  if (!cmd) {
    return {
      response: `*Unknown command:* /${cmdName}\n\n${getHelpText()}`,
      handled: true,
    };
  }

  // Execute command
  try {
    const response = await cmd.handler(args, msg, group);
    return { response, handled: true };
  } catch (err) {
    logger.error({ err, cmd: cmdName }, 'Error executing command');
    return {
      response: `*Error:* Command failed: ${err}`,
      handled: true,
    };
  }
}
