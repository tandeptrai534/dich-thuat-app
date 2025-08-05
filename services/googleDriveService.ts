// A service to interact with the Google Drive API.
// Handles finding the app's data file, creating it if it doesn't exist,
// and updating/reading its content.

const FOLDER_NAME = 'Trình Phân Tích Tiếng Trung AppData';

/**
 * Finds the ID of the app's dedicated folder in Google Drive.
 * Creates the folder if it doesn't exist.
 * @returns {Promise<string>} The ID of the folder.
 */
async function getOrCreateAppFolderId(): Promise<string> {
    // Search for the folder
    let response = await window.gapi.client.drive.files.list({
        q: `mimeType='application/vnd.google-apps.folder' and name='${FOLDER_NAME}' and trashed=false`,
        fields: 'files(id, name)',
    });

    if (response.result.files && response.result.files.length > 0) {
        return response.result.files[0].id!;
    } else {
        // Create the folder if it doesn't exist
        const fileMetadata = {
            'name': FOLDER_NAME,
            'mimeType': 'application/vnd.google-apps.folder'
        };
        response = await window.gapi.client.drive.files.create({
            resource: fileMetadata,
            fields: 'id'
        });
        return response.result.id!;
    }
}


/**
 * Finds the ID of a file by its name within the app's folder.
 * @param {string} folderId The ID of the app's folder.
 * @param {string} fileName The name of the file to find.
 * @returns {Promise<string|null>} The ID of the file, or null if not found.
 */
async function findFileIdByName(folderId: string, fileName: string): Promise<string | null> {
    try {
        const response = await window.gapi.client.drive.files.list({
            q: `'${folderId}' in parents and name='${fileName}' and trashed=false`,
            fields: 'files(id)',
            pageSize: 1
        });

        if (response.result.files && response.result.files.length > 0) {
            return response.result.files[0].id!;
        }
        return null;
    } catch (error) {
        console.error(`Error finding file '${fileName}' in Drive:`, error);
        throw new Error(`Không thể tìm thấy tệp '${fileName}' trong Google Drive.`);
    }
}

/**
 * Saves a JSON object to a specified file in the app's Drive folder.
 * Creates the file if it doesn't exist, otherwise updates it.
 * @param {string} fileName The name of the file (e.g., 'data.json' or 'fileId.cache.json').
 * @param {any} data The JSON-serializable data to save.
 */
export async function saveJsonFileInAppFolder(fileName: string, data: any): Promise<void> {
    const content = JSON.stringify(data);
    const blob = new Blob([content], { type: 'application/json' });
    
    const folderId = await getOrCreateAppFolderId();
    const fileId = await findFileIdByName(folderId, fileName);

    const fileMetadata: {
        name: string;
        mimeType: string;
        parents?: string[];
    } = {
        name: fileName,
        mimeType: 'application/json',
    };
    
    const form = new FormData();

    if (fileId) {
        // File exists, update it
        form.append('metadata', new Blob([JSON.stringify({})], { type: 'application/json' }));
        form.append('file', blob);
        
        await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`, {
            method: 'PATCH',
            headers: new Headers({ 'Authorization': `Bearer ${window.gapi.client.getToken().access_token}` }),
            body: form
        });

    } else {
        // File does not exist, create it
        fileMetadata.parents = [folderId];
        form.append('metadata', new Blob([JSON.stringify(fileMetadata)], { type: 'application/json' }));
        form.append('file', blob);

         await fetch(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`, {
            method: 'POST',
            headers: new Headers({ 'Authorization': `Bearer ${window.gapi.client.getToken().access_token}` }),
            body: form
        });
    }
}

/**
 * Loads and parses a JSON file from the app's Drive folder.
 * @param {string} fileName The name of the file to load.
 * @returns {Promise<any|null>} The parsed JSON data, or null if the file doesn't exist.
 */
export async function loadJsonFileFromAppFolder(fileName: string): Promise<any | null> {
    const folderId = await getOrCreateAppFolderId();
    const fileId = await findFileIdByName(folderId, fileName);

    if (!fileId) {
        return null; // File doesn't exist yet
    }

    try {
        const response = await window.gapi.client.drive.files.get({
            fileId: fileId,
            alt: 'media'
        });
        return response.result;
    } catch (error) {
        console.error(`Error loading file '${fileName}' from Drive:`, error);
        throw new Error(`Không thể tải dữ liệu cho tệp '${fileName}' từ Google Drive.`);
    }
}

/**
 * Deletes a file from the app's Drive folder by its name.
 * @param {string} fileName The name of the file to delete.
 * @returns {Promise<void>}
 */
export async function deleteJsonFileInAppFolder(fileName: string): Promise<void> {
    const folderId = await getOrCreateAppFolderId();
    const fileId = await findFileIdByName(folderId, fileName);

    if (fileId) {
        try {
            await window.gapi.client.drive.files.delete({
                fileId: fileId
            });
        } catch (error) {
            console.error(`Error deleting file '${fileName}' from Drive:`, error);
            // Don't throw, as it might not be critical if a cache file fails to delete
        }
    }
}


/**
 * Fetches the text content of a file from Google Drive.
 * @param fileId The ID of the file.
 * @param mimeType The MIME type of the file.
 * @returns A promise that resolves with the text content of the file.
 */
export async function fetchFileContent(fileId: string, mimeType?: string): Promise<string> {
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

/**
 * Creates a new text file in the app's Google Drive folder.
 * @param fileName The name for the new file.
 * @param content The text content of the file.
 * @returns {Promise<string>} The ID of the newly created file.
 */
export async function createFileInDrive(fileName: string, content: string): Promise<string> {
    const folderId = await getOrCreateAppFolderId();

    const fileMetadata = {
        name: fileName,
        mimeType: 'text/plain',
        parents: [folderId],
    };

    const blob = new Blob([content], { type: 'text/plain' });
    const form = new FormData();
    const metadataBlob = new Blob([JSON.stringify(fileMetadata)], { type: 'application/json' });
    form.append('metadata', metadataBlob);
    form.append('file', blob);

    const response = await fetch(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`, {
        method: 'POST',
        headers: new Headers({ 'Authorization': `Bearer ${window.gapi.client.getToken().access_token}` }),
        body: form
    });
    
    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`Không thể tạo tệp trên Drive: ${errorData.error?.message || response.statusText}`);
    }

    const result = await response.json();
    return result.id;
}


/**
 * Deletes a file from Google Drive permanently by its ID.
 * @param {string} fileId The ID of the file to delete.
 * @returns {Promise<void>}
 */
export async function deleteFileFromDrive(fileId: string): Promise<void> {
    try {
        await window.gapi.client.drive.files.delete({
            fileId: fileId
        });
    } catch (error) {
        console.error("Error deleting file from Drive:", error);
        throw new Error("Không thể xóa tệp khỏi Google Drive.");
    }
}