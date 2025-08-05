// A service to interact with the Google Drive API.
// Handles creating project folders and managing files within them.

const APP_DATA_FOLDER_NAME = 'Trình Phân Tích Tiếng Trung AppData';

let appFolderIdCache: string | null = null;

/**
 * Finds the ID of the app's dedicated folder in Google Drive.
 * Creates the folder if it doesn't exist. Caches the ID for the session.
 * @returns {Promise<string>} The ID of the folder.
 */
export async function getOrCreateAppFolderId(): Promise<string> {
    if (appFolderIdCache) {
        return appFolderIdCache;
    }

    const query = `mimeType='application/vnd.google-apps.folder' and name='${APP_DATA_FOLDER_NAME}' and trashed=false`;
    
    let response = await window.gapi.client.drive.files.list({
        q: query,
        fields: 'files(id, name)',
    });

    if (response.result.files && response.result.files.length > 0) {
        appFolderIdCache = response.result.files[0].id!;
        return appFolderIdCache;
    } else {
        const fileMetadata = {
            'name': APP_DATA_FOLDER_NAME,
            'mimeType': 'application/vnd.google-apps.folder'
        };
        response = await window.gapi.client.drive.files.create({
            resource: fileMetadata,
            fields: 'id'
        });
        appFolderIdCache = response.result.id!;
        return appFolderIdCache;
    }
}

/**
 * Creates a new folder for a project within the main app data folder.
 * @param projectName The name of the project, which will be the folder name.
 * @returns The ID of the newly created folder.
 */
export async function createProjectFolder(projectName: string): Promise<string> {
    const parentFolderId = await getOrCreateAppFolderId();
    const folderMetadata = {
        name: projectName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentFolderId]
    };
    const response = await window.gapi.client.drive.files.create({
        resource: folderMetadata,
        fields: 'id'
    });
    return response.result.id!;
}

/**
 * Saves or updates a file within a specific Drive folder.
 * @param folderId The ID of the parent folder.
 * @param fileName The name of the file.
 * @param content The content to save.
 * @param mimeType The MIME type of the file.
 * @returns The ID of the created/updated file.
 */
export async function saveFileInFolder(folderId: string, fileName: string, content: any, mimeType: string): Promise<string> {
    // Check if file exists first
    const listResponse = await window.gapi.client.drive.files.list({
        q: `'${folderId}' in parents and name='${fileName}' and trashed=false`,
        fields: 'files(id)',
        pageSize: 1
    });

    const fileId = listResponse.result.files && listResponse.result.files.length > 0
        ? listResponse.result.files[0].id!
        : null;
    
    const contentString = typeof content === 'string' ? content : JSON.stringify(content);
    const blob = new Blob([contentString], { type: mimeType });
    const form = new FormData();

    if (fileId) { // File exists, update (PATCH)
        form.append('metadata', new Blob([JSON.stringify({})], { type: 'application/json' }));
        form.append('file', blob);

        await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`, {
            method: 'PATCH',
            headers: new Headers({ 'Authorization': `Bearer ${window.gapi.client.getToken().access_token}` }),
            body: form
        });
        return fileId;
    } else { // File doesn't exist, create (POST)
        const metadata = {
            name: fileName,
            mimeType: mimeType,
            parents: [folderId]
        };
        form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
        form.append('file', blob);

        const createResponse = await fetch(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`, {
            method: 'POST',
            headers: new Headers({ 'Authorization': `Bearer ${window.gapi.client.getToken().access_token}` }),
            body: form
        });
        const result = await createResponse.json();
        return result.id;
    }
}

/**
 * Lists all files within a specific folder.
 * @param folderId The ID of the folder to list files from.
 * @returns A list of file objects with id, name and mimeType.
 */
export async function listFilesInFolder(folderId: string): Promise<{ id: string; name: string; mimeType: string; }[]> {
    const files: { id: string; name: string; mimeType: string; }[] = [];
    let pageToken: string | undefined = undefined;
    
    do {
        const response = await window.gapi.client.drive.files.list({
            q: `'${folderId}' in parents and trashed=false`,
            fields: 'nextPageToken, files(id, name, mimeType)',
            pageSize: 200,
            pageToken: pageToken
        });
        
        if (response.result.files) {
            files.push(...response.result.files as any);
        }
        pageToken = response.result.nextPageToken;
    } while (pageToken);
    
    return files;
}

/**
 * Fetches the content of a file from Google Drive by its ID.
 * @param fileId The ID of the file.
 * @returns The text content of the file.
 */
export async function loadFileContent(fileId: string): Promise<any> {
     try {
        const response = await window.gapi.client.drive.files.get({
            fileId: fileId,
            alt: 'media'
        });
        // GAPI client might parse JSON automatically. If not, we try.
        if (typeof response.result === 'object') {
            return response.result;
        }
        try {
            return JSON.parse(response.body);
        } catch (e) {
            return response.body; // Return as text if not valid JSON
        }
    } catch (error) {
        console.error(`Error loading file content for ID '${fileId}':`, error);
        return null;
    }
}


/**
 * Lists all project folders within the main app data folder.
 * @returns A promise that resolves to an array of WorkspaceItem-like objects.
 */
export async function listProjectFolders(): Promise<{ driveFolderId: string; name: string; lastModified: string; }[]> {
    const appFolderId = await getOrCreateAppFolderId();
    const query = `'${appFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    
    const response = await window.gapi.client.drive.files.list({
        q: query,
        fields: 'files(id, name, modifiedTime)',
        orderBy: 'modifiedTime desc',
        pageSize: 100
    });

    if (!response.result.files) return [];
    
    return response.result.files.map(file => ({
        driveFolderId: file.id!,
        name: file.name!,
        lastModified: file.modifiedTime!
    }));
}


/**
 * Deletes a folder and all its contents from Google Drive.
 * @param folderId The ID of the folder to delete.
 */
export async function deleteFolder(folderId: string): Promise<void> {
    await window.gapi.client.drive.files.delete({
        fileId: folderId
    });
}


/**
 * Fetches the text content of a file from Google Drive for the picker.
 * @param fileId The ID of the file.
 * @param mimeType The MIME type of the file.
 * @returns A promise that resolves with the text content of the file.
 */
export async function fetchFileContentForPicker(fileId: string, mimeType?: string): Promise<string> {
    try {
        if (mimeType === 'application/vnd.google-apps.document') {
            const accessToken = window.gapi.client.getToken()?.access_token;
            if (!accessToken) throw new Error("Token truy cập không hợp lệ.");
            
            const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(`Lỗi xuất Google Doc: ${errorData.error?.message || response.statusText}`);
            }
            return await response.text();
        } else {
            // Assume plain text for others
            const response = await window.gapi.client.drive.files.get({
                fileId: fileId,
                alt: 'media'
            });
            return response.body;
        }
    } catch (error) {
        console.error("Lỗi khi lấy nội dung tệp từ Drive:", error);
        if (error instanceof Error) {
            throw new Error(`Không thể lấy nội dung tệp: ${error.message}`);
        }
        throw new Error("Lỗi không xác định khi lấy nội dung tệp.");
    }
}