
import React, { useState, useCallback, useRef, useEffect, createContext, useContext } from 'react';
import ReactDOM from 'react-dom';
import { analyzeSentence, translateSentencesInBatch } from './services/geminiService';
import * as driveService from './services/googleDriveService';
import type { ApiError, ChapterData, ProcessedFile, AppSettings, Theme, FontSize, FontFamily, SentenceData, TokenData, VocabularyItem, AnalyzedText, VocabularyLocation, DisplayMode, WorkspaceItem, SpecialTerm } from './types';
import { InputArea } from './components/InputArea';
import { GithubIcon, ChevronDownIcon, CopyIcon, CloseIcon, SettingsIcon, CheckIcon, PlayIcon, BookOpenIcon, StarIcon, ArchiveBoxIcon, StopIcon, DocumentTextIcon, PencilIcon, ArrowPathIcon, MapPinIcon, BookmarkSquareIcon, DownloadIcon, TrashIcon, UploadIcon, GoogleIcon, ArrowRightOnRectangleIcon } from './components/common/icons';
import { Spinner } from './components/common/Spinner';
import { WorkspaceTabs } from './components/WorkspaceTabs';
import { OutputDisplay } from './components/OutputDisplay';
import { GRAMMAR_COLOR_MAP } from './constants';
import { GrammarRole } from './types';
import { WorkspaceDashboard } from './components/WorkspaceDashboard';


// Add global declarations for Google APIs
declare global {
    interface Window {
        gapi: any;
        google: any;
    }
}


