import { NARRATIVE_TEMPLATE_PART } from '../../constants';

const CUSTOM_PROMPT_PLACEHOLDER = '{{CUSTOM_PROMPT}}';
const WORLD_INFO_BLOCK_PATTERN = /\n*\s*<World Info[\s\S]*?<\/World Info>/g;
const DYNAMIC_PLACEHOLDERS = [
  '{{PERSONALITY}}',
  '{{SETTING}}',
  '{{SCENARIO}}',
  '{{PLAYER_DESCRIPTION}}',
  '{{PLAYER_NOTES}}',
];

const CONTEXT_MARKERS = [
  // New XML-tagged headers (current format)
  "<{{char}}'s Persona>",
  '<Setting>',
  '<Scenario>',
  '<UserPersona>',
  '<Notes>',
  // Legacy plain-label headers (kept so old/custom templates still split correctly)
  "{{char}}'s description:",
  'Setting:',
  'Scenario:',
  "{{user}}'s description:",
  'Here are some notes:',
  // Placeholders themselves
  '{{PERSONALITY}}',
  '{{SETTING}}',
  '{{SCENARIO}}',
  '{{PLAYER_DESCRIPTION}}',
  '{{PLAYER_NOTES}}',
];

export const DEFAULT_CUSTOM_PROMPT = NARRATIVE_TEMPLATE_PART;

const findContextStart = (template: string): number => {
  const markerStart = CONTEXT_MARKERS.reduce((best, marker) => {
    const index = template.indexOf(marker);
    if (index < 0) return best;
    return best < 0 ? index : Math.min(best, index);
  }, -1);
  const resolvedPersonaStart = template.search(/<[^<>\n]+['’]s Persona>/);
  if (resolvedPersonaStart < 0) return markerStart;
  return markerStart < 0 ? resolvedPersonaStart : Math.min(markerStart, resolvedPersonaStart);
};

export const customPromptOrDefault = (customPrompt: string | null | undefined): string => {
  return customPrompt == null ? DEFAULT_CUSTOM_PROMPT : customPrompt;
};

export const stripDynamicWorldInfoBlock = (instructionTemplate: string | null | undefined): string => {
  return (instructionTemplate ?? '').replace(WORLD_INFO_BLOCK_PATTERN, '').trimEnd();
};

export const hasDynamicSystemPlaceholders = (instructionTemplate: string | null | undefined): boolean => {
  const template = instructionTemplate ?? '';
  return DYNAMIC_PLACEHOLDERS.some(placeholder => template.includes(placeholder));
};

export const isDynamicSystemInstructionTemplate = (instructionTemplate: string | null | undefined): boolean => {
  const template = instructionTemplate ?? '';
  return hasDynamicSystemPlaceholders(template) || template.includes(CUSTOM_PROMPT_PLACEHOLDER);
};

export const extractCustomPromptFromSystemInstruction = (
  instructionTemplate: string | null | undefined
): string => {
  const template = (instructionTemplate ?? '').trim();
  if (!template) return DEFAULT_CUSTOM_PROMPT;

  if (template.includes(CUSTOM_PROMPT_PLACEHOLDER)) {
    return DEFAULT_CUSTOM_PROMPT;
  }

  const contextStart = findContextStart(template);
  if (contextStart > 0) {
    return template.slice(0, contextStart).trim() || DEFAULT_CUSTOM_PROMPT;
  }

  return template;
};

export const applyCustomPromptToSystemInstruction = (
  instructionTemplate: string,
  customPrompt: string | null | undefined
): string => {
  const prompt = customPromptOrDefault(customPrompt).trim();

  if (instructionTemplate.includes(CUSTOM_PROMPT_PLACEHOLDER)) {
    return instructionTemplate.replaceAll(CUSTOM_PROMPT_PLACEHOLDER, prompt);
  }

  if (instructionTemplate.includes(NARRATIVE_TEMPLATE_PART)) {
    return instructionTemplate.replace(NARRATIVE_TEMPLATE_PART, prompt);
  }

  const contextStart = findContextStart(instructionTemplate);
  if (contextStart > 0) {
    return `${prompt}\n\n${instructionTemplate.slice(contextStart).trimStart()}`.trim();
  }

  return prompt || instructionTemplate;
};
