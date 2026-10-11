// Board names for Verified runs, worked out from the exact model id the agent
// CLI is given, never typed by hand: claude-opus-5-5 is "Claude Opus 5.5" and
// claude-opus-5 is "Claude Opus 5", gpt-6-astra is "GPT-6-Astra". The effort
// goes in too, since it changes results: "GPT-6-Astra (xhigh)".

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

/** Claude models with no effort setting: their names carry no effort and the CLI gets none. */
export const CLAUDE_NO_EFFORT = ['claude-sonnet-4-5', 'claude-haiku-4-5'];

const TIERS = { opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku', fable: 'Fable' };

/** Which CLI runs a model id, or null if the id is not a full one we know how to name. */
export function agentFor(model) {
  if (model.startsWith('claude-')) return 'claude';
  if (model.startsWith('gpt-')) return 'codex';
  return null;
}

/** claude-opus-5-5 → "Claude Opus 5.5"; a date suffix (claude-sonnet-5-20260514) is dropped. Null for aliases like "opus". */
export function claudeName(id) {
  const m = id.match(/^claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/);
  return m ? `Claude ${TIERS[m[1]]} ${m[2]}${m[3] ? `.${m[3]}` : ''}` : null;
}

/** Codex's own model list (written by the CLI when it starts), or null. */
export function codexModels(codexHome) {
  for (const file of [join(codexHome, 'models_cache.json'), join(homedir(), '.codex', 'models_cache.json')]) {
    if (!existsSync(file)) continue;
    try {
      return JSON.parse(readFileSync(file, 'utf8')).models ?? null;
    } catch {
      // unreadable cache: fall through
    }
  }
  return null;
}

/** gpt-6-astra → "GPT-6-Astra": Codex's display name when it lists the model, else the same shape built from the slug. */
export function codexName(slug, models) {
  const listed = models?.find((m) => m.slug === slug)?.display_name;
  if (listed) return listed;
  if (!/^gpt-\d+(\.\d+)?(-[a-z0-9]+)*$/.test(slug)) return null;
  return slug
    .split('-')
    .map((part, i) => (i === 0 ? 'GPT' : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('-');
}

/** The efforts a Codex model takes, from its listing; null if unknown. */
export function codexEfforts(slug, models) {
  const levels = models?.find((m) => m.slug === slug)?.supported_reasoning_levels;
  return levels ? levels.map((l) => l.effort) : null;
}

/** "Claude Opus 5.5 (high)"; just the name for a model with no effort setting (effort null). */
export const boardLabel = (name, effort) => (effort ? `${name} (${effort})` : name);

/** The effort a run really uses: null for Claude models that have no such setting. */
export const effortFor = (model, effort) => (CLAUDE_NO_EFFORT.includes(model) ? null : effort);

/**
 * Every model the sweep plays, by exact id. Claude ids were checked against
 * Claude Code (the CLI quietly serves some retired ids with another model, so
 * the runner checks who answered); Codex ids are the ones its model list offers.
 */
export const SWEEP_MODELS = [
  'claude-fable-5-1', 'claude-fable-5',
  'claude-opus-5-5', 'claude-opus-5', 'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6', 'claude-opus-4-5',
  'claude-sonnet-5-5', 'claude-sonnet-5', 'claude-sonnet-4-6', 'claude-sonnet-4-5',
  'claude-haiku-5-5', 'claude-haiku-4-5',
  'gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna', 'gpt-reserve',
  'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5',
];
