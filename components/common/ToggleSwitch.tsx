
import React from 'react';

interface ToggleSwitchProps {
    label: string;
    enabled: boolean;
    setEnabled: (enabled: boolean) => void;
}

export const ToggleSwitch: React.FC<ToggleSwitchProps> = ({ label, enabled, setEnabled }) => {
    return (
        <label className="flex items-center cursor-pointer select-none">
            <span className="text-sm font-medium text-slate-700 mr-3">{label}</span>
            <div className="relative">
                <input
                    type="checkbox"
                    checked={enabled}
                    onChange={() => setEnabled(!enabled)}
                    className="sr-only"
                />
                <div className={`block w-14 h-8 rounded-full transition-colors ${enabled ? 'bg-blue-500' : 'bg-slate-300'}`}></div>
                <div
                    className={`dot absolute left-1 top-1 bg-white w-6 h-6 rounded-full transition-transform ${
                        enabled ? 'transform translate-x-6' : ''
                    }`}
                ></div>
            </div>
        </label>
    );
};
