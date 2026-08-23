
import React, { useState, useEffect } from 'react';
import { XMarkIcon } from './icons/XMarkIcon';
import {
  DEFAULT_WORLD_MODEL_RPM, MIN_WORLD_MODEL_RPM, MAX_WORLD_MODEL_RPM, clampWorldModelRpm,
} from '../store/slices/settingsSlice';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (settings: {
    interval: number;
    intelligentAnalyzer: boolean;
    sendUserAvatar: boolean;
    sendCharacterAvatar: boolean;
    ignoreImages: boolean;
    editFullMessage: boolean;
    postHistoryInstruction: string;
    deleteUnfinishedGeminiSentencesOnError: boolean;
    enableAnthropicCaching: boolean;
    worldModelRpmEnabled: boolean;
    worldModelRpm: number;
  }) => void;
  initialInterval: number;
  initialIntelligentPresetAnalyzerEnabled: boolean;
  initialSendUserAvatar: boolean;
  initialSendCharacterAvatar: boolean;
  initialIgnoreImages: boolean;
  initialEditFullMessage: boolean;
  initialPostHistoryInstruction: string;
  initialDeleteUnfinishedGeminiSentencesOnError: boolean;
  initialEnableAnthropicCaching: boolean;
  initialWorldModelRpmEnabled: boolean;
  initialWorldModelRpm: number;
  themeColor: string;
  apiProvider: 'gemini' | 'proxy';
}

