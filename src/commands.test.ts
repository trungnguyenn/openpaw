import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./config.js', () => ({
  ANTHROPIC_MODELS: ['model-a', 'model-b'],
  DEFAULT_MODEL: 'model-a',
}));

vi.mock('./env.js', () => ({
  readEnvFile: vi.fn(() => ({})),
  updateEnvFile: vi.fn(),
}));

vi.mock('./logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { handleCommand, setResetConversationHandler } from './commands.js';
import { NewMessage, RegisteredGroup } from './types.js';

function makeMessage(content: string): NewMessage {
  return {
    id: 'msg-1',
    chat_jid: 'tg:100200300',
    sender: '42',
    sender_name: 'Alice',
    content,
    timestamp: '2026-02-25T10:00:00.000Z',
  };
}

function makeGroup(): RegisteredGroup {
  return {
    name: 'Test Group',
    folder: 'test-group',
    trigger: '@Luzia365',
    added_at: '2026-02-25T10:00:00.000Z',
  };
}

describe('handleCommand /reset', () => {
  beforeEach(() => {
    setResetConversationHandler(async () => ({
      hadSession: true,
      closedActiveContainer: false,
    }));
  });

  it('handles /reset command and returns confirmation', async () => {
    const result = await handleCommand('/reset', makeMessage('/reset'), makeGroup());
    expect(result.handled).toBe(true);
    expect(result.response).toContain('Conversation reset');
  });

  it('supports Telegram /command@bot_username form', async () => {
    const result = await handleCommand(
      '/reset@andy_ai_bot',
      makeMessage('/reset@andy_ai_bot'),
      makeGroup(),
    );
    expect(result.handled).toBe(true);
    expect(result.response).toContain('Conversation reset');
  });

  it('validates /reset usage', async () => {
    const result = await handleCommand(
      '/reset now',
      makeMessage('/reset now'),
      makeGroup(),
    );
    expect(result.handled).toBe(true);
    expect(result.response).toContain('Usage');
  });
});
