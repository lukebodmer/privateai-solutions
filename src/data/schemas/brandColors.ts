/**
 * Canonical brand-color map — the ONE source of truth for company colors
 * used across the site.
 *
 * Design intent:
 *   - Colors are used as a subtle visual cue for company identity, not as
 *     the primary UI accent. Applied as thin borders, chart bars, and
 *     other low-key surfaces. Never as button colors, link colors, or
 *     large filled backgrounds.
 *   - Every color sits on the dark site background (nord-950) at 3:1
 *     contrast or better, so charts need no light plot area.
 *   - Closed-model developers (Anthropic, OpenAI) get a muted grey, and
 *     charts draw closed models hollow (`barStyle`): they are there for
 *     reference, not as part of the open field.
 *
 * All consumers read this via `brandColorForCompany()` — never hard-code a
 * hex value elsewhere on the site.
 */

/** Fallback color when no company rule matches: nord-500. */
const DEFAULT_COLOR = '#7b88a1';

/** Colors keyed by company slug (matches `src/data/companies/<slug>.json`). */
const COMPANY_COLORS: Record<string, string> = {
  deepseek: '#4D6BFE',   // Deep blue from the DeepSeek whale
  alibaba:  '#8B5CF6',   // Purple, Qwen brand mark
  zai:      '#F97316',   // Orange, GLM / Z.AI
  moonshot: '#10B981',   // Green, Kimi / Moonshot
  minimax:  '#F43F5E',   // Rose, the MiniMax waveform mark
  anthropic: '#9aa8bc',  // nord-400 — closed models get a muted grey
  openai:    '#9aa8bc',  // Same rule for the company's closed models
};

/** Resolve a model's brand color from its company slug. Never throws —
 *  colorless is a valid state (renders as the default). */
export function brandColorForCompany(companySlug: string | null | undefined): string {
  if (companySlug && COMPANY_COLORS[companySlug]) return COMPANY_COLORS[companySlug];
  return DEFAULT_COLOR;
}

/** Inline style for a chart bar: solid for open models, a hollow outline
 *  with a faint fill for closed ones. */
export function barStyle(color: string, isOpen: boolean): string {
  return isOpen
    ? `background-color: ${color};`
    : `background-color: ${color}26; box-shadow: inset 0 0 0 1px ${color};`;
}
