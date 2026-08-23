
import {
    AgentSettings,
    Character,
    PerCharacterState,
    PlotPhase,
    StoryBible,
    StoryTurn,
    TrackedCharacter,
    WorldSnapshot
} from '../../types';
import { stripThinkTags } from './thinking';
import { stripInlineImages } from './inlineImages';
import { stripDynamicWorldInfoBlock } from './systemPrompt';

export const AGENT_SETTINGS_SCHEMA_PROMPT = `Your output MUST be a valid JSON array of agent objects. Each object must conform to this structure:
{
  "id": "string", // Unique ID
  "name": "string", // Agent name
  "systemInstruction": "string", // The agent's prompt
  "contextMessages": "integer", // Number of history messages for context, 0 for all
  "model": "string", // The model name, e.g., 'anthropic/claude-3-sonnet' or for gemini 'flash'/'pro'
  "order": "integer", // Execution order, lower runs first
  "connections": ["string"], // Array of agent IDs this agent connects to
  "position": { "x": "number", "y": "number" } // Position for UI graph
}`;

export const CHARACTER_UPDATE_SCHEMA_PROMPT = `Your response MUST be a valid JSON object with two properties:
1. "analysis": A string containing your detailed textual analysis.
2. "characterUpdates": An optional array of objects for updating character sheets.

Each object in "characterUpdates" must have:
- "name": The character's full name.
- "description": (Optional) Updated summary of the character's state.
- "health": (Optional) Object with 'value' (number or string) and 'description'.
- "topics": (Optional) An array of topics. Each topic has a "name" and an array of "variables". Each variable has a "name", "type" ('slider' or 'text'), "value", and "description".

Example: {"analysis": "...", "characterUpdates": [{"name": "Lucifer", "health": {"value": 60, "description": "Agitated."}}]}`;

export const CHARACTER_ANALYSIS_SCHEMA_PROMPT = `Your final output MUST be a valid JSON array of character objects, strictly conforming to the schema described. Do not add any other text or explanation outside the JSON array. Each object should look like this:
{
  "id": "a-unique-id-string",
  "name": "Character Name",
  "description": "One-sentence summary.",
  "health": { "value": 75, "description": "Detailed explanation of their state." },
  "topics": [
    {
      "id": "a-unique-id-string",
      "name": "Mental",
      "description": "Impact on behavior.",
      "variables": [
        { "id": "a-unique-id-string", "name": "Happiness", "type": "slider", "value": 50, "description": "Behavioral impact." }
      ]
    }
  ]
}`;

export const SUMMARIZE_TEXT_PROMPT = (textToSummarize: string) => `Summarize the following text, capturing all key details concisely and rewriting it as a brief note for context in a story:\n\n---\n${textToSummarize}\n---`;

export const GENERATE_PLAYER_NOTES_SYSTEM_PROMPT = (playerName: string) => `You are an expert summarizer for text-based RPGs. Your task is to analyze the provided story history and generate a concise set of "Player Notes" for the user, named "${playerName}".

These notes will be used as persistent memory context for the AI in future turns. Focus on factual, relevant information.

Structure your response with these sections (use bullet points):
1.  **Current Situation**: Where are they? Who is with them? What is happening right now?
2.  **Objectives**: What are the immediate and long-term goals?
3.  **Key Status**: Important items, physical condition, or active effects.
4.  **Important Context**: Key revelations or facts established recently.

Keep the output concise and ready to be pasted into a notes field.`;

export const getSelectPresetSystemPrompt = (presetNames: string[], presetsSummary: string) => `You are an expert narrative director for a text-based RPG. Your task is to select the best agent preset for the current game situation.

Here are the available presets with detailed instructions on when to use them:
${presetsSummary}

Analyze the recent conversation history provided below. Based on the context (e.g., is the player alone, in a dialogue-heavy scene, interacting with new characters?), choose the single most appropriate preset.

You must respond in JSON format. The 'presetName' must be one of the following exact strings: ${presetNames.map(name => `"${name}"`).join(', ')}.`;

