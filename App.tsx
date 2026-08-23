

import React, { useEffect, useMemo } from 'react';
import { useAppSelector, useAppDispatch } from './store/hooks';
import { setPage, setSelectedCharacter, setCurrentChatId, setModalVisibility, showToast } from './store/slices/uiSlice';
import { setPlayerNotes, setPostHistoryInstruction, setSystemInstruction, setCharacterSetting, setCharacterScenario, setCharacterPersonality, setTheme, setApiSettings, setProxyPresets, setGeminiApiKeys, setGeminiPresets, setGameSettings } from './store/slices/settingsSlice';
import { setBaseCharacterSetting, setBaseCharacterScenario } from './store/slices/gameSlice';
import { startNewGame, loadGameSession, autoSaveGame } from './store/thunks/gameThunks';
import CharacterSelectionPage from './components/CharacterSelectionPage';
import CharacterDetailPage from './components/CharacterDetailPage';
import ChatPage from './components/ChatPage';
import MyChatsPage from './components/MyChatsPage';
import PersonasPage from './components/PersonasPage';
import CharacterEditorPage from './components/CharacterEditorPage';
import NavBar from './components/NavBar';
import APISettingsModal from './components/APISettingsModal';
import GenerationSettingsModal from './components/GenerationSettingsModal';
import UISettingsModal from './components/UISettingsModal';
import WorldInfoModal from './components/WorldInfoModal';
import Toast from './components/Toast';
import { Character, GeminiSettings, ProxySettings } from './types';
import { extractCustomPromptFromSystemInstruction } from './services/common/systemPrompt';
import { DEFAULT_SCAN_DEPTH, selectActiveWorldInfo } from './services/common/worldInfo';
import { applyProviderCustomPromptToSystemInstruction } from './services/common/effectiveSystemInstruction';

const App: React.FC = () => {
    const dispatch = useAppDispatch();
    const page = useAppSelector((state) => state.ui.page);
    const selectedCharacter = useAppSelector((state) => state.ui.selectedCharacter);
    const editingCharacterId = useAppSelector((state) => state.ui.editingCharacterId);
    const currentChatId = useAppSelector((state) => state.ui.currentChatId);
    const theme = useAppSelector((state) => state.settings.theme);
    const apiSettings = useAppSelector((state) => state.settings);
    const storyHistory = useAppSelector((state) => state.game.storyHistory);
    const isApiSettingsModalOpen = useAppSelector((state) => state.ui.modals.isApiSettingsModalOpen);
    const isGenerationSettingsModalOpen = useAppSelector((state) => state.ui.modals.isGenerationSettingsModalOpen);
    const isWorldInfoVisible = useAppSelector((state) => state.ui.modals.isWorldInfoVisible);
    const isUISettingsModalOpen = useAppSelector((state) => state.ui.modals.isUISettingsModalOpen);
    
    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
    }, [theme]);

    // Guard against invalid page states (e.g. a 'chat'/'detail' route with no
    // character selected). Correcting the route here — not during render — avoids
    // dispatching while React is rendering.
    useEffect(() => {
        if (page === 'detail' && !selectedCharacter) {
            dispatch(setPage('selection'));
        } else if (page === 'chat' && (!selectedCharacter || !currentChatId)) {
            dispatch(setPage(selectedCharacter ? 'detail' : 'selection'));
        }
    }, [page, selectedCharacter, currentChatId, dispatch]);

    const themeColor = theme === 'yellow' ? 'amber' : theme;

    const activeWorldInfo = useMemo(
        () => selectActiveWorldInfo(
            selectedCharacter?.loreBook,
            storyHistory,
            undefined,
            selectedCharacter ? [
                apiSettings.characterPersonality ?? selectedCharacter.personality,
                apiSettings.characterSetting ?? selectedCharacter.setting,
                apiSettings.characterScenario ?? selectedCharacter.scenario ?? '',
            ] : [],
            DEFAULT_SCAN_DEPTH,
        ),
        [
            selectedCharacter,
            storyHistory,
            apiSettings.characterPersonality,
            apiSettings.characterSetting,
            apiSettings.characterScenario,
        ],
    );

    const handleSelectCharacter = (character: Character) => {
        dispatch(setSelectedCharacter(character));
        dispatch(setPage('detail'));
    };

    const handleStartChat = (startOptions: { setting: string; firstMessageIndex: number; }) => {
        if (selectedCharacter) {
            const updatedChar = {
                ...selectedCharacter,
                setting: startOptions.setting,
            };
            dispatch(setSelectedCharacter(updatedChar));
            dispatch(setSystemInstruction(updatedChar.systemInstructionTemplate));
            dispatch(setCharacterSetting(updatedChar.setting));
            dispatch(setCharacterScenario(updatedChar.scenario ?? ''));
            // For loreBook characters, ChatPage's effect will overwrite these with
            // composed values: character→personality, scenario→scenario, setting→setting.
            dispatch(setCharacterPersonality(updatedChar.personality));
            dispatch(setBaseCharacterSetting(updatedChar.setting));
            dispatch(setBaseCharacterScenario(updatedChar.scenario ?? ''));
            dispatch(setPlayerNotes(''));
            dispatch(setPostHistoryInstruction(''));
            dispatch(startNewGame({ character: updatedChar, initialFirstMessageIndex: startOptions.firstMessageIndex }));
            dispatch(setPage('chat'));
        }
    };

    const handleContinueChat = (chatId: string) => {
        if (selectedCharacter) {
             dispatch(loadGameSession(chatId));
             dispatch(setPage('chat'));
        }
    };

    const handleBack = () => {
        if (page === 'chat') {
            dispatch(setPage('detail'));
            dispatch(setCurrentChatId(null));
        } else if (page === 'detail') {
            dispatch(setSelectedCharacter(null));
            dispatch(setPage('selection'));
        }
    };

    const handleNavigate = (target: 'selection' | 'my-chats' | 'personas') => {
        dispatch(setPage(target));
        if (target === 'selection') {
            dispatch(setSelectedCharacter(null));
        }
    };
    
    const handleSaveApiSettings = (newSettings: { 
        provider: 'gemini' | 'proxy'; 
        proxyConfig: ProxySettings;
        geminiConfig: GeminiSettings;
        replaceModels: boolean;
        historyContextTurns?: number;
        includeAllAgentResponsesInContext?: boolean;
        keepNonExistentAgentResponses?: boolean;
        deleteUnfinishedGeminiSentencesOnError?: boolean;
      }) => {
        dispatch(setApiSettings({
            provider: newSettings.provider,
            proxyConfig: newSettings.proxyConfig,
            geminiConfig: newSettings.geminiConfig,
            replaceModels: newSettings.replaceModels
        }));

        const providerConfigChanged =
            apiSettings.apiProvider !== newSettings.provider ||
            JSON.stringify(apiSettings.proxySettings) !== JSON.stringify(newSettings.proxyConfig) ||
            JSON.stringify(apiSettings.geminiSettings) !== JSON.stringify(newSettings.geminiConfig);

        if (selectedCharacter && providerConfigChanged) {
            dispatch(setSystemInstruction(applyProviderCustomPromptToSystemInstruction(
                selectedCharacter.systemInstructionTemplate,
                newSettings.provider,
                newSettings.proxyConfig,
                newSettings.geminiConfig
            )));
            dispatch(showToast({
                message: 'System Prompt was rebuilt from the selected generation preset.',
                type: 'info',
            }));
        }
        
        if (newSettings.historyContextTurns !== undefined) {
            dispatch(setGameSettings({
                turns: newSettings.historyContextTurns,
                interval: apiSettings.autosaveInterval,
                intelligentAnalyzer: apiSettings.isIntelligentPresetAnalyzerEnabled,
                includeAllAgentResponsesInContext: newSettings.includeAllAgentResponsesInContext ?? apiSettings.includeAllAgentResponsesInContext,
                keepNonExistentAgentResponses: newSettings.keepNonExistentAgentResponses ?? apiSettings.keepNonExistentAgentResponses,
                sendUserAvatar: apiSettings.sendUserAvatar,
                sendCharacterAvatar: apiSettings.sendCharacterAvatar,
                ignoreImages: apiSettings.ignoreImages,
                editFullMessage: apiSettings.editFullMessage,
                deleteUnfinishedGeminiSentencesOnError: newSettings.deleteUnfinishedGeminiSentencesOnError ?? apiSettings.deleteUnfinishedGeminiSentencesOnError,
                enableAnthropicCaching: apiSettings.enableAnthropicCaching
            }));
        }

        dispatch(setModalVisibility({ modal: 'isApiSettingsModalOpen', visible: false }));
        dispatch(setModalVisibility({ modal: 'isGenerationSettingsModalOpen', visible: false }));
        dispatch(showToast({ message: 'Generation settings saved.', type: 'success' }));
        dispatch(autoSaveGame());
    };

    const renderPage = () => {
        switch (page) {
            case 'detail':
                if (selectedCharacter) {
                    return <CharacterDetailPage 
                                character={selectedCharacter} 
                                onStartChat={handleStartChat} 
                                onContinueChat={handleContinueChat}
                                onBack={handleBack} 
                                themeColor={themeColor} 
                                theme={theme} 
                                onThemeChange={(t) => dispatch(setTheme(t))} 
                            />;
                }
                // Invalid state — corrected by the guard effect above.
                return null;

            case 'chat':
                if (selectedCharacter && currentChatId) {
                    return <ChatPage character={selectedCharacter} onExit={handleBack} />;
                }
                // Invalid state — corrected by the guard effect above.
                return null;

            case 'my-chats':
                return <MyChatsPage themeColor={themeColor} />;

            case 'personas':
                return <PersonasPage themeColor={themeColor} />;

            case 'create-character':
                return <CharacterEditorPage themeColor={themeColor} />;

            case 'edit-character':
                return <CharacterEditorPage themeColor={themeColor} characterIdToEdit={editingCharacterId} />;

            case 'selection':
            default:
                return <CharacterSelectionPage 
                    onSelectCharacter={handleSelectCharacter} 
                    theme={theme} 
                    onThemeChange={(t) => dispatch(setTheme(t))} 
                    themeColor={themeColor} 
                />;
        }
    };

    return (
        <div className="bg-gray-900 min-h-screen text-white font-sans flex flex-col">
            {page !== 'chat' && (
                <NavBar 
                    onNavigate={handleNavigate} 
                    currentPage={page}
                    theme={theme}
                    themeColor={themeColor}
                    onThemeChange={(t) => dispatch(setTheme(t))}
                    onOpenApiSettings={() => dispatch(setModalVisibility({ modal: 'isApiSettingsModalOpen', visible: true }))}
                    onOpenGenerationSettings={() => dispatch(setModalVisibility({ modal: 'isGenerationSettingsModalOpen', visible: true }))}
                    onOpenUISettings={() => dispatch(setModalVisibility({ modal: 'isUISettingsModalOpen', visible: true }))}
                />
            )}
            
            <main className="flex-grow">
                {renderPage()}
            </main>

            <UISettingsModal
                isOpen={isUISettingsModalOpen}
                onClose={() => dispatch(setModalVisibility({ modal: 'isUISettingsModalOpen', visible: false }))}
            />

            <APISettingsModal
                isOpen={isApiSettingsModalOpen}
                onClose={() => dispatch(setModalVisibility({ modal: 'isApiSettingsModalOpen', visible: false }))}
                onSave={handleSaveApiSettings}
                initialProvider={apiSettings.apiProvider}
                initialProxySettings={apiSettings.proxySettings}
                initialProxyPresets={apiSettings.proxyPresets}
                onSavePresets={(presets) => dispatch(setProxyPresets(presets))}
                initialGeminiSettings={apiSettings.geminiSettings}
                initialGeminiApiKeys={apiSettings.geminiApiKeys}
                initialGeminiPresets={apiSettings.geminiPresets}
                onSaveGeminiApiKeys={(keys) => dispatch(setGeminiApiKeys(keys))}
                onSaveGeminiPresets={(presets) => dispatch(setGeminiPresets(presets))}
                initialReplaceAgentModels={apiSettings.replaceAgentModels}
                defaultCustomPrompt={extractCustomPromptFromSystemInstruction(apiSettings.systemInstruction || selectedCharacter?.systemInstructionTemplate)}
                themeColor={themeColor}
                onNotify={(message, type) => dispatch(showToast({ message, type }))}
            />

            {page !== 'chat' && (
                <>
                    <GenerationSettingsModal
                        isOpen={isGenerationSettingsModalOpen}
                        onClose={() => dispatch(setModalVisibility({ modal: 'isGenerationSettingsModalOpen', visible: false }))}
                        onSave={handleSaveApiSettings}
                        initialProvider={apiSettings.apiProvider}
                        initialProxySettings={apiSettings.proxySettings}
                        initialProxyPresets={apiSettings.proxyPresets}
                        initialGeminiSettings={apiSettings.geminiSettings}
                        initialGeminiPresets={apiSettings.geminiPresets}
                        initialGeminiApiKeys={apiSettings.geminiApiKeys}
                        initialReplaceAgentModels={apiSettings.replaceAgentModels}
                        initialHistoryContextTurns={apiSettings.historyContextTurns}
                        initialIncludeAllAgentResponsesInContext={apiSettings.includeAllAgentResponsesInContext}
                        initialKeepNonExistentAgentResponses={apiSettings.keepNonExistentAgentResponses}
                        initialDeleteUnfinishedGeminiSentencesOnError={apiSettings.deleteUnfinishedGeminiSentencesOnError}
                        themeColor={themeColor}
                        onLogViewerToggle={() => dispatch(setModalVisibility({ modal: 'isLogViewerVisible', visible: true }))}
                        onWorldInfoToggle={() => dispatch(setModalVisibility({ modal: 'isWorldInfoVisible', visible: true }))}
                    />
                    <WorldInfoModal
                        isVisible={isWorldInfoVisible}
                        onClose={() => dispatch(setModalVisibility({ modal: 'isWorldInfoVisible', visible: false }))}
                        active={activeWorldInfo}
                        scanDepth={DEFAULT_SCAN_DEPTH}
                        themeColor={themeColor}
                    />
                </>
            )}
            
            <Toast />
        </div>
    );
};

export default App;
