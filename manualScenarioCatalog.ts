import { ManualScenario } from './types';

// ---------------------------------------------------------------------------
// Code-defined manual scenarios, keyed by character id
// ---------------------------------------------------------------------------
// Manual scenarios are story hooks the player toggles on and off in the
// Scenarios modal — they never trigger on their own (that is what World Info
// does). Scenarios created in the app live in browser storage and travel with
// nothing; scenarios declared here live in the repo instead.
//
// Declaring them in code buys two things, both exposed as toolbar buttons in
// the Scenarios modal:
//
//   • Resync    — appends any catalog scenario the character is missing, and
//                 restores the text of ones that were edited in the app. User
//                 scenarios are never touched.
//   • Auto-order — sorts catalog scenarios into the order written here, with
//                 user scenarios kept at the bottom.
//
// Ids must be stable: Resync matches stored scenarios against this catalog by
// id, so renaming an id makes the old scenario look user-created.
//
// A character's id is shown in the character editor and travels inside its
// exported card under `data.extensions.rwe.id`.
//
// This ships empty on purpose — RWE has no built-in characters. Add your own:
//
//   export const MANUAL_SCENARIO_CATALOG: Record<string, ManualScenario[]> = {
//     '5f3c9a10-...': [
//       manualScenario('storm-arrives', 'The storm arrives', `The weather turns...`),
//       manualScenario('rival-returns', 'Rival returns', `An old rival walks in...`),
//     ],
//   };

/** Authoring helper, so entries read as one line each. */
export const manualScenario = (id: string, name: string, content: string): ManualScenario =>
  ({ id, name, content });

export const MANUAL_SCENARIO_CATALOG: Record<string, ManualScenario[]> = {};