export const GENERATE_PRESET_SYSTEM_PROMPT = `You are an expert multi-agent AI system designer for a text-based RPG. Your task is to dynamically create a custom agent preset that simulates a living, breathing world for the current game scene.

Your primary goal is to design a system that captures the world state, the environment, and the autonomous actions and motivations of the characters within it. The world should feel persistent and characters should act on their own accord, not just in reaction to the player. The player's action is an event that influences the scene, but does not define it.

Here are some guiding principles for your design:
1.  **World-First Simulation**: Prioritize agents that establish the scene and world state. What is the environment like? What is the ambient mood? What is happening in the background, independent of the main characters? An agent like 'Atmosphere & World State' should often be a starting point.
2.  **Autonomous NPC Motivation**: For each key NPC in the scene, create agents that analyze their internal state. What are their goals right now? What would they be doing or thinking if the player, '{{user}}', wasn't present or had done nothing? Design agents to determine their next logical action based on their personality and the situation, not just as a reply to the player.
3.  **Logical Workflow**: Structure your agents in a logical flow, typically from broad perception to specific actions. A good pattern is:
    *   **Perception**: Agents that observe the environment, world state, and character positions/appearances.
    *   **Analysis**: Agents that delve into the internal states, knowledge, and motivations of each key NPC.
    *   **Decision**: Agents that determine what actions or dialogue each NPC will perform based on the analysis.
    *   **Synthesis**: A final 'Narrator' agent that combines all the outputs into a cohesive and engaging story turn.
4.  **Specialization is Key**: Create highly specialized agents for each key NPC. For example, instead of a single "Action Decider," create a "Lucifer's Next Move" agent and an "Alastor's Retort" agent. This yields far more authentic character behavior.
5.  **Define Agent Properties**: For each agent, define all properties according to the JSON schema. Pay close attention to:
    *   **name**: A clear, descriptive name reflecting its specific task.
    *   **systemInstruction**: A detailed prompt for that agent's role. Write it from the perspective of the agent.
    *   **order**: Define the execution stage. Agents in the same order run in parallel.
    *   **connections**: Define the workflow graph by listing the 'id's of agents that receive this agent's output.
    *   **position**: Assign logical x/y coordinates for a clean graph layout (left-to-right flow).
6.  **Final Narrator**: Ensure at least one agent has an empty 'connections' array to produce the final story output for the player. This agent synthesizes the world state and NPC actions into a final narrative.
7.  **Injecting Core Knowledge**: To provide agents with essential context, you can embed placeholders in their \`systemInstruction\`:
    *   Append \`{{SYSTEM_INSTRUCTION}}\` for agents that need the full game context, including rules, character descriptions, and formatting (typically the final Narrator).
    *   Append \`{{CHARACTER_SETTING}}\` for agents that need deep world lore but not the full system prompt (e.g., a 'World Descriptor' or 'Lore Analyst').

Your output MUST be a valid JSON array of agent objects, strictly conforming to the provided schema.`;

export const ADAPT_PRESET_SYSTEM_PROMPT = (playerName: string) => `You are an expert in multi-agent AI systems for text-based RPGs. Your task is to intelligently adapt a given agent preset to the current scene.
  
  Your goal is to replace general-purpose agents with specialized agents, one for each specific Non-Player Character (NPC) currently in the scene. This makes the AI's reasoning more focused and effective.
  
  Follow these steps precisely:
  1.  **Analyze Scene**: Read the "Story Context" to identify all named NPCs actively participating. The player character is named '${playerName}' and MUST be excluded.
  2.  **Identify General Agents**: Review the provided agent preset JSON. Find agents with 'general' instructions that apply to multiple characters (e.g., "analyze each character", "describe participating characters", "for each of them"). Common names for such agents are 'Knowledge Analyzer', 'State & Impact Analyzer', 'Actions Decider', 'Dialogue Decider'.
  3.  **Rebuild the Preset**:
      a. Keep all agents that are NOT identified as general agents.
      b. For EACH general agent you identified, REMOVE it.
      c. In its place, create NEW, specialized agents—one for each NPC you identified in step 1. For example, if you found NPCs 'Lucifer' and 'Alastor' and a general 'State Analyst', create 'Lucifer's State Analyst' and 'Alastor's State Analyst'.
      d. **Crucially**, the new specialized agents MUST have system instructions rewritten to focus ONLY on their assigned NPC.
      e. The new agents MUST inherit the \`order\`, \`model\`, \`contextMessages\`, and \`connections\` from the original agent they are replacing. This ensures the workflow remains intact.
      f. Assign a new unique \`id\` for each new agent.
      g. Arrange the \`position\` of the new agents neatly. If you replace one agent at position (x, y) with multiple new ones, place them at (x, y), (x, y + 180), (x, y + 360), etc., to stack them vertically for clarity in the graph view.
      h. **Preserve Knowledge Placeholders**: When rewriting the system instructions for the new specialized agents, if the original general agent's instruction contained \`{{SYSTEM_INSTRUCTION}}\` or \`{{CHARACTER_SETTING}}\`, ensure the new specialized instructions also include the same placeholder. This is critical for maintaining game context.
  4.  **Output**: Return the complete, new list of agent settings as a single, valid JSON array conforming to the provided schema. If no general agents are found or no specific NPCs are present, return the original agent preset unchanged.
  `;

