

import React from 'react';
import type { WorkspaceItem } from '@/types';
import { useSettings } from '@/contexts/settingsContext';
import { Spinner } from '@/components/common/Spinner';
import { InputArea } from '@/components/InputArea';
import { DocumentTextIcon, TrashIcon, GoogleIcon, CloudIcon, ComputerDesktopIcon } from '@/components/common/icons';

interface WorkspaceDashboardProps {
    projects: WorkspaceItem[];
    onOpenProject: (project: WorkspaceItem) => void;
    onDeleteProject: (project: WorkspaceItem) => void;
    onNewText: (text: string, fileName?: string) => void | Promise<void>;
    onNewFile: (text: string, fileName: string) => void | Promise<void>;
    onNewFromDrive: () => void;
    onUploadRawFileToDrive: (file: File) => void;
    isLoading: boolean;
    isLoggedIn: boolean;
}

export const WorkspaceDashboard: React.FC<WorkspaceDashboardProps> = ({
    projects,
    onOpenProject,
    onDeleteProject,
    onNewText,
    onNewFile,
    onNewFromDrive,
    onUploadRawFileToDrive,
    isLoading,
    isLoggedIn,
}) => {
    const { theme } = useSettings();

    const handleDelete = (e: React.MouseEvent, project: WorkspaceItem) => {
        e.stopPropagation();
        onDeleteProject(project);
    };

    return (
        <div className="max-w-4xl mx-auto w-full space-y-8">
            <InputArea 
                onNewText={onNewText} 
                onNewFile={onNewFile} 
                onNewFromDrive={onNewFromDrive}
                onUploadRawFileToDrive={onUploadRawFileToDrive}
                isLoading={isLoading} 
                isLoggedIn={isLoggedIn}
            />

            <div className={`p-6 rounded-xl shadow-lg border ${theme.border} ${theme.cardBg}`}>
                <h2 className={`text-2xl font-bold mb-4 ${theme.text}`}>Các dự án</h2>
                <div className={`border-t ${theme.border} mb-4`}></div>
                
                {!isLoggedIn && (
                    <div className="text-center py-4 px-4 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
                        <p className={`${theme.mutedText} text-sm`}>
                            <GoogleIcon className="w-8 h-8 mx-auto mb-2" />
                            Đăng nhập với Google để sao lưu, đồng bộ và truy cập dự án của bạn từ bất kỳ đâu.
                        </p>
                    </div>
                )}

                {isLoading && (
                    <div className="flex justify-center items-center py-8">
                        <Spinner variant={theme.mainBg.includes('dark') ? 'light' : 'dark'} />
                        <p className="ml-4">Đang tải...</p>
                    </div>
                )}
                
                {!isLoading && projects.length === 0 && (
                     <div className="text-center py-8">
                        <p className={theme.mutedText}>Không tìm thấy dự án nào.</p>
                        <p className={`text-sm ${theme.mutedText}`}>Hãy tạo một dự án mới ở trên để bắt đầu!</p>
                    </div>
                )}

                {!isLoading && projects.length > 0 && (
                    <ul className="space-y-3">
                        {projects.map((p) => (
                            <li
                                key={p.id}
                                onClick={() => onOpenProject(p)}
                                className={`flex justify-between items-center p-4 rounded-lg border ${theme.border} ${theme.hoverBg} cursor-pointer transition-colors`}
                            >
                                <div className="flex items-center min-w-0">
                                    {p.source === 'drive'
                                        ? <div title="Lưu trên Google Drive" className="w-6 h-6 mr-4 flex-shrink-0"><CloudIcon className={`text-blue-500 w-full h-full`} /></div>
                                        : <div title="Lưu trên máy này" className="w-6 h-6 mr-4 flex-shrink-0"><ComputerDesktopIcon className={`${theme.mutedText} w-full h-full`} /></div>
                                    }
                                    <div className="min-w-0">
                                        <p className={`font-semibold truncate ${theme.text}`}>{p.name}</p>
                                        <p className={`text-sm ${theme.mutedText}`}>
                                            Cập nhật lần cuối: {new Date(p.lastModified).toLocaleString()}
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={(e) => handleDelete(e, p)}
                                    className={`ml-4 p-2 rounded-full text-red-400 hover:bg-red-500/10 hover:text-red-600 transition-colors`}
                                    title="Xóa dự án"
                                >
                                    <TrashIcon className="w-5 h-5" />
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
};
