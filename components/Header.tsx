
import React, { useState, useRef, useEffect } from 'react';
import { PencilSquareIcon } from './icons/PencilSquareIcon';
import { CogIcon } from './icons/CogIcon';
import { DocumentTextIcon } from './icons/DocumentTextIcon';
import { ArrowDownTrayIcon } from './icons/ArrowDownTrayIcon';
import { ArrowUpTrayIcon } from './icons/ArrowUpTrayIcon';
import { PlusIcon } from './icons/PlusIcon';
import { ThemeSelector } from './ThemeSelector';
import { UsersIcon } from './icons/UsersIcon';
import { ServerIcon } from './icons/ServerIcon';
import { GlobeAltIcon } from './icons/GlobeAltIcon';
import { UserCircleIcon } from './icons/UserCircleIcon';
import { ChatBubbleLeftRightIcon } from './icons/ChatBubbleLeftRightIcon';
import { PaintBrushIcon } from './icons/PaintBrushIcon';
import { SparklesIcon } from './icons/SparklesIcon';

const CogHeavyIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-1.007 1.11-.952l2.347.195c.539.045.92.51.884.951l-.532 2.305a2.25 2.25 0 0 1-2.247 2.118H9.594a2.25 2.25 0 0 1-2.247-2.118L6.815 4.893c-.036-.441.345-.896.884-.951l2.347-.195ZM9.594 18.06c.09.542.56 1.007 1.11.952l2.347-.195c.539-.045.92.51.884-.951l-.532-2.305a2.25 2.25 0 0 1-2.247 2.118H9.594a2.25 2.25 0 0 1-2.247 2.118l.532 2.305c.036.441.345.896.884.951l2.347.195Zm-5.022-6.038c.09-.542.56-1.007 1.11-.952l2.347.195c.539.045.92.51.884.951l-.532 2.305a2.25 2.25 0 0 1-2.247 2.118H4.572a2.25 2.25 0 0 1-2.247-2.118l.532-2.305c.036-.441.345-.896.884-.951l2.347-.195Zm14.454 0c.09-.542.56-1.007 1.11-.952l2.347.195c.539.045.92.51.884.951l-.532 2.305a2.25 2.25 0 0 1-2.247 2.118h-2.118a2.25 2.25 0 0 1-2.247-2.118l.532-2.305c.036-.441.345-.896.884-.951l2.347-.195Z" />
    </svg>
);

interface HeaderProps {
  characterName: string;
  onNotesToggle: () => void;
  onSystemToggle: () => void;
  onSettingToggle: () => void;
  onScenarioToggle: () => void;
  // Manual scenarios (experimental) — toggleable story hooks per chat.
  activeManualScenarioCount?: number;
  onManualScenariosToggle?: () => void;
  onPersonalityToggle: () => void;
  onGameSettingsToggle: () => void;
  onUISettingsToggle: () => void;
  onApiSettingsToggle: () => void;
  onGenerationSettingsToggle: () => void;
  onCharacterTrackerToggle: () => void;
  onPersonaToggle: () => void;
  isWorldModelEnabled: boolean;
  onWorldModelToggle: () => void;
  onAgentSettingsToggle: () => void;
  onStoryBibleToggle: () => void;
  storyBibleReady: boolean;
  isLoading: boolean;
  theme: string;
  themeColor: string;
  onThemeChange: (theme: string) => void;
  onSaveGame: () => void;
  onLoadGame: () => void;
  onNewChat: () => void;
  onOpenChatsModal: () => void;
  apiProviderLabel: string;
}

const Header: React.FC<HeaderProps> = ({
    characterName,
    onNotesToggle, onSystemToggle, onSettingToggle, onScenarioToggle, activeManualScenarioCount, onManualScenariosToggle, onPersonalityToggle, onGameSettingsToggle, onUISettingsToggle, onApiSettingsToggle, onGenerationSettingsToggle,
    onCharacterTrackerToggle, onPersonaToggle, isWorldModelEnabled, onWorldModelToggle, onAgentSettingsToggle, onStoryBibleToggle, storyBibleReady, isLoading,
    theme, themeColor, onThemeChange, onSaveGame, onLoadGame, onNewChat,
    onOpenChatsModal, apiProviderLabel,
}) => {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
        if (settingsRef.current && !settingsRef.current.contains(event.target as Node)) {
            setIsSettingsOpen(false);
        }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
        document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const dropdownItemClass = `w-full text-left flex items-center gap-3 px-4 py-2 text-sm text-gray-200 hover:bg-primary-900/50 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed`;
  
  return (
    <header className="flex-shrink-0 flex flex-row flex-wrap items-center gap-2 lg:gap-3 pb-3 md:pb-4 border-b-2 border-primary-800/50">
      <div className="min-w-0 flex-grow basis-40 overflow-hidden">
        <h1 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold text-primary-500 tracking-wider truncate" style={{fontFamily: 'serif'}}>
          {characterName}
        </h1>
      </div>
      <div className="flex items-center flex-wrap gap-1.5 sm:gap-2 lg:gap-3 flex-shrink-0">
        <div className="hidden lg:block">
          <ThemeSelector currentTheme={theme} onThemeChange={onThemeChange} />
        </div>
        {/* World Model Toggle */}
        <div className={`flex items-center gap-1.5 lg:gap-2 bg-gray-800/70 border border-primary-900 rounded-lg px-1.5 sm:px-2 lg:px-3 py-1.5 sm:py-2`}>
            <label htmlFor="world-model-switch" className={`hidden xl:inline font-semibold transition-colors duration-300 text-sm ${isWorldModelEnabled ? `text-primary-400` : 'text-gray-400'}`}>
                World Model
            </label>
            <label className="toggle-switch">
                <input
                id="world-model-switch"
                type="checkbox"
                checked={isWorldModelEnabled}
                onChange={onWorldModelToggle}
                disabled={isLoading}
                />
                <span className="slider"></span>
            </label>
            <button
              onClick={onAgentSettingsToggle}
              className={`transition-colors duration-200 disabled:text-gray-600 disabled:cursor-not-allowed ${isWorldModelEnabled ? `text-primary-300 hover:enabled:text-white` : `text-gray-500 hover:enabled:text-primary-300`}`}
              aria-label="World Model Agents"
              title="World Model — Agent Graph"
            >
              <CogHeavyIcon className="h-5 w-5 lg:h-6 lg:w-6" />
            </button>
            <button
              onClick={onStoryBibleToggle}
              className={`transition-colors duration-200 disabled:text-gray-600 disabled:cursor-not-allowed ${isWorldModelEnabled && storyBibleReady ? `text-primary-300 hover:enabled:text-white` : `text-gray-500 hover:enabled:text-primary-300`}`}
              aria-label="Story Bible"
              title={storyBibleReady ? "Story Bible" : "Story Bible (will be built on first generation)"}
              disabled={!isWorldModelEnabled}
            >
              <DocumentTextIcon className="h-5 w-5 lg:h-6 lg:w-6" />
            </button>
        </div>
        {/* Provider indicator — first word of the active preset name (or
            "gemini"). Sits next to Settings so users can verify they aren't
            accidentally running a paid model when reopening a saved chat. */}
        <button
            onClick={onApiSettingsToggle}
            className="flex items-center gap-1 sm:gap-1.5 px-2 lg:px-3 py-1.5 bg-primary-900/40 border border-primary-800/70 text-primary-200 text-xs font-semibold rounded-full hover:bg-primary-800/60 hover:text-white transition-colors max-w-[100px] sm:max-w-[120px] xl:max-w-none"
            title={`Active provider: ${apiProviderLabel} — click to open API Settings`}
            aria-label={`Active provider: ${apiProviderLabel}`}
        >
            <span className="w-1.5 h-1.5 rounded-full bg-primary-400 flex-shrink-0" />
            <span className="truncate">{apiProviderLabel.split(/\s+/)[0]}</span>
        </button>
        <div className="relative" ref={settingsRef}>
            <button
                id="settings-menu-button"
                onClick={() => setIsSettingsOpen(!isSettingsOpen)}
                className={`flex items-center gap-2 px-3 py-2 bg-gray-800/70 text-primary-300 rounded-lg border border-primary-900 hover:bg-primary-900/50 hover:text-white transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary-500`}
                aria-label="Open Settings Menu"
                aria-haspopup="true"
                aria-expanded={isSettingsOpen}
                aria-controls={isSettingsOpen ? 'settings-menu' : undefined}
            >
                <CogIcon className="h-5 w-5 lg:h-6 lg:w-6" />
                <span className="hidden xl:inline">Settings</span>
            </button>
            {isSettingsOpen && (
                 <div 
                    id="settings-menu"
                    className={`absolute right-0 mt-2 w-72 origin-top-right bg-gray-800 border border-primary-700 rounded-lg shadow-lg z-20 ring-1 ring-black ring-opacity-5 focus:outline-none max-h-[80vh] overflow-y-auto custom-scrollbar`}
                    role="menu" 
                    aria-orientation="vertical" 
                    aria-labelledby="settings-menu-button"
                >
                    <div className="py-1">
                        <button onClick={() => { onOpenChatsModal(); setIsSettingsOpen(false); }} className={dropdownItemClass} role="menuitem">
                            <ChatBubbleLeftRightIcon className="h-5 w-5" /> Chats with {characterName}
                        </button>
                        <div className={`border-t border-primary-700/50 my-1`}></div>
                        <button onClick={() => { onSaveGame(); setIsSettingsOpen(false); }} className={dropdownItemClass} disabled={isLoading} role="menuitem">
                            <ArrowDownTrayIcon className="h-5 w-5" /> Save Game
                        </button>
                        <button onClick={() => { onLoadGame(); setIsSettingsOpen(false); }} className={dropdownItemClass} disabled={isLoading} role="menuitem">
                            <ArrowUpTrayIcon className="h-5 w-5" /> Load Game
                        </button>
                        <button onClick={() => { onNewChat(); setIsSettingsOpen(false); }} className={`${dropdownItemClass} text-green-400 hover:text-green-300`} disabled={isLoading} role="menuitem">
                            <PlusIcon className="h-5 w-5" /> New Chat
                        </button>
                        <div className={`border-t border-primary-700/50 my-1`}></div>
                        <button onClick={() => { onCharacterTrackerToggle(); setIsSettingsOpen(false); }} className={dropdownItemClass} role="menuitem">
                            <UsersIcon className="h-5 w-5" /> Characters
                        </button>
                        <button onClick={() => { onNotesToggle(); setIsSettingsOpen(false); }} className={dropdownItemClass} role="menuitem">
                            <PencilSquareIcon className="h-5 w-5" /> Player Notes
                        </button>
                        <button onClick={() => { onPersonaToggle(); setIsSettingsOpen(false); }} className={dropdownItemClass} role="menuitem">
                            <UserCircleIcon className="h-5 w-5" /> Chat Persona
                        </button>
                        <button onClick={() => { onSettingToggle(); setIsSettingsOpen(false); }} className={dropdownItemClass} role="menuitem">
                            <GlobeAltIcon className="h-5 w-5" /> Setting
                        </button>
                        <button onClick={() => { onScenarioToggle(); setIsSettingsOpen(false); }} className={dropdownItemClass} role="menuitem">
                            <PencilSquareIcon className="h-5 w-5" /> Scenario
                        </button>
                        {onManualScenariosToggle && (
                            <button onClick={() => { onManualScenariosToggle(); setIsSettingsOpen(false); }} className={dropdownItemClass} role="menuitem">
                                <SparklesIcon className="h-5 w-5" /> Scenarios
                                {(activeManualScenarioCount ?? 0) > 0 && (
                                    <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-primary-900/60 text-primary-300 border border-primary-800/60">
                                        {activeManualScenarioCount} on
                                    </span>
                                )}
                            </button>
                        )}
                        <button onClick={() => { onPersonalityToggle(); setIsSettingsOpen(false); }} className={dropdownItemClass} role="menuitem">
                            <UserCircleIcon className="h-5 w-5" /> Character Personality
                        </button>
                        <button onClick={() => { onSystemToggle(); setIsSettingsOpen(false); }} className={dropdownItemClass} role="menuitem">
                            <DocumentTextIcon className="h-5 w-5" /> System Prompt
                        </button>
                        <div className={`border-t border-primary-700/50 my-1`}></div>
                        <button onClick={() => { onApiSettingsToggle(); setIsSettingsOpen(false); }} className={dropdownItemClass} role="menuitem">
                            <ServerIcon className="h-5 w-5" /> API Settings
                        </button>
                        <button onClick={() => { onGenerationSettingsToggle(); setIsSettingsOpen(false); }} className={dropdownItemClass} role="menuitem">
                            <CogIcon className="h-5 w-5" /> Generation Settings
                        </button>
                        <button onClick={() => { onGameSettingsToggle(); setIsSettingsOpen(false); }} className={dropdownItemClass} role="menuitem">
                            <CogIcon className="h-5 w-5" /> App Settings
                        </button>
                        <button onClick={() => { onUISettingsToggle(); setIsSettingsOpen(false); }} className={dropdownItemClass} role="menuitem">
                            <PaintBrushIcon className="h-5 w-5" /> UI Settings
                        </button>
                    </div>
                </div>
            )}
        </div>
      </div>
    </header>
  );
};

export default Header;
