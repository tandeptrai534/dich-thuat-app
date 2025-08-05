


import React from 'react';
import type { AnalyzedText } from '../types';
import { Token } from './Token';
import { CopyIcon } from './common/icons';
import { useSettings } from '../contexts/settingsContext';


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
}

export const OutputDisplay: React.FC<OutputDisplayProps> = ({ data }) => {
    const { theme } = useSettings();
    
    if (!data || !data.tokens) return null;

    const originalSentence = data.tokens.map(t => t.character).join('');
    const sentenceStructureText = data.sentenceGrammarExplanation || '';

    const getFullAnalysisText = () => {
        let text = `Câu gốc: ${originalSentence}\n\n`;
        text += `Phân tích cấu trúc câu:\n${sentenceStructureText}\n\n`;
        text += `Phân tích chi tiết từng từ:\n`;
        data.tokens.forEach(t => {
            text += `- ${t.character} (${t.pinyin} / ${t.sinoVietnamese}): ${t.grammarRole}. Nghĩa: ${t.vietnameseMeaning}. Giải thích: ${t.grammarExplanation}\n`;
        });
        return text;
    };

    return (
        <div className="flex flex-col gap-4 p-3">
            <div className="relative">
                <div className="flex justify-between items-center mb-2">
                    <h3 className={`text-md font-bold ${theme.text}`}>Phân tích cấu trúc câu</h3>
                    <CopyButton textToCopy={sentenceStructureText} className={`${theme.mutedText} ${theme.hoverBg}`}>
                        <CopyIcon className="w-4 h-4" />
                    </CopyButton>
                </div>
                <p className={`text-md ${theme.text} leading-relaxed p-3 rounded-md ${theme.mainBg}`}>
                    {sentenceStructureText}
                </p>
            </div>
            
            <div>
                 <h3 className={`text-md font-bold ${theme.text} mb-2`}>Phân tích chi tiết từng từ:</h3>
                <div className={`flex flex-wrap gap-x-2 gap-y-4 ${theme.mainBg} p-3 rounded-md`}>
                    {data.tokens.map((token, tIndex) => (
                        <Token key={`${tIndex}`} token={token} />
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
