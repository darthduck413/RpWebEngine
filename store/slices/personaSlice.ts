
import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { Persona } from '../../types';
import { storageService } from '../../services/storage';

interface PersonaState {
  personas: Persona[];
  activePersonaId: string;
}

const loadInitialState = (): PersonaState => {
    // Personas are entirely user-authored: the app starts with none and the
    // Personas page creates them. An empty list is a valid state — prompts fall
    // back to the character's own playerName / playerDescription.
    const savedData = storageService.loadPersonas();
    const personas = savedData?.personas ?? [];
    const activePersonaId = personas.some(p => p.id === savedData?.activePersonaId)
        ? savedData!.activePersonaId
        : personas[0]?.id ?? '';

    return { personas, activePersonaId };
};

const personaSlice = createSlice({
  name: 'personas',
  initialState: loadInitialState(),
  reducers: {
    addPersona(state, action: PayloadAction<Persona>) {
      const timestamp = Date.now();
      const newPersona = { 
          ...action.payload, 
          createdAt: action.payload.createdAt || timestamp, 
          lastModified: timestamp 
      };
      state.personas.push(newPersona);
    },
    updatePersona(state, action: PayloadAction<Persona>) {
      const index = state.personas.findIndex(p => p.id === action.payload.id);
      if (index !== -1) {
        // Preserve createdAt if not provided in payload, update lastModified
        const existing = state.personas[index];
        state.personas[index] = { 
            ...action.payload, 
            createdAt: action.payload.createdAt || existing.createdAt,
            lastModified: Date.now() 
        };
      }
    },
    deletePersona(state, action: PayloadAction<string>) {
      // Prevent deleting the last persona
      if (state.personas.length <= 1) return;
      
      state.personas = state.personas.filter(p => p.id !== action.payload);
      // If active persona was deleted, switch to the first one
      if (state.activePersonaId === action.payload) {
          state.activePersonaId = state.personas[0].id;
      }
    },
    setActivePersona(state, action: PayloadAction<string>) {
      if (state.personas.some(p => p.id === action.payload)) {
          state.activePersonaId = action.payload;
      }
    },
    setPersonas(state, action: PayloadAction<{ personas: Persona[], activeId: string }>) {
        state.personas = action.payload.personas;
        state.activePersonaId = action.payload.activeId;
    }
  },
});

export const { addPersona, updatePersona, deletePersona, setActivePersona, setPersonas } = personaSlice.actions;
export default personaSlice.reducer;
