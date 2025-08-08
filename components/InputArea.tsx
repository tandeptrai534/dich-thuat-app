

import React, { useState, useRef, useCallback } from 'react';
import { useSettings } from '@/contexts/settingsContext';
import { DocumentTextIcon, UploadIcon, GoogleIcon } from '@/components/common/icons';

interface InputAreaProps {
    onNewText: (text: string, fileName?: string) => void | Promise<void>;
    onNewFile: (text: string, fileName: string) => void | Promise<void>;
    onNewFromDrive: () => void;
    onUploadRawFileToDrive: (file: File) => void;
    isLoading: boolean;
    isLoggedIn: boolean;
}

export const InputArea: React.FC<InputAreaProps> = ({ onNewText, onNewFile, onNewFromDrive, onUploadRawFileToDrive, isLoading, isLoggedIn }) => {
    const { theme } = useSettings();
    const [text, setText] = useState('');
    const [saveToDrive, setSaveToDrive] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            if (isLoggedIn && saveToDrive) {
                onUploadRawFileToDrive(file);
            }
            
            const reader = new FileReader();
            reader.onload = (e) => {
                const fileContent = e.target?.result as string;
                onNewFile(fileContent, file.name);
            };
            reader.readAsText(file, 'UTF-8');
            // Reset the input's value to allow uploading the same file again
            event.target.value = '';
        }
    };
    
    const handleCreateProject = () => {
        if (text.trim()) {
            onNewText(text);
            setText(''); // Clear textarea after submission
        }
    };

    const handleUploadClick = () => {
        fileInputRef.current?.click();
    };

    return (
        <div className={`p-6 rounded-xl shadow-lg border ${theme.border} ${theme.cardBg}`}>
            <h2 className={`text-2xl font-bold mb-4 ${theme.text}`}>Tạo dự án mới</h2>
            <div className={`border-t ${theme.border} mb-4`}></div>
            <p className={`mb-4 ${theme.mutedText}`}>
                Dán trực tiếp văn bản vào ô bên dưới hoặc tải lên một tệp tin `.txt` để bắt đầu. Ứng dụng sẽ tự động tách các chương cho bạn.
            </p>
            <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Dán văn bản tiếng Trung của bạn vào đây..."
                className={`w-full p-3 border ${theme.border} rounded-lg shadow-inner focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${theme.mainBg} ${theme.text} min-h-[12rem]`}
                disabled={isLoading}
            />
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <button
                    onClick={handleCreateProject}
                    disabled={isLoading || !text.trim()}
                    className={`flex items-center justify-center gap-2 px-4 py-3 font-semibold rounded-lg shadow-sm transition-colors ${theme.primaryButton.bg} ${theme.primaryButton.text} ${theme.primaryButton.hoverBg} disabled:opacity-50 disabled:cursor-not-allowed lg:col-span-1`}
                >
                    <DocumentTextIcon className="w-5 h-5" />
                    Tạo từ văn bản
                </button>
                <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    className="hidden"
                    accept=".txt"
                    disabled={isLoading}
                />
                <button
                    onClick={handleUploadClick}
                    disabled={isLoading}
                    className={`flex items-center justify-center gap-2 px-4 py-3 font-semibold rounded-lg shadow-sm transition-colors ${theme.button.bg} ${theme.button.text} ${theme.button.hoverBg} border ${theme.border} disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                    <UploadIcon className="w-5 h-5" />
                    Tải lên tệp .txt
                </button>
                 <button
                    onClick={onNewFromDrive}
                    disabled={isLoading || !isLoggedIn}
                    className={`flex items-center justify-center gap-2 px-4 py-3 font-semibold rounded-lg shadow-sm transition-colors ${theme.button.bg} ${theme.button.text} ${theme.button.hoverBg} border ${theme.border} disabled:opacity-50 disabled:cursor-not-allowed`}
                    title={!isLoggedIn ? "Vui lòng đăng nhập Google để sử dụng" : "Tải lên tệp .txt từ Google Drive"}
                >
                    <GoogleIcon className="w-5 h-5" />
                    Tải từ Google Drive
                </button>
            </div>
            {isLoggedIn && (
                <div className="mt-4">
                    <label htmlFor="saveToDriveCheckbox" className="flex items-center gap-2 cursor-pointer w-fit">
                        <input
                            id="saveToDriveCheckbox"
                            type="checkbox"
                            checked={saveToDrive}
                            onChange={(e) => setSaveToDrive(e.target.checked)}
                            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className={`text-sm ${theme.mutedText}`}>
                            Khi tải lên từ máy, đồng thời lưu một bản sao của tệp gốc vào Google Drive.
                        </span>
                    </label>
                </div>
            )}
        </div>
    );
};
