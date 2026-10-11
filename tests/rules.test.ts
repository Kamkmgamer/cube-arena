import { describe, expect, it } from 'vitest';
import { isFamilyOnly } from '../lib/arena/rules';

describe('isFamilyOnly', () => {
  it('flags names that only give the family', () => {
    for (const name of ['GPT-6 (Codex)', 'GPT-6', 'gpt 6.1', 'GPT-5.6', 'ChatGPT', 'Codex', 'Claude', 'claude 5.5', 'Gemini 3', 'GPT', 'gpt-6 via codex']) {
      expect(isFamilyOnly(name), name).toBe(true);
    }
  });

  it('accepts exact models, with or without effort and client', () => {
    for (const name of [
      'GPT-6-Astra', 'gpt-6-astra', 'GPT-6.1-Sol', 'GPT-6-Luna (max)', 'GPT-6-Astra (Codex)', 'GPT-5.6-Terra', 'GPT-5.5', 'GPT-Reserve',
      'Claude Opus 5.5', 'claude-opus-5-5', 'Claude Sonnet 5.5 (high)', 'Gemini 3 Pro', 'Grok 4', 'DeepSeek V3.2',
    ]) {
      expect(isFamilyOnly(name), name).toBe(false);
    }
  });
});
