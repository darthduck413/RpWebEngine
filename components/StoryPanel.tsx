
import React, { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react';
import { TrashIcon } from './icons/TrashIcon';
import { PencilSquareIcon } from './icons/PencilSquareIcon';
import { CheckCircleIcon } from './icons/CheckCircleIcon';
import { StoryTurn } from '../types';
import AgentResponsesView from './AgentResponsesView';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { getChatTextPreset, applyInlineStoryMarkup } from '../services/common/chatTextPresets';
import { switchBranch } from '../store/thunks/gameThunks';
import { XMarkIcon } from './icons/XMarkIcon';
import { ChevronDownIcon } from './icons/ChevronDownIcon';
import { ChevronLeftIcon } from './icons/ChevronLeftIcon';
import { ChevronRightIcon } from './icons/ChevronRightIcon';
import { ArrowPathIcon } from './icons/ArrowPathIcon';
import { EllipsisHorizontalIcon } from './icons/EllipsisHorizontalIcon';
import { ChevronDoubleRightIcon } from './icons/ChevronDoubleRightIcon';
import { splitThinkingContent } from '../services/common/thinking';
import { INLINE_IMAGE_RE } from '../services/common/inlineImages';
import ImageViewer, { ImageViewerHandle } from './ImageViewer';

const LightBulbIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 0 0 1.5-.189m-1.5.189a6.01 6.01 0 0 1-1.5-.189m3.75 7.478a12.06 12.06 0 0 1-4.5 0m3.75 2.383a14.406 14.406 0 0 1-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 1 0-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
    </svg>
);

const ClipboardIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75h-6a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184" />
    </svg>
);

interface MessageProps {
  turn: StoryTurn;
  onDelete: (id: string) => void;
  onEdit: (id: string, newText: string) => void;
  onRegenerate: () => void;
  onContinue: () => void;
  onToggleResponses: (id: string) => void;
  onCopyToNotes: (agentName: string, text: string) => void;
  onSummarizeToNotes: (agentName: string, text: string) => Promise<void>;
  onImageClick: (url: string) => void;
  playerName: string;
  aiName: string;
  themeColor: string;
  characterImage: string;
  playerImage: string;
  isLoading: boolean;
  isLast: boolean;
  loadingStatus?: string;
  editFullMessage?: boolean;
}

const escapeHtmlAttr = (value: string) => value.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const MessageComponent: React.FC<MessageProps> = ({ turn, onDelete, onEdit, onRegenerate, onContinue, onToggleResponses, onCopyToNotes, onSummarizeToNotes, onImageClick, playerName, aiName, themeColor, characterImage, playerImage, isLoading, isLast, loadingStatus, editFullMessage }) => {
  const dispatch = useAppDispatch();
  // Read UI text prefs from the store directly: a store subscription re-renders
  // messages when the preset/size changes even though this component is memoized
  // with a custom prop compare (which these would otherwise have to be added to).
  const chatTextPresetId = useAppSelector(state => state.settings.chatTextPresetId);
  const chatFontSizePx = useAppSelector(state => state.settings.chatFontSizePx);
  const chatTextPreset = getChatTextPreset(chatTextPresetId);
  const [isHovered, setIsHovered] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const [editMinHeight, setEditMinHeight] = useState(0);
  const [isThinkingOpen, setIsThinkingOpen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [justCopied, setJustCopied] = useState(false);
  const copyTimeoutRef = useRef<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messageBodyRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const rawContent = (turn.text ?? '')
    .replace(/{{user}}/g, playerName)
    .replace(/{{char}}/g, aiName);

  const { thoughts, content: displayContent } = splitThinkingContent(rawContent);
  const currentEditableText = !editFullMessage && thoughts !== null ? displayContent : (turn.text ?? '');

  useEffect(() => {
    if(isEditing) {
        setEditText(currentEditableText);
    }
  }, [isEditing, currentEditableText]);

  useLayoutEffect(() => {
    if (!isEditing || !textareaRef.current) return;

    const textarea = textareaRef.current;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.max(editMinHeight, textarea.scrollHeight)}px`;
  }, [isEditing, editText, editMinHeight]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
        if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
            setIsMenuOpen(false);
        }
    };
    if (isMenuOpen) {
        document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
        document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isMenuOpen]);

  useEffect(() => {
    if (!isMenuOpen) setJustCopied(false);
  }, [isMenuOpen]);

  useEffect(() => () => {
    if (copyTimeoutRef.current) window.clearTimeout(copyTimeoutRef.current);
  }, []);

  const handleCopyMessage = async () => {
    // Copy the rendered text (names substituted, <think> stripped), not the raw turn.
    const text = displayContent.trim();
    try {
        await navigator.clipboard.writeText(text);
    } catch {
        // Clipboard API needs a secure context; fall back to the legacy path.
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
    }
    setJustCopied(true);
    if (copyTimeoutRef.current) window.clearTimeout(copyTimeoutRef.current);
    copyTimeoutRef.current = window.setTimeout(() => {
        setJustCopied(false);
        setIsMenuOpen(false);
    }, 900);
  };

  const handleStartEdit = () => {
    const currentHeight = messageBodyRef.current?.getBoundingClientRect().height ?? 0;
    setEditMinHeight(Math.ceil(currentHeight));
    setEditText(currentEditableText);
    setIsMenuOpen(false);
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditMinHeight(0);
  };

  const handleSaveEdit = () => {
    let finalSaveText = editText;
    if (!editFullMessage && thoughts !== null) {
       finalSaveText = `<think>\n${thoughts}\n</think>\n\n${editText}`;
    }
    onEdit(turn.id, finalSaveText);
    setIsEditing(false);
    setEditMinHeight(0);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Explicit save chord that works everywhere — including touch keyboards and when
    // the Save button is scrolled out of view on a long edit.
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'Enter') {
        e.preventDefault();
        handleSaveEdit();
        return;
    }
    // Enter-to-save is a desktop shortcut only. On touch devices Enter must insert a
    // newline (there's no easy Shift+Enter), so editing relies on the Save button there.
    const coarsePointer = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
    if (e.key === 'Enter' && !e.shiftKey && !coarsePointer) {
        e.preventDefault();
        handleSaveEdit();
    }
    if(e.key === 'Escape') {
        handleCancelEdit();
    }
  }

  const handleBranchNav = (direction: 'prev' | 'next') => {
    if (turn.branchInfo) {
        dispatch(switchBranch({ nodeId: turn.branchInfo.nodeId, direction }));
    }
  };

  // Rendering markup is derived only from the message text, so memoize it: during
  // streaming only the growing message recomputes; the rest of a long chat is
  // skipped entirely (this component is also React.memo'd below).
  const formattedContent = useMemo(() => {
      let processed = displayContent.replace(
          /```\nInfo Box\n---\n📅: (.*?)\n🕒: (.*?)\n🗺️: (.*?)\n📖: (.*?)\n👤: (.*?)\n```/gs,
          `<div class="my-4 p-3 rounded-lg border border-primary-700 bg-gray-800/60 shadow-md">
             <div class="text-sm font-bold text-primary-400 mb-2 border-b border-primary-800 pb-1 flex justify-between items-center">
                <span>SCENE INFO</span>
                <span class="text-xs text-gray-500 font-mono">LIVE UPDATE</span>
             </div>
             <div class="grid grid-cols-1 gap-1 text-xs text-gray-300">
                <div><span class="opacity-60 mr-2">📅 DATE:</span> $1</div>
                <div><span class="opacity-60 mr-2">🕒 TIME:</span> $2</div>
                <div><span class="opacity-60 mr-2">🗺️ LOC:</span> <span class="text-primary-300">$3</span></div>
                <div><span class="opacity-60 mr-2">📖 CTX:</span> $4</div>
                <div class="mt-1 pt-1 border-t border-gray-700"><span class="opacity-60 block mb-0.5">👤 CAST:</span> $5</div>
             </div>
           </div>`
      );

      processed = processed.replace(
          /```\n(.*?)(?:'s)? Stats\n---\n- Health: (\d+)%\n- Sustenance: (\d+)%\n- Energy: (\d+)%\n- Hygiene: (\d+)%\n- Arousal: (\d+)%\n💎: (.*?)\n```/gs,
          (match, name, hp, sus, nrg, hyg, aro, cond) => {
              return `<div class="my-4 p-3 rounded-lg border border-primary-700 bg-gray-800/60 shadow-md">
                 <div class="text-sm font-bold text-primary-400 mb-2 border-b border-primary-800 pb-1">
                    ${name.toUpperCase()}'S STATUS
                 </div>
                 <div class="space-y-1">
                    <div class="flex items-center gap-2">
                        <span class="w-20 text-[10px] uppercase text-gray-400">Health</span>
                        <div class="flex-grow h-1.5 bg-gray-700 rounded-full"><div class="h-full bg-red-500" style="width:${hp}%"></div></div>
                    </div>
                    <div class="flex items-center gap-2">
                        <span class="w-20 text-[10px] uppercase text-gray-400">Sustenance</span>
                        <div class="flex-grow h-1.5 bg-gray-700 rounded-full"><div class="h-full bg-green-500" style="width:${sus}%"></div></div>
                    </div>
                    <div class="flex items-center gap-2">
                        <span class="w-20 text-[10px] uppercase text-gray-400">Energy</span>
                        <div class="flex-grow h-1.5 bg-gray-700 rounded-full"><div class="h-full bg-yellow-500" style="width:${nrg}%"></div></div>
                    </div>
                    <div class="flex items-center gap-2">
                        <span class="w-20 text-[10px] uppercase text-gray-400">Hygiene</span>
                        <div class="flex-grow h-1.5 bg-gray-700 rounded-full"><div class="h-full bg-blue-400" style="width:${hyg}%"></div></div>
                    </div>
                    <div class="flex items-center gap-2">
                        <span class="w-20 text-[10px] uppercase text-gray-400">Arousal</span>
                        <div class="flex-grow h-1.5 bg-gray-700 rounded-full"><div class="h-full bg-pink-500" style="width:${aro}%"></div></div>
                    </div>
                 </div>
                 <div class="mt-2 pt-2 border-t border-gray-700 text-xs text-gray-300">
                    <span class="opacity-60">💎 CONDITION:</span> ${cond}
                 </div>
               </div>`
          }
      );

      processed = processed.replace(
          /```\nMind Reading\n---\n(.*?): (.*?)\n```/gs,
          `<div class="my-3 mx-4 p-2 rounded bg-purple-900/20 border-l-2 border-purple-500 text-xs text-purple-200 italic">
             <span class="font-bold not-italic text-purple-400">$1:</span> "$2"
           </div>`
      );

      // Inline story images: ![alt](url). Rendered as a clickable thumbnail that
      // opens the floating viewer (click handled via delegation on the container).
      // Done before the emphasis/newline passes so the URL is never mangled.
      processed = processed.replace(INLINE_IMAGE_RE, (_m, alt: string, url: string) =>
          `<img src="${escapeHtmlAttr(url)}" alt="${escapeHtmlAttr(alt || 'image')}" data-viewer-src="${escapeHtmlAttr(url)}" loading="lazy" class="story-inline-image mt-3 mb-1 block max-h-[26rem] max-w-full rounded-lg border border-gray-700 object-contain cursor-zoom-in transition-shadow hover:shadow-lg hover:border-primary-500/70" />`
      );

      // Quote/emphasis colors come from the active chat text preset (UI Settings).
      return applyInlineStoryMarkup(processed, chatTextPreset)
        .replace(/\n/g, '<br />');
  }, [displayContent, chatTextPreset]);

  // Delegate clicks on inline story images (rendered via dangerouslySetInnerHTML,
  // so they can't carry a React handler directly) up to the floating viewer.
  const handleContentClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const src = (e.target as HTMLElement)?.getAttribute?.('data-viewer-src');
    if (src) onImageClick(src);
  }, [onImageClick]);

 const renderContent = () => {
    if (isEditing) {
      return (
        <div className="flex flex-col w-full">
            {/* Sticky edit toolbar: a solid bar (no text overlap) that stays in view while
                scrolling a long edit, so the buttons follow you down. Labeled, full-size tap
                targets make Save the reliable path on touch devices, where the keyboard chord
                (Ctrl/Cmd+Shift+Enter) isn't available. */}
            <div className="sticky top-1 z-10 mb-2 flex items-center justify-end gap-2 pointer-events-none">
                <button
                    type="button"
                    onClick={handleCancelEdit}
                    className="pointer-events-auto inline-flex items-center gap-1.5 rounded-md border border-gray-700/70 bg-gray-800/90 px-2.5 py-2 text-sm text-gray-300 shadow-md backdrop-blur-sm hover:bg-gray-700 hover:text-white transition-colors"
                    title="Cancel edit (Esc)"
                    aria-label="Cancel edit"
                >
                    <XMarkIcon className="w-4 h-4"/>
                    <span>Cancel</span>
                </button>
                <button
                    type="button"
                    onClick={handleSaveEdit}
                    className="pointer-events-auto inline-flex items-center gap-1.5 rounded-md bg-primary-600 px-3.5 py-2 text-sm font-semibold text-white shadow-md hover:bg-primary-500 transition-colors"
                    title="Save edit (Ctrl/Cmd+Shift+Enter)"
                    aria-label="Save edit"
                >
                    <CheckCircleIcon className="w-4 h-4"/>
                    <span>Save</span>
                </button>
            </div>
            <textarea
                ref={textareaRef}
                value={editText}
                onChange={e => setEditText(e.target.value)}
                onKeyDown={handleKeyDown}
                className="block w-full resize-none overflow-hidden bg-transparent p-0 text-base leading-relaxed text-gray-200 outline-none ring-0 focus:outline-none focus:ring-0"
                rows={1}
                style={{ minHeight: editMinHeight ? `${editMinHeight}px` : undefined }}
                aria-label="Edit message"
                autoFocus
            />
        </div>
      );
    }

    if (isLast && !turn.isPlayer && !turn.text && isLoading) {
        return (
            <div className="animate-pulse flex items-center gap-2 text-gray-400 italic">
                <div className={`w-2 h-2 bg-primary-500 rounded-full animate-bounce`}></div>
                <div className={`w-2 h-2 bg-primary-500 rounded-full animate-bounce delay-75`}></div>
                <div className={`w-2 h-2 bg-primary-500 rounded-full animate-bounce delay-150`}></div>
                <span className="text-sm ml-2">{loadingStatus || 'Thinking...'}</span>
            </div>
        );
    }

    return (
        <div>
            {thoughts !== null && (
                <div className="mb-3">
                    <button
                        onClick={() => setIsThinkingOpen(!isThinkingOpen)}
                        className={`flex items-center gap-2 text-xs font-semibold text-gray-500 hover:text-primary-400 transition-colors uppercase tracking-wider mb-2`}
                    >
                        <LightBulbIcon className="w-4 h-4" />
                        Thinking Process
                        <ChevronDownIcon className={`w-3 h-3 transition-transform ${isThinkingOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {isThinkingOpen && (
                        <div className="bg-gray-800/50 rounded-lg p-3 border-l-4 border-gray-600 text-gray-400 text-xs font-mono whitespace-pre-wrap leading-relaxed animate-in fade-in slide-in-from-top-2 duration-200">
                            {thoughts || <span className="animate-pulse">thinking...</span>}
                        </div>
                    )}
                </div>
            )}

            {turn.image && (
                <div className="mb-3 max-w-sm rounded-lg overflow-hidden border border-gray-700 shadow-sm cursor-pointer" onClick={() => onImageClick(turn.image!)}>
                    <img src={turn.image} alt="Attachment" className="w-full h-auto" />
                </div>
            )}

            <div onClick={handleContentClick} style={{ color: chatTextPreset.textColor }} dangerouslySetInnerHTML={{ __html: formattedContent }} />
            {isLast && !turn.isPlayer && isLoading && (
                 <span className={`inline-block w-2 h-4 bg-primary-400 animate-pulse ml-1 align-bottom`}></span>
            )}
        </div>
    );
  };

  const name = turn.isPlayer ? playerName : aiName;
  const avatarUrl = turn.isPlayer ? playerImage : characterImage;

  return (
    <div
        className={`group relative flex items-start gap-4 px-4 py-3 my-1 rounded-md transition-colors duration-150 ${isEditing ? 'bg-gray-800/30 ring-1 ring-primary-500/70' : 'hover:bg-gray-800/50'}`}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
    >
        <div
            className={`flex-shrink-0 h-10 w-10 rounded-full bg-gray-700 flex items-center justify-center font-bold text-primary-400 border-2 border-gray-600 overflow-hidden ${avatarUrl ? `cursor-pointer hover:border-primary-500 transition-colors` : ''}`}
            onClick={() => avatarUrl && onImageClick(avatarUrl)}
        >
            {avatarUrl ? (
                <img src={avatarUrl} alt={name} className="h-full w-full object-cover" />
            ) : (
                name.charAt(0)
            )}
        </div>
        <div className="flex-grow">
            <div className="flex justify-between items-center">
               <div className="flex items-center gap-2">
                  {turn.agentResponses ? (
                    <button
                      onClick={() => onToggleResponses(turn.id)}
                      className={`flex items-center gap-2 font-bold text-primary-400 transition-colors hover:text-primary-200`}
                      aria-expanded={turn.isExpanded}
                      aria-label="Toggle agent details"
                    >
                      <span>{name}</span>
                      <ChevronDownIcon className={`w-4 h-4 text-gray-400 transition-transform duration-300 ${turn.isExpanded ? 'rotate-180' : ''}`} />
                    </button>
                  ) : (
                    <p className={`font-bold text-primary-400`}>{name}</p>
                  )}

                  {turn.branchInfo && !turn.isPlayer && (
                      <div className="flex items-center bg-gray-800/50 rounded-md ml-2 border border-gray-700/50 text-xs text-gray-400 overflow-hidden">
                          <button
                             onClick={() => handleBranchNav('prev')}
                             disabled={turn.branchInfo.current <= 1}
                             className="p-1 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"
                             title="Previous branch"
                           >
                              <ChevronLeftIcon className="w-3 h-3" />
                          </button>
                          <span className="px-1 font-mono">
                              {turn.branchInfo.current}/{turn.branchInfo.total}
                          </span>
                          <button
                             onClick={() => handleBranchNav('next')}
                             className="p-1 hover:bg-gray-700"
                             title={turn.branchInfo.current === turn.branchInfo.total ? "Generate new branch" : "Next branch"}
                           >
                              <ChevronRightIcon className="w-3 h-3" />
                          </button>
                      </div>
                  )}
              </div>
            </div>

            <div ref={messageBodyRef} className="text-gray-200 leading-relaxed mt-1" style={{ fontSize: `${chatFontSizePx}px` }}>
                {renderContent()}
            </div>

            {turn.isExpanded && turn.agentResponses && (
              <div className="mt-3">
                <AgentResponsesView
                  responses={turn.agentResponses}
                  themeColor={themeColor}
                  onCopyToNotes={onCopyToNotes}
                  onSummarizeToNotes={onSummarizeToNotes}
                />
              </div>
            )}
        </div>
        {(isHovered || isMenuOpen) && !isEditing && (
            <div className="absolute top-2 right-2 flex items-center gap-1" ref={menuRef}>
                {isLast && turn.isPlayer && !isLoading && (
                    <button
                        onClick={() => onRegenerate()}
                        className="p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
                        title="Try Again"
                    >
                        <ArrowPathIcon className="w-6 h-6"/>
                    </button>
                )}
                <button
                    onClick={handleStartEdit}
                    className="p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
                    title="Edit"
                >
                    <PencilSquareIcon className="w-6 h-6"/>
                </button>
                <button
                    onClick={() => setIsMenuOpen(!isMenuOpen)}
                    className={`p-1.5 rounded-md transition-colors ${isMenuOpen ? `bg-gray-700 text-white` : `text-gray-400 hover:text-white hover:bg-gray-700`}`}
                    title="Options"
                >
                    <EllipsisHorizontalIcon className="w-6 h-6"/>
                </button>

                {isMenuOpen && (
                    <div className="absolute right-0 top-full mt-1 w-40 bg-gray-800 border border-gray-700 rounded-md shadow-xl z-20 overflow-hidden ring-1 ring-black ring-opacity-5 animate-in fade-in slide-in-from-top-1 duration-100">
                        <div className="py-1">
                            {isLast && !turn.isPlayer && (
                                <>
                                    <button
                                        onClick={() => { onContinue(); setIsMenuOpen(false); }}
                                        className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white flex items-center gap-2"
                                    >
                                        <ChevronDoubleRightIcon className="w-4 h-4" />
                                        Continue
                                    </button>
                                    <button
                                        onClick={() => { onRegenerate(); setIsMenuOpen(false); }}
                                        className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white flex items-center gap-2"
                                    >
                                        <ArrowPathIcon className="w-4 h-4" />
                                        Regenerate
                                    </button>
                                </>
                            )}
                            <button
                                onClick={handleCopyMessage}
                                className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white flex items-center gap-2"
                            >
                                {justCopied ? (
                                    <>
                                        <CheckCircleIcon className="w-4 h-4 text-green-400" />
                                        <span className="text-green-400">Copied!</span>
                                    </>
                                ) : (
                                    <>
                                        <ClipboardIcon className="w-4 h-4" />
                                        Copy
                                    </>
                                )}
                            </button>
                            <button
                                onClick={() => { onDelete(turn.id); setIsMenuOpen(false); }}
                                className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-red-900/20 hover:text-red-300 flex items-center gap-2"
                            >
                                <TrashIcon className="w-4 h-4" />
                                Delete
                            </button>
                        </div>
                    </div>
                )}
            </div>
        )}
    </div>
  );
};

// Custom equality: turn objects are rebuilt from the chat tree on every streaming
// token (new object + new branchInfo each time), so a shallow prop compare would
// re-render the whole history per token. Compare by the fields we actually render,
// and rely on stable (useCallback'd) handlers from the parents. Net effect: only
// the message whose text changed re-renders while streaming, and typing in the
// composer no longer touches the transcript at all.
const areMessagePropsEqual = (prev: MessageProps, next: MessageProps): boolean => {
    const a = prev.turn, b = next.turn;
    if (
        a.id !== b.id ||
        a.text !== b.text ||
        a.image !== b.image ||
        a.isPlayer !== b.isPlayer ||
        a.isExpanded !== b.isExpanded ||
        a.agentResponses !== b.agentResponses
    ) return false;

    const ab = a.branchInfo, bb = b.branchInfo;
    if (!!ab !== !!bb) return false;
    if (ab && bb && (ab.current !== bb.current || ab.total !== bb.total || ab.nodeId !== bb.nodeId)) return false;

    return (
        prev.isLast === next.isLast &&
        prev.isLoading === next.isLoading &&
        prev.loadingStatus === next.loadingStatus &&
        prev.playerName === next.playerName &&
        prev.aiName === next.aiName &&
        prev.themeColor === next.themeColor &&
        prev.characterImage === next.characterImage &&
        prev.playerImage === next.playerImage &&
        prev.editFullMessage === next.editFullMessage &&
        prev.onDelete === next.onDelete &&
        prev.onEdit === next.onEdit &&
        prev.onRegenerate === next.onRegenerate &&
        prev.onContinue === next.onContinue &&
        prev.onToggleResponses === next.onToggleResponses &&
        prev.onCopyToNotes === next.onCopyToNotes &&
        prev.onSummarizeToNotes === next.onSummarizeToNotes &&
        prev.onImageClick === next.onImageClick
    );
};

const Message = React.memo(MessageComponent, areMessagePropsEqual);


interface StoryPanelProps {
  storyHistory: StoryTurn[];
  isLoading: boolean;
  loadingStatus: string;
  error: string | null;
  onDelete: (id: string) => void;
  onEdit: (id: string, newText: string) => void;
  onRegenerate: () => void;
  onContinue: () => void;
  onToggleResponses: (id: string) => void;
  onCopyToNotes: (agentName: string, text: string) => void;
  onSummarizeToNotes: (agentName: string, text: string) => Promise<void>;
  playerName: string;
  aiName: string;
  themeColor: string;
  characterImage: string;
  playerImage: string;
  editFullMessage?: boolean;
}

const StoryPanel: React.FC<StoryPanelProps> = ({
  storyHistory, isLoading, loadingStatus, error, onDelete, onEdit, onRegenerate, onContinue, onToggleResponses, onCopyToNotes, onSummarizeToNotes, playerName, aiName, themeColor, characterImage, playerImage, editFullMessage
}) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  const viewerRef = useRef<ImageViewerHandle>(null);
  // Stable so Message stays memoized: opening the viewer is imperative, keeping
  // the transcript untouched.
  const openImage = useCallback((url: string) => viewerRef.current?.open(url), []);

  const lastIndex = storyHistory.length - 1;

  return (
    <>
        <div className="flex-grow overflow-y-auto pr-2 custom-scrollbar">
            {storyHistory.map((turn, index) => (
                <Message
                    key={turn.id}
                    turn={turn}
                    onDelete={onDelete}
                    onEdit={onEdit}
                    onRegenerate={onRegenerate}
                    onContinue={onContinue}
                    onToggleResponses={onToggleResponses}
                    onCopyToNotes={onCopyToNotes}
                    onSummarizeToNotes={onSummarizeToNotes}
                    playerName={playerName}
                    aiName={aiName}
                    themeColor={themeColor}
                    characterImage={characterImage}
                    playerImage={playerImage}
                    isLoading={isLoading}
                    isLast={index === lastIndex}
                    loadingStatus={index === lastIndex ? loadingStatus : undefined}
                    onImageClick={openImage}
                    editFullMessage={editFullMessage}
                />
            ))}

            {error && <div className={`mx-4 my-2 p-3 bg-primary-800/50 text-white rounded-md border border-primary-600`}><strong>Error:</strong> {error}</div>}
            <div ref={bottomRef} />
        </div>

        <ImageViewer ref={viewerRef} />
    </>
  );
};

export default StoryPanel;
