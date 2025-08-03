
import React, { useState, useCallback, useRef, useEffect, createContext, useContext } from 'react';
import { analyzeSentence, translateChapter } from './services/geminiService';
import type { ApiError, ChapterData, ProcessedFile, AppSettings, Theme, FontSize, FontFamily, SentenceData, AnalyzedText, TokenData } from './types';
import { InputArea } from './components/InputArea';
import { GithubIcon, ChevronDownIcon, CopyIcon, CloseIcon, SettingsIcon, CheckIcon, PlayIcon, BookOpenIcon, StarIcon, ArchiveBoxIcon } from './components/common/icons';
import { Spinner } from './components/common/Spinner';
import { WorkspaceTabs } from './components/WorkspaceTabs';
import { OutputDisplay } from './components/OutputDisplay';
import { GRAMMAR_COLOR_MAP } from './constants';
import { GrammarRole } from './types';


// --- Constants ---
const DEFAULT_CHAPTER_TITLE = 'Văn bản chính';
const MAX_CHAPTER_LENGTH = 5000;
const PAGE_SIZE = 10;
const SETTINGS_STORAGE_KEY = 'chinese_analyzer_settings';
const ANALYSIS_CACHE_STORAGE_KEY = 'chinese_analyzer_analysis_cache';
const TRANSLATION_CACHE_STORAGE_KEY = 'chinese_analyzer_translation_cache';
const VOCABULARY_STORAGE_KEY = 'chinese_analyzer_vocabulary';

// --- Theme & Settings ---
const getThemeClasses = (theme: Theme) => {
    switch (theme) {
        case 'dark':
            return {
                mainBg: 'bg-gray-900', text: 'text-slate-200',
                cardBg: 'bg-gray-800', border: 'border-gray-700',
                hoverBg: 'hover:bg-gray-700', popupBg: 'bg-slate-200',
                popupText: 'text-slate-800', mutedText: 'text-slate-400',
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

export const SettingsContext = createContext<{ settings: AppSettings; theme: ReturnType<typeof getThemeClasses>; setSettings: React.Dispatch<React.SetStateAction<AppSettings>> } | null>(null);
export const useSettings = () => {
    const context = useContext(SettingsContext);
    if (!context) throw new Error("useSettings must be used within a SettingsProvider");
    return context;
};

// --- Helper Functions ---
function splitLargeChapter(title: string, content: string): Pick<ChapterData, 'title' | 'sentences'>[] {
    const createSentences = (text: string) => text.split('\n').map(s => s.trim()).filter(s => {
        const punctuationOnlyRegex = /^[“”…"'.!?,;:\s]+$/;
        return s && !punctuationOnlyRegex.test(s);
    }).map(s => ({
        original: s,
        analysisState: 'pending' as const,
        isExpanded: false
    }));

    if (content.length <= MAX_CHAPTER_LENGTH) {
        return [{ title, sentences: createSentences(content) }];
    }

    const chunks: Pick<ChapterData, 'title' | 'sentences'>[] = [];
    let remainingContent = content;
    let partNumber = 1;

    while (remainingContent.length > 0) {
        const currentTitle = partNumber === 1 ? title : `${title} (Phần ${partNumber})`;
        let partContent: string;

        if (remainingContent.length <= MAX_CHAPTER_LENGTH * 1.2) {
            partContent = remainingContent;
            remainingContent = '';
        } else {
            let splitAt = -1;
            const punctuation = ['\n', '。', '！', '？'];
            for (const p of punctuation) {
                const lastPunc = remainingContent.lastIndexOf(p, MAX_CHAPTER_LENGTH);
                if (lastPunc > splitAt) {
                    splitAt = lastPunc;
                }
            }

            if (splitAt < MAX_CHAPTER_LENGTH / 2) {
                const fallbackSplit = remainingContent.lastIndexOf(' ', MAX_CHAPTER_LENGTH);
                splitAt = fallbackSplit > 0 ? fallbackSplit : MAX_CHAPTER_LENGTH;
            }

            partContent = remainingContent.substring(0, splitAt + 1);
            remainingContent = remainingContent.substring(splitAt + 1);
        }

        const trimmedContent = partContent.trim();
        if (trimmedContent) {
            chunks.push({
                title: currentTitle,
                sentences: createSentences(trimmedContent),
            });
        }
        partNumber++;
    }
    return chunks;
}


function processTextIntoChapters(text: string): ChapterData[] {
    const chapters: ChapterData[] = [];
    const CHAPTER_REGEX = /^(?:Chương|Hồi|Quyển|Chapter|卷|第)\s*(\d+|[一二三四五六七八九十百千]+)\s*(?:(?:章|回|节|話|篇|卷之)\s*.*|[:：]\s*.*|$)/gm;
    const chapterMatches = [...text.matchAll(CHAPTER_REGEX)];

    const createChapterData = (title: string, content: string): void => {
        splitLargeChapter(title, content).forEach(chunk => {
            const titleSentence: SentenceData = {
                original: chunk.title,
                analysisState: 'pending',
                isExpanded: false,
                isTitle: true,
            };

            chapters.push({
                title: chunk.title,
                sentences: [titleSentence, ...chunk.sentences],
                translationState: 'pending',
                isExpanded: false,
            });
        });
    };

    if (chapterMatches.length === 0) {
        if (text.trim()) {
            createChapterData(DEFAULT_CHAPTER_TITLE, text.trim());
        }
        return chapters;
    }

    const textBeforeFirstChapter = text.substring(0, chapterMatches[0].index).trim();
    if (textBeforeFirstChapter) {
        createChapterData('Phần mở đầu', textBeforeFirstChapter);
    }

    chapterMatches.forEach((match, i) => {
        const chapterTitle = match[0].trim().replace(/\s+/g, ' ');
        const contentStartIndex = match.index! + match[0].length;
        const nextChapterIndex = (i + 1 < chapterMatches.length) ? chapterMatches[i + 1].index : text.length;
        const chapterContent = text.substring(contentStartIndex, nextChapterIndex).trim();

        if (chapterContent) {
            createChapterData(chapterTitle, chapterContent);
        }
    });

    return chapters;
}


// --- UI Components ---

const AdvancedCopyButton: React.FC<{ chapter: ChapterData }> = ({ chapter }) => {
    const { theme } = useSettings();
    const [isOptionsOpen, setIsOptionsOpen] = useState(false);
    const [copyOptions, setCopyOptions] = useState({
        original: true,
        pinyin: true,
        sinoVietnamese: true,
        translation: true,
    });
    const [justCopied, setJustCopied] = useState(false);

    const handleCopy = () => {
        let fullText = '';
        const analyzedSentences = chapter.sentences.filter(s => s.analysisState === 'done' && s.analysisResult);
        
        if (copyOptions.original) {
            fullText += '--- VĂN BẢN GỐC ---\n';
            fullText += chapter.sentences.map(s => s.original).join('\n') + '\n\n';
        }
        if (copyOptions.pinyin) {
            fullText += '--- PINYIN ---\n';
            fullText += analyzedSentences.map(s => s.analysisResult!.tokens.map(t => t.pinyin).join(' ')).join('\n') + '\n\n';
        }
        if (copyOptions.sinoVietnamese) {
            fullText += '--- HÁN VIỆT ---\n';
            fullText += analyzedSentences.map(s => s.analysisResult!.tokens.map(t => t.sinoVietnamese).join(' ')).join('\n') + '\n\n';
        }
        if (copyOptions.translation && chapter.translationResult) {
            fullText += '--- BẢN DỊCH ---\n';
            fullText += chapter.translationResult + '\n';
        }
        
        navigator.clipboard.writeText(fullText.trim());
        setJustCopied(true);
        setTimeout(() => setJustCopied(false), 2000);
        setIsOptionsOpen(false);
    };

    const CheckboxOption: React.FC<{ id: keyof typeof copyOptions, label: string }> = ({ id, label }) => (
        <label htmlFor={id} className="flex items-center gap-2 p-2 rounded-md hover:bg-slate-200 dark:hover:bg-gray-700 cursor-pointer">
            <input
                type="checkbox"
                id={id}
                checked={copyOptions[id]}
                onChange={e => setCopyOptions(prev => ({...prev, [id]: e.target.checked }))}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm font-medium">{label}</span>
        </label>
    );

    return (
        <div className="relative">
            <button 
                onClick={() => setIsOptionsOpen(o => !o)}
                className={`flex items-center gap-2 px-4 py-2 ${theme.button.bg} ${theme.button.text} font-semibold rounded-lg shadow-sm ${theme.button.hoverBg} transition-colors`}
            >
                <CopyIcon className="w-4 h-4" />
                <span>{justCopied ? 'Đã sao chép!' : 'Sao chép Nâng cao'}</span>
            </button>
            {isOptionsOpen && (
                <div 
                    className={`absolute bottom-full right-0 mb-2 w-60 p-2 rounded-lg shadow-xl border ${theme.border} ${theme.cardBg} z-10`}
                >
                    <p className={`text-sm font-semibold p-2 ${theme.mutedText}`}>Tùy chọn sao chép:</p>
                    <div className="flex flex-col">
                        <CheckboxOption id="original" label="Văn bản gốc" />
                        <CheckboxOption id="pinyin" label="Pinyin" />
                        <CheckboxOption id="sinoVietnamese" label="Hán Việt" />
                        <CheckboxOption id="translation" label="Bản dịch" />
                    </div>
                    <div className="p-2 mt-1">
                        <button
                            onClick={handleCopy}
                            className={`w-full px-4 py-2 ${theme.primaryButton.bg} ${theme.primaryButton.text} font-semibold rounded-md shadow-sm ${theme.primaryButton.hoverBg} transition-colors`}
                        >
                            Sao chép
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

const SentenceDisplay: React.FC<{
    sentence: SentenceData;
    onClick: () => void;
    onSaveToken: (token: TokenData) => void;
}> = ({ sentence, onClick, onSaveToken }) => {
    const { settings, theme } = useSettings();

    const renderContent = () => {
        const titleSpecificClass = sentence.isTitle ? `text-center border-b-2 ${theme.border} pb-3 mb-3` : '';

        switch(sentence.analysisState) {
            case 'pending':
                return (
                    <div className={`p-3 rounded-lg cursor-pointer ${theme.hoverBg} transition-colors ${titleSpecificClass}`}>
                        {sentence.isTitle ? (
                             <h4 className={`text-xl font-bold ${theme.text}`}>{sentence.original}</h4>
                        ) : (
                            <p>{sentence.original}</p>
                        )}
                    </div>
                );
            case 'loading':
                 return (
                    <div className={`flex items-center justify-center gap-2 p-3 ${titleSpecificClass}`}>
                        <Spinner variant={settings.theme === 'light' ? 'dark' : 'light'} />
                        <span className={theme.mutedText}>Đang phân tích...</span>
                    </div>
                );
            case 'error':
                 return (
                    <div className={`p-3 bg-red-50 text-red-700 rounded-lg cursor-pointer ${titleSpecificClass}`}>
                        <p><strong>Lỗi:</strong> {sentence.error}</p>
                        <p className="font-semibold">Nhấp để thử lại.</p>
                    </div>
                );
            case 'done':
                 if (!sentence.analysisResult) return null;
                 if (sentence.isExpanded) {
                     return (
                         <div className={titleSpecificClass}>
                             <OutputDisplay data={sentence.analysisResult} onSaveToken={onSaveToken} />
                         </div>
                     );
                 }
                 // Collapsed View
                 return (
                     <div className={`p-3 space-y-3 cursor-pointer ${titleSpecificClass}`}>
                         {sentence.isTitle && <h4 className={`text-xl font-bold ${theme.text} mb-2`}>{sentence.original}</h4>}
                         <div className="flex flex-wrap items-end gap-x-2 gap-y-3 leading-tight">
                            {sentence.analysisResult.tokens.map((token, index) => {
                                 const color = GRAMMAR_COLOR_MAP[token.grammarRole] || GRAMMAR_COLOR_MAP[GrammarRole.UNKNOWN];
                                 const tokenTextColor = settings.theme === 'dark' ? `text-${color.bg.split('-')[1]}-300` : color.text;
                                 const tokenBgColor = settings.theme === 'dark' ? `${color.bg.replace('100', '900')}/50` : color.bg;
                                return (
                                    <div key={index} className="inline-flex flex-col items-center text-center mx-0.5">
                                        <span className={`text-xs ${theme.mutedText}`}>{token.pinyin}</span>
                                        <span className={`px-1 rounded ${tokenTextColor} ${tokenBgColor}`} style={{ fontSize: '1.5em' }}>{token.character}</span>
                                        <span className={`text-xs ${theme.mutedText} mt-0.5`}>{token.sinoVietnamese}</span>
                                    </div>
                                );
                            })}
                        </div>
                        <p className="leading-relaxed">
                            {sentence.analysisResult.translation.map((segment, index) => {
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
                     </div>
                 );
        }
    }

    return (
        <div onClick={onClick} className={`rounded-lg border ${theme.border} ${sentence.analysisState !== 'pending' ? theme.cardBg : 'bg-transparent'}`}>
            {renderContent()}
        </div>
    );
};

const ChapterDisplay: React.FC<{
    chapter: ChapterData;
    chapterIndex: number;
    onSentenceClick: (sentenceIndex: number) => void;
    onTranslate: () => void;
    onBackToAnalysis: () => void;
    onUpdate: (update: Partial<ChapterData>) => void;
    onSaveToken: (token: TokenData) => void;
}> = ({ chapter, chapterIndex, onSentenceClick, onTranslate, onBackToAnalysis, onUpdate, onSaveToken }) => {
    const { settings, theme } = useSettings();
    const isTranslating = chapter.translationState === 'loading';
    const isTranslationDone = chapter.translationState === 'done';
    const isTranslationError = chapter.translationState === 'error';
    const isSentenceAnalysisView = chapter.translationState === 'pending';

    const handleToggle = (e: React.SyntheticEvent<HTMLDetailsElement>) => {
        onUpdate({ isExpanded: e.currentTarget.open });
    };
    
    return (
        <details 
            className={`${theme.cardBg} bg-opacity-50 rounded-xl shadow-lg border ${theme.border} overflow-hidden group`} 
            open={chapter.isExpanded}
            onToggle={handleToggle}
        >
            <summary className={`flex justify-between items-center p-4 cursor-pointer hover:${theme.hoverBg} transition-colors`}>
                <div className="flex items-center min-w-0 flex-1">
                    <ChevronDownIcon className={`w-5 h-5 mr-3 ${theme.mutedText} transition-transform duration-200 group-open:rotate-180 flex-shrink-0`} />
                    <span className={`flex-shrink-0 mr-3 px-2.5 py-1 text-xs font-semibold tracking-wider uppercase rounded-full ${theme.button.bg} ${theme.mutedText}`}>
                        #{chapterIndex + 1}
                    </span>
                    <h3 className={`text-lg font-bold ${theme.text} truncate`} title={chapter.title}>{chapter.title}</h3>
                </div>
                 <div className="flex-shrink-0 ml-4">
                    {isSentenceAnalysisView && (
                        <button 
                            onClick={(e) => { e.preventDefault(); onTranslate(); }} 
                            className={`flex items-center gap-2 px-3 py-1.5 text-sm font-semibold rounded-md transition-colors ${theme.button.bg} ${theme.button.text} ${theme.button.hoverBg}`}
                        >
                            <PlayIcon className="w-4 h-4" /> Dịch chương
                        </button>
                    )}
                    {isTranslating && (
                        <div className="flex items-center gap-2 px-3 py-1.5 text-sm">
                            <Spinner variant={settings.theme === 'dark' ? 'light' : 'dark'} />
                            <span className={theme.mutedText}>Đang dịch...</span>
                        </div>
                    )}
                     {isTranslationDone && (
                        <div className="flex items-center gap-2 px-3 py-1.5 text-sm font-semibold text-green-600 dark:text-green-400">
                           <CheckIcon className="w-4 h-4" />
                           <span>Đã dịch & phân tích</span>
                        </div>
                    )}
                </div>
            </summary>
            <div className={`p-4 border-t ${theme.border}`}>
               {isSentenceAnalysisView && (
                   <div className="space-y-2">
                       {chapter.sentences.map((sentence, index) => (
                           <SentenceDisplay
                                key={index}
                                sentence={sentence}
                                onClick={() => onSentenceClick(index)}
                                onSaveToken={onSaveToken}
                           />
                       ))}
                   </div>
               )}
               {isTranslating && (
                   <div className="flex flex-col items-center justify-center p-8 gap-3">
                       <Spinner variant={settings.theme === 'dark' ? 'light' : 'dark'} />
                       <span className={theme.mutedText}>Đang dịch và phân tích nền...</span>
                   </div>
               )}
               {isTranslationError && (
                    <div className="p-3 bg-red-50 text-red-700 rounded-lg">
                        <p><strong>Lỗi dịch:</strong> {chapter.translationError}</p>
                        <button onClick={onTranslate} className={`mt-2 px-3 py-1 ${theme.button.bg} ${theme.button.text} font-semibold rounded-md`}>
                            Thử lại
                        </button>
                    </div>
               )}
               {isTranslationDone && chapter.translationResult && (
                   <div className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <h4 className={`font-semibold mb-2 ${theme.text}`}>Nội dung gốc (đã phân tích):</h4>
                                <div className={`p-3 rounded-md ${theme.mainBg} max-h-[60vh] overflow-y-auto space-y-3`}>
                                    {chapter.sentences.map((sentence, index) => {
                                        if (sentence.analysisState === 'done' && sentence.analysisResult) {
                                            return (
                                                <div key={index} className={`${sentence.isTitle ? 'pb-2 border-b ' + theme.border : ''}`}>
                                                    <p className="flex flex-wrap items-end gap-x-1.5 gap-y-2 leading-tight">
                                                        {sentence.analysisResult.tokens.map((token, tIndex) => {
                                                            const color = GRAMMAR_COLOR_MAP[token.grammarRole] || GRAMMAR_COLOR_MAP[GrammarRole.UNKNOWN];
                                                            const tokenTextColor = settings.theme === 'dark' ? `text-${color.bg.split('-')[1]}-300` : color.text;
                                                            return <span key={tIndex} className={`font-semibold text-lg ${tokenTextColor}`}>{token.character}</span>;
                                                        })}
                                                    </p>
                                                </div>
                                            )
                                        }
                                        return <p key={index} className={`${theme.mutedText} ${sentence.isTitle ? 'font-bold text-lg' : ''}`}>{sentence.original}</p>
                                    })}
                                </div>
                            </div>
                             <div>
                                <h4 className={`font-semibold mb-2 ${theme.text}`}>Bản dịch:</h4>
                                <div className={`p-3 rounded-md ${theme.mainBg} ${theme.text} max-h-[60vh] overflow-y-auto`}>
                                    <pre className="whitespace-pre-wrap font-sans">{chapter.translationResult}</pre>
                                </div>
                            </div>
                        </div>
                       <div className="flex justify-between items-center">
                            <button onClick={onBackToAnalysis} className={`px-4 py-2 ${theme.button.bg} ${theme.button.text} font-semibold rounded-lg shadow-sm ${theme.button.hoverBg} transition-colors`}>
                                Quay lại Phân tích chi tiết
                            </button>
                            <AdvancedCopyButton chapter={chapter} />
                       </div>
                   </div>
               )}
            </div>
        </details>
    );
};

const ChapterNavigator: React.FC<{
    totalChapters: number;
    onRangeChange: (range: { start: number; end: number }) => void;
    pageSize: number;
    currentRange: { start: number; end: number };
    onPageSizeChange: (newSize: number) => void;
}> = ({ totalChapters, onRangeChange, pageSize, currentRange, onPageSizeChange }) => {
    const { theme } = useSettings();
    const [isExpanded, setIsExpanded] = useState(true);
    const [fromInput, setFromInput] = useState('1');
    const [toInput, setToInput] = useState(String(Math.min(pageSize, totalChapters)));

    useEffect(() => {
        setFromInput(String(currentRange.start + 1));
        setToInput(String(currentRange.end));
    }, [currentRange]);

    const numPages = Math.ceil(totalChapters / pageSize);
    const currentPageIndex = Math.floor(currentRange.start / pageSize);

    const handlePageClick = (pageIndex: number) => {
        const start = pageIndex * pageSize;
        const end = Math.min(start + pageSize, totalChapters);
        onRangeChange({ start, end: end });
        setIsExpanded(false);
    };

    const handleCustomRangeSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const from = parseInt(fromInput, 10);
        const to = parseInt(toInput, 10);
        if (isNaN(from) || isNaN(to) || from < 1 || to > totalChapters || from > to) {
            alert("Phạm vi chương không hợp lệ. Vui lòng kiểm tra lại số chương (từ 1 đến " + totalChapters + ").");
            return;
        }
        onRangeChange({ start: from - 1, end: to });
        setIsExpanded(false);
    };

    return (
        <details
            open={isExpanded}
            onToggle={(e) => setIsExpanded(e.currentTarget.open)}
            className={`${theme.cardBg} rounded-xl shadow-lg border ${theme.border} group`}
        >
            <summary className={`flex justify-between items-center p-4 cursor-pointer list-none ${theme.hoverBg} transition-colors`}>
                <h3 className={`text-lg font-semibold ${theme.text}`}>Điều hướng chương</h3>
                <ChevronDownIcon className={`w-5 h-5 ${theme.mutedText} transition-transform duration-200 group-open:rotate-180`} />
            </summary>
            <div className={`p-4 border-t ${theme.border} space-y-4`}>
                <div className="flex items-center gap-3">
                     <label htmlFor="page-size-select" className={`text-sm font-semibold ${theme.text} whitespace-nowrap`}>Số chương mỗi trang:</label>
                    <select
                        id="page-size-select"
                        value={pageSize}
                        onChange={(e) => onPageSizeChange(Number(e.target.value))}
                        className={`p-2 border ${theme.border} rounded-md shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${theme.cardBg} ${theme.text}`}
                    >
                        <option value="10">10</option>
                        <option value="25">25</option>
                        <option value="50">50</option>
                        <option value="100">100</option>
                    </select>
                </div>
                <div>
                    <p className={`text-sm font-semibold ${theme.text} mb-2`}>Chuyển nhanh đến trang chương:</p>
                    <div className="flex flex-wrap gap-2">
                        {Array.from({ length: numPages }, (_, i) => {
                            const startChap = i * pageSize + 1;
                            const endChap = Math.min((i + 1) * pageSize, totalChapters);
                            const isActive = i === currentPageIndex;
                            return (
                                <button
                                    key={i}
                                    onClick={() => handlePageClick(i)}
                                    className={`px-3 py-1.5 text-sm font-semibold rounded-md transition-colors ${
                                        isActive
                                            ? `${theme.primaryButton.bg} ${theme.primaryButton.text} shadow`
                                            : `${theme.button.bg} ${theme.button.text} ${theme.button.hoverBg}`
                                    }`}
                                >
                                    {startChap}-{endChap}
                                </button>
                            );
                        })}
                    </div>
                </div>
                <form onSubmit={handleCustomRangeSubmit} className="space-y-2">
                    <p className={`text-sm font-semibold ${theme.text}`}>Hoặc chọn phạm vi tùy chỉnh:</p>
                    <div className="flex items-center gap-3 flex-wrap">
                        <div className="flex items-center gap-2">
                             <label htmlFor="from-chap" className="text-sm font-medium">Từ chương:</label>
                             <input
                                id="from-chap"
                                type="number"
                                value={fromInput}
                                onChange={(e) => setFromInput(e.target.value)}
                                className={`w-20 p-2 border ${theme.border} rounded-md shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${theme.cardBg} ${theme.text}`}
                            />
                        </div>
                        <div className="flex items-center gap-2">
                            <label htmlFor="to-chap" className="text-sm font-medium">Đến chương:</label>
                            <input
                                id="to-chap"
                                type="number"
                                value={toInput}
                                onChange={(e) => setToInput(e.target.value)}
                                className={`w-20 p-2 border ${theme.border} rounded-md shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${theme.cardBg} ${theme.text}`}
                            />
                        </div>
                        <button type="submit" className={`px-4 py-2 ${theme.primaryButton.bg} ${theme.primaryButton.text} font-semibold rounded-lg shadow-sm ${theme.primaryButton.hoverBg} transition-colors`}>
                            Hiển thị
                        </button>
                    </div>
                </form>
            </div>
        </details>
    );
};

const FileDisplay: React.FC<{
    fileData: ProcessedFile;
    onSentenceClick: (chapterIndex: number, sentenceIndex: number) => void;
    onVisibleRangeUpdate: (newRange: { start: number; end: number }) => void;
    onPageSizeUpdate: (newSize: number) => void;
    onChapterTranslate: (chapterIndex: number) => void;
    onBackToAnalysis: (chapterIndex: number) => void;
    onChapterUpdate: (chapterIndex: number, newState: Partial<ChapterData>) => void;
    onSaveToken: (token: TokenData) => void;
}> = ({ fileData, onSentenceClick, onVisibleRangeUpdate, onPageSizeUpdate, onChapterTranslate, onBackToAnalysis, onChapterUpdate, onSaveToken }) => {
    
    const handleRangeChange = useCallback((newRange: { start: number; end: number }) => {
        const start = Math.max(0, newRange.start);
        const end = Math.min(fileData.chapters.length, newRange.end);
        onVisibleRangeUpdate({ start, end });
    }, [fileData.chapters.length, onVisibleRangeUpdate]);

    return (
        <div className="space-y-6">
            {fileData.chapters.length > fileData.pageSize && (
                <ChapterNavigator
                    totalChapters={fileData.chapters.length}
                    onRangeChange={handleRangeChange}
                    pageSize={fileData.pageSize}
                    currentRange={{start: fileData.visibleRange.start, end: fileData.visibleRange.end -1}}
                    onPageSizeChange={onPageSizeUpdate}
                />
            )}

            <div className="space-y-4">
                {fileData.chapters.slice(fileData.visibleRange.start, fileData.visibleRange.end).map((chapter, index) => {
                    const originalChapterIndex = fileData.visibleRange.start + index;
                    return (
                        <ChapterDisplay
                            key={originalChapterIndex}
                            chapter={chapter}
                            chapterIndex={originalChapterIndex}
                            onSentenceClick={(sentenceIndex) => onSentenceClick(originalChapterIndex, sentenceIndex)}
                            onTranslate={() => onChapterTranslate(originalChapterIndex)}
                            onBackToAnalysis={() => onBackToAnalysis(originalChapterIndex)}
                            onUpdate={(update) => onChapterUpdate(originalChapterIndex, update)}
                            onSaveToken={onSaveToken}
                        />
                    )
                })}
            </div>
        </div>
    );
};

const SettingsPanel: React.FC<{
    isOpen: boolean;
    onClose: () => void;
}> = ({ isOpen, onClose }) => {
    const { settings, setSettings, theme } = useSettings();

    if (!isOpen) return null;

    const SettingButton = ({ value, label, settingKey, currentValue }: { value: any, label: string, settingKey: keyof AppSettings, currentValue: any }) => {
        const isActive = currentValue === value;
        return (
            <button
                onClick={() => setSettings(s => ({ ...s, [settingKey]: value }))}
                className={`px-3 py-1.5 text-sm font-semibold rounded-md transition-colors w-full
                    ${isActive
                        ? `${theme.primaryButton.bg} ${theme.primaryButton.text}`
                        : `${theme.button.bg} ${theme.button.text} ${theme.button.hoverBg}`
                    }`}
            >
                {label}
            </button>
        )
    };

    return (
        <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose}>
            <div
                className={`fixed bottom-16 right-4 ${theme.cardBg} ${theme.border} border p-4 rounded-xl shadow-2xl w-80 space-y-4`}
                onClick={e => e.stopPropagation()}
            >
                 <div>
                    <h3 className={`text-sm font-semibold mb-2 ${theme.mutedText}`}>Khóa API Gemini</h3>
                    <input
                        type="password"
                        placeholder="Dán khóa API của bạn vào đây"
                        value={settings.apiKey || ''}
                        onChange={(e) => setSettings(s => ({ ...s, apiKey: e.target.value }))}
                        className={`w-full p-2 border ${theme.border} rounded-md shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${theme.cardBg} ${theme.text} font-mono text-xs`}
                    />
                </div>
                <div>
                    <h3 className={`text-sm font-semibold mb-2 ${theme.mutedText}`}>Cỡ chữ (px)</h3>
                     <input
                        type="number"
                        value={settings.fontSize}
                        onChange={(e) => setSettings(s => ({ ...s, fontSize: Number(e.target.value) }))}
                        min="12"
                        max="24"
                        className={`w-full p-2 border ${theme.border} rounded-md shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${theme.cardBg} ${theme.text}`}
                    />
                </div>
                 <div>
                    <h3 className={`text-sm font-semibold mb-2 ${theme.mutedText}`}>Font chữ</h3>
                    <div className="grid grid-cols-3 gap-2">
                        <SettingButton value='font-sans' label='Sans' settingKey='fontFamily' currentValue={settings.fontFamily} />
                        <SettingButton value='font-serif' label='Serif' settingKey='fontFamily' currentValue={settings.fontFamily} />
                        <SettingButton value='font-mono' label='Mono' settingKey='fontFamily' currentValue={settings.fontFamily} />
                    </div>
                </div>
                 <div>
                    <h3 className={`text-sm font-semibold mb-2 ${theme.mutedText}`}>Màu nền</h3>
                    <div className="grid grid-cols-3 gap-2">
                        <SettingButton value='light' label='Sáng' settingKey='theme' currentValue={settings.theme} />
                        <SettingButton value='dark' label='Tối' settingKey='theme' currentValue={settings.theme} />
                        <SettingButton value='sepia' label='Ngà' settingKey='theme' currentValue={settings.theme} />
                    </div>
                </div>
                 <p className={`text-xs ${theme.mutedText} text-center`}>
                    Khóa API của bạn được lưu trữ an toàn trên trình duyệt của bạn.
                </p>
            </div>
        </div>
    );
}

const VocabularyModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    vocabulary: TokenData[];
    onDelete: (tokenCharacter: string) => void;
}> = ({ isOpen, onClose, vocabulary, onDelete }) => {
    const { theme } = useSettings();

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/50 z-40 flex items-center justify-center p-4" onClick={onClose}>
            <div
                className={`w-full max-w-2xl max-h-[80vh] flex flex-col ${theme.cardBg} rounded-xl shadow-2xl overflow-hidden`}
                onClick={e => e.stopPropagation()}
            >
                <header className={`p-4 border-b ${theme.border} flex justify-between items-center`}>
                    <h2 className={`text-xl font-bold ${theme.text}`}>Từ điển cá nhân</h2>
                    <button onClick={onClose} className={`${theme.mutedText} hover:${theme.text}`}>
                        <CloseIcon className="w-6 h-6" />
                    </button>
                </header>
                <div className="p-4 overflow-y-auto space-y-3">
                    {vocabulary.length === 0 ? (
                        <p className={theme.mutedText}>Từ điển của bạn còn trống. Nhấp vào ngôi sao trên một từ đã phân tích để lưu nó vào đây.</p>
                    ) : (
                        vocabulary.map((token, index) => (
                            <div key={index} className={`p-3 rounded-lg border ${theme.border} ${theme.mainBg} flex justify-between items-start`}>
                                <div>
                                    <p className="font-bold text-lg mb-1">
                                        <span className={theme.text}>{token.character}</span>
                                        <span className={`ml-3 text-base font-normal ${theme.mutedText}`}>{token.pinyin} / {token.sinoVietnamese}</span>
                                    </p>
                                    <p className={theme.text}><strong className={theme.mutedText}>Nghĩa:</strong> {token.vietnameseMeaning}</p>
                                    <p className={theme.text}><strong className={theme.mutedText}>Vai trò:</strong> {token.grammarRole}</p>
                                    <p className={`${theme.mutedText} text-sm mt-1`}>{token.grammarExplanation}</p>
                                </div>
                                <button
                                    onClick={() => onDelete(token.character)}
                                    className={`p-1.5 rounded-full text-red-400 hover:bg-red-500/10 hover:text-red-600 transition-colors`}
                                    title="Xóa khỏi từ điển"
                                >
                                    <CloseIcon className="w-4 h-4" />
                                </button>
                            </div>
                        ))
                    )}
                </div>
                <footer className={`p-3 border-t ${theme.border} text-center`}>
                     <p className={`text-xs ${theme.mutedText}`}>Đã lưu {vocabulary.length} từ.</p>
                </footer>
            </div>
        </div>
    );
};

const CacheLibraryModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    analysisCache: Map<string, AnalyzedText>;
    translationCache: Map<string, string>;
    onDeleteAnalysis: (key: string) => void;
    onDeleteTranslation: (key: string) => void;
}> = ({ isOpen, onClose, analysisCache, translationCache, onDeleteAnalysis, onDeleteTranslation }) => {
    const { theme } = useSettings();

    if (!isOpen) return null;

    const analysisEntries = Array.from(analysisCache.entries());
    const translationEntries = Array.from(translationCache.entries());

    const CacheItem: React.FC<{itemKey: string, content: string, onDelete: () => void}> = ({ itemKey, content, onDelete }) => (
        <div className={`p-3 rounded-lg border ${theme.border} ${theme.mainBg} flex justify-between items-start`}>
            <div className="flex-grow min-w-0">
                <p className={`font-mono text-xs ${theme.mutedText} truncate`} title={itemKey}>{itemKey}</p>
                <p className={`mt-1 ${theme.text} text-sm truncate`}>{content}</p>
            </div>
            <button
                onClick={onDelete}
                className={`ml-4 flex-shrink-0 p-1.5 rounded-full text-red-400 hover:bg-red-500/10 hover:text-red-600 transition-colors`}
                title="Xóa khỏi cache"
            >
                <CloseIcon className="w-4 h-4" />
            </button>
        </div>
    );

    return (
        <div className="fixed inset-0 bg-black/50 z-40 flex items-center justify-center p-4" onClick={onClose}>
            <div
                className={`w-full max-w-4xl max-h-[80vh] flex flex-col ${theme.cardBg} rounded-xl shadow-2xl overflow-hidden`}
                onClick={e => e.stopPropagation()}
            >
                <header className={`p-4 border-b ${theme.border} flex justify-between items-center`}>
                    <h2 className={`text-xl font-bold ${theme.text}`}>Thư viện Cache</h2>
                    <button onClick={onClose} className={`${theme.mutedText} hover:${theme.text}`}>
                        <CloseIcon className="w-6 h-6" />
                    </button>
                </header>
                <div className="p-4 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-4">
                    <section>
                        <h3 className={`text-lg font-semibold mb-2 ${theme.text}`}>Phân tích câu ({analysisEntries.length})</h3>
                        <div className="space-y-2">
                             {analysisEntries.length === 0 ? (
                                <p className={theme.mutedText}>Chưa có phân tích nào được lưu.</p>
                            ) : (
                                analysisEntries.map(([key, value]) => (
                                    <CacheItem 
                                        key={key} 
                                        itemKey={key}
                                        content={value.translation.map(s=>s.segment).join(' ')} 
                                        onDelete={() => onDeleteAnalysis(key)} 
                                    />
                                ))
                            )}
                        </div>
                    </section>
                    <section>
                         <h3 className={`text-lg font-semibold mb-2 ${theme.text}`}>Bản dịch chương ({translationEntries.length})</h3>
                         <div className="space-y-2">
                             {translationEntries.length === 0 ? (
                                <p className={theme.mutedText}>Chưa có bản dịch nào được lưu.</p>
                            ) : (
                                translationEntries.map(([key, value]) => (
                                     <CacheItem 
                                        key={key} 
                                        itemKey={key}
                                        content={value}
                                        onDelete={() => onDeleteTranslation(key)} 
                                    />
                                ))
                            )}
                         </div>
                    </section>
                </div>
                <footer className={`p-3 border-t ${theme.border} text-center`}>
                     <p className={`text-xs ${theme.mutedText}`}>Hiển thị {analysisEntries.length + translationEntries.length} mục đã cache.</p>
                </footer>
            </div>
        </div>
    );
};

// --- Main App Component ---

const App = () => {
    const [settings, setSettings] = useState<AppSettings>({
        apiKey: '',
        fontSize: 16,
        fontFamily: 'font-sans',
        theme: 'light',
    });
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isVocabularyOpen, setIsVocabularyOpen] = useState(false);
    const [isCacheLibraryOpen, setIsCacheLibraryOpen] = useState(false);
    
    const [processedFiles, setProcessedFiles] = useState<ProcessedFile[]>([]);
    const [activeFileId, setActiveFileId] = useState<number | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<ApiError | null>(null);
    const [analysisCache, setAnalysisCache] = useState<Map<string, AnalyzedText>>(new Map());
    const [translationCache, setTranslationCache] = useState<Map<string, string>>(new Map());
    const [vocabulary, setVocabulary] = useState<TokenData[]>([]);
    
    useEffect(() => {
        try {
            const storedSettings = localStorage.getItem(SETTINGS_STORAGE_KEY);
            if (storedSettings) setSettings(s => ({...s, ...JSON.parse(storedSettings)}));
            
            const storedAnalysisCache = localStorage.getItem(ANALYSIS_CACHE_STORAGE_KEY);
            if (storedAnalysisCache) setAnalysisCache(new Map(JSON.parse(storedAnalysisCache)));
            
            const storedTranslationCache = localStorage.getItem(TRANSLATION_CACHE_STORAGE_KEY);
            if (storedTranslationCache) setTranslationCache(new Map(JSON.parse(storedTranslationCache)));
            
            const storedVocabulary = localStorage.getItem(VOCABULARY_STORAGE_KEY);
            if (storedVocabulary) setVocabulary(JSON.parse(storedVocabulary));
        } catch (e) {
            console.error("Failed to load data from localStorage", e);
        }
    }, []);

    useEffect(() => {
        try {
            localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
        } catch (e) { console.error("Failed to save settings", e); }
    }, [settings]);
    
    useEffect(() => {
        try {
            localStorage.setItem(ANALYSIS_CACHE_STORAGE_KEY, JSON.stringify(Array.from(analysisCache.entries())));
        } catch (e) { console.error("Failed to save analysis cache", e); }
    }, [analysisCache]);

    useEffect(() => {
        try {
            localStorage.setItem(TRANSLATION_CACHE_STORAGE_KEY, JSON.stringify(Array.from(translationCache.entries())));
        } catch (e) { console.error("Failed to save translation cache", e); }
    }, [translationCache]);

    useEffect(() => {
        try {
            localStorage.setItem(VOCABULARY_STORAGE_KEY, JSON.stringify(vocabulary));
        } catch (e) { console.error("Failed to save vocabulary", e); }
    }, [vocabulary]);


    const handleProcessText = useCallback((text: string, fileName: string) => {
        if (!text.trim()) {
            setError({ message: "Vui lòng nhập văn bản hoặc tải lên một tệp." });
            return;
        }
        setError(null);
        setIsLoading(true);
        setTimeout(() => {
            try {
                const chapters = processTextIntoChapters(text);
                if (chapters.length === 0) {
                     setError({ message: "Không tìm thấy nội dung có thể phân tích trong văn bản." });
                     setIsLoading(false);
                     return;
                }
                
                const newFile: ProcessedFile = {
                    id: Date.now(),
                    fileName,
                    chapters,
                    visibleRange: { start: 0, end: Math.min(PAGE_SIZE, chapters.length) },
                    pageSize: PAGE_SIZE,
                };
                
                setProcessedFiles(prev => [...prev, newFile]);
                setActiveFileId(newFile.id);

            } catch (e: any) {
                setError({ message: `Lỗi xử lý văn bản: ${e.message}` });
            } finally {
                setIsLoading(false);
            }
        }, 50);
    }, []);

    const handleSaveToken = useCallback((tokenToSave: TokenData) => {
        setVocabulary(prevVocab => {
            const isDuplicate = prevVocab.some(token => token.character === tokenToSave.character);
            if (isDuplicate) {
                alert(`Từ "${tokenToSave.character}" đã có trong từ điển.`);
                return prevVocab;
            }
            return [...prevVocab, tokenToSave];
        });
    }, []);

    const handleDeleteVocabularyItem = useCallback((tokenCharacter: string) => {
        setVocabulary(prevVocab => prevVocab.filter(token => token.character !== tokenCharacter));
    }, []);

    const handleChapterUpdate = useCallback((chapterIndex: number, newState: Partial<ChapterData>) => {
        setProcessedFiles(prevFiles => prevFiles.map(file => {
            if (file.id === activeFileId) {
                const newChapters = [...file.chapters];
                newChapters[chapterIndex] = { ...newChapters[chapterIndex], ...newState };
                return { ...file, chapters: newChapters };
            }
            return file;
        }));
    }, [activeFileId]);

    const handleSentenceClick = useCallback(async (chapterIndex: number, sentenceIndex: number) => {
        const file = processedFiles.find(f => f.id === activeFileId);
        if (!file) return;

        if (!settings.apiKey) {
            setError({ message: "Vui lòng nhập khóa API Gemini trong Cài đặt (biểu tượng bánh răng) trước khi phân tích." });
            setIsSettingsOpen(true);
            return;
        }

        const sentence = file.chapters[chapterIndex].sentences[sentenceIndex];

        const updateSentence = (update: Partial<SentenceData>) => {
            setProcessedFiles(prevFiles => prevFiles.map(f => {
                if (f.id !== activeFileId) return f;
                const newChapters = [...f.chapters];
                const newSentences = [...newChapters[chapterIndex].sentences];
                newSentences[sentenceIndex] = { ...newSentences[sentenceIndex], ...update };
                newChapters[chapterIndex] = { ...newChapters[chapterIndex], sentences: newSentences };
                return { ...f, chapters: newChapters };
            }));
        };

        if (sentence.analysisState === 'loading') return;

        if (sentence.analysisState === 'done') {
            updateSentence({ isExpanded: !sentence.isExpanded });
            return;
        }
        
        const analysisCacheKey = sentence.original;
        if (analysisCache.has(analysisCacheKey)) {
            const cachedResult = analysisCache.get(analysisCacheKey)!;
            updateSentence({ analysisState: 'done', analysisResult: cachedResult, isExpanded: !sentence.isTitle });
            return;
        }

        updateSentence({ analysisState: 'loading' });

        try {
            const result = await analyzeSentence(sentence.original, settings.apiKey);
            setAnalysisCache(prevCache => new Map(prevCache).set(analysisCacheKey, result));
            updateSentence({ analysisState: 'done', analysisResult: result, isExpanded: !sentence.isTitle });
        } catch (err: any) {
            updateSentence({ analysisState: 'error', error: err.message });
        }
    }, [activeFileId, processedFiles, analysisCache, settings.apiKey]);
    
    const handleTranslateChapter = useCallback(async (chapterIndex: number) => {
        const file = processedFiles.find(f => f.id === activeFileId);
        if (!file) return;
        
        if (!settings.apiKey) {
            setError({ message: "Vui lòng nhập khóa API Gemini trong Cài đặt (biểu tượng bánh răng) trước khi dịch." });
            setIsSettingsOpen(true);
            handleChapterUpdate(chapterIndex, { translationState: 'pending' });
            return;
        }

        const chapter = file.chapters[chapterIndex];
        const translationCacheKey = `${file.id}-${chapter.title}`;
        
        handleChapterUpdate(chapterIndex, { translationState: 'loading' });

        // Trigger background analysis for all sentences
        chapter.sentences.forEach((s, sIndex) => {
            if (s.analysisState === 'pending') {
                // Don't await, let them run in the background
                handleSentenceClick(chapterIndex, sIndex);
            }
        });

        try {
            let translationResult: string;
            if (translationCache.has(translationCacheKey)) {
                translationResult = translationCache.get(translationCacheKey)!;
            } else {
                const chapterContent = chapter.sentences.filter(s => !s.isTitle).map(s => s.original).join('\n');
                translationResult = await translateChapter(chapterContent, settings.apiKey);
                setTranslationCache(prev => new Map(prev).set(translationCacheKey, translationResult));
            }
            
            handleChapterUpdate(chapterIndex, {
                translationState: 'done',
                translationResult: translationResult,
            });

        } catch (err: any)
        {
            handleChapterUpdate(chapterIndex, { translationState: 'error', translationError: err.message });
        }
    }, [activeFileId, processedFiles, handleChapterUpdate, handleSentenceClick, translationCache, settings.apiKey]);

    const handleBackToSentenceAnalysis = useCallback((chapterIndex: number) => {
        setProcessedFiles(prevFiles => prevFiles.map(file => {
            if (file.id !== activeFileId) return file;
            const newChapters = [...file.chapters];
            newChapters[chapterIndex] = { 
                ...newChapters[chapterIndex], 
                translationState: 'pending', 
                translationResult: undefined,
                translationError: undefined,
            };
            return { ...file, chapters: newChapters };
        }));
    }, [activeFileId]);

    const handleVisibleRangeUpdate = useCallback((newRange: { start: number; end: number }) => {
         setProcessedFiles(prevFiles => prevFiles.map(file => {
            if (file.id === activeFileId) {
                return { ...file, visibleRange: newRange };
            }
            return file;
        }));
    }, [activeFileId]);

    const handlePageSizeUpdate = useCallback((newSize: number) => {
        setProcessedFiles(prevFiles => prevFiles.map(file => {
            if (file.id === activeFileId) {
                const newEnd = Math.min(newSize, file.chapters.length);
                return { 
                    ...file, 
                    pageSize: newSize,
                    visibleRange: { start: 0, end: newEnd }
                };
            }
            return file;
        }));
    }, [activeFileId]);

    const handleCloseFile = useCallback((fileIdToClose: number) => {
        const fileIndex = processedFiles.findIndex(f => f.id === fileIdToClose);
        const newFiles = processedFiles.filter(f => f.id !== fileIdToClose);
        
        if (activeFileId === fileIdToClose) {
            if (newFiles.length === 0) {
                setActiveFileId(null);
            } else {
                const newActiveIndex = Math.max(0, fileIndex - 1);
                setActiveFileId(newFiles[newActiveIndex].id);
            }
        }
        setProcessedFiles(newFiles);
    }, [processedFiles, activeFileId]);

    const handleAddNewFile = useCallback(() => {
        setActiveFileId(null);
        setError(null);
    }, []);

    const handleDeleteAnalysisCacheItem = useCallback((key: string) => {
        setAnalysisCache(prev => {
            const newCache = new Map(prev);
            newCache.delete(key);
            return newCache;
        });
    }, []);

    const handleDeleteTranslationCacheItem = useCallback((key: string) => {
        setTranslationCache(prev => {
            const newCache = new Map(prev);
            newCache.delete(key);
            return newCache;
        });
    }, []);

    const activeFile = processedFiles.find(f => f.id === activeFileId);
    const themeClasses = getThemeClasses(settings.theme);

    return (
        <SettingsContext.Provider value={{ settings, setSettings, theme: themeClasses }}>
            <div 
                className={`min-h-screen transition-colors duration-300 ${themeClasses.mainBg} ${themeClasses.text} ${settings.fontFamily}`}
                style={{ fontSize: `${settings.fontSize}px`}}
            >
                <VocabularyModal isOpen={isVocabularyOpen} onClose={() => setIsVocabularyOpen(false)} vocabulary={vocabulary} onDelete={handleDeleteVocabularyItem} />
                <CacheLibraryModal 
                    isOpen={isCacheLibraryOpen} 
                    onClose={() => setIsCacheLibraryOpen(false)} 
                    analysisCache={analysisCache}
                    translationCache={translationCache}
                    onDeleteAnalysis={handleDeleteAnalysisCacheItem}
                    onDeleteTranslation={handleDeleteTranslationCacheItem}
                />
                <SettingsPanel isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />

                <header className={`${themeClasses.cardBg}/80 backdrop-blur-lg border-b ${themeClasses.border} sticky top-0 z-20`}>
                    <div className="container mx-auto px-4 py-3 flex justify-between items-center">
                        <h1 className="text-xl md:text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-cyan-500">
                            Trình Phân Tích Tiếng Trung
                        </h1>
                         <div className="flex items-center gap-4">
                              <button onClick={() => setIsVocabularyOpen(true)} className={`${themeClasses.mutedText} hover:${themeClasses.text} transition-colors`} title="Mở từ điển">
                                <BookOpenIcon className="w-6 h-6" />
                            </button>
                             <button onClick={() => setIsCacheLibraryOpen(true)} className={`${themeClasses.mutedText} hover:${themeClasses.text} transition-colors`} title="Mở thư viện cache">
                                <ArchiveBoxIcon className="w-6 h-6" />
                            </button>
                             <a href="https://github.com/google/genai-js" target="_blank" rel="noopener noreferrer" className={`${themeClasses.mutedText} hover:${themeClasses.text} transition-colors`}>
                                <GithubIcon className="w-6 h-6" />
                            </a>
                        </div>
                    </div>
                </header>

                <main className="container mx-auto p-4 md:p-8">
                    <div className="max-w-5xl mx-auto">
                         <WorkspaceTabs 
                            files={processedFiles}
                            activeFileId={activeFileId}
                            onSelectTab={setActiveFileId}
                            onCloseTab={handleCloseFile}
                            onAddNew={handleAddNewFile}
                         />
                         {error && (
                            <div className="mt-4 bg-red-100 border-l-4 border-red-500 text-red-700 p-4 rounded-md shadow" role="alert">
                                <div className="flex justify-between items-center">
                                   <div>
                                        <p className="font-bold">Lỗi</p>
                                        <p>{error.message}</p>
                                   </div>
                                   <button onClick={() => setError(null)} className="p-1 rounded-full hover:bg-red-200">
                                        <CloseIcon className="w-5 h-5"/>
                                   </button>
                                </div>
                            </div>
                        )}

                        {!activeFile ? (
                            <div className="mt-4">
                                <InputArea
                                    onProcess={handleProcessText}
                                    isLoading={isLoading}
                                    fileCount={processedFiles.length}
                                />
                            </div>
                        ) : (
                           <div className="mt-4">
                               <FileDisplay 
                                    fileData={activeFile} 
                                    onSentenceClick={(chapterIndex, sentenceIndex) => handleSentenceClick(chapterIndex, sentenceIndex)}
                                    onVisibleRangeUpdate={handleVisibleRangeUpdate}
                                    onPageSizeUpdate={handlePageSizeUpdate}
                                    onChapterTranslate={handleTranslateChapter}
                                    onBackToAnalysis={handleBackToSentenceAnalysis}
                                    onChapterUpdate={handleChapterUpdate}
                                    onSaveToken={handleSaveToken}
                               />
                           </div>
                        )}
                    </div>
                </main>
                
                <footer className={`text-center py-6 text-sm ${themeClasses.mutedText}`}>
                    <p>Cung cấp bởi Gemini API. Được thiết kế cho mục đích học tập.</p>
                </footer>

                 <button
                    onClick={() => setIsSettingsOpen(o => !o)}
                    className="fixed bottom-4 right-4 w-12 h-12 bg-slate-700/50 text-white hover:bg-slate-700/80 backdrop-blur-sm rounded-full flex items-center justify-center shadow-lg z-30 transition-all"
                    title="Cài đặt giao diện"
                >
                    <SettingsIcon className="w-6 h-6" />
                </button>
            </div>
        </SettingsContext.Provider>
    );
};

export default App;
