
import React from 'react';
import { XMarkIcon } from './icons/XMarkIcon';

export interface ChoiceOption {
    label: string;
    value: string;
    isPrimary?: boolean;
    isDanger?: boolean;
}

interface ChoiceModalProps {
    isOpen: boolean;
    title: string;
    message: string;
    choices: ChoiceOption[];
    onChoice: (value: string) => void;
    onCancel: () => void;
    themeColor: string;
}

const ChoiceModal: React.FC<ChoiceModalProps> = ({ isOpen, title, message, choices, onChoice, onCancel, themeColor }) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[60] p-4 animate-in fade-in duration-200">
            <div 
                className={`bg-gray-900 w-full max-w-md p-6 rounded-2xl ring-1 ring-primary-700 shadow-2xl shadow-primary-500/10 transform transition-all scale-100 relative`}
                onClick={(e) => e.stopPropagation()}
            >
                <button 
                    onClick={onCancel}
                    className="absolute top-4 right-4 text-gray-500 hover:text-white transition-colors"
                >
                    <XMarkIcon className="w-6 h-6" />
                </button>

                <h3 className={`text-xl font-bold text-primary-400 mb-3 pr-8`}>{title}</h3>
                <p className="text-gray-300 mb-8 text-sm leading-relaxed">{message}</p>
                
                <div className="flex flex-col gap-3">
                    {choices.map((choice) => {
                        let bgClass = "bg-gray-800 hover:bg-gray-700 border-gray-700 text-gray-200";
                        if (choice.isPrimary) bgClass = `bg-primary-700 hover:bg-primary-600 border-primary-600 text-white`;
                        if (choice.isDanger) bgClass = "bg-red-900/40 hover:bg-red-900/60 border-red-800 text-red-200";

                        return (
                            <button
                                key={choice.value}
                                onClick={() => onChoice(choice.value)}
                                className={`w-full py-3 px-4 rounded-lg border font-semibold transition-all duration-200 shadow-md ${bgClass}`}
                            >
                                {choice.label}
                            </button>
                        );
                    })}
                    <button
                        onClick={onCancel}
                        className="mt-2 w-full py-2 px-4 text-sm text-gray-500 hover:text-gray-300 transition-colors"
                    >
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ChoiceModal;
