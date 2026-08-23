// Manually-toggled scenarios (experimental — see ManualScenario in types.ts).
//
// These are NOT World Info: nothing here is keyword-scanned or auto-activated.
// The user flips scenarios on/off in the Scenarios modal, and the active ones
// are composed into one semi-stable block before history. Users normally choose
// them near chat start and leave them enabled; the block and subsequent history
// can therefore be reused by prefix caches. A later toggle intentionally causes
// one history re-cache.

import { ManualScenario } from '../../types';

// Selection helper shared by the composer and the modal, so what the UI shows
// as "on" is exactly what gets sent.
export const selectActiveManualScenarios = (
    scenarios: ManualScenario[] | undefined,
    activeIds: string[] | undefined
): ManualScenario[] => {
    if (!scenarios || scenarios.length === 0 || !activeIds || activeIds.length === 0) return [];
    const active = new Set(activeIds);
    return scenarios.filter(s => active.has(s.id) && s.content.trim() !== '');
};

export const composeManualScenarios = (
    scenarios: ManualScenario[] | undefined,
    activeIds: string[] | undefined
): string => {
    const active = selectActiveManualScenarios(scenarios, activeIds);
    if (active.length === 0) return '';

    const body = active
        .map(s => (s.name ? `[${s.name}]\n${s.content.trim()}` : s.content.trim()))
        .join('\n\n');

    return `<Active Scenario>\n${body}\n</Active Scenario>`;
};
