
import { GrammarRole } from './types';

export const GRAMMAR_COLOR_MAP: Record<GrammarRole, { text: string; bg: string; border: string; }> = {
    [GrammarRole.SUBJECT]: { text: 'text-blue-800', bg: 'bg-blue-100', border: 'border-blue-300' },
    [GrammarRole.PREDICATE]: { text: 'text-red-800', bg: 'bg-red-100', border: 'border-red-300' },
    [GrammarRole.OBJECT]: { text: 'text-green-800', bg: 'bg-green-100', border: 'border-green-300' },
    [GrammarRole.ADVERBIAL]: { text: 'text-purple-800', bg: 'bg-purple-100', border: 'border-purple-300' },
    [GrammarRole.COMPLEMENT]: { text: 'text-yellow-800', bg: 'bg-yellow-100', border: 'border-yellow-300' },
    [GrammarRole.ATTRIBUTE]: { text: 'text-indigo-800', bg: 'bg-indigo-100', border: 'border-indigo-300' },
    [GrammarRole.PARTICLE]: { text: 'text-pink-800', bg: 'bg-pink-100', border: 'border-pink-300' },
    [GrammarRole.INTERJECTION]: { text: 'text-gray-800', bg: 'bg-gray-200', border: 'border-gray-400' },
    [GrammarRole.CONJUNCTION]: { text: 'text-teal-800', bg: 'bg-teal-100', border: 'border-teal-300' },
    [GrammarRole.NUMERAL]: { text: 'text-orange-800', bg: 'bg-orange-100', border: 'border-orange-300' },
    [GrammarRole.MEASURE_WORD]: { text: 'text-cyan-800', bg: 'bg-cyan-100', border: 'border-cyan-300' },
    [GrammarRole.UNKNOWN]: { text: 'text-slate-800', bg: 'bg-slate-100', border: 'border-slate-300' },
};
