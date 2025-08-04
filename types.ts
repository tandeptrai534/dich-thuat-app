
export interface ApiError {
    message: string;
}

export type AnalysisState = 'pending' | 'loading' | 'done' | 'error';

export interface TranslationSegment {
    segment: string;
    grammarRole: GrammarRole;
}

export interface AnalyzedText {
    tokens: TokenData[];
    translation: TranslationSegment[];
}

export interface SentenceData {
    original: string;
    
    // For detailed, on-demand grammatical analysis
    analysisState: AnalysisState;
    analysisResult?: AnalyzedText;
    analysisError?: string;
    
    // For simple, batch translation
    translationState: AnalysisState;
    translation?: string;
    translationError?: string;
    
    isExpanded: boolean;
    isTitle?: boolean;
}

export interface ChapterData {
    title: string;
    chapterNumber?: string; // Stores the detected chapter number from the original text
    sentences: SentenceData[];
    isExpanded: boolean;

    // For batch translation process
    isBatchTranslating?: boolean;
    batchTranslationProgress?: number; // A value between 0 and 1
}

export interface ProcessedFile {
    id: number;
    fileName: string;
    chapters: ChapterData[];
    visibleRange: {
        start: number;
        end: number;
    };
    pageSize: number;
    vocabProcessingChunkIndex: number;
}

// --- App Settings ---
export type Theme = 'light' | 'dark' | 'sepia';
export type FontSize = number;
export type FontFamily = 'font-sans' | 'font-serif' | 'font-mono';

export interface AppSettings {
    apiKey: string;
    fontSize: FontSize;
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
export type VocabularyItemAnalysisState = 'pending' | 'loading' | 'done' | 'error';

export type ProperNounCategory = 'Tên người' | 'Địa danh' | 'Công pháp' | 'Chiêu thức' | 'Vật phẩm' | 'Tổ chức' | 'Thành ngữ' | 'Tục ngữ' | 'Ngữ pháp' | 'Khác';

export interface ProperNounAnalysisAPIResult {
    term: string;
    hanViet: string;
    category: ProperNounCategory;
    explanation: string;
}

export interface VocabularyItem { 
    term: string; // The Chinese term
    contextSentence?: string; // Longest sentence containing the term for context
    
    // For proper noun analysis
    analysisState: VocabularyItemAnalysisState;
    hanViet?: string;
    category?: ProperNounCategory;
    explanation?: string;
    analysisError?: string;
    
    // Enriched data from sentence analysis
    grammarRole?: GrammarRole;
    grammarExplanation?: string;
    vietnameseMeaning?: string;
}


// Kept for compatibility with unused components if any remain
export type AnalysisScope = 'CHUNK' | 'CHAPTER' | 'FULL_TEXT';
