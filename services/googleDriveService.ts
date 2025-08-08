

import type { WorkspaceItem, DriveFile } from "../types";

const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';

/**
 * Finds a folder by name in the user's Drive root.
 * @param name The name of the folder to find.
 * @returns The folder ID if found, otherwise null.
 */
const findFolderByName = async (name: string): Promise<string | null> => {
    try {
        const response = await window.gapi.client.drive.files.list({
            q: `mimeType='${FOLDER_MIME_TYPE}' and name='${name}' and 'root' in parents and trashed=false`,
            fields: 'files(id, name)',
            spaces: 'drive',
        });
        const files = response.result.files;
        return files && files.length > 0 ? files[0].id : null;
    } catch (error) {
        console.error('Error finding folder by name:', error);
        throw error;
    }
};

/**
 * Creates a new folder in the user's Drive root.
 * @param name The name of the folder to create.
 * @returns The ID of the newly created folder.
 */
const createFolder = async (name: string): Promise<string> => {
    try {
        const fileMetadata = {
            'name': name,
            'mimeType': FOLDER_MIME_TYPE
        };
        const response = await window.gapi.client.drive.files.create({
            resource: fileMetadata,
            fields: 'id'
        });
        return response.result.id;
    } catch (error) {
        console.error('Error creating folder:', error);
        throw error;
    }
};

/**
 * Gets the ID of the app's main data folder, creating it if it doesn't exist.
 * @param appFolderName The name of the application's data folder.
 * @returns The ID of the app data folder.
 */
export const getOrCreateAppFolderId = async (appFolderName: string): Promise<string> => {
    let folderId = await findFolderByName(appFolderName);
    if (!folderId) {
        folderId = await createFolder(appFolderName);
    }
    return folderId;
};

/**
 * Lists all non-trashed folders in the app's data folder.
 * These are considered the "projects".
 * @returns A promise that resolves to an array of WorkspaceItem objects.
 */
export const listProjectFolders = async (): Promise<WorkspaceItem[]> => {
    const appFolderId = await findFolderByName('Trình Phân Tích Tiếng Trung Projects');
    if (!appFolderId) {
        await createFolder('Trình Phân Tích Tiếng Trung Projects');
        return [];
    }

    try {
        const response = await window.gapi.client.drive.files.list({
            q: `'${appFolderId}' in parents and mimeType='${FOLDER_MIME_TYPE}' and trashed=false`,
            fields: 'files(id, name, modifiedTime)',
            orderBy: 'modifiedTime desc',
            pageSize: 100
        });

        const files = response.result.files as DriveFile[];
        return files.map(file => ({
            id: file.id,
            driveFolderId: file.id,
            name: file.name,
            lastModified: file.modifiedTime,
            type: 'file',
            source: 'drive',
        }));
    } catch (error) {
        console.error('Error listing project folders:', error);
        return [];
    }
};

/**
 * Creates a new folder within the main projects folder.
 * @param name Name of the new project folder.
 * @returns The ID of the newly created folder.
 */
export const createProjectFolder = async (name: string): Promise<string> => {
    const projectsRootId = await getOrCreateAppFolderId('Trình Phân Tích Tiếng Trung Projects');
    try {
        const fileMetadata = {
            name,
            mimeType: FOLDER_MIME_TYPE,
            parents: [projectsRootId],
        };
        const response = await window.gapi.client.drive.files.create({
            resource: fileMetadata,
            fields: 'id'
        });
        return response.result.id;
    } catch (error) {
        console.error('Error creating project folder:', error);
        throw error;
    }
};

/**
 * Moves a folder to the trash.
 * @param folderId The ID of the folder to delete.
 */
export const deleteFolder = async (folderId: string): Promise<void> => {
    try {
        await window.gapi.client.drive.files.update({
            fileId: folderId,
            resource: { trashed: true }
        });
    } catch (error) {
        console.error('Error deleting folder:', error);
        throw error;
    }
};


