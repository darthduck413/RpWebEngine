
import React, { useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { hideToast } from '../store/slices/uiSlice';
import { XMarkIcon } from './icons/XMarkIcon';
import { CheckCircleIcon } from './icons/CheckCircleIcon';

const Toast: React.FC = () => {
  const dispatch = useAppDispatch();
  const { message, type, isVisible } = useAppSelector((state) => state.ui.toast);

  useEffect(() => {
    if (isVisible) {
      const timer = setTimeout(() => {
        dispatch(hideToast());
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [isVisible, message, type, dispatch]);

  if (!isVisible) return null;

  const typeStyles = {
    success: 'bg-green-900/90 border-green-500 text-green-100',
    error: 'bg-red-900/90 border-red-500 text-red-100',
    info: 'bg-gray-800/90 border-blue-500 text-blue-100',
  };

  const icons = {
    success: <CheckCircleIcon className="w-6 h-6 text-green-400" />,
    error: <XMarkIcon className="w-6 h-6 text-red-400" />,
    info: <div className="w-6 h-6 rounded-full border-2 border-blue-400 flex items-center justify-center text-xs font-bold">i</div>,
  };

  return (
    <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-lg border shadow-xl backdrop-blur-sm transition-all duration-300 animate-in slide-in-from-bottom-5 fade-in ${typeStyles[type]}`}>
      {icons[type]}
      <span className="font-medium">{message}</span>
      <button 
        onClick={() => dispatch(hideToast())} 
        className="ml-2 p-1 hover:bg-white/10 rounded-full transition-colors"
      >
        <XMarkIcon className="w-4 h-4 opacity-70" />
      </button>
    </div>
  );
};

export default Toast;