export const ANALYZE_CHARACTERS_SYSTEM_PROMPT = (playerName: string, powerScalingExample: string) => `You are an expert narrative analyst. Your task is to read through an entire story history and create a structured list of all characters involved, including the player character, "${playerName}".

For each character, you must generate a detailed profile covering several topics. Follow this structure precisely:

1.  **Core Info**: Identify their 'name' and write a brief, one-sentence 'description' of their role or current state.
2.  **Overall State**: Create a 'health' object representing the character's summary state. 
    *   'value': For most living characters, this must be a number from 0-100 representing their combined physical and mental well-being. Default to 75 if nothing else is indicated. Use a descriptive string (e.g., 'Undead', 'Destroyed') only for exceptional cases.
    *   'description': A detailed explanation of what is currently impacting this state.
3.  **Topics**: Create the following four topics for each character: "Mental", "Physical", "Needs", and "Relationships".
    *   For each topic, provide a short 'description' summarizing its overall impact on the character. This description MUST explain how the topic affects behavior.
    *   Populate each topic with specific 'variables' as described below. Each variable needs a 'name', 'type' ('slider' or 'text'), a 'value', and a 'description'. The variable's description MUST explain the behavioral impact of its current value.

**Topic & Variable Breakdown:**
*   **Mental Topic**: Description: "Current psychological state." Variables: \`Happiness\`, \`Fear\`, \`Tiredness\` (sliders, 0-100).
*   **Physical Topic**: Description: "Physical presence and capabilities." Variables: \`Intimidation\`, \`Attractiveness\`, \`Power\` (sliders, 0-100). **IMPORTANT: Don't create illusions about power scaling, act only on verified data. ${powerScalingExample} Make yourself familiar with the tiers: 
Number, Tier Naming, Brief Description (Represents the ability to destroy, or kill being that can destroy attached to power number)
0: Nothing - Nothing
3: Very weak/wounded - few millimeters (small ants)
6: Weak - few centimeters (bigger ants)
10: Below Average Human - Small animals/humans (<1m)
13: Human - Average adult (1-2m)
16: Athlete - Peak human (~1m objects)
20: Group - Street-fight scale (~5-10m)
23: Wall - Walls (up to 5m)
26: Small Building - Houses (up to 25m)
28: Building - Medium buildings (up to 75m)
32: Large Building - Skyscrapers (up to 275m)
35: City Block - Block (up to 0.04 km²)
38: Multi-City Block - Several blocks (up to 3 km²)
40: Small Town - up to 2km radius (up to 12 km²)
41: Town - up to 5km radius (up to 80 km²)
42: Large Town - up to 10km radius (up to 300 km²)
43: Small City - up to 20km radius (up to 1,200 km²)
45: City - up to 50km radius (up to 8,000 km²)
47: Mountain - Single mountain (up to 10km base)
49: Large Mountain - Large peak (up to 20km base)
50: Island - Small island (up to 1,000 km²)
53: Country - up to 5M km²
65: Planet - ~up to 15,000km diameter
80: Galaxy - up to 1M light-years
100: Boundless - Beyond all hierarchies
**
*   **Needs Topic**: Description: "Immediate physiological/psychological needs." Variables: Create sliders for needs like \`Hunger\`, \`Thirst\`, \`Fatigue\`, \`Loneliness\`.
*   **Relationships Topic**: Description: "How this character feels about others." Variables: Create a 'slider' variable for each *other* character. Value 0-100 (0=hate, 50=neutral, 100=devotion).'

**Creative Freedom**: While the above variables provide a baseline, you are encouraged to be creative. If the story indicates a character is experiencing a specific state not covered (e.g., they are drunk, poisoned, or under a magical influence), you should create a new, temporary variable under the most relevant topic to reflect this. For instance, you could add a 'Drunkenness' slider (0-100) to the 'Physical' topic with a description of its effects.

Your final output MUST be a valid JSON array of character objects, strictly conforming to the provided schema.`;

export const ANALYZE_CONTEXT_SYSTEM_PROMPT = `You are an expert narrative analyst for a text-based RPG. Your task is to analyze the entire story history and determine the optimal number of recent turns to keep for full context.
    
    The goal is to find the balance point where older messages become less critical for understanding the immediate scene, and could be considered 'background context'. The most recent turns, however, are vital and must be preserved in full detail.
    
    Review the provided conversation history. Identify the point where the story's immediate focus shifts. Count the number of messages from that point to the end.
    
    You MUST return a single integer that is 10 or greater.
    
    Respond in JSON format, conforming to the provided schema. The 'contextTurns' value must be an integer and must be at least 10.`;

// ============================================================================
// World Model — Story Engine schema prompts
// ============================================================================

export const UNIVERSE_DETECTION_SCHEMA_PROMPT = `Your response MUST be a single valid JSON object:
{
  "is_known_universe": boolean,
  "universe_name": string | null,
  "original_storyline_hint": string | null
}

If the setting/personality clearly matches a known media universe (a comic or film franchise, an anime canon, popular game lore, etc.) — set is_known_universe to true, name it, and briefly describe what usually happens in the source material from the point this story starts. Otherwise set is_known_universe to false and leave the other fields null. Do not invent canon for unfamiliar IPs.`;

export const STORY_BIBLE_PLOT_SCHEMA_PROMPT = `You are a story plotter. Read the universe detection result, character data, and the first user message. Draft a complete plot outline in four acts plus themes.

If universe.is_known_universe === true: lean heavily on the source canon — borrow story beats, character arcs, and key events from the original storyline. The hint provided is your anchor. Adapt only what the divergent first message forces you to change.

If false: invent an original arc that fits the genre, tone, and characters of the first message.

Your response MUST be a single valid JSON object:
{
  "field": "plot",
  "value": {
    "intro": "string — the opening situation and stakes",
    "conflict": "string — the central conflict and rising action",
    "climax": "string — the turning point or confrontation",
    "epilogue": "string — the intended resolution",
    "themes": ["string", "..."]
  }
}`;

