
import React, { useRef, useState } from 'react';
import { Spinner } from './common/Spinner';
import { GoogleIcon, UploadIcon } from './common/icons';
import { useSettings } from '../App';

interface InputAreaProps {
    onProcess: (text: string, fileName: string) => void;
    onFileUpload?: (text: string, fileName: string) => void;
    isLoading: boolean;
    isLoggedIn: boolean;
    onOpenDrive?: () => void;
}

export const InputArea: React.FC<InputAreaProps> = ({ onProcess, onFileUpload, isLoading, isLoggedIn, onOpenDrive }) => {
    const [inputText, setInputText] = useState<string>('');
    const fileInputRef = useRef<HTMLInputElement>(null);
    const { theme } = useSettings();

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                const text = e.target?.result as string;
                if (onFileUpload) {
                    onFileUpload(text, file.name);
                } else {
                    onProcess(text, file.name);
                }
            };
            reader.onerror = () => {
                alert('Lỗi: Không thể đọc tệp.');
            };
            reader.readAsText(file, 'UTF-8');
             // Reset file input to allow uploading the same file again
            event.target.value = '';
        }
    };

    const handleUploadClick = () => {
        fileInputRef.current?.click();
    };

    const handleProcessClick = () => {
        onProcess(inputText, `Văn bản dán - ${new Date().toLocaleString()}`);
    };
    
    return (
        <div className={`${theme.cardBg} p-6 rounded-2xl shadow-lg border ${theme.border}`}>
            <div className="flex flex-col gap-4">
                <h2 className={`text-lg font-semibold ${theme.text}`}>Bắt đầu bằng cách nhập văn bản hoặc tải lên tệp</h2>
                
                <div className="relative">
                    <textarea
                        value={inputText}
                        onChange={(e) => setInputText(e.target.value)}
                        placeholder="Dán văn bản tiếng Trung vào đây..."
                        className={`w-full h-48 p-4 border ${theme.border} rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-shadow resize-y shadow-sm ${theme.cardBg} ${theme.text}`}
                        disabled={isLoading}
                    />
                </div>
                <div className="flex flex-col sm:flex-row gap-3">
                    <button
                        onClick={handleProcessClick}
                        disabled={isLoading || !inputText.trim()}
                        className={`w-full sm:w-auto flex-grow flex items-center justify-center px-6 py-3 ${theme.primaryButton.bg} ${theme.primaryButton.text} font-bold rounded-lg shadow-md ${theme.primaryButton.hoverBg} disabled:bg-slate-400 disabled:cursor-not-allowed transition-all transform hover:scale-105 disabled:scale-100`}
                    >
                        {isLoading ? (
                            <>
                                <Spinner />
                                <span className="ml-2">Đang xử lý...</span>
                            </>
                        ) : (
                            'Xử lý Văn bản'
                        )}
                    </button>
                    <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileChange}
                        className="hidden"
                        accept=".txt,.doc,.docx"
                        disabled={isLoading}
                    />
                    <button
                        onClick={handleUploadClick}
                        disabled={isLoading}
                        className={`w-full sm:w-auto flex items-center justify-center px-4 py-3 border ${theme.border} ${theme.cardBg} ${theme.text} font-semibold rounded-lg shadow-sm ${theme.hoverBg} disabled:bg-slate-200 disabled:cursor-not-allowed transition-colors`}
                    >
                        <UploadIcon className="w-5 h-5 mr-2" />
                        Tải lên tệp .txt
                    </button>
                    {isLoggedIn && onOpenDrive && (
                        <button
                            onClick={onOpenDrive}
                            disabled={isLoading}
                            className={`w-full sm:w-auto flex items-center justify-center px-4 py-3 border ${theme.border} ${theme.cardBg} ${theme.text} font-semibold rounded-lg shadow-sm ${theme.hoverBg} disabled:opacity-50 disabled:cursor-not-allowed transition-colors`}
                            title="Mở tệp từ Google Drive"
                        >
                            <GoogleIcon className="w-5 h-5 mr-2" />
                            Mở từ Drive
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};
