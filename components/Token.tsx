


import React, { useState, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { GRAMMAR_COLOR_MAP } from '../constants';
import type { TokenData } from '../types';
import { GrammarRole } from '../types';
import { useSettings } from '../contexts/settingsContext';
import { CloseIcon } from './common/icons';

const CHINESE_PUNCTUATION_REGEX = /^[，。！？；：、“”《》【】（）…—–_.,?!;:"'()\[\]{}]+$/;
const isChinesePunctuation = (char: string) => CHINESE_PUNCTUATION_REGEX.test(char.trim());

interface TokenProps {
    token: TokenData;
}

export const Token: React.FC<TokenProps> = ({ token }) => {
    const [isPopupVisible, setIsPopupVisible] = useState(false);
    const { settings, theme } = useSettings();
    const anchorRef = useRef<HTMLDivElement>(null);
    const popupRef = useRef<HTMLDivElement>(null);
    const [style, setStyle] = useState<React.CSSProperties>({});
    
    const colorClasses = GRAMMAR_COLOR_MAP[token.grammarRole] || GRAMMAR_COLOR_MAP[GrammarRole.UNKNOWN];
    const tokenTextColor = settings.theme === 'dark' ? `text-${colorClasses.bg.split('-')[1]}-300` : colorClasses.text;
    const tokenBgColor = settings.theme === 'dark' ? `${colorClasses.bg.replace('100', '900')}/50` : colorClasses.bg;

    const handleTogglePopup = (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsPopupVisible(p => !p);
    };

    useEffect(() => {
        if (isPopupVisible && anchorRef.current && popupRef.current) {
            const anchorRect = anchorRef.current.getBoundingClientRect();
            const popupRect = popupRef.current.getBoundingClientRect();
            const { innerWidth, innerHeight } = window;
            const margin = 8;
            let top = anchorRect.top - popupRect.height - margin;
            let left = anchorRect.left + (anchorRect.width / 2) - (popupRect.width / 2);

            // Check vertical overflow and flip if necessary
            if (top < margin) {
                top = anchorRect.bottom + margin;
            }
            // Check horizontal overflow
            if (left < margin) {
                left = margin;
            }
            if (left + popupRect.width > innerWidth - margin) {
                left = innerWidth - popupRect.width - margin;
            }

            setStyle({ top, left, position: 'fixed', visibility: 'visible' });
        }

        const handleClose = (e: MouseEvent | KeyboardEvent) => {
            if (e instanceof KeyboardEvent && e.key === 'Escape') {
                setIsPopupVisible(false);
            } else if (e instanceof MouseEvent) {
                // Close if the click is outside the popup
                if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
                    setIsPopupVisible(false);
                }
            }
        };

        if (isPopupVisible) {
            document.addEventListener('mousedown', handleClose);
            document.addEventListener('keydown', handleClose);
        }

        return () => {
            document.removeEventListener('mousedown', handleClose);
            document.removeEventListener('keydown', handleClose);
        };
    }, [isPopupVisible]);

    const isPunc = isChinesePunctuation(token.character);
    const charStyle = {
        fontSize: isPunc ? `${settings.fontSize}px` : `${settings.hanziFontSize}px`,
        lineHeight: 1,
    };

    return (
        <>
            <div 
                ref={anchorRef}
                className="relative flex flex-col items-center group cursor-pointer"
                onClick={handleTogglePopup}
            >
                <div className="flex flex-col items-center text-center p-2 rounded-md transition-all duration-200 group-hover:bg-slate-200/50 dark:group-hover:bg-gray-700/50">
                    <span className={`text-sm ${theme.mutedText} mb-1`}>{token.pinyin}</span>
                    <span
                        className={`font-semibold px-2 py-1 rounded-md ${tokenTextColor} ${tokenBgColor}`}
                        style={charStyle}
                    >
                        {token.character}
                    </span>
                    <span className={`text-xs ${theme.text} mt-1 font-medium`}>{token.sinoVietnamese}</span>
                </div>
            </div>
            
            {isPopupVisible && ReactDOM.createPortal(
                <div
                    ref={popupRef}
                    style={{ ...style, visibility: isPopupVisible ? 'visible' : 'hidden' }}
                    className={`absolute w-64 p-4 z-50 ${theme.popupBg} ${theme.popupText} text-sm rounded-lg shadow-2xl border ${theme.border} transition-opacity duration-200`}
                    onClick={(e) => e.stopPropagation()}
                >
                    <button 
                        onClick={() => setIsPopupVisible(false)}
                        className={`absolute top-2 right-2 p-1.5 rounded-full ${theme.mutedText} hover:bg-slate-500/20`}
                        aria-label="Đóng popup"
                    >
                        <CloseIcon className="w-5 h-5" />
                    </button>
                    <div className="font-bold text-base mb-2 flex items-center gap-2 pr-6">
                       <span className={`w-3 h-3 rounded-full ${colorClasses.bg}`}></span>
                       <span className={settings.theme === 'dark' ? `text-${colorClasses.bg.split('-')[1]}-300` : colorClasses.text}>{token.grammarRole}</span>
                    </div>
                    <p className="mb-2"><b>Nghĩa:</b> {token.vietnameseMeaning}</p>
                    <p>{token.grammarExplanation}</p>
                </div>,
                 document.body
            )}
        </>
    );
};
