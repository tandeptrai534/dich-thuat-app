// A service to interact with the Google Drive API.
// Handles finding the app's data file, creating it if it doesn't exist,
// and updating/reading its content.

const FILE_NAME = 'trinh-phan-tich-data.json';
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
 * Finds the ID of the app's data file within the app's folder.
 * @param {string} folderId The ID of the app's folder.
 * @returns {Promise<string|null>} The ID of the file, or null if not found.
 */
async function findFileId(folderId: string): Promise<string | null> {
    try {
        const response = await window.gapi.client.drive.files.list({
            q: `'${folderId}' in parents and name='${FILE_NAME}' and trashed=false`,
            fields: 'files(id)',
            pageSize: 1
        });

        if (response.result.files && response.result.files.length > 0) {
            return response.result.files[0].id!;
        }
        return null;
    } catch (error) {
        console.error("Error finding file in Drive:", error);
        throw new Error("Không thể tìm thấy tệp trong Google Drive.");
    }
}

/**
 * Saves the application data to a file in Google Drive.
 * Creates the file if it doesn't exist, otherwise updates it.
 * @param {any} data The application data to save.
 */
export async function saveDataToDrive(data: any): Promise<void> {
    const content = JSON.stringify(data);
    const blob = new Blob([content], { type: 'application/json' });
    
    const folderId = await getOrCreateAppFolderId();
    const fileId = await findFileId(folderId);

    const fileMetadata: {
        name: string;
        mimeType: string;
        parents?: string[];
    } = {
        name: FILE_NAME,
        mimeType: 'application/json',
    };
    
    const form = new FormData();

    if (fileId) {
        // File exists, update it
        const metadataBlob = new Blob([JSON.stringify({})], { type: 'application/json' });
        form.append('metadata', metadataBlob);
        form.append('file', blob);
        
        await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`, {
            method: 'PATCH',
            headers: new Headers({ 'Authorization': `Bearer ${window.gapi.client.getToken().access_token}` }),
            body: form
        });

    } else {
        // File does not exist, create it
        fileMetadata.parents = [folderId];
        const metadataBlob = new Blob([JSON.stringify(fileMetadata)], { type: 'application/json' });
        form.append('metadata', metadataBlob);
        form.append('file', blob);

         await fetch(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`, {
            method: 'POST',
            headers: new Headers({ 'Authorization': `Bearer ${window.gapi.client.getToken().access_token}` }),
            body: form
        });
    }
}

/**
 * Loads the application data from the file in Google Drive.
 * @returns {Promise<any|null>} The parsed application data, or null if the file doesn't exist.
 */
export async function loadDataFromDrive(): Promise<any | null> {
    const folderId = await getOrCreateAppFolderId();
    const fileId = await findFileId(folderId);

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
        console.error("Error loading data from Drive:", error);
        throw new Error("Không thể tải dữ liệu từ Google Drive.");
    }
}