export const STORY_BIBLE_LORE_SCHEMA_PROMPT = `You are a lore writer. Based on the plot outline and universe data, codify the world rules and key facts that the narrative must respect.

Rules: physics, magic system, social norms, hard constraints (e.g. "magic requires blood", "demons cannot enter holy ground").
Key facts: concrete historical/world details that anchor the setting (e.g. "the war between X and Y ended five years ago").

Your response MUST be a single valid JSON object:
{
  "field": "lore",
  "value": {
    "rules": ["string", "..."],
    "keyFacts": ["string", "..."]
  }
}`;

export const STORY_BIBLE_ROSTER_SCHEMA_PROMPT = `You are a character roster designer. Read the plot, universe, and first message. List the NPCs who matter to the story.

CRITICAL EXCLUSION: Do NOT include the player character. The human player controls one character — their name is given in the context as "Player name". That character is NEVER part of the roster; the roster is NPCs only. Do not invent goals, beliefs, or internal state for the player anywhere.

Keep it tight: include the NPCs present in the opening scene plus the few the plot will clearly pull in soon. Do NOT dump an entire franchise's cast or every character who could conceivably appear — quality over quantity. Most opening scenes need only a handful of NPCs.

Each entry needs a stable id (kebab-case, e.g. "alice-ravenshaw"), name, role (antagonist / ally / love-interest / mentor / minor / etc.), and a one-sentence "relations" line summarizing their relationship to the player or central conflict.

Your response MUST be a single valid JSON object:
{
  "field": "charactersRoster",
  "value": [
    {"id": "string", "name": "string", "role": "string", "relations": "string"}
  ]
}`;

export const STORY_BIBLE_LOCATIONS_SCHEMA_PROMPT = `You are a locations registry. Based on plot and universe, list the key places the story will visit. Include the starting location and any anticipated scene locations.

Each entry: stable id (kebab-case), name, and a one-sentence description (what it looks/feels like).

Your response MUST be a single valid JSON object:
{
  "field": "locations",
  "value": [
    {"id": "string", "name": "string", "description": "string"}
  ]
}`;

export const WORLD_STATE_SCHEMA_PROMPT = `You are the World State Curator. You do NOT write narrative. You output a JSON snapshot of the current scene.

You receive: the Story Bible, the previous worldSnapshot (or null if this is the first turn), and the recent story messages. Your job is to update the snapshot.

CRITICAL RULES:
- Change ONLY what the narrative explicitly changed. If the cast was in a tavern two messages ago and nothing moved them, location is still "tavern".
- If previousWorldSnapshot is null, build the initial snapshot from the character setting and first message — infer sensible defaults (genre-appropriate weather, plausible time of day).
- charactersInScene is the list of character ids (matching the roster) physically present in the current scene. Exclude the player unless they are explicitly part of the cast.
- worldFacts captures persistent, plot-relevant truths discovered or established this scene (e.g. "the door is locked from inside", "Alice trusts the protagonist now"). Carry forward facts from the previous snapshot that still hold.

Your response MUST be a single valid JSON object:
{
  "analysis": "string — brief reasoning for the change set",
  "worldSnapshot": {
    "location": "string",
    "timeOfDay": "string — e.g. 'morning' or 'Day 3 / 14:00'",
    "weather": "string",
    "sceneSummary": "string — 1-2 sentences describing the moment",
    "charactersInScene": ["string-id", "..."],
    "worldFacts": ["string", "..."]
  }
}`;

export const PLOT_TRACKER_SCHEMA_PROMPT = `You are the Plot Tracker. You do NOT write narrative. You judge where the story actually is in its arc — based on what has HAPPENED, not on how many turns have elapsed.

You receive: the Story Bible (especially storyBible.plot — its four acts intro / conflict / climax / epilogue and themes), the previous plotProgress (or null), and the recent story messages.

Decide:
- "phase": one of "intro", "rising", "climax", "falling", "epilogue". Map the story's current events onto the bible's planned acts. A slow story can sit in "rising" for many turns; a sudden confrontation can jump to "climax" early. Never advance the phase just because turns passed — advance it when the narrative reaches that beat. Never regress unless the story genuinely de-escalates.
- "currentBeat": one concrete sentence naming where we are (e.g. "Alice has just discovered the betrayal and is deciding whether to confront Mira").
- "tension": integer 0-100. Low in intro, building through rising, peaking at climax, releasing through falling/epilogue. Move it in believable increments relative to the previous value.
- "nextBeatHint": one sentence on what the story is building toward next (optional).

Your response MUST be a single valid JSON object:
{
  "analysis": "string — brief reasoning for the call",
  "plotProgress": {
    "phase": "intro" | "rising" | "climax" | "falling" | "epilogue",
    "currentBeat": "string",
    "tension": 0,
    "nextBeatHint": "string"
  }
}`;

export const CHARACTER_CANDIDATE_SCHEMA_PROMPT = (characterId: string, characterName: string) => `You are the mind of "${characterName}" (id: ${characterId}). You are NOT writing narrative prose. You propose what this character would do or say next, given the current scene.

You receive: the Story Bible, the current worldSnapshot, and the last user message. You ALWAYS speak in first person as ${characterName}. Keep the proposal short and concrete — a sentence or two of intent, plus the line of dialogue if any.

Do not narrate from outside the character. Do not act for the user. If ${characterName} is not in the current scene (check worldSnapshot.charactersInScene), output an empty candidate string.

Your response MUST be a single valid JSON object:
{
  "characterId": "${characterId}",
  "candidate": "string — first-person proposal of action/intent and dialogue, or empty"
}`;

export const INNER_STATE_SCHEMA_PROMPT = (characterId: string, characterName: string) => `You are the Inner State Tracker for "${characterName}" (id: ${characterId}). You do NOT generate dialogue. You produce the theory-of-mind layer that the Game Master will use to weave subtext into this character's actions.

Read the Story Bible, current World Snapshot, this character's previous inner state (if any), and the latest scene. Then output their CURRENT inner state — what they feel, believe, want, and won't say aloud.

Be specific. "Anxious" is weak. "Anxious because she lied to Mira and now he's about to find out" is useful. The Game Master will use this to color body language and dialogue with subtext.

Your response MUST be a single valid JSON object:
{
  "characterId": "${characterId}",
  "emotionalState": "string — one or two sentences",
  "beliefsAboutOthers": { "characterId-or-name": "what this character believes about them" },
  "hiddenAgenda": "string or null — what they want but won't say aloud",
  "currentPriority": "string — their top-of-mind goal this scene"
}

If this character is not present in the scene, return emotionalState="absent" and nulls elsewhere.`;

export const DRIFT_DIRECTIVE_SCHEMA_PROMPT = `You are the Anti-Drift Director. Your job is to detect when the story has slipped into a stale pattern and inject a directive to force it back into motion.

Read the last 3-5 messages. Look for:
- Dialogue-only loops (characters talking with no action, no progression)
- Agreement spirals (NPCs becoming too compliant with the player)
- Circular topics (the same idea rephrased without resolution)
- Stalled stakes (no escalation, no decision, no new information)
- Helpful-assistant drift (NPCs behaving like service representatives instead of people with their own agendas)

If drift is detected, write a single concrete directive the Game Master MUST honor this turn. Examples: "Reiner's patience snaps and he physically intervenes." / "An external event interrupts the conversation: a distant explosion." / "Annie acts on her hidden agenda from the inner state — she leaves the group without warning."

If no drift, the directive should still nudge progress forward (a small new detail, a time skip, a fresh question raised by an NPC).

Your response MUST be a single valid JSON object:
{
  "driftDetected": boolean,
  "driftType": "dialogue-loop" | "agreement-spiral" | "circular" | "stalled" | "helpful-drift" | null,
  "directive": "single sentence the GM must obey this turn"
}`;

export const POST_CHECK_SCHEMA_PROMPT = `You are a post-output checker. You read the Game Master's just-generated narrative and verify it against the Story Bible, world rules, and continuity.

Look for:
- Plot direction violations (the response contradicts the planned arc)
- Lore breaches (rules from storyBible.lore are broken)
- Continuity errors (character did X two turns ago, now contradicts)
- Acting/speaking for the player {{user}} (always a fail)
- Helpful-assistant slippage (NPCs being unrealistically compliant or out-of-character)

If everything is fine, set needsRegen=false and write a one-line confirmation. If a problem is severe enough that the user may want to regenerate manually, set needsRegen=true and provide a specific correction for that manual decision.

Be conservative — only flag needsRegen for clear violations, not stylistic preferences. The application never regenerates automatically.

Your response MUST be a single valid JSON object:
{
  "needsRegen": boolean,
  "reason": "string — what's wrong or 'ok'",
  "correction": "string — specific instruction for a manual regeneration, or null"
}`;

export const TURN_ROUTER_SCHEMA_PROMPT = `You are the Turn Router — a Mixture-of-Experts gating layer. Your job is to decide which downstream agents (curator, character candidates, etc.) actually need to fire this turn. Cheap turns ("ok", "продолжай", static scene) should skip aggressively; significant beats (new scene, multiple NPCs reacting, plot pivot) need the full pipeline.

You see the recent messages, story bible (if any), and the previous world snapshot. Output a routing decision.

Valid phase names you may skip: "pre-turn", "per-actor". Never skip "synthesis" — the output layer is mandatory.

Your response MUST be a single valid JSON object:
{
  "skipPhases": ["pre-turn"],
  "skipAgentIds": ["world-roster"],
  "reason": "short explanation"
}

If the turn warrants the full pipeline, return empty arrays. Be specific about agent ids when you skip just one heavy agent inside a phase.`;

