
import React, { useState } from 'react';
import { GRAMMAR_COLOR_MAP } from '../constants';
import type { TokenData, FontSize } from '../types';
import { GrammarRole } from '../types';
import { useSettings } from '../App';
import { StarIcon } from './common/icons';


interface TokenProps {
    token: TokenData;
    onSave: (token: TokenData) => void;
}

export const Token: React.FC<TokenProps> = ({ token, onSave }) => {
    const [isPopupVisible, setIsPopupVisible] = useState(false);
    const { settings, theme } = useSettings();
    
    const colorClasses = GRAMMAR_COLOR_MAP[token.grammarRole] || GRAMMAR_COLOR_MAP[GrammarRole.UNKNOWN];
    const tokenTextColor = settings.theme === 'dark' ? `text-${colorClasses.bg.split('-')[1]}-300` : colorClasses.text;
    const tokenBgColor = settings.theme === 'dark' ? `${colorClasses.bg.replace('100', '900')}/50` : colorClasses.bg;

    const handleTogglePopup = (e: React.MouseEvent) => {
        e.stopPropagation(); // Prevent click from bubbling up to sentence container
        setIsPopupVisible(p => !p);
    };
    
    const handleSaveClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        onSave(token);
    };

    return (
        <div className="relative flex flex-col items-center group">
            <button 
                onClick={handleSaveClick}
                className="absolute -top-2 -right-2 z-10 p-1 rounded-full text-amber-300 bg-slate-600/50 opacity-0 group-hover:opacity-100 transition-opacity hover:text-amber-400"
                title="Lưu vào từ điển"
            >
                <StarIcon className="w-4 h-4" />
            </button>
            <div 
                className="flex flex-col items-center cursor-pointer text-center p-2 rounded-md transition-all duration-200 hover:bg-slate-200/50 dark:hover:bg-gray-700/50"
                onClick={handleTogglePopup}
            >
                <span className={`text-sm ${theme.mutedText} mb-1`}>{token.pinyin}</span>
                <span
                    className={`font-semibold px-2 py-1 rounded-md ${tokenTextColor} ${tokenBgColor}`}
                    style={{ fontSize: '1.75em' }}
                >
                    {token.character}
                </span>
                <span className={`text-xs ${theme.text} mt-1 font-medium`}>{token.sinoVietnamese}</span>
            </div>
            
            {isPopupVisible && (
                 <div className={`absolute bottom-full mb-2 w-64 left-1/2 -translate-x-1/2 p-3 z-20 ${theme.popupBg} ${theme.popupText} text-sm rounded-lg shadow-xl transform -translate-y-1`}>
                     <div className="font-bold text-base mb-2 flex items-center gap-2">
                        <span className={`w-3 h-3 rounded-full ${colorClasses.bg}`}></span>
                        <span className={settings.theme === 'dark' ? `text-${colorClasses.bg.split('-')[1]}-300` : colorClasses.text}>{token.grammarRole}</span>
                     </div>
                     <p className="mb-2"><b>Nghĩa:</b> {token.vietnameseMeaning}</p>
                     <p>{token.grammarExplanation}</p>
                      <div className={`absolute left-1/2 -translate-x-1/2 top-full w-0 h-0 border-x-8 border-x-transparent border-t-8`} style={{ borderTopColor: theme.popupBg.startsWith('bg-') ? 'var(--fallback-color, black)' : theme.popupBg }}></div>
                 </div>
            )}
        </div>
    );
};