const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen, onClose, onSave, initialInterval,
  initialIntelligentPresetAnalyzerEnabled,
  initialSendUserAvatar, initialSendCharacterAvatar, initialIgnoreImages, initialEditFullMessage,
  initialPostHistoryInstruction,
  initialDeleteUnfinishedGeminiSentencesOnError,
  initialEnableAnthropicCaching,
  initialWorldModelRpmEnabled,
  initialWorldModelRpm,
  apiProvider,
}) => {
  const [interval, setInterval] = useState(initialInterval);
  const [intelligentAnalyzer, setIntelligentAnalyzer] = useState(initialIntelligentPresetAnalyzerEnabled);
  const [sendUserAvatar, setSendUserAvatar] = useState(initialSendUserAvatar);
  const [sendCharacterAvatar, setSendCharacterAvatar] = useState(initialSendCharacterAvatar);
  const [ignoreImages, setIgnoreImages] = useState(initialIgnoreImages);
  const [editFullMessage, setEditFullMessage] = useState(initialEditFullMessage);
  const [postHistoryInstruction, setPostHistoryInstruction] = useState(initialPostHistoryInstruction);
  const [deleteUnfinishedGeminiSentencesOnError, setDeleteUnfinishedGeminiSentencesOnError] = useState(initialDeleteUnfinishedGeminiSentencesOnError);
  const [enableAnthropicCaching, setEnableAnthropicCaching] = useState(initialEnableAnthropicCaching);
  const [worldModelRpmEnabled, setWorldModelRpmEnabled] = useState(initialWorldModelRpmEnabled);
  // Kept as a string so the field can be cleared while typing; clamped on save.
  const [worldModelRpm, setWorldModelRpm] = useState(String(initialWorldModelRpm));

  useEffect(() => {
    if (isOpen) {
      setInterval(initialInterval);
      setIntelligentAnalyzer(initialIntelligentPresetAnalyzerEnabled);
      setSendUserAvatar(initialSendUserAvatar);
      setSendCharacterAvatar(initialSendCharacterAvatar);
      setIgnoreImages(initialIgnoreImages);
      setEditFullMessage(initialEditFullMessage);
      setPostHistoryInstruction(initialPostHistoryInstruction);
      setDeleteUnfinishedGeminiSentencesOnError(initialDeleteUnfinishedGeminiSentencesOnError);
      setEnableAnthropicCaching(initialEnableAnthropicCaching);
      setWorldModelRpmEnabled(initialWorldModelRpmEnabled);
      setWorldModelRpm(String(initialWorldModelRpm));
    }
  }, [initialInterval, initialIntelligentPresetAnalyzerEnabled, initialSendUserAvatar, initialSendCharacterAvatar, initialIgnoreImages, initialEditFullMessage, initialPostHistoryInstruction, initialDeleteUnfinishedGeminiSentencesOnError, initialEnableAnthropicCaching, initialWorldModelRpmEnabled, initialWorldModelRpm, isOpen]);

  if (!isOpen) return null;

  const handleSave = () => {
    onSave({
        interval,
        intelligentAnalyzer,
        sendUserAvatar,
        sendCharacterAvatar,
        ignoreImages,
        editFullMessage,
        postHistoryInstruction,
        deleteUnfinishedGeminiSentencesOnError,
        enableAnthropicCaching,
        worldModelRpmEnabled,
        worldModelRpm: clampWorldModelRpm(parseInt(worldModelRpm, 10)),
    });
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-2 sm:p-4">
      <div className={`bg-gray-900 max-w-2xl w-full max-h-[95vh] overflow-y-auto p-4 sm:p-8 rounded-2xl ring-2 ring-primary-700 shadow-2xl shadow-primary-500/20 relative custom-scrollbar`} onClick={(e) => e.stopPropagation()}>
        <h2 className={`text-2xl sm:text-3xl font-bold text-white pb-2 mb-4`} style={{fontFamily: 'serif'}}>App Settings</h2>

        <div className={`my-6 p-4 border border-primary-800 rounded-lg bg-gray-800/30`}>
          <h3 className={`text-lg font-semibold text-primary-300 mb-3`}>Visual Settings</h3>
          <div className="space-y-4">
             <div className={`flex items-center justify-between transition-opacity duration-200 ${ignoreImages ? 'opacity-50 pointer-events-none' : ''}`}>
                <label className="flex-grow pr-4">
                    <span className="font-semibold text-white">Send User Avatar</span>
                    <p className={`text-primary-200/70 text-sm mt-1`}>
                        Automatically send your persona's image to the model for visual context.
                    </p>
                </label>
                <label className="toggle-switch flex-shrink-0">
                    <input
                        type="checkbox"
                        checked={sendUserAvatar}
                        onChange={() => setSendUserAvatar(!sendUserAvatar)}
                        disabled={ignoreImages}
                    />
                    <span className="slider"></span>
                </label>
            </div>
            <div className={`flex items-center justify-between transition-opacity duration-200 ${ignoreImages ? 'opacity-50 pointer-events-none' : ''}`}>
                <label className="flex-grow pr-4">
                    <span className="font-semibold text-white">Send Character Avatar</span>
                    <p className={`text-primary-200/70 text-sm mt-1`}>
                        Automatically send the character's image to the model for visual context.
                    </p>
                </label>
                <label className="toggle-switch flex-shrink-0">
                    <input
                        type="checkbox"
                        checked={sendCharacterAvatar}
                        onChange={() => setSendCharacterAvatar(!sendCharacterAvatar)}
                        disabled={ignoreImages}
                    />
                    <span className="slider"></span>
                </label>
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-gray-700/50">
                <label className="flex-grow pr-4">
                    <span className="font-semibold text-white">Ignore All Images</span>
                    <p className={`text-primary-200/70 text-sm mt-1`}>
                        Prevent sending ANY images (uploads or avatars) to the model. Useful for text-only models to avoid errors.
                    </p>
                </label>
                <label className="toggle-switch flex-shrink-0">
                    <input
                        type="checkbox"
                        checked={ignoreImages}
                        onChange={() => setIgnoreImages(!ignoreImages)}
                    />
                    <span className="slider"></span>
                </label>
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-gray-700/50">
                <label className="flex-grow pr-4">
                    <span className="font-semibold text-white">Edit Full Message (including thoughts)</span>
                    <p className={`text-primary-200/70 text-sm mt-1`}>
                        When editing AI responses, include the model's internal thoughts (&lt;think&gt;) in the editor.
                    </p>
                </label>
                <label className="toggle-switch flex-shrink-0">
                    <input
                        type="checkbox"
                        checked={editFullMessage}
                        onChange={() => setEditFullMessage(!editFullMessage)}
                    />
                    <span className="slider"></span>
                </label>
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-gray-700/50">
                <label className="flex-grow pr-4">
                    <span className="font-semibold text-white">Enable Anthropic Caching</span>
                    <p className={`text-primary-200/70 text-sm mt-1`}>
                        Add prompt cache breakpoints for Anthropic models (via OpenRouter). Cache-write tokens cost +25%, so only enable if your conversations are long enough for cache reads to offset the initial write cost.
                    </p>
                </label>
                <label className="toggle-switch flex-shrink-0">
                    <input
                        type="checkbox"
                        checked={enableAnthropicCaching}
                        onChange={() => setEnableAnthropicCaching(!enableAnthropicCaching)}
                    />
                    <span className="slider"></span>
                </label>
            </div>
          </div>
        </div>

        <div className={`my-6 p-4 border border-primary-800 rounded-lg bg-gray-800/30`}>
          <h3 className={`text-lg font-semibold text-primary-300 mb-2`}>Post History</h3>
          <p className={`text-primary-200/70 text-sm mb-3`}>
              Optional text appended after the light-mode story history. It is visible, editable,
              saved with this chat, and never sent when empty. Supports {'{{user}}'} and {'{{char}}'}.
          </p>
          <label htmlFor="post-history-instruction" className="sr-only">Post History instruction</label>
          <textarea
              id="post-history-instruction"
              value={postHistoryInstruction}
              onChange={(event) => setPostHistoryInstruction(event.target.value)}
              rows={4}
              placeholder="Empty — nothing is appended after history"
              className="w-full resize-y rounded-md border border-gray-700 bg-gray-950/70 p-3 text-sm text-white placeholder:text-gray-500 focus:border-primary-500 focus:outline-none"
          />
          {postHistoryInstruction.trim() && (
              <p className="text-xs text-amber-300/80 mt-2 leading-snug">
                  Active: this exact text will be added to every light-mode generation in this chat.
              </p>
          )}
        </div>

        <div className={`my-6 p-4 border border-primary-800 rounded-lg bg-gray-800/30`}>
          <h3 className={`text-lg font-semibold text-primary-300 mb-3`}>World Model Rate Limit</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
                <label htmlFor="wm-rpm-switch" className="flex-grow pr-4">
                    <span className="font-semibold text-white">Throttle World Model requests</span>
                    <p className={`text-primary-200/70 text-sm mt-1`}>
                        World Model fires many requests per turn. This sends at most N requests, then
                        waits ~2&nbsp;minutes before the next batch, so providers with per-minute limits
                        (e.g. Vercel free tier) don't reject the turn. No effect in light mode.
                    </p>
                </label>
                <label className="toggle-switch flex-shrink-0">
                    <input
                        id="wm-rpm-switch"
                        type="checkbox"
                        checked={worldModelRpmEnabled}
                        onChange={() => setWorldModelRpmEnabled(!worldModelRpmEnabled)}
                    />
                    <span className="slider"></span>
                </label>
            </div>
            <div className={`transition-opacity duration-200 ${worldModelRpmEnabled ? '' : 'opacity-50 pointer-events-none'}`}>
                <label htmlFor="wm-rpm-input" className="block font-semibold text-white mb-1">Requests per batch</label>
                <div className="flex items-center gap-3">
                    <input
                        id="wm-rpm-input"
                        type="number"
                        inputMode="numeric"
                        value={worldModelRpm}
                        onChange={(e) => setWorldModelRpm(e.target.value)}
                        onBlur={() => setWorldModelRpm(prev => {
                            const n = parseInt(prev, 10);
                            return String(Number.isNaN(n) ? DEFAULT_WORLD_MODEL_RPM : clampWorldModelRpm(n));
                        })}
                        min={MIN_WORLD_MODEL_RPM}
                        max={MAX_WORLD_MODEL_RPM}
                        disabled={!worldModelRpmEnabled}
                        className={`w-28 bg-gray-800 border border-gray-700 rounded-md text-white p-3 text-center text-xl font-mono disabled:opacity-60`}
                    />
                    <span className="text-sm text-gray-400">per batch, then ~2&nbsp;min rest (default {DEFAULT_WORLD_MODEL_RPM})</span>
                </div>
            </div>
          </div>
        </div>

        {apiProvider === 'gemini' && (
          <div className={`my-6 p-4 border border-primary-800 rounded-lg bg-gray-800/30`}>
            <h3 className={`text-lg font-semibold text-primary-300 mb-3`}>Gemini Error Handling</h3>
            <div className="flex items-center justify-between">
                <label htmlFor="app-gemini-delete-unfinished-switch" className="flex-grow pr-4">
                    <span className="font-semibold text-white">Delete unfinished sentences if API error</span>
                    <p className={`text-primary-200/70 text-sm mt-1`}>
                        Off keeps partial Gemini text after an API error and only removes a generated message if no text appeared.
                    </p>
                </label>
                <label className="toggle-switch flex-shrink-0">
                    <input
                        id="app-gemini-delete-unfinished-switch"
                        type="checkbox"
                        checked={deleteUnfinishedGeminiSentencesOnError}
                        onChange={() => setDeleteUnfinishedGeminiSentencesOnError(!deleteUnfinishedGeminiSentencesOnError)}
                    />
                    <span className="slider"></span>
                </label>
            </div>
          </div>
        )}

        <div className="mb-8">
          <label htmlFor="autosave-interval" className={`block text-lg font-semibold text-primary-300 mb-2`}>Autosave Interval</label>
          <p className={`text-primary-200/70 mb-3 text-sm`}>
              Automatically save progress to local storage. <strong className={`text-primary-400`}>Set to 0 to disable.</strong>
          </p>
          <div className="flex items-center gap-4">
            <input id="autosave-interval" type="number" value={interval} onChange={(e) => setInterval(Math.max(0, parseInt(e.target.value, 10) || 0))} min="0" className={`w-full bg-gray-800 border border-gray-700 rounded-md text-white p-3 text-center text-xl font-mono`} />
            <span className="text-lg text-gray-400">minutes</span>
          </div>
           {interval === 0 && <p className={`text-sm text-center text-primary-300/80 mt-2 animate-pulse`}>(Autosave is disabled)</p>}
        </div>

        <div className="flex justify-end gap-4 flex-wrap">
          <button onClick={onClose} className="px-5 py-2 bg-gray-700 text-white font-semibold rounded-md border border-gray-600 hover:bg-gray-600 transition-all duration-200">Cancel</button>
          <button onClick={handleSave} className={`px-5 py-2 bg-primary-800 text-white font-semibold rounded-md border border-primary-600 hover:bg-primary-700 transition-all duration-200`}>Save Settings</button>
        </div>
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-500 hover:text-white transition-colors" aria-label="Close modal"><XMarkIcon className="h-8 w-8" /></button>
      </div>
    </div>
  );
};

export default SettingsModal;
