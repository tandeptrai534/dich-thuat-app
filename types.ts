
export interface ApiError {
    message: string;
}

export type AnalysisState = 'pending' | 'loading' | 'done' | 'error';
export type DisplayMode = 'detailed-word' | 'grammar' | 'translation' | 'original';

export interface TranslationSegment {
    segment: string;
    grammarRole: GrammarRole;
}

export interface SpecialTerm {
    term: string;
    sinoVietnamese: string;
    vietnameseTranslation: string;
    category: ProperNounCategory;
    explanation: string;
}

export interface AnalyzedText {
    tokens: TokenData[];
    translation: string;
    specialTerms: SpecialTerm[];
    sentenceGrammarExplanation: string;
}

export interface SentenceData {
    original: string;
    sentenceNumber?: number;
    
    analysisState: AnalysisState;
    analysisResult?: AnalyzedText;
    analysisError?: string;
    
    translationState: AnalysisState;
    translation?: string;
    translationError?: string;
    
    displayMode?: DisplayMode;
    isTitle?: boolean;
}

export interface ChapterData {
    title: string;
    chapterNumber?: string;
    sentences: SentenceData[];
    isExpanded: boolean;
    partNumber?: number;
    totalParts?: number;

    isBatchTranslating?: boolean;
    batchTranslationProgress?: number;

    isBatchAnalyzing?: boolean;

    batchAnalysisProgress?: number; 
}

export interface ProcessedFile {
    id: number;
    fileName: string;
    originalContent: string;
    chapters: ChapterData[];
    visibleRange: {
        start: number;
        end: number;
    };
    pageSize: number;
    driveFileId?: string; // ID of the file on Google Drive
    lastModified: string;
    type: 'file' | 'text';
}

export interface WorkspaceItem {
    driveFileId: string;
    name: string;
    type: 'file' | 'text';
    lastModified: string;
}


// --- App Settings ---
export type Theme = 'light' | 'dark' | 'sepia';
export type FontSize = number;
export type FontFamily = 'font-sans' | 'font-serif' | 'font-mono';

export interface AppSettings {
    apiKey: string;
    fontSize: FontSize;
    hanziFontSize: FontSize;
    fontFamily: FontFamily;
    theme: Theme;
    lineHeight: number;
}

export enum GrammarRole { 
    UNKNOWN = 'Unknown',
    SUBJECT = 'Subject',
    PREDICATE = 'Predicate',
    OBJECT = 'Object',
    ADVERBIAL = 'Adverbial',
    COMPLEMENT = 'Complement',
    ATTRIBUTE = 'Attribute',
    PARTICLE = 'Particle',
    INTERJECTION = 'Interjection',
    CONJUNCTION = 'Conjunction',
    NUMERAL = 'Numeral',
    MEASURE_WORD = 'Measure Word',
}

export interface TokenData { 
    character: string;
    pinyin: string;
    sinoVietnamese: string;
    vietnameseMeaning: string;
    grammarRole: GrammarRole;
    grammarExplanation: string;
}

// --- Vocabulary Types ---
export type ProperNounCategory = 'Tên người' | 'Địa danh' | 'Công pháp' | 'Chiêu thức' | 'Vật phẩm' | 'Tổ chức' | 'Thành ngữ' | 'Tục ngữ' | 'Tiêu đề chương' | 'Khác';

export interface VocabularyLocation {
    chapterIndex: number;
    chapterTitle: string;
    sentenceNumber: number;
    originalSentence: string;
}

export interface VocabularyItem { 
    term: string; 
    sinoVietnamese: string; 
    vietnameseTranslation: string;
    category: ProperNounCategory;
    explanation: string;
    firstLocation: VocabularyLocation; 
    isForceSino: boolean; 
}
