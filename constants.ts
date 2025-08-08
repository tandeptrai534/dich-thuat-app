


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
        [GrammarRole.SUBJECT]: { text: 'text-blue-900', bg: 'bg-blue-500', border: 'border-blue-600' },
        [GrammarRole.PREDICATE]: { text: 'text-red-900', bg: 'bg-red-500', border: 'border-red-600' },
        [GrammarRole.OBJECT]: { text: 'text-green-900', bg: 'bg-green-500', border: 'border-green-600' },
        [GrammarRole.ADVERBIAL]: { text: 'text-purple-900', bg: 'bg-purple-500', border: 'border-purple-600' },
        [GrammarRole.COMPLEMENT]: { text: 'text-amber-900', bg: 'bg-amber-500', border: 'border-amber-600' },
        [GrammarRole.ATTRIBUTE]: { text: 'text-indigo-900', bg: 'bg-indigo-500', border: 'border-indigo-600' },
        [GrammarRole.PARTICLE]: { text: 'text-pink-900', bg: 'bg-pink-500', border: 'border-pink-600' },
        [GrammarRole.INTERJECTION]: { text: 'text-gray-800', bg: 'bg-gray-500', border: 'border-gray-600' },
        [GrammarRole.CONJUNCTION]: { text: 'text-teal-900', bg: 'bg-teal-500', border: 'border-teal-600' },
        [GrammarRole.NUMERAL]: { text: 'text-orange-900', bg: 'bg-orange-500', border: 'border-orange-600' },
        [GrammarRole.MEASURE_WORD]: { text: 'text-cyan-900', bg: 'bg-cyan-500', border: 'border-cyan-600' },
        [GrammarRole.UNKNOWN]: { text: 'text-slate-800', bg: 'bg-slate-500', border: 'border-slate-600' },
    };

    if (isDark) {
        return {
            [GrammarRole.SUBJECT]: { text: 'text-blue-400', bg: 'bg-blue-400', border: 'border-blue-500' },
            [GrammarRole.PREDICATE]: { text: 'text-red-400', bg: 'bg-red-400', border: 'border-red-500' },
            [GrammarRole.OBJECT]: { text: 'text-green-400', bg: 'bg-green-400', border: 'border-green-500' },
            [GrammarRole.ADVERBIAL]: { text: 'text-purple-400', bg: 'bg-purple-400', border: 'border-purple-500' },
            [GrammarRole.COMPLEMENT]: { text: 'text-amber-400', bg: 'bg-amber-400', border: 'border-amber-500' },
            [GrammarRole.ATTRIBUTE]: { text: 'text-indigo-400', bg: 'bg-indigo-400', border: 'border-indigo-500' },
            [GrammarRole.PARTICLE]: { text: 'text-pink-400', bg: 'bg-pink-400', border: 'border-pink-500' },
            [GrammarRole.INTERJECTION]: { text: 'text-gray-400', bg: 'bg-gray-400', border: 'border-gray-500' },
            [GrammarRole.CONJUNCTION]: { text: 'text-teal-300', bg: 'bg-teal-300', border: 'border-teal-400' },
            [GrammarRole.NUMERAL]: { text: 'text-orange-400', bg: 'bg-orange-400', border: 'border-orange-500' },
            [GrammarRole.MEASURE_WORD]: { text: 'text-cyan-400', bg: 'bg-cyan-400', border: 'border-cyan-500' },
            [GrammarRole.UNKNOWN]: { text: 'text-slate-400', bg: 'bg-slate-400', border: 'border-slate-500' },
        };
    }
    
    if (isSepia) {
        return {
            ...lightColors,
            [GrammarRole.COMPLEMENT]: { text: 'text-orange-900', bg: 'bg-orange-500', border: 'border-orange-600' },
            [GrammarRole.INTERJECTION]: { text: 'text-stone-800', bg: 'bg-stone-500', border: 'border-stone-600' },
            [GrammarRole.UNKNOWN]: { text: 'text-stone-800', bg: 'bg-stone-500', border: 'border-stone-600' },
        };
    }

    return lightColors;
};