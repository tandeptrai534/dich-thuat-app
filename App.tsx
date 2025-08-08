

import React, { useState, useCallback, useRef, useEffect, createContext, useContext, useMemo } from 'react';
import ReactDOM from 'react-dom';
import { analyzeSentence, analyzeSentencesInBatch, translateSentencesInBatch } from '@/services/geminiService';
import * as driveService from '@/services/googleDriveService';
import type { ApiError, ChapterData, ProjectData, AppSettings, Theme, FontSize, FontFamily, SentenceData, TokenData, VocabularyItem, AnalyzedText, VocabularyLocation, DisplayMode, WorkspaceItem, SpecialTerm } from '@/types';
import { SettingsContext, getThemeClasses, useSettings, SettingsProvider } from '@/contexts/settingsContext';
import { InputArea } from '@/components/InputArea';
import { GithubIcon, ChevronDownIcon, CopyIcon, CloseIcon, SettingsIcon, CheckIcon, PlayIcon, BookOpenIcon, StarIcon, ArchiveBoxIcon, StopIcon, DocumentTextIcon, PencilIcon, ArrowPathIcon, MapPinIcon, BookmarkSquareIcon, DownloadIcon, TrashIcon, UploadIcon, GoogleIcon, ArrowRightOnRectangleIcon, EyeIcon, ChatBubbleBottomCenterTextIcon, CodeBracketIcon, LanguageIcon, CloudIcon, ComputerDesktopIcon } from '@/components/common/icons';
import { Spinner } from '@/components/common/Spinner';
import { WorkspaceTabs } from '@/components/WorkspaceTabs';
import { getGrammarColorMap, GRAMMAR_ROLE_TRANSLATIONS } from '@/constants';
import { GrammarRole } from '@/types';
import { WorkspaceDashboard } from '@/components/WorkspaceDashboard';


// Add global declarations for Google APIs
declare global {
    interface Window {
        gapi: any;
        google: any;
        tokenClient: any;
    }
}


// --- Constants ---
const DEFAULT_CHAPTER_TITLE = 'Văn bản chính';
const APP_DATA_FOLDER_NAME = 'Trình Phân Tích Tiếng Trung AppData';
const PAGE_SIZE = 10;
const TRANSLATION_BATCH_SIZE = 20;
const ANALYSIS_BATCH_SIZE = 5;
const DRIVE_DATA_FILE_NAME = 'app-data.v3.json'; 
const SETTINGS_STORAGE_KEY = 'chinese_analyzer_settings_v3';
const VOCABULARY_STORAGE_KEY = 'chinese_analyzer_vocabulary_v5';
const LOCAL_PROJECTS_KEY = 'chinese_analyzer_local_projects_v1';


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
        translationState: 'pending' as const,
        displayMode: 'detailed-word'
    }));
};


// --- UI Components ---

const OutputDisplay: React.FC<{ data: AnalyzedText }> = ({ data }) => {
    const { theme, settings } = useSettings();
    const grammarColorMap = getGrammarColorMap(settings.theme);

    const legendItems = Object.entries(grammarColorMap)
        .filter(([key]) => key !== GrammarRole.UNKNOWN)
        .map(([key, value]) => ({
            role: key as GrammarRole,
            translation: GRAMMAR_ROLE_TRANSLATIONS[key as GrammarRole],
            ...value
        }));
    
    const formattedExplanation = data.sentenceGrammarExplanation.replace(/\.\s*(?!$)/g, '.\n');

    return (
        <div className="space-y-4 p-4">
            <div className={`p-4 rounded-lg border ${theme.border} ${theme.mainBg}`}>
                <p className={`font-semibold text-lg ${theme.text} mb-3`}>Phân tích ngữ pháp</p>
                <div className="text-lg leading-relaxed">
                    {data.tokens.map((token, index) => {
                        const colorInfo = grammarColorMap[token.grammarRole] || grammarColorMap[GrammarRole.UNKNOWN];
                        return (
                             <span key={index} className={`font-semibold ${colorInfo.text} mx-px`} title={`${token.grammarRole}: ${token.grammarExplanation}`}>
                                {token.character}
                            </span>
                        );
                    })}
                </div>
                {data.sentenceGrammarExplanation && (
                    <div className={`mt-4 pt-3 border-t ${theme.border}`}>
                        <p className={`text-sm ${theme.mutedText} whitespace-pre-line`}><span className="font-semibold">Giải thích:</span> {formattedExplanation}</p>
                    </div>
                )}
            </div>
            
            <div className={`p-4 rounded-lg border ${theme.border} ${theme.mainBg}`}>
                 <p className={`font-semibold text-sm mb-2 ${theme.text}`}>Chú giải màu sắc</p>
                 <div className="flex flex-wrap gap-x-4 gap-y-2">
                     {legendItems.map(item => (
                         <div key={item.role} className="flex items-center gap-2 text-xs">
                             <span className={`w-3 h-3 rounded-full border ${item.border} ${item.bg}`}></span>
                             <span className={theme.mutedText}>{item.translation.vi} ({item.translation.en})</span>
                         </div>
                     ))}
                 </div>
            </div>
        </div>
    );
};

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
            className={`absolute top-2 left-2 flex items-center gap-1.5 text-xs font-medium p-1.5 rounded-md transition-colors ${theme.button.bg} ${theme.button.text} ${theme.button.hoverBg} z-10 ${className}`}
            title="Sao chép"
        >
            <CopyIcon className="w-3.5 h-3.5" />
            {copied ? 'Đã sao chép' : ''}
        </button>
    );
};