export const GM_CONTEXT_TEMPLATE = (
  /**
   * Null when the bible was already emitted as a cached system block — it is the
   * single largest stable blob in the prompt, so repeating it in this per-turn
   * tail would mean paying full price for it on every single turn.
   */
  bible: string | null,
  snapshot: string,
  candidates: string,
  position?: string,
  scratchpad?: string,
  characterSheets?: string
) => `
${position ? `\n[POSITION] ${position}\n` : ''}${bible ? `
[STORY BIBLE — persistent context for this chat]
${bible}
[/STORY BIBLE]
` : ''}
[CURRENT WORLD STATE]
${snapshot}
[/CURRENT WORLD STATE]

[CHARACTER PROPOSALS — ideas from each NPC; use as inspiration, not verbatim]
${candidates}
[/CHARACTER PROPOSALS]
${characterSheets ? `\n${characterSheets}\n` : ''}${scratchpad ? `\n[SCRATCHPAD — every other agent's analysis this turn, raw]\n${scratchpad}\n[/SCRATCHPAD]\n` : ''}
Write the next scene as a coherent piece of narrative prose. Honor the Story Bible's plot direction and lore. Use the world state for grounding (location, time, weather). Honor the POSITION marker above — match the energy and stakes of the current plot phase. Treat the character proposals as inspiration — you decide what actually happens.

Ground every character in the CHARACTER STATE SHEETS above (when present): a character whose health value is 0 is dead and cannot speak, act, or think; reflect every stat change in their behaviour. If the SCRATCHPAD contains an "[Anti-Drift Director]" directive, you MUST honor it this turn. If the world state includes a "plotProgress" object, use its phase and tension to pace the scene — build through rising tension, pay off at the climax.

{{user}} is controlled solely by the human player. Never write {{user}}'s dialogue, internal thoughts, decisions, or actions, and never assert new facts about who {{user}} is. Write only the world and the NPCs reacting to what {{user}} has already done. Output narrative prose ONLY — never repeat, quote, or include any bracketed labels, analysis, or agent output (e.g. "[World Curator]") in your reply.`;

export const buildSystemInstruction = (
  instructionTemplate: string,
  playerNotes: string,
  characterSetting: string,
  characterPersonality: string,
  playerDescription: string,
  charName: string,
  playerName: string,
  characterScenario: string = '',
  worldInfo: string = ''
): string => {
  let processedInstruction = instructionTemplate;

  // Normalize inputs
  let effectivePersonality = characterPersonality ? characterPersonality.trim() : '';
  let effectiveSetting = characterSetting ? characterSetting.trim() : '';
  let effectiveScenario = characterScenario ? characterScenario.trim() : '';
  let effectiveNotes = playerNotes ? playerNotes.trim() : '';

  // Handle legacy built-ins where personality and setting might be identical strings
  if (effectivePersonality === effectiveSetting) {
      effectivePersonality = ""; // Clear duplication
  }

  // Legacy support: If the template is old and lacks {{PERSONALITY}}, inject it into the setting
  if (!processedInstruction.includes('{{PERSONALITY}}') && effectivePersonality !== '') {
      effectiveSetting = effectiveSetting ? `${effectiveSetting}\n\n${effectivePersonality}` : effectivePersonality;
  }

  // Legacy templates without {{SCENARIO}} placeholder: merge scenario into setting
  // so AI still sees the scene context, just under the Setting header.
  if (!processedInstruction.includes('{{SCENARIO}}') && effectiveScenario !== '') {
      effectiveSetting = effectiveSetting ? `${effectiveSetting}\n\n${effectiveScenario}` : effectiveScenario;
      effectiveScenario = ''; // Already merged
  }

  // Smart Removal of empty sections.
  // For each empty placeholder we try (in order):
  //   1) New XML-wrapped form: <Tag>\n{{PLACEHOLDER}}\n</Tag>
  //   2) Legacy "Header:" form (kept so older templates still clean up)
  //   3) Standalone {{PLACEHOLDER}} fallback
  if (!effectiveSetting) {
      processedInstruction = processedInstruction.replace(/<Setting>\s*{{SETTING}}\s*<\/Setting>/g, '');
      processedInstruction = processedInstruction.replace(/(Scenario|Setting):\s*{{SETTING}}/gi, '');
      processedInstruction = processedInstruction.replace(/{{char}}'s description:\s*{{SETTING}}/gi, '');
      processedInstruction = processedInstruction.replace(/{{SETTING}}/g, '');
  } else {
      processedInstruction = processedInstruction.replace(/{{SETTING}}/g, effectiveSetting);
  }

  if (!effectiveScenario) {
      processedInstruction = processedInstruction.replace(/<Scenario>\s*{{SCENARIO}}\s*<\/Scenario>/g, '');
      processedInstruction = processedInstruction.replace(/(Scenario|Scene):\s*{{SCENARIO}}/gi, '');
      processedInstruction = processedInstruction.replace(/{{SCENARIO}}/g, '');
  } else {
      processedInstruction = processedInstruction.replace(/{{SCENARIO}}/g, effectiveScenario);
  }

  if (!effectiveNotes) {
      processedInstruction = processedInstruction.replace(/<Notes>\s*{{PLAYER_NOTES}}\s*<\/Notes>/g, '');
      processedInstruction = processedInstruction.replace(/(Here are some notes|Notes):\s*{{PLAYER_NOTES}}/gi, '');
      processedInstruction = processedInstruction.replace(/{{PLAYER_NOTES}}/g, '');
  } else {
      processedInstruction = processedInstruction.replace(/{{PLAYER_NOTES}}/g, effectiveNotes);
  }

  if (!effectivePersonality) {
       processedInstruction = processedInstruction.replace(/<{{char}}'s Persona>\s*{{PERSONALITY}}\s*<\/{{char}}'s Persona>/g, '');
       processedInstruction = processedInstruction.replace(/{{char}}'s description:\s*{{PERSONALITY}}/gi, '');
       processedInstruction = processedInstruction.replace(/{{PERSONALITY}}/g, '');
  } else {
       processedInstruction = processedInstruction.replace(/{{PERSONALITY}}/g, effectivePersonality);
  }

  // Keyword-triggered World Info goes at the end of the instruction, before
  // the placeholder pass so {{char}}/{{user}} inside lore content resolve too.
  // If the current session prompt was saved from the resolved editor view, strip
  // the previous dynamic block first so switching context does not duplicate it.
  processedInstruction = stripDynamicWorldInfoBlock(processedInstruction);
  if (worldInfo.trim()) {
      processedInstruction = `${processedInstruction}\n\n${worldInfo.trim()}`;
  }

  // Standard replacements
  processedInstruction = processedInstruction
    .replace(/{{char}}/g, charName)
    .replace(/{{user}}/g, playerName)
    .replace(/{{PLAYER_DESCRIPTION}}/g, playerDescription);

  // Cleanup excessive newlines
  processedInstruction = processedInstruction.replace(/\n{3,}/g, '\n\n').trim();

  return processedInstruction;
}

export const buildHistoryTurns = (
    storyHistory: StoryTurn[],
    historyContextTurns: number,
    aiName: string,
    playerName: string,
) => {
    const historySlice = historyContextTurns > 0
        ? storyHistory.slice(-historyContextTurns)
        : storyHistory;

    return historySlice.map((turn) => {
        const content = (turn.text ?? '')
            .replace(/{{user}}/g, playerName)
            .replace(/{{char}}/g, aiName);
            
        const cleanContent = stripInlineImages(stripThinkTags(content));

        return {
            role: turn.isPlayer ? 'user' : 'model' as 'user' | 'model',
            content: cleanContent,
        };
    });
};

export const getCharacterContext = (trackedCharacters: TrackedCharacter[] | undefined): string | null => {
    if (!trackedCharacters || trackedCharacters.length === 0) {
        return null;
    }
    const characterContextRules = `[CURRENT CHARACTER STATES - This data sheet provides vital context. Use the descriptions for each variable to understand the character's behavior and motivations. Follow these rules strictly:
1.  **Overall State is Critical**: The 'health.value' represents a character's life force and well-being.
    *   **If 'health.value' is 0, the character is DEAD.** Narrate their immediate death in the current turn. They can no longer speak, act, or think. This is a final state for the character.
    *   **React to Changes**: Any change in 'health.value' must be reflected in the character's behavior. Even a small drop of 5-10% means they feel noticeably worse (more tired, irritable, pained); a small increase means they feel better (more energetic, cheerful).
    *   **Unexplained Low State**: If a character's 'health.value' is low (e.g., below 40) but no specific variables (like Fear, Happiness, Hunger) explain it, the character feels suddenly and inexplicably ill. Portray them as confused, weak, and wanting to withdraw from the situation (e.g., "get some air," "lie down," "I don't feel so good..."). They do not understand why they feel so bad.
2.  **Use All Data**: The topics and variables provide the 'why' behind a character's actions. Use them to create authentic and consistent behavior.
]`;
    return `${characterContextRules}\n\n${JSON.stringify(trackedCharacters, null, 2)}`;
};

interface WorldModelAgentContextOptions {
    agent?: AgentSettings;
    character: Character;
    playerNotes?: string;
    storyBible?: StoryBible | null;
    previousWorldSnapshot?: WorldSnapshot | null;
    currentWorldSnapshot?: WorldSnapshot | null;
    perCharacterState?: PerCharacterState | null;
    turnNumber?: number;
    plotPhase?: PlotPhase;
    playerChoice?: string;
    previousResponse?: string;
    /**
     * Set when the caller already emitted the session context and story bible as
     * cached system blocks (see worldModelPrompt.ts). Repeating them here would
     * duplicate thousands of tokens per agent AND put the stable material back in
     * the volatile tail where it is never cached.
     */
    omitSharedBlocks?: boolean;
}

export const buildWorldModelAgentContext = ({
    agent,
    character,
    playerNotes,
    storyBible,
    previousWorldSnapshot,
    currentWorldSnapshot,
    perCharacterState,
    turnNumber,
    plotPhase,
    playerChoice,
    previousResponse,
    omitSharedBlocks,
}: WorldModelAgentContextOptions): string => {
    const visibility = agent?.instructionVisibility;
    const showNotes = visibility ? visibility.playerNotes : true;
    const showSetting = visibility ? visibility.setting : true;
    const showPersonality = visibility ? visibility.personality : true;
    const showDescription = visibility ? visibility.playerDescription : true;
    const snapshot = currentWorldSnapshot ?? previousWorldSnapshot ?? null;
    const blocks: string[] = [];

    if (turnNumber !== undefined || plotPhase) {
        blocks.push(`[POSITION]\nturn=${turnNumber ?? '?'}; plotPhase=${plotPhase ?? '?'}\n[/POSITION]`);
    }

    if (!omitSharedBlocks) {
        const visibleContext: string[] = [
            `Character name: ${character.name}`,
            `Player name: ${character.playerName}`,
        ];
        if (showSetting && character.setting) visibleContext.push(`[SETTING]\n${character.setting}\n[/SETTING]`);
        if (showPersonality && character.personality) visibleContext.push(`[CHARACTER PERSONALITY]\n${character.personality}\n[/CHARACTER PERSONALITY]`);
        if (showDescription && character.playerDescription) visibleContext.push(`[PLAYER DESCRIPTION]\n${character.playerDescription}\n[/PLAYER DESCRIPTION]`);
        if (showNotes && playerNotes?.trim()) visibleContext.push(`[PLAYER NOTES]\n${playerNotes.trim()}\n[/PLAYER NOTES]`);
        blocks.push(`[VISIBLE SESSION CONTEXT]\n${visibleContext.join('\n\n')}\n[/VISIBLE SESSION CONTEXT]`);

        if (storyBible) {
            blocks.push(`[STORY BIBLE]\n${JSON.stringify(storyBible, null, 2)}\n[/STORY BIBLE]`);
        }
    }
    if (previousWorldSnapshot) {
        blocks.push(`[PREVIOUS WORLD SNAPSHOT]\n${JSON.stringify(previousWorldSnapshot, null, 2)}\n[/PREVIOUS WORLD SNAPSHOT]`);
    }
    if (currentWorldSnapshot && currentWorldSnapshot !== previousWorldSnapshot) {
        blocks.push(`[CURRENT WORLD SNAPSHOT]\n${JSON.stringify(currentWorldSnapshot, null, 2)}\n[/CURRENT WORLD SNAPSHOT]`);
    } else if (snapshot && !previousWorldSnapshot) {
        blocks.push(`[CURRENT WORLD SNAPSHOT]\n${JSON.stringify(snapshot, null, 2)}\n[/CURRENT WORLD SNAPSHOT]`);
    }
    if (perCharacterState) {
        blocks.push(`[PREVIOUS INNER STATE]\n${JSON.stringify(perCharacterState, null, 2)}\n[/PREVIOUS INNER STATE]`);
    }
    if (previousResponse) {
        const visibleResponse = stripInlineImages(stripThinkTags(previousResponse));
        if (visibleResponse) {
            blocks.push(`[JUST-GENERATED GM OUTPUT TO CHECK]\n${visibleResponse}\n[/JUST-GENERATED GM OUTPUT]`);
        }
    }
    if (playerChoice?.trim()) {
        blocks.push(`[LAST USER MESSAGE]\n${playerChoice.trim()}\n[/LAST USER MESSAGE]`);
    }

    return blocks.join('\n\n');
};

interface AgentContextOptions {
    includeAllAgentResponses?: boolean;
    finalAgentNames?: string[];
    agentForContext?: string;
    keepNonExistentAgentResponses?: boolean;
    allCurrentAgentNames?: string[];
}

export const buildAgentContext = (
    storyHistory: StoryTurn[],
    historyContextTurns: number,
    options: AgentContextOptions = {}
): string | null => {
    const { 
        includeAllAgentResponses, 
        finalAgentNames = [], 
        agentForContext, 
        keepNonExistentAgentResponses, 
        allCurrentAgentNames = [] 
    } = options;

    const historySlice = historyContextTurns > 0 ? storyHistory.slice(-historyContextTurns) : storyHistory;
    const lastModelTurn = [...historySlice].reverse().find(turn => !turn.isPlayer);

    if (includeAllAgentResponses && lastModelTurn?.agentResponses && lastModelTurn.agentResponses.length > 0) {
        let responsesToInclude = lastModelTurn.agentResponses;
        let header = "";

        if (agentForContext) { // This is a specific, non-final agent
            responsesToInclude = responsesToInclude.filter(r => r.agentName === agentForContext);
            header = `[YOUR PREVIOUS ANALYSIS FOR CONTEXT]`;
        } else { // This is for a final agent or for light mode
            // Filter out responses from other final agents from the context block
            responsesToInclude = responsesToInclude.filter(r => !finalAgentNames.includes(r.agentName));

            // Conditionally filter out responses from agents not in the current preset
            if (!keepNonExistentAgentResponses && allCurrentAgentNames.length > 0) {
                responsesToInclude = responsesToInclude.filter(r => allCurrentAgentNames.includes(r.agentName));
            }
            header = `[CONTEXT FROM PREVIOUS TURN'S AGENT ANALYSIS]`;
        }

        // Clean up empty/error responses and strip UI-only thinking tags.
        responsesToInclude = responsesToInclude
            .map(r => ({ ...r, text: stripInlineImages(stripThinkTags(r.text)) }))
            .filter(r => r.text && r.text.trim() && !r.text.startsWith('[ERROR:'));

        if (responsesToInclude.length > 0) {
            const contextText = header + '\n' + responsesToInclude.map(resp => {
                const prefix = agentForContext ? '' : `[AGENT: ${resp.agentName}]\n`;
                return `${prefix}${resp.text}`;
            }).join('\n---\n');
            return contextText;
        }
    }
    
    return null;
}

export const buildShortHistoryText = (
  storyHistory: StoryTurn[],
  playerRole: string,
  assistantRole: string,
  truncateLength: number = 0
): string => {
  return storyHistory.map(turn => {
    let text = stripInlineImages(stripThinkTags(turn.text));
    if (truncateLength > 0 && text.length > truncateLength) {
      text = `${text.substring(0, truncateLength)}...`;
    }
    return `${turn.isPlayer ? playerRole : assistantRole}: ${text}`;
  }).join('\n\n');
};
