
import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { Character } from '../../types';
import { storageService } from '../../services/storage';

interface CharactersState {
  characters: Character[];
}

const initialState: CharactersState = {
  // Built-in ids are resolved to the latest code definitions by storageService;
  // only genuinely custom characters are hydrated from full local objects.
  characters: storageService.loadCharacters(),
};

const charactersSlice = createSlice({
  name: 'characters',
  initialState,
  reducers: {
    addCharacter(state, action: PayloadAction<Character>) {
      state.characters.push(action.payload);
    },
    updateCharacter(state, action: PayloadAction<Character>) {
      const index = state.characters.findIndex(c => c.id === action.payload.id);
      if (index !== -1) {
        state.characters[index] = action.payload;
      } else {
        // If not found (e.g. ID changed or weird state), push it
        state.characters.push(action.payload);
      }
    },
    deleteCharacter(state, action: PayloadAction<string>) {
      state.characters = state.characters.filter(c => c.id !== action.payload);
    },
    setCharacters(state, action: PayloadAction<Character[]>) {
        state.characters = action.payload;
    }
  },
});

export const { addCharacter, updateCharacter, deleteCharacter, setCharacters } = charactersSlice.actions;
export default charactersSlice.reducer;