const DetailedWordView: React.FC<{ analysisResult: AnalyzedText }> = ({ analysisResult }) => {
    const { theme, settings } = useSettings();
    const grammarColorMap = getGrammarColorMap(settings.theme);

    const textToCopy = `Gốc: ${analysisResult.tokens.map(t => t.character).join('')}\n` +
                       `Pinyin: ${analysisResult.tokens.map(t => t.pinyin).join(' ')}\n` +
                       `Hán Việt: ${analysisResult.tokens.map(t => t.sinoVietnamese).join(' ')}\n` +
                       `Nghĩa: ${analysisResult.tokens.map(t => t.vietnameseMeaning).join(' / ')}`;

    const tokens = analysisResult.tokens;

    if (!tokens || tokens.length === 0) {
        return <div className={`p-4 text-center ${theme.mutedText}`}>Không có dữ liệu phân tích chi tiết.</div>;
    }
    
    const GridCell: React.FC<{children: React.ReactNode, token: TokenData}> = ({ children, token }) => {
        const colorInfo = grammarColorMap[token.grammarRole] || grammarColorMap[GrammarRole.UNKNOWN];
        return (
            <div className={`flex items-center justify-center p-2 text-center border-b border-r ${theme.border}`}>
                <span className={colorInfo.text}>{children}</span>
            </div>
        );
    };

    return (
        <div className="relative w-full overflow-x-auto pr-16">
            <ViewCopyButton textToCopy={textToCopy} />
            <div 
                className={`grid border-t border-l ${theme.border} mt-8`}
                style={{
                    gridTemplateColumns: `repeat(${tokens.length}, minmax(max-content, 1fr))`,
                }}
            >
                {/* Hanzi Row */}
                {tokens.map((token, index) => (
                    <GridCell key={`hanzi-${index}`} token={token}>
                        <span className="font-semibold" style={{ fontSize: `${settings.hanziFontSize}px` }}>
                            {token.character}
                        </span>
                    </GridCell>
                ))}
                {/* Pinyin Row */}
                {tokens.map((token, index) => (
                    <GridCell key={`pinyin-${index}`} token={token}>
                        <span className="text-xs">{token.pinyin}</span>
                    </GridCell>
                ))}
                {/* Sino-Vietnamese Row */}
                {tokens.map((token, index) => (
                    <GridCell key={`sino-${index}`} token={token}>
                        <span className="text-xs font-medium">{token.sinoVietnamese}</span>
                    </GridCell>
                ))}
                {/* Vietnamese Meaning Row */}
                {tokens.map((token, index) => (
                    <GridCell key={`meaning-${index}`} token={token}>
                        <span className="text-sm">{token.vietnameseMeaning}</span>
                    </GridCell>
                ))}
            </div>
        </div>
    );
};


const TranslationOnlyView: React.FC<{ analysisResult: AnalyzedText, originalText: string }> = ({ analysisResult, originalText }) => {
    const translationText = analysisResult.translation;
    return (
        <div className="relative min-h-[5rem] flex flex-col items-center justify-center text-center gap-2 p-4 pr-16">
            <ViewCopyButton textToCopy={`${originalText}\n${translationText}`} />
            <p className="text-lg italic"><InteractiveText text={translationText} /></p>
        </div>
    );
};

const OriginalOnlyView: React.FC<{ originalText: string; analysisResult?: AnalyzedText }> = ({ originalText, analysisResult }) => {
    const { settings, theme } = useSettings();
    const grammarColorMap = getGrammarColorMap(settings.theme);
    
    const renderContent = () => {
        if (analysisResult && analysisResult.tokens.length > 0) {
            return analysisResult.tokens.map((token, index) => {
                const colorInfo = grammarColorMap[token.grammarRole] || grammarColorMap[GrammarRole.UNKNOWN];
                return (
                    <span key={index} className={colorInfo.text} title={`${GRAMMAR_ROLE_TRANSLATIONS[token.grammarRole]?.vi || 'Không rõ'}`}>
                        {token.character}
                    </span>
                );
            });
        }
        return originalText;
    };
    
    return (
        <div className="relative min-h-[5rem] flex items-center justify-center p-4 pr-16">
            <ViewCopyButton textToCopy={originalText} />
            <p style={{fontSize: `${settings.hanziFontSize}px`}} className="font-semibold text-center leading-loose">
                 {renderContent()}
            </p>
        </div>
    );
};