/**
 * Lists all non-trashed files within a specific folder.
 * @param folderId The ID of the parent folder.
 * @returns A promise resolving to an array of file metadata.
 */
export const listFilesInFolder = async (folderId: string): Promise<DriveFile[]> => {
    try {
        let files: DriveFile[] = [];
        let pageToken: string | undefined = undefined;
        do {
            const response = await window.gapi.client.drive.files.list({
                q: `'${folderId}' in parents and trashed=false`,
                fields: 'nextPageToken, files(id, name, mimeType, modifiedTime)',
                pageSize: 1000,
                pageToken: pageToken
            });
            if (response.result.files) {
                files = files.concat(response.result.files);
            }
            pageToken = response.result.nextPageToken;
        } while (pageToken);

        return files;
    } catch (error) {
        console.error(`Error listing files in folder ${folderId}:`, error);
        return [];
    }
};


/**
 * Saves or updates a file within a specific folder.
 * @param folderId The ID of the parent folder.
 * @param fileName The name of the file.
 * @param content The content to save (string or object).
 * @param mimeType The MIME type of the file.
 */
export const saveFileInFolder = async (folderId: string, fileName: string, content: any, mimeType: string): Promise<void> => {
    try {
        const existingFiles = await listFilesInFolder(folderId);
        const existingFile = existingFiles.find(f => f.name === fileName);

        const contentToUpload = typeof content === 'string' ? content : JSON.stringify(content);
        const blob = new Blob([contentToUpload], { type: mimeType });
        const form = new FormData();

        if (existingFile) { // Update existing file
            const metadata = { name: fileName, mimeType };
            form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
            form.append('file', blob);

            await fetch(`https://www.googleapis.com/upload/drive/v3/files/${existingFile.id}?uploadType=multipart`, {
                method: 'PATCH',
                headers: new Headers({ 'Authorization': `Bearer ${window.gapi.client.getToken().access_token}` }),
                body: form
            });
        } else { // Create new file
            const metadata = { name: fileName, mimeType, parents: [folderId] };
            form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
            form.append('file', blob);
            
            await fetch(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`, {
                method: 'POST',
                headers: new Headers({ 'Authorization': `Bearer ${window.gapi.client.getToken().access_token}` }),
                body: form
            });
        }
    } catch (error) {
        console.error(`Error saving file "${fileName}":`, error);
        throw error;
    }
};

/**
 * Loads the content of a file from Google Drive.
 * @param fileId The ID of the file to load.
 * @returns The content of the file, parsed as JSON if possible.
 */
export const loadFileContent = async (fileId: string): Promise<any> => {
    try {
        const response = await window.gapi.client.drive.files.get({
            fileId: fileId,
            alt: 'media'
        });
        // Try to parse as JSON, otherwise return as text
        try {
            return JSON.parse(response.body);
        } catch (e) {
            return response.body;
        }
    } catch (error) {
        console.error(`Error loading file content for ${fileId}:`, error);
        throw error;
    }
};

/**
 * Uploads a raw file object to the user's root Drive folder.
 * @param file The File object to upload.
 * @returns The ID of the created file.
 */
export const uploadRawFile = async (file: File): Promise<string> => {
    try {
        const oauthToken = window.gapi.client.getToken()?.access_token;
        if (!oauthToken) {
            throw new Error("Missing Google authentication token.");
        }

        const metadata = {
            name: file.name,
            mimeType: file.type || 'text/plain',
            parents: ['root'] // Upload to the root "My Drive" folder
        };

        const form = new FormData();
        form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
        form.append('file', file);

        const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
            method: 'POST',
            headers: new Headers({ 'Authorization': `Bearer ${oauthToken}` }),
            body: form
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error?.message || 'Unknown Google Drive API error');
        }
        
        const responseData = await response.json();
        return responseData.id;

    } catch (error) {
        console.error('Error uploading raw file to Drive:', error);
        throw error; // Re-throw to be handled by the caller
    }
};
