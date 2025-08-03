
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
    analysisState: AnalysisState;
    analysisResult?: AnalyzedText;
    error?: string;
    isExpanded: boolean;
}

export interface ChapterData {
    title: string;
    sentences: SentenceData[];
    translationState: AnalysisState;
    translationResult?: string;
    translationError?: string;
    isExpanded: boolean;
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
}

// --- App Settings ---
export type Theme = 'light' | 'dark' | 'sepia';
export type FontSize = number;
export type FontFamily = 'font-sans' | 'font-serif' | 'font-mono';

export interface AppSettings {
    fontSize: FontSize;
    fontFamily: FontFamily;
    theme: Theme;
    apiKey: string;
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

// Kept for compatibility with unused components if any remain
export type AnalysisScope = 'CHUNK' | 'CHAPTER' | 'FULL_TEXT';