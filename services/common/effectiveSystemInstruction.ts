import { Character, GeminiSettings, ProxySettings, StoryTurn } from '../../types';
import { buildSystemInstruction } from './prompts';
import { applyCustomPromptToSystemInstruction, isDynamicSystemInstructionTemplate } from './systemPrompt';
import { composeWorldInfo } from './worldInfo';

type ApiProvider = 'gemini' | 'proxy';

export const getProviderCustomPrompt = (
  provider: ApiProvider,
  proxySettings?: Partial<ProxySettings> | null,
  geminiSettings?: Partial<GeminiSettings> | null
): string | null | undefined => {
  return provider === 'proxy' ? proxySettings?.customPrompt : geminiSettings?.customPrompt;
};

export const applyProviderCustomPromptToSystemInstruction = (
  instructionTemplate: string,
  provider: ApiProvider,
  proxySettings?: Partial<ProxySettings> | null,
  geminiSettings?: Partial<GeminiSettings> | null
): string => {
  return applyCustomPromptToSystemInstruction(
    instructionTemplate,
    getProviderCustomPrompt(provider, proxySettings, geminiSettings)
  );
};

export interface EffectiveSystemInstructionParams {
  instructionTemplate: string;
  provider: ApiProvider;
  proxySettings?: Partial<ProxySettings> | null;
  geminiSettings?: Partial<GeminiSettings> | null;
  character: Character;
  characterSetting: string;
  characterScenario: string;
  characterPersonality: string;
  playerDescription: string;
  playerName: string;
  storyHistory?: StoryTurn[];
  playerChoice?: string;
}

export const buildEffectiveSystemInstructionPayload = ({
  instructionTemplate,
  provider,
  proxySettings,
  geminiSettings,
  character,
  characterSetting,
  characterScenario,
  characterPersonality,
  playerDescription,
  playerName,
  storyHistory = [],
  playerChoice,
}: EffectiveSystemInstructionParams): string => {
  const sessionTemplate = instructionTemplate.trim() || character.systemInstructionTemplate;
  const providerTemplate = isDynamicSystemInstructionTemplate(sessionTemplate)
    ? applyProviderCustomPromptToSystemInstruction(
      sessionTemplate,
      provider,
      proxySettings,
      geminiSettings
    )
    : sessionTemplate;

  // Never notes: they live in the tail, and this payload is both what the editor
  // shows AND what the user can save back as the session template — putting them
  // here would send them twice and freeze a stale copy into the saved prompt.
  return buildSystemInstruction(
    providerTemplate,
    '',
    characterSetting,
    characterPersonality,
    playerDescription,
    character.name,
    playerName,
    characterScenario,
    composeWorldInfo(
      character.loreBook,
      storyHistory,
      playerChoice,
      [characterPersonality, characterSetting, characterScenario]
    )
  );
};
