import React from 'react';
import { XMarkIcon } from './icons/XMarkIcon';
import { ThemeSelector } from './ThemeSelector';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import {
  setTheme, setChatTextPreset, setChatFontSize, setChatMaxWidthRem, setShowImageAttachButton,
  DEFAULT_CHAT_WIDTH_REM, MIN_CHAT_WIDTH_REM,
  DEFAULT_CHAT_FONT_SIZE_PX, MIN_CHAT_FONT_SIZE_PX, MAX_CHAT_FONT_SIZE_PX,
} from '../store/slices/settingsSlice';
import {
  CHAT_TEXT_PRESETS, getChatTextPreset, applyInlineStoryMarkup, CHAT_TEXT_PRESET_PREVIEW,
} from '../services/common/chatTextPresets';

interface UISettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// Unlike the Save/Cancel settings modals, every control here applies instantly
// (like the header theme shortcut always did) and persists through the settings
// middleware — visual tweaks are much easier to judge live on the transcript.
const UISettingsModal: React.FC<UISettingsModalProps> = ({ isOpen, onClose }) => {
  const dispatch = useAppDispatch();
  const theme = useAppSelector(state => state.settings.theme);
  const chatTextPresetId = useAppSelector(state => state.settings.chatTextPresetId);
  const chatFontSizePx = useAppSelector(state => state.settings.chatFontSizePx);
  const chatMaxWidthRem = useAppSelector(state => state.settings.chatMaxWidthRem);
  const showImageAttachButton = useAppSelector(state => state.settings.showImageAttachButton);

  if (!isOpen) return null;

  const activePreset = getChatTextPreset(chatTextPresetId);
  const isFullWidth = chatMaxWidthRem >= DEFAULT_CHAT_WIDTH_REM;
  const isDefaultFontSize = chatFontSizePx === DEFAULT_CHAT_FONT_SIZE_PX;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-2 sm:p-4">
      <div className="bg-gray-900 max-w-xl w-full max-h-[95vh] overflow-y-auto p-4 sm:p-8 rounded-2xl ring-2 ring-primary-700 shadow-2xl shadow-primary-500/20 relative custom-scrollbar" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-2xl sm:text-3xl font-bold text-white pb-2 mb-1" style={{fontFamily: 'serif'}}>UI Settings</h2>
        <p className="text-sm text-gray-400 mb-4">Changes apply instantly and are saved on this device.</p>

        <div className="my-4 p-4 border border-primary-800 rounded-lg bg-gray-800/30">
          <h3 className="text-lg font-semibold text-primary-300 mb-1">Theme Color</h3>
          <p className="text-primary-200/70 text-sm mb-3">Accent color used across the whole app.</p>
          <ThemeSelector currentTheme={theme} onThemeChange={(t) => dispatch(setTheme(t))} />
        </div>

        <div className="my-4 p-4 border border-primary-800 rounded-lg bg-gray-800/30">
          <h3 className="text-lg font-semibold text-primary-300 mb-1">Text Style</h3>
          <p className="text-primary-200/70 text-sm mb-3">
            How narration, *emphasis* and "speech" are colored in the chat. Presets are defined in <code className="text-primary-300">constants.ts</code>.
          </p>
          <div className="space-y-2" role="radiogroup" aria-label="Chat text preset">
            {CHAT_TEXT_PRESETS.map(preset => {
              const isActive = preset.id === activePreset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  onClick={() => dispatch(setChatTextPreset(preset.id))}
                  className={`w-full text-left p-3 rounded-lg border transition-colors ${isActive ? 'border-primary-500 bg-primary-900/30' : 'border-gray-700 bg-gray-800/40 hover:border-primary-700'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-white">{preset.name}</span>
                    {isActive && <span className="text-xs font-semibold text-primary-300 flex-shrink-0">Active</span>}
                  </div>
                  <p className="text-sm text-primary-200/70 mt-0.5">{preset.description}</p>
                </button>
              );
            })}
          </div>
          <div className="mt-3 p-3 rounded-lg bg-black/40 border border-gray-700">
            <p className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-1.5">Preview</p>
            <div
              className="leading-relaxed"
              style={{ color: activePreset.textColor, fontSize: `${chatFontSizePx}px` }}
              dangerouslySetInnerHTML={{ __html: applyInlineStoryMarkup(CHAT_TEXT_PRESET_PREVIEW, activePreset) }}
            />
          </div>
        </div>

        <div className="my-4 p-4 border border-primary-800 rounded-lg bg-gray-800/30">
          <div className="flex items-center justify-between mb-1">
            <label htmlFor="ui-chat-font-size" className="text-lg font-semibold text-primary-300">Text Size</label>
            <span className={`text-sm font-mono px-2 py-0.5 rounded bg-gray-800 border border-gray-700 ${isDefaultFontSize ? 'text-primary-300' : 'text-white'}`}>
              {chatFontSizePx}px
            </span>
          </div>
          <p className="text-primary-200/70 text-sm mb-3">Font size of messages in the transcript.</p>
          <div className="flex items-center gap-3">
            <input
              id="ui-chat-font-size"
              type="range"
              min={MIN_CHAT_FONT_SIZE_PX}
              max={MAX_CHAT_FONT_SIZE_PX}
              step={1}
              value={chatFontSizePx}
              onChange={(e) => dispatch(setChatFontSize(parseInt(e.target.value, 10)))}
              className="flex-grow accent-primary-500 h-2 cursor-pointer"
            />
            <button
              type="button"
              onClick={() => dispatch(setChatFontSize(DEFAULT_CHAT_FONT_SIZE_PX))}
              disabled={isDefaultFontSize}
              className="flex-shrink-0 text-xs px-3 py-1.5 rounded-md bg-gray-800 border border-gray-700 text-primary-300 hover:bg-primary-900/30 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Reset
            </button>
          </div>
        </div>

        <div className="my-4 p-4 border border-primary-800 rounded-lg bg-gray-800/30">
          <div className="flex items-center justify-between mb-1">
            <label htmlFor="ui-chat-width" className="text-lg font-semibold text-primary-300">Chat Width</label>
            <span className={`text-sm font-mono px-2 py-0.5 rounded bg-gray-800 border border-gray-700 ${isFullWidth ? 'text-primary-300' : 'text-white'}`}>
              {isFullWidth ? 'Full' : `${chatMaxWidthRem}rem`}
            </span>
          </div>
          <p className="text-primary-200/70 text-sm mb-3">
            Narrow the conversation column for a centered, Janitor-style layout. Drag right for full width. (No effect on small screens.)
          </p>
          <div className="flex items-center gap-3">
            <input
              id="ui-chat-width"
              type="range"
              min={MIN_CHAT_WIDTH_REM}
              max={DEFAULT_CHAT_WIDTH_REM}
              step={2}
              value={chatMaxWidthRem}
              onChange={(e) => dispatch(setChatMaxWidthRem(parseInt(e.target.value, 10)))}
              className="flex-grow accent-primary-500 h-2 cursor-pointer"
            />
            <button
              type="button"
              onClick={() => dispatch(setChatMaxWidthRem(DEFAULT_CHAT_WIDTH_REM))}
              disabled={isFullWidth}
              className="flex-shrink-0 text-xs px-3 py-1.5 rounded-md bg-gray-800 border border-gray-700 text-primary-300 hover:bg-primary-900/30 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Reset
            </button>
          </div>
        </div>

        <div className="my-4 p-4 border border-primary-800 rounded-lg bg-gray-800/30">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <h3 className="text-lg font-semibold text-primary-300">Image Attach Button</h3>
              <p className="text-primary-200/70 text-sm mt-0.5">
                Show the image button in the message bar. Off by default — you can still paste an image straight into the input either way.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={showImageAttachButton}
              onClick={() => dispatch(setShowImageAttachButton(!showImageAttachButton))}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-gray-900 ${showImageAttachButton ? 'bg-primary-600' : 'bg-gray-600'}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${showImageAttachButton ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>
        </div>

        <div className="flex justify-end">
          <button onClick={onClose} className="px-5 py-2 bg-primary-800 text-white font-semibold rounded-md border border-primary-600 hover:bg-primary-700 transition-all duration-200">Done</button>
        </div>
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-500 hover:text-white transition-colors" aria-label="Close modal"><XMarkIcon className="h-8 w-8" /></button>
      </div>
    </div>
  );
};

export default UISettingsModal;
