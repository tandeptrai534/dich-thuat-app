
import React from 'react';

export const Spinner: React.FC<{ variant?: 'light' | 'dark' }> = ({ variant = 'light' }) => {
    const borderColor = variant === 'light' ? 'border-white' : 'border-blue-500';
    return (
        <div className={`w-5 h-5 border-2 ${borderColor} border-t-transparent rounded-full animate-spin`}></div>
    );
};
