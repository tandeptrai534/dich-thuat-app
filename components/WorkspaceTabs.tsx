
import React from 'react';
import { useSettings } from '@/contexts/settingsContext';
import { CloseIcon, DocumentTextIcon, BookmarkSquareIcon } from '@/components/common/icons';
import type { ProjectData } from '@/types';

interface WorkspaceTabsProps {
    projects: ProjectData[];
    activeProjectId: string | null;
    onSelectProject: (projectId: string) => void;
    onCloseProject: (projectId: string) => void;
    onGoToDashboard: () => void;
}

export const WorkspaceTabs: React.FC<WorkspaceTabsProps> = ({
    projects,
    activeProjectId,
    onSelectProject,
    onCloseProject,
    onGoToDashboard
}) => {
    const { theme } = useSettings();

    const Tab: React.FC<{
        label: string;
        isActive: boolean;
        onClick: () => void;
        onClose?: () => void;
        icon: React.ElementType;
    }> = ({ label, isActive, onClick, onClose, icon: Icon }) => {
        const activeClasses = `bg-white dark:bg-gray-800 ${theme.text}`;
        const inactiveClasses = `${theme.mutedText} hover:bg-slate-200/50 dark:hover:bg-gray-700/50 hover:${theme.text}`;
        
        return (
            <div
                onClick={onClick}
                className={`flex items-center h-full px-4 py-2 border-r ${theme.border} cursor-pointer transition-colors text-sm font-medium whitespace-nowrap ${isActive ? activeClasses : inactiveClasses}`}
            >
                <Icon className="w-4 h-4 mr-2" />
                <span className="truncate max-w-[150px]">{label}</span>
                {onClose && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onClose();
                        }}
                        className="ml-3 p-0.5 rounded-full hover:bg-slate-500/20"
                    >
                        <CloseIcon className="w-3.5 h-3.5" />
                    </button>
                )}
            </div>
        );
    };

    return (
        <div className={`flex-shrink-0 w-full bg-slate-100 dark:bg-gray-900 border-b ${theme.border} flex items-center overflow-x-auto`}>
            <Tab
                label="Bảng điều khiển"
                isActive={activeProjectId === null}
                onClick={onGoToDashboard}
                icon={BookmarkSquareIcon}
            />
            {projects.map(p => (
                <Tab
                    key={p.id}
                    label={p.fileName}
                    isActive={activeProjectId === p.id}
                    onClick={() => onSelectProject(p.id)}
                    onClose={() => onCloseProject(p.id)}
                    icon={DocumentTextIcon}
                />
            ))}
        </div>
    );
};
