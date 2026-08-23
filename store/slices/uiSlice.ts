
import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { Character } from '../../types';

interface UiState {
  page: 'selection' | 'detail' | 'chat' | 'my-chats' | 'personas' | 'create-character' | 'edit-character';
  selectedCharacter: Character | null;
  editingCharacterId: string | null; // ID of character being edited
  currentChatId: string | null;
  searchQuery: string; // Global search query for character selection
  toast: {
    message: string;
    type: 'success' | 'error' | 'info';
    isVisible: boolean;
  };
  modals: {
    isLogViewerVisible: boolean;
    isWorldInfoVisible: boolean;
    isManualScenariosVisible: boolean;
    isNotesModalVisible: boolean;
    isSystemModalVisible: boolean;
    isSettingModalVisible: boolean;
    isScenarioModalVisible: boolean;
    isPersonalityModalVisible: boolean;
    isAgentSettingsModalOpen: boolean;
    isGameSettingsModalOpen: boolean;
    isApiSettingsModalOpen: boolean; // This is now "API Provider"
    isGenerationSettingsModalOpen: boolean; // This is now "API Settings"
    isCharacterTrackerModalOpen: boolean;
    isUISettingsModalOpen: boolean;
  };
}

const initialState: UiState = {
  page: 'selection',
  selectedCharacter: null,
  editingCharacterId: null,
  currentChatId: null,
  searchQuery: '',
  toast: {
    message: '',
    type: 'info',
    isVisible: false,
  },
  modals: {
    isLogViewerVisible: false,
    isWorldInfoVisible: false,
    isManualScenariosVisible: false,
    isNotesModalVisible: false,
    isSystemModalVisible: false,
    isSettingModalVisible: false,
    isScenarioModalVisible: false,
    isPersonalityModalVisible: false,
    isAgentSettingsModalOpen: false,
    isGameSettingsModalOpen: false,
    isApiSettingsModalOpen: false,
    isGenerationSettingsModalOpen: false,
    isCharacterTrackerModalOpen: false,
    isUISettingsModalOpen: false,
  },
};

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    setPage(state, action: PayloadAction<UiState['page']>) {
      state.page = action.payload;
    },
    setSelectedCharacter(state, action: PayloadAction<Character | null>) {
      state.selectedCharacter = action.payload;
    },
    setEditingCharacterId(state, action: PayloadAction<string | null>) {
        state.editingCharacterId = action.payload;
    },
    setCurrentChatId(state, action: PayloadAction<string | null>) {
        state.currentChatId = action.payload;
    },
    setSearchQuery(state, action: PayloadAction<string>) {
        state.searchQuery = action.payload;
    },
    setChatStartupMode(state, action: PayloadAction<any>) {
       // No-op or deprecate
    },
    setModalVisibility(state, action: PayloadAction<{ modal: keyof UiState['modals']; visible: boolean }>) {
      state.modals[action.payload.modal] = action.payload.visible;
    },
    closeAllModals(state) {
        Object.keys(state.modals).forEach(key => {
            state.modals[key as keyof UiState['modals']] = false;
        });
    },
    showToast(state, action: PayloadAction<{ message: string; type?: 'success' | 'error' | 'info' }>) {
      state.toast.message = action.payload.message;
      state.toast.type = action.payload.type || 'info';
      state.toast.isVisible = true;
    },
    hideToast(state) {
      state.toast.isVisible = false;
    }
  },
});

export const { setPage, setSelectedCharacter, setEditingCharacterId, setCurrentChatId, setSearchQuery, setChatStartupMode, setModalVisibility, closeAllModals, showToast, hideToast } = uiSlice.actions;
export default uiSlice.reducer;
