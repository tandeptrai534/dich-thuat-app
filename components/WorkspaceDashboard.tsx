


import React, { useState } from 'react';
import type { WorkspaceItem } from '../types';
import { InputArea } from './InputArea';
import { useSettings } from '../contexts/settingsContext';
import { DocumentTextIcon, TrashIcon } from './common/icons';

interface WorkspaceDashboardProps {
    projects: WorkspaceItem[];
    onOpenProject: (project: WorkspaceItem) => void;
    onDeleteProject: (project: WorkspaceItem, deleteFromDrive: boolean) => void;
    onNewText: (text: string, fileName: string) => void;
    onNewFile: (text: string, fileName:string) => void;
    isLoading: boolean;
    isLoggedIn: boolean;
}

export const WorkspaceDashboard: React.FC<WorkspaceDashboardProps> = ({
    projects,
    onOpenProject,
    onDeleteProject,
    onNewText,
    onNewFile,
    isLoading,
    isLoggedIn
}) => {
    const { theme } = useSettings();
    const [projectToDelete, setProjectToDelete] = useState<WorkspaceItem | null>(null);

    const sortedProjects = [...projects].sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime());
    
    const timeAgo = (dateString: string) => {
        const date = new Date(dateString);
        const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);
        let interval = seconds / 31536000;
        if (interval > 1) return Math.floor(interval) + " năm trước";
        interval = seconds / 2592000;
        if (interval > 1) return Math.floor(interval) + " tháng trước";
        interval = seconds / 86400;
        if (interval > 1) return Math.floor(interval) + " ngày trước";
        interval = seconds / 3600;
        if (interval > 1) return Math.floor(interval) + " giờ trước";
        interval = seconds / 60;
        if (interval > 1) return Math.floor(interval) + " phút trước";
        return "vài giây trước";
    };

    const handleDeleteClick = (e: React.MouseEvent, project: WorkspaceItem) => {
        e.stopPropagation();
        setProjectToDelete(project);
    };

    const performDelete = (deleteFromDrive: boolean) => {
        if (projectToDelete) {
            onDeleteProject(projectToDelete, deleteFromDrive);
            setProjectToDelete(null);
        }
    };
    
    return (
        <div className="space-y-8">
            <h2 className={`text-2xl font-bold ${theme.text}`}>Không gian làm việc</h2>

            {/* Start New Work Area */}
            <InputArea
                onProcess={onNewText}
                onFileUpload={onNewFile}
                isLoading={isLoading}
                isLoggedIn={isLoggedIn}
            />

            {/* Existing Items List */}
            {sortedProjects.length > 0 && (
                <div className="space-y-4">
                    <h3 className={`text-xl font-semibold ${theme.text}`}>Dự án gần đây</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {sortedProjects.map(project => (
                            <div
                                key={project.driveFolderId}
                                onClick={() => onOpenProject(project)}
                                className={`p-4 rounded-lg border ${theme.border} ${theme.cardBg} hover:${theme.hoverBg} cursor-pointer transition-all flex flex-col justify-between group`}
                            >
                                <div className="flex-grow">
                                    <div className="flex items-start justify-between">
                                        <div className="flex items-center gap-3 min-w-0">
                                            <DocumentTextIcon className={`w-6 h-6 ${theme.mutedText}`} />
                                            <p className={`font-semibold ${theme.text} truncate`} title={project.name}>{project.name}</p>
                                        </div>
                                        <button 
                                            onClick={(e) => handleDeleteClick(e, project)}
                                            className={`p-1.5 rounded-full text-red-500/70 hover:bg-red-500/10 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity`}
                                        >
                                            <TrashIcon className="w-5 h-5"/>
                                        </button>
                                    </div>
                                </div>
                                <div className="mt-4 text-right">
                                    <p className={`text-xs ${theme.mutedText}`}>Cập nhật {timeAgo(project.lastModified)}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Delete Confirmation Modal */}
            {projectToDelete && (
                <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setProjectToDelete(null)}>
                    <div className={`p-6 rounded-lg shadow-xl ${theme.cardBg} w-full max-w-md`} onClick={e => e.stopPropagation()}>
                        <h3 className="text-lg font-bold">Xác nhận xóa dự án</h3>
                        <p className={`mt-2 text-sm ${theme.mutedText}`}>Bạn có chắc chắn muốn xóa vĩnh viễn dự án <strong className={theme.text}>"{projectToDelete.name}"</strong>?</p>
                        <p className={`mt-2 text-sm text-amber-600 dark:text-amber-400 font-semibold`}>Thao tác này sẽ xóa toàn bộ thư mục dự án và tất cả các tệp chương bên trong khỏi Google Drive của bạn. Hành động này không thể hoàn tác.</p>
                        <div className="mt-6 flex justify-end gap-3">
                             <button onClick={() => setProjectToDelete(null)} className={`px-4 py-2 ${theme.button.bg} ${theme.button.text} font-semibold rounded-md shadow-sm ${theme.button.hoverBg}`}>Hủy</button>
                             <button
                                onClick={() => performDelete(true)}
                                className={`px-4 py-2 bg-red-600 text-white font-semibold rounded-md shadow-sm hover:bg-red-700`}
                            >
                                Xóa vĩnh viễn
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