// --- Constants ---
const DEFAULT_CHAPTER_TITLE = 'Văn bản chính';
const MAX_CHAPTER_LENGTH = 5000;
const PAGE_SIZE = 10;
const TRANSLATION_BATCH_SIZE = 10;
const SETTINGS_STORAGE_KEY = 'chinese_analyzer_settings_v3';
const ANALYSIS_CACHE_STORAGE_KEY = 'chinese_analyzer_analysis_cache';
const TRANSLATION_CACHE_STORAGE_KEY = 'chinese_analyzer_translation_cache';
const VOCABULARY_STORAGE_KEY = 'chinese_analyzer_vocabulary_v5'; // version bump for new structure
const CHINESE_PUNCTUATION_REGEX = /^[，。！？；：、“”《》【】（）…—–_.,?!;:"'()\[\]{}]+$/;

const DRIVE_SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email';


// --- Types ---
type GoogleApiStatus = {
  status: 'pending' | 'ready' | 'error';
  message: string;
};

type FileCache = Omit<ProcessedFile, 'id' | 'originalContent'>;

// --- Theme & Settings ---
const getThemeClasses = (theme: Theme) => {
    switch (theme) {
        case 'dark':
            return {
                mainBg: 'bg-gray-900', text: 'text-slate-200',
                cardBg: 'bg-gray-800', border: 'border-gray-700',
                hoverBg: 'hover:bg-gray-700', popupBg: 'bg-slate-900',
                popupText: 'text-slate-100', mutedText: 'text-slate-400',
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

export const SettingsContext = createContext<{ settings: AppSettings; theme: ReturnType<typeof getThemeClasses>; setSettings: React.Dispatch<React.SetStateAction<AppSettings>>; vocabulary: VocabularyItem[] } | null>(null);
export const useSettings = () => {
    const context = useContext(SettingsContext);
    if (!context) throw new Error("useSettings must be used within a SettingsProvider");
    return context;
};

// --- Helper Functions ---
const loadScript = (src: string): Promise<void> => {
    return new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) {
            resolve();
            return;
        }
        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
        document.body.appendChild(script);
    });
};

const isChinesePunctuation = (char: string) => CHINESE_PUNCTUATION_REGEX.test(char.trim());
const escapeRegex = (string: string) => string.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');

const chineseNumMap: { [key: string]: number } = { '〇': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '零': 0 };
const chineseUnitMap: { [key: string]: number } = { '十': 10, '百': 100, '千': 1000 };
const chineseSectionUnitMap: { [key: string]: number } = { '万': 10000, '亿': 100000000 };

function chineseToArabic(numStr: string | undefined | null): number | null {
    if (!numStr) return null;
    
    if (/^\d+$/.test(numStr)) {
        return parseInt(numStr, 10);
    }

    let total = 0;
    let sectionTotal = 0;
    let currentNum = 0;
    let originalStr = numStr;
    
    if (originalStr.startsWith('十')) {
        originalStr = '一' + originalStr;
    }
    
    for (const char of originalStr) {
        if (char in chineseNumMap) {
            currentNum = chineseNumMap[char];
        } else if (char in chineseUnitMap) {
            sectionTotal += (currentNum === 0 && sectionTotal === 0 ? 1 : currentNum) * chineseUnitMap[char];
            currentNum = 0;
        } else if (char in chineseSectionUnitMap) {
            total += (sectionTotal + currentNum) * chineseSectionUnitMap[char];
            sectionTotal = 0;
            currentNum = 0;
        }
    }
    
    total += sectionTotal + currentNum;
    
    if (total === 0 && numStr.length > 0 && !Object.keys(chineseNumMap).some(c => numStr.includes(c))) {
        return null;
    }

    return total;
}


function splitLargeChapter(title: string, content: string): Pick<ChapterData, 'title' | 'sentences'>[] {
    const createSentences = (text: string) => {
        let sentenceCounter = 1;
        return text.split('\n').map(s => s.trim()).filter(s => {
            const punctuationOnlyRegex = /^[“”…"'.!?,;:\s]+$/;
            return s && !punctuationOnlyRegex.test(s);
        }).map(s => ({
            original: s,
            sentenceNumber: sentenceCounter++,
            analysisState: 'pending' as const,
            translationState: 'pending' as const
        }));
    };
    
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
    const CHAPTER_REGEX = /^(?:Chương|Hồi|Quyển|Chapter|卷|第)\s*(\d+|[一二三四五六七八九十百千万亿〇零两]+)\s*(?:(?:章|回|节|話|篇|卷之)\s*.*|[:：]\s*.*|$)/gm;
    const chapterMatches = [...text.matchAll(CHAPTER_REGEX)];

    const createChapterData = (title: string, content: string, chapterNumber?: string): void => {
        const chunks = splitLargeChapter(title, content);
        const totalParts = chunks.length;

        chunks.forEach((chunk, index) => {
            const partNumber = index + 1;
            const titleSentence: SentenceData = {
                original: chunk.title,
                sentenceNumber: 0, 
                analysisState: 'pending',
                translationState: 'pending',
                isTitle: true,
            };

            chapters.push({
                title: chunk.title,
                chapterNumber,
                partNumber,
                totalParts,
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
        createChapterData('Phần mở đầu', textBeforeFirstChapter);
    }

    chapterMatches.forEach((match, i) => {
        const chapterTitle = match[0].trim().replace(/\s+/g, ' ');
        const chapterNumber = match[1];
        const contentStartIndex = match.index! + match[0].length;
        const nextChapterIndex = (i + 1 < chapterMatches.length) ? chapterMatches[i + 1].index : text.length;
        const chapterContent = text.substring(contentStartIndex, nextChapterIndex).trim();

        if (chapterContent) {
            createChapterData(chapterTitle, chapterContent, chapterNumber);
        }
    });

    return chapters;
}


// --- UI Components ---

const VocabularyTerm: React.FC<{ vocabItem: VocabularyItem }> = ({ vocabItem }) => {
    const [isPopupVisible, setIsPopupVisible] = useState(false);
    const { theme } = useSettings();
    const anchorRef = useRef<HTMLSpanElement>(null);
    const popupRef = useRef<HTMLDivElement>(null);
    const [style, setStyle] = useState<React.CSSProperties>({});

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

            if (top < margin) {
                top = anchorRect.bottom + margin;
            }
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

    return (
        <span className="relative inline-block">
            <span
                ref={anchorRef}
                className="font-semibold cursor-pointer text-blue-600 dark:text-blue-400 border-b border-blue-500/50 border-dashed hover:bg-blue-500/10"
                onClick={handleTogglePopup}
            >
                {vocabItem.sinoVietnamese}
            </span>
            {isPopupVisible && ReactDOM.createPortal(
                <div
                    ref={popupRef}
                    style={style}
                    className={`w-72 p-4 z-50 ${theme.popupBg} border ${theme.border} ${theme.popupText} text-sm rounded-lg shadow-2xl transition-opacity duration-200`}
                    onClick={e => e.stopPropagation()}
                >
                    <button 
                        onClick={() => setIsPopupVisible(false)}
                        className={`absolute top-2 right-2 p-1.5 rounded-full ${theme.mutedText} hover:bg-slate-500/20`}
                        aria-label="Đóng popup"
                    >
                        <CloseIcon className="w-5 h-5" />
                    </button>
                    <div className="flex justify-between items-start mb-2 pr-6">
                        <div className="flex flex-col">
                            <span className="font-bold text-lg text-blue-400">{vocabItem.term}</span>
                            <span className="text-sm font-semibold">{vocabItem.sinoVietnamese}</span>
                        </div>
                        <span className={`px-2 py-0.5 text-xs font-semibold rounded-full bg-slate-200 text-slate-700 dark:bg-slate-600 dark:text-slate-200`}>{vocabItem.category}</span>
                    </div>
                    <p>{vocabItem.explanation}</p>
                </div>,
                document.body
            )}
        </span>
    );
};

const TranslationTerm: React.FC<{ vocabItem: VocabularyItem; matchedText: string }> = ({ vocabItem, matchedText }) => {
    const [isPopupVisible, setIsPopupVisible] = useState(false);
    const { theme } = useSettings();
    const anchorRef = useRef<HTMLSpanElement>(null);
    const popupRef = useRef<HTMLDivElement>(null);
    const [style, setStyle] = useState<React.CSSProperties>({});

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

            if (top < margin) {
                top = anchorRect.bottom + margin;
            }
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

    return (
        <span className="relative inline-block">
            <span
                ref={anchorRef}
                className="font-semibold cursor-pointer text-green-600 dark:text-green-400 border-b border-green-500/50 border-dashed hover:bg-green-500/10"
                onClick={handleTogglePopup}
            >
                {matchedText}
            </span>
            {isPopupVisible && ReactDOM.createPortal(
                <div
                    ref={popupRef}
                    style={style}
                    className={`w-72 p-4 z-50 ${theme.popupBg} border ${theme.border} ${theme.popupText} text-sm rounded-lg shadow-2xl transition-opacity duration-200`}
                    onClick={e => e.stopPropagation()}
                >
                    <button 
                        onClick={() => setIsPopupVisible(false)}
                        className={`absolute top-2 right-2 p-1.5 rounded-full ${theme.mutedText} hover:bg-slate-500/20`}
                        aria-label="Đóng popup"
                    >
                        <CloseIcon className="w-5 h-5" />
                    </button>
                    <div className="flex justify-between items-start mb-2 pr-6">
                        <div className="flex flex-col">
                            <span className="font-bold text-lg text-blue-400">{vocabItem.term}</span>
                            <span className="text-sm font-semibold">{vocabItem.sinoVietnamese}</span>
                        </div>
                        <span className={`px-2 py-0.5 text-xs font-semibold rounded-full bg-slate-200 text-slate-700 dark:bg-slate-600 dark:text-slate-200`}>{vocabItem.category}</span>
                    </div>
                    <p>{vocabItem.explanation}</p>
                </div>,
                document.body
            )}
        </span>
    );
};

const InteractiveText: React.FC<{ text: string | undefined }> = ({ text }) => {
    const { vocabulary } = useSettings();

    if (!text) return null;

    // Type 1: Terms that are forced to be Sino-Vietnamese in the output (blue)
    const sinoTerms = vocabulary.filter(v => v.isForceSino && v.sinoVietnamese?.trim());
    const sinoTermMap = new Map(sinoTerms.map(item => [item.sinoVietnamese.toLowerCase(), item]));

    // Type 2: Natural Vietnamese translations that are linked to a vocabulary item (green)
    const translationTerms = vocabulary.filter(v =>
        !v.isForceSino &&
        v.vietnameseTranslation?.trim() &&
        v.sinoVietnamese?.trim()
    );
    const translationTermMap = new Map(translationTerms.map(item => [item.vietnameseTranslation.toLowerCase(), item]));

    const allSearchStrings = [
        ...sinoTerms.map(v => v.sinoVietnamese),
        ...translationTerms.map(v => v.vietnameseTranslation)
    ];

    if (allSearchStrings.length === 0) {
        return <>{text}</>;
    }
    
    // Using Set to get unique search strings, then sorting by length to match longer phrases first
    const uniqueSearchStrings = [...new Set(allSearchStrings.filter(s => s))].sort((a, b) => b.length - a.length);

    if (uniqueSearchStrings.length === 0) {
        return <>{text}</>;
    }

    const regex = new RegExp(`(${uniqueSearchStrings.map(escapeRegex).join('|')})`, 'gi');
    const parts = text.split(regex);

    return (
        <>
            {parts.map((part, index) => {
                if (!part) return null; // Handle empty strings from split
                const partLower = part.toLowerCase();

                // Check for a forced Sino term match first
                const sinoVocabItem = sinoTermMap.get(partLower);
                if (sinoVocabItem) {
                    return <VocabularyTerm key={index} vocabItem={sinoVocabItem} />;
                }

                // If not, check for a natural translation match
                const translationVocabItem = translationTermMap.get(partLower);
                if (translationVocabItem) {
                    return <TranslationTerm key={index} vocabItem={translationVocabItem} matchedText={part} />;
                }
                
                // If no match, return the text part
                return <React.Fragment key={index}>{part}</React.Fragment>;
            })}
        </>
    );
};

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

// --- Sentence Display Modes ---
const ViewCopyButton: React.FC<{ textToCopy: string; className?: string }> = ({ textToCopy, className = '' }) => {
    const { theme } = useSettings();
    const [copied, setCopied] = React.useState(false);
    const handleClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        navigator.clipboard.writeText(textToCopy).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        });
    };
    return (
        <button 
            onClick={handleClick} 
            className={`absolute top-2 right-2 flex items-center gap-1.5 text-xs font-medium p-1.5 rounded-md transition-colors ${theme.button.bg} ${theme.button.text} ${theme.button.hoverBg} z-10 ${className}`}
            title="Sao chép"
        >
            <CopyIcon className="w-3.5 h-3.5" />
            {copied ? 'Đã sao chép' : ''}
        </button>
    );
};

const DetailedWordView: React.FC<{ analysisResult: AnalyzedText }> = ({ analysisResult }) => {
    const { theme, settings } = useSettings();
    const textToCopy = analysisResult.tokens.map(t => `${t.character} [${t.pinyin}] (${t.sinoVietnamese}): ${t.vietnameseMeaning}`).join('\n');

    return (
        <div className="relative space-y-4 pt-8">
            <ViewCopyButton textToCopy={textToCopy} />
            <div className="flex flex-wrap items-start justify-center gap-x-2 gap-y-4 leading-tight">
                {analysisResult.tokens.map((token, index) => (
                    <div key={index} className="inline-flex flex-col items-center text-center mx-0.5 p-1 rounded-md transition-colors hover:bg-slate-500/10">
                        <span className={`text-xs ${theme.mutedText}`}>{token.pinyin}</span>
                        <span style={{ fontSize: `${settings.hanziFontSize}px`}} className={`font-semibold my-1`}>{token.character}</span>
                        <span className={`text-xs ${theme.mutedText} font-medium`}>{token.sinoVietnamese}</span>
                        <span className={`text-sm ${theme.text} mt-1 max-w-[80px] truncate`} title={token.vietnameseMeaning}>{token.vietnameseMeaning}</span>
                    </div>
                ))}
            </div>
        </div>
    );
};

const TranslationOnlyView: React.FC<{ analysisResult: AnalyzedText }> = ({ analysisResult }) => {
    const translationText = analysisResult.translation;
    return (
        <div className="relative p-4 min-h-[5rem] flex items-center justify-center">
            <ViewCopyButton textToCopy={translationText} />
            <p className="text-lg italic text-center"><InteractiveText text={translationText} /></p>
        </div>
    );
};

const OriginalOnlyView: React.FC<{ originalText: string }> = ({ originalText }) => {
    const { settings } = useSettings();
    return (
        <div className="relative p-4 min-h-[5rem] flex items-center justify-center">
            <ViewCopyButton textToCopy={originalText} />
            <p style={{fontSize: `${settings.hanziFontSize}px`}} className="font-semibold text-center">{originalText}</p>
        </div>
    );
};


const SentenceDisplay: React.FC<{
    sentence: SentenceData;
    id: string;
    onClick: () => void;
}> = ({ sentence, id, onClick }) => {
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
            return <p className={`mt-2 p-3 rounded-md ${theme.mainBg} italic text-slate-500 dark:text-slate-400`}><InteractiveText text={sentence.translation} /></p>;
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
                                <p>
                                    <span className="mr-2 text-xs text-slate-400">{sentence.sentenceNumber}.</span>
                                    {sentence.original}
                                </p>
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
                        <p className="font-semibold">
                            {!sentence.isTitle && <span className="mr-2 text-xs">{sentence.sentenceNumber}.</span>}
                            Nhấp để thử lại.
                        </p>
                        <TranslationLine />
                    </div>
                );
            case 'done':
                 if (!sentence.analysisResult) return null;
                 
                const renderView = () => {
                    switch (sentence.displayMode) {
                        case 'grammar':
                            return <OutputDisplay data={sentence.analysisResult} />;
                        case 'translation':
                            return <TranslationOnlyView analysisResult={sentence.analysisResult} />;
                        case 'original':
                            return <OriginalOnlyView originalText={sentence.original} />;
                        case 'detailed-word':
                        default:
                            return <DetailedWordView analysisResult={sentence.analysisResult} />;
                    }
                };

                return <div className={titleSpecificClass}>{renderView()}</div>
        }
    }

    return (
        <div id={id} onClick={onClick} className={`rounded-lg border ${theme.border} ${sentence.analysisState !== 'pending' ? theme.cardBg : 'bg-transparent'}`}>
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
    onAnalyze: () => void;
    onStopAnalyze: () => void;
    onUpdate: (update: Partial<ChapterData>) => void;
    isApiBusy: boolean;
}> = ({ chapter, chapterIndex, onSentenceClick, onTranslate, onStopTranslate, onAnalyze, onStopAnalyze, onUpdate, isApiBusy }) => {
    const { theme, settings } = useSettings();
    
    const untranslatedSentences = chapter.sentences.filter(s => !s.isTitle && s.translationState === 'pending').length;
    const unanalyzedSentences = chapter.sentences.filter(s => s.analysisState === 'pending').length;

    const allSentencesTranslated = untranslatedSentences === 0;
    const allSentencesAnalyzed = unanalyzedSentences === 0;
    const isApiKeyMissing = !settings.apiKey;


    const handleToggle = (e: React.SyntheticEvent<HTMLDetailsElement>) => {
        onUpdate({ isExpanded: e.currentTarget.open });
    };

    const renderChapterNumber = () => {
        let num: number | string | null = chineseToArabic(chapter.chapterNumber);
        
        if (num === null) {
            num = chapter.chapterNumber || chapterIndex + 1;
        }
        
        const baseNumber = num;

        if (chapter.totalParts && chapter.totalParts > 1 && chapter.partNumber) {
            return `#${baseNumber} (Phần ${chapter.partNumber})`;
        }
        return `#${baseNumber}`;
    };

    const renderChapterActions = () => {
        if (chapter.isBatchTranslating) {
            return (
                <button onClick={(e) => { e.preventDefault(); onStopTranslate(); }} className={`flex items-center gap-2 px-3 py-1.5 text-sm font-semibold rounded-md transition-colors bg-red-500 text-white hover:bg-red-600`}>
                    <StopIcon className="w-4 h-4" /> Dừng dịch
                </button>
            );
        }
        if (chapter.isBatchAnalyzing) {
            return (
                <button onClick={(e) => { e.preventDefault(); onStopAnalyze(); }} className={`flex items-center gap-2 px-3 py-1.5 text-sm font-semibold rounded-md transition-colors bg-amber-500 text-white hover:bg-amber-600`}>
                    <StopIcon className="w-4 h-4" /> Dừng phân tích
                </button>
            );
        }
        if (!allSentencesTranslated) {
            return (
                <button onClick={(e) => { e.preventDefault(); onTranslate(); }} disabled={isApiBusy || isApiKeyMissing} className={`flex items-center gap-2 px-3 py-1.5 text-sm font-semibold rounded-md transition-colors ${theme.button.bg} ${theme.button.text} ${theme.button.hoverBg} disabled:opacity-50 disabled:cursor-not-allowed`} title={isApiKeyMissing ? "Vui lòng nhập API Key trong Cài đặt" : ""}>
                    <PlayIcon className="w-4 h-4" /> Dịch chương
                </button>
            );
        }
        if (!allSentencesAnalyzed) {
            return (
                <button onClick={(e) => { e.preventDefault(); onAnalyze(); }} disabled={isApiBusy || isApiKeyMissing} className={`flex items-center gap-2 px-3 py-1.5 text-sm font-semibold rounded-md transition-colors ${theme.primaryButton.bg} ${theme.primaryButton.text} ${theme.primaryButton.hoverBg} disabled:opacity-50 disabled:cursor-not-allowed`} title={isApiKeyMissing ? "Vui lòng nhập API Key trong Cài đặt" : ""}>
                    <DocumentTextIcon className="w-4 h-4" /> Phân tích chương
                </button>
            );
        }
        return (
            <div className="flex items-center gap-2 px-3 py-1.5 text-sm font-semibold text-green-600 dark:text-green-400">
                <CheckIcon className="w-4 h-4" />
                <span>Hoàn tất</span>
            </div>
        );
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
                        {renderChapterNumber()}
                    </span>
                    <h3 className={`text-lg font-bold ${theme.text} truncate`} title={chapter.title}>{chapter.title}</h3>
                </div>
                 <div className="flex-shrink-0 ml-4">
                    {renderChapterActions()}
                </div>
            </summary>
            <div className={`p-4 border-t ${theme.border} space-y-4`}>
                {chapter.isBatchTranslating && (
                    <div className="space-y-1">
                        <p className={`text-sm ${theme.mutedText}`}>Đang dịch ({untranslatedSentences} câu còn lại)...</p>
                        <div className="w-full bg-slate-200 rounded-full h-2.5 dark:bg-gray-700">
                            <div className="bg-blue-600 h-2.5 rounded-full transition-all duration-500" style={{width: `${(chapter.batchTranslationProgress || 0) * 100}%`}}></div>
                        </div>
                    </div>
                )}
                {chapter.isBatchAnalyzing && (
                     <div className="space-y-1">
                        <p className={`text-sm ${theme.mutedText}`}>Đang phân tích ({unanalyzedSentences} câu còn lại)...</p>
                        <div className="w-full bg-slate-200 rounded-full h-2.5 dark:bg-gray-700">
                            <div className="bg-amber-500 h-2.5 rounded-full transition-all duration-500" style={{width: `${(chapter.batchAnalysisProgress || 0) * 100}%`}}></div>
                        </div>
                    </div>
                )}

                <div className="space-y-2">
                    {chapter.sentences.map((sentence, index) => (
                        <SentenceDisplay
                            key={`${chapterIndex}-${index}`}
                            id={`sentence-${chapterIndex}-${index}`}
                            sentence={sentence}
                            onClick={() => onSentenceClick(index)}
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

const HorizontalNumberInputWithControls: React.FC<{
    label: string;
    id: string;
    value: string;
    onChange: (newValue: string) => void;
}> = ({ label, id, value, onChange }) => {
    const { theme } = useSettings();

    const handleStep = (direction: 'up' | 'down') => {
        const currentVal = parseInt(value, 10);
        if (isNaN(currentVal)) return;
        const newV = direction === 'up' ? currentVal + 1 : currentVal - 1;
        onChange(String(newV));
    };

    return (
        <div className="flex items-center gap-2">
            <label htmlFor={id} className="text-sm font-medium">{label}</label>
            <div className="relative flex items-center">
                <input
                    id={id}
                    type="number"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    className={`w-20 p-2 border ${theme.border} rounded-md shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${theme.cardBg} ${theme.text} text-center`}
                />
                <div className="absolute right-1.5 flex flex-col h-full justify-center">
                    <button onClick={() => handleStep('up')} className={`h-1/2 flex items-center justify-center w-5 rounded-t-sm ${theme.mutedText} hover:text-blue-500 hover:bg-slate-500/10`}>
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 15l7-7 7 7"></path></svg>
                    </button>
                    <button onClick={() => handleStep('down')} className={`h-1/2 flex items-center justify-center w-5 rounded-b-sm ${theme.mutedText} hover:text-blue-500 hover:bg-slate-500/10`}>
                         <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M19 9l-7 7-7-7"></path></svg>
                    </button>
                </div>
            </div>
        </div>
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
                <form onSubmit={handleCustomRangeSubmit} className="space-y-3">
                    <p className={`text-sm font-semibold ${theme.text}`}>Chọn phạm vi hiển thị:</p>
                    <div className="flex items-center gap-4 flex-wrap">
                        <HorizontalNumberInputWithControls
                            label="Từ chương:"
                            id="from-chap"
                            value={fromInput}
                            onChange={setFromInput}
                        />
                         <HorizontalNumberInputWithControls
                            label="Đến chương:"
                            id="to-chap"
                            value={toInput}
                            onChange={setToInput}
                        />
                        <button type="submit" className={`px-4 py-2 ${theme.primaryButton.bg} ${theme.primaryButton.text} font-semibold rounded-lg shadow-sm ${theme.primaryButton.hoverBg} transition-colors`}>
                            Hiển thị
                        </button>
                    </div>
                </form>

                <div className={`border-t ${theme.border}`}></div>

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
                    <p className={`text-sm font-semibold ${theme.text} mb-2`}>Hoặc chuyển đến trang:</p>
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
    onChapterAnalyze: (chapterIndex: number) => void;
    onChapterStopAnalyze: (chapterIndex: number) => void;
    onChapterUpdate: (chapterIndex: number, newState: Partial<ChapterData>) => void;
    isApiBusy: boolean;
}> = ({ fileData, onSentenceClick, onVisibleRangeUpdate, onPageSizeUpdate, onChapterTranslate, onChapterStopTranslate, onChapterAnalyze, onChapterStopAnalyze, onChapterUpdate, isApiBusy }) => {
    
    const handleRangeChange = useCallback((newRange: { start: number; end: number }) => {
        const start = Math.max(0, newRange.start);
        const end = Math.min(fileData.chapters.length, newRange.end);
        onVisibleRangeUpdate({ start, end });
    }, [fileData.chapters.length, onVisibleRangeUpdate]);

    return (
        <div className="space-y-6">
             <ChapterNavigator
                totalChapters={fileData.chapters.length}
                onRangeChange={handleRangeChange}
                pageSize={fileData.pageSize}
                currentRange={{start: fileData.visibleRange.start, end: fileData.visibleRange.end}}
                onPageSizeChange={onPageSizeUpdate}
            />

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
                            onAnalyze={() => onChapterAnalyze(originalChapterIndex)}
                            onStopAnalyze={() => onChapterStopAnalyze(originalChapterIndex)}
                            onUpdate={(update) => onChapterUpdate(originalChapterIndex, update)}
                            isApiBusy={isApiBusy}
                        />
                    )
                })}
            </div>
        </div>
    );
};

const NumberInputWithControls: React.FC<{
    label: string;
    value: number;
    onChange: (newValue: number) => void;
    min?: number;
    max?: number;
    step?: number;
}> = ({ label, value, onChange, min = -Infinity, max = Infinity, step = 1 }) => {
    const { theme } = useSettings();

    const handleStep = (direction: 'up' | 'down') => {
        const factor = direction === 'up' ? 1 : -1;
        const newValue = parseFloat((value + (step * factor)).toPrecision(15));
        onChange(Math.max(min, Math.min(max, newValue)));
    };

    return (
        <div>
            <h3 className={`text-sm font-semibold mb-2 ${theme.mutedText}`}>{label}</h3>
            <div className="relative flex items-center">
                <input
                    type="number"
                    value={value}
                    onChange={(e) => {
                        const val = e.target.value;
                        onChange(val === '' ? min : Number(val));
                    }}
                    onBlur={(e) => {
                        const clampedValue = Math.max(min, Math.min(max, Number(e.target.value)));
                        if (value !== clampedValue) {
                           onChange(clampedValue);
                        }
                    }}
                    min={min}
                    max={max}
                    step={step}
                    className={`w-full p-2 border ${theme.border} rounded-md shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${theme.cardBg} ${theme.text} text-center pr-8`}
                />
                <div className="absolute right-1.5 flex flex-col h-full justify-center">
                    <button onClick={() => handleStep('up')} className={`h-1/2 flex items-center justify-center w-5 rounded-t-sm ${theme.mutedText} hover:text-blue-500 hover:bg-slate-500/10`}>
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 15l7-7 7 7"></path></svg>
                    </button>
                    <button onClick={() => handleStep('down')} className={`h-1/2 flex items-center justify-center w-5 rounded-b-sm ${theme.mutedText} hover:text-blue-500 hover:bg-slate-500/10`}>
                         <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M19 9l-7 7-7-7"></path></svg>
                    </button>
                </div>
            </div>
        </div>
    );
};

const SettingsPanel: React.FC<{
    isOpen: boolean;
    onClose: () => void;
}> = ({ isOpen, onClose }) => {
    const { settings, setSettings, theme } = useSettings();
    const [localSettings, setLocalSettings] = useState<AppSettings>(settings);

    useEffect(() => {
        if (isOpen) {
            setLocalSettings(settings);
        }
    }, [isOpen, settings]);

    const handleSave = () => {
        setSettings(localSettings);
        onClose();
    };

    if (!isOpen) return null;

    const SettingButton = ({ value, label, settingKey, currentValue }: { value: any, label: string, settingKey: keyof AppSettings, currentValue: any }) => {
        const isActive = currentValue === value;
        return (
            <button
                onClick={() => setLocalSettings(s => ({ ...s, [settingKey]: value }))}
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
                    <h3 className={`text-sm font-semibold mb-2 ${theme.mutedText}`}>Gemini API Key</h3>
                    <input
                        type="password"
                        value={localSettings.apiKey}
                        onChange={(e) => setLocalSettings(s => ({ ...s, apiKey: e.target.value }))}
                        placeholder="Nhập API key của bạn..."
                        className={`w-full p-2 border ${theme.border} rounded-md shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${theme.cardBg} ${theme.text}`}
                    />
                </div>
                 <div className="grid grid-cols-2 gap-4">
                     <NumberInputWithControls
                        label="Cỡ chữ (px)"
                        value={localSettings.fontSize}
                        onChange={(v) => setLocalSettings(s => ({ ...s, fontSize: v }))}
                        min={12}
                        max={24}
                    />
                    <NumberInputWithControls
                        label="Cỡ chữ Hán (px)"
                        value={localSettings.hanziFontSize}
                        onChange={(v) => setLocalSettings(s => ({ ...s, hanziFontSize: v }))}
                        min={16}
                        max={48}
                    />
                </div>
                 <div className="grid grid-cols-1">
                     <NumberInputWithControls
                        label="Cao dòng"
                        value={localSettings.lineHeight}
                        onChange={(v) => setLocalSettings(s => ({ ...s, lineHeight: v }))}
                        min={1.2}
                        max={2.5}
                        step={0.1}
                    />
                </div>
                 <div>
                    <h3 className={`text-sm font-semibold mb-2 ${theme.mutedText}`}>Font chữ</h3>
                    <div className="grid grid-cols-3 gap-2">
                        <SettingButton value='font-sans' label='Sans' settingKey='fontFamily' currentValue={localSettings.fontFamily} />
                        <SettingButton value='font-serif' label='Serif' settingKey='fontFamily' currentValue={localSettings.fontFamily} />
                        <SettingButton value='font-mono' label='Mono' settingKey='fontFamily' currentValue={localSettings.fontFamily} />
                    </div>
                </div>
                 <div>
                    <h3 className={`text-sm font-semibold mb-2 ${theme.mutedText}`}>Màu nền</h3>
                    <div className="grid grid-cols-3 gap-2">
                        <SettingButton value='light' label='Sáng' settingKey='theme' currentValue={localSettings.theme} />
                        <SettingButton value='dark' label='Tối' settingKey='theme' currentValue={localSettings.theme} />
                        <SettingButton value='sepia' label='Ngà' settingKey='theme' currentValue={localSettings.theme} />
                    </div>
                </div>
                <div className={`mt-2 pt-3 border-t ${theme.border} flex justify-end gap-2`}>
                    <button 
                        onClick={onClose}
                        className={`px-4 py-2 ${theme.button.bg} ${theme.button.text} font-semibold rounded-md shadow-sm ${theme.button.hoverBg} transition-colors`}
                    >
                        Hủy
                    </button>
                    <button 
                        onClick={handleSave}
                        className={`px-4 py-2 ${theme.primaryButton.bg} ${theme.primaryButton.text} font-semibold rounded-md shadow-sm ${theme.primaryButton.hoverBg} transition-colors`}
                    >
                        Lưu thay đổi
                    </button>
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
    onToggleForceSino: (term: string) => void;
    onUpdate: (originalTerm: string, updatedItem: VocabularyItem) => void;
    onGoToLocation: (location: VocabularyLocation) => void;
    onUnify: () => void;
}> = ({ isOpen, onClose, vocabulary, onDelete, onToggleForceSino, onUpdate, onGoToLocation, onUnify }) => {
    const { theme } = useSettings();
    const [searchTerm, setSearchTerm] = useState('');
    const [editingTermKey, setEditingTermKey] = useState<string | null>(null);
    const [editFormData, setEditFormData] = useState<Partial<VocabularyItem>>({});
    const [activeTab, setActiveTab] = useState<'unchecked' | 'checked'>('unchecked');

    if (!isOpen) return null;

    const handleEditClick = (item: VocabularyItem) => {
        setEditingTermKey(item.term);
        setEditFormData({
            term: item.term,
            sinoVietnamese: item.sinoVietnamese,
            explanation: item.explanation,
            vietnameseTranslation: item.vietnameseTranslation,
        });
    };

    const handleCancelEdit = () => {
        setEditingTermKey(null);
        setEditFormData({});
    };

    const handleSaveEdit = (originalTerm: string) => {
        const updatedItem = vocabulary.find(v => v.term === originalTerm);
        if (!updatedItem || !editFormData.term || !editFormData.sinoVietnamese) {
            alert("Thông tin không hợp lệ.");
            return;
        }

        if (originalTerm.toLowerCase() !== editFormData.term.toLowerCase()) {
            if (vocabulary.some(v => v.term.toLowerCase() === editFormData.term!.toLowerCase())) {
                alert(`Thuật ngữ "${editFormData.term}" đã tồn tại trong từ điển.`);
                return;
            }
        }
        
        onUpdate(originalTerm, {
            ...updatedItem,
            term: editFormData.term,
            sinoVietnamese: editFormData.sinoVietnamese,
            explanation: editFormData.explanation || '',
            vietnameseTranslation: editFormData.vietnameseTranslation || '',
        });
        handleCancelEdit();
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setEditFormData(prev => ({ ...prev, [name]: value }));
    };

    const sortByLocation = (a: VocabularyItem, b: VocabularyItem) => {
        if (a.firstLocation.chapterIndex !== b.firstLocation.chapterIndex) {
            return a.firstLocation.chapterIndex - b.firstLocation.chapterIndex;
        }
        return a.firstLocation.sentenceNumber - b.firstLocation.sentenceNumber;
    };

    const uncheckedItems = vocabulary.filter(item => !item.isForceSino).sort(sortByLocation);
    const checkedItems = vocabulary.filter(item => item.isForceSino).sort(sortByLocation);

    const getFilteredItems = (items: VocabularyItem[]) => {
        if (!searchTerm) return items;
        return items.filter(item => 
            item.term.toLowerCase().includes(searchTerm.toLowerCase()) ||
            item.sinoVietnamese.toLowerCase().includes(searchTerm.toLowerCase()) ||
            item.explanation?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            item.category?.toLowerCase().includes(searchTerm.toLowerCase())
        );
    };

    const displayedItems = activeTab === 'unchecked' ? getFilteredItems(uncheckedItems) : getFilteredItems(checkedItems);
    
    const EditForm: React.FC<{item: VocabularyItem}> = ({item}) => (
        <div className={`mt-3 pt-3 border-t ${theme.border} space-y-3`}>
            <div className='space-y-1'>
                <label className={`text-xs font-semibold ${theme.mutedText}`}>Cụm từ (Hán)</label>
                <input name="term" value={editFormData.term} onChange={handleInputChange} className={`w-full p-2 border ${theme.border} rounded-md ${theme.cardBg} ${theme.text}`}/>
            </div>
             <div className='space-y-1'>
                <label className={`text-xs font-semibold ${theme.mutedText}`}>Âm Hán-Việt</label>
                <input name="sinoVietnamese" value={editFormData.sinoVietnamese} onChange={handleInputChange} className={`w-full p-2 border ${theme.border} rounded-md ${theme.cardBg} ${theme.text}`}/>
            </div>
             <div className='space-y-1'>
                <label className={`text-xs font-semibold ${theme.mutedText}`}>Bản dịch tự nhiên (để tìm và thay thế)</label>
                <input name="vietnameseTranslation" value={editFormData.vietnameseTranslation} onChange={handleInputChange} className={`w-full p-2 border ${theme.border} rounded-md ${theme.cardBg} ${theme.text}`}/>
            </div>
             <div className='space-y-1'>
                <label className={`text-xs font-semibold ${theme.mutedText}`}>Giải thích</label>
                <textarea name="explanation" value={editFormData.explanation} onChange={handleInputChange} rows={3} className={`w-full p-2 border ${theme.border} rounded-md ${theme.cardBg} ${theme.text}`}/>
            </div>
            <div className="flex justify-end gap-2 mt-2">
                <button onClick={handleCancelEdit} className={`px-3 py-1.5 ${theme.button.bg} ${theme.button.text} font-semibold rounded-md shadow-sm ${theme.button.hoverBg}`}>Hủy</button>
                <button onClick={() => handleSaveEdit(item.term)} className={`px-3 py-1.5 ${theme.primaryButton.bg} ${theme.primaryButton.text} font-semibold rounded-md shadow-sm ${theme.primaryButton.hoverBg}`}>Lưu</button>
            </div>
        </div>
    );
    
    const TabButton: React.FC<{ label: string, isActive: boolean, onClick: () => void }> = ({ label, isActive, onClick }) => {
        const activeClasses = `border-blue-500 text-blue-600 dark:text-blue-400`;
        const inactiveClasses = `border-transparent ${theme.mutedText} hover:text-slate-700 dark:hover:text-slate-300 hover:border-slate-300 dark:hover:border-slate-700`;
        
        return (
            <button
                onClick={onClick}
                className={`whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm transition-colors ${isActive ? activeClasses : inactiveClasses}`}
            >
                {label}
            </button>
        );
    };

    return (
        <div className="fixed inset-0 bg-black/50 z-40 flex items-center justify-center p-4" onClick={onClose}>
            <div
                className={`w-full max-w-4xl max-h-[90vh] flex flex-col ${theme.cardBg} rounded-xl shadow-2xl overflow-hidden`}
                onClick={e => e.stopPropagation()}
            >
                <header className={`p-4 border-b ${theme.border} flex-shrink-0`}>
                    <div className="flex justify-between items-center gap-4">
                        <h2 className={`text-xl font-bold ${theme.text}`}>Từ điển cá nhân</h2>
                         <button onClick={onUnify} title="Đồng nhất bản dịch với các thuật ngữ đã đánh dấu" className={`flex items-center gap-2 px-3 py-1.5 text-sm font-semibold rounded-md transition-colors ${theme.primaryButton.bg} ${theme.primaryButton.text} ${theme.primaryButton.hoverBg}`}>
                            <ArrowPathIcon className="w-4 h-4" /> Đồng nhất
                        </button>
                        <button onClick={onClose} className={`${theme.mutedText} hover:${theme.text}`}>
                            <CloseIcon className="w-6 h-6" />
                        </button>
                    </div>
                     <div className="mt-4 flex justify-end">
                        <input
                            type="text"
                            placeholder="Tìm kiếm từ..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            className={`w-full md:w-64 p-2 border ${theme.border} rounded-md shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${theme.cardBg} ${theme.text}`}
                        />
                    </div>
                </header>
                
                <div className={`px-4 border-b ${theme.border} flex-shrink-0`}>
                    <nav className="-mb-px flex space-x-6">
                        <TabButton 
                            label={`Chưa check (${uncheckedItems.length})`} 
                            isActive={activeTab === 'unchecked'} 
                            onClick={() => setActiveTab('unchecked')}
                        />
                        <TabButton 
                            label={`Đã check (${checkedItems.length})`} 
                            isActive={activeTab === 'checked'} 
                            onClick={() => setActiveTab('checked')}
                        />
                    </nav>
                </div>

                <div className="p-4 overflow-y-auto space-y-3 flex-grow">
                    {displayedItems.length === 0 ? (
                        <p className={theme.mutedText}>
                            {searchTerm ? `Không tìm thấy kết quả cho "${searchTerm}".` : `Không có mục nào trong thẻ này.`}
                        </p>
                    ) : (
                        displayedItems.map((item, index) => (
                            <details key={index} className={`p-3 rounded-lg border ${theme.border} ${theme.mainBg}`}>
                                <summary className="flex justify-between items-center cursor-pointer list-none">
                                    <div className="flex-grow min-w-0 flex items-start gap-4">
                                         <label className="flex items-center space-x-2 cursor-pointer flex-shrink-0 mt-1">
                                            <input
                                                type="checkbox"
                                                checked={item.isForceSino}
                                                onChange={(e) => { e.stopPropagation(); onToggleForceSino(item.term); }}
                                                className="form-checkbox h-5 w-5 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-blue-500"
                                                disabled={editingTermKey === item.term}
                                            />
                                             <span className="sr-only">Bắt buộc dịch Hán-Việt</span>
                                        </label>
                                        <div>
                                            <div className="flex items-center gap-3">
                                                <span className="font-bold text-lg">{item.term}</span>
                                                <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${theme.button.bg} ${theme.mutedText}`}>{item.category}</span>
                                            </div>
                                            <p className={`text-sm ${theme.mutedText} mt-1`}>
                                                <span className='font-semibold'>{item.sinoVietnamese}:</span> {item.explanation}
                                            </p>
                                        </div>
                                    </div>
                                    <div className='flex items-center'>
                                        {editingTermKey !== item.term && <ChevronDownIcon className="w-5 h-5 mr-2 flex-shrink-0" />}
                                        <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleEditClick(item); }} className={`p-1.5 rounded-full ${theme.mutedText} hover:text-blue-400 hover:bg-blue-500/10`}>
                                            <PencilIcon className="w-4 h-4" />
                                        </button>
                                        <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(item.term); }} className={`ml-1 flex-shrink-0 p-1.5 rounded-full text-red-400 hover:bg-red-500/10 hover:text-red-600`}>
                                            <CloseIcon className="w-4 h-4" />
                                        </button>
                                    </div>
                                </summary>
                                {editingTermKey === item.term 
                                    ? <EditForm item={item} />
                                    : (
                                        <div className={`mt-3 pt-3 border-t ${theme.border} space-y-2`}>
                                             <button
                                                onClick={() => onGoToLocation(item.firstLocation)}
                                                className={`flex items-center gap-2 text-sm font-semibold p-2 rounded-md transition-colors w-full text-left ${theme.hoverBg} ${theme.mutedText} hover:${theme.text}`}
                                             >
                                                <MapPinIcon className="w-4 h-4 flex-shrink-0"/>
                                                <div className="min-w-0">
                                                    <span>Vị trí xuất hiện đầu tiên:</span>
                                                    <p className='font-normal normal-case'>
                                                        <span className="font-semibold">{item.firstLocation.chapterTitle}, {item.firstLocation.sentenceNumber === 0 ? 'tiêu đề' : `câu ${item.firstLocation.sentenceNumber}`}:</span>
                                                        <span className="italic ml-2">"{item.firstLocation.originalSentence}"</span>
                                                    </p>
                                                </div>
                                             </button>
                                        </div>
                                    )
                                }
                            </details>
                        ))
                    )}
                </div>
                 <footer className={`p-3 border-t ${theme.border} text-center flex-shrink-0`}>
                     <p className={`text-xs ${theme.mutedText}`}>Đã lưu {vocabulary.length} cụm từ. ({checkedItems.length} mục được ưu tiên dịch Hán-Việt)</p>
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
                                        content={value.translation} 
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

const DataManagementModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    onExport: () => void;
    onImport: (event: React.ChangeEvent<HTMLInputElement>) => void;
    onClear: (dataType: 'vocabulary' | 'analysisCache' | 'translationCache' | 'settings' | 'all') => void;
    googleApiStatus: GoogleApiStatus;
    isLoggedIn: boolean;
    onLogin: () => void;
}> = ({ isOpen, onClose, onExport, onImport, onClear, googleApiStatus, isLoggedIn, onLogin }) => {
    const { theme } = useSettings();
    const importInputRef = useRef<HTMLInputElement>(null);

    if (!isOpen) return null;

    const handleImportClick = () => {
        importInputRef.current?.click();
    };
    
    const handleClearClick = (type: 'vocabulary' | 'analysisCache' | 'translationCache' | 'settings' | 'all') => {
        const messages = {
            vocabulary: "Bạn có chắc chắn muốn xóa toàn bộ từ điển cá nhân không? Hành động này không thể hoàn tác.",
            analysisCache: "Bạn có chắc chắn muốn xóa toàn bộ cache phân tích không?",
            translationCache: "Bạn có chắc chắn muốn xóa toàn bộ cache dịch không?",
            settings: "Bạn có chắc chắn muốn đặt lại cài đặt giao diện về mặc định không?",
            all: "BẠN CÓ CHẮC CHẮN MUỐN XÓA TẤT CẢ DỮ LIỆU ỨNG DỤNG KHÔNG? Bao gồm không gian làm việc, cache tệp, từ điển, cache và cài đặt. Hành động này không thể hoàn tác.",
        };
        if (window.confirm(messages[type])) {
            onClear(type);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 z-40 flex items-center justify-center p-4" onClick={onClose}>
            <div
                className={`w-full max-w-lg max-h-[90vh] flex flex-col ${theme.cardBg} rounded-xl shadow-2xl border ${theme.border}`}
                onClick={e => e.stopPropagation()}
            >
                <header className={`p-4 border-b ${theme.border} flex-shrink-0 flex justify-between items-center`}>
                    <h2 className={`text-xl font-bold ${theme.text}`}>Quản lý dữ liệu</h2>
                    <button onClick={onClose} className={`${theme.mutedText} hover:${theme.text}`}>
                        <CloseIcon className="w-6 h-6" />
                    </button>
                </header>
                <div className="p-6 space-y-6 overflow-y-auto">
                    <section className="space-y-3">
                        <h3 className={`text-lg font-semibold ${theme.text} flex items-center gap-2`}><GoogleIcon className="w-5 h-5" />Google Drive</h3>
                        <p className={`text-sm ${theme.mutedText}`}>
                            Toàn bộ dữ liệu của bạn, bao gồm không gian làm việc, cache tệp, từ điển và cache, được tự động sao lưu vào Google Drive khi bạn đăng nhập.
                        </p>
                        {!isLoggedIn && (
                             <>
                                <p className={`text-sm ${theme.mutedText}`}>
                                    Đăng nhập để bắt đầu.
                                </p>
                                <button 
                                    onClick={onLogin} 
                                    disabled={googleApiStatus.status !== 'ready'} 
                                    className={`w-full flex items-center justify-center gap-2 px-4 py-3 font-semibold rounded-lg shadow-sm transition-colors ${theme.primaryButton.bg} ${theme.primaryButton.text} ${theme.primaryButton.hoverBg} disabled:opacity-50 disabled:cursor-not-allowed`}
                                >
                                    <GoogleIcon className="w-5 h-5 mr-2" />
                                    Đăng nhập với Google
                                </button>
                                {googleApiStatus.status !== 'ready' && (
                                    <p className={`text-xs text-center ${googleApiStatus.status === 'error' ? 'text-red-500' : theme.mutedText} mt-2`}>
                                        {googleApiStatus.message}
                                    </p>
                                )}
                            </>
                        )}
                    </section>

                    <div className={`border-t ${theme.border}`}></div>

                    <section className="space-y-3">
                        <h3 className={`text-lg font-semibold ${theme.text} flex items-center gap-2`}><DownloadIcon className="w-5 h-5"/>Sao lưu cục bộ (Tệp)</h3>
                        <p className={`text-sm ${theme.mutedText}`}>Tải xuống một bản sao lưu toàn bộ dữ liệu của bạn (không gian làm việc, cache tệp, từ điển, cache) vào một tệp JSON.</p>
                        <button onClick={onExport} className={`w-full flex items-center justify-center gap-2 px-4 py-2 ${theme.button.bg} ${theme.button.text} font-semibold rounded-lg shadow-sm ${theme.button.hoverBg} transition-colors`}>
                            Tải xuống tệp sao lưu
                        </button>
                         <input
                            type="file"
                            ref={importInputRef}
                            onChange={onImport}
                            className="hidden"
                            accept=".json"
                        />
                        <button onClick={handleImportClick} className={`w-full flex items-center justify-center gap-2 px-4 py-2 ${theme.button.bg} ${theme.button.text} font-semibold rounded-lg shadow-sm ${theme.button.hoverBg} transition-colors`}>
                             <UploadIcon className="w-5 h-5"/> Tải lên từ tệp .json
                        </button>
                         <p className={`text-xs ${theme.mutedText}`}> <strong className="text-amber-600 dark:text-amber-400">Lưu ý:</strong> Tải lên sẽ ghi đè toàn bộ dữ liệu hiện tại.</p>
                    </section>

                    <div className={`border-t ${theme.border}`}></div>

                    <section className="space-y-3">
                        <h3 className={`text-lg font-semibold text-red-600 dark:text-red-400 flex items-center gap-2`}><TrashIcon className="w-5 h-5"/>Xóa dữ liệu</h3>
                        <p className={`text-sm ${theme.mutedText}`}>Giải phóng dung lượng hoặc khắc phục sự cố bằng cách xóa dữ liệu được lưu trong trình duyệt. Hành động này không thể hoàn tác.</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <button onClick={() => handleClearClick('vocabulary')} className={`px-4 py-2 text-sm font-semibold rounded-lg shadow-sm border border-red-500/50 text-red-600 hover:bg-red-500/10 transition-colors`}>Xóa từ điển</button>
                            <button onClick={() => handleClearClick('analysisCache')} className={`px-4 py-2 text-sm font-semibold rounded-lg shadow-sm border border-red-500/50 text-red-600 hover:bg-red-500/10 transition-colors`}>Xóa cache phân tích</button>
                            <button onClick={() => handleClearClick('translationCache')} className={`px-4 py-2 text-sm font-semibold rounded-lg shadow-sm border border-red-500/50 text-red-600 hover:bg-red-500/10 transition-colors`}>Xóa cache dịch</button>
                            <button onClick={() => handleClearClick('all')} className={`px-4 py-2 text-sm font-bold rounded-lg shadow-sm bg-red-600 text-white hover:bg-red-700 transition-colors`}>Xóa TẤT CẢ</button>
                        </div>
                    </section>
                </div>
            </div>
        </div>
    );
};

// --- Main App Component ---

const App = () => {
    // Local State
    const [settings, setSettings] = useState<AppSettings>({
        apiKey: '',
        fontSize: 16,
        hanziFontSize: 24,
        fontFamily: 'font-sans',
        theme: 'light',
        lineHeight: 1.6,
    });
    const [analysisCache, setAnalysisCache] = useState<Map<string, AnalyzedText>>(new Map());
    const [translationCache, setTranslationCache] = useState<Map<string, string>>(new Map());
    const [vocabulary, setVocabulary] = useState<VocabularyItem[]>([]);
    
    // Workspace State
    const [workspaceItems, setWorkspaceItems] = useState<WorkspaceItem[]>([]);
    const [processedFiles, setProcessedFiles] = useState<ProcessedFile[]>([]); // In-memory active files
    const [activeFileId, setActiveFileId] = useState<number | null>(null);
    const [filesCache, setFilesCache] = useState<Map<string, FileCache>>(new Map());


    // UI & Error State
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<ApiError | null>(null);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isVocabularyOpen, setIsVocabularyOpen] = useState(false);
    const [isCacheLibraryOpen, setIsCacheLibraryOpen] = useState(false);
    const [isDataManagementOpen, setIsDataManagementOpen] = useState(false);
    const [scrollTo, setScrollTo] = useState<{ chapterIndex: number; sentenceNumber: number } | null>(null);

    // Google Auth State
    const [googleApiStatus, setGoogleApiStatus] = useState<GoogleApiStatus>({ status: 'pending', message: 'Đang khởi tạo dịch vụ Google...' });
    const [tokenClient, setTokenClient] = useState<any>(null);
    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const [googleUser, setGoogleUser] = useState<any>(null);
    const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
    const userMenuRef = useRef<HTMLDivElement>(null);
    const debouncedSaveRef = useRef<NodeJS.Timeout>();


    // Task Queue State
    const [taskQueue, setTaskQueue] = useState<Array<{
        id: string,
        action: () => Promise<void>,
        description: string,
    }>>([]);
    const [isApiBusy, setIsApiBusy] = useState(false);
    const [currentTaskDescription, setCurrentTaskDescription] = useState<string | null>(null);
    const stopFlags = useRef<Set<string>>(new Set());
    
    // --- Data Loading & Saving ---
    const loadLocalData = useCallback(() => {
        try {
            const storedSettings = localStorage.getItem(SETTINGS_STORAGE_KEY);
            if (storedSettings) setSettings(prev => ({...prev, ...JSON.parse(storedSettings)}));
            
            const storedAnalysisCache = localStorage.getItem(ANALYSIS_CACHE_STORAGE_KEY);
            if (storedAnalysisCache) setAnalysisCache(new Map(JSON.parse(storedAnalysisCache)));
            
            const storedTranslationCache = localStorage.getItem(TRANSLATION_CACHE_STORAGE_KEY);
            if (storedTranslationCache) setTranslationCache(new Map(JSON.parse(storedTranslationCache)));
            
            const storedVocabulary = localStorage.getItem(VOCABULARY_STORAGE_KEY);
            if (storedVocabulary) setVocabulary(JSON.parse(storedVocabulary));
        } catch (e) { console.error("Failed to load data from localStorage", e); }
    }, []);

    useEffect(() => { loadLocalData(); }, [loadLocalData]);

    useEffect(() => { localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings)); }, [settings]);
    useEffect(() => { localStorage.setItem(ANALYSIS_CACHE_STORAGE_KEY, JSON.stringify(Array.from(analysisCache.entries()))); }, [analysisCache]);
    useEffect(() => { localStorage.setItem(TRANSLATION_CACHE_STORAGE_KEY, JSON.stringify(Array.from(translationCache.entries()))); }, [translationCache]);
    useEffect(() => { localStorage.setItem(VOCABULARY_STORAGE_KEY, JSON.stringify(vocabulary)); }, [vocabulary]);

    // This effect syncs changes from open files (processedFiles) into the persistent filesCache
    useEffect(() => {
        setFilesCache(prevCache => {
            const updatedCache = new Map(prevCache);
            let hasChanges = false;
            processedFiles.forEach(file => {
                if (file.driveFileId) {
                    const { id, originalContent, ...rest } = file;
                    // A quick check to see if the object has actually changed before updating
                    if (JSON.stringify(rest) !== JSON.stringify(updatedCache.get(file.driveFileId))) {
                        updatedCache.set(file.driveFileId, rest);
                        hasChanges = true;
                    }
                }
            });
            return hasChanges ? updatedCache : prevCache;
        });
    }, [processedFiles]);


    // Auto-save to Drive (debounced)
    useEffect(() => {
        if (!isLoggedIn || googleApiStatus.status !== 'ready') return;
        
        if (debouncedSaveRef.current) clearTimeout(debouncedSaveRef.current);
    
        debouncedSaveRef.current = setTimeout(() => {
            const dataToSave = packDataForExport();
            driveService.saveDataToDrive(dataToSave).catch(err => {
                console.error("Lỗi tự động lưu vào Drive:", err);
                // Optionally show a non-intrusive error message
            });
        }, 3000); // 3-second debounce
    
        return () => {
            if (debouncedSaveRef.current) clearTimeout(debouncedSaveRef.current);
        };
    }, [isLoggedIn, googleApiStatus, settings, vocabulary, analysisCache, translationCache, workspaceItems, filesCache]);

    const unpackAndLoadData = (data: any, from: 'local' | 'drive') => {
        if (!data || !data.version || !data.data) {
            if (from === 'drive') alert("Không tìm thấy dữ liệu sao lưu hợp lệ trên Drive.");
            return;
        }
        const { settings, vocabulary, analysisCache, translationCache, workspaceItems: loadedWorkspaceItems, filesCache: loadedFilesCache } = data.data;
        if (settings) setSettings(settings);
        if (vocabulary) setVocabulary(vocabulary);
        if (analysisCache) setAnalysisCache(new Map(analysisCache));
        if (translationCache) setTranslationCache(new Map(translationCache));
        if (loadedWorkspaceItems) setWorkspaceItems(loadedWorkspaceItems);
        if (loadedFilesCache) setFilesCache(new Map(loadedFilesCache));

        if (from === 'drive') {
            // No need to open all files, just show the dashboard
            setActiveFileId(null);
            setProcessedFiles([]);
        }
        alert('Khôi phục dữ liệu thành công!');
    };

    // --- Google API & Auth ---
    useEffect(() => {
        const initGoogleApis = async () => {
            const GOOGLE_CLIENT_ID = import.meta.env?.VITE_GOOGLE_CLIENT_ID;
            const GOOGLE_API_KEY = import.meta.env?.VITE_API_KEY;

            if (!GOOGLE_CLIENT_ID || !GOOGLE_API_KEY) {
                const missingKey = !GOOGLE_CLIENT_ID ? 'VITE_GOOGLE_CLIENT_ID' : 'VITE_API_KEY';
                setGoogleApiStatus({ status: 'error', message: `Lỗi cấu hình: ${missingKey} chưa được thiết lập.` });
                return;
            }

            try {
                await Promise.all([
                    loadScript('https://apis.google.com/js/api.js'),
                    loadScript('https://accounts.google.com/gsi/client'),
                ]);

                await new Promise<void>((resolve, reject) => {
                    window.gapi.load('client:picker', () => {
                        window.gapi.client.init({
                            apiKey: GOOGLE_API_KEY,
                            discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'],
                        }).then(resolve, reject);
                    });
                });
                
                const client = window.google.accounts.oauth2.initTokenClient({
                    client_id: GOOGLE_CLIENT_ID,
                    scope: DRIVE_SCOPES,
                    callback: async (tokenResponse: any) => {
                        if (tokenResponse.error) {
                            console.error("Google Auth Error:", tokenResponse);
                            setError({ message: `Lỗi đăng nhập Google: ${tokenResponse.error_description || tokenResponse.error}` });
                            setIsLoggedIn(false);
                            return;
                        }
                        setIsLoggedIn(true);
                        
                        try {
                            const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                                headers: { 'Authorization': `Bearer ${tokenResponse.access_token}` }
                            });
                            if (!response.ok) throw new Error(`Failed to fetch profile: ${response.statusText}`);
                            const profile = await response.json();
                            setGoogleUser(profile);

                            // Auto-load data from drive after successful login
                            const loadedData = await driveService.loadDataFromDrive();
                            if(loadedData) {
                                unpackAndLoadData(loadedData, 'drive');
                            }
                        } catch (err) {
                            console.error("Lỗi khi lấy thông tin người dùng hoặc tải dữ liệu:", err);
                            const message = err instanceof Error ? err.message : String(err);
                            setError({ message: `Không thể lấy thông tin người dùng: ${message}` });
                        }
                    },
                });
                setTokenClient(client);
                setGoogleApiStatus({ status: 'ready', message: 'Dịch vụ Google đã sẵn sàng.' });
            } catch (error) {
                console.error("Lỗi khởi tạo API Google:", error);
                const message = error instanceof Error ? error.message : "Lỗi không xác định";
                setGoogleApiStatus({ status: 'error', message: `Không thể khởi tạo dịch vụ Google: ${message}` });
            }
        };
        initGoogleApis();
    }, []);
    
    // --- Task Queue & UI Effects ---
    useEffect(() => {
        if (isApiBusy || taskQueue.length === 0) return;

        const task = taskQueue[0];
        setTaskQueue(prev => prev.slice(1));
        setIsApiBusy(true);
        setCurrentTaskDescription(task.description);
        setError(null);

        (async () => {
            try {
                await task.action();
            } catch (err: any) {
                console.error(`Lỗi trong tác vụ '${task.description}':`, err);
                setError({ message: err.message || `Lỗi khi thực hiện: ${task.description}` });
            } finally {
                setIsApiBusy(false);
                setCurrentTaskDescription(null);
            }
        })();
    }, [taskQueue, isApiBusy]);
    
    useEffect(() => {
        if (scrollTo) {
            const sentenceIndex = processedFiles.find(f => f.id === activeFileId)
                ?.chapters[scrollTo.chapterIndex]
                ?.sentences.findIndex(s => s.sentenceNumber === scrollTo.sentenceNumber) ?? -1;
                
            if (sentenceIndex === -1) {
                setScrollTo(null);
                return;
            }

            const elementId = `sentence-${scrollTo.chapterIndex}-${sentenceIndex}`;
            const element = document.getElementById(elementId);
            if (element) {
                setTimeout(() => {
                    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    element.classList.add('highlight-scroll');
                    setTimeout(() => {
                        element.classList.remove('highlight-scroll');
                    }, 2500);
                }, 100);
            }
            setScrollTo(null);
        }
    }, [scrollTo, activeFileId, processedFiles]);
    
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
                setIsUserMenuOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, [userMenuRef]);
    
    const checkApiKey = useCallback(() => {
        if (!settings.apiKey) {
            alert("Vui lòng nhập Gemini API Key của bạn trong phần Cài đặt (biểu tượng bánh răng) trước.");
            setIsSettingsOpen(true);
            return false;
        }
        return true;
    }, [settings.apiKey]);


    const handleProcessAndOpenFile = useCallback((text: string, fileName: string, fileInfo: { driveFileId?: string; type: 'file' | 'text' }) => {
        if (!text.trim()) {
            setError({ message: "Nội dung tệp trống." });
            return;
        }

        setError(null);
        setIsLoading(true);
        setTimeout(() => {
            try {
                const chapters = processTextIntoChapters(text);
                if (chapters.length === 0) {
                     setError({ message: "Không tìm thấy nội dung có thể phân tích." });
                     setIsLoading(false);
                     return;
                }
                
                const newFile: ProcessedFile = {
                    id: fileInfo.driveFileId ? Date.now() + Math.random() : Date.now(), // Ensure local files have unique IDs
                    fileName,
                    originalContent: text,
                    chapters,
                    visibleRange: { start: 0, end: Math.min(PAGE_SIZE, chapters.length) },
                    pageSize: PAGE_SIZE,
                    driveFileId: fileInfo.driveFileId,
                    type: fileInfo.type,
                    lastModified: new Date().toISOString(),
                };
                
                setProcessedFiles(prev => {
                    // Prevent opening the same Drive file multiple times
                    if (fileInfo.driveFileId && prev.some(f => f.driveFileId === fileInfo.driveFileId)) {
                        setActiveFileId(prev.find(f => f.driveFileId === fileInfo.driveFileId)!.id);
                        return prev;
                    }
                    return [...prev, newFile]
                });
                setActiveFileId(newFile.id);

            } catch (e: any) {
                setError({ message: `Lỗi xử lý văn bản: ${e.message}` });
            } finally {
                setIsLoading(false);
            }
        }, 50);
    }, []);

    const handleCreateNewWorkspaceItem = useCallback(async (text: string, fileName: string, type: 'file' | 'text') => {
        if (!text.trim()) {
            setError({ message: "Vui lòng nhập văn bản hoặc tải lên một tệp." });
            return;
        }

        const fileInfo = { type };

        if (!isLoggedIn) {
            handleProcessAndOpenFile(text, fileName, fileInfo);
            return;
        }

        setIsLoading(true);
        setError(null);
        try {
            const driveFileId = await driveService.createFileInDrive(fileName, text);
            const newWorkspaceItem: WorkspaceItem = {
                driveFileId,
                name: fileName,
                type,
                lastModified: new Date().toISOString(),
            };
            setWorkspaceItems(prev => [newWorkspaceItem, ...prev.filter(item => item.driveFileId !== driveFileId)]);
            handleProcessAndOpenFile(text, fileName, { driveFileId, type });
        } catch(e: any) {
            setError({ message: `Lỗi khi tạo tệp trên Drive: ${e.message}`});
        } finally {
            setIsLoading(false);
        }
    }, [isLoggedIn, handleProcessAndOpenFile]);


    const handleSaveVocabulary = useCallback((newTerms: SpecialTerm[], location: VocabularyLocation) => {
        setVocabulary(prevVocab => {
            const vocabMap = new Map(prevVocab.map(item => [item.term, item]));
            let updated = false;

            newTerms.forEach(termData => {
                if (!vocabMap.has(termData.term)) {
                    vocabMap.set(termData.term, {
                        ...termData,
                        firstLocation: location,
                        isForceSino: false,
                    });
                    updated = true;
                }
            });

            return updated ? Array.from(vocabMap.values()) : prevVocab;
        });
    }, []);

    const handleDeleteVocabularyItem = useCallback((termToDelete: string) => {
        setVocabulary(prevVocab => prevVocab.filter(item => item.term !== termToDelete));
    }, []);
    
    const handleToggleForceSino = useCallback((termToToggle: string) => {
        setVocabulary(prevVocab => 
            prevVocab.map(item => 
                item.term === termToToggle ? { ...item, isForceSino: !item.isForceSino } : item
            )
        );
    }, []);

    const handleUpdateVocabularyItem = useCallback((originalTerm: string, updatedItem: VocabularyItem) => {
        setVocabulary(prevVocab => {
            const newVocab = prevVocab.map(item => {
                if (item.term === originalTerm) {
                    return updatedItem;
                }
                return item;
            });
            return newVocab;
        });
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


    const handleIndividualSentenceAnalysis = useCallback(async (chapterIndex: number, sentenceIndex: number) => {
        const file = processedFiles.find(f => f.id === activeFileId);
        if (!file) return;

        const sentence = file.chapters[chapterIndex].sentences[sentenceIndex];

        const updateSentence = (update: Partial<SentenceData>) => {
            handleSentencesUpdate(chapterIndex, [{ index: sentenceIndex, update }]);
        };
        
        if (sentence.analysisState === 'loading') return;

        if (sentence.analysisState === 'done') {
            const modes: DisplayMode[] = ['translation', 'grammar', 'detailed-word', 'original'];
            const currentModeIndex = modes.indexOf(sentence.displayMode!);
            const nextMode = modes[(currentModeIndex + 1) % modes.length];
            updateSentence({ displayMode: nextMode });
            return;
        }
        
        if (!checkApiKey()) return;
        
        const analysisCacheKey = sentence.original;
        if (analysisCache.has(analysisCacheKey)) {
            const cachedResult = analysisCache.get(analysisCacheKey)!;
            updateSentence({ analysisState: 'done', analysisResult: cachedResult, displayMode: 'translation' });
            return;
        } 
        
        const task = {
            id: `analyze-${file.id}-${chapterIndex}-${sentenceIndex}`,
            description: `Phân tích câu...`,
            action: async () => {
                const forcedSinoTerms = vocabulary.filter(v => v.isForceSino).map(v => ({ term: v.term, sinoVietnamese: v.sinoVietnamese }));
                updateSentence({ analysisState: 'loading' });
                try {
                    const result = await analyzeSentence(sentence.original, settings.apiKey, forcedSinoTerms);
                    setAnalysisCache(prevCache => new Map(prevCache).set(analysisCacheKey, result));
                    updateSentence({ analysisState: 'done', analysisResult: result, displayMode: 'translation' });

                    if (result.specialTerms && result.specialTerms.length > 0) {
                        const location: VocabularyLocation = {
                            chapterIndex: chapterIndex,
                            chapterTitle: file.chapters[chapterIndex].title,
                            sentenceNumber: sentence.sentenceNumber!,
                            originalSentence: sentence.original,
                        };
                        handleSaveVocabulary(result.specialTerms, location);
                    }
                } catch (err: any) {
                    updateSentence({ analysisState: 'error', analysisError: err.message });
                    throw err; 
                }
            }
        };
        setTaskQueue(prev => [...prev, task]);
    }, [activeFileId, processedFiles, analysisCache, handleSentencesUpdate, handleSaveVocabulary, vocabulary, settings.apiKey, checkApiKey]);
    
    const handleTranslateChapter = useCallback((chapterIndex: number) => {
        const file = processedFiles.find(f => f.id === activeFileId);
        if (!file || !checkApiKey()) return;

        const task = {
            id: `translate-${file.id}-${chapterIndex}`,
            description: `Đang dịch chương #${chapterIndex + 1}`,
            action: async () => {
                const stopKey = `translate-${file.id}-${chapterIndex}`;
                stopFlags.current.delete(stopKey);

                const chapter = file.chapters[chapterIndex];
                const sentencesToTranslate = chapter.sentences
                    .map((s, i) => ({ ...s, originalIndex: i }))
                    .filter(s => !s.isTitle && s.translationState === 'pending');

                const totalToTranslate = sentencesToTranslate.length;
                if (totalToTranslate === 0) return;
                
                const forcedSinoTerms = vocabulary.filter(v => v.isForceSino).map(v => ({ term: v.term, sinoVietnamese: v.sinoVietnamese }));

                handleChapterUpdate(chapterIndex, { isBatchTranslating: true, batchTranslationProgress: 0 });
                let translatedCount = 0;

                for (let i = 0; i < totalToTranslate; i += TRANSLATION_BATCH_SIZE) {
                    if (stopFlags.current.has(stopKey)) break;
                    
                    const batch = sentencesToTranslate.slice(i, i + TRANSLATION_BATCH_SIZE);
                    handleSentencesUpdate(chapterIndex, batch.map(s => ({ index: s.originalIndex, update: { translationState: 'loading' } })));

                    try {
                        const batchOriginals = batch.map(s => s.original);
                        const translationResults = await translateSentencesInBatch(batchOriginals, settings.apiKey, forcedSinoTerms);
                        handleSentencesUpdate(chapterIndex, batch.map((s, j) => ({
                            index: s.originalIndex,
                            update: { translationState: 'done', translation: translationResults[j] }
                        })));
                    } catch (err: any) {
                        handleSentencesUpdate(chapterIndex, batch.map(s => ({
                            index: s.originalIndex,
                            update: { translationState: 'error', translationError: err.message }
                        })));
                        throw err; 
                    }
                    
                    translatedCount += batch.length;
                    handleChapterUpdate(chapterIndex, { batchTranslationProgress: translatedCount / totalToTranslate });
                }

                handleChapterUpdate(chapterIndex, { isBatchTranslating: false });
                
                if (!stopFlags.current.has(stopKey)) {
                    setTaskQueue(prev => [...prev, {
                        id: `analyze-seq-${file.id}-${chapterIndex}`,
                        description: `Phân tích chương #${chapterIndex + 1}`,
                        action: () => handleAnalyzeChapterSequentially(chapterIndex),
                    }]);
                }
            }
        };

        setTaskQueue(prev => [...prev, task]);
    }, [activeFileId, processedFiles, handleChapterUpdate, handleSentencesUpdate, vocabulary, settings.apiKey, checkApiKey]);

    const handleAnalyzeChapterSequentially = useCallback(async (chapterIndex: number) => {
        const file = processedFiles.find(f => f.id === activeFileId);
        if (!file || !checkApiKey()) return;

        const stopKey = `analyze-${file.id}-${chapterIndex}`;
        stopFlags.current.delete(stopKey);
        
        const chapter = file.chapters[chapterIndex];
        const sentencesToAnalyze = chapter.sentences
            .map((s, i) => ({ ...s, originalIndex: i }))
            .filter(s => s.analysisState === 'pending');

        const totalToAnalyze = sentencesToAnalyze.length;
        if (totalToAnalyze === 0) return;

        const forcedSinoTerms = vocabulary.filter(v => v.isForceSino).map(v => ({ term: v.term, sinoVietnamese: v.sinoVietnamese }));
        handleChapterUpdate(chapterIndex, { isBatchAnalyzing: true, batchAnalysisProgress: 0 });
        let analyzedCount = 0;

        for (const sentence of sentencesToAnalyze) {
            if (stopFlags.current.has(stopKey)) break;
            
            handleSentencesUpdate(chapterIndex, [{ index: sentence.originalIndex, update: { analysisState: 'loading' } }]);

            try {
                const analysisCacheKey = sentence.original;
                let result: AnalyzedText;
                if(analysisCache.has(analysisCacheKey)) {
                    result = analysisCache.get(analysisCacheKey)!;
                } else {
                    result = await analyzeSentence(sentence.original, settings.apiKey, forcedSinoTerms);
                    setAnalysisCache(prev => new Map(prev).set(analysisCacheKey, result));
                }

                handleSentencesUpdate(chapterIndex, [{ index: sentence.originalIndex, update: { analysisState: 'done', analysisResult: result, displayMode: 'translation' } }]);
                
                if (result.specialTerms && result.specialTerms.length > 0) {
                    const location: VocabularyLocation = {
                        chapterIndex: chapterIndex,
                        chapterTitle: chapter.title,
                        sentenceNumber: sentence.sentenceNumber!,
                        originalSentence: sentence.original,
                    };
                    handleSaveVocabulary(result.specialTerms, location);
                }

            } catch (err: any) {
                 handleSentencesUpdate(chapterIndex, [{ index: sentence.originalIndex, update: { analysisState: 'error', analysisError: err.message } }]);
            }

            analyzedCount++;
            handleChapterUpdate(chapterIndex, { batchAnalysisProgress: analyzedCount / totalToAnalyze });
        }

        handleChapterUpdate(chapterIndex, { isBatchAnalyzing: false });

    }, [activeFileId, processedFiles, handleChapterUpdate, handleSentencesUpdate, analysisCache, handleSaveVocabulary, vocabulary, settings.apiKey, checkApiKey]);

    const stopProcess = useCallback((type: 'translate' | 'analyze', chapterIndex: number) => {
        const file = processedFiles.find(f => f.id === activeFileId);
        if (file) {
            const stopKey = `${type}-${file.id}-${chapterIndex}`;
            stopFlags.current.add(stopKey);

            if (type === 'translate') {
                handleChapterUpdate(chapterIndex, { isBatchTranslating: false });
            } else {
                 handleChapterUpdate(chapterIndex, { isBatchAnalyzing: false });
            }

            const chapter = file.chapters[chapterIndex];
            const sentenceUpdates: {index: number, update: Partial<SentenceData>}[] = [];
            chapter.sentences.forEach((s, i) => {
                if (s.translationState === 'loading' && type === 'translate') {
                    sentenceUpdates.push({ index: i, update: { translationState: 'pending' } });
                }
                 if (s.analysisState === 'loading' && type === 'analyze') {
                    sentenceUpdates.push({ index: i, update: { analysisState: 'pending' } });
                }
            });
            if (sentenceUpdates.length > 0) {
                 handleSentencesUpdate(chapterIndex, sentenceUpdates);
            }
        }
    }, [activeFileId, processedFiles, handleChapterUpdate, handleSentencesUpdate]);

    const handleVisibleRangeUpdate = useCallback((newRange: { start: number; end: number }) => {
         setProcessedFiles(prevFiles => prevFiles.map(file => {
            if (file.id === activeFileId) { return { ...file, visibleRange: newRange }; }
            return file;
        }));
    }, [activeFileId]);

    const handlePageSizeUpdate = useCallback((newSize: number) => {
        setProcessedFiles(prevFiles => prevFiles.map(file => {
            if (file.id === activeFileId) {
                return { ...file, pageSize: newSize, visibleRange: { start: 0, end: Math.min(newSize, file.chapters.length) } };
            }
            return file;
        }));
    }, [activeFileId]);

    const handleCloseFile = useCallback((fileIdToClose: number) => {
        const newFiles = processedFiles.filter(f => f.id !== fileIdToClose);
        
        if (activeFileId === fileIdToClose) {
            if (newFiles.length > 0) {
                setActiveFileId(newFiles[0].id);
            } else {
                setActiveFileId(null); // Go back to dashboard view
            }
        }
        setProcessedFiles(newFiles);
    }, [processedFiles, activeFileId]);

    const handleUnifyVocabulary = useCallback(() => {
        const termsToUnify = vocabulary.filter(v => v.isForceSino && v.vietnameseTranslation);
        if (termsToUnify.length === 0) {
            alert("Không có thuật ngữ nào được đánh dấu để đồng nhất.");
            return;
        }

        setProcessedFiles(prevFiles => {
            return prevFiles.map(file => {
                const newChapters = file.chapters.map(chapter => {
                    const newSentences = chapter.sentences.map(sentence => {
                        let newTranslation = sentence.translation;
                        if (!newTranslation) return sentence;

                        termsToUnify.forEach(term => {
                            const regex = new RegExp(escapeRegex(term.vietnameseTranslation), 'gi');
                            newTranslation = newTranslation.replace(regex, term.sinoVietnamese);
                        });
                        
                        return { ...sentence, translation: newTranslation };
                    });
                    return { ...chapter, sentences: newSentences };
                });
                return { ...file, chapters: newChapters };
            });
        });

        alert(`Đã đồng nhất ${termsToUnify.length} thuật ngữ trên toàn bộ văn bản.`);
    }, [vocabulary]);

    const handleGoToLocation = useCallback((location: VocabularyLocation) => {
        setIsVocabularyOpen(false);
        const file = processedFiles.find(f => f.id === activeFileId);
        if (!file) return;

        const { chapterIndex, sentenceNumber } = location;
        const pageSize = file.pageSize;
        const targetPage = Math.floor(chapterIndex / pageSize);
        const start = targetPage * pageSize;
        const end = Math.min(start + pageSize, file.chapters.length);
        
        handleVisibleRangeUpdate({ start, end });
        handleChapterUpdate(chapterIndex, { isExpanded: true });
        
        setScrollTo({ chapterIndex, sentenceNumber });
    }, [activeFileId, processedFiles, handleVisibleRangeUpdate, handleChapterUpdate]);
    
    const packDataForExport = () => ({
        version: '1.3',
        createdAt: new Date().toISOString(),
        data: {
            settings,
            vocabulary,
            analysisCache: Array.from(analysisCache.entries()),
            translationCache: Array.from(translationCache.entries()),
            workspaceItems,
            filesCache: Array.from(filesCache.entries()),
        }
    });
    
    const handleExportData = useCallback(() => {
        try {
            const dataToExport = packDataForExport();
            const jsonString = JSON.stringify(dataToExport, null, 2);
            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `trinh-phan-tich-tieng-trung-backup-${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            alert('Đã tải xuống tệp sao lưu thành công.');
        } catch (err) {
            console.error('Lỗi khi xuất dữ liệu:', err);
            alert('Đã xảy ra lỗi khi tạo tệp sao lưu.');
        }
    }, [settings, vocabulary, analysisCache, translationCache, workspaceItems, filesCache]);

    const handleImportData = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const text = e.target?.result as string;
                const parsedData = JSON.parse(text);
                unpackAndLoadData(parsedData, 'local');
                setIsDataManagementOpen(false);
            } catch (err: any) {
                console.error('Lỗi khi nhập dữ liệu:', err);
                alert(`Đã xảy ra lỗi khi đọc tệp: ${err.message}`);
            } finally {
                if (event.target) event.target.value = '';
            }
        };
        reader.readAsText(file);
    }, []);

    const handleClearData = useCallback((dataType: 'vocabulary' | 'analysisCache' | 'translationCache' | 'settings' | 'all') => {
        const clearVocabulary = () => setVocabulary([]);
        const clearAnalysisCache = () => setAnalysisCache(new Map());
        const clearTranslationCache = () => setTranslationCache(new Map());
        const clearFilesCache = () => setFilesCache(new Map());
        const resetSettings = () => setSettings({
            apiKey: '',
            fontSize: 16,
            hanziFontSize: 24,
            fontFamily: 'font-sans',
            theme: 'light',
            lineHeight: 1.6,
        });

        switch(dataType) {
            case 'vocabulary': clearVocabulary(); break;
            case 'analysisCache': clearAnalysisCache(); break;
            case 'translationCache': clearTranslationCache(); break;
            case 'settings': resetSettings(); break;
            case 'all':
                clearVocabulary();
                clearAnalysisCache();
                clearTranslationCache();
                clearFilesCache();
                resetSettings();
                setWorkspaceItems([]);
                break;
        }
        alert(`Đã xóa "${dataType}" thành công.`);
    }, []);

    const handleAuthClick = () => {
        if (tokenClient) {
            tokenClient.requestAccessToken({ prompt: '' });
        }
    };

    const handleSignoutClick = () => {
        const cred = window.gapi.client.getToken();
        if (cred) {
            window.google.accounts.oauth2.revoke(cred.access_token, () => {});
            window.gapi.client.setToken(null);
        }
        setIsLoggedIn(false);
        setGoogleUser(null);
        setWorkspaceItems([]);
        setProcessedFiles([]);
        setFilesCache(new Map());
        setActiveFileId(null);
    };
    
    const handleOpenFileFromWorkspace = async (item: WorkspaceItem) => {
        // If already open, just switch to it
        const existingFile = processedFiles.find(f => f.driveFileId === item.driveFileId);
        if (existingFile) {
            setActiveFileId(existingFile.id);
            return;
        }

        // Check our new cache first!
        const cachedFileData = filesCache.get(item.driveFileId);
        if (cachedFileData) {
            const newFile: ProcessedFile = {
                id: Date.now() + Math.random(),
                ...cachedFileData,
                originalContent: '', // Not needed immediately, we have sentence.original
            };
            setProcessedFiles(prev => [...prev, newFile]);
            setActiveFileId(newFile.id);
            return;
        }

        // Not in cache, proceed with the original flow (fetch from Drive)
        setIsLoading(true);
        setError(null);
        try {
            const content = await driveService.fetchFileContent(item.driveFileId);
            handleProcessAndOpenFile(content, item.name, { driveFileId: item.driveFileId, type: item.type });
        } catch (err: any) {
            setError({ message: `Lỗi tải tệp từ Drive: ${err.message}` });
        } finally {
            setIsLoading(false);
        }
    };

    const handleDeleteWorkspaceItem = async (itemToDelete: WorkspaceItem, deleteFromDrive: boolean) => {
        if (deleteFromDrive) {
            if (!window.confirm(`BẠN CÓ CHẮC MUỐN XÓA VĨNH VIỄN TỆP "${itemToDelete.name}" KHỎI GOOGLE DRIVE KHÔNG? Hành động này không thể hoàn tác.`)) {
                return;
            }
            setIsLoading(true);
            setError(null);
            try {
                await driveService.deleteFileFromDrive(itemToDelete.driveFileId);
            } catch (err: any) {
                setError({ message: `Lỗi khi xóa tệp trên Drive: ${err.message}` });
                setIsLoading(false);
                return;
            } finally {
                setIsLoading(false);
            }
        } else {
            if (!window.confirm(`Bạn có chắc muốn xóa "${itemToDelete.name}" khỏi không gian làm việc không? Tệp gốc trên Drive sẽ không bị ảnh hưởng.`)) {
                return;
            }
        }
    
        // Close tab if it's open
        const fileToRemove = processedFiles.find(f => f.driveFileId === itemToDelete.driveFileId);
        if (fileToRemove) {
            handleCloseFile(fileToRemove.id);
        }

        // Remove from cache
        setFilesCache(prevCache => {
            const newCache = new Map(prevCache);
            if (itemToDelete.driveFileId) {
                newCache.delete(itemToDelete.driveFileId);
            }
            return newCache;
        });
    
        // Remove from workspace list
        setWorkspaceItems(prev => prev.filter(item => item.driveFileId !== itemToDelete.driveFileId));
    };

    const handleOpenFileFromDrivePicker = () => {
        const GOOGLE_API_KEY = import.meta.env?.VITE_API_KEY;
        const token = window.gapi.client.getToken();

        if (!isLoggedIn || !token) {
            setError({ message: "Vui lòng đăng nhập bằng tài khoản Google trước." });
            return;
        }
        if (!GOOGLE_API_KEY) {
            setError({ message: "Lỗi cấu hình: VITE_API_KEY chưa được thiết lập." });
            return;
        }
    
        const view = new window.google.picker.DocsView()
            .setMimeTypes("application/vnd.google-apps.document,text/plain");
    
        const picker = new window.google.picker.PickerBuilder()
            .addView(view)
            .setOAuthToken(token.access_token)
            .setDeveloperKey(GOOGLE_API_KEY)
            .setCallback(async (data: any) => {
                if (data.action === window.google.picker.Action.PICKED) {
                    const file = data.docs[0];
                    setIsLoading(true);
                    setError(null);
                    try {
                        const content = await driveService.fetchFileContent(file.id, file.mimeType);
                        // Open it, but don't add to workspace yet. It gets added if user works on it and has state.
                        // Actually, let's treat it like a new file.
                        await handleCreateNewWorkspaceItem(content, file.name, 'file');
                    } catch (err: any) {
                        setError({ message: `Lỗi tải tệp từ Drive: ${err.message}` });
                    } finally {
                        setIsLoading(false);
                    }
                }
            })
            .build();
        picker.setVisible(true);
    };

    const handleAddNewFile = useCallback(() => { setActiveFileId(null); }, []);

    const activeFile = processedFiles.find(f => f.id === activeFileId);
    const themeClasses = getThemeClasses(settings.theme);

    return (
        <SettingsContext.Provider value={{ settings, setSettings, theme: themeClasses, vocabulary }}>
            <div 
                className={`min-h-screen transition-colors duration-300 ${themeClasses.mainBg} ${themeClasses.text} ${settings.fontFamily}`}
                style={{ fontSize: `${settings.fontSize}px`, lineHeight: settings.lineHeight }}
            >
                <VocabularyModal 
                    isOpen={isVocabularyOpen}
                    onClose={() => setIsVocabularyOpen(false)} 
                    vocabulary={vocabulary} 
                    onDelete={handleDeleteVocabularyItem}
                    onToggleForceSino={handleToggleForceSino}
                    onUpdate={handleUpdateVocabularyItem}
                    onGoToLocation={handleGoToLocation}
                    onUnify={handleUnifyVocabulary}
                />
                <CacheLibraryModal 
                    isOpen={isCacheLibraryOpen} 
                    onClose={() => setIsCacheLibraryOpen(false)} 
                    analysisCache={analysisCache}
                    translationCache={translationCache}
                    onDeleteAnalysis={(key) => setAnalysisCache(prev => { const n = new Map(prev); n.delete(key); return n; })}
                    onDeleteTranslation={(key) => setTranslationCache(prev => { const n = new Map(prev); n.delete(key); return n; })}
                />
                <SettingsPanel isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
                <DataManagementModal
                    isOpen={isDataManagementOpen}
                    onClose={() => setIsDataManagementOpen(false)}
                    onExport={handleExportData}
                    onImport={handleImportData}
                    onClear={handleClearData}
                    googleApiStatus={googleApiStatus}
                    isLoggedIn={isLoggedIn}
                    onLogin={handleAuthClick}
                />

                <header className={`${themeClasses.cardBg}/80 backdrop-blur-lg border-b ${themeClasses.border} sticky top-0 z-20`}>
                    <div className="container mx-auto px-4 py-3 flex justify-between items-center">
                        <h1 className="text-xl md:text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-cyan-500">
                            Trình Phân Tích Tiếng Trung
                        </h1>
                         <div className="flex items-center gap-2 md:gap-4">
                              <button onClick={() => setIsVocabularyOpen(true)} className={`${themeClasses.mutedText} hover:${themeClasses.text} transition-colors`} title="Mở từ điển">
                                <BookOpenIcon className="w-6 h-6" />
                            </button>
                             <button onClick={() => setIsCacheLibraryOpen(true)} className={`${themeClasses.mutedText} hover:${themeClasses.text} transition-colors`} title="Mở thư viện cache">
                                <ArchiveBoxIcon className="w-6 h-6" />
                            </button>
                            <button onClick={() => setIsDataManagementOpen(true)} className={`${themeClasses.mutedText} hover:${themeClasses.text} transition-colors`} title="Quản lý Dữ liệu (Sao lưu/Khôi phục)">
                                <BookmarkSquareIcon className="w-6 h-6" />
                            </button>
                             
                            {isLoggedIn && googleUser ? (
                                <div className="relative" ref={userMenuRef}>
                                    <button
                                        onClick={() => setIsUserMenuOpen(o => !o)}
                                        className="w-8 h-8 rounded-full overflow-hidden transition-all duration-200 ring-2 ring-transparent hover:ring-blue-500 focus:ring-blue-500"
                                        title="Tài khoản người dùng"
                                    >
                                        <img src={googleUser.picture} alt="User avatar" className="w-full h-full object-cover" />
                                    </button>

                                    {isUserMenuOpen && (
                                        <div className={`absolute top-full right-0 mt-2 w-64 ${themeClasses.cardBg} border ${themeClasses.border} rounded-lg shadow-xl z-10`}>
                                            <div className="p-3">
                                                <p className="font-semibold truncate" title={googleUser.name}>{googleUser.name}</p>
                                                <p className={`text-sm ${themeClasses.mutedText} truncate`} title={googleUser.email}>{googleUser.email}</p>
                                            </div>
                                            <div className={`my-0 h-px ${themeClasses.mainBg}`}></div>
                                            <div className="p-1">
                                                <button
                                                    onClick={() => {
                                                        handleSignoutClick();
                                                        setIsUserMenuOpen(false);
                                                    }}
                                                    className={`w-full flex items-center gap-3 p-2 rounded-md ${themeClasses.hoverBg} text-red-500 dark:text-red-400 font-semibold transition-colors`}
                                                >
                                                    <ArrowRightOnRectangleIcon className="w-5 h-5" />
                                                    <span>Đăng xuất</span>
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ) : null}

                             <a href="https://github.com/google/genai-js" target="_blank" rel="noopener noreferrer" className={`${themeClasses.mutedText} hover:${themeClasses.text} transition-colors hidden md:block`}>
                                <GithubIcon className="w-6 h-6" />
                            </a>
                        </div>
                    </div>
                     {isApiBusy && currentTaskDescription && (
                        <div className="bg-blue-500/10 text-blue-800 dark:text-blue-300 text-xs text-center py-1 flex items-center justify-center gap-2">
                            <Spinner variant="dark" />
                            <span>{currentTaskDescription} (Hàng đợi: {taskQueue.length})</span>
                        </div>
                    )}
                </header>

                <main className="container mx-auto p-4 md:p-8">
                    <div className="max-w-5xl mx-auto">
                        {processedFiles.length > 0 && <WorkspaceTabs 
                            files={processedFiles}
                            activeFileId={activeFileId}
                            onSelectTab={setActiveFileId}
                            onCloseTab={handleCloseFile}
                            onAddNew={handleAddNewFile}
                        />}
                        
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
                                {isLoggedIn ? (
                                    <WorkspaceDashboard
                                        items={workspaceItems}
                                        onOpenItem={handleOpenFileFromWorkspace}
                                        onDeleteItem={handleDeleteWorkspaceItem}
                                        onNewText={(text, name) => handleCreateNewWorkspaceItem(text, name, 'text')}
                                        onNewFile={(text, name) => handleCreateNewWorkspaceItem(text, name, 'file')}
                                        onOpenDrivePicker={handleOpenFileFromDrivePicker}
                                        isLoading={isLoading}
                                    />
                                ) : (
                                     <InputArea
                                        onProcess={(text, name) => handleCreateNewWorkspaceItem(text, name, 'text')}
                                        isLoading={isLoading}
                                        isLoggedIn={isLoggedIn}
                                    />
                                )}
                            </div>
                        ) : (
                           <div className="mt-4">
                               <FileDisplay 
                                    fileData={activeFile} 
                                    onSentenceClick={(ci, si) => handleIndividualSentenceAnalysis(ci, si)}
                                    onVisibleRangeUpdate={handleVisibleRangeUpdate}
                                    onPageSizeUpdate={handlePageSizeUpdate}
                                    onChapterTranslate={handleTranslateChapter}
                                    onChapterStopTranslate={(ci) => stopProcess('translate', ci)}
                                    onChapterAnalyze={(ci) => setTaskQueue(prev => [...prev, {id: `analyze-seq-${activeFile.id}-${ci}`, description: `Phân tích chương #${ci+1}`, action: () => handleAnalyzeChapterSequentially(ci)}])}
                                    onChapterStopAnalyze={(ci) => stopProcess('analyze', ci)}
                                    onChapterUpdate={handleChapterUpdate}
                                    isApiBusy={isApiBusy}
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
