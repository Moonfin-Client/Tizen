/**
 * Subtitle Manager
 * Handles fetching, parsing, and rendering of client-side subtitles (SRT/VTT)
 * mimicking Jellyfin Web's customization capabilities.
 */
var SubtitleManager = (function () {
    'use strict';

    class SubtitleManager {
        constructor(playerContainer) {
            this.container = playerContainer;
            this.overlay = null;
            this.innerOverlay = null;
            this.cues = [];
            this.activeCue = null;
            this.settings = {};
            this.isEnabled = false;

            this.init();
        }

        init() {
            // Create overlay elements
            if (!this.overlay) {
                this.overlay = document.createElement('div');
                this.overlay.className = 'videoSubtitles';
                this.overlay.style.display = 'none'; // Hidden by default

                this.innerOverlay = document.createElement('div');
                this.innerOverlay.className = 'videoSubtitlesInner';

                this.overlay.appendChild(this.innerOverlay);
                this.container.appendChild(this.overlay);
            }
        }

        /**
         * Load a subtitle track
         * @param {Object} track - The subtitle track object from MediaSource
         * @param {Object} item - The media item
         * @param {Object} mediaSource - The media source object
         * @param {Object} auth - Authentication object {serverAddress, accessToken}
         */
        loadTrack(track, item, mediaSource, auth) {
            this.cues = [];
            this.isEnabled = true;
            this.overlay.style.display = 'flex';

            // Load latest settings
            this.loadSettings();
            this.applyStyles();

            const userAuth = auth || JellyfinAPI.getStoredAuth(); // Use passed auth or fallback
            if (!userAuth) {
                console.error('[SubtitleManager] No auth data found');
                return;
            }

            // Construct Subtitle URL
            // Format: /Videos/{Id}/{MediaSourceId}/Subtitles/{Index}/Stream.{Format}
            let format = (track.Codec || 'vtt').toLowerCase();

            // Normalize codecs for Jellyfin API
            if (format === 'subrip') format = 'srt';

            // If it's not SRT, convert to VTT (Jellyfin server handles this transcoding)
            if (format !== 'srt') {
                format = 'vtt';
            }

            const mediaSourceId = mediaSource.Id;
            const trackIndex = track.Index;
            const itemId = item.Id;

            let url = `${userAuth.serverAddress}/Videos/${itemId}/${mediaSourceId}/Subtitles/${trackIndex}/Stream.${format}`;
            url += `?api_key=${userAuth.accessToken}`;

            url += `?api_key=${userAuth.accessToken}`;

            console.log('[SubtitleManager] Fetching subtitles from:', url);

            ajax.request(url, {
                method: 'GET',
                dataType: 'text', // Prevent JSON parsing
                success: (data) => {
                    console.log('[SubtitleManager] Subtitles fetched successfully');
                    this.parseSubtitles(data, format);
                },
                error: (err) => {
                    console.error('[SubtitleManager] Failed to fetch subtitles:', err);
                    const errMsg = (typeof err === 'object') ? JSON.stringify(err) : err;
                    if (window.debugOverlay) window.debugOverlay.error('Fetch failed: ' + errMsg);
                }
            });
        }

        disable() {
            this.isEnabled = false;
            this.cues = [];
            if (this.overlay) {
                this.overlay.style.display = 'none';
                this.innerOverlay.innerHTML = '';
            }
        }

        /**
         * Parse subtitle text content into cues
         * @param {string} text - Raw subtitle text
         * @param {string} format - 'srt' or 'vtt'
         */
        parseSubtitles(text, format) {
            this.cues = [];
            const normalizedText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

            if (format === 'srt') {
                this.parseSRT(normalizedText);
            } else {
                // Default to VTT parser as it's similar and often used
                this.parseVTT(normalizedText);
            }

            console.log(`[SubtitleManager] Parsed ${this.cues.length} cues`);
            this.applyStyles(this.settings);
        }

        parseSRT(text) {
            const pattern = /(\d+)\n(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})\n([\s\S]*?)(?=\n\n|\n$|$)/g;
            let match;
            while ((match = pattern.exec(text)) !== null) {
                this.cues.push({
                    start: this.parseTime(match[2]),
                    end: this.parseTime(match[3]),
                    text: match[4].trim()
                });
            }
        }

        parseVTT(text) {
            // Simple VTT parser (ignores header/styles for now)
            // Matches: 00:00:00.000 --> 00:00:00.000 optional_settings
            // Content
            const pattern = /(\d{2}:\d{2}:\d{2}\.\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2}\.\d{3})(?:[^\n]*)\n([\s\S]*?)(?=\n\n|\n$|$)/g;
            let match;
            while ((match = pattern.exec(text)) !== null) {
                this.cues.push({
                    start: this.parseTime(match[1]),
                    end: this.parseTime(match[2]),
                    text: match[3].trim()
                });
            }
        }

        /**
         * Load settings from storage
         */
        loadSettings() {
            try {
                if (window.storage) {
                    const stored = window.storage.getUserPreference('jellyfin_settings', null);
                    if (stored) {
                        const parsed = JSON.parse(stored);
                        // Merge stored settings with defaults
                        if (parsed.subtitleSize) this.settings.subtitleSize = parsed.subtitleSize;
                        if (parsed.subtitleColor) this.settings.subtitleColor = parsed.subtitleColor;
                        if (parsed.subtitlePosition) this.settings.subtitlePosition = parsed.subtitlePosition;
                        if (parsed.subtitleBackground) this.settings.subtitleBackground = parsed.subtitleBackground;
                        console.log('[SubtitleManager] Loaded settings:', this.settings);
                    }
                }
            } catch (e) {
                console.error('[SubtitleManager] Error loading settings:', e);
            }
        }

        /**
         * Parse timestamps to milliseconds
         * Handles 00:00:00,000 (SRT) and 00:00:00.000 (VTT)
         */
        parseTime(timeString) {
            if (!timeString) return 0;
            const parts = timeString.replace(',', '.').split(':');
            const hours = parseInt(parts[0], 10);
            const minutes = parseInt(parts[1], 10);
            const seconds = parseFloat(parts[2]);
            return (hours * 3600 + minutes * 60 + seconds) * 1000;
        }

        /**
         * Update subtitle display based on current time
         * @param {number} timeMs - Current playback time in milliseconds
         */
        update(timeMs) {
            if (!this.isEnabled || this.cues.length === 0) return;

            // Find valid cue
            const currentCue = this.cues.find(cue => timeMs >= cue.start && timeMs <= cue.end);

            if (currentCue) {
                if (this.activeCue !== currentCue) {
                    console.log('[SubtitleManager] Displaying cue:', currentCue.text);
                    this.activeCue = currentCue;
                    // Sanitize text slightly (convert newlines to <br>)
                    const htmlText = currentCue.text.replace(/\n/g, '<br>');
                    this.innerOverlay.innerHTML = htmlText;
                    this.innerOverlay.classList.remove('hide');
                }
            } else {
                if (this.activeCue) {
                    console.log('[SubtitleManager] Clearing cue');
                    this.activeCue = null;
                    this.innerOverlay.innerHTML = ''; // Explicitly clear text
                    this.innerOverlay.classList.add('hide');
                }
            }
        }

        /**
         * Apply appearance settings
         * @param {Object} settings - Appearance settings
         */
        applyStyles(settings) {
            this.settings = settings || this.settings;
            if (!this.innerOverlay) return;

            const s = this.innerOverlay.style;
            const conf = this.settings;

            // Size (Percent of base)
            const sizes = {
                'smaller': '2.2em', // Was 1.8
                'small': '2.8em',   // Was 2.2
                'medium': '3.5em',  // Was 2.8
                'large': '4.5em',   // Was 3.6
                'extralarge': '5.5em' // Was 4.6
            };
            s.fontSize = sizes[conf.subtitleSize || 'medium'] || sizes['medium'];

            // Color
            s.color = conf.subtitleColor || '#ffffff';

            // Vertical Position
            const position = conf.subtitlePosition || 'bottom';
            const overlayStyle = this.overlay.style;

            // Ensure flex display (redundant but safe)
            this.overlay.style.display = 'flex';

            // Reset position properties
            overlayStyle.top = '0';
            overlayStyle.bottom = '0';
            overlayStyle.left = '0';
            overlayStyle.right = '0';

            // Use flexbox for positioning
            overlayStyle.justifyContent = (position === 'top') ? 'flex-start' : 'flex-end';

            // Margins for fine-tuning
            this.innerOverlay.style.marginTop = '0';
            this.innerOverlay.style.marginBottom = '10%'; // Default bottom

            if (position === 'top') {
                this.innerOverlay.style.marginTop = '10%';
                this.innerOverlay.style.marginBottom = '0';
            } else if (position === 'bottom-low') {
                this.innerOverlay.style.marginBottom = '2%'; // Lower
            } else if (position === 'bottom-high') {
                this.innerOverlay.style.marginBottom = '20%'; // Higher
            } else if (position === 'middle') {
                overlayStyle.justifyContent = 'center';
                this.innerOverlay.style.marginBottom = '0';
            }

            // Background / Shadow
            const bg = conf.subtitleBackground || 'drop-shadow';
            if (bg === 'drop-shadow') {
                s.textShadow = '0px 0px 8px rgba(0, 0, 0, 1), 0px 0px 4px rgba(0, 0, 0, 1)';
                s.background = 'none';
            } else if (bg === 'background') {
                s.textShadow = 'none';
                s.background = 'rgba(0, 0, 0, 0.7)';
            } else { // none
                s.textShadow = 'none';
                s.background = 'none';
            }

            // Force layout reflow
            if (this.activeCue) {
                const text = this.activeCue.text.replace(/\n/g, '<br>');
                this.innerOverlay.innerHTML = text;
            }
        }

        destroy() {
            this.disable();
            if (this.overlay && this.overlay.parentNode) {
                this.overlay.parentNode.removeChild(this.overlay);
            }
            this.overlay = null;
            this.innerOverlay = null;
            this.cues = [];
            this.activeCue = null;
        }
    }

    return SubtitleManager;
})();
