
// This file provides type definitions for Vite's `import.meta.env` feature.
// By defining the ImportMeta interface, we inform TypeScript about the
// shape of the environment variables, resolving type-related errors.

interface ImportMetaEnv {
  /**
   * The Google Client ID for OAuth and Google Drive integration.
   */
  readonly VITE_GOOGLE_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
