
import React from 'react';
import type { AnalyzedText, TokenData } from '../types';
import { Token } from './Token';
import { CopyIcon } from './common/icons';
import { GRAMMAR_COLOR_MAP } from '../constants';
import { GrammarRole } from '../types';
import { useSettings } from '../App';


const CopyButton: React.FC<{ textToCopy: string; className?: string; children: React.ReactNode }> = ({ textToCopy, className, children }) => {
    const { theme } = useSettings();
    const [copied, setCopied] = React.useState(false);
    const handleClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        navigator.clipboard.writeText(textToCopy).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    };
    return (
        <button onClick={handleClick} className={`flex items-center gap-2 text-sm font-medium p-2 rounded-lg transition-colors ${className}`} title="Sao chép">
            {children}
            {copied && <span className="text-xs">Đã sao chép!</span>}
        </button>
    );
};


interface OutputDisplayProps {
    data: AnalyzedText;
    onSaveToken: (token: TokenData) => void;
}

export const OutputDisplay: React.FC<OutputDisplayProps> = ({ data, onSaveToken }) => {
    const { settings, theme } = useSettings();
    
    if (!data || !data.tokens) return null;

    const originalSentence = data.tokens.map(t => t.character).join('');
    const translationText = data.translation.map(s => s.segment).join('');

    const getFullAnalysisText = () => {
        let text = `Câu gốc: ${originalSentence}\n`;
        text += `Bản dịch: ${translationText}\n\n`;
        text += `Phân tích chi tiết:\n`;
        data.tokens.forEach(t => {
            text += `- ${t.character} (${t.pinyin} / ${t.sinoVietnamese}): ${t.grammarRole}. Nghĩa: ${t.vietnameseMeaning}\n`;
        });
        return text;
    };

    return (
        <div className="flex flex-col gap-4 p-3">
            <div className="flex justify-between items-center">
                <h3 className={`text-md font-bold ${theme.text}`}>Bản dịch:</h3>
                 <CopyButton textToCopy={translationText} className={`${theme.mutedText} ${theme.hoverBg}`}>
                    <CopyIcon className="w-4 h-4" />
                </CopyButton>
            </div>
            <p className={`text-md ${theme.text} leading-relaxed`}>
                {data.translation.map((segment, index) => {
                    const color = GRAMMAR_COLOR_MAP[segment.grammarRole] || GRAMMAR_COLOR_MAP[GrammarRole.UNKNOWN];
                    const tokenTextColor = settings.theme === 'dark' ? `text-${color.bg.split('-')[1]}-300` : color.text;
                    const tokenBgColor = settings.theme === 'dark' ? `${color.bg.replace('100', '900')}/50` : color.bg;
                    return (
                        <span key={index} className={`px-1 py-0.5 rounded ${tokenBgColor} ${tokenTextColor}`}>
                            {segment.segment}
                        </span>
                    )
                })}
            </p>
            
            <div>
                 <h3 className={`text-md font-bold ${theme.text} mb-2`}>Phân tích ngữ pháp:</h3>
                <div className={`flex flex-wrap gap-x-2 gap-y-4 ${theme.mainBg} p-3 rounded-md`}>
                    {data.tokens.map((token, tIndex) => (
                        <Token key={`${tIndex}`} token={token} onSave={onSaveToken} />
                    ))}
                </div>
            </div>

            <div className="flex justify-end mt-2">
                 <CopyButton textToCopy={getFullAnalysisText()} className="text-blue-600 bg-blue-50 hover:bg-blue-100 dark:text-blue-300 dark:bg-blue-900/50 dark:hover:bg-blue-900">
                    <CopyIcon className="w-4 h-4" />
                    <span>Sao chép toàn bộ phân tích</span>
                </CopyButton>
            </div>
        </div>
    );
};
