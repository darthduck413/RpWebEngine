import { describe, expect, it } from 'vitest';
import { buildPresetFromBlocks, MODEL_BLOCKS, PROMPT_BLOCKS } from '../../builderBlocks';
import { resolveApiPresetRef } from '../../services/common/apiPresetRef';

describe('preset-scoped thinking history', () => {
    it('is off by default in the API preset builder', () => {
        const preset = buildPresetFromBlocks(MODEL_BLOCKS[0], PROMPT_BLOCKS[0], 'Default');
        expect(preset.includeThinkingInHistory).toBe(false);
    });

    it('is stored only when explicitly enabled for that preset', () => {
        const preset = buildPresetFromBlocks(MODEL_BLOCKS[0], PROMPT_BLOCKS[0], 'Kimi', true);
        expect(preset.includeThinkingInHistory).toBe(true);

        const resolved = resolveApiPresetRef(
            { provider: 'proxy', presetId: preset.id },
            { proxyPresets: [preset], geminiPresets: [], geminiApiKeys: [] }
        );
        expect(resolved?.proxySettings?.includeThinkingInHistory).toBe(true);
    });
});
