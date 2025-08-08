

import { GrammarRole, Theme } from './types';

export const GRAMMAR_ROLE_TRANSLATIONS: Record<GrammarRole, { vi: string, en: string }> = {
    [GrammarRole.SUBJECT]: { vi: 'Chủ ngữ', en: 'Subject' },
    [GrammarRole.PREDICATE]: { vi: 'Vị ngữ', en: 'Predicate' },
    [GrammarRole.OBJECT]: { vi: 'Tân ngữ', en: 'Object' },
    [GrammarRole.ADVERBIAL]: { vi: 'Trạng ngữ', en: 'Adverbial' },
    [GrammarRole.COMPLEMENT]: { vi: 'Bổ ngữ', en: 'Complement' },
    [GrammarRole.ATTRIBUTE]: { vi: 'Định ngữ', en: 'Attribute' },
    [GrammarRole.PARTICLE]: { vi: 'Trợ từ', en: 'Particle' },
    [GrammarRole.INTERJECTION]: { vi: 'Thán từ', en: 'Interjection' },
    [GrammarRole.CONJUNCTION]: { vi: 'Liên từ', en: 'Conjunction' },
    [GrammarRole.NUMERAL]: { vi: 'Số từ', en: 'Numeral' },
    [GrammarRole.MEASURE_WORD]: { vi: 'Lượng từ', en: 'Measure Word' },
    [GrammarRole.UNKNOWN]: { vi: 'Không xác định', en: 'Unknown' },
};


export const getGrammarColorMap = (theme: Theme): Record<GrammarRole, { text: string; bg: string; border: string; }> => {
    const isDark = theme === 'dark';
    const isSepia = theme === 'sepia';

    const lightColors = {
        [GrammarRole.SUBJECT]: { text: 'text-blue-900', bg: 'bg-blue-200', border: 'border-blue-300' },
        [GrammarRole.PREDICATE]: { text: 'text-red-900', bg: 'bg-red-200', border: 'border-red-300' },
        [GrammarRole.OBJECT]: { text: 'text-green-900', bg: 'bg-green-200', border: 'border-green-300' },
        [GrammarRole.ADVERBIAL]: { text: 'text-purple-900', bg: 'bg-purple-200', border: 'border-purple-300' },
        [GrammarRole.COMPLEMENT]: { text: 'text-amber-900', bg: 'bg-amber-200', border: 'border-amber-400' },
        [GrammarRole.ATTRIBUTE]: { text: 'text-indigo-900', bg: 'bg-indigo-200', border: 'border-indigo-300' },
        [GrammarRole.PARTICLE]: { text: 'text-pink-900', bg: 'bg-pink-200', border: 'border-pink-300' },
        [GrammarRole.INTERJECTION]: { text: 'text-gray-800', bg: 'bg-gray-300', border: 'border-gray-400' },
        [GrammarRole.CONJUNCTION]: { text: 'text-teal-900', bg: 'bg-teal-200', border: 'border-teal-300' },
        [GrammarRole.NUMERAL]: { text: 'text-orange-900', bg: 'bg-orange-200', border: 'border-orange-300' },
        [GrammarRole.MEASURE_WORD]: { text: 'text-cyan-900', bg: 'bg-cyan-200', border: 'border-cyan-300' },
        [GrammarRole.UNKNOWN]: { text: 'text-slate-800', bg: 'bg-slate-200', border: 'border-slate-400' },
    };

    if (isDark) {
        return {
            [GrammarRole.SUBJECT]: { text: 'text-blue-400', bg: 'bg-blue-800/40', border: 'border-blue-700/60' },
            [GrammarRole.PREDICATE]: { text: 'text-red-400', bg: 'bg-red-800/40', border: 'border-red-700/60' },
            [GrammarRole.OBJECT]: { text: 'text-green-400', bg: 'bg-green-800/40', border: 'border-green-700/60' },
            [GrammarRole.ADVERBIAL]: { text: 'text-purple-400', bg: 'bg-purple-800/40', border: 'border-purple-700/60' },
            [GrammarRole.COMPLEMENT]: { text: 'text-amber-400', bg: 'bg-amber-800/40', border: 'border-amber-700/60' },
            [GrammarRole.ATTRIBUTE]: { text: 'text-indigo-400', bg: 'bg-indigo-800/40', border: 'border-indigo-700/60' },
            [GrammarRole.PARTICLE]: { text: 'text-pink-400', bg: 'bg-pink-800/40', border: 'border-pink-700/60' },
            [GrammarRole.INTERJECTION]: { text: 'text-gray-400', bg: 'bg-gray-700/60', border: 'border-gray-600/80' },
            [GrammarRole.CONJUNCTION]: { text: 'text-teal-300', bg: 'bg-teal-800/40', border: 'border-teal-700/60' },
            [GrammarRole.NUMERAL]: { text: 'text-orange-400', bg: 'bg-orange-800/40', border: 'border-orange-700/60' },
            [GrammarRole.MEASURE_WORD]: { text: 'text-cyan-400', bg: 'bg-cyan-800/40', border: 'border-cyan-700/60' },
            [GrammarRole.UNKNOWN]: { text: 'text-slate-400', bg: 'bg-slate-700/60', border: 'border-slate-600/80' },
        };
    }
    
    if (isSepia) {
        return {
            ...lightColors,
            [GrammarRole.COMPLEMENT]: { text: 'text-orange-900', bg: 'bg-orange-200', border: 'border-orange-300' },
            [GrammarRole.INTERJECTION]: { text: 'text-stone-800', bg: 'bg-stone-300', border: 'border-stone-400' },
            [GrammarRole.UNKNOWN]: { text: 'text-stone-800', bg: 'bg-stone-300', border: 'border-stone-400' },
        };
    }

    return lightColors;
};