const SentenceDisplay: React.FC<{
    sentence: SentenceData;
    id: string;
    onClick: () => void;
    onDisplayModeChange: (mode: DisplayMode) => void;
}> = ({ sentence, id, onClick, onDisplayModeChange }) => {
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
    
    const SentenceViewSwitcher: React.FC = () => {
        const buttons: { mode: DisplayMode; icon: React.FC<any>; label: string }[] = [
            { mode: 'detailed-word', icon: EyeIcon, label: 'Chi tiết' },
            { mode: 'grammar', icon: CodeBracketIcon, label: 'Ngữ pháp' },
            { mode: 'translation', icon: ChatBubbleBottomCenterTextIcon, label: 'Bản dịch' },
            { mode: 'original', icon: LanguageIcon, label: 'Gốc' },
        ];
        
        return (
            <div className={`flex items-center rounded-lg shadow-sm border ${theme.border} ${theme.mainBg} p-0.5 z-10`}>
                {buttons.map(btn => {
                     const isActive = sentence.displayMode === btn.mode;
                     return (
                        <button 
                            key={btn.mode}
                            onClick={(e) => { e.stopPropagation(); onDisplayModeChange(btn.mode); }}
                            className={`p-1.5 rounded-md transition-colors ${isActive ? `${theme.primaryButton.bg} ${theme.primaryButton.text}` : `${theme.mutedText} hover:bg-slate-500/10 hover:text-blue-500`}`}
                            title={btn.label}
                        >
                            <btn.icon className="w-5 h-5" />
                        </button>
                     )
                })}
            </div>
        )
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
                            return <TranslationOnlyView analysisResult={sentence.analysisResult} originalText={sentence.original} />;
                        case 'original':
                            return <OriginalOnlyView originalText={sentence.original} analysisResult={sentence.analysisResult} />;
                        case 'detailed-word':
                        default:
                            return <DetailedWordView analysisResult={sentence.analysisResult} />;
                    }
                };
                
                 if (sentence.isTitle) {
                    return (
                        <div className={`relative flex flex-col ${titleSpecificClass}`}>
                            <div className="flex justify-end items-center px-2 pt-1 min-h-[40px]">
                                <SentenceViewSwitcher />
                            </div>
                            <div className={`p-2 ${sentence.displayMode !== 'grammar' ? `border-t ${theme.border}`: ''}`}>
                                 {renderView()}
                            </div>
                        </div>
                    )
                }

                return (
                    <div className="relative flex flex-col">
                        <div className="flex justify-between items-center px-3 pt-2 min-h-[40px]">
                            <span className="text-xs font-bold text-slate-400">{sentence.sentenceNumber}.</span>
                            <SentenceViewSwitcher />
                        </div>
                        <div className={`p-2 border-t ${theme.border}`}>
                            {renderView()}
                        </div>
                    </div>
                );
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
    onSentenceDisplayModeChange: (sentenceIndex: number, mode: DisplayMode) => void;
    onTranslate: () => void;
    onStopTranslate: () => void;
    onAnalyze: () => void;
    onStopAnalyze: () => void;
    onUpdate: (update: Partial<ChapterData>) => void;
    onLoadChapterContent: () => void;
    isApiBusy: boolean;
}> = ({ chapter, chapterIndex, onSentenceClick, onSentenceDisplayModeChange, onTranslate, onStopTranslate, onAnalyze, onStopAnalyze, onUpdate, onLoadChapterContent, isApiBusy }) => {
    const { theme, settings } = useSettings();
    
    const untranslatedSentences = chapter.sentences.filter(s => s.translationState === 'pending').length;
    const unanalyzedSentences = chapter.sentences.filter(s => s.analysisState === 'pending').length;

    const allSentencesTranslated = chapter.isLoaded && untranslatedSentences === 0;
    const allSentencesAnalyzed = chapter.isLoaded && unanalyzedSentences === 0;

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
                <button onClick={(e) => { e.preventDefault(); onTranslate(); }} disabled={isApiBusy} className={`flex items-center gap-2 px-3 py-1.5 text-sm font-semibold rounded-md transition-colors ${theme.button.bg} ${theme.button.text} ${theme.button.hoverBg} disabled:opacity-50 disabled:cursor-not-allowed`}>
                    <PlayIcon className="w-4 h-4" /> Dịch chương
                </button>
            );
        }
        if (!allSentencesAnalyzed) {
            return (
                <button onClick={(e) => { e.preventDefault(); onAnalyze(); }} disabled={isApiBusy} className={`flex items-center gap-2 px-3 py-1.5 text-sm font-semibold rounded-md transition-colors ${theme.primaryButton.bg} ${theme.primaryButton.text} ${theme.primaryButton.hoverBg} disabled:opacity-50 disabled:cursor-not-allowed`}>
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
                                    onDisplayModeChange={(mode) => onSentenceDisplayModeChange(index, mode)}
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
            </div>
        </details>
    );
};

const ProjectDisplay: React.FC<{
    projectData: ProjectData;
    onSentenceClick: (chapterIndex: number, sentenceIndex: number) => void;
    onSentenceDisplayModeChange: (chapterIndex: number, sentenceIndex: number, mode: DisplayMode) => void;
    onVisibleRangeUpdate: (newRange: { start: number; end: number }) => void;
    onPageSizeUpdate: (newSize: number) => void;
    onChapterTranslate: (chapterIndex: number) => void;
    onChapterStopTranslate: (chapterIndex: number) => void;
    onChapterAnalyze: (chapterIndex: number) => void;
    onChapterStopAnalyze: (chapterIndex: number) => void;
    onChapterUpdate: (chapterIndex: number, newState: Partial<ChapterData>) => void;
    onChapterLoadContent: (chapterIndex: number) => void;
    isApiBusy: boolean;
}> = ({ projectData, onSentenceClick, onSentenceDisplayModeChange, onVisibleRangeUpdate, onPageSizeUpdate, onChapterTranslate, onChapterStopTranslate, onChapterAnalyze, onChapterStopAnalyze, onChapterUpdate, onChapterLoadContent, isApiBusy }) => {
    
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
                            onSentenceDisplayModeChange={(sentenceIndex, mode) => onSentenceDisplayModeChange(originalChapterIndex, sentenceIndex, mode)}
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
    const [showApiKey, setShowApiKey] = useState(false);

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
                    <div className="relative">
                        <input
                            type={showApiKey ? "text" : "password"}
                            value={localSettings.apiKey}
                            onChange={(e) => setLocalSettings(s => ({ ...s, apiKey: e.target.value }))}
                            className={`w-full p-2 border ${theme.border} rounded-md shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${theme.cardBg} ${theme.text} pr-10`}
                            placeholder="Nhập API Key của bạn"
                        />
                        <button
                            type="button"
                            onClick={() => setShowApiKey(!showApiKey)}
                            className={`absolute inset-y-0 right-0 flex items-center px-3 ${theme.mutedText} hover:${theme.text}`}
                        >
                            {showApiKey ? <EyeIcon className="w-5 h-5" /> : <EyeIcon className="w-5 h-5" />} 
                        </button>
                    </div>
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
    onUnify: (e: React.MouseEvent) => void;
}> = ({ isOpen, onClose, vocabulary, onDelete, onToggleForceSino, onUpdate, onGoToLocation, onUnify }) => {
    const { theme } = useSettings();
    const [searchTerm, setSearchTerm] = useState('');
    const [editingTermKey, setEditingTermKey] = useState<string | null>(null);
    const [editFormData, setEditFormData] = useState<VocabularyItem | null>(null);
    const [activeTab, setActiveTab] = useState<'unchecked' | 'checked'>('unchecked');

    if (!isOpen) return null;

    const handleEditClick = (item: VocabularyItem) => {
        setEditingTermKey(item.term);
        setEditFormData({ ...item });
    };

    const handleCancelEdit = () => {
        setEditingTermKey(null);
        setEditFormData(null);
    };

    const handleSaveEdit = (originalTerm: string) => {
        if (!editFormData || !editFormData.term || !editFormData.sinoVietnamese) {
            alert("Thông tin không hợp lệ.");
            return;
        }

        if (originalTerm.toLowerCase() !== editFormData.term.toLowerCase()) {
            if (vocabulary.some(v => v.term.toLowerCase() === editFormData.term!.toLowerCase())) {
                alert(`Thuật ngữ "${editFormData.term}" đã tồn tại trong từ điển.`);
                return;
            }
        }
        
        onUpdate(originalTerm, editFormData);
        handleCancelEdit();
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setEditFormData(prev => (prev ? { ...prev, [name]: value } : null));
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
                <input name="term" value={editFormData?.term || ''} onChange={handleInputChange} className={`w-full p-2 border ${theme.border} rounded-md ${theme.cardBg} ${theme.text}`}/>
            </div>
             <div className='space-y-1'>
                <label className={`text-xs font-semibold ${theme.mutedText}`}>Âm Hán-Việt</label>
                <input name="sinoVietnamese" value={editFormData?.sinoVietnamese || ''} onChange={handleInputChange} className={`w-full p-2 border ${theme.border} rounded-md ${theme.cardBg} ${theme.text}`}/>
            </div>
             <div className='space-y-1'>
                <label className={`text-xs font-semibold ${theme.mutedText}`}>Bản dịch tự nhiên (để tìm và thay thế)</label>
                <input name="vietnameseTranslation" value={editFormData?.vietnameseTranslation || ''} onChange={handleInputChange} className={`w-full p-2 border ${theme.border} rounded-md ${theme.cardBg} ${theme.text}`}/>
            </div>
             <div className='space-y-1'>
                <label className={`text-xs font-semibold ${theme.mutedText}`}>Giải thích</label>
                <textarea name="explanation" value={editFormData?.explanation || ''} onChange={handleInputChange} rows={3} className={`w-full p-2 border ${theme.border} rounded-md ${theme.cardBg} ${theme.text}`}/>
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
            all: "BẠN CÓ CHẮC CHẮN MUỐN XÓA TẤT CẢ DỮ LIỆU CỤC BỘ KHÔNG? Bao gồm cài đặt, từ điển và CÁC DỰ ÁN ĐÃ LƯU TRÊN MÁY. Hành động này không thể hoàn tác và không ảnh hưởng đến tệp trên Google Drive.",
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
                            Đăng nhập để tự động sao lưu và đồng bộ các dự án, cài đặt và từ điển của bạn trên nhiều thiết bị.
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
                        <h3 className={`text-lg font-semibold ${theme.text} flex items-center gap-2`}><ComputerDesktopIcon className="w-5 h-5" />Lưu trữ cục bộ</h3>
                        <p className={`text-sm ${theme.mutedText}`}>
                            Quản lý dữ liệu được lưu trực tiếp trên trình duyệt này. Các hành động này không ảnh hưởng đến dữ liệu trên Google Drive.
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <button onClick={onExport} className={`w-full flex items-center justify-center gap-2 px-4 py-2 font-semibold rounded-lg shadow-sm transition-colors border ${theme.border} ${theme.button.bg} ${theme.button.text} ${theme.button.hoverBg}`}>
                                <DownloadIcon className="w-5 h-5" /> Xuất dữ liệu
                            </button>
                             <button onClick={handleImportClick} className={`w-full flex items-center justify-center gap-2 px-4 py-2 font-semibold rounded-lg shadow-sm transition-colors border ${theme.border} ${theme.button.bg} ${theme.button.text} ${theme.button.hoverBg}`}>
                                <UploadIcon className="w-5 h-5" /> Nhập dữ liệu
                            </button>
                            <input type="file" ref={importInputRef} onChange={onImport} className="hidden" accept=".json" />
                        </div>
                    </section>
                    
                     <div className={`border-t ${theme.border}`}></div>
                    
                    <section className="space-y-3">
                         <h3 className={`text-lg font-semibold text-red-600 dark:text-red-400`}>Vùng nguy hiểm</h3>
                        <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 rounded-lg space-y-3">
                            <p className="text-sm text-red-800 dark:text-red-300">Các hành động này không thể hoàn tác. Hãy thận trọng.</p>
                             <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <button onClick={() => handleClearClick('vocabulary')} className={`w-full px-4 py-2 font-semibold rounded-lg shadow-sm transition-colors border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40`}>
                                    Xóa từ điển
                                </button>
                                 <button onClick={() => handleClearClick('all')} className={`w-full px-4 py-2 font-semibold rounded-lg shadow-sm transition-colors bg-red-600 text-white hover:bg-red-700`}>
                                    Xóa TẤT CẢ dữ liệu
                                </button>
                            </div>
                        </div>
                    </section>
                </div>
            </div>
        </div>
    );
};

// --- Main App Component ---
const App: React.FC = () => {
    const { settings, theme, vocabulary, setVocabulary, setSettings } = useSettings();
    const [openProjects, setOpenProjects] = useState<ProjectData[]>([]);
    const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
    const [workspaceProjects, setWorkspaceProjects] = useState<WorkspaceItem[]>([]);
    
    const [isLoading, setIsLoading] = useState(true);
    const [isApiBusy, setIsApiBusy] = useState(false);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isVocabOpen, setIsVocabOpen] = useState(false);
    const [isDataMgmtOpen, setIsDataMgmtOpen] = useState(false);
    const [apiError, setApiError] = useState<string | null>(null);

    const [googleApiStatus, setGoogleApiStatus] = useState<GoogleApiStatus>({ status: 'pending', message: 'Đang tải Google API...' });
    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const [isPickerApiLoaded, setIsPickerApiLoaded] = useState(false);
    
    const stopProcessRef = useRef<boolean>(false);

    // --- Google Drive & Auth ---
    const initGoogleApis = useCallback(async () => {
        try {
            await loadScript('https://apis.google.com/js/api.js');
            await new Promise<void>(resolve => window.gapi.load('client:picker', resolve));
            
            await window.gapi.client.init({
                discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'],
            });
            setIsPickerApiLoaded(true);

            await loadScript('https://accounts.google.com/gsi/client');
            
            const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
            if (!clientId) {
                throw new Error("VITE_GOOGLE_CLIENT_ID is not configured.");
            }
            
            window.tokenClient = window.google.accounts.oauth2.initTokenClient({
                client_id: clientId,
                scope: DRIVE_SCOPES,
                callback: (tokenResponse) => {
                    if (tokenResponse.error) {
                        console.error('Google Auth Error:', tokenResponse.error);
                        setApiError(`Lỗi xác thực Google: ${tokenResponse.error_description}`);
                        return;
                    }
                    setIsLoggedIn(true);
                },
            });
            setGoogleApiStatus({ status: 'ready', message: 'Sẵn sàng đăng nhập.' });
        } catch (error) {
            console.error("Google API Init Error:", error);
            setGoogleApiStatus({ status: 'error', message: 'Không thể tải API của Google. Vui lòng kiểm tra kết nối mạng và thử lại.' });
            setIsLoggedIn(false);
            setIsPickerApiLoaded(false);
        }
    }, []);

    useEffect(() => {
        initGoogleApis();
    }, [initGoogleApis]);
    
    const handleLogin = () => {
        if (googleApiStatus.status === 'ready' && window.tokenClient) {
            window.tokenClient.requestAccessToken();
        }
    };

    const handleLogout = () => {
        const token = window.gapi.client.getToken();
        if (token) {
            window.google.accounts.oauth2.revoke(token.access_token, () => {
                window.gapi.client.setToken(null);
                setIsLoggedIn(false);
            });
        }
    };
    
    // --- Project Management ---
    
    const findProjectIndex = (projectId: string) => openProjects.findIndex(p => p.id === projectId);
    const findChapterIndex = (project: ProjectData, chapterIndex: number) => chapterIndex;
    
    const updateProjectState = (projectId: string, updateFn: (project: ProjectData) => ProjectData) => {
        setOpenProjects(prev => prev.map(p => p.id === projectId ? updateFn(p) : p));
    };

    const handleNewText = useCallback(async (text: string, fileName: string = 'Văn bản mới') => {
        setIsLoading(true);
        try {
            const rawChapters = processTextIntoRawChapters(text);
            const newProject: ProjectData = {
                id: `local_${new Date().getTime()}`,
                fileName,
                chapters: rawChapters.map((rc, index) => ({
                    title: rc.title,
                    chapterNumber: rc.chapterNumber,
                    fileNamePrefix: `${String(index).padStart(5, '0')}_${sanitizeFileName(rc.title)}`,
                    sentences: [],
                    isExpanded: index === 0,
                    isLoaded: false,
                    rawContent: rc.content,
                })),
                visibleRange: { start: 0, end: Math.min(PAGE_SIZE, rawChapters.length) },
                pageSize: PAGE_SIZE,
                lastModified: new Date().toISOString(),
            };
            setOpenProjects(prev => [...prev, newProject]);
            setActiveProjectId(newProject.id);
        } catch (error) {
            console.error("Error creating new text project:", error);
            setApiError("Không thể tạo dự án từ văn bản đã cung cấp.");
        } finally {
            setIsLoading(false);
        }
    }, []);
    
    const handleNewFile = useCallback((content: string, fileName: string) => {
        handleNewText(content, fileName);
    }, [handleNewText]);

    const onDriveFilePicked = useCallback(async (data: any) => {
        if (data.action !== 'picked' || !data.docs || data.docs.length === 0) {
            return;
        }
        const file = data.docs[0];
        const fileId = file.id;
        const fileName = file.name;
        const oauthToken = window.gapi.client.getToken().access_token;

        setIsLoading(true);
        setApiError(null);

        try {
            const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
                headers: { 'Authorization': `Bearer ${oauthToken}` }
            });

            if (!response.ok) {
                throw new Error(`Lỗi tải tệp từ Google Drive: ${response.statusText}`);
            }

            const blob = await response.blob();

            const reader = new FileReader();
            reader.onload = (e) => {
                const fileContent = e.target?.result as string;
                handleNewFile(fileContent, fileName);
            };
            reader.onerror = () => {
                throw new Error("Không thể đọc nội dung tệp đã tải về từ Drive.");
            };
            reader.readAsText(blob, 'UTF-8');

        } catch (error: any) {
            console.error("Error processing Drive file:", error);
            setApiError(error.message);
            setIsLoading(false);
        }
    }, [handleNewFile]);

    const handleNewFromDrive = useCallback(() => {
        if (!isLoggedIn || !isPickerApiLoaded || !window.google?.picker) {
            setApiError("Chức năng Google Drive chưa sẵn sàng. Vui lòng đăng nhập và thử lại.");
            return;
        }
        
        const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
        const oauthToken = window.gapi.client.getToken().access_token;

        if (!clientId || !oauthToken) {
            setApiError("Thông tin xác thực Google không đầy đủ. Vui lòng đăng nhập lại.");
            return;
        }

        const view = new window.google.picker.View(window.google.picker.ViewId.DOCS);
        view.setMimeTypes("text/plain");

        const picker = new window.google.picker.PickerBuilder()
            .enableFeature(window.google.picker.Feature.NAV_HIDDEN)
            .setAppId(clientId)
            .setOAuthToken(oauthToken)
            .addView(view)
            .setLocale('vi')
            .setCallback(onDriveFilePicked)
            .build();
        picker.setVisible(true);
    }, [isLoggedIn, isPickerApiLoaded, onDriveFilePicked]);

    const handleUploadRawFileToDrive = async (file: File) => {
        if (!isLoggedIn) {
            setApiError("Vui lòng đăng nhập để tải tệp lên Google Drive.");
            return;
        }
        const originalError = apiError;
        setApiError(`Đang tải tệp "${file.name}" lên Google Drive...`);

        try {
            await driveService.uploadRawFile(file);
            alert(`Tệp "${file.name}" đã được tải lên Google Drive thành công!`);
            setApiError(originalError);
        } catch (error: any) {
            setApiError(`Lỗi tải tệp lên Drive: ${error.message}`);
        }
    };
    
    const handleOpenProject = (projectToOpen: WorkspaceItem) => {
        const alreadyOpen = openProjects.find(p => p.id === projectToOpen.id);
        if (alreadyOpen) {
            setActiveProjectId(alreadyOpen.id);
            return;
        }
        
        // This is a placeholder. A full implementation would load from localStorage or Drive.
        console.log("Opening project:", projectToOpen.name);
        // For now, let's just create a dummy project to show it's "open"
        const newProject: ProjectData = {
            id: projectToOpen.id,
            fileName: projectToOpen.name,
            chapters: [], // In a real scenario, you'd load chapters here.
            visibleRange: { start: 0, end: 0 },
            pageSize: PAGE_SIZE,
            lastModified: projectToOpen.lastModified,
        };
        setOpenProjects(p => [...p, newProject]);
        setActiveProjectId(newProject.id);
        setApiError("Tải dự án chi tiết chưa được hỗ trợ trong bản demo này.");
    };

    const handleCloseProject = (projectId: string) => {
        setOpenProjects(prev => prev.filter(p => p.id !== projectId));
        if (activeProjectId === projectId) {
            setActiveProjectId(null);
        }
    };
    
    const handleDeleteProject = (projectToDelete: WorkspaceItem) => {
        if(window.confirm(`Bạn có chắc muốn xoá dự án "${projectToDelete.name}"?`)){
            setWorkspaceProjects(prev => prev.filter(p => p.id !== projectToDelete.id));
            handleCloseProject(projectToDelete.id);
            // Add logic for actual deletion from local storage or Drive here
        }
    };

    const handleGoToDashboard = () => {
        setActiveProjectId(null);
    };

    // --- Chapter & Sentence Logic ---
    const handleLoadChapterContent = useCallback((projectId: string, chapterIndex: number) => {
        updateProjectState(projectId, p => {
            const chapters = [...p.chapters];
            const chapter = { ...chapters[chapterIndex] };
            if (chapter.isLoaded) return p;

            try {
                if (chapter.rawContent) {
                     const titleSentence: SentenceData = {
                        original: chapter.title,
                        isTitle: true,
                        sentenceNumber: 0,
                        analysisState: 'pending',
                        translationState: 'pending',
                        displayMode: 'detailed-word',
                    };
                    const contentSentences = createSentencesFromContent(chapter.rawContent);
                    chapter.sentences = [titleSentence, ...contentSentences];
                    chapter.isLoaded = true;
                    // free up memory
                    delete chapter.rawContent; 
                } else {
                    // Logic to load from drive would go here
                    chapter.chapterError = "Không tìm thấy nội dung để tải.";
                }
            } catch(e) {
                 chapter.chapterError = "Lỗi khi xử lý nội dung chương.";
            }
            
            chapters[chapterIndex] = chapter;
            return { ...p, chapters };
        });
    }, []);

    const handleChapterUpdate = (projectId: string, chapterIndex: number, newState: Partial<ChapterData>) => {
        updateProjectState(projectId, p => {
            const chapters = [...p.chapters];
            chapters[chapterIndex] = { ...chapters[chapterIndex], ...newState };
            return { ...p, chapters };
        });
    };
    
    const handleSentenceDisplayModeChange = (projectId: string, chapterIndex: number, sentenceIndex: number, mode: DisplayMode) => {
        updateProjectState(projectId, p => {
            const chapters = [...p.chapters];
            const chapter = { ...chapters[chapterIndex] };
            const sentences = [...chapter.sentences];
            sentences[sentenceIndex] = { ...sentences[sentenceIndex], displayMode: mode };
            chapter.sentences = sentences;
            chapters[chapterIndex] = chapter;
            return { ...p, chapters };
        });
    };

    // --- API Interactions ---
    const handleSentenceAnalysis = async (projectId: string, chapterIndex: number, sentenceIndex: number) => {
        const project = openProjects.find(p => p.id === projectId);
        if (!project) return;
        
        if (!settings.apiKey) {
            setApiError("Vui lòng cung cấp API Key trong phần cài đặt.");
            setIsSettingsOpen(true);
            return;
        }

        const sentence = project.chapters[chapterIndex].sentences[sentenceIndex];
        if (!sentence || sentence.analysisState === 'loading' || sentence.analysisState === 'done' || isApiBusy) return;
        setIsApiBusy(true);

        try {
            updateSentenceState(projectId, chapterIndex, sentenceIndex, { analysisState: 'loading' });
            
            const forcedSinoTerms = vocabulary
                .filter(v => v.isForceSino && v.sinoVietnamese)
                .map(v => ({ term: v.term, sinoVietnamese: v.sinoVietnamese }));

            const result = await analyzeSentence(settings.apiKey, sentence.original, forcedSinoTerms);
            
            updateSentenceState(projectId, chapterIndex, sentenceIndex, {
                analysisState: 'done',
                analysisResult: result,
                displayMode: 'translation',
                translation: result.translation,
                translationState: 'done'
            });

            if (result.specialTerms && result.specialTerms.length > 0) {
                 addTermsToVocabulary(result.specialTerms, project.chapters[chapterIndex], sentence);
            }

        } catch (e: any) {
            console.error(e);
            const errorMessage = e.message || 'Lỗi không xác định.';
            updateSentenceState(projectId, chapterIndex, sentenceIndex, {
                analysisState: 'error',
                analysisError: errorMessage
            });
            setApiError(errorMessage);
        } finally {
            setIsApiBusy(false);
        }
    };
    
    const addTermsToVocabulary = (terms: SpecialTerm[], chapter: ChapterData, sentence: SentenceData) => {
        setVocabulary(currentVocab => {
            const newVocab = [...currentVocab];
            const existingTerms = new Set(currentVocab.map(v => v.term.toLowerCase()));
            const currentProject = openProjects.find(p=>p.chapters.some(c => c.title === chapter.title));

            terms.forEach(term => {
                if (!existingTerms.has(term.term.toLowerCase())) {
                    newVocab.push({
                        ...term,
                        firstLocation: {
                            chapterIndex: currentProject ? currentProject.chapters.findIndex(c => c.title === chapter.title) : -1,
                            chapterTitle: chapter.title,
                            sentenceNumber: sentence.sentenceNumber || 0,
                            originalSentence: sentence.original
                        },
                        isForceSino: false, 
                    });
                    existingTerms.add(term.term.toLowerCase());
                }
            });
            return newVocab;
        });
    };
    
    const updateSentenceState = (projectId: string, chapterIndex: number, sentenceIndex: number, newState: Partial<SentenceData>) => {
        updateProjectState(projectId, p => {
            const chapters = [...p.chapters];
            const chapter = { ...chapters[chapterIndex] };
            const sentences = [...chapter.sentences];
            sentences[sentenceIndex] = { ...sentences[sentenceIndex], ...newState };
            chapter.sentences = sentences;
            chapters[chapterIndex] = chapter;
            return { ...p, chapters };
        });
    };
    
    const runBatchProcess = async <T,>(
        projectId: string, 
        chapterIndex: number, 
        stateKey: 'translationState' | 'analysisState',
        batchSize: number,
        apiCall: (batch: string[]) => Promise<T[]>,
        onSuccess: (originalSentenceIndex: number, result: T) => void,
        updateChapterState: (state: Partial<ChapterData>) => void
    ) => {
        stopProcessRef.current = false;
        setIsApiBusy(true);
        
        try {
            const project = openProjects.find(p => p.id === projectId);
            if (!project) throw new Error("Project not found");
            
            const chapter = project.chapters[chapterIndex];
            const sentencesToProcess = chapter.sentences
                .map((s, index) => ({ ...s, originalIndex: index }))
                .filter(s => s[stateKey] === 'pending');
            
            const totalSentences = sentencesToProcess.length;
            if (totalSentences === 0) return;

            let processedCount = 0;

            for (let i = 0; i < totalSentences; i += batchSize) {
                if (stopProcessRef.current) break;

                const batch = sentencesToProcess.slice(i, i + batchSize);
                const batchOriginals = batch.map(s => s.original);

                try {
                    const results = await apiCall(batchOriginals);
                    if (results.length !== batch.length) throw new Error("API response length mismatch");
                    
                    batch.forEach((sentence, j) => {
                        onSuccess(sentence.originalIndex, results[j]);
                    });
                } catch (batchError: any) {
                    console.error("Error in batch:", batchError);
                    batch.forEach(sentence => {
                         updateSentenceState(projectId, chapterIndex, sentence.originalIndex, { 
                             [stateKey]: 'error',
                             translationError: batchError.message,
                             analysisError: batchError.message
                         });
                    });
                } finally {
                    processedCount += batch.length;
                    updateChapterState({ batchTranslationProgress: processedCount / totalSentences, batchAnalysisProgress: processedCount / totalSentences });
                }
            }
        } catch (error: any) {
            console.error("Error running batch process:", error);
            setApiError(error.message);
        } finally {
            setIsApiBusy(false);
            stopProcessRef.current = false;
            updateChapterState({ isBatchTranslating: false, isBatchAnalyzing: false, batchTranslationProgress: 0, batchAnalysisProgress: 0 });
        }
    };


    const handleChapterTranslate = (projectId: string, chapterIndex: number) => {
        if (!settings.apiKey) {
            setApiError("Vui lòng cung cấp API Key trong phần cài đặt.");
            setIsSettingsOpen(true);
            return;
        }
        handleChapterUpdate(projectId, chapterIndex, { isBatchTranslating: true, batchTranslationProgress: 0 });
        const forcedSinoTerms = vocabulary
            .filter(v => v.isForceSino && v.sinoVietnamese)
            .map(v => ({ term: v.term, sinoVietnamese: v.sinoVietnamese }));
        
        runBatchProcess<string>(
            projectId,
            chapterIndex,
            'translationState',
            TRANSLATION_BATCH_SIZE,
            (batch) => translateSentencesInBatch(settings.apiKey, batch, forcedSinoTerms),
            (originalIndex, result) => {
                updateSentenceState(projectId, chapterIndex, originalIndex, {
                    translation: result,
                    translationState: 'done',
                    displayMode: 'translation' 
                });
            },
            (state) => handleChapterUpdate(projectId, chapterIndex, state)
        );
    };

    const handleChapterStopTranslate = (projectId: string, chapterIndex: number) => {
        stopProcessRef.current = true;
    };
    
    const handleChapterAnalyze = (projectId: string, chapterIndex: number) => {
        if (!settings.apiKey) {
            setApiError("Vui lòng cung cấp API Key trong phần cài đặt.");
            setIsSettingsOpen(true);
            return;
        }
        handleChapterUpdate(projectId, chapterIndex, { isBatchAnalyzing: true, batchAnalysisProgress: 0 });
        const forcedSinoTerms = vocabulary
            .filter(v => v.isForceSino && v.sinoVietnamese)
            .map(v => ({ term: v.term, sinoVietnamese: v.sinoVietnamese }));
            
        runBatchProcess<AnalyzedText>(
            projectId,
            chapterIndex,
            'analysisState',
            ANALYSIS_BATCH_SIZE,
            (batch) => analyzeSentencesInBatch(settings.apiKey, batch, forcedSinoTerms),
            (originalIndex, result) => {
                const project = openProjects.find(p => p.id === projectId)!;
                const chapter = project.chapters[chapterIndex];
                const sentence = chapter.sentences[originalIndex];

                updateSentenceState(projectId, chapterIndex, originalIndex, {
                    analysisResult: result,
                    analysisState: 'done',
                    translation: result.translation,
                    translationState: 'done',
                    displayMode: 'translation'
                });
                if (result.specialTerms?.length > 0) {
                    addTermsToVocabulary(result.specialTerms, chapter, sentence);
                }
            },
             (state) => handleChapterUpdate(projectId, chapterIndex, state)
        );
    };
    
    const handleChapterStopAnalyze = (projectId: string, chapterIndex: number) => {
        stopProcessRef.current = true;
    };
    
    const handlePageSizeUpdate = (projectId: string, newSize: number) => {
        updateProjectState(projectId, p => ({ ...p, pageSize: newSize }));
    };
    const handleVisibleRangeUpdate = (projectId: string, newRange: { start: number; end: number }) => {
        updateProjectState(projectId, p => ({ ...p, visibleRange: newRange }));
    };

    // --- Data Management Handlers ---
    const handleExport = () => { console.log("Exporting data"); setApiError("Tính năng đang được phát triển."); };
    const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => { console.log("Importing data"); setApiError("Tính năng đang được phát triển."); };
    const handleClearData = (type: 'vocabulary' | 'settings' | 'all') => {
        if (type === 'vocabulary' || type === 'all') {
            setVocabulary([]);
        }
        if (type === 'settings' || type === 'all') {
            localStorage.removeItem(SETTINGS_STORAGE_KEY);
            // You might want to reload or reset settings to default here
        }
        if (type === 'all') {
            setOpenProjects([]);
            setWorkspaceProjects([]);
            localStorage.removeItem(LOCAL_PROJECTS_KEY);
        }
        alert("Đã xoá dữ liệu.");
    };
     const handleUnifyTranslations = (e: React.MouseEvent) => {
        e.preventDefault();
        alert("Tính năng đồng nhất bản dịch đang được phát triển!");
    };

    const handleGoToVocabLocation = (location: VocabularyLocation) => {
        // This is complex, would need to find the project associated with the vocab item.
        // For now, just log it.
        console.log("Go to location:", location);
        setIsVocabOpen(false);
        setApiError("Tính năng nhảy đến vị trí đang được phát triển.");
    };
    
    // --- Render ---

    const activeProject = openProjects.find(p => p.id === activeProjectId);
    const { fontFamily, fontSize, lineHeight } = settings;
    const themeClasses = getThemeClasses(settings.theme);

    useEffect(() => {
        // On initial load, set loading to false.
        setIsLoading(false);
    }, []);

    return (
        <div className={`flex flex-col h-screen ${fontFamily} ${themeClasses.mainBg} ${themeClasses.text}`} style={{ fontSize: `${fontSize}px`, lineHeight }}>
            <WorkspaceTabs
                projects={openProjects}
                activeProjectId={activeProjectId}
                onSelectProject={setActiveProjectId}
                onCloseProject={handleCloseProject}
                onGoToDashboard={handleGoToDashboard}
            />

            <main className="flex-grow overflow-y-auto p-4 sm:p-6 lg:p-8">
                {activeProject ? (
                    <ProjectDisplay
                        projectData={activeProject}
                        onSentenceClick={(chapterIndex, sentenceIndex) => handleSentenceAnalysis(activeProject.id, chapterIndex, sentenceIndex)}
                        onSentenceDisplayModeChange={(chapterIndex, sentenceIndex, mode) => handleSentenceDisplayModeChange(activeProject.id, chapterIndex, sentenceIndex, mode)}
                        onVisibleRangeUpdate={(newRange) => handleVisibleRangeUpdate(activeProject.id, newRange)}
                        onPageSizeUpdate={(newSize) => handlePageSizeUpdate(activeProject.id, newSize)}
                        onChapterTranslate={(chapterIndex) => handleChapterTranslate(activeProject.id, chapterIndex)}
                        onChapterStopTranslate={(chapterIndex) => handleChapterStopTranslate(activeProject.id, chapterIndex)}
                        onChapterAnalyze={(chapterIndex) => handleChapterAnalyze(activeProject.id, chapterIndex)}
                        onChapterStopAnalyze={(chapterIndex) => handleChapterStopAnalyze(activeProject.id, chapterIndex)}
                        onChapterUpdate={(chapterIndex, newState) => handleChapterUpdate(activeProject.id, chapterIndex, newState)}
                        onChapterLoadContent={(chapterIndex) => handleLoadChapterContent(activeProject.id, chapterIndex)}
                        isApiBusy={isApiBusy}
                    />
                ) : (
                    <WorkspaceDashboard
                        projects={workspaceProjects}
                        onOpenProject={handleOpenProject}
                        onDeleteProject={handleDeleteProject}
                        onNewText={handleNewText}
                        onNewFile={handleNewFile}
                        onNewFromDrive={handleNewFromDrive}
                        onUploadRawFileToDrive={handleUploadRawFileToDrive}
                        isLoading={isLoading}
                        isLoggedIn={isLoggedIn}
                    />
                )}
            </main>

            {apiError && (
                <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-red-500 text-white px-6 py-3 rounded-lg shadow-lg z-50">
                    <p>{apiError}</p>
                    <button onClick={() => setApiError(null)} className="absolute top-1 right-1 text-white">&times;</button>
                </div>
            )}
            
            <footer className={`flex-shrink-0 p-2 border-t ${theme.border} ${theme.mainBg} flex justify-between items-center`}>
                <span className={`text-xs ${theme.mutedText}`}>Sản phẩm của Gemini</span>
                <div className="flex items-center gap-2">
                    <button onClick={() => setIsDataMgmtOpen(true)} title="Quản lý dữ liệu" className={`p-2 rounded-full ${theme.button.hoverBg}`}><ArchiveBoxIcon className="w-5 h-5" /></button>
                    <button onClick={() => setIsVocabOpen(true)} title="Từ điển cá nhân" className={`p-2 rounded-full ${theme.button.hoverBg}`}><BookOpenIcon className="w-5 h-5" /></button>
                    <button onClick={() => setIsSettingsOpen(true)} title="Cài đặt" className={`p-2 rounded-full ${theme.button.hoverBg}`}><SettingsIcon className="w-5 h-5" /></button>
                </div>
            </footer>

            <SettingsPanel isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
            
            <VocabularyModal
                isOpen={isVocabOpen}
                onClose={() => setIsVocabOpen(false)}
                vocabulary={vocabulary}
                onDelete={(term) => setVocabulary(v => v.filter(item => item.term !== term))}
                onToggleForceSino={(term) => setVocabulary(v => v.map(item => item.term === term ? {...item, isForceSino: !item.isForceSino} : item))}
                onUpdate={(originalTerm, updatedItem) => setVocabulary(v => v.map(item => item.term === originalTerm ? updatedItem : item))}
                onGoToLocation={handleGoToVocabLocation}
                onUnify={handleUnifyTranslations}
            />

            <DataManagementModal
                isOpen={isDataMgmtOpen}
                onClose={() => setIsDataMgmtOpen(false)}
                onExport={handleExport}
                onImport={handleImport}
                onClear={handleClearData}
                googleApiStatus={googleApiStatus}
                isLoggedIn={isLoggedIn}
                onLogin={handleLogin}
                onLogout={handleLogout}
            />
        </div>
    );
};


const AppWrapper: React.FC = () => (
    <SettingsProvider>
        <App />
    </SettingsProvider>
);

export default AppWrapper;
