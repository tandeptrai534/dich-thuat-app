
import React from 'react';
import { CloseIcon, PlusIcon, UploadIcon } from './common/icons';
import type { ProcessedFile } from '../types';
import { useSettings } from '../App';

interface WorkspaceTabsProps {
    files: ProcessedFile[];
    activeFileId: number | null;
    isLoggedIn: boolean;
    onSelectTab: (id: number) => void;
    onCloseTab: (id: number) => void;
    onAddNew: () => void;
    onSaveToDrive: (fileId: number) => void;
}

export const WorkspaceTabs: React.FC<WorkspaceTabsProps> = ({ files, activeFileId, isLoggedIn, onSelectTab, onCloseTab, onAddNew, onSaveToDrive }) => {
    const { theme } = useSettings();
    const activeFile = files.find(f => f.id === activeFileId);

    return (
        <div className={`flex items-center border-b ${theme.border}`}>
            <div className="flex-grow flex items-center overflow-x-auto">
                {files.map(file => {
                     const isActive = activeFileId === file.id;
                     const activeClasses = `border-blue-500 text-blue-600 ${theme.mainBg}`;
                     const inactiveClasses = `border-transparent ${theme.mutedText} hover:${theme.cardBg} hover:${theme.text}`;
                    return (
                        <button
                            key={file.id}
                            onClick={() => onSelectTab(file.id)}
                            className={`flex items-center gap-2 px-4 py-3 border-b-2 whitespace-nowrap transition-colors duration-200 ${
                                isActive ? activeClasses : inactiveClasses
                            }`}
                            title={file.fileName}
                        >
                            <span className="text-sm font-medium truncate max-w-40">{file.fileName}</span>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onCloseTab(file.id);
                                }}
                                className={`p-0.5 rounded-full ${isActive ? 'text-blue-400' : 'text-slate-400'} hover:bg-slate-300 dark:hover:bg-gray-600 hover:text-slate-600`}
                            >
                                <CloseIcon className="w-3.5 h-3.5" />
                            </button>
                        </button>
                    )
                })}
            </div>
             <div className="flex-shrink-0 ml-2 flex items-center gap-2">
                 {isLoggedIn && activeFile && !activeFile.isSyncedWithDrive && (
                    <button
                        onClick={() => onSaveToDrive(activeFile.id)}
                        className={`flex items-center gap-2 px-3 py-1.5 text-sm font-semibold rounded-md transition-colors ${theme.primaryButton.bg} ${theme.primaryButton.text} ${theme.primaryButton.hoverBg}`}
                        title="Lưu tệp này vào Google Drive"
                    >
                        <UploadIcon className="w-4 h-4" />
                        Lưu vào Drive
                    </button>
                 )}
                <button
                    onClick={onAddNew}
                    className={`flex items-center justify-center w-10 h-10 rounded-full ${theme.button.bg} ${theme.text} ${theme.button.hoverBg} transition-colors`}
                    title="Thêm tệp mới"
                >
                    <PlusIcon className="w-5 h-5" />
                </button>
            </div>
        </div>
    );
};