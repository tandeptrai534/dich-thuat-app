
import React, { useState, useCallback, useRef, useEffect, createContext, useContext } from 'react';
import { analyzeSentence, translateSentencesInBatch, analyzeProperNounsInBatch } from './services/geminiService';
import type { ApiError, ChapterData, ProcessedFile, AppSettings, Theme, FontSize, FontFamily, SentenceData, TokenData, VocabularyItem, AnalyzedText, ProperNounAnalysisAPIResult } from './types';
import { InputArea } from './components/InputArea';
import { GithubIcon, ChevronDownIcon, CopyIcon, CloseIcon, SettingsIcon, CheckIcon, PlayIcon, BookOpenIcon, StarIcon, ArchiveBoxIcon, StopIcon } from './components/common/icons';
import { Spinner } from './components/common/Spinner';
import { WorkspaceTabs } from './components/WorkspaceTabs';
import { OutputDisplay } from './components/OutputDisplay';
import { GRAMMAR_COLOR_MAP } from './constants';
import { GrammarRole } from './types';


// --- Constants ---
const DEFAULT_CHAPTER_TITLE = 'Văn bản chính';
const MAX_CHAPTER_LENGTH = 5000;
const PAGE_SIZE = 10;
const TRANSLATION_BATCH_SIZE = 10;
const VOCABULARY_ANALYSIS_BATCH_SIZE = 20;
const VOCAB_CHAPTER_CHUNK_SIZE = 1000;
const SETTINGS_STORAGE_KEY = 'chinese_analyzer_settings';
const ANALYSIS_CACHE_STORAGE_KEY = 'chinese_analyzer_analysis_cache';
const TRANSLATION_CACHE_STORAGE_KEY = 'chinese_analyzer_translation_cache';
const VOCABULARY_STORAGE_KEY = 'chinese_analyzer_vocabulary_v2'; // new key for new structure

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
        translationState: 'pending' as const,
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
    // This regex correctly captures the chapter number in the first group.
    const CHAPTER_REGEX = /^(?:Chương|Hồi|Quyển|Chapter|卷|第)\s*(\d+|[一二三四五六七八九十百千]+)\s*(?:(?:章|回|节|話|篇|卷之)\s*.*|[:：]\s*.*|$)/gm;
    const chapterMatches = [...text.matchAll(CHAPTER_REGEX)];

    const createChapterData = (title: string, content: string, chapterNumber?: string): void => {
        splitLargeChapter(title, content).forEach(chunk => {
            const titleSentence: SentenceData = {
                original: chunk.title,
                analysisState: 'pending',
                translationState: 'pending',
                isExpanded: false,
                isTitle: true,
            };

            chapters.push({
                title: chunk.title,
                chapterNumber, // Add the chapter number here.
                sentences: [titleSentence, ...chunk.sentences],
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
        createChapterData('Phần mở đầu', textBeforeFirstChapter); // Preamble has no number
    }

    chapterMatches.forEach((match, i) => {
        const chapterTitle = match[0].trim().replace(/\s+/g, ' ');
        const chapterNumber = match[1]; // Extract the number
        const contentStartIndex = match.index! + match[0].length;
        const nextChapterIndex = (i + 1 < chapterMatches.length) ? chapterMatches[i + 1].index : text.length;
        const chapterContent = text.substring(contentStartIndex, nextChapterIndex).trim();

        if (chapterContent) {
            createChapterData(chapterTitle, chapterContent, chapterNumber); // Pass the number
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
        pinyin: false,
        sinoVietnamese: false,
        translation: true,
    });
    const [justCopied, setJustCopied] = useState(false);

    const handleCopy = () => {
        let fullText = '';
        chapter.sentences.forEach(s => {
            if (s.isTitle) {
                fullText += `\n--- ${s.original} ---\n\n`;
                return;
            }
            if (copyOptions.original) {
                fullText += s.original + '\n';
            }
            if (copyOptions.translation && s.translation) {
                fullText += s.translation + '\n';
            }
             if ((copyOptions.pinyin || copyOptions.sinoVietnamese) && s.analysisResult) {
                if(copyOptions.pinyin) {
                    fullText += `Pinyin: ${s.analysisResult.tokens.map(t => t.pinyin).join(' ')}\n`;
                }
                if(copyOptions.sinoVietnamese) {
                     fullText += `Hán Việt: ${s.analysisResult.tokens.map(t => t.sinoVietnamese).join(' ')}\n`;
                }
            }
            fullText += '\n';
        });
        
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
                <span>{justCopied ? 'Đã sao chép!' : 'Sao chép'}</span>
            </button>
            {isOptionsOpen && (
                <div 
                    className={`absolute bottom-full right-0 mb-2 w-60 p-2 rounded-lg shadow-xl border ${theme.border} ${theme.cardBg} z-10`}
                >
                    <p className={`text-sm font-semibold p-2 ${theme.mutedText}`}>Tùy chọn sao chép:</p>
                    <div className="flex flex-col">
                        <CheckboxOption id="original" label="Văn bản gốc" />
                        <CheckboxOption id="translation" label="Bản dịch" />
                        <CheckboxOption id="pinyin" label="Pinyin (nếu đã phân tích)" />
                        <CheckboxOption id="sinoVietnamese" label="Hán Việt (nếu đã phân tích)" />
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

    const TranslationLine: React.FC = () => {
        if (sentence.translationState === 'loading') {
            return (
                <div className="flex items-center gap-2 text-sm mt-2 px-3">
                    <Spinner variant={settings.theme === 'light' ? 'dark' : 'light'} />
                    <span className={theme.mutedText}>Đang dịch...</span>
                </div>
            );
        }
        if (sentence.translationState === 'done' && sentence.translation) {
            return <p className={`mt-2 p-3 rounded-md ${theme.mainBg} italic text-slate-500 dark:text-slate-400`}>{sentence.translation}</p>;
        }
        if (sentence.translationState === 'error' && sentence.translationError) {
             return <p className="mt-2 text-sm text-red-500 dark:text-red-400 px-3">Lỗi dịch: {sentence.translationError}</p>;
        }
        return null;
    };

    const renderContent = () => {
        const titleSpecificClass = sentence.isTitle ? `text-center border-b-2 ${theme.border} pb-3 mb-3` : '';

        switch(sentence.analysisState) {
            case 'pending':
                return (
                    <div className={`p-3 rounded-lg cursor-pointer ${theme.hoverBg} transition-colors ${titleSpecificClass}`}>
                        {sentence.isTitle ? (
                             <h4 className={`text-xl font-bold ${theme.text}`}>{sentence.original}</h4>
                        ) : (
                            <>
                                <p>{sentence.original}</p>
                                <TranslationLine />
                            </>
                        )}
                    </div>
                );
            case 'loading':
                 return (
                    <div className={`flex flex-col items-center justify-center gap-2 p-3 ${titleSpecificClass}`}>
                        <Spinner variant={settings.theme === 'light' ? 'dark' : 'light'} />
                        <span className={theme.mutedText}>Đang phân tích...</span>
                    </div>
                );
            case 'error':
                 return (
                    <div className={`p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 rounded-lg cursor-pointer ${titleSpecificClass}`}>
                        <p><strong>Lỗi phân tích:</strong> {sentence.analysisError}</p>
                        <p className="font-semibold">Nhấp để thử lại.</p>
                        <TranslationLine />
                    </div>
                );
            case 'done':
                 if (!sentence.analysisResult) return null;
                 if (sentence.isExpanded) {
                     return (
                         <div className={titleSpecificClass}>
                             <OutputDisplay data={sentence.analysisResult} onSaveToken={onSaveToken} />
                             <TranslationLine />
                         </div>
                     );
                 }
                 // Collapsed View
                 return (
                     <div className={`p-3 space-y-3 cursor-pointer ${titleSpecificClass}`}>
                         {sentence.isTitle && <h4 className={`text-xl font-bold ${theme.text} mb-2`}>{sentence.original}</h4>}
                         <div className="flex flex-wrap items-end justify-center gap-x-2 gap-y-3 leading-tight">
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
                        <p className="leading-relaxed text-center">
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
                        <TranslationLine />
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
    onStopTranslate: () => void;
    onUpdate: (update: Partial<ChapterData>) => void;
    onSaveToken: (token: TokenData) => void;
}> = ({ chapter, chapterIndex, onSentenceClick, onTranslate, onStopTranslate, onUpdate, onSaveToken }) => {
    const { settings, theme } = useSettings();
    const isTranslating = chapter.isBatchTranslating;
    const untranslatedSentences = chapter.sentences.filter(s => !s.isTitle && s.translationState === 'pending');
    const allSentencesTranslated = untranslatedSentences.length === 0;

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
                        #{chapter.chapterNumber || chapterIndex + 1}
                    </span>
                    <h3 className={`text-lg font-bold ${theme.text} truncate`} title={chapter.title}>{chapter.title}</h3>
                </div>
                 <div className="flex-shrink-0 ml-4">
                    {isTranslating ? (
                        <button 
                            onClick={(e) => { e.preventDefault(); onStopTranslate(); }} 
                            className={`flex items-center gap-2 px-3 py-1.5 text-sm font-semibold rounded-md transition-colors bg-red-500 text-white hover:bg-red-600`}
                        >
                            <StopIcon className="w-4 h-4" /> Dừng dịch
                        </button>
                    ) : (
                         allSentencesTranslated ? (
                             <div className="flex items-center gap-2 px-3 py-1.5 text-sm font-semibold text-green-600 dark:text-green-400">
                                <CheckIcon className="w-4 h-4" />
                                <span>Đã dịch xong</span>
                             </div>
                         ) : (
                            <button 
                                onClick={(e) => { e.preventDefault(); onTranslate(); }} 
                                className={`flex items-center gap-2 px-3 py-1.5 text-sm font-semibold rounded-md transition-colors ${theme.button.bg} ${theme.button.text} ${theme.button.hoverBg}`}
                            >
                                <PlayIcon className="w-4 h-4" /> Dịch chương
                            </button>
                         )
                    )}
                </div>
            </summary>
            <div className={`p-4 border-t ${theme.border} space-y-4`}>
                {isTranslating && (
                    <div className="w-full bg-slate-200 rounded-full h-2.5 dark:bg-gray-700">
                        <div 
                            className="bg-blue-600 h-2.5 rounded-full transition-all duration-500" 
                            style={{width: `${(chapter.batchTranslationProgress || 0) * 100}%`}}>
                        </div>
                    </div>
                )}
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
                <div className="flex justify-end pt-2">
                    <AdvancedCopyButton chapter={chapter} />
                </div>
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
    onChapterStopTranslate: (chapterIndex: number) => void;
    onChapterUpdate: (chapterIndex: number, newState: Partial<ChapterData>) => void;
    onSaveToken: (token: TokenData) => void;
}> = ({ fileData, onSentenceClick, onVisibleRangeUpdate, onPageSizeUpdate, onChapterTranslate, onChapterStopTranslate, onChapterUpdate, onSaveToken }) => {
    
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
                            onStopTranslate={() => onChapterStopTranslate(originalChapterIndex)}
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
                        placeholder="Nhập khóa API của bạn"
                        value={settings.apiKey}
                        onChange={(e) => setSettings(s => ({ ...s, apiKey: e.target.value }))}
                        className={`w-full p-2 border ${theme.border} rounded-md shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${theme.cardBg} ${theme.text}`}
                    />
                </div>
                 <div className="grid grid-cols-2 gap-4">
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
                        <h3 className={`text-sm font-semibold mb-2 ${theme.mutedText}`}>Cao dòng</h3>
                        <input
                            type="number"
                            value={settings.lineHeight}
                            onChange={(e) => setSettings(s => ({ ...s, lineHeight: Number(e.target.value) }))}
                            min="1.2"
                            max="2.5"
                            step="0.1"
                            className={`w-full p-2 border ${theme.border} rounded-md shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${theme.cardBg} ${theme.text}`}
                        />
                    </div>
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
            </div>
        </div>
    );
}

const VocabularyModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    vocabulary: VocabularyItem[];
    onDelete: (term: string) => void;
    onAnalyze: () => void;
    onStop: () => void;
    isAnalyzing: boolean;
    analysisProgress: number;
    activeFile: ProcessedFile | undefined;
    onProcessNextChunk: () => void;
    vocabChunkSize: number;
}> = ({ 
    isOpen, onClose, vocabulary, onDelete, onAnalyze, onStop, isAnalyzing, analysisProgress, 
    activeFile, onProcessNextChunk, vocabChunkSize 
}) => {
    const { settings, theme } = useSettings();
    const [searchTerm, setSearchTerm] = useState('');

    if (!isOpen) return null;

    const pendingCount = vocabulary.filter(v => v.analysisState === 'pending' && !v.grammarExplanation).length;
    const filteredVocabulary = vocabulary.filter(item => item.term.toLowerCase().includes(searchTerm.toLowerCase()));

    // Chunking info
    const totalChapters = activeFile?.chapters.length || 0;
    const chunkIndex = activeFile?.vocabProcessingChunkIndex || 0;
    const startChap = chunkIndex * vocabChunkSize + 1;
    const endChap = Math.min((chunkIndex + 1) * vocabChunkSize, totalChapters);
    const hasMoreChunks = endChap < totalChapters;
    const nextChunkStartChap = endChap + 1;
    const nextChunkEndChap = Math.min(endChap + vocabChunkSize, totalChapters);


    const renderItemContent = (item: VocabularyItem) => {
        const nounAnalysisDone = item.analysisState === 'done' && item.hanViet;
        
        return (
            <div className="space-y-2 text-sm">
                {/* Info from Proper Noun Analysis */}
                {nounAnalysisDone && (
                    <div className="pb-2">
                        <p><strong className={theme.mutedText}>Hán Việt:</strong> {item.hanViet}</p>
                        <p><strong className={theme.mutedText}>Loại:</strong> {item.category}</p>
                        {item.explanation && <p className="mt-1">{item.explanation}</p>}
                    </div>
                )}
                
                {/* Info from Sentence Analysis */}
                {item.grammarExplanation && (
                    <div className={`pt-2 ${nounAnalysisDone ? `border-t ${theme.border}`: ''}`}>
                        <p className="font-semibold">Phân tích trong câu:</p>
                        <p><strong className={theme.mutedText}>Nghĩa:</strong> {item.vietnameseMeaning}</p>
                        <p><strong className={theme.mutedText}>Vai trò:</strong> {item.grammarRole}</p>
                        <p className="mt-1">{item.grammarExplanation}</p>
                    </div>
                )}
                
                 {/* Context Sentence */}
                {item.contextSentence && (
                    <div className={`pt-2 ${item.grammarExplanation || nounAnalysisDone ? `border-t ${theme.border}`: ''}`}>
                         <p className={`italic ${theme.mutedText} border-l-2 ${theme.border} pl-2 text-xs`}>
                             <strong className="not-italic font-semibold">Ngữ cảnh:</strong> {item.contextSentence}
                         </p>
                    </div>
                )}

                {/* Status for pending/loading/error noun analysis */}
                {item.analysisState === 'pending' && !item.grammarExplanation && !nounAnalysisDone && <p className={theme.mutedText}>Chờ phân tích tên riêng.</p>}
                {item.analysisState === 'loading' && (
                     <div className="flex items-center gap-2 mt-1">
                        <Spinner variant={theme.text.includes('slate-800') || theme.text.includes('stone-800') ? 'dark' : 'light'} />
                        <span className={theme.mutedText}>Đang phân tích...</span>
                    </div>
                )}
                 {item.analysisState === 'error' && <p className="text-red-500 mt-1">Lỗi phân tích tên: {item.analysisError}</p>}
            </div>
        );
    };


    return (
        <div className="fixed inset-0 bg-black/50 z-40 flex items-center justify-center p-4" onClick={onClose}>
            <div
                className={`w-full max-w-4xl max-h-[90vh] flex flex-col ${theme.cardBg} rounded-xl shadow-2xl overflow-hidden`}
                onClick={e => e.stopPropagation()}
            >
                <header className={`p-4 border-b ${theme.border} flex-shrink-0`}>
                    <div className="flex justify-between items-center">
                        <h2 className={`text-xl font-bold ${theme.text}`}>Từ điển cá nhân</h2>
                        <button onClick={onClose} className={`${theme.mutedText} hover:${theme.text}`}>
                            <CloseIcon className="w-6 h-6" />
                        </button>
                    </div>
                    <div className="mt-4 flex flex-col md:flex-row gap-4 justify-between items-start">
                         <div className="flex-grow w-full md:w-auto">
                            {isAnalyzing ? (
                                <button
                                    onClick={onStop}
                                    className="w-full md:w-auto flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold rounded-md transition-colors bg-red-500 text-white hover:bg-red-600"
                                >
                                    <StopIcon className="w-4 h-4" /> Dừng phân tích
                                </button>
                            ) : (
                                <div className="flex flex-col items-start">
                                    <button
                                        onClick={onAnalyze}
                                        disabled={pendingCount === 0}
                                        className={`w-full md:w-auto flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold rounded-md transition-colors ${theme.primaryButton.bg} ${theme.primaryButton.text} ${theme.primaryButton.hoverBg} disabled:bg-slate-400 disabled:cursor-not-allowed`}
                                    >
                                        <PlayIcon className="w-4 h-4" /> Lọc & Phân tích Tên riêng ({pendingCount} mục)
                                    </button>
                                     <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 max-w-sm">
                                        AI sẽ dùng ngữ cảnh để tự động loại bỏ các từ thông thường và chỉ phân tích các tên riêng, thành ngữ quan trọng.
                                    </p>
                                </div>
                            )}
                        </div>

                        <div className="flex flex-col items-end gap-2">
                             <input
                                type="text"
                                placeholder="Tìm kiếm từ..."
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                                className={`w-full md:w-64 p-2 border ${theme.border} rounded-md shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${theme.cardBg} ${theme.text}`}
                            />
                             {totalChapters > vocabChunkSize && (
                                <div className="space-y-1 text-right">
                                    <p className={`text-xs ${theme.mutedText}`}>
                                        Từ vựng từ chương {startChap}–{endChap} / {totalChapters}.
                                    </p>
                                    {hasMoreChunks && (
                                        <button
                                            onClick={onProcessNextChunk}
                                            disabled={isAnalyzing}
                                            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${theme.button.bg} ${theme.button.text} ${theme.button.hoverBg} disabled:opacity-50`}
                                        >
                                            Tải thêm từ khối tiếp theo ({nextChunkStartChap}–{nextChunkEndChap})
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                    {isAnalyzing && (
                         <div className="mt-4">
                             <p className={`text-sm mb-1 ${theme.mutedText}`}>Đang phân tích... {Math.round(analysisProgress * 100)}%</p>
                             <div className="w-full bg-slate-200 rounded-full h-2 dark:bg-gray-700">
                                <div
                                    className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                                    style={{ width: `${analysisProgress * 100}%` }}>
                                </div>
                            </div>
                         </div>
                    )}
                </header>

                <div className="p-4 overflow-y-auto space-y-3 flex-grow">
                    {filteredVocabulary.length === 0 ? (
                        <p className={theme.mutedText}>Từ điển của bạn còn trống hoặc không có kết quả tìm kiếm. Tải tệp mới để tự động điền hoặc lưu từ bằng biểu tượng ngôi sao.</p>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {filteredVocabulary.map((item, index) => (
                                <div key={index} className={`p-3 rounded-lg border ${theme.border} ${theme.mainBg} flex justify-between items-start`}>
                                    <div className="flex-grow min-w-0">
                                        <p className="font-bold text-lg mb-2 truncate" title={item.term}>
                                            <span className={theme.text}>{item.term}</span>
                                        </p>
                                        {renderItemContent(item)}
                                    </div>
                                    <button
                                        onClick={() => onDelete(item.term)}
                                        className={`ml-2 flex-shrink-0 p-1.5 rounded-full text-red-400 hover:bg-red-500/10 hover:text-red-600 transition-colors`}
                                        title="Xóa khỏi từ điển"
                                    >
                                        <CloseIcon className="w-4 h-4" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
                 <footer className={`p-3 border-t ${theme.border} text-center flex-shrink-0`}>
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
                         <h3 className={`text-lg font-semibold mb-2 ${theme.text}`}>Bản dịch câu ({translationEntries.length})</h3>
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
        lineHeight: 1.6,
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
    const [vocabulary, setVocabulary] = useState<VocabularyItem[]>([]);
    const [isAnalyzingNames, setIsAnalyzingNames] = useState(false);
    const [nameAnalysisProgress, setNameAnalysisProgress] = useState(0);

    const stopTranslationRef = useRef<Set<string>>(new Set());
    const stopNameAnalysisRef = useRef(false);
    
    useEffect(() => {
        try {
            const storedSettings = localStorage.getItem(SETTINGS_STORAGE_KEY);
            if (storedSettings) {
                const parsed = JSON.parse(storedSettings);
                setSettings(s => ({
                    ...s,
                    ...parsed,
                    lineHeight: parsed.lineHeight || 1.6,
                    apiKey: parsed.apiKey || '',
                }));
            }
            
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


    const extractVocabularyFromChapters = (chaptersToScan: ChapterData[]): { term: string, contextSentence: string }[] => {
        const phraseContextMap = new Map<string, string[]>();
        const termRegex = /[\u4e00-\u9fa5]{2,5}/g;
        const allSentencesInChunk = chaptersToScan.flatMap(c => c.sentences.map(s => s.original));

        allSentencesInChunk.forEach(sentence => {
            const uniquePhrasesInSentence = new Set(sentence.match(termRegex) || []);
            uniquePhrasesInSentence.forEach(phrase => {
                if (!phraseContextMap.has(phrase)) {
                    phraseContextMap.set(phrase, []);
                }
                phraseContextMap.get(phrase)!.push(sentence);
            });
        });

        const repeatingTermsWithContext: { term: string, contextSentence: string }[] = [];
        phraseContextMap.forEach((sentences, term) => {
            if (sentences.length > 1) { // It repeats if it's in more than 1 sentence
                const longestSentence = sentences.reduce((a, b) => a.length > b.length ? a : b, "");
                repeatingTermsWithContext.push({ term, contextSentence: longestSentence });
            }
        });
        return repeatingTermsWithContext;
    };

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
                
                const firstChunk = chapters.slice(0, VOCAB_CHAPTER_CHUNK_SIZE);
                const repeatingTermsWithContext = extractVocabularyFromChapters(firstChunk);
                
                if (repeatingTermsWithContext.length > 0) {
                    setVocabulary(prevVocab => {
                        const existingTerms = new Set(prevVocab.map(item => item.term));
                        const newItems: VocabularyItem[] = [];
                        repeatingTermsWithContext.forEach(({ term, contextSentence }) => {
                            if (!existingTerms.has(term)) {
                                newItems.push({ 
                                    term, 
                                    contextSentence, // Add context here
                                    analysisState: 'pending' 
                                });
                            }
                        });
                        return newItems.length > 0 ? [...prevVocab, ...newItems] : prevVocab;
                    });
                }


                const newFile: ProcessedFile = {
                    id: Date.now(),
                    fileName,
                    chapters,
                    visibleRange: { start: 0, end: Math.min(PAGE_SIZE, chapters.length) },
                    pageSize: PAGE_SIZE,
                    vocabProcessingChunkIndex: 0,
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
            const isDuplicate = prevVocab.some(item => item.term === tokenToSave.character);
            if (isDuplicate) {
                // Instead of alerting, maybe just highlight it? For now, alert is fine.
                // Or enrich the existing one.
                return prevVocab;
            }
            const newItem: VocabularyItem = {
                term: tokenToSave.character,
                analysisState: 'pending', // It's saved, but not yet analyzed as a proper noun
                hanViet: tokenToSave.sinoVietnamese,
                vietnameseMeaning: tokenToSave.vietnameseMeaning,
                grammarRole: tokenToSave.grammarRole,
                grammarExplanation: tokenToSave.grammarExplanation,
                category: tokenToSave.grammarExplanation.toLowerCase().includes('thành ngữ') ? 'Thành ngữ' : 'Ngữ pháp',
            };
            return [...prevVocab, newItem];
        });
    }, []);

    const handleDeleteVocabularyItem = useCallback((termToDelete: string) => {
        setVocabulary(prevVocab => prevVocab.filter(item => item.term !== termToDelete));
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
    
     const handleSentencesUpdate = useCallback((chapterIndex: number, sentenceUpdates: { index: number, update: Partial<SentenceData> }[]) => {
        setProcessedFiles(prevFiles => prevFiles.map(file => {
            if (file.id !== activeFileId) return file;
            
            const newChapters = [...file.chapters];
            const chapterToUpdate = newChapters[chapterIndex];
            if (!chapterToUpdate) return file;

            const newSentences = [...chapterToUpdate.sentences];
            sentenceUpdates.forEach(({ index, update }) => {
                if (newSentences[index]) {
                    newSentences[index] = { ...newSentences[index], ...update };
                }
            });
            newChapters[chapterIndex] = { ...chapterToUpdate, sentences: newSentences };
            return { ...file, chapters: newChapters };
        }));
    }, [activeFileId]);


    const handleSentenceClick = useCallback(async (chapterIndex: number, sentenceIndex: number) => {
        const file = processedFiles.find(f => f.id === activeFileId);
        if (!file) return;

        const sentence = file.chapters[chapterIndex].sentences[sentenceIndex];

        const updateSentence = (update: Partial<SentenceData>) => {
            handleSentencesUpdate(chapterIndex, [{ index: sentenceIndex, update }]);
        };
        
        if (!settings.apiKey) {
            setError({ message: "Vui lòng nhập khóa API của bạn trong Cài đặt để phân tích câu." });
            setIsSettingsOpen(true);
            return;
        }

        if (sentence.analysisState === 'loading') return;

        if (sentence.analysisState === 'done') {
            updateSentence({ isExpanded: !sentence.isExpanded });
            return;
        }
        
        const analysisCacheKey = sentence.original;
        if (analysisCache.has(analysisCacheKey)) {
            const cachedResult = analysisCache.get(analysisCacheKey)!;
            updateSentence({ analysisState: 'done', analysisResult: cachedResult, isExpanded: true });
            // Even with cache, enrich vocabulary
        } else {
             updateSentence({ analysisState: 'loading' });
        }


        try {
            // Use cached result if available, otherwise fetch
            const result = analysisCache.has(analysisCacheKey) 
                ? analysisCache.get(analysisCacheKey)!
                : await analyzeSentence(sentence.original, settings.apiKey);

            if (!analysisCache.has(analysisCacheKey)) {
                 setAnalysisCache(prevCache => new Map(prevCache).set(analysisCacheKey, result));
            }
            updateSentence({ analysisState: 'done', analysisResult: result, isExpanded: true });

            // --- Auto-enrich vocabulary from analysis result (NO EXTRA API CALL) ---
            setVocabulary(prevVocab => {
                const newVocab = [...prevVocab];
                const vocabMap = new Map(newVocab.map((item, index) => [item.term, { ...item, index }]));
                let hasChanged = false;
                
                result.tokens.forEach(token => {
                    // Only consider multi-character tokens as potential vocabulary
                    if (token.character.length < 2) return;

                    const term = token.character;
                    const existingEntry = vocabMap.get(term);

                    if (existingEntry) {
                        // Entry exists, let's enrich it if it doesn't have grammar info yet
                        const currentItem = newVocab[existingEntry.index];
                        if (!currentItem.grammarExplanation) {
                            currentItem.grammarExplanation = token.grammarExplanation;
                            currentItem.grammarRole = token.grammarRole;
                            currentItem.vietnameseMeaning = token.vietnameseMeaning;
                            // Infer category if not set by name analysis
                            if (!currentItem.category) {
                                currentItem.category = token.grammarExplanation.toLowerCase().includes('thành ngữ') ? 'Thành ngữ' : 'Ngữ pháp';
                            }
                            hasChanged = true;
                        }
                    } else {
                        // New entry found during analysis, add it with full details
                        const newItem: VocabularyItem = {
                            term: term,
                            analysisState: 'pending', // Still pending for proper noun analysis
                            hanViet: token.sinoVietnamese,
                            vietnameseMeaning: token.vietnameseMeaning,
                            grammarRole: token.grammarRole,
                            grammarExplanation: token.grammarExplanation,
                            category: token.grammarExplanation.toLowerCase().includes('thành ngữ') ? 'Thành ngữ' : 'Ngữ pháp',
                        };
                        newVocab.push(newItem);
                        // update map for subsequent tokens in same sentence to avoid duplicates from one analysis
                        vocabMap.set(term, { ...newItem, index: newVocab.length - 1 });
                        hasChanged = true;
                    }
                });
                
                return hasChanged ? newVocab : prevVocab;
            });
            // --- End auto-enrich ---

        } catch (err: any) {
            updateSentence({ analysisState: 'error', analysisError: err.message });
            setError({ message: err.message });
        }
    }, [activeFileId, processedFiles, analysisCache, settings.apiKey, handleSentencesUpdate]);
    
    const handleTranslateChapter = useCallback(async (chapterIndex: number) => {
        const file = processedFiles.find(f => f.id === activeFileId);
        if (!file) return;

        if (!settings.apiKey) {
            setError({ message: "Vui lòng nhập khóa API của bạn trong Cài đặt để dịch chương." });
            setIsSettingsOpen(true);
            return;
        }
        
        const stopKey = `${file.id}-${chapterIndex}`;
        stopTranslationRef.current.delete(stopKey);
        
        const chapter = file.chapters[chapterIndex];
        const sentencesToTranslate = chapter.sentences
            .map((s, i) => ({ ...s, originalIndex: i }))
            .filter(s => !s.isTitle && s.translationState === 'pending');

        const totalToTranslate = sentencesToTranslate.length;
        if (totalToTranslate === 0) return;

        handleChapterUpdate(chapterIndex, { isBatchTranslating: true, batchTranslationProgress: 0 });
        
        let translatedCount = 0;

        for (let i = 0; i < totalToTranslate; i += TRANSLATION_BATCH_SIZE) {
            if (stopTranslationRef.current.has(stopKey)) {
                break;
            }

            const batch = sentencesToTranslate.slice(i, i + TRANSLATION_BATCH_SIZE);
            const sentenceUpdatesLoading: {index: number, update: Partial<SentenceData>}[] = batch.map(s => ({
                index: s.originalIndex,
                update: { translationState: 'loading' }
            }));
            handleSentencesUpdate(chapterIndex, sentenceUpdatesLoading);

            try {
                const batchOriginals = batch.map(s => s.original);
                const translationResults = await translateSentencesInBatch(batchOriginals, settings.apiKey);
                
                const sentenceUpdatesDone: {index: number, update: Partial<SentenceData>}[] = batch.map((s, j) => ({
                    index: s.originalIndex,
                    update: { translationState: 'done', translation: translationResults[j] }
                }));
                handleSentencesUpdate(chapterIndex, sentenceUpdatesDone);

            } catch (err: any) {
                const sentenceUpdatesError: {index: number, update: Partial<SentenceData>}[] = batch.map(s => ({
                    index: s.originalIndex,
                    update: { translationState: 'error', translationError: err.message }
                }));
                handleSentencesUpdate(chapterIndex, sentenceUpdatesError);
                 setError({ message: err.message });
            }
            
            translatedCount += batch.length;
            const progress = totalToTranslate > 0 ? translatedCount / totalToTranslate : 0;
            handleChapterUpdate(chapterIndex, { batchTranslationProgress: progress });
        }
        
        // Finalize state
        const chapterIsFullyTranslated = file.chapters[chapterIndex].sentences
            .filter(s => !s.isTitle)
            .every(s => s.translationState === 'done');
            
        handleChapterUpdate(chapterIndex, { 
            isBatchTranslating: false,
            batchTranslationProgress: chapterIsFullyTranslated ? 1 : (chapter.batchTranslationProgress || 0)
        });
        stopTranslationRef.current.delete(stopKey);

    }, [activeFileId, processedFiles, handleChapterUpdate, handleSentencesUpdate, settings.apiKey]);

    const handleStopTranslateChapter = useCallback((chapterIndex: number) => {
        const file = processedFiles.find(f => f.id === activeFileId);
        if (file) {
            const stopKey = `${file.id}-${chapterIndex}`;
            stopTranslationRef.current.add(stopKey);
            handleChapterUpdate(chapterIndex, { isBatchTranslating: false });
            
            const chapter = file.chapters[chapterIndex];
            const sentenceUpdates: {index: number, update: Partial<SentenceData>}[] = [];
            chapter.sentences.forEach((s, i) => {
                if (s.translationState === 'loading') {
                    sentenceUpdates.push({ index: i, update: { translationState: 'pending' } });
                }
            });
            if (sentenceUpdates.length > 0) {
                 handleSentencesUpdate(chapterIndex, sentenceUpdates);
            }
        }
    }, [activeFileId, processedFiles, handleSentencesUpdate, handleChapterUpdate]);

    const handleAnalyzeVocabulary = useCallback(async () => {
        if (!settings.apiKey) {
            setError({ message: "Vui lòng nhập khóa API của bạn trong Cài đặt để phân tích từ vựng." });
            setIsSettingsOpen(true);
            return;
        }

        const itemsToAnalyze = vocabulary.filter(item => item.analysisState === 'pending' && !item.grammarExplanation);
        const totalToAnalyze = itemsToAnalyze.length;
        if (totalToAnalyze === 0) return;

        stopNameAnalysisRef.current = false;
        setIsAnalyzingNames(true);
        setNameAnalysisProgress(0);

        let analyzedCount = 0;

        for (let i = 0; i < totalToAnalyze; i += VOCABULARY_ANALYSIS_BATCH_SIZE) {
            if (stopNameAnalysisRef.current) break;
            
            const batch = itemsToAnalyze.slice(i, i + VOCABULARY_ANALYSIS_BATCH_SIZE);
            setVocabulary(prev => prev.map(item => batch.find(b => b.term === item.term) ? { ...item, analysisState: 'loading' } : item));
            
            try {
                const batchWithContext = batch.map(item => ({
                    term: item.term,
                    contextSentence: item.contextSentence
                }));
                
                const results = await analyzeProperNounsInBatch(batchWithContext, settings.apiKey);
                
                const resultMap = new Map(results.map(r => [r.term, r]));

                setVocabulary(currentVocab => {
                    // First, remove items from this batch that were filtered out by the API
                    const filteredVocab = currentVocab.filter(item => {
                        const isInBatch = batch.some(b => b.term === item.term);
                        if (isInBatch) {
                            return resultMap.has(item.term); // Keep only if it was returned by API
                        }
                        return true; // Keep all items not in the current batch
                    });
                    
                    // Then, update the items that were successfully analyzed
                    return filteredVocab.map(item => {
                        if (resultMap.has(item.term)) {
                            const result = resultMap.get(item.term)!;
                            // Spread the old item to keep existing grammar info, then spread result
                            return { ...item, ...result, analysisState: 'done' };
                        }
                        return item;
                    });
                });

            } catch (err: any) {
                setVocabulary(prev => prev.map(item => {
                    if (batch.find(b => b.term === item.term)) {
                        return { ...item, analysisState: 'error', analysisError: err.message };
                    }
                    return item;
                }));
                setError({ message: `Lỗi phân tích từ vựng: ${err.message}` });
            }

            analyzedCount += batch.length; // Progress is based on batches sent, not results received
            const progress = totalToAnalyze > 0 ? analyzedCount / totalToAnalyze : 0;
            setNameAnalysisProgress(progress);
        }

        setIsAnalyzingNames(false);
        stopNameAnalysisRef.current = false;

        // Clean up context sentences from all successfully analyzed items to save memory
        setVocabulary(currentVocab => currentVocab.map(item => {
            if (item.analysisState === 'done' && item.contextSentence) {
                const { contextSentence, ...rest } = item;
                return rest as VocabularyItem;
            }
            return item;
        }));


    }, [vocabulary, settings.apiKey]);
    
    const handleStopAnalyzeVocabulary = useCallback(() => {
        stopNameAnalysisRef.current = true;
        setVocabulary(prev => prev.map(item => item.analysisState === 'loading' ? { ...item, analysisState: 'pending' } : item));
        setIsAnalyzingNames(false);
    }, []);

    const handleProcessNextVocabularyChunk = useCallback(() => {
        const file = processedFiles.find(f => f.id === activeFileId);
        if (!file) return;

        const newChunkIndex = file.vocabProcessingChunkIndex + 1;
        const startIndex = newChunkIndex * VOCAB_CHAPTER_CHUNK_SIZE;
        if (startIndex >= file.chapters.length) {
            return; // No more chunks
        }
        const endIndex = Math.min(startIndex + VOCAB_CHAPTER_CHUNK_SIZE, file.chapters.length);
        const chapterChunk = file.chapters.slice(startIndex, endIndex);

        const newRepeatingTerms = extractVocabularyFromChapters(chapterChunk);

        if (newRepeatingTerms.length > 0) {
            setVocabulary(prevVocab => {
                const existingTerms = new Set(prevVocab.map(item => item.term));
                const newItems: VocabularyItem[] = newRepeatingTerms
                    .filter(({ term }) => !existingTerms.has(term))
                    .map(({ term, contextSentence }) => ({
                        term,
                        contextSentence,
                        analysisState: 'pending'
                    }));
                return [...prevVocab, ...newItems];
            });
        }

        // Update file state with the new chunk index
        setProcessedFiles(prevFiles => prevFiles.map(f =>
            f.id === activeFileId ? { ...f, vocabProcessingChunkIndex: newChunkIndex } : f
        ));
    }, [activeFileId, processedFiles]);

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
                style={{ fontSize: `${settings.fontSize}px`, lineHeight: settings.lineHeight }}
            >
                <VocabularyModal 
                    isOpen={isVocabularyOpen}
                    onClose={() => setIsVocabularyOpen(false)} 
                    vocabulary={vocabulary} 
                    onDelete={handleDeleteVocabularyItem}
                    onAnalyze={handleAnalyzeVocabulary}
                    onStop={handleStopAnalyzeVocabulary}
                    isAnalyzing={isAnalyzingNames}
                    analysisProgress={nameAnalysisProgress}
                    activeFile={activeFile}
                    onProcessNextChunk={handleProcessNextVocabularyChunk}
                    vocabChunkSize={VOCAB_CHAPTER_CHUNK_SIZE}
                />
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
                                    onChapterStopTranslate={handleStopTranslateChapter}
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
