
import React, { useState, useCallback, useRef, useEffect, createContext, useContext } from 'react';
import ReactDOM from 'react-dom';
import { analyzeSentence, translateSentencesInBatch } from './services/geminiService';
import * as driveService from './services/googleDriveService';
import type { ApiError, ChapterData, ProjectData, AppSettings, Theme, FontSize, FontFamily, SentenceData, TokenData, VocabularyItem, AnalyzedText, VocabularyLocation, DisplayMode, WorkspaceItem, SpecialTerm } from './types';
import { SettingsContext, getThemeClasses, useSettings } from './contexts/settingsContext';
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
const APP_DATA_FOLDER_NAME = 'Trình Phân Tích Tiếng Trung AppData';
const PAGE_SIZE = 10;
const TRANSLATION_BATCH_SIZE = 10;
const DRIVE_DATA_FILE_NAME = 'app-data.v3.json'; // Main settings/vocab file for this architecture version.
const SETTINGS_STORAGE_KEY = 'chinese_analyzer_settings_v3';
const ANALYSIS_CACHE_STORAGE_KEY = 'chinese_analyzer_analysis_cache';
const TRANSLATION_CACHE_STORAGE_KEY = 'chinese_analyzer_translation_cache';
const VOCABULARY_STORAGE_KEY = 'chinese_analyzer_vocabulary_v5';
const CHINESE_PUNCTUATION_REGEX = /^[，。！？；：、“”《》【】（）…—–_.,?!;:"'()\[\]{}]+$/;

const DRIVE_SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email';


// --- Types ---
type GoogleApiStatus = {
  status: 'pending' | 'ready' | 'error';
  message: string;
};

type MainDriveData = {
    version: '3.0'; 
    createdAt: string;
    data: {
        settings: AppSettings;
        vocabulary: VocabularyItem[];
        // Caches are no longer stored in the main data file.
    }
}


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

const escapeRegex = (string: string) => string.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
const sanitizeFileName = (name: string) => name.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '_').slice(0, 50);

const chineseNumMap: { [key: string]: number } = { '〇': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '零': 0 };
const chineseUnitMap: { [key: string]: number } = { '十': 10, '百': 100, '千': 1000 };

function chineseToArabic(numStr: string | undefined | null): number | null {
    if (!numStr) return null;
    
    if (/^\d+$/.test(numStr)) {
        return parseInt(numStr, 10);
    }
    
    // Simplified logic for chapter numbers
    let total = 0;
    let section = 0;
    let unit = 1;

    for (let i = numStr.length - 1; i >= 0; i--) {
        const char = numStr[i];
        if (char in chineseNumMap) {
            section += chineseNumMap[char] * unit;
        } else if (char in chineseUnitMap) {
            unit = chineseUnitMap[char];
            if (section === 0) section = unit;
        } else if (char === '万') {
            total += section * 10000;
            section = 0;
            unit = 1;
        } else if (char === '亿') {
            total += section * 100000000;
            section = 0;
            unit = 1;
        }
    }
    total += section;

    // Handle "十" as 10
    if (numStr === '十') return 10;
    // Handle "十一" as 11, etc.
    if (numStr.startsWith('十')) {
        let suffix = numStr.substring(1);
        if (suffix in chineseNumMap) {
            return 10 + chineseNumMap[suffix];
        }
    }

    return total > 0 ? total : null;
}

interface RawChapter {
    title: string;
    content: string;
    chapterNumber?: string;
}

function processTextIntoRawChapters(text: string): RawChapter[] {
    const rawChapters: RawChapter[] = [];
    const CHAPTER_REGEX = /^(?:Chương|Hồi|Quyển|Chapter|卷|第)\s*(\d+|[一二三四五六七八九十百千万亿〇零两]+)\s*(?:(?:章|回|节|話|篇|卷之)\s*.*|[:：]\s*.*|$)/im;

    const sections = text.split(CHAPTER_REGEX);

    if (sections.length < 3) {
        if (text.trim()) {
            rawChapters.push({ title: DEFAULT_CHAPTER_TITLE, content: text.trim() });
        }
        return rawChapters;
    }

    const textBeforeFirstChapter = sections[0].trim();
    if (textBeforeFirstChapter) {
        rawChapters.push({ title: 'Phần mở đầu', content: textBeforeFirstChapter });
    }

    for (let i = 1; i < sections.length; i += 2) {
        const chapterNumber = sections[i];
        const combinedContent = sections[i+1] || "";
        const lines = combinedContent.split('\n');
        const chapterTitle = lines[0].trim().replace(/\s+/g, ' ');
        const chapterContent = lines.slice(1).join('\n').trim();

        if (chapterContent) {
             rawChapters.push({ title: chapterTitle || `Chương ${chapterNumber}`, content: chapterContent, chapterNumber });
        }
    }

    return rawChapters;
}

function createSentencesFromContent(text: string): SentenceData[] {
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

    const sinoTerms = vocabulary.filter(v => v.isForceSino && v.sinoVietnamese?.trim());
    const sinoTermMap = new Map(sinoTerms.map(item => [item.sinoVietnamese.toLowerCase(), item]));

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
    
    const uniqueSearchStrings = [...new Set(allSearchStrings.filter(s => s))].sort((a, b) => b.length - a.length);

    if (uniqueSearchStrings.length === 0) {
        return <>{text}</>;
    }

    const regex = new RegExp(`(${uniqueSearchStrings.map(escapeRegex).join('|')})`, 'gi');
    const parts = text.split(regex);

    return (
        <>
            {parts.map((part, index) => {
                if (!part) return null; 
                const partLower = part.toLowerCase();

                const sinoVocabItem = sinoTermMap.get(partLower);
                if (sinoVocabItem) {
                    return <VocabularyTerm key={index} vocabItem={sinoVocabItem} />;
                }

                const translationVocabItem = translationTermMap.get(partLower);
                if (translationVocabItem) {
                    return <TranslationTerm key={index} vocabItem={translationVocabItem} matchedText={part} />;
                }
                
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
    onLoadChapterContent: () => void;
    isApiBusy: boolean;
}> = ({ chapter, chapterIndex, onSentenceClick, onTranslate, onStopTranslate, onAnalyze, onStopAnalyze, onUpdate, onLoadChapterContent, isApiBusy }) => {
    const { theme, settings } = useSettings();
    
    const untranslatedSentences = chapter.sentences.filter(s => !s.isTitle && s.translationState === 'pending').length;
    const unanalyzedSentences = chapter.sentences.filter(s => s.analysisState === 'pending').length;

    const allSentencesTranslated = chapter.isLoaded && untranslatedSentences === 0;
    const allSentencesAnalyzed = chapter.isLoaded && unanalyzedSentences === 0;
    const isApiKeyMissing = !settings.apiKey;


    const handleToggle = (e: React.SyntheticEvent<HTMLDetailsElement>) => {
        const isOpen = e.currentTarget.open;
        onUpdate({ isExpanded: isOpen });
        if (isOpen && !chapter.isLoaded) {
            onLoadChapterContent();
        }
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
        if (!chapter.isLoaded) {
             return null; // Don't show actions until loaded
        }
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
                {!chapter.isLoaded && (
                    <div className="flex items-center justify-center gap-2 py-8 text-sm font-semibold text-slate-500 dark:text-slate-400">
                        <Spinner variant={settings.theme === 'light' ? 'dark' : 'light'} />
                        <span>Đang tải nội dung chương...</span>
                    </div>
                )}
                {chapter.chapterError && (
                    <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative" role="alert">
                        <strong className="font-bold">Lỗi chương: </strong>
                        <span className="block sm:inline">{chapter.chapterError}</span>
                    </div>
                )}
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

                {chapter.isLoaded && (
                    <>
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
                    </>
                )}
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

const ProjectDisplay: React.FC<{
    projectData: ProjectData;
    onSentenceClick: (chapterIndex: number, sentenceIndex: number) => void;
    onVisibleRangeUpdate: (newRange: { start: number; end: number }) => void;
    onPageSizeUpdate: (newSize: number) => void;
    onChapterTranslate: (chapterIndex: number) => void;
    onChapterStopTranslate: (chapterIndex: number) => void;
    onChapterAnalyze: (chapterIndex: number) => void;
    onChapterStopAnalyze: (chapterIndex: number) => void;
    onChapterUpdate: (chapterIndex: number, newState: Partial<ChapterData>) => void;
    onChapterLoadContent: (chapterIndex: number) => void;
    isApiBusy: boolean;
}> = ({ projectData, onSentenceClick, onVisibleRangeUpdate, onPageSizeUpdate, onChapterTranslate, onChapterStopTranslate, onChapterAnalyze, onChapterStopAnalyze, onChapterUpdate, onChapterLoadContent, isApiBusy }) => {
    
    const handleRangeChange = useCallback((newRange: { start: number; end: number }) => {
        const start = Math.max(0, newRange.start);
        const end = Math.min(projectData.chapters.length, newRange.end);
        onVisibleRangeUpdate({ start, end });
    }, [projectData.chapters.length, onVisibleRangeUpdate]);

    return (
        <div className="space-y-6">
             <ChapterNavigator
                totalChapters={projectData.chapters.length}
                onRangeChange={handleRangeChange}
                pageSize={projectData.pageSize}
                currentRange={{start: projectData.visibleRange.start, end: projectData.visibleRange.end}}
                onPageSizeChange={onPageSizeUpdate}
            />

            <div className="space-y-4">
                {projectData.chapters.slice(projectData.visibleRange.start, projectData.visibleRange.end).map((chapter, index) => {
                    const originalChapterIndex = projectData.visibleRange.start + index;
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
                            onLoadChapterContent={() => onChapterLoadContent(originalChapterIndex)}
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
                         <button onClick={() => onUnify()} title="Đồng nhất bản dịch với các thuật ngữ đã đánh dấu" className={`flex items-center gap-2 px-3 py-1.5 text-sm font-semibold rounded-md transition-colors ${theme.primaryButton.bg} ${theme.primaryButton.text} ${theme.primaryButton.hoverBg}`}>
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


const DataManagementModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    onExport: () => void;
    onImport: (event: React.ChangeEvent<HTMLInputElement>) => void;
    onClear: (dataType: 'vocabulary' | 'settings' | 'all') => void;
    googleApiStatus: GoogleApiStatus;
    isLoggedIn: boolean;
    onLogin: () => void;
    onLogout: () => void;
}> = ({ isOpen, onClose, onExport, onImport, onClear, googleApiStatus, isLoggedIn, onLogin, onLogout }) => {
    const { theme } = useSettings();
    const importInputRef = useRef<HTMLInputElement>(null);

    if (!isOpen) return null;

    const handleImportClick = () => {
        importInputRef.current?.click();
    };
    
    const handleClearClick = (type: 'vocabulary' | 'settings' | 'all') => {
        const messages = {
            vocabulary: "Bạn có chắc chắn muốn xóa toàn bộ từ điển cá nhân không? Hành động này không thể hoàn tác.",
            settings: "Bạn có chắc chắn muốn đặt lại cài đặt giao diện về mặc định không?",
            all: "BẠN CÓ CHẮC CHẮN MUỐN XÓA TẤT CẢ DỮ LIỆU CỤC BỘ KHÔNG? Bao gồm cài đặt, từ điển. Hành động này không thể hoàn tác và không ảnh hưởng đến tệp trên Google Drive.",
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
                            Đăng nhập để tự động sao lưu và đồng bộ các dự án của bạn trên nhiều thiết bị. Dữ liệu cài đặt và từ điển cũng sẽ được sao lưu.
                        </p>
                        {isLoggedIn ? (
                             <button 
                                onClick={onLogout} 
                                className={`w-full flex items-center justify-center gap-2 px-4 py-3 font-semibold rounded-lg shadow-sm transition-colors ${theme.button.bg} ${theme.button.text} ${theme.button.hoverBg}`}
                            >
                                <ArrowRightOnRectangleIcon className="w-5 h-5 mr-2" />
                                Đăng xuất
                            </button>
                        ) : (
                             <>
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
                        <p className={`text-sm ${theme.mutedText}`}>Tải xuống một bản sao lưu dữ liệu ứng dụng (cài đặt, từ điển). Lưu ý: Dữ liệu dự án và cache trên Drive không được bao gồm.</p>
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
                         <p className={`text-xs ${theme.mutedText}`}> <strong className="text-amber-600 dark:text-amber-400">Lưu ý:</strong> Tải lên sẽ ghi đè dữ liệu cục bộ hiện tại.</p>
                    </section>

                    <div className={`border-t ${theme.border}`}></div>

                    <section className="space-y-3">
                        <h3 className={`text-lg font-semibold text-red-600 dark:text-red-400 flex items-center gap-2`}><TrashIcon className="w-5 h-5"/>Xóa dữ liệu cục bộ</h3>
                        <p className={`text-sm ${theme.mutedText}`}>Xóa dữ liệu được lưu trong trình duyệt. Hành động này không thể hoàn tác và không ảnh hưởng đến tệp trên Google Drive.</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <button onClick={() => handleClearClick('vocabulary')} className={`px-4 py-2 text-sm font-semibold rounded-lg shadow-sm border border-red-500/50 text-red-600 hover:bg-red-500/10 transition-colors`}>Xóa từ điển</button>
                             <button onClick={() => handleClearClick('settings')} className={`px-4 py-2 text-sm font-semibold rounded-lg shadow-sm border border-red-500/50 text-red-600 hover:bg-red-500/10 transition-colors`}>Reset cài đặt</button>
                            <button onClick={() => handleClearClick('all')} className={`sm:col-span-2 px-4 py-2 text-sm font-bold rounded-lg shadow-sm bg-red-600 text-white hover:bg-red-700 transition-colors`}>Xóa TẤT CẢ dữ liệu cục bộ</button>
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
    const [vocabulary, setVocabulary] = useState<VocabularyItem[]>([]);
    
    // Workspace State
    const [workspaceProjects, setWorkspaceProjects] = useState<WorkspaceItem[]>([]);
    const [openProjects, setOpenProjects] = useState<ProjectData[]>([]);
    const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
    const debouncedChapterSaveRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());


    // UI & Error State
    const [isLoading, setIsLoading] = useState(true);
    const [loadingMessage, setLoadingMessage] = useState<string>('Đang khởi tạo ứng dụng...');
    const [error, setError] = useState<ApiError | null>(null);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isVocabularyOpen, setIsVocabularyOpen] = useState(false);
    const [isDataManagementOpen, setIsDataManagementOpen] = useState(false);
    const [scrollTo, setScrollTo] = useState<{ chapterIndex: number; sentenceNumber: number } | null>(null);

    // Google Auth State
    const [googleApiStatus, setGoogleApiStatus] = useState<GoogleApiStatus>({ status: 'pending', message: 'Đang khởi tạo dịch vụ Google...' });
    const [tokenClient, setTokenClient] = useState<any>(null);
    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const [googleUser, setGoogleUser] = useState<any>(null);
    const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
    const userMenuRef = useRef<HTMLDivElement>(null);
    const mainDataDebouncedSaveRef = useRef<ReturnType<typeof setTimeout>>();
    const [appFolderId, setAppFolderId] = useState<string>('');


    // Task Queue State
    const stopFlags = useRef<Set<string>>(new Set());
    const [isApiBusy, setIsApiBusy] = useState(false);
    
    // --- Data Loading & Saving ---
    const loadLocalData = useCallback(() => {
        try {
            const storedSettings = localStorage.getItem(SETTINGS_STORAGE_KEY);
            if (storedSettings) setSettings(prev => ({...prev, ...JSON.parse(storedSettings)}));
            
            const storedVocabulary = localStorage.getItem(VOCABULARY_STORAGE_KEY);
            if (storedVocabulary) setVocabulary(JSON.parse(storedVocabulary));
        } catch (e) { console.error("Failed to load data from localStorage", e); }
    }, []);

    useEffect(() => { loadLocalData(); }, [loadLocalData]);

    useEffect(() => { localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings)); }, [settings]);
    useEffect(() => { localStorage.setItem(VOCABULARY_STORAGE_KEY, JSON.stringify(vocabulary)); }, [vocabulary]);

    const packMainDataForSave = useCallback((): MainDriveData => ({
        version: '3.0',
        createdAt: new Date().toISOString(),
        data: { settings, vocabulary }
    }), [settings, vocabulary]);
    
    // Auto-save main data (settings, vocab) to Drive
    useEffect(() => {
        if (!isLoggedIn || googleApiStatus.status !== 'ready' || !appFolderId) return;
        
        if (mainDataDebouncedSaveRef.current) clearTimeout(mainDataDebouncedSaveRef.current);
    
        mainDataDebouncedSaveRef.current = setTimeout(() => {
            const dataToSave = packMainDataForSave();
            driveService.saveFileInFolder(appFolderId, DRIVE_DATA_FILE_NAME, dataToSave, 'application/json')
                .then(() => console.log("Main data auto-saved to Drive."))
                .catch(err => console.error("Lỗi tự động lưu dữ liệu chính vào Drive:", err));
        }, 5000); 
    
        return () => {
            if (mainDataDebouncedSaveRef.current) clearTimeout(mainDataDebouncedSaveRef.current);
        };
    }, [isLoggedIn, googleApiStatus.status, appFolderId, packMainDataForSave]);


    const saveChapterToDrive = useCallback((project: ProjectData, chapterIndex: number) => {
        const chapter = project.chapters[chapterIndex];
        if (!chapter || !chapter.isLoaded) return;
    
        const key = `${project.driveFolderId}-${chapter.fileNamePrefix}`;
        if (debouncedChapterSaveRef.current.has(key)) {
            clearTimeout(debouncedChapterSaveRef.current.get(key)!);
        }
    
        const timeoutId = setTimeout(() => {
            const { isExpanded, ...cacheableChapterData } = chapter; 
            const cacheFileName = `${chapter.fileNamePrefix}.cache.json`;
            driveService.saveFileInFolder(project.driveFolderId, cacheFileName, cacheableChapterData, 'application/json')
                .then(() => console.log(`Cache for chapter ${chapter.title} saved.`))
                .catch(err => console.error(`Failed to save cache for chapter ${chapter.title}:`, err));
            
            debouncedChapterSaveRef.current.delete(key);
        }, 5000); 
    
        debouncedChapterSaveRef.current.set(key, timeoutId);
    }, []);

    const updateProjectState = useCallback((projectId: string, updateFn: (project: ProjectData) => ProjectData) => {
        setOpenProjects(prev => prev.map(p => p.id === projectId ? updateFn(p) : p));
    }, []);
    
    // --- Google API & Auth ---
    
    const handleLogin = useCallback(() => {
        if (tokenClient) {
            tokenClient.requestAccessToken({ prompt: '' });
        }
    }, [tokenClient]);
    
    const handleLogout = useCallback(() => {
        setIsLoggedIn(false);
        setGoogleUser(null);
        setWorkspaceProjects([]);
        setOpenProjects([]);
        setActiveProjectId(null);
        setAppFolderId('');
    }, []);

    useEffect(() => {
        const initGoogleApis = async () => {
            const GOOGLE_CLIENT_ID = import.meta.env?.VITE_GOOGLE_CLIENT_ID;
            if (!GOOGLE_CLIENT_ID) {
                setGoogleApiStatus({ status: 'error', message: `Lỗi cấu hình: VITE_GOOGLE_CLIENT_ID chưa được thiết lập.` });
                 setIsLoading(false);
                return;
            }

            try {
                await Promise.all([
                    loadScript('https://apis.google.com/js/api.js'),
                    loadScript('https://accounts.google.com/gsi/client'),
                ]);

                await new Promise<void>((resolve) => window.gapi.load('client', resolve));
                await window.gapi.client.init({
                    discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'],
                });
                
                const client = window.google.accounts.oauth2.initTokenClient({
                    client_id: GOOGLE_CLIENT_ID,
                    scope: DRIVE_SCOPES,
                    callback: async (tokenResponse: any) => {
                        if (tokenResponse.error) {
                            console.error("Google Auth Error:", tokenResponse);
                            setError({ message: `Lỗi đăng nhập Google: ${tokenResponse.error_description || tokenResponse.error}` });
                            setIsLoggedIn(false);
                            setIsLoading(false);
                            return;
                        }
                        
                        window.gapi.client.setToken(tokenResponse);
                        setIsLoading(true);
                        setLoadingMessage("Đang đăng nhập và tải dữ liệu...");
                        setIsLoggedIn(true);
                        
                        try {
                            const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                                headers: { 'Authorization': `Bearer ${tokenResponse.access_token}` }
                            });
                            if (!response.ok) throw new Error(`Failed to fetch profile: ${response.statusText}`);
                            const profile = await response.json();
                            setGoogleUser(profile);

                            const driveAppFolderId = await driveService.getOrCreateAppFolderId();
                            setAppFolderId(driveAppFolderId);
                            
                            const mainDataFiles = await driveService.listFilesInFolder(driveAppFolderId);
                            const mainDataFile = mainDataFiles.find(f => f.name === DRIVE_DATA_FILE_NAME);

                            if (mainDataFile?.id) {
                                const loadedData: MainDriveData = await driveService.loadFileContent(mainDataFile.id);
                                if (loadedData?.data) {
                                    setSettings(prev => ({...prev, ...loadedData.data.settings}));
                                    setVocabulary(loadedData.data.vocabulary || []);
                                }
                            }

                            const projects = await driveService.listProjectFolders();
                             setWorkspaceProjects(projects.map(p => ({...p, type: 'file' })));

                        } catch (err) {
                            console.error("Lỗi khi lấy thông tin người dùng hoặc tải dữ liệu:", err);
                            const message = err instanceof Error ? err.message : String(err);
                            setError({ message: `Không thể lấy thông tin người dùng: ${message}` });
                        } finally {
                            setIsLoading(false);
                            setLoadingMessage('');
                        }
                    },
                });
                setTokenClient(client);
                setGoogleApiStatus({ status: 'ready', message: 'Dịch vụ Google đã sẵn sàng.' });
            } catch (error) {
                console.error("Lỗi khởi tạo API Google:", error);
                const message = error instanceof Error ? error.message : "Lỗi không xác định";
                setGoogleApiStatus({ status: 'error', message: `Không thể khởi tạo dịch vụ Google: ${message}` });
            } finally {
                setIsLoading(false);
            }
        };
        initGoogleApis();
    }, []);
    
    // --- UI Effects ---
    
    useEffect(() => {
        if (scrollTo && activeProjectId) {
            const project = openProjects.find(p => p.id === activeProjectId);
            if (!project) { setScrollTo(null); return; }

            const sentenceIndex = project.chapters[scrollTo.chapterIndex]
                ?.sentences.findIndex(s => s.sentenceNumber === scrollTo.sentenceNumber) ?? -1;
                
            if (sentenceIndex === -1) { setScrollTo(null); return; }

            const elementId = `sentence-${scrollTo.chapterIndex}-${sentenceIndex}`;
            const element = document.getElementById(elementId);
            if (element) {
                setTimeout(() => {
                    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    element.classList.add('highlight-scroll');
                    setTimeout(() => element.classList.remove('highlight-scroll'), 2500);
                }, 100);
            }
            setScrollTo(null);
        }
    }, [scrollTo, activeProjectId, openProjects]);
    
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
                setIsUserMenuOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [userMenuRef]);
    
    const checkApiKey = useCallback(() => {
        if (!settings.apiKey) {
            alert("Vui lòng nhập Gemini API Key của bạn trong phần Cài đặt (biểu tượng bánh răng) trước.");
            setIsSettingsOpen(true);
            return false;
        }
        return true;
    }, [settings.apiKey]);

    // --- Project & Chapter Management ---

    const handleOpenWorkspaceItem = useCallback(async (projectToOpen: WorkspaceItem) => {
        if (!projectToOpen?.driveFolderId) {
            setError({ message: "Dự án được chọn không hợp lệ." });
            return;
        }
        
        if (openProjects.some(p => p.id === projectToOpen.driveFolderId)) {
            setActiveProjectId(projectToOpen.driveFolderId);
            return;
        }

        setIsLoading(true);
        setLoadingMessage(`Đang mở dự án "${projectToOpen.name}"...`);
        setError(null);

        try {
            const filesInFolder = await driveService.listFilesInFolder(projectToOpen.driveFolderId);
            
            const chapterFiles = filesInFolder
                .filter(f => f.name.endsWith('.txt') && !f.name.includes('.cache.'))
                .sort((a, b) => a.name.localeCompare(b.name));
                
            const cacheFiles = new Set(filesInFolder.filter(f => f.name.endsWith('.cache.json')).map(f => f.name));

            const chapters: ChapterData[] = chapterFiles.map(file => {
                const fileNamePrefix = file.name.replace('.txt', '');
                const titleMatch = fileNamePrefix.match(/^\d+_(.*)$/);
                const title = titleMatch ? titleMatch[1].replace(/_/g, ' ') : fileNamePrefix;
                const chapterNumberMatch = fileNamePrefix.match(/^(\d+)/);

                return {
                    title: title,
                    chapterNumber: chapterNumberMatch ? chapterNumberMatch[1] : undefined,
                    fileNamePrefix: fileNamePrefix,
                    sentences: [],
                    isExpanded: false,
                    isLoaded: false,
                    hasCache: cacheFiles.has(`${fileNamePrefix}.cache.json`),
                };
            });

            const newProject: ProjectData = {
                id: projectToOpen.driveFolderId,
                driveFolderId: projectToOpen.driveFolderId,
                fileName: projectToOpen.name,
                chapters: chapters,
                pageSize: PAGE_SIZE,
                visibleRange: { start: 0, end: Math.min(PAGE_SIZE, chapters.length) },
            };

            setOpenProjects(prev => [...prev, newProject]);
            setActiveProjectId(newProject.id);

        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            setError({ message: `Không thể mở dự án: ${message}` });
            setActiveProjectId(null);
        } finally {
            setIsLoading(false);
            setLoadingMessage('');
        }
    }, [openProjects]);

    const handleCreateNewProject = useCallback(async (text: string, fileName: string) => {
        if (!text.trim()) {
            setError({ message: "Vui lòng nhập văn bản hoặc tải lên một tệp." });
            return;
        }
        if (!isLoggedIn) {
             alert("Vui lòng đăng nhập với Google để tạo dự án mới.");
             handleLogin();
             return;
        }

        setIsLoading(true);
        setError(null);

        try {
            const rawChapters = processTextIntoRawChapters(text);
            if (rawChapters.length === 0) {
                throw new Error("Không tìm thấy chương nào trong văn bản.");
            }
            const projectName = fileName.replace(/\.txt$/i, '').trim();
            setLoadingMessage(`Đang tạo thư mục dự án "${projectName}"...`);
            const driveFolderId = await driveService.createProjectFolder(projectName);

            for (let i = 0; i < rawChapters.length; i++) {
                const chapter = rawChapters[i];
                setLoadingMessage(`Đang tải lên chương ${i + 1}/${rawChapters.length}: ${chapter.title}`);
                const chapterFileName = `${String(i).padStart(5, '0')}_${sanitizeFileName(chapter.title)}`;
                await driveService.saveFileInFolder(driveFolderId, `${chapterFileName}.txt`, chapter.content, 'text/plain');
            }

            setLoadingMessage('Đang mở dự án...');
            const newProjectItem: WorkspaceItem = {
                driveFolderId: driveFolderId,
                name: projectName,
                type: 'file',
                lastModified: new Date().toISOString(),
            };
            
            setWorkspaceProjects(prev => [newProjectItem, ...prev.filter(p => p.driveFolderId !== driveFolderId)]);
            await handleOpenWorkspaceItem(newProjectItem);

        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error("Lỗi khi tạo dự án mới:", err);
            setError({ message: `Không thể tạo dự án: ${message}` });
        } finally {
            setIsLoading(false);
            setLoadingMessage('');
        }
    }, [isLoggedIn, handleLogin, handleOpenWorkspaceItem]);
    
    const handleCloseProject = useCallback((projectId: string) => {
        setOpenProjects(prev => prev.filter(p => p.id !== projectId));
        if (activeProjectId === projectId) {
            setActiveProjectId(null);
        }
    }, [activeProjectId]);

    const handleDeleteProject = useCallback(async (project: WorkspaceItem, deleteFromDrive: boolean) => {
        setIsLoading(true);
        setLoadingMessage(`Đang xóa dự án "${project.name}"...`);
        try {
            if (deleteFromDrive && isLoggedIn) {
                await driveService.deleteFolder(project.driveFolderId);
            }
            handleCloseProject(project.driveFolderId);
            setWorkspaceProjects(prev => prev.filter(p => p.driveFolderId !== project.driveFolderId));
        } catch(err) {
            const message = err instanceof Error ? err.message : String(err);
            setError({ message: `Không thể xóa dự án: ${message}` });
        } finally {
            setIsLoading(false);
            setLoadingMessage('');
        }
    }, [isLoggedIn, handleCloseProject]);

    const onChapterUpdate = useCallback((projectId: string, chapterIndex: number, update: Partial<ChapterData>) => {
        updateProjectState(projectId, p => {
            const newChapters = [...p.chapters];
            newChapters[chapterIndex] = { ...newChapters[chapterIndex], ...update };
            const project = { ...p, chapters: newChapters };
            if (update.sentences) {
                saveChapterToDrive(project, chapterIndex);
            }
            return project;
        });
    }, [updateProjectState, saveChapterToDrive]);

    const handleLoadChapterContent = useCallback(async (projectId: string, chapterIndex: number) => {
        const project = openProjects.find(p => p.id === projectId);
        if (!project) return;
        
        const chapter = project.chapters[chapterIndex];
        if (chapter.isLoaded) return;
        
        const update = (data: Partial<ChapterData>) => onChapterUpdate(projectId, chapterIndex, data);
        
        try {
            const allFiles = await driveService.listFilesInFolder(project.driveFolderId);

            if (chapter.hasCache) {
                 const cacheFile = allFiles.find(f => f.name === `${chapter.fileNamePrefix}.cache.json`);
                 if(cacheFile?.id) {
                    const cachedData: ChapterData = await driveService.loadFileContent(cacheFile.id);
                    update({ ...cachedData, isLoaded: true, isExpanded: true });
                    return;
                 }
            }

            const contentFile = allFiles.find(f => f.name === `${chapter.fileNamePrefix}.txt`);
            if(contentFile?.id) {
                const content = await driveService.loadFileContent(contentFile.id);
                const sentences = createSentencesFromContent(content);
                const titleSentence: SentenceData = { original: chapter.title, isTitle: true, analysisState: 'pending', translationState: 'pending' };
                update({ sentences: [titleSentence, ...sentences], isLoaded: true });
            } else {
                 throw new Error(`Không tìm thấy tệp nội dung: ${chapter.fileNamePrefix}.txt`);
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            update({ chapterError: message, isLoaded: true });
        }
    }, [openProjects, onChapterUpdate]);

    const handleSentenceClick = useCallback(async (projectId: string, chapterIndex: number, sentenceIndex: number) => {
        if (!checkApiKey() || isApiBusy) return;

        const project = openProjects.find(p => p.id === projectId);
        if (!project) return;
        
        const sentence = project.chapters[chapterIndex].sentences[sentenceIndex];
        if (!sentence || sentence.analysisState === 'loading' || sentence.analysisState === 'done') return;

        setIsApiBusy(true);

        const updateSentence = (update: Partial<SentenceData>) => {
            updateProjectState(projectId, p => {
                const newChapters = [...p.chapters];
                const newSentences = [...newChapters[chapterIndex].sentences];
                newSentences[sentenceIndex] = { ...newSentences[sentenceIndex], ...update };
                newChapters[chapterIndex] = { ...newChapters[chapterIndex], sentences: newSentences };
                const newProject = { ...p, chapters: newChapters };
                saveChapterToDrive(newProject, chapterIndex);
                return newProject;
            });
        };
        
        updateSentence({ analysisState: 'loading' });

        try {
            const forcedSinoTerms = vocabulary
                .filter(v => v.isForceSino)
                .map(v => ({ term: v.term, sinoVietnamese: v.sinoVietnamese }));

            const result = await analyzeSentence(sentence.original, settings.apiKey, forcedSinoTerms);
            
            // Add new special terms to vocabulary
            const newVocabItems: VocabularyItem[] = [];
            if (result.specialTerms) {
                for (const specialTerm of result.specialTerms) {
                    if (!vocabulary.some(v => v.term.toLowerCase() === specialTerm.term.toLowerCase())) {
                        newVocabItems.push({
                            ...specialTerm,
                            firstLocation: {
                                chapterIndex: chapterIndex,
                                chapterTitle: project.chapters[chapterIndex].title,
                                sentenceNumber: sentence.sentenceNumber || 0,
                                originalSentence: sentence.original,
                            },
                            isForceSino: false,
                        });
                    }
                }
            }
            if (newVocabItems.length > 0) {
                 setVocabulary(prev => [...prev, ...newVocabItems]);
            }

            updateSentence({
                analysisState: 'done',
                analysisResult: result,
                translation: result.translation,
                translationState: 'done',
                displayMode: 'detailed-word'
            });

        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            updateSentence({ analysisState: 'error', analysisError: message });
        } finally {
            setIsApiBusy(false);
        }
    }, [checkApiKey, isApiBusy, openProjects, settings.apiKey, vocabulary, updateProjectState, saveChapterToDrive]);

    const handleBatchProcess = async (
        projectId: string,
        chapterIndex: number,
        processType: 'translate' | 'analyze'
    ) => {
        if (!checkApiKey() || isApiBusy) return;
    
        const project = openProjects.find(p => p.id === projectId);
        if (!project) return;
    
        const chapter = project.chapters[chapterIndex];
        const taskKey = `${processType}-${projectId}-${chapterIndex}`;
        stopFlags.current.delete(taskKey);
    
        const sentencesToProcess = chapter.sentences
            .map((s, i) => ({ ...s, originalIndex: i }))
            .filter(s => !s.isTitle && s[processType === 'translate' ? 'translationState' : 'analysisState'] === 'pending');
    
        if (sentencesToProcess.length === 0) return;
    
        setIsApiBusy(true);
        onChapterUpdate(projectId, chapterIndex, {
            [processType === 'translate' ? 'isBatchTranslating' : 'isBatchAnalyzing']: true,
            [`batch${processType === 'translate' ? 'Translation' : 'Analysis'}Progress`]: 0
        });
    
        const forcedSinoTerms = vocabulary
            .filter(v => v.isForceSino)
            .map(v => ({ term: v.term, sinoVietnamese: v.sinoVietnamese }));
    
        let processedCount = 0;
    
        for (let i = 0; i < sentencesToProcess.length; i += TRANSLATION_BATCH_SIZE) {
            if (stopFlags.current.has(taskKey)) break;
    
            const batch = sentencesToProcess.slice(i, i + TRANSLATION_BATCH_SIZE);
            const originalTexts = batch.map(s => s.original);
    
            try {
                if (processType === 'translate') {
                    const translations = await translateSentencesInBatch(originalTexts, settings.apiKey, forcedSinoTerms);
                    updateProjectState(projectId, p => {
                        const newChapters = [...p.chapters];
                        const newSentences = [...newChapters[chapterIndex].sentences];
                        translations.forEach((translation, j) => {
                            const originalSentenceIndex = batch[j].originalIndex;
                            newSentences[originalSentenceIndex] = {
                                ...newSentences[originalSentenceIndex],
                                translation: translation,
                                translationState: 'done'
                            };
                        });
                        newChapters[chapterIndex] = { ...newChapters[chapterIndex], sentences: newSentences };
                        return { ...p, chapters: newChapters };
                    });
                } else { // Analyze
                    for(let j=0; j<batch.length; j++) {
                        if (stopFlags.current.has(taskKey)) break;
                        const sentence = batch[j];
                        const result = await analyzeSentence(sentence.original, settings.apiKey, forcedSinoTerms);
                        updateProjectState(projectId, p => {
                             const newChapters = [...p.chapters];
                             const newSentences = [...newChapters[chapterIndex].sentences];
                             newSentences[sentence.originalIndex] = {
                                ...newSentences[sentence.originalIndex],
                                analysisResult: result,
                                analysisState: 'done',
                                translation: result.translation,
                                translationState: 'done',
                                displayMode: 'detailed-word'
                             };
                             newChapters[chapterIndex] = { ...newChapters[chapterIndex], sentences: newSentences };
                             return { ...p, chapters: newChapters };
                        });
                    }
                }
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                setError({ message });
                break; // Stop on error
            } finally {
                processedCount += batch.length;
                 onChapterUpdate(projectId, chapterIndex, {
                    [`batch${processType === 'translate' ? 'Translation' : 'Analysis'}Progress`]: processedCount / sentencesToProcess.length
                 });
            }
        }
    
        onChapterUpdate(projectId, chapterIndex, {
            [processType === 'translate' ? 'isBatchTranslating' : 'isBatchAnalyzing']: false,
        });
        saveChapterToDrive(project, chapterIndex);
        setIsApiBusy(false);
        stopFlags.current.delete(taskKey);
    };
    
    const handleStopBatchProcess = (projectId: string, chapterIndex: number, processType: 'translate' | 'analyze') => {
        const taskKey = `${processType}-${projectId}-${chapterIndex}`;
        stopFlags.current.add(taskKey);
        onChapterUpdate(projectId, chapterIndex, {
            [processType === 'translate' ? 'isBatchTranslating' : 'isBatchAnalyzing']: false,
        });
        setIsApiBusy(false);
    };

    const handleDataExport = () => {
        const data = packMainDataForSave();
        const blob = new Blob([JSON.stringify(data, null, 2)], {type: "application/json;charset=utf-8"});
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `chinese_analyzer_backup_${new Date().toISOString().split('T')[0]}.json`;
        link.click();
        URL.revokeObjectURL(url);
    };

    const handleDataImport = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const text = e.target?.result as string;
                const parsedData: MainDriveData = JSON.parse(text);
                if (parsedData.version === '3.0' && parsedData.data) {
                    setSettings(prev => ({...prev, ...parsedData.data.settings}));
                    setVocabulary(parsedData.data.vocabulary || []);
                    alert("Dữ liệu đã được nhập thành công!");
                } else {
                    throw new Error("Định dạng tệp sao lưu không hợp lệ hoặc phiên bản quá cũ.");
                }
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                alert(`Lỗi khi nhập dữ liệu: ${message}`);
            }
        };
        reader.readAsText(file);
    };
    
    const handleClearData = (type: 'vocabulary' | 'settings' | 'all') => {
        if (type === 'vocabulary' || type === 'all') {
            localStorage.removeItem(VOCABULARY_STORAGE_KEY);
            setVocabulary([]);
        }
        if (type === 'settings' || type === 'all') {
             localStorage.removeItem(SETTINGS_STORAGE_KEY);
             setSettings({
                apiKey: '', fontSize: 16, hanziFontSize: 24,
                fontFamily: 'font-sans', theme: 'light', lineHeight: 1.6,
             });
        }
        alert("Dữ liệu cục bộ đã được xóa.");
    };

    const handleUpdateVocabularyItem = (originalTerm: string, updatedItem: VocabularyItem) => {
        setVocabulary(prev => prev.map(item => item.term === originalTerm ? updatedItem : item));
    };

    const handleDeleteVocabularyItem = (term: string) => {
        setVocabulary(prev => prev.filter(item => item.term !== term));
    };
    
    const handleToggleForceSino = (term: string) => {
        setVocabulary(prev => prev.map(item => item.term === term ? { ...item, isForceSino: !item.isForceSino } : item));
    };
    
    const handleGoToLocation = (location: VocabularyLocation) => {
        const project = openProjects.find(p => p.chapters.some(c => c.title === location.chapterTitle));
        if (project) {
            setActiveProjectId(project.id);
            const chapterIndex = location.chapterIndex;
            
            onChapterUpdate(project.id, chapterIndex, { isExpanded: true });
            
            if (!project.chapters[chapterIndex].isLoaded) {
                 handleLoadChapterContent(project.id, chapterIndex);
            }
            
            const start = Math.floor(chapterIndex / project.pageSize) * project.pageSize;
            const end = start + project.pageSize;
            updateProjectState(project.id, p => ({ ...p, visibleRange: {start: start, end: end} }));

            setScrollTo({ chapterIndex: chapterIndex, sentenceNumber: location.sentenceNumber });
            setIsVocabularyOpen(false);
        } else {
            alert("Không thể tìm thấy dự án hoặc chương tương ứng. Vui lòng mở dự án đó trước.");
        }
    };
    
    const handleUnifyTranslations = () => {
        // This is a placeholder for a potentially complex feature
        alert("Tính năng đồng nhất bản dịch đang được phát triển.");
    };

    const activeProject = openProjects.find(p => p.id === activeProjectId);
    const themeClasses = getThemeClasses(settings.theme);

    if (isLoading && !activeProject) {
        return (
            <div className={`w-screen h-screen flex flex-col items-center justify-center ${themeClasses.mainBg} ${themeClasses.text}`}>
                <Spinner variant={settings.theme === 'light' ? 'dark' : 'light'} />
                <p className="mt-4 font-semibold">{loadingMessage}</p>
            </div>
        );
    }
    
    return (
        <SettingsContext.Provider value={{ settings, theme: themeClasses, setSettings, vocabulary }}>
            <div className={`flex flex-col h-screen ${themeClasses.mainBg} ${themeClasses.text} ${settings.fontFamily}`} style={{fontSize: `${settings.fontSize}px`, lineHeight: settings.lineHeight }}>
                {/* Modals */}
                <SettingsPanel isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
                <VocabularyModal 
                    isOpen={isVocabularyOpen}
                    onClose={() => setIsVocabularyOpen(false)}
                    vocabulary={vocabulary}
                    onDelete={handleDeleteVocabularyItem}
                    onToggleForceSino={handleToggleForceSino}
                    onUpdate={handleUpdateVocabularyItem}
                    onGoToLocation={handleGoToLocation}
                    onUnify={handleUnifyTranslations}
                />
                <DataManagementModal
                    isOpen={isDataManagementOpen}
                    onClose={() => setIsDataManagementOpen(false)}
                    onExport={handleDataExport}
                    onImport={handleDataImport}
                    onClear={handleClearData}
                    googleApiStatus={googleApiStatus}
                    isLoggedIn={isLoggedIn}
                    onLogin={handleLogin}
                    onLogout={handleLogout}
                />

                <header className={`flex-shrink-0 border-b ${themeClasses.border} px-4 py-2 flex justify-between items-center`}>
                    <h1 className="text-xl font-bold flex items-center gap-2">
                        <BookOpenIcon className="w-6 h-6"/> Trình Phân Tích Tiếng Trung
                    </h1>
                     <div className="flex items-center gap-2">
                         {isLoggedIn && googleUser ? (
                             <div className="relative" ref={userMenuRef}>
                                 <button onClick={() => setIsUserMenuOpen(o => !o)} className="flex items-center gap-2 p-1 rounded-full hover:bg-slate-200 dark:hover:bg-gray-700">
                                     <img src={googleUser.picture} alt={googleUser.name} className="w-8 h-8 rounded-full"/>
                                     <ChevronDownIcon className="w-4 h-4" />
                                 </button>
                                 {isUserMenuOpen && (
                                     <div className={`absolute top-full right-0 mt-2 w-56 ${themeClasses.cardBg} border ${themeClasses.border} rounded-md shadow-lg z-20`}>
                                         <div className="p-3 border-b border-gray-200 dark:border-gray-700">
                                             <p className="font-semibold truncate">{googleUser.name}</p>
                                             <p className={`text-sm ${themeClasses.mutedText} truncate`}>{googleUser.email}</p>
                                         </div>
                                         <button onClick={handleLogout} className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:${themeClasses.hoverBg}`}>
                                            <ArrowRightOnRectangleIcon className="w-5 h-5"/> Đăng xuất
                                         </button>
                                     </div>
                                 )}
                             </div>
                         ) : (
                             <button onClick={() => setIsDataManagementOpen(true)} className={`flex items-center gap-2 px-3 py-1.5 font-semibold rounded-lg shadow-sm ${themeClasses.button.bg} ${themeClasses.button.text} ${themeClasses.button.hoverBg}`}>
                                <GoogleIcon className="w-5 h-5" /> Đăng nhập
                             </button>
                         )}
                         <button onClick={() => setIsVocabularyOpen(true)} className={`p-2 rounded-full hover:bg-slate-200 dark:hover:bg-gray-700`} title="Từ điển"><StarIcon className="w-5 h-5"/></button>
                         <button onClick={() => setIsDataManagementOpen(true)} className={`p-2 rounded-full hover:bg-slate-200 dark:hover:bg-gray-700`} title="Quản lý dữ liệu"><ArchiveBoxIcon className="w-5 h-5"/></button>
                         <button onClick={() => setIsSettingsOpen(o => !o)} className={`p-2 rounded-full hover:bg-slate-200 dark:hover:bg-gray-700`} title="Cài đặt"><SettingsIcon className="w-5 h-5"/></button>
                     </div>
                </header>

                <main className="flex-grow flex flex-col overflow-y-hidden">
                    {openProjects.length > 0 && (
                        <WorkspaceTabs 
                            projects={openProjects} 
                            activeProjectId={activeProjectId} 
                            onSelectProject={setActiveProjectId}
                            onCloseProject={handleCloseProject}
                            onGoToDashboard={() => setActiveProjectId(null)}
                        />
                    )}

                    <div className="flex-grow overflow-y-auto p-4 md:p-6 lg:p-8">
                        {error && (
                             <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4" role="alert">
                                <strong className="font-bold">Lỗi!</strong>
                                <span className="block sm:inline ml-2">{error.message}</span>
                                <span className="absolute top-0 bottom-0 right-0 px-4 py-3" onClick={() => setError(null)}>
                                    <CloseIcon className="w-6 h-6 text-red-500"/>
                                </span>
                            </div>
                        )}
                        
                         {activeProject ? (
                            <ProjectDisplay 
                                projectData={activeProject}
                                onSentenceClick={(chapterIndex, sentenceIndex) => handleSentenceClick(activeProject.id, chapterIndex, sentenceIndex)}
                                onVisibleRangeUpdate={(newRange) => updateProjectState(activeProject.id, p => ({ ...p, visibleRange: newRange }))}
                                onPageSizeUpdate={(newSize) => updateProjectState(activeProject.id, p => ({ ...p, pageSize: newSize, visibleRange: { start: 0, end: newSize } }))}
                                onChapterTranslate={(chapterIndex) => handleBatchProcess(activeProject.id, chapterIndex, 'translate')}
                                onChapterStopTranslate={(chapterIndex) => handleStopBatchProcess(activeProject.id, chapterIndex, 'translate')}
                                onChapterAnalyze={(chapterIndex) => handleBatchProcess(activeProject.id, chapterIndex, 'analyze')}
                                onChapterStopAnalyze={(chapterIndex) => handleStopBatchProcess(activeProject.id, chapterIndex, 'analyze')}
                                onChapterUpdate={(chapterIndex, update) => onChapterUpdate(activeProject.id, chapterIndex, update)}
                                onChapterLoadContent={(chapterIndex) => handleLoadChapterContent(activeProject.id, chapterIndex)}
                                isApiBusy={isApiBusy}
                            />
                        ) : (
                           <WorkspaceDashboard
                                projects={workspaceProjects}
                                onOpenProject={handleOpenWorkspaceItem}
                                onDeleteProject={handleDeleteProject}
                                onNewText={handleCreateNewProject}
                                onNewFile={handleCreateNewProject}
                                isLoading={isLoading}
                                isLoggedIn={isLoggedIn}
                           />
                        )}
                    </div>
                </main>
            </div>
        </SettingsContext.Provider>
    );
};

export default App;
