
import React, { useRef, useEffect, useState } from 'react';
import { XMarkIcon } from './icons/XMarkIcon';
import { PhotoIcon } from './icons/PhotoIcon';
import { compressAvatarDataUrl } from '../services/common/characterCard';

interface ChoiceListProps {
  value: string;
  onChange: (value: string) => void;
  onSelect: (choice: string, image?: string) => void;
  onStop: () => void;
  isLoading: boolean;
  hasStreamingOutput: boolean;
  isWorldModelEnabled: boolean;
  showImageAttachButton: boolean;
  themeColor: string;
}

const StopIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" {...props}>
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
);

const ChoiceList: React.FC<ChoiceListProps> = ({ value, onChange, onSelect, onStop, isLoading, hasStreamingOutput, isWorldModelEnabled, showImageAttachButton, themeColor }) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const stopRequestedRef = useRef(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  // On touch devices there's no easy Shift+Enter, and Enter-to-send makes it
  // impossible to type a newline (and fires accidentally with swipe/autocomplete
  // keyboards). Since a Send button is always visible, let Enter be a plain
  // newline on coarse pointers and keep Enter-to-send only for mouse/keyboard.
  const [isCoarsePointer] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches
  );
  // The Stop button replaces Send at the same spot the instant isLoading flips,
  // so the tail of a double-tap on Send lands on Stop and silently cancels the
  // generation that just started. Keep Stop inert briefly, but arm it
  // immediately once generated text is visible.
  const [stopArmed, setStopArmed] = useState(false);

  useEffect(() => {
    stopRequestedRef.current = false;
    if (!isLoading) {
      setStopArmed(false);
      return;
    }
    setStopArmed(false);
    const timerId = setTimeout(() => setStopArmed(true), 700);
    return () => clearTimeout(timerId);
  }, [isLoading]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [value]);

  const submitForm = (e?: React.FormEvent) => {
    e?.preventDefault();
    if ((value.trim() || selectedImage) && !isLoading) {
      onSelect(value.trim(), selectedImage || undefined);
      setSelectedImage(null); // Clear image after send
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !isCoarsePointer) {
        e.preventDefault();
        submitForm();
    }
  }

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value);
  }

  // Read an image file/blob into a compressed data URL. Compression caps large
  // images (keeps localStorage from filling up on a single paste/attach).
  const ingestImageBlob = (blob: Blob) => {
    const reader = new FileReader();
    reader.onloadend = async () => {
      setSelectedImage(await compressAvatarDataUrl(reader.result as string));
    };
    reader.readAsDataURL(blob);
  };

  const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith('image/')) {
      ingestImageBlob(file);
    }
    e.target.value = ''; // allow re-picking the same file
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (const item of items) {
        if (item.type.indexOf('image') !== -1) {
            e.preventDefault();
            const blob = item.getAsFile();
            if (blob) {
                ingestImageBlob(blob);
            }
            return; // Only take the first image
        }
    }
  };

  const canStop = stopArmed || hasStreamingOutput;
  const requestStop = () => {
    if (!canStop || stopRequestedRef.current) return;
    stopRequestedRef.current = true;
    onStop();
  };

  const handleStopPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    requestStop();
  };

  return (
    <div className="flex flex-col gap-2 bg-gray-800/60 p-2 rounded-lg border border-gray-700/50">
        {selectedImage && (
            <div className="relative w-fit animate-in fade-in zoom-in-95 duration-200">
                <img src={selectedImage} alt="Preview" className="h-24 w-auto rounded-md border border-gray-600 object-cover" />
                <button 
                    onClick={() => setSelectedImage(null)}
                    className="absolute -top-2 -right-2 bg-gray-900 rounded-full text-gray-400 hover:text-white border border-gray-600 p-0.5 shadow-md"
                >
                    <XMarkIcon className="w-4 h-4" />
                </button>
            </div>
        )}
        
        <form onSubmit={submitForm} className="flex items-end gap-2">
            {/* Image attach is opt-in (UI Settings) — most users rarely use it and
                the button is visual clutter. Pasting an image into the input still
                works whether or not this is shown. */}
            {showImageAttachButton && (
                <>
                    <input
                        type="file"
                        ref={imageInputRef}
                        onChange={handleFilePick}
                        accept="image/*"
                        className="hidden"
                        aria-hidden="true"
                    />
                    <button
                        type="button"
                        onClick={() => imageInputRef.current?.click()}
                        disabled={isLoading}
                        className="px-3 py-3 bg-gray-800 text-primary-300 rounded-md border border-primary-900/70 hover:bg-primary-900/50 hover:text-white transition-all duration-200 flex-shrink-0 self-end disabled:opacity-50 disabled:cursor-not-allowed"
                        aria-label="Attach image"
                        title="Attach image"
                    >
                        <PhotoIcon className="w-6 h-6" />
                    </button>
                </>
            )}
            <textarea
                ref={textareaRef}
                rows={1}
                value={value}
                onChange={handleInput}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder={isLoading ? (isWorldModelEnabled ? "Story Engine is thinking…" : "Generating...") : ""}
                disabled={isLoading}
                className={`flex-grow bg-gray-800 rounded-md border border-primary-900/70 text-[rgb(255,255,255)] placeholder-primary-300/60 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all duration-200 p-3 disabled:opacity-50 resize-none overflow-hidden`}
                style={{maxHeight: '150px'}}
                aria-label="Custom action input"
            />
            {isLoading ? (
                <button
                    type="button"
                    onPointerDown={handleStopPointerDown}
                    onClick={requestStop}
                    disabled={!canStop}
                    className={`px-4 py-3 bg-red-600 text-white font-semibold rounded-md border border-red-500 hover:bg-red-500 transition-all duration-200 flex-shrink-0 self-end disabled:opacity-50 disabled:cursor-not-allowed`}
                    aria-label="Stop generation"
                    title="Stop Generation"
                >
                    <StopIcon className="w-6 h-6" />
                </button>
            ) : (
                <button
                    type="submit"
                    disabled={!value.trim() && !selectedImage}
                    className={`px-4 py-3 bg-primary-800 text-white font-semibold rounded-md border border-primary-600 hover:bg-primary-700 transition-all duration-200 disabled:bg-primary-900/50 disabled:text-gray-400 disabled:border-primary-800 disabled:cursor-not-allowed flex-shrink-0 self-end`}
                    aria-label="Submit custom action"
                >
                    Send
                </button>
            )}
        </form>
    </div>
  );
};

export default ChoiceList;
