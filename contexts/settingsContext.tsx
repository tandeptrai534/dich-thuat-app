
import React, { createContext, useContext } from 'react';
import type { AppSettings, Theme, VocabularyItem } from '../types';

export const getThemeClasses = (theme: Theme) => {
    switch (theme) {
        case 'dark':
            return {
                mainBg: 'bg-gray-900', text: 'text-slate-200',
                cardBg: 'bg-gray-800', border: 'border-gray-700',
                hoverBg: 'hover:bg-gray-700', popupBg: 'bg-slate-900',
                popupText: 'text-slate-100', mutedText: 'text-slate-400',
                button: { bg: 'bg-slate-700', text: 'text-slate-200', hoverBg: 'hover:bg-slate-600' },
                primaryButton: { bg: 'bg-blue-500', text: 'text-white', hoverBg: 'hover:bg-blue-600' }
            };
        case 'sepia':
            return {
                mainBg: 'bg-amber-50', text: 'text-stone-800',
                cardBg: 'bg-amber-100', border: 'border-amber-200',
                hoverBg: 'hover:bg-amber-200', popupBg: 'bg-stone-800',
                popupText: 'text-stone-100', mutedText: 'text-stone-500',
                button: { bg: 'bg-stone-200', text: 'text-stone-800', hoverBg: 'hover:bg-stone-300' },
                primaryButton: { bg: 'bg-orange-800', text: 'text-white', hoverBg: 'hover:bg-orange-900' }
            };
        default: // light
            return {
                mainBg: 'bg-slate-50', text: 'text-slate-800',
                cardBg: 'bg-white', border: 'border-slate-200',
                hoverBg: 'hover:bg-slate-100', popupBg: 'bg-slate-800',
                popupText: 'text-white', mutedText: 'text-slate-500',
                button: { bg: 'bg-slate-200', text: 'text-slate-700', hoverBg: 'hover:bg-slate-300' },
                primaryButton: { bg: 'bg-blue-600', text: 'text-white', hoverBg: 'hover:bg-blue-700' }
            };
    }
};

export const SettingsContext = createContext<{ settings: AppSettings; theme: ReturnType<typeof getThemeClasses>; setSettings: React.Dispatch<React.SetStateAction<AppSettings>>; vocabulary: VocabularyItem[] } | null>(null);

export const useSettings = () => {
    const context = useContext(SettingsContext);
    if (!context) throw new Error("useSettings must be used within a SettingsProvider");
    return context;
};
