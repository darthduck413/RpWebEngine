// ---------------------------------------------------------------------------
// Manual scenario ↔ code sync (Scenarios modal toolbar)
// ---------------------------------------------------------------------------
// Same semantics as proxyPresetSync/geminiPresetSync, but the code catalog is
// per character: the `manualScenarios` array authored in manualScenarioCatalog.ts.
// Characters edited in the app are persisted whole to localStorage and shadow
// later code changes, so — exactly like presets — Resync pulls new/updated code
// scenarios into the stored copy on demand.
//
//   • A scenario is "from code" when its id matches one in the character's
//     catalog entry.
//   • Sync = append any code scenario missing by id, and — for scenarios that
//     are from code — restore name+content to the code version when drifted.
//     User-created scenarios are never touched.
//   • Reorder = code order first; user scenarios keep relative order at bottom.
//
// The catalog ships empty, so out of the box every scenario is user-created and
// both toolbar actions are no-ops that say so.

import { ManualScenario } from '../../types';
import { MANUAL_SCENARIO_CATALOG } from '../../manualScenarioCatalog';

export const codeManualScenariosFor = (characterId: string): ManualScenario[] =>
    MANUAL_SCENARIO_CATALOG[characterId] ?? [];

export interface ManualScenarioSyncResult {
    scenarios: ManualScenario[];
    /** Names of code scenarios that were missing and got appended. */
    added: string[];
    /** Names of existing scenarios restored to their code version. */
    updated: string[];
}

/** Append missing code scenarios and restore drifted built-ins to code. */
export const syncManualScenariosWithCode = (
    characterId: string,
    current: ManualScenario[]
): ManualScenarioSyncResult => {
    const codeScenarios = codeManualScenariosFor(characterId);
    const codeById = new Map(codeScenarios.map(s => [s.id, s]));
    const added: string[] = [];
    const updated: string[] = [];

    const next = current.map(scenario => {
        const codeScenario = codeById.get(scenario.id);
        if (!codeScenario) return scenario; // user scenario — never touched
        if (scenario.name === codeScenario.name && scenario.content === codeScenario.content) return scenario;
        updated.push(scenario.name || codeScenario.name);
        return { ...scenario, name: codeScenario.name, content: codeScenario.content };
    });

    const known = new Set(next.map(s => s.id));
    for (const codeScenario of codeScenarios) {
        if (!known.has(codeScenario.id)) {
            next.push({ ...codeScenario });
            added.push(codeScenario.name);
        }
    }

    return { scenarios: next, added, updated };
};

/** Reorder to code order; scenarios not defined in code keep their relative order at the bottom. */
export const reorderManualScenariosToCode = (
    characterId: string,
    current: ManualScenario[]
): ManualScenario[] => {
    const codeOrder = new Map(codeManualScenariosFor(characterId).map((s, i) => [s.id, i]));
    const fromCode: ManualScenario[] = [];
    const userDefined: ManualScenario[] = [];
    for (const scenario of current) {
        (codeOrder.has(scenario.id) ? fromCode : userDefined).push(scenario);
    }
    fromCode.sort((a, b) => (codeOrder.get(a.id) ?? 0) - (codeOrder.get(b.id) ?? 0));
    return [...fromCode, ...userDefined];
};

/** True when order already equals code-order-first (used to no-op the toast). */
export const isManualScenarioOrderCanonical = (
    characterId: string,
    current: ManualScenario[]
): boolean => {
    const target = reorderManualScenariosToCode(characterId, current);
    return current.every((s, i) => s.id === target[i].id);
};
