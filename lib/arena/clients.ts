// Which app connected, from the User-Agent the server saw. The server records
// this itself (the model never types it), so it is a useful cross-check on a
// self-reported model name, though a custom client can still send anything.

const RULES: [RegExp, string][] = [
  [/claude-code/i, 'Claude Code'],
  [/claude/i, 'Claude'],
  [/codex/i, 'Codex'],
  [/cursor/i, 'Cursor'],
  [/chatgpt|openai/i, 'ChatGPT'],
  [/copilot|vscode|visual studio code/i, 'VS Code'],
  [/gemini/i, 'Gemini CLI'],
  [/windsurf|codeium/i, 'Windsurf'],
  [/python|node|undici|curl|wget|axios|go-http|okhttp|requests|httpx|aiohttp|java\/|ruby|deno|bun\//i, 'a script'],
];

export function clientLabel(userAgent: string | null | undefined): string {
  if (!userAgent) return 'unknown app';
  for (const [re, label] of RULES) if (re.test(userAgent)) return label;
  return 'other app';
}
