export interface ThinkingSplit {
  thoughts: string | null;
  content: string;
  hasOpenThink: boolean;
}

const THINK_BLOCK_RE = /<think\b[^>]*>([\s\S]*?)(<\/think>|$)/gi;

// Some reasoning models (e.g. mimo-v2.5) emit their chain-of-thought as a plain-text section
// header instead of <think> tags — typically a standalone leading line like "THINKING PROCESS"
// or "Reasoning:". These regexes detect ONLY such a leading header line, so ordinary prose that
// merely starts with a word like "Thinking," is never matched (the header must end its line).
const REASONING_HEADER_RE = /^[#*>\s\-]{0,8}(?:(?:thinking process|thought process|chain of thought|internal monologue)\s*:?|(?:thinking|reasoning|thoughts)\s*:)[ \t]*\r?\n/i;
// If, after a leading reasoning header, the model marks where the real answer starts, split there.
const RESPONSE_DELIM_RE = /\r?\n[#*>\s\-]{0,8}(?:final response|response|reply|answer)\s*:?[ \t]*\r?\n/i;

// Separate a leading plain-text reasoning preamble from the actual content.
// - No leading header → returns the text unchanged as `rest` (the common case; zero impact).
// - Header + explicit response delimiter → the block between is `reasoning`, the rest is content.
// - Header but no delimiter → only the spurious header line is dropped; the body is kept as content
//   (we never discard the body, so a mislabelled-but-real reply is preserved).
export const splitLeadingReasoning = (text: string): { reasoning: string | null; rest: string } => {
  const header = REASONING_HEADER_RE.exec(text);
  if (!header) return { reasoning: null, rest: text };
  const afterHeader = text.slice(header[0].length);
  const delim = RESPONSE_DELIM_RE.exec(afterHeader);
  if (delim) {
    return {
      reasoning: afterHeader.slice(0, delim.index).trim() || null,
      rest: afterHeader.slice(delim.index + delim[0].length),
    };
  }
  return { reasoning: null, rest: afterHeader };
};

export const stripThinkTags = (text: string | null | undefined): string => {
  const noTags = (text ?? '')
    .replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '')
    .replace(/<think\b[^>]*>[\s\S]*$/gi, '')
    .trim();
  return splitLeadingReasoning(noTags).rest.trim();
};

export const splitThinkingContent = (text: string | null | undefined): ThinkingSplit => {
  const source = text ?? '';
  const thoughts: string[] = [];
  let content = '';
  let cursor = 0;
  let hasThink = false;
  let hasOpenThink = false;

  THINK_BLOCK_RE.lastIndex = 0;

  for (const match of source.matchAll(THINK_BLOCK_RE)) {
    hasThink = true;
    content += source.slice(cursor, match.index);
    thoughts.push((match[1] ?? '').trim());
    cursor = (match.index ?? 0) + match[0].length;

    if (!match[2]) {
      hasOpenThink = true;
      cursor = source.length;
      break;
    }
  }

  content += source.slice(cursor);

  // Fold a plain-text reasoning preamble (no <think> tags) into thoughts so it renders in the
  // collapsible thinking section rather than as narrative prose.
  const lead = splitLeadingReasoning(content);
  if (lead.reasoning) {
    thoughts.push(lead.reasoning);
    hasThink = true;
  }
  content = lead.rest;

  return {
    thoughts: hasThink ? thoughts.join('\n\n---\n\n') : null,
    content: content.trim(),
    hasOpenThink,
  };
};

export const normalizeTextPart = (value: unknown): string => {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(normalizeTextPart).filter(Boolean).join('');

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return normalizeTextPart(
      record.text ??
      record.content ??
      record.summary ??
      record.reasoning ??
      record.reasoning_content ??
      record.delta
    );
  }

  return '';
};

export const withThinkingMarkup = (reasoning: unknown, content: unknown): string => {
  const reasoningText = normalizeTextPart(reasoning).trim();
  const contentText = normalizeTextPart(content);

  if (!reasoningText) return contentText;
  if (contentText.includes('<think')) return contentText;

  return `<think>\n${reasoningText}\n</think>${contentText ? `\n\n${contentText}` : ''}`;
};
