/**
 * Accent Color Module
 * Manages the global accent color theme
 */
(function() {
    'use strict';
    
    /**
     * Apply the accent color from settings
     */
    function applyAccentColor() {
        var settingsStr = storage.getUserPreference('jellyfin_settings', null);
        if (!settingsStr) return;
        
        try {
            var settings = JSON.parse(settingsStr);
            var accentColor = settings.accentColor || 'blue';
            
            var root = document.documentElement;
            if (accentColor === 'purple') {
                root.style.setProperty('--accent-color', '#6d4aff');
                root.style.setProperty('--accent-color-rgb', '109, 74, 255');
            } else {
                root.style.setProperty('--accent-color', '#007bff');
                root.style.setProperty('--accent-color-rgb', '0, 123, 255');
            }
        } catch (e) {}
    }
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', applyAccentColor);
    } else {
        applyAccentColor();
    }
    
    window.AccentColor = {
        apply: applyAccentColor
    };
})();
