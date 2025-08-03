import React from 'react';
import type { AnalysisScope } from '../types';
import { DocumentTextIcon, BookmarkSquareIcon, GlobeAltIcon } from './common/icons';

interface AnalysisModeSelectorProps {
    currentScope: AnalysisScope;
    onScopeChange: (scope: AnalysisScope) => void;
    isDisabled: boolean;
}

const options: { scope: AnalysisScope; label: string; icon: React.FC<React.SVGProps<SVGSVGElement>> }[] = [
    { scope: 'CHUNK', label: 'Theo đoạn', icon: DocumentTextIcon },
    { scope: 'CHAPTER', label: 'Theo chương', icon: BookmarkSquareIcon },
    { scope: 'FULL_TEXT', label: 'Toàn bộ', icon: GlobeAltIcon },
];

export const AnalysisModeSelector: React.FC<AnalysisModeSelectorProps> = ({ currentScope, onScopeChange, isDisabled }) => {
    return (
        <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Chế độ phân tích</label>
            <div className="flex items-center gap-2 rounded-lg bg-slate-100 p-1">
                {options.map(({ scope, label, icon: Icon }) => (
                    <button
                        key={scope}
                        onClick={() => onScopeChange(scope)}
                        disabled={isDisabled}
                        className={`w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-semibold rounded-md transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-100 ${
                            currentScope === scope
                                ? 'bg-white text-blue-600 shadow-sm'
                                : 'text-slate-600 hover:bg-white/60'
                        } ${isDisabled ? 'cursor-not-allowed opacity-60' : ''}`}
                    >
                        <Icon className="w-5 h-5" />
                        <span>{label}</span>
                    </button>
                ))}
            </div>
        </div>
    );
};
