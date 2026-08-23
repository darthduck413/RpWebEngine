import React from 'react';

export const ThemeSelector: React.FC<{ currentTheme: string; onThemeChange: (theme: string) => void; }> = ({ currentTheme, onThemeChange }) => {
  const themes = [
    { name: 'blue', color: 'bg-blue-500', label: 'Blue theme' },
    { name: 'red', color: 'bg-red-500', label: 'Red theme' },
    { name: 'yellow', color: 'bg-amber-500', label: 'Yellow theme' },
    { name: 'purple', color: 'bg-purple-500', label: 'Purple theme' },
  ];
  return (
    <div className="flex items-center gap-2 p-2 rounded-lg bg-gray-800/70 border border-gray-700">
      {themes.map(theme => (
        <button
          key={theme.name}
          onClick={() => onThemeChange(theme.name)}
          className={`w-5 h-5 rounded-full ${theme.color} transition-transform duration-200 transform hover:scale-110 ${currentTheme === theme.name ? 'ring-2 ring-offset-2 ring-offset-gray-800 ring-white' : ''}`}
          aria-label={`Set ${theme.label}`}
        />
      ))}
    </div>
  );
};
