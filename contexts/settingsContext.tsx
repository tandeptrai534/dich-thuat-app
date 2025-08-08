

import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
import type { AppSettings, Theme, VocabularyItem } from '../types';

// The shape of the theme classes object, used for styling
export interface ThemeClasses {
    mainBg: string;
    text: string;
    mutedText: string;
    border: string;
    cardBg: string;
    popupBg: string;
    popupText: string;
    hoverBg: string;
    button: {
        bg: string;
        text: string;
        hoverBg: string;
    };
    primaryButton: {
        bg: string;
        text: string;
        hoverBg: string;
    };
}

// The shape of the context value, providing settings and theme info to components
export interface SettingsContextType {
    settings: AppSettings;
    theme: ThemeClasses;
    setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
    vocabulary: VocabularyItem[];
    setVocabulary: React.Dispatch<React.SetStateAction<VocabularyItem[]>>;
}

// Create the context with a default undefined value
export const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

// Custom hook for easy access to the settings context
export const useSettings = (): SettingsContextType => {
    const context = useContext(SettingsContext);
    if (context === undefined) {
        throw new Error('useSettings must be used within a SettingsContext.Provider');
    }
    return context;
};

// Function to generate a set of TailwindCSS class names based on the selected theme
export const getThemeClasses = (theme: Theme): ThemeClasses => {
    switch (theme) {
        case 'dark':
            return {
                mainBg: 'bg-gray-900',
                text: 'text-gray-200',
                mutedText: 'text-gray-400',
                border: 'border-gray-700',
                cardBg: 'bg-gray-800',
                popupBg: 'bg-gray-700',
                popupText: 'text-gray-200',
                hoverBg: 'hover:bg-gray-700',
                button: { bg: 'bg-gray-700', text: 'text-gray-200', hoverBg: 'hover:bg-gray-600' },
                primaryButton: { bg: 'bg-blue-600', text: 'text-white', hoverBg: 'hover:bg-blue-500' },
            };
        case 'sepia':
             return {
                mainBg: 'bg-amber-50',
                text: 'text-stone-800',
                mutedText: 'text-stone-500',
                border: 'border-amber-200',
                cardBg: 'bg-white',
                popupBg: 'bg-amber-100',
                popupText: 'text-stone-800',
                hoverBg: 'hover:bg-amber-100',
                button: { bg: 'bg-amber-100', text: 'text-stone-700', hoverBg: 'hover:bg-amber-200' },
                primaryButton: { bg: 'bg-orange-700', text: 'text-white', hoverBg: 'hover:bg-orange-800' },
            };
        case 'light':
        default:
            return {
                mainBg: 'bg-slate-50',
                text: 'text-slate-900',
                mutedText: 'text-slate-500',
                border: 'border-slate-200',
                cardBg: 'bg-white',
                popupBg: 'bg-white',
                popupText: 'text-slate-900',
                hoverBg: 'hover:bg-slate-100',
                button: { bg: 'bg-white', text: 'text-slate-700', hoverBg: 'hover:bg-slate-100' },
                primaryButton: { bg: 'bg-blue-600', text: 'text-white', hoverBg: 'hover:bg-blue-700' },
            };
    }
};

const SETTINGS_STORAGE_KEY = 'chinese_analyzer_settings_v3';
const VOCABULARY_STORAGE_KEY = 'chinese_analyzer_vocabulary_v5';

const defaultSettings: AppSettings = {
    apiKey: '',
    fontSize: 16,
    hanziFontSize: 24,
    fontFamily: 'font-sans',
    theme: 'dark',
    lineHeight: 1.8,
};

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [settings, setSettings] = useState<AppSettings>(() => {
        try {
            const storedSettings = localStorage.getItem(SETTINGS_STORAGE_KEY);
            return storedSettings ? { ...defaultSettings, ...JSON.parse(storedSettings) } : defaultSettings;
        } catch (error) {
            console.error("Failed to parse settings from localStorage", error);
            return defaultSettings;
        }
    });

    const [vocabulary, setVocabulary] = useState<VocabularyItem[]>(() => {
        try {
            const storedVocabulary = localStorage.getItem(VOCABULARY_STORAGE_KEY);
            return storedVocabulary ? JSON.parse(storedVocabulary) : [];
        } catch (error) {
            console.error("Failed to parse vocabulary from localStorage", error);
            return [];
        }
    });

    useEffect(() => {
        try {
            localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
        } catch (error) {
            console.error("Failed to save settings to localStorage", error);
        }
    }, [settings]);

    useEffect(() => {
        try {
            localStorage.setItem(VOCABULARY_STORAGE_KEY, JSON.stringify(vocabulary));
        } catch (error) {
            console.error("Failed to save vocabulary to localStorage", error);
        }
    }, [vocabulary]);
    
    const themeClasses = useMemo(() => getThemeClasses(settings.theme), [settings.theme]);

    const value = {
        settings,
        setSettings,
        theme: themeClasses,
        vocabulary,
        setVocabulary,
    };

    return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
};