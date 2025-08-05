
import React, { useState } from 'react';
import type { WorkspaceItem } from '../types';
import { InputArea } from './InputArea';
import { useSettings } from '../App';
import { DocumentTextIcon, TrashIcon } from './common/icons';

interface WorkspaceDashboardProps {
    items: WorkspaceItem[];
    onOpenItem: (item: WorkspaceItem) => void;
    onDeleteItem: (item: WorkspaceItem, deleteFromDrive: boolean) => void;
    onNewText: (text: string, fileName: string) => void;
    onNewFile: (text: string, fileName: string) => void;
    onOpenDrivePicker: () => void;
    isLoading: boolean;
}

export const WorkspaceDashboard: React.FC<WorkspaceDashboardProps> = ({
    items,
    onOpenItem,
    onDeleteItem,
    onNewText,
    onNewFile,
    onOpenDrivePicker,
    isLoading
}) => {
    const { theme } = useSettings();
    const [itemToDelete, setItemToDelete] = useState<WorkspaceItem | null>(null);

    const sortedItems = [...items].sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime());
    
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

    const handleDeleteClick = (e: React.MouseEvent, item: WorkspaceItem) => {
        e.stopPropagation();
        setItemToDelete(item);
    };

    const performDelete = (deleteFromDrive: boolean) => {
        if (itemToDelete) {
            onDeleteItem(itemToDelete, deleteFromDrive);
            setItemToDelete(null);
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
                isLoggedIn={true}
                onOpenDrive={onOpenDrivePicker}
            />

            {/* Existing Items List */}
            {sortedItems.length > 0 && (
                <div className="space-y-4">
                    <h3 className={`text-xl font-semibold ${theme.text}`}>Dự án gần đây</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {sortedItems.map(item => (
                            <div
                                key={item.driveFileId}
                                onClick={() => onOpenItem(item)}
                                className={`p-4 rounded-lg border ${theme.border} ${theme.cardBg} hover:${theme.hoverBg} cursor-pointer transition-all flex flex-col justify-between group`}
                            >
                                <div className="flex-grow">
                                    <div className="flex items-start justify-between">
                                        <div className="flex items-center gap-3 min-w-0">
                                            <DocumentTextIcon className={`w-6 h-6 ${theme.mutedText}`} />
                                            <p className={`font-semibold ${theme.text} truncate`} title={item.name}>{item.name}</p>
                                        </div>
                                        <button 
                                            onClick={(e) => handleDeleteClick(e, item)}
                                            className={`p-1.5 rounded-full text-red-500/70 hover:bg-red-500/10 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity`}
                                        >
                                            <TrashIcon className="w-5 h-5"/>
                                        </button>
                                    </div>
                                </div>
                                <div className="mt-4 text-right">
                                    <p className={`text-xs ${theme.mutedText}`}>Cập nhật {timeAgo(item.lastModified)}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Delete Confirmation Modal */}
            {itemToDelete && (
                <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setItemToDelete(null)}>
                    <div className={`p-6 rounded-lg shadow-xl ${theme.cardBg} w-full max-w-md`} onClick={e => e.stopPropagation()}>
                        <h3 className="text-lg font-bold">Xác nhận xóa</h3>
                        <p className={`mt-2 text-sm ${theme.mutedText}`}>Bạn muốn làm gì với tệp <strong className={theme.text}>"{itemToDelete.name}"</strong>?</p>
                        <div className="mt-6 space-y-3">
                            <button
                                onClick={() => performDelete(false)}
                                className={`w-full text-left p-4 border ${theme.border} rounded-lg ${theme.hoverBg}`}
                            >
                                <p className="font-semibold">Xóa khỏi không gian làm việc</p>
                                <p className={`text-xs ${theme.mutedText}`}>Chỉ xóa khỏi danh sách này. Tệp gốc trên Google Drive sẽ được giữ lại.</p>
                            </button>
                             <button
                                onClick={() => performDelete(true)}
                                className={`w-full text-left p-4 border border-red-500/30 rounded-lg hover:bg-red-500/10`}
                            >
                                <p className="font-semibold text-red-500">Xóa vĩnh viễn khỏi Drive</p>
                                <p className={`text-xs text-red-500/80`}>Xóa tệp khỏi cả danh sách này và Google Drive của bạn. Hành động này không thể hoàn tác.</p>
                            </button>
                        </div>
                         <div className="mt-6 text-right">
                            <button onClick={() => setItemToDelete(null)} className={`px-4 py-2 ${theme.button.bg} ${theme.button.text} font-semibold rounded-md shadow-sm ${theme.button.hoverBg}`}>Hủy</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
