
import React from 'react';
import { CloseIcon, PlusIcon, BookOpenIcon } from './common/icons';
import type { ProjectData } from '../types';
import { useSettings } from '../contexts/settingsContext';

interface WorkspaceTabsProps {
    projects: ProjectData[];
    activeProjectId: string | null;
    onSelectProject: (id: string) => void;
    onCloseProject: (id: string) => void;
    onGoToDashboard: () => void;
}

export const WorkspaceTabs: React.FC<WorkspaceTabsProps> = ({ projects, activeProjectId, onSelectProject, onCloseProject, onGoToDashboard }) => {
    const { theme } = useSettings();

    return (
        <div className={`flex items-center border-b ${theme.border}`}>
            <div className="flex-grow flex items-center overflow-x-auto">
                {projects.map(project => {
                     const isActive = activeProjectId === project.id;
                     const activeClasses = `border-blue-500 text-blue-600 ${theme.mainBg}`;
                     const inactiveClasses = `border-transparent ${theme.mutedText} hover:${theme.cardBg} hover:${theme.text}`;
                    return (
                        <button
                            key={project.id}
                            onClick={() => onSelectProject(project.id)}
                            className={`flex items-center gap-2 px-4 py-3 border-b-2 whitespace-nowrap transition-colors duration-200 ${
                                isActive ? activeClasses : inactiveClasses
                            }`}
                            title={project.fileName}
                        >
                            <span className="text-sm font-medium truncate max-w-48">{project.fileName}</span>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onCloseProject(project.id);
                                }}
                                className={`p-0.5 rounded-full ${isActive ? 'text-blue-400' : 'text-slate-400'} hover:bg-slate-300 dark:hover:bg-gray-600 hover:text-slate-600`}
                            >
                                <CloseIcon className="w-3.5 h-3.5" />
                            </button>
                        </button>
                    )
                })}
            </div>
             <div className="flex-shrink-0 ml-2 flex items-center gap-2 pr-2">
                <button
                    onClick={onGoToDashboard}
                    className={`flex items-center justify-center w-10 h-10 rounded-full ${theme.button.bg} ${theme.text} ${theme.button.hoverBg} transition-colors`}
                    title="Trở về Không gian làm việc"
                >
                    <BookOpenIcon className="w-5 h-5" />
                </button>
            </div>
        </div>
    );
};
