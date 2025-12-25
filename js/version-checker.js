/**
 * Version Checker for Moonfin Tizen
 * Checks GitHub releases for newer versions and displays update notification
 */

var VersionChecker = (function() {
    'use strict';

    const GITHUB_API_URL = 'https://api.github.com/repos/Moonfin-Client/jellyfin-tizen/releases/latest';
    const CHECK_COOLDOWN_HOURS = 24;
    const STORAGE_KEY_LAST_CHECK = 'version_last_check';
    const STORAGE_KEY_DISMISSED_VERSION = 'version_dismissed';
    const APP_VERSION = '1.0.0'; // Will be updated dynamically from config.xml

    /**
     * Get current app version from config.xml
     * @returns {string} Current version string
     */
    function getCurrentVersion() {
        return APP_VERSION;
    }

    /**
     * Compare two version strings
     * @param {string} v1 - First version
     * @param {string} v2 - Second version
     * @returns {number} -1 if v1 < v2, 0 if equal, 1 if v1 > v2
     */
    function compareVersions(v1, v2) {
        // Remove 'v' prefix if present
        v1 = v1.replace(/^v/, '');
        v2 = v2.replace(/^v/, '');

        const parts1 = v1.split('.').map(function(n) { return parseInt(n, 10) || 0; });
        const parts2 = v2.split('.').map(function(n) { return parseInt(n, 10) || 0; });

        const maxLength = Math.max(parts1.length, parts2.length);

        for (let i = 0; i < maxLength; i++) {
            const part1 = parts1[i] || 0;
            const part2 = parts2[i] || 0;

            if (part1 < part2) return -1;
            if (part1 > part2) return 1;
        }

        return 0;
    }

    /**
     * Check if enough time has passed since last check
     * @returns {boolean} True if we should check for updates
     */
    function shouldCheckForUpdate() {
        if (!storage) return true;

        const lastCheck = storage.getItem(STORAGE_KEY_LAST_CHECK);
        if (!lastCheck) return true;

        const lastCheckTime = parseInt(lastCheck, 10);
        const now = Date.now();
        const hoursSinceCheck = (now - lastCheckTime) / (1000 * 60 * 60);

        return hoursSinceCheck >= CHECK_COOLDOWN_HOURS;
    }

    /**
     * Mark that we've checked for updates
     */
    function markChecked() {
        if (storage) {
            storage.setItem(STORAGE_KEY_LAST_CHECK, Date.now().toString());
        }
    }

    /**
     * Check if user dismissed this version
     * @param {string} version - Version to check
     * @returns {boolean} True if dismissed
     */
    function isVersionDismissed(version) {
        if (!storage) return false;

        const dismissedVersion = storage.getItem(STORAGE_KEY_DISMISSED_VERSION);
        return dismissedVersion === version;
    }

    /**
     * Mark version as dismissed
     * @param {string} version - Version to dismiss
     */
    function dismissVersion(version) {
        if (storage) {
            storage.setItem(STORAGE_KEY_DISMISSED_VERSION, version);
        }
    }

    /**
     * Fetch latest release info from GitHub
     * @returns {Promise<Object>} Release info object
     */
    function fetchLatestRelease() {
        return new Promise(function(resolve, reject) {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', GITHUB_API_URL, true);
            xhr.setRequestHeader('Accept', 'application/vnd.github+json');
            xhr.setRequestHeader('User-Agent', 'Moonfin-Tizen-Client');
            
            xhr.timeout = 10000; // 10 second timeout

            xhr.onload = function() {
                if (xhr.status === 200) {
                    try {
                        var data = JSON.parse(xhr.responseText);
                        resolve(data);
                    } catch (e) {
                        reject(new Error('Failed to parse response'));
                    }
                } else {
                    reject(new Error('HTTP ' + xhr.status));
                }
            };

            xhr.onerror = function() {
                reject(new Error('Network error'));
            };

            xhr.ontimeout = function() {
                reject(new Error('Request timeout'));
            };

            xhr.send();
        });
    }

    /**
     * Show update notification modal
     * @param {Object} releaseInfo - GitHub release information
     */
    function showUpdateModal(releaseInfo) {
        const latestVersion = releaseInfo.tag_name.replace(/^v/, '');
        const currentVersion = getCurrentVersion();
        
        // Create modal HTML
        const modalHTML = `
            <div id="updateModal" class="update-modal" role="dialog" aria-labelledby="updateTitle" aria-modal="true">
                <div class="update-modal-content">
                    <h2 id="updateTitle" class="update-modal-title">Update Available</h2>
                    <p class="update-modal-version">
                        Version ${latestVersion} is now available<br>
                        <span class="update-modal-current">(Current: ${currentVersion})</span>
                    </p>
                    <div class="update-modal-notes">
                        ${releaseInfo.body ? formatReleaseNotes(releaseInfo.body) : 'A new version is available. Visit GitHub to download.'}
                    </div>
                    <div class="update-modal-buttons">
                        <button id="updateModalOk" class="update-modal-button update-modal-button-focused">
                            OK
                        </button>
                    </div>
                </div>
            </div>
        `;

        // Insert modal into document
        const modalContainer = document.createElement('div');
        modalContainer.innerHTML = modalHTML;
        document.body.appendChild(modalContainer.firstElementChild);

        // Setup modal
        const modal = document.getElementById('updateModal');
        const okButton = document.getElementById('updateModalOk');

        // Focus the OK button
        okButton.focus();

        // Store previous focus to restore later
        const previousFocus = document.activeElement;

        // Handle button click
        function closeModal() {
            dismissVersion(latestVersion);
            modal.remove();
            
            // Restore focus to previous element
            if (previousFocus && previousFocus.focus) {
                previousFocus.focus();
            }
        }

        okButton.addEventListener('click', closeModal);

        // Handle keyboard navigation
        document.addEventListener('keydown', function handleModalKeys(e) {
            if (modal.parentElement) {
                if (e.keyCode === 13 || e.keyCode === 10009) { // Enter or Return
                    e.preventDefault();
                    e.stopPropagation();
                    closeModal();
                    document.removeEventListener('keydown', handleModalKeys);
                } else if (e.keyCode === 10182 || e.keyCode === 8) { // Back button
                    e.preventDefault();
                    e.stopPropagation();
                    closeModal();
                    document.removeEventListener('keydown', handleModalKeys);
                }
            }
        });

        console.log('[VERSION] Update modal displayed for version ' + latestVersion);
    }

    /**
     * Format release notes for display
     * @param {string} notes - Raw release notes
     * @returns {string} Formatted HTML
     */
    function formatReleaseNotes(notes) {
        // Limit length and escape HTML
        let formatted = notes.substring(0, 500);
        if (notes.length > 500) {
            formatted += '...';
        }

        // Simple markdown-like formatting
        formatted = formatted
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\n/g, '<br>')
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>');

        return formatted;
    }

    /**
     * Check for updates and show modal if newer version available
     */
    function checkForUpdates() {
        console.log('[VERSION] Checking for updates...');

        // Check if we should skip this check
        if (!shouldCheckForUpdate()) {
            console.log('[VERSION] Skipping check (cooldown period)');
            return;
        }

        const currentVersion = getCurrentVersion();

        fetchLatestRelease()
            .then(function(releaseInfo) {
                markChecked();

                if (!releaseInfo || !releaseInfo.tag_name) {
                    console.log('[VERSION] No release information available');
                    return;
                }

                const latestVersion = releaseInfo.tag_name.replace(/^v/, '');

                console.log('[VERSION] Current:', currentVersion, 'Latest:', latestVersion);

                // Check if there's a newer version
                if (compareVersions(currentVersion, latestVersion) < 0) {
                    // Don't show if user already dismissed this version
                    if (!isVersionDismissed(latestVersion)) {
                        console.log('[VERSION] Newer version available:', latestVersion);
                        showUpdateModal(releaseInfo);
                    } else {
                        console.log('[VERSION] Update available but dismissed by user');
                    }
                } else {
                    console.log('[VERSION] App is up to date');
                }
            })
            .catch(function(error) {
                console.log('[VERSION] Failed to check for updates:', error.message);
                // Silently fail - don't bother the user with network errors
            });
    }

    /**
     * Initialize version checker on app startup
     * Call this after DOM is ready and storage is initialized
     */
    function init() {
        // Wait a bit before checking to let the app fully load
        setTimeout(function() {
            checkForUpdates();
        }, 3000);
    }

    return {
        init: init,
        checkForUpdates: checkForUpdates,
        getCurrentVersion: getCurrentVersion
    };
})();
