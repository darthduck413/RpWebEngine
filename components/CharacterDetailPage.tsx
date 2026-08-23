
import React, { useState, useEffect } from 'react';
import { Character, LoreEntry, Setting } from '../types';
import { ArrowLeftIcon } from './icons/ArrowLeftIcon';
import { ChevronDownIcon } from './icons/ChevronDownIcon';
import { ChevronUpIcon } from './icons/ChevronUpIcon';
import { LockClosedIcon } from './icons/LockClosedIcon';
import { CheckCircleIcon } from './icons/CheckCircleIcon';
import { ChatBubbleLeftRightIcon } from './icons/ChatBubbleLeftRightIcon';
import { storageService, ChatSummary } from '../services/storage';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { DEFAULT_PERSONA_AVATAR } from '../constants';
import { setPage } from '../store/slices/uiSlice';
import { selectActiveWorldInfo, DEFAULT_SCAN_DEPTH } from '../services/common/worldInfo';

interface AccordionProps {
  title: string;
  children: React.ReactNode;
  themeColor: string;
  defaultOpen?: boolean;
}

const Accordion: React.FC<AccordionProps> = ({ title, children, themeColor, defaultOpen = false }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className={`border-b border-primary-800/50`}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex justify-between items-center py-4 text-left"
        aria-expanded={isOpen}
      >
        <h3 className="font-semibold text-lg text-gray-200">{title}</h3>
        {isOpen ? <ChevronUpIcon className="w-5 h-5 text-gray-400" /> : <ChevronDownIcon className="w-5 h-5 text-gray-400" />}
      </button>
      {isOpen && (
        <div className={`pb-4 prose prose-invert prose-sm prose-theme-colors max-w-none`}>
          {children}
        </div>
      )}
    </div>
  );
};

interface SelectableItemProps {
    title?: string;
    content: string;
    isSelected: boolean;
    onSelect: () => void;
    themeColor: string;
}

const SelectableItem: React.FC<SelectableItemProps> = ({ title, content, isSelected, onSelect, themeColor }) => (
    <div 
        onClick={onSelect}
        className={`p-4 my-2 rounded-lg cursor-pointer transition-all duration-200 border-2 relative ${isSelected ? `border-primary-600 bg-primary-900/40` : `border-gray-700/50 bg-gray-800/40 hover:bg-gray-700/40 hover:border-gray-600`}`}
    >
        {title && <h4 className="font-semibold text-white mb-2">{title}</h4>}
        <p className="text-gray-300 whitespace-pre-wrap">{content}</p>
        {isSelected && (
            <div className={`absolute top-2 right-2 text-primary-400`}>
                <CheckCircleIcon className="w-6 h-6" />
            </div>
        )}
    </div>
);


interface CharacterDetailPageProps {
  character: Character;
  onStartChat: (startOptions: { setting: string; firstMessageIndex: number; }) => void;
  onContinueChat: (chatId: string) => void;
  onBack: () => void;
  themeColor: string;
  theme: string;
  onThemeChange: (theme: string) => void;
}

