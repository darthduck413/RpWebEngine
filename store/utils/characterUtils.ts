
import { TrackedCharacter, CharacterTopic, CharacterVariable, CharacterUpdate } from '../../types';
import { addLog } from '../slices/logSlice';

// Helper to migrate character data structure from potentially untyped inputs
export function migrateCharacters(chars: unknown[], dispatch: any): TrackedCharacter[] {
    if (!Array.isArray(chars)) return [];
    return chars.map(char => {
        // Safe check to ensure char is object
        if (typeof char !== 'object' || char === null) return null;
        const newChar = JSON.parse(JSON.stringify(char));
        
        // Ensure basic properties
        newChar.id = newChar.id || crypto.randomUUID();
        newChar.name = newChar.name || 'Unknown Character';
        newChar.description = newChar.description || '';
        
        if (!newChar.health) {
             newChar.health = { value: 75, description: 'Healthy and in good condition.' };
        }
        
        // Strip old fields
        delete newChar.personality;

        const topics = new Map((newChar.topics || []).map((t: any) => [t.name, t]));
        // Default topics
        ['Mental', 'Physical', 'Needs'].forEach(t => {
            if (!topics.has(t)) topics.set(t, { id: crypto.randomUUID(), name: t, description: '', variables: [] });
        });

        if (newChar.relationships && !topics.has('Relationships')) {
             dispatch(addLog({ message: `Migrating relationship data for ${newChar.name}` }));
             const relationshipsTopic: CharacterTopic = {
                id: crypto.randomUUID(),
                name: 'Relationships',
                description: 'How this character feels about others.',
                variables: (newChar.relationships || []).map((rel: any): CharacterVariable => ({
                    id: crypto.randomUUID(),
                    name: rel.targetName,
                    type: 'slider',
                    value: rel.score,
                    description: rel.description,
                    targetId: rel.targetId,
                })),
            };
            topics.set('Relationships', relationshipsTopic);
        }
        newChar.topics = Array.from(topics.values());
        delete newChar.relationships;
        return newChar as TrackedCharacter;
    }).filter((c): c is TrackedCharacter => c !== null);
}

// Helper to merge updates from AI with proper type checking
export function mergeCharacterUpdates(currentChars: TrackedCharacter[], updates: unknown[], dispatch: any): TrackedCharacter[] {
    // If updates is not an array or null, do nothing
    if (!Array.isArray(updates)) return currentChars;
    
    const newCharsMap = new Map(currentChars.map(c => [c.id, JSON.parse(JSON.stringify(c))]));

    updates.forEach((update: unknown) => {
         if (!isCharacterUpdate(update)) return;
         
         // TypeScript now knows update is CharacterUpdate
         const updateObj = update;
         
         let charToUpdate: TrackedCharacter | undefined = Array.from(newCharsMap.values()).find(c => c.name === updateObj.name);
         
         if (!charToUpdate) {
            charToUpdate = { 
                id: crypto.randomUUID(), 
                name: updateObj.name, 
                description: updateObj.description || '', 
                health: updateObj.health 
                    ? { value: updateObj.health.value, description: updateObj.health.description } 
                    : { value: 75, description: 'Newly introduced character.'},
                topics: [] as CharacterTopic[],
            };
         } else {
            if(updateObj.description) charToUpdate.description = updateObj.description;
            if(updateObj.health) {
                charToUpdate.health.value = updateObj.health.value;
                charToUpdate.health.description = updateObj.health.description;
            }
         }

         if(updateObj.topics) {
            updateObj.topics.forEach((topicUpdate) => {
                let topicToUpdate = charToUpdate!.topics.find(t => t.name === topicUpdate.name);
                if (!topicToUpdate) {
                    topicToUpdate = { id: crypto.randomUUID(), name: topicUpdate.name, description: '', variables: [] };
                    charToUpdate!.topics.push(topicToUpdate);
                }
                
                if(topicUpdate.description) topicToUpdate.description = topicUpdate.description;

                if(topicUpdate.variables) {
                    topicUpdate.variables.forEach((varUpdate) => {
                        let varToUpdate = topicToUpdate!.variables.find(v => v.name === varUpdate.name);
                        if (!varToUpdate) {
                            varToUpdate = { id: crypto.randomUUID(), name: varUpdate.name, type: varUpdate.type, value: varUpdate.value, description: varUpdate.description || '' };
                            topicToUpdate!.variables.push(varToUpdate);
                        } else {
                            varToUpdate.value = varUpdate.value;
                            if(varUpdate.description) varToUpdate.description = varUpdate.description;
                            if(varUpdate.type) varToUpdate.type = varUpdate.type;
                        }
                    });
                }
            });
         }
         newCharsMap.set(charToUpdate.id, charToUpdate);
    });
    return Array.from(newCharsMap.values());
}

// Robust runtime type guard for CharacterUpdate
export function isCharacterUpdate(obj: any): obj is CharacterUpdate {
    if (typeof obj !== 'object' || obj === null) return false;
    if (typeof obj.name !== 'string') return false;
    
    if (obj.health !== undefined) {
        if (typeof obj.health !== 'object' || obj.health === null) return false;
        if (obj.health.value === undefined) return false; // value can be string or number
        if (typeof obj.health.description !== 'string') return false;
    }

    if (obj.topics !== undefined) {
        if (!Array.isArray(obj.topics)) return false;
        for (const topic of obj.topics) {
            if (typeof topic !== 'object' || topic === null) return false;
            if (typeof topic.name !== 'string') return false;
            
            if (topic.variables !== undefined) {
                if (!Array.isArray(topic.variables)) return false;
                for (const v of topic.variables) {
                     if (typeof v !== 'object' || v === null) return false;
                     if (typeof v.name !== 'string') return false;
                     // Strict check for type enum 'slider' | 'text'
                     if (v.type !== 'slider' && v.type !== 'text') return false;
                     if (v.value === undefined) return false;
                     if (v.description !== undefined && typeof v.description !== 'string') return false;
                }
            }
        }
    }
    
    return true;
}
