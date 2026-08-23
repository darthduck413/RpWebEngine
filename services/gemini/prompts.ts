
import { Content } from "@google/genai";
import { StoryTurn, TrackedCharacter } from '../../types';
import { getCharacterContext, buildAgentContext } from '../common/prompts';
import { extractBase64Data } from '../common/imageUtils';
import { stripThinkTags } from '../common/thinking';
import { stripInlineImages } from '../common/inlineImages';
import { applyHistoryWindow } from '../common/historyWindow';

interface BuildHistoryOptions {
    includeAllAgentResponses?: boolean;
    finalAgentNames?: string[];
    agentForContext?: string;
    keepNonExistentAgentResponses?: boolean;
    allCurrentAgentNames?: string[];
    userAvatarBase64?: string | null; // Pre-processed base64
    charAvatarBase64?: string | null;
    charName?: string;
    userName?: string;
    ignoreImages?: boolean;
    /** Keyword-triggered World Info (per-character profiles). Semi-stable — a
     *  profile stays loaded while its character is on screen, so it sits in its
     *  own segment ahead of the per-turn tail. */
    keywordWorldInfo?: string;
    /** Manually-toggled scenarios normally stay fixed after chat start and lead
     *  the story history as semi-stable prefix context. */
    manualScenarios?: string;
    /** Player notes — moved out of the system instruction so that editing them
     *  no longer invalidates the character card and the whole history. */
    playerNotes?: string;
    /** Explicit user-authored text appended after light-mode history. */
    postHistoryInstruction?: string;
    cachingActive?: boolean;
    includeCharacterSheets?: boolean;
}

// Content order is cache-oriented, mirroring buildProxyMessages: Gemini's
// implicit prompt cache is pure prefix-matching, so stable content (avatars and
// manually-selected scenarios) goes first, the history advances append-only via
// a stepped window, and everything that changes every turn (character sheets,
// agent context and keyword World Info) is merged into one trailing user message.
export const buildContentHistory = (
  storyHistory: StoryTurn[],
  historyContextTurns: number,
  aiName: string,
  playerName: string,
  trackedCharacters: TrackedCharacter[] | undefined,
  options: BuildHistoryOptions = {}
): Content[] => {
  const contentHistory: Content[] = [];
  const resolve = (text: string) => text
      .replace(/{{user}}/g, playerName)
      .replace(/{{char}}/g, aiName);

  // Stable prefix: avatars never change between turns, so they belong at the
  // front where the implicit cache can hold them (and where "appearance" reads
  // before the story, not after it).
  if (!options.ignoreImages) {
      if (options.userAvatarBase64) {
          const img = extractBase64Data(options.userAvatarBase64);
          if (img) {
              contentHistory.push({
                  role: 'user',
                  parts: [
                      { text: `${options.userName || '{{user}}'}'s appearance:` },
                      { inlineData: img }
                  ]
              });
          }
      }

      if (options.charAvatarBase64) {
          const img = extractBase64Data(options.charAvatarBase64);
          if (img) {
              contentHistory.push({
                  role: 'user',
                  parts: [
                      { text: `${options.charName || '{{char}}'}'s appearance:` },
                      { inlineData: img }
                  ]
              });
          }
      }
  }

  if (options.manualScenarios?.trim()) {
      contentHistory.push({
          role: 'user',
          parts: [{ text: resolve(options.manualScenarios.trim()) }],
      });
  }

  // Stepped history window — same helper as buildProxyMessages, so the two
  // providers can never drift apart on this.
  const historySlice = applyHistoryWindow(storyHistory, historyContextTurns, options.cachingActive);

  historySlice.forEach(turn => {
      const role = turn.isPlayer ? 'user' : 'model';
      const text = stripInlineImages(stripThinkTags((turn.text ?? '')
            .replace(/{{user}}/g, playerName)
            .replace(/{{char}}/g, aiName)));

      const parts: any[] = [{ text: text }];

      if (!options.ignoreImages && turn.image) {
          const imageData = extractBase64Data(turn.image);
          if (imageData) {
              // Add label before image
              parts.unshift({ text: turn.isPlayer ? `{{user}} attached image:` : `{{char}} attached image:` });
              parts.push({ inlineData: imageData });
          }
      }

      contentHistory.push({ role, parts });
  });

  // Lore/WI content may carry {{user}}/{{char}} placeholders — resolve them here
  // since these blocks bypass buildSystemInstruction's replacement pass.
  // Tail — same single message and same ordering as buildProxyMessages. Splitting
  // it buys nothing: it sits after the history, the history grows every turn, and a
  // prefix cache can only reuse what precedes the first difference.
  const tailBlocks: string[] = [];
  // Notes live here rather than in the systemInstruction — see buildProxyMessages.
  if (options.playerNotes && options.playerNotes.trim()) {
      tailBlocks.push(`<Notes>\n${options.playerNotes.trim()}\n</Notes>`);
  }
  if (options.keywordWorldInfo && options.keywordWorldInfo.trim()) {
      tailBlocks.push(options.keywordWorldInfo.trim());
  }
  const characterContext = options.includeCharacterSheets === false
      ? null
      : getCharacterContext(trackedCharacters);
  if (characterContext) {
      tailBlocks.push(characterContext);
  }
  const agentContext = buildAgentContext(storyHistory, historyContextTurns, options);
  if (agentContext) {
      tailBlocks.push(agentContext);
  }
  // Last block, appended whenever non-empty — see buildProxyMessages.
  if (options.postHistoryInstruction?.trim()) {
      tailBlocks.push(options.postHistoryInstruction.trim());
  }

  if (tailBlocks.length > 0) {
      contentHistory.push({ role: 'user', parts: [{ text: resolve(tailBlocks.join('\n\n')) }] });
  }

  return contentHistory;
};
