import { describe, expect, it } from 'vitest';
import { agentFor, boardLabel, claudeName, codexName, effortFor } from '../runner/models.mjs';

const listed = [
  { slug: 'gpt-6-astra', display_name: 'GPT-6-Astra' },
  { slug: 'gpt-6.1-sol', display_name: 'GPT-6.1-Sol' },
];

describe('Verified board names', () => {
  it('names every Claude version exactly, never just the tier', () => {
    expect(claudeName('claude-opus-5-5')).toBe('Claude Opus 5.5');
    expect(claudeName('claude-opus-5')).toBe('Claude Opus 5');
    expect(claudeName('claude-sonnet-5-5')).toBe('Claude Sonnet 5.5');
    expect(claudeName('claude-haiku-5-5')).toBe('Claude Haiku 5.5');
    expect(claudeName('claude-fable-5-1')).toBe('Claude Fable 5.1');
    expect(claudeName('claude-sonnet-5-20260514')).toBe('Claude Sonnet 5');
  });

  it('refuses aliases that could mean any version', () => {
    for (const alias of ['opus', 'sonnet', 'fable', 'claude-opus', 'default', 'opusplan']) expect(claudeName(alias)).toBeNull();
    for (const alias of ['opus', 'sonnet', 'default']) expect(agentFor(alias)).toBeNull();
  });

  it("uses Codex's own display names, and builds the same shape for unlisted ones", () => {
    expect(codexName('gpt-6-astra', listed)).toBe('GPT-6-Astra');
    expect(codexName('gpt-6.1-sol', listed)).toBe('GPT-6.1-Sol');
    expect(codexName('gpt-6-sol', listed)).toBe('GPT-6-Sol');
    expect(codexName('gpt-5.6-terra', null)).toBe('GPT-5.6-Terra');
    expect(codexName('gpt-5.5', null)).toBe('GPT-5.5');
    expect(codexName('gpt', null)).toBeNull();
  });

  it('puts the effort in the name', () => {
    expect(boardLabel('GPT-6-Astra', 'xhigh')).toBe('GPT-6-Astra (xhigh)');
    expect(boardLabel('Claude Haiku 4.5', effortFor('claude-haiku-4-5', 'high'))).toBe('Claude Haiku 4.5');
    expect(effortFor('claude-opus-5', 'high')).toBe('high');
    expect(agentFor('gpt-6-luna')).toBe('codex');
    expect(agentFor('claude-opus-5')).toBe('claude');
  });
});
