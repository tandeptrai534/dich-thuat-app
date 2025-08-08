
import React from 'react';

export const Spinner: React.FC<{ variant?: 'light' | 'dark', className?: string }> = ({ variant = 'dark', className = '' }) => {
    const colorClass = variant === 'light' ? 'border-white' : 'border-gray-900';
    const finalClassName = `w-6 h-6 border-4 ${colorClass} border-b-transparent rounded-full inline-block box-border animate-spin ${className}`.trim();

    return (
        <div 
            className={finalClassName}
            role="status" 
            aria-label="loading"
        ></div>
    );
};