const CharacterDetailPage: React.FC<CharacterDetailPageProps> = ({ character, onStartChat, onContinueChat, onBack, themeColor, theme, onThemeChange }) => {
  const dispatch = useAppDispatch();
  const { personas, activePersonaId } = useAppSelector(state => state.personas);
  const activePersona = personas.find(p => p.id === activePersonaId);

  const [selectedFirstMessageIndex, setSelectedFirstMessageIndex] = useState(0);
  const [selectedSetting, setSelectedSetting] = useState<Setting>(character.availableSettings?.[0] ?? { name: 'Default Setting', content: character.setting });
  const [latestChat, setLatestChat] = useState<ChatSummary | null>(null);

  // Sync state with props when character changes to prevent stale data
  useEffect(() => {
      setSelectedFirstMessageIndex(0);
      // Ensure we have at least one setting to select
      const initialSettings = character.availableSettings && character.availableSettings.length > 0
        ? character.availableSettings
        : [{ name: 'Default Setting', content: character.setting }];

      setSelectedSetting(initialSettings[0]);
  }, [character]);

  useEffect(() => {
      const chats = storageService.getChatsForCharacter(character.id);
      if (chats.length > 0) {
        setLatestChat(chats[0]);
      } else {
        setLatestChat(null);
      }
  }, [character.id]);


  const allFirstMessages = character.firstMessages ?? [];
  const selectedFirstMessage = allFirstMessages[selectedFirstMessageIndex]?.text ?? allFirstMessages[0]?.text ?? '';
  // Ensure we use the full list of available settings, falling back to the main setting if empty
  const allSettings = (character.availableSettings && character.availableSettings.length > 0)
    ? character.availableSettings
    : [{ name: 'Default Setting', content: character.setting }];

  // Resolve lore entries linked to the currently-selected first message.
  // Preview only — actual injection (into characterPersonality) happens in ChatPage.
  const selectedLoreIds = allFirstMessages[selectedFirstMessageIndex]?.loreIds ?? [];
  const selectedLoreEntries: LoreEntry[] = selectedLoreIds
    .map(id => character.loreBook?.find(e => e.id === id))
    .filter((e): e is LoreEntry => !!e);

  const countTokens = (text: string) => text.split(/\s+/).filter(Boolean).length;
  const characterLoreEntries = selectedLoreEntries.filter(e => e.type === 'character');
  const scenarioLoreEntries = selectedLoreEntries.filter(e => e.type === 'scenario');
  const settingLoreEntries = selectedLoreEntries.filter(e => e.type === 'setting');
  const characterLoreTokens = characterLoreEntries.reduce((acc, e) => acc + countTokens(e.content), 0);
  const scenarioLoreTokens = scenarioLoreEntries.reduce((acc, e) => acc + countTokens(e.content), 0);
  const settingLoreTokens = settingLoreEntries.reduce((acc, e) => acc + countTokens(e.content), 0);
  const personalityTokens = countTokens(character.personality) + characterLoreTokens;
  const baseScenarioText = character.scenario ?? '';
  const scenarioTokens = countTokens(baseScenarioText) + scenarioLoreTokens;
  const settingTokens = countTokens(selectedSetting.content) + settingLoreTokens;
  const selectedFirstMessageTokens = countTokens(selectedFirstMessage);

  const normalizedScenario = selectedSetting.content.trim();
  const normalizedPersonality = character.personality.trim();

  const totalDefinitionTokens = personalityTokens + selectedFirstMessageTokens + scenarioTokens + settingTokens;

  // Dynamic World Info that THIS greeting would trigger on the first turn
  // (always-on entries like a cast index + any keyword profiles its text mentions).
  // Greeting-bound loreIds are already counted above, so they're passed as
  // alreadyComposed to avoid double-counting. Estimate only — recomputes if you
  // pick a different greeting; we don't persist the choice.
  const firstTurnWorldInfo = selectActiveWorldInfo(
    character.loreBook,
    [{ id: 'preview', text: selectedFirstMessage, isPlayer: false }],
    undefined,
    [character.personality, selectedSetting.content, character.scenario ?? '', ...selectedLoreEntries.map(e => e.content)],
    DEFAULT_SCAN_DEPTH,
  );
  const worldInfoTokens = firstTurnWorldInfo.reduce((acc, a) => acc + countTokens(a.entry.content), 0);
  const firstTurnEstimateTokens = totalDefinitionTokens + worldInfoTokens;

  const handleStartChatClick = () => {
    onStartChat({
        setting: selectedSetting.content,
        firstMessageIndex: selectedFirstMessageIndex,
    });
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white flex justify-center p-4 sm:p-6 lg:p-8">
      <div className="w-full max-w-6xl mx-auto">
        <div className="mb-6 flex justify-between items-center">
            <button
            onClick={onBack}
            className={`flex items-center gap-2 text-primary-300 hover:text-white transition-colors duration-200`}
            aria-label="Back to character selection"
            >
            <ArrowLeftIcon className="w-6 h-6" />
            <span className="font-semibold">Back to Characters</span>
            </button>
        </div>
        <div className="flex flex-col md:flex-row gap-8">
          {/* Left Column - Actions */}
          <div className="w-full md:w-1/3 flex-shrink-0 flex flex-col gap-6">
            <div className="relative group rounded-xl overflow-hidden shadow-2xl shadow-black/50">
                <img src={character.image} alt={character.name} className="w-full aspect-[3/4] object-cover" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-80"></div>
            </div>

            <div className="flex flex-col gap-3">
                {latestChat && (
                    <button 
                        onClick={() => onContinueChat(latestChat.id)}
                        className={`group relative w-full py-4 px-4 bg-primary-600 hover:bg-primary-500 text-white rounded-xl shadow-lg shadow-primary-900/30 transition-all duration-200 overflow-hidden flex flex-col items-center justify-center gap-1`}
                    >
                         <div className="flex items-center gap-2 font-bold text-lg z-10">
                            <ChatBubbleLeftRightIcon className="w-5 h-5" />
                            Continue Latest Chat
                         </div>
                         <span className={`text-xs text-primary-200 font-medium z-10`}>
                             {new Date(latestChat.timestamp).toLocaleDateString()} • {latestChat.turnCount} turns
                         </span>
                         <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700"></div>
                    </button>
                )}

                <button 
                    onClick={handleStartChatClick} 
                    className={`w-full py-3 px-4 font-semibold text-gray-200 bg-gray-800 border border-gray-700 rounded-xl hover:bg-gray-700 hover:text-white hover:border-gray-600 transition-all duration-200`}
                >
                    Start New Chat
                </button>
            </div>

            {/* Proxy Visual - Displaying Active Persona */}
            <div 
                onClick={() => dispatch(setPage('personas'))}
                className="group flex items-center justify-center gap-6 py-4 border-2 border-dashed border-blue-500/30 rounded-lg p-4 bg-gray-800/20 cursor-pointer hover:bg-gray-800/40 hover:border-blue-500/50 transition-all relative"
                role="button"
                aria-label="Change Persona"
                title="Click to change active persona"
            >
                 <div className="flex flex-col items-center gap-2">
                     <div className="w-16 h-16 rounded-lg overflow-hidden border-2 border-gray-600 shadow-lg group-hover:border-blue-400 transition-colors">
                         <img 
                            src={activePersona?.avatar || DEFAULT_PERSONA_AVATAR} 
                            alt={activePersona?.name || "User"} 
                            className="w-full h-full object-cover" 
                         />
                     </div>
                     <span className="text-xs text-gray-400 font-semibold uppercase tracking-wide max-w-[80px] truncate text-center group-hover:text-blue-300 transition-colors">
                        {activePersona?.name || "User"}
                     </span>
                 </div>
                 
                 <div className={`text-primary-500 animate-pulse`}>
                    <ChatBubbleLeftRightIcon className="w-6 h-6" />
                 </div>
                 
                 <div className="flex flex-col items-center gap-2">
                     <div className={`w-16 h-16 rounded-lg overflow-hidden border-2 border-primary-500 shadow-lg shadow-primary-500/20`}>
                         <img src={character.image} alt="Char" className="w-full h-full object-cover" />
                     </div>
                     <span className={`text-primary-400 text-xs font-semibold uppercase tracking-wide`}>World</span>
                 </div>

                 <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                    <span className="bg-black/80 text-white text-xs font-bold px-3 py-1 rounded-full shadow-xl backdrop-blur-sm border border-gray-600">Change Persona</span>
                 </div>
            </div>

          </div>

          {/* Right Column - Details */}
          <div className="w-full md:w-2/3">
            <div className="mb-6">
                <h1 className={`text-4xl sm:text-5xl font-black text-white mb-2 tracking-tight`} style={{fontFamily: 'serif'}}>{character.name}</h1>
                {character.tags && character.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-3">
                        {character.tags.map(tag => (
                            <span key={tag} className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-gray-800 text-gray-300 border border-gray-700">
                                {tag}
                            </span>
                        ))}
                    </div>
                )}
            </div>

            <div className="mt-8">
               <div className={`flex items-center gap-3 text-xs font-bold text-primary-400/80 uppercase tracking-widest mb-2 px-1`}>
                    <span>Character Definition</span>
                    <div className={`h-px flex-grow bg-primary-900/50`}></div>
                    <span>{totalDefinitionTokens} Tokens</span>
              </div>
              <div className="flex items-center justify-between gap-3 text-[11px] text-gray-500 mb-3 px-1">
                    <span title="Estimate of what's sent to the model on the first turn for the selected greeting: the definition above plus the World Info this greeting's text triggers (always-on entries + keyword profiles it mentions). Changes per greeting — just an estimate.">
                      Est. first-turn send{worldInfoTokens > 0 ? ` · incl. ${firstTurnWorldInfo.length} World Info ${firstTurnWorldInfo.length === 1 ? 'entry' : 'entries'} (~${worldInfoTokens})` : ''}
                    </span>
                    <span className="text-gray-400 font-semibold">~{firstTurnEstimateTokens} tokens</span>
              </div>

              <div className={`bg-gray-900/40 border border-gray-800 p-1 rounded-xl overflow-hidden`}>
                   <Accordion title={`PERSONALITY (${personalityTokens} TOKENS)`} themeColor={themeColor}>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">{character.personality.replace(/\+/g, ' ')}</p>
                  </Accordion>

                   <Accordion title={`FIRST MESSAGE (${selectedFirstMessageTokens} TOKENS)`} themeColor={themeColor}>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">{selectedFirstMessage}</p>
                  </Accordion>

                  {selectedLoreEntries.length > 0 && (
                    <Accordion
                      title={`LORE — ${selectedLoreEntries.map(e => e.name).join(', ')}`}
                      themeColor={themeColor}
                    >
                      <p className="text-xs text-gray-400 mb-3">
                        Auto-injected with this first message. Stays dynamic while the chat is empty — locks in once you send your first reply. Character entries land in Personality, Scenario entries in Scenario, Setting entries in Setting (world / location).
                      </p>
                      {characterLoreEntries.length > 0 && (
                        <div className="mb-4">
                          <h5 className="text-[10px] font-bold uppercase tracking-widest text-primary-400/80 mb-2 px-1">Characters</h5>
                          {characterLoreEntries.map(entry => (
                            <div key={entry.id} className="mb-3 last:mb-0 p-3 rounded-lg bg-gray-800/40 border border-gray-700/50">
                              <h4 className="font-semibold text-white mb-2">{entry.name}</h4>
                              <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-300">{entry.content}</p>
                            </div>
                          ))}
                        </div>
                      )}
                      {scenarioLoreEntries.length > 0 && (
                        <div className="mb-4">
                          <h5 className="text-[10px] font-bold uppercase tracking-widest text-primary-400/80 mb-2 px-1">Scenario</h5>
                          {scenarioLoreEntries.map(entry => (
                            <div key={entry.id} className="mb-3 last:mb-0 p-3 rounded-lg bg-gray-800/40 border border-gray-700/50">
                              <h4 className="font-semibold text-white mb-2">{entry.name}</h4>
                              <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-300">{entry.content}</p>
                            </div>
                          ))}
                        </div>
                      )}
                      {settingLoreEntries.length > 0 && (
                        <div>
                          <h5 className="text-[10px] font-bold uppercase tracking-widest text-primary-400/80 mb-2 px-1">Setting (World / Location)</h5>
                          {settingLoreEntries.map(entry => (
                            <div key={entry.id} className="mb-3 last:mb-0 p-3 rounded-lg bg-gray-800/40 border border-gray-700/50">
                              <h4 className="font-semibold text-white mb-2">{entry.name}</h4>
                              <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-300">{entry.content}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </Accordion>
                  )}

                  <Accordion title={`SETTINGS (${allSettings.length})`} themeColor={themeColor} defaultOpen={false}>
                      {allSettings.map((setting, index) => (
                        <SelectableItem
                          key={index}
                          title={setting.name}
                          content={setting.content}
                          isSelected={selectedSetting.content === setting.content} // Compare content or name if name is unique
                          onSelect={() => setSelectedSetting(setting)}
                          themeColor={themeColor}
                        />
                      ))}
                  </Accordion>

                  {allFirstMessages.length > 1 && (
                     <Accordion title={`ALTERNATIVE FIRST MESSAGES (${allFirstMessages.length})`} themeColor={themeColor}>
                        {allFirstMessages.map((message, index) => (
                           <SelectableItem
                                key={index}
                                title={index === 0 ? 'Primary Greeting' : `Alternative Greeting ${index}`}
                                content={message.text}
                                isSelected={selectedFirstMessageIndex === index}
                                onSelect={() => setSelectedFirstMessageIndex(index)}
                                themeColor={themeColor}
                            />
                        ))}
                    </Accordion>
                  )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CharacterDetailPage;
