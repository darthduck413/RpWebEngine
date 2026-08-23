// Reference scale handed to the character-analysis agent so the power levels it
// assigns to tracked characters stay comparable from turn to turn instead of
// being re-invented each time. This is only an example of the SHAPE of an
// answer — the agent rates whoever is actually in the story.

export const DEFAULT_POWER_SCALING_EXAMPLE = `(Example of the scale, roughly 0-40: 38 = the single strongest being in the setting, effectively unmatched. 33 = a peer of the setting's greatest champions. 30 = a ruler or apex antagonist. 28 = a top-tier named power. 25 = a typical elite or lieutenant. 23 = a competent rank-and-file combatant. 15 = trained but unremarkable. 8 = an ordinary adult with no special ability. Rate relative to what this story has actually shown.)`;

// Per-setting overrides, keyed by character name, go here when a story needs
// its own yardstick.
const powerScalingExamples: Record<string, string> = {};

export const getPowerScalingExample = (characterName: string): string =>
    powerScalingExamples[characterName] || DEFAULT_POWER_SCALING_EXAMPLE;
