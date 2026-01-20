// -*- coding: utf-8 -*-

/*
 * Video Player Adapter - Abstraction layer for multiple playback engines
 * 
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/**
 * Media Error Types
 */
var MediaError = {
    NETWORK_ERROR: 'NetworkError',
    MEDIA_DECODE_ERROR: 'MediaDecodeError',
    MEDIA_NOT_SUPPORTED: 'MediaNotSupported',
    FATAL_HLS_ERROR: 'FatalHlsError',
    SERVER_ERROR: 'ServerError',
    NO_MEDIA_ERROR: 'NoMediaError'
};

/**
 * HLS.js error recovery timing
 */
var recoverDecodingErrorDate;
var recoverSwapAudioCodecDate;

/**
 * Base class for video player adapters
 */
class VideoPlayerAdapter {
    constructor(videoElement) {
        this.videoElement = videoElement;
        this.eventHandlers = {};
    }

    /**
     * Initialize the player
     * @returns {Promise<boolean>} Success status
     */
    async initialize() {
        throw new Error('initialize() must be implemented by subclass');
    }

    /**
     * Load and play a media source
     * @param {string} url - Media URL
     * @param {Object} options - Playback options (mimeType, startPosition, etc.)
     * @returns {Promise<void>}
     */
    async load(url, options = {}) {
        throw new Error('load() must be implemented by subclass');
    }

    /**
     * Play the video
     */
    play() {
        return this.videoElement.play();
    }

    /**
     * Pause the video
     */
    pause() {
        this.videoElement.pause();
    }

    /**
     * Seek to a specific time
     * @param {number} time - Time in seconds
     */
    seek(time) {
        this.videoElement.currentTime = time;
    }

    /**
     * Get current playback time
     * @returns {number} Current time in seconds
     */
    getCurrentTime() {
        return this.videoElement.currentTime;
    }

    /**
     * Get video duration
     * @returns {number} Duration in seconds
     */
    getDuration() {
        return this.videoElement.duration;
    }

    /**
     * Set volume
     * @param {number} volume - Volume level (0-1)
     */
    setVolume(volume) {
        this.videoElement.volume = volume;
    }

    /**
     * Get current volume
     * @returns {number} Volume level (0-1)
     */
    getVolume() {
        return this.videoElement.volume;
    }

    /**
     * Check if video is paused
     * @returns {boolean}
     */
    isPaused() {
        return this.videoElement.paused;
    }

    /**
     * Stop playback
     */
    stop() {
        this.videoElement.pause();
        this.videoElement.src = '';
    }

    /**
     * Register event handler
     * @param {string} event - Event name
     * @param {Function} handler - Event handler function
     */
    on(event, handler) {
        if (!this.eventHandlers[event]) {
            this.eventHandlers[event] = [];
        }
        this.eventHandlers[event].push(handler);
    }

    /**
     * Emit event to registered handlers
     * @param {string} event - Event name
     * @param {*} data - Event data
     */
    emit(event, data) {
        if (this.eventHandlers[event]) {
            this.eventHandlers[event].forEach(handler => handler(data));
        }
    }

    /**
     * Select audio track
     * @param {number} trackId - Track ID
     */
    selectAudioTrack(trackId) {
        throw new Error('selectAudioTrack() must be implemented by subclass');
    }

    /**
     * Select subtitle track
     * @param {number} trackId - Track ID (use -1 to disable)
     */
    selectSubtitleTrack(trackId) {
        throw new Error('selectSubtitleTrack() must be implemented by subclass');
    }

    /**
     * Get available audio tracks
     * @returns {Array<Object>} Audio tracks
     */
    getAudioTracks() {
        throw new Error('getAudioTracks() must be implemented by subclass');
    }

    /**
     * Get available subtitle tracks
     * @returns {Array<Object>} Subtitle tracks
     */
    getSubtitleTracks() {
        throw new Error('getSubtitleTracks() must be implemented by subclass');
    }

    /**
     * Destroy the player and cleanup resources
     */
    async destroy() {
        this.eventHandlers = {};
    }

    /**
     * Get player name/type
     * @returns {string}
     */
    getName() {
        return 'BaseAdapter';
    }
}

/**
 * Shaka Player Adapter
 */
class ShakaPlayerAdapter extends VideoPlayerAdapter {
    constructor(videoElement) {
        super(videoElement);
        this.player = null;
        this.initialized = false;
    }

    async initialize() {
        try {
            // Check if Shaka Player is supported
            if (!shaka.Player.isBrowserSupported()) {
                console.log('[ShakaAdapter] Browser not supported');
                return false;
            }

            // Install polyfills
            shaka.polyfill.installAll();

            // Create player instance (use attach method instead of constructor with element)
            this.player = new shaka.Player();
            await this.player.attach(this.videoElement);

            // Detect codec support using MediaSource API
            // Test multiple Dolby Vision profiles and variants
            // HEVC Levels: L120=4.0 (1080p), L150=5.0 (4K@30), L153=5.1 (4K@60)
            this.codecSupport = {
                h264: this.checkCodecSupport('video/mp4; codecs="avc1.64001f"'),
                hevc: this.checkCodecSupport('video/mp4; codecs="hev1.1.6.L153.B0"'),
                hevcMain10: this.checkCodecSupport('video/mp4; codecs="hev1.2.4.L153.B0"'),
                dolbyVisionP5: this.checkCodecSupport('video/mp4; codecs="dvhe.05.07"'),
                dolbyVisionP7: this.checkCodecSupport('video/mp4; codecs="dvhe.07.06"'),
                dolbyVisionP8: this.checkCodecSupport('video/mp4; codecs="dvhe.08.07"'),
                vp9: this.checkCodecSupport('video/webm; codecs="vp9"'),
                vp9Profile2: this.checkCodecSupport('video/webm; codecs="vp09.02.10.10"')
            };

            // Determine overall HDR capability
            const hasDolbyVision = this.codecSupport.dolbyVisionP5 || this.codecSupport.dolbyVisionP7 || this.codecSupport.dolbyVisionP8;
            const hasHDR = this.codecSupport.hevcMain10 || hasDolbyVision || this.codecSupport.vp9Profile2;

            console.log('[ShakaAdapter] Hardware codec support detected:');
            console.log('  - H.264/AVC:', this.codecSupport.h264);
            console.log('  - HEVC/H.265:', this.codecSupport.hevc, '(10-bit:', this.codecSupport.hevcMain10 + ')');
            console.log('  - Dolby Vision Profile 5:', this.codecSupport.dolbyVisionP5);
            console.log('  - Dolby Vision Profile 7:', this.codecSupport.dolbyVisionP7);
            console.log('  - Dolby Vision Profile 8:', this.codecSupport.dolbyVisionP8);
            console.log('  - VP9:', this.codecSupport.vp9, '(HDR:', this.codecSupport.vp9Profile2 + ')');
            console.log('[ShakaAdapter] HDR Capabilities: Dolby Vision=' + hasDolbyVision + ', HDR10=' + this.codecSupport.hevcMain10);

            // Store for later reference
            this.hasDolbyVisionSupport = hasDolbyVision;
            this.hasHDRSupport = hasHDR;

            // Optimized configuration with Dolby Vision and HDR support
            this.player.configure({
                streaming: {
                    bufferingGoal: 20,
                    rebufferingGoal: 2,
                    bufferBehind: 30,
                    alwaysStreamText: false,
                    startAtSegmentBoundary: false,
                    safeSeekOffset: 0.1,
                    stallEnabled: true,
                    stallThreshold: 1,
                    retryParameters: {
                        timeout: 15000,
                        maxAttempts: 2,
                        baseDelay: 500,
                        backoffFactor: 2,
                        fuzzFactor: 0.5
                    }
                },
                abr: {
                    enabled: true,
                    defaultBandwidthEstimate: 5000000,
                    switchInterval: 8,
                    bandwidthUpgradeTarget: 0.85,
                    bandwidthDowngradeTarget: 0.95,
                    restrictions: {
                        maxHeight: 2160,  // Allow 4K for HDR content
                        maxWidth: 3840,
                        maxBandwidth: 100000000  // Increase for high-bitrate HDR
                    }
                },
                manifest: {
                    retryParameters: {
                        timeout: 15000,
                        maxAttempts: 2
                    },
                    defaultPresentationDelay: 0,
                    dash: {
                        ignoreMinBufferTime: true
                    }
                },
                // Prefer Dolby Vision and HDR codecs over SDR
                // Order: Dolby Vision (Profile 7 dual-layer, Profile 5, Profile 8), HDR10+, HDR10, SDR
                preferredVideoCodecs: [
                    'dvhe.07',  // Dolby Vision Profile 7 (dual-layer with backward compatibility)
                    'dvh1.07',  // Dolby Vision Profile 7 variant
                    'dvhe.05',  // Dolby Vision Profile 5 (single-layer)
                    'dvh1.05',  // Dolby Vision Profile 5 variant
                    'dvhe.08',  // Dolby Vision Profile 8 (single-layer)
                    'dvh1.08',  // Dolby Vision Profile 8 variant
                    'hev1',     // HEVC/H.265 with HDR10
                    'hvc1',     // HEVC/H.265 variant
                    'avc1',     // H.264/AVC (SDR fallback)
                    'avc3'      // H.264/AVC variant
                ]
            });
            // Setup error handling
            this.player.addEventListener('error', (event) => {
                this.emit('error', event.detail);
            });

            // Setup buffering events
            this.player.addEventListener('buffering', (event) => {
                this.emit('buffering', event.buffering);
            });

            // Setup adaptation events (quality changes)
            this.player.addEventListener('adaptation', () => {
                const stats = this.player.getStats();
                this.emit('qualitychange', {
                    width: stats.width,
                    height: stats.height,
                    bandwidth: stats.estimatedBandwidth
                });
            });

            // Setup variant change events (audio/video track changes)
            this.player.addEventListener('variantchanged', () => {
                const currentVariant = this.player.getVariantTracks().find(t => t.active);
                if (currentVariant) {
                    this.emit('audiotrackchange', {
                        language: currentVariant.language,
                        bandwidth: currentVariant.bandwidth
                    });
                }
            });

            this.initialized = true;
            return true;
        } catch (error) {
            return false;
        }
    }

    async load(url, options = {}) {
        if (!this.initialized || !this.player) {
            throw new Error('Shaka Player not initialized');
        }

        try {
            console.log('[ShakaAdapter] Loading:', url.substring(0, 80) + '...');
            if (options.startPosition) {
                console.log('[ShakaAdapter] Start position:', options.startPosition, 'seconds');
            }

            // Provide helpful info about playback method and codec support
            const isDirect = url.includes('.mp4') && !url.includes('.m3u8') && !url.includes('.mpd');
            const isStreaming = url.includes('.m3u8') || url.includes('.mpd');

            if (isDirect) {
                console.log('[ShakaAdapter] Direct file playback mode');
                if (this.hasDolbyVisionSupport) {
                    console.log('[ShakaAdapter] ✓ Device supports Dolby Vision hardware decoding');
                } else if (this.hasHDRSupport) {
                    console.log('[ShakaAdapter] ✓ Device supports HDR10 (HEVC 10-bit)');
                } else {
                    console.log('[ShakaAdapter] ℹ Device supports SDR only (no HDR hardware)');
                }
            } else if (isStreaming) {
                console.log('[ShakaAdapter] Adaptive streaming mode (DASH/HLS)');
                if (this.hasDolbyVisionSupport) {
                    console.log('[ShakaAdapter] ✓ Will prefer Dolby Vision tracks if available');
                } else if (this.hasHDRSupport) {
                    console.log('[ShakaAdapter] ✓ Will prefer HDR10 tracks if available');
                }
            }

            // Load the manifest
            await this.player.load(url);
            console.log('[ShakaAdapter] Manifest loaded successfully');

            this.emit('loaded', { url });

            // Set start position AFTER loading (when metadata is available)
            if (options.startPosition && options.startPosition > 0) {
                this.videoElement.currentTime = options.startPosition;
            }

            // Apply track selections if provided
            if (options.audioTrackId !== undefined) {
                this.selectAudioTrack(options.audioTrackId);
            }
            if (options.subtitleTrackId !== undefined) {
                this.selectSubtitleTrack(options.subtitleTrackId);
            }

        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }

    selectAudioTrack(trackId) {
        if (!this.player || !this.initialized) {
            console.warn('[ShakaAdapter] Player not ready for audio track selection');
            return false;
        }

        try {
            const allTracks = this.player.getVariantTracks();
            console.log('[ShakaAdapter] Selecting audio track:', trackId, 'from', allTracks.length, 'variants');

            // Get unique audio languages
            const audioLanguages = [];
            const seenLanguages = new Set();
            allTracks.forEach(track => {
                if (track.language && !seenLanguages.has(track.language)) {
                    seenLanguages.add(track.language);
                    audioLanguages.push(track.language);
                }
            });


            if (trackId >= 0 && trackId < audioLanguages.length) {
                const targetLanguage = audioLanguages[trackId];

                // Select all variant tracks with this language
                const tracksToSelect = allTracks.filter(t => t.language === targetLanguage);
                if (tracksToSelect.length > 0) {
                    // Select the first track with this language (Shaka will handle quality variants)
                    this.player.selectAudioLanguage(targetLanguage);
                    console.log('[ShakaAdapter] Audio language selected:', targetLanguage);
                    return true;
                }
            }

            return false;
        } catch (error) {
            return false;
        }
    }

    selectSubtitleTrack(trackId) {
        if (!this.player || !this.initialized) {
            console.warn('[ShakaAdapter] Player not ready for subtitle selection');
            return false;
        }

        try {
            if (trackId === -1) {
                this.player.setTextTrackVisibility(false);
                console.log('[ShakaAdapter] Subtitles disabled');
                return true;
            }

            const tracks = this.player.getTextTracks();
            console.log('[ShakaAdapter] Selecting subtitle:', trackId, 'from', tracks.length, 'tracks');

            if (trackId >= 0 && trackId < tracks.length) {
                const track = tracks[trackId];
                this.player.selectTextTrack(track);
                this.player.setTextTrackVisibility(true);
                console.log('[ShakaAdapter] Subtitle track selected:', track.language || trackId);
                return true;
            }

            return false;
        } catch (error) {
            return false;
        }
    }

    getAudioTracks() {
        if (!this.player) return [];

        const tracks = this.player.getVariantTracks();
        const uniqueLanguages = new Map();

        tracks.forEach(track => {
            if (track.language && !uniqueLanguages.has(track.language)) {
                uniqueLanguages.set(track.language, {
                    id: uniqueLanguages.size,
                    language: track.language,
                    label: track.label || track.language,
                    channels: track.channelsCount
                });
            }
        });

        return Array.from(uniqueLanguages.values());
    }

    getSubtitleTracks() {
        if (!this.player) return [];

        return this.player.getTextTracks().map((track, index) => ({
            id: index,
            language: track.language,
            label: track.label || track.language,
            kind: track.kind
        }));
    }

    /**
     * Get real-time playback statistics
     * @returns {Object|null} Playback stats including codec, quality, and HDR info
     */
    getPlaybackStats() {
        if (!this.player || !this.initialized) return null;

        try {
            const stats = this.player.getStats();
            const variantTracks = this.player.getVariantTracks();
            const activeVariant = variantTracks.find(t => t.active);

            if (!activeVariant) return null;

            // Extract codec information
            const videoCodec = activeVariant.videoCodec || 'unknown';
            const audioCodec = activeVariant.audioCodec || 'unknown';

            // Determine HDR type from codec string
            let hdrType = 'SDR';
            let colorInfo = null;

            if (videoCodec.startsWith('dvhe.') || videoCodec.startsWith('dvh1.')) {
                // Dolby Vision profiles
                const profileMatch = videoCodec.match(/dv[he]1?\.(\d+)/);
                if (profileMatch) {
                    const profile = profileMatch[1];
                    if (profile === '05') hdrType = 'Dolby Vision (Profile 5)';
                    else if (profile === '07') hdrType = 'Dolby Vision (Profile 7)';
                    else if (profile === '08') hdrType = 'Dolby Vision (Profile 8)';
                    else hdrType = 'Dolby Vision (Profile ' + profile + ')';
                }
            } else if (videoCodec.includes('hev1') || videoCodec.includes('hvc1') || videoCodec.includes('hevc')) {
                // HEVC - likely HDR10 if high bitrate
                hdrType = 'HDR10 (HEVC)';
            } else if (videoCodec.includes('vp9')) {
                hdrType = 'HDR (VP9)';
            }

            // Get color information from video element if available
            if (this.videoElement && this.videoElement.videoWidth) {
                colorInfo = {
                    width: this.videoElement.videoWidth,
                    height: this.videoElement.videoHeight
                };
            }

            return {
                // Codec information
                videoCodec: videoCodec,
                audioCodec: audioCodec,
                hdrType: hdrType,

                // Quality information
                width: stats.width || (activeVariant.width || 0),
                height: stats.height || (activeVariant.height || 0),
                bandwidth: activeVariant.bandwidth || 0,

                // Performance stats
                estimatedBandwidth: stats.estimatedBandwidth || 0,
                droppedFrames: stats.droppedFrames || 0,
                stallsDetected: stats.stallsDetected || 0,
                streamBandwidth: stats.streamBandwidth || 0,

                // Additional info
                frameRate: activeVariant.frameRate || 0,
                audioChannels: activeVariant.channelsCount || 0,
                colorInfo: colorInfo
            };
        } catch (error) {
            console.error('[ShakaAdapter] Error getting playback stats:', error);
            return null;
        }
    }

    async destroy() {
        if (this.player) {
            await this.player.destroy();
            this.player = null;
        }
        this.initialized = false;
        await super.destroy();
    }

    /**
     * Get playback statistics
     * @returns {Object} Playback stats including dropped/corrupted frames
     */
    getStats() {
        const stats = {
            categories: []
        };

        if (!this.player || !this.videoElement) {
            return stats;
        }

        const shakaStats = this.player.getStats();
        const videoCategory = {
            type: 'video',
            stats: []
        };

        // Video resolution
        if (this.videoElement.videoWidth && this.videoElement.videoHeight) {
            videoCategory.stats.push({
                label: 'Video Resolution',
                value: `${this.videoElement.videoWidth}x${this.videoElement.videoHeight}`
            });
        }

        // Dropped frames (from HTMLVideoElement API)
        if (this.videoElement.getVideoPlaybackQuality) {
            const quality = this.videoElement.getVideoPlaybackQuality();
            videoCategory.stats.push({
                label: 'Dropped Frames',
                value: quality.droppedVideoFrames || 0
            });
            videoCategory.stats.push({
                label: 'Corrupted Frames',
                value: quality.corruptedVideoFrames || 0
            });
        }

        // Shaka-specific stats
        if (shakaStats.estimatedBandwidth) {
            videoCategory.stats.push({
                label: 'Estimated Bandwidth',
                value: `${(shakaStats.estimatedBandwidth / 1000000).toFixed(2)} Mbps`
            });
        }

        stats.categories.push(videoCategory);
        return stats;
    }

    getName() {
        return 'ShakaPlayer';
    }

    /**
     * Check if a specific codec is supported by the browser/device
     * @param {string} mimeType - MIME type with codec string
     * @returns {boolean} True if codec is supported
     */
    checkCodecSupport(mimeType) {
        try {
            if (window.MediaSource && typeof window.MediaSource.isTypeSupported === 'function') {
                return window.MediaSource.isTypeSupported(mimeType);
            }
            // Fallback to video element canPlayType
            const video = document.createElement('video');
            const support = video.canPlayType(mimeType);
            return support === 'probably' || support === 'maybe';
        } catch (e) {
            console.warn('[ShakaAdapter] Error checking codec support:', e);
            return false;
        }
    }
}

/**
 * Samsung Tizen AVPlay Video API Adapter
 * Uses Samsung's AVPlay API for hardware-accelerated playback
 */
class TizenVideoAdapter extends VideoPlayerAdapter {
    constructor(videoElement) {
        super(videoElement);
        this.initialized = false;
        this.currentUrl = null;
        this.isPrepared = false;
        this.duration = 0;
        this.subtitleManager = null;
    }

    async initialize() {
        try {
            // Check if Tizen AVPlay API is available
            if (typeof webapis === 'undefined' || !webapis.avplay) {
                console.log('[TizenAdapter] AVPlay API not available');
                return false;
            }

            this.initialized = true;
            console.log('[TizenAdapter] AVPlay API initialized');
            return true;
        } catch (error) {
            console.error('[TizenAdapter] Initialization failed:', error);
            return false;
        }
    }

    /**
     * Configure streaming properties for HEVC/4K content
     * Samsung Tizen TVs require explicit configuration for Direct Play of HEVC
     * @param {string} url - Media URL
     * @param {Object} options - Playback options (may contain mediaSource info)
     */
    configureStreamingProperties(url, options) {
        try {
            // Detect video codec from URL or options
            const urlLower = url.toLowerCase();
            const videoCodec = (options.videoCodec || '').toLowerCase();
            const container = (options.container || '').toLowerCase();

            // Check for HEVC content from options (most reliable) or URL
            const isHEVC = options.isHEVC === true ||
                videoCodec === 'hevc' ||
                videoCodec.startsWith('hev1') ||
                videoCodec.startsWith('hvc1') ||
                videoCodec.startsWith('h265') ||
                urlLower.includes('hevc') ||
                urlLower.includes('h265') ||
                urlLower.includes('videocodec=hevc');

            // Check for 10-bit HEVC (Main 10 profile)
            const is10bit = options.isHEVC10bit === true ||
                urlLower.includes('10bit') ||
                urlLower.includes('main10');

            // Check for 4K content
            const is4K = (options.width && options.width >= 3840) ||
                (options.height && options.height >= 2160) ||
                urlLower.includes('2160') ||
                urlLower.includes('4k');

            // Check for Direct Play mode
            const isDirectPlay = options.isDirectPlay === true ||
                urlLower.includes('static=true');

            console.log('[TizenAdapter] Stream detection:', {
                isHEVC: isHEVC,
                is10bit: is10bit,
                is4K: is4K,
                isDirectPlay: isDirectPlay,
                container: container,
                videoCodec: videoCodec,
                width: options.width,
                height: options.height
            });

            // For HEVC Direct Play, we need to set streaming property
            if (isHEVC && isDirectPlay) {
                // Build bitrate info
                var bitrate = options.bitrate || 40000000; // Default 40 Mbps for 4K HEVC
                if (is4K) {
                    bitrate = Math.max(bitrate, 80000000); // At least 80 Mbps for 4K HEVC
                }

                // Set ADAPTIVE_INFO to help AVPlay with buffer allocation
                try {
                    var adaptiveInfo = 'BITRATES=' + bitrate + '|STARTBITRATE=' + bitrate + '|SKIPBITRATE=LOWEST';
                    webapis.avplay.setStreamingProperty('ADAPTIVE_INFO', adaptiveInfo);
                    console.log('[TizenAdapter] Set ADAPTIVE_INFO:', adaptiveInfo);
                } catch (e) {
                    console.warn('[TizenAdapter] Could not set ADAPTIVE_INFO:', e);
                }

                // Enable 4K mode for 4K content
                if (is4K) {
                    try {
                        webapis.avplay.setStreamingProperty('SET_MODE_4K', 'TRUE');
                        console.log('[TizenAdapter] Enabled 4K mode');
                    } catch (e) {
                        console.warn('[TizenAdapter] Could not set 4K mode:', e);
                    }
                }

                // For HEVC 10-bit, some Tizen versions need additional configuration
                // Try to set codec info explicitly
                if (is10bit) {
                    console.log('[TizenAdapter] HEVC 10-bit (Main 10) content detected');
                    try {
                        // Some Tizen versions support explicit codec configuration
                        // This helps older TVs (Tizen 4.0) handle HEVC 10-bit properly
                        webapis.avplay.setStreamingProperty('PREBUFFER_MODE', '4000'); // 4 second buffer
                        console.log('[TizenAdapter] Set prebuffer for 10-bit content');
                    } catch (e) {
                        console.warn('[TizenAdapter] Could not set prebuffer:', e);
                    }
                }
            }

            // Log container info
            if (container === 'mkv') {
                console.log('[TizenAdapter] MKV container - Tizen AVPlay supports MKV natively');
            }

        } catch (error) {
            console.warn('[TizenAdapter] Error configuring streaming properties:', error);
        }
    }

    async load(url, options = {}) {
        if (!this.initialized) {
            throw new Error('Tizen AVPlay API not initialized');
        }

        this.options = options;

        // Initialize SubtitleManager if available
        // Initialize SubtitleManager if available
        if (typeof SubtitleManager !== 'undefined') {
            // Store context for later use (needed for loading tracks)
            this.currentMediaItem = options.items ? options.items[0] : options.item;
            this.currentMediaSource = options.mediaSource;
            this.currentMediaSource = options.mediaSource;
            this.auth = options.auth;

            // Initialize with container (document.body since overlay is fixed position)
            // Ensure we have an item context before initializing
            if (this.currentMediaItem) {
                this.subtitleManager = new SubtitleManager(document.body);
                console.log('[TizenAdapter] SubtitleManager initialized');
            } else {
                console.warn('[TizenAdapter] No media item for SubtitleManager');
            }
        }

        try {
            this.currentUrl = url;

            // AVPlay renders video on a separate layer BEHIND the HTML layer
            // We need to make the app layer transparent to see the video
            // Hide HTML video element and make backgrounds transparent
            if (this.videoElement) {
                this.videoElement.style.display = 'none';
                // Also save and clear video element's background
                this.originalVideoBackground = this.videoElement.style.background;
                this.videoElement.style.background = 'transparent';
                console.log('[TizenAdapter] Hidden HTML video element for AVPlay rendering');
            }

            // Make body transparent so AVPlay video layer shows through
            // Save original background to restore on destroy
            this.originalBodyBackground = document.body.style.background;
            document.body.style.background = 'transparent';
            console.log('[TizenAdapter] Set body to transparent for AVPlay video layer');

            // Close previous session if any
            try {
                webapis.avplay.close();
            } catch (e) { }

            // Open new media
            webapis.avplay.open(url);

            // Configure streaming properties for HEVC/4K content
            // This is CRITICAL for Direct Play of HEVC on Samsung TVs
            this.configureStreamingProperties(url, options);

            // Get actual screen resolution from Tizen TV API
            var screenWidth = window.innerWidth;
            var screenHeight = window.innerHeight;

            try {
                if (typeof webapis !== 'undefined' && webapis.productinfo) {
                    var resolution = webapis.productinfo.getResolution();
                    if (resolution) {
                        screenWidth = resolution.width || screenWidth;
                        screenHeight = resolution.height || screenHeight;
                        console.log('[TizenAdapter] Using TV resolution:', screenWidth + 'x' + screenHeight);
                    }
                }
            } catch (e) {
                console.log('[TizenAdapter] Could not get TV resolution, using window size:', screenWidth + 'x' + screenHeight);
            }

            // Set display area to full screen
            console.log('[TizenAdapter] Setting display rect: 0, 0,', screenWidth, 'x', screenHeight);
            webapis.avplay.setDisplayRect(0, 0, screenWidth, screenHeight);

            // Set display mode - try multiple modes for compatibility with older Tizen versions
            var displayModeSet = false;
            var displayModes = [
                'PLAYER_DISPLAY_MODE_LETTER_BOX',
                'PLAYER_DISPLAY_MODE_AUTO_ASPECT_RATIO',
                'PLAYER_DISPLAY_MODE_FULL_SCREEN'
            ];

            for (var i = 0; i < displayModes.length && !displayModeSet; i++) {
                try {
                    webapis.avplay.setDisplayMethod(displayModes[i]);
                    console.log('[TizenAdapter] Set display mode to:', displayModes[i]);
                    displayModeSet = true;
                } catch (e) {
                    console.warn('[TizenAdapter] Display mode', displayModes[i], 'not supported:', e.message);
                }
            }

            // Configure listener
            var listener = {
                onbufferingstart: () => {
                    console.log('[TizenAdapter] Buffering started');
                    this.emit('buffering', true);
                },
                onbufferingprogress: (percent) => {
                    console.log('[TizenAdapter] Buffering:', percent + '%');
                },
                onbufferingcomplete: () => {
                    console.log('[TizenAdapter] Buffering complete');
                    this.emit('buffering', false);

                    // Retry pending track selection if needed
                    if (this.pendingAudioIndex !== undefined && this.pendingAudioIndex !== -1) {
                        console.log('[TizenAdapter] Retrying pending audio selection after buffering:', this.pendingAudioIndex);
                        if (this.selectAudioTrack(this.pendingAudioIndex)) {
                            this.pendingAudioIndex = -1;
                        }
                    }
                },
                onstreamcompleted: () => {
                    console.log('[TizenAdapter] Stream completed');
                    this.emit('ended');
                },
                oncurrentplaytime: (currentTime) => {
                    // Update video element time for compatibility
                    const timeInSeconds = currentTime / 1000;
                    if (this.videoElement) {
                        Object.defineProperty(this.videoElement, 'currentTime', {
                            get: () => timeInSeconds,
                            set: (val) => { this.seek(val); },
                            configurable: true
                        });
                        // Trigger timeupdate event on video element for UI updates
                        this.videoElement.dispatchEvent(new Event('timeupdate'));
                    }

                    // Update subtitles
                    if (this.subtitleManager) {
                        this.subtitleManager.update(currentTime);
                    }

                    this.emit('timeupdate', { currentTime: timeInSeconds });

                    // Final safety check: if we started playing and still have a pending track, try one last time
                    if (this.pendingAudioIndex !== undefined && this.pendingAudioIndex !== -1 && currentTime > 0) {
                        if (this.selectAudioTrack(this.pendingAudioIndex)) {
                            this.pendingAudioIndex = -1;
                        }
                    }
                },
                onerror: (errorType) => {
                    // Get detailed error info for debugging
                    var state = 'UNKNOWN';
                    try {
                        state = webapis.avplay.getState();
                    } catch (e) { }

                    var errorDetails = {
                        type: errorType,
                        state: state,
                        url: this.currentUrl ? this.currentUrl.substring(0, 100) : 'none'
                    };

                    console.error('[TizenAdapter] Playback error:', errorDetails);

                    this.emit('error', {
                        type: 'TIZEN_AVPLAY_ERROR',
                        code: errorType,
                        details: errorDetails,
                        fatal: true
                    });
                },
                onevent: (eventType, eventData) => {
                    console.log('[TizenAdapter] Event:', eventType, eventData);
                },
                onsubtitlechange: (duration, text, data3, data4) => {
                    // Handle embedded subtitles
                },
                ondrmevent: (drmEvent, drmData) => {
                    console.log('[TizenAdapter] DRM Event:', drmEvent);
                }
            };

            webapis.avplay.setListener(listener);

            // Prepare async
            await this.prepareAsync();

            // Set start position if provided
            if (options.startPosition && options.startPosition > 0) {
                webapis.avplay.seekTo(options.startPosition * 1000);
            }

            this.emit('loaded', { url });

        } catch (error) {
            console.error('[TizenAdapter] Load error:', error);
            this.emit('error', error);
            throw error;
        }
    }

    prepareAsync() {
        return new Promise((resolve, reject) => {
            try {
                console.log('[TizenAdapter] Starting prepareAsync...');
                webapis.avplay.prepareAsync(
                    () => {
                        this.isPrepared = true;
                        this.duration = webapis.avplay.getDuration() / 1000;

                        // Log AVPlay state for debugging
                        var state = 'UNKNOWN';
                        try {
                            state = webapis.avplay.getState();
                        } catch (e) { }

                        console.log('[TizenAdapter] Prepared successfully');
                        console.log('[TizenAdapter] Duration:', this.duration, 'seconds');
                        console.log('[TizenAdapter] State:', state);

                        // Log stream info to debug codec detection
                        try {
                            var streamInfo = webapis.avplay.getCurrentStreamInfo();
                            console.log('[TizenAdapter] Stream info:', JSON.stringify(streamInfo, null, 2));

                            var trackInfo = webapis.avplay.getTotalTrackInfo();
                            console.log('[TizenAdapter] Track count:', trackInfo.length);
                            for (var t = 0; t < trackInfo.length; t++) {
                                console.log('[TizenAdapter] Track', t, ':', trackInfo[t].type, '-', JSON.stringify(trackInfo[t].extra_info));
                            }
                        } catch (infoErr) {
                            console.warn('[TizenAdapter] Could not get stream info:', infoErr);
                        }

                        // Update video element duration for UI compatibility
                        if (this.videoElement) {
                            Object.defineProperty(this.videoElement, 'duration', {
                                get: () => this.duration,
                                configurable: true
                            });
                            // Trigger loadedmetadata for UI initialization
                            this.videoElement.dispatchEvent(new Event('loadedmetadata'));
                        }

                        // Apply initial track preferences if provided
                        if (this.options) {
                            if (typeof this.options.initialAudioIndex === 'number' && this.options.initialAudioIndex >= 0) {
                                console.log('[TizenAdapter] Applying initial audio track preference:', this.options.initialAudioIndex);
                                if (!this.selectAudioTrack(this.options.initialAudioIndex)) {
                                    console.log('[TizenAdapter] Selection failed/deferred, storing as pending');
                                    this.pendingAudioIndex = this.options.initialAudioIndex;
                                }
                            }
                            if (typeof this.options.initialSubtitleIndex === 'number') {
                                console.log('[TizenAdapter] Applying initial subtitle track preference:', this.options.initialSubtitleIndex);
                                this.selectSubtitleTrack(this.options.initialSubtitleIndex);
                            }
                        }

                        resolve();
                    },
                    (error) => {
                        console.error('[TizenAdapter] Prepare failed:', error);
                        reject(error);
                    }
                );
            } catch (e) {
                reject(e);
            }
        });
    }

    play() {
        try {
            console.log('[TizenAdapter] Calling play()');

            // Try pending audio selection before playing
            if (this.pendingAudioIndex !== undefined && this.pendingAudioIndex !== -1) {
                console.log('[TizenAdapter] Retrying pending audio selection before play:', this.pendingAudioIndex);
                if (this.selectAudioTrack(this.pendingAudioIndex)) {
                    this.pendingAudioIndex = -1;
                }
            }

            webapis.avplay.play();

            // Log state after play
            setTimeout(() => {
                try {
                    const state = webapis.avplay.getState();
                    console.log('[TizenAdapter] State after play():', state);
                } catch (e) { }
            }, 100);

            return Promise.resolve();
        } catch (error) {
            console.error('[TizenAdapter] Play error:', error);
            return Promise.reject(error);
        }
    }

    pause() {
        try {
            webapis.avplay.pause();
        } catch (error) {
            console.error('[TizenAdapter] Pause error:', error);
        }
    }

    seek(time) {
        try {
            webapis.avplay.seekTo(time * 1000);
        } catch (error) {
            console.error('[TizenAdapter] Seek error:', error);
        }
    }

    getCurrentTime() {
        try {
            return webapis.avplay.getCurrentTime() / 1000;
        } catch (error) {
            return 0;
        }
    }

    getDuration() {
        try {
            return webapis.avplay.getDuration() / 1000;
        } catch (error) {
            return this.duration;
        }
    }

    isPaused() {
        try {
            const state = webapis.avplay.getState();
            return state === 'PAUSED' || state === 'IDLE' || state === 'READY' || state === 'NONE';
        } catch (error) {
            return true;
        }
    }

    stop() {
        try {
            webapis.avplay.stop();
            // Restore video element visibility
            if (this.videoElement) {
                this.videoElement.style.display = '';
            }
        } catch (error) {
            console.error('[TizenAdapter] Stop error:', error);
        }
    }

    setPlaybackRate(rate) {
        try {
            webapis.avplay.setSpeed(rate);
        } catch (error) {
            console.error('[TizenAdapter] SetSpeed error:', error);
        }
    }

    selectAudioTrack(trackIndex) {
        try {
            const totalTracks = webapis.avplay.getTotalTrackInfo();
            let audioCount = 0;

            if (window.debugOverlay) window.debugOverlay.log('[TizenAdapter] selecting Audio Index: ' + trackIndex);

            for (let i = 0; i < totalTracks.length; i++) {
                if (totalTracks[i].type === 'AUDIO') {
                    if (audioCount === trackIndex) {
                        if (window.debugOverlay) window.debugOverlay.log('[TizenAdapter] Found matching track ID: ' + totalTracks[i].index);
                        webapis.avplay.setSelectTrack('AUDIO', totalTracks[i].index);
                        return true;
                    }
                    audioCount++;
                }
            }
            console.warn('[TizenAdapter] Audio track not found for index:', trackIndex);
            return false;
        } catch (error) {
            console.error('[TizenAdapter] Audio track selection error:', error);
            return false;
        }
    }

    selectSubtitleTrack(trackId) {
        try {
            if (trackId === -1) {
                webapis.avplay.setSilentSubtitle(true);
                if (this.subtitleManager) {
                    this.subtitleManager.disable();
                }
                return true;
            }

            // Try SubtitleManager first (for external SRT/VTT)
            // Try SubtitleManager first (for external SRT/VTT)
            if (window.debugOverlay) window.debugOverlay.log('TizenAdapter selectTrack: ' + trackId);

            if (this.subtitleManager && this.currentMediaSource) {
                // Find the stream in MediaSource
                const streams = this.currentMediaSource.MediaStreams || [];
                if (window.debugOverlay) window.debugOverlay.log('Looking for TrackID: ' + trackId + ' (' + typeof trackId + ')');

                // Debug available streams
                const subStreams = streams.filter(s => s.Type === 'Subtitle');
                if (window.debugOverlay && subStreams.length > 0) {
                    window.debugOverlay.log('Avail Subs: ' + subStreams.map(s => s.Index + '[' + s.IsExternal + ']').join(', '));
                }

                // Loose equality check for flexibility
                const track = streams.find(s => s.Type === 'Subtitle' && s.Index == trackId);

                // Determine if we should handle this via SubtitleManager
                // 1. It is explicitly external
                // 2. OR it is a text format (not PGS/DVD) that we can render manually
                const codec = (track && track.Codec ? track.Codec.toLowerCase() : '');
                const isImageFormat = ['hdmv_pgs_subtitle', 'pgs', 'dvd_subtitle', 'dvdsub', 'vobsub'].includes(codec);
                const isTextFormat = !isImageFormat;

                const isExternal = track && track.IsExternal;
                const shouldUseManager = track && (isExternal || isTextFormat);

                if (window.debugOverlay) {
                    window.debugOverlay.log('Track Check - Codec: ' + codec +
                        ', IsExt: ' + isExternal +
                        ', IsText: ' + isTextFormat);
                }

                if (shouldUseManager) {
                    // Load the track using SubtitleManager
                    console.log('[TizenAdapter] Text/External track detected, delegating to SubtitleManager');
                    if (window.debugOverlay) window.debugOverlay.log('Delegating ' + codec + ' to SubMgr');

                    this.subtitleManager.loadTrack(track, this.currentMediaItem, this.currentMediaSource, this.auth);
                    webapis.avplay.setSilentSubtitle(true);
                    return true;
                }
            } else {
                if (window.debugOverlay) window.debugOverlay.log('SubMgr: ' + (!!this.subtitleManager) + ', Src: ' + (!!this.currentMediaSource));
            }

            // Fallback to AVPlay internal tracks
            if (window.debugOverlay) window.debugOverlay.log('Falling back to internal track');
            if (this.subtitleManager) {
                this.subtitleManager.disable(); // Disable overlay if using internal
            }

            webapis.avplay.setSilentSubtitle(false);
            webapis.avplay.setSelectTrack('TEXT', trackId);
            return true;
        } catch (error) {
            console.error('[TizenAdapter] Subtitle track selection error:', error);
            return false;
        }
    }

    getAudioTracks() {
        try {
            const totalTracks = webapis.avplay.getTotalTrackInfo();
            const audioTracks = [];

            for (let i = 0; i < totalTracks.length; i++) {
                if (totalTracks[i].type === 'AUDIO') {
                    audioTracks.push({
                        id: totalTracks[i].index,
                        language: totalTracks[i].extra_info.language || 'Unknown',
                        label: totalTracks[i].extra_info.language || 'Track ' + totalTracks[i].index,
                        enabled: false
                    });
                }
            }
            return audioTracks;
        } catch (error) {
            return [];
        }
    }

    getSubtitleTracks() {
        try {
            const totalTracks = webapis.avplay.getTotalTrackInfo();
            const textTracks = [];

            for (let i = 0; i < totalTracks.length; i++) {
                if (totalTracks[i].type === 'TEXT') {
                    textTracks.push({
                        id: totalTracks[i].index,
                        language: totalTracks[i].extra_info.language || 'Unknown',
                        label: totalTracks[i].extra_info.language || 'Track ' + totalTracks[i].index,
                        kind: 'subtitles'
                    });
                }
            }
            return textTracks;
        } catch (error) {
            return [];
        }
    }

    getStats() {
        const stats = {
            categories: []
        };

        try {
            const streamInfo = webapis.avplay.getCurrentStreamInfo();

            if (streamInfo) {
                const videoCategory = {
                    type: 'video',
                    stats: []
                };

                // Find video stream info
                for (let i = 0; i < streamInfo.length; i++) {
                    if (streamInfo[i].type === 'VIDEO') {
                        const extra = streamInfo[i].extra_info;
                        if (extra) {
                            videoCategory.stats.push({
                                label: 'Video Codec',
                                value: extra.fourCC || 'Unknown'
                            });
                            if (extra.Width && extra.Height) {
                                videoCategory.stats.push({
                                    label: 'Resolution',
                                    value: extra.Width + 'x' + extra.Height
                                });
                            }
                        }
                    }
                }

                stats.categories.push(videoCategory);
            }
        } catch (error) {
            console.warn('[TizenAdapter] Could not get stats:', error);
        }

        return stats;
    }

    async destroy() {
        try {
            webapis.avplay.stop();
            webapis.avplay.close();
            // Restore video element visibility and background
            if (this.videoElement) {
                this.videoElement.style.display = '';
                if (this.originalVideoBackground !== undefined) {
                    this.videoElement.style.background = this.originalVideoBackground;
                }
            }
            // Restore body background
            if (this.originalBodyBackground !== undefined) {
                document.body.style.background = this.originalBodyBackground;
            }
        } catch (error) { }
        this.currentUrl = null;
        this.isPrepared = false;
        this.initialized = false;
        this.initialized = false;

        if (this.subtitleManager) {
            this.subtitleManager.destroy();
            this.subtitleManager = null;
        }

        await super.destroy();
    }

    getName() {
        return 'TizenAVPlay';
    }
}

/**
 * Handle HLS.js media errors with retry logic
 * @param {Object} hlsPlayer - HLS.js player instance
 * @returns {boolean} True if recovery attempted, false if exhausted
 */
function handleHlsJsMediaError(hlsPlayer) {
    if (!hlsPlayer) return false;

    const now = performance.now ? performance.now() : Date.now();

    // First attempt: recover from decoding error
    if (!recoverDecodingErrorDate || (now - recoverDecodingErrorDate) > 3000) {
        recoverDecodingErrorDate = now;
        console.log('[HLS Recovery] Attempting to recover from media error...');
        hlsPlayer.recoverMediaError();
        return true;
    }
    // Second attempt: swap audio codec and recover
    else if (!recoverSwapAudioCodecDate || (now - recoverSwapAudioCodecDate) > 3000) {
        recoverSwapAudioCodecDate = now;
        console.log('[HLS Recovery] Swapping audio codec and recovering...');
        hlsPlayer.swapAudioCodec();
        hlsPlayer.recoverMediaError();
        return true;
    }
    // Failed: cannot recover
    else {
        console.error('[HLS Recovery] Cannot recover, last attempts failed');
        return false;
    }
}

/**
 * Get cross-origin value based on media source
 * @param {Object} mediaSource - Media source info
 * @returns {string|null} Cross-origin value
 */
function getCrossOriginValue(mediaSource) {
    if (mediaSource && mediaSource.IsRemote) {
        return null;
    }
    return 'anonymous';
}

/**
 * HTML5 Video Element Adapter (Fallback)
 */
class HTML5VideoAdapter extends VideoPlayerAdapter {
    constructor(videoElement) {
        super(videoElement);
        this.initialized = false;
        this.hlsPlayer = null;
    }

    async initialize() {
        this.initialized = true;
        return true;
    }

    async load(url, options = {}) {
        if (!this.initialized) {
            throw new Error('HTML5 Video adapter not initialized');
        }

        console.log('[HTML5Adapter] Loading:', url.substring(0, 80) + '...');

        try {
            // Check if HLS stream and HLS.js is available
            const isHLS = url.includes('.m3u8') || (options.mimeType && options.mimeType.includes('mpegURL'));

            if (isHLS && typeof Hls !== 'undefined' && Hls.isSupported()) {
                return this.loadWithHlsJs(url, options);
            }

            // Set cross-origin if needed
            const crossOrigin = getCrossOriginValue(options.mediaSource);
            if (crossOrigin) {
                this.videoElement.crossOrigin = crossOrigin;
            }

            // Set src directly on video element, NOT via source child
            // This is critical for Tizen compatibility
            this.videoElement.src = url;

            if (options.mimeType) {
                this.videoElement.setAttribute('type', options.mimeType);
            }

            this.emit('loaded', { url });

            this.videoElement.load();

            if (options.startPosition && options.startPosition > 0) {
                this.videoElement.currentTime = options.startPosition;
            }

            // Wait for video to be ready with timeout
            return new Promise((resolve, reject) => {
                let timeoutId = null;

                const cleanup = () => {
                    if (timeoutId) clearTimeout(timeoutId);
                    this.videoElement.removeEventListener('canplay', onCanPlay);
                    this.videoElement.removeEventListener('loadedmetadata', onLoadedMetadata);
                    this.videoElement.removeEventListener('error', onError);
                };

                const onCanPlay = () => {
                    console.log('[HTML5Adapter] canplay event fired');
                    cleanup();
                    resolve();
                };

                const onLoadedMetadata = () => {
                    console.log('[HTML5Adapter] loadedmetadata event fired, waiting for canplay...');
                    // Metadata loaded, extend timeout since we're making progress
                    if (timeoutId) {
                        clearTimeout(timeoutId);
                        timeoutId = setTimeout(onTimeout, 15000); // Extend by 15 more seconds
                    }
                };

                const onError = (e) => {
                    console.error('[HTML5Adapter] Video error event:', e);
                    console.error('[HTML5Adapter] Video error code:', this.videoElement.error ? this.videoElement.error.code : 'none');
                    console.error('[HTML5Adapter] Video error message:', this.videoElement.error ? this.videoElement.error.message : 'none');

                    // Log to server
                    if (typeof ServerLogger !== 'undefined') {
                        ServerLogger.logPlaybackError('HTML5 video load error', {
                            errorCode: this.videoElement.error ? this.videoElement.error.code : 'unknown',
                            errorMessage: this.videoElement.error ? this.videoElement.error.message : 'unknown',
                            url: url.substring(0, 100)
                        });
                    }

                    cleanup();
                    reject(new Error('Video load error: ' + (this.videoElement.error ? this.videoElement.error.message : 'Unknown error')));
                };

                const onTimeout = () => {
                    console.warn('[HTML5Adapter] Video load timeout - readyState:', this.videoElement.readyState);

                    // Log to server
                    if (typeof ServerLogger !== 'undefined') {
                        ServerLogger.logPlaybackWarning('HTML5 video load timeout', {
                            readyState: this.videoElement.readyState,
                            networkState: this.videoElement.networkState,
                            url: url.substring(0, 100)
                        });
                    }

                    cleanup();
                    // Don't reject immediately - resolve and let health check handle fallback
                    // This allows the player to try and may work on some devices
                    resolve();
                };

                this.videoElement.addEventListener('canplay', onCanPlay);
                this.videoElement.addEventListener('loadedmetadata', onLoadedMetadata);
                this.videoElement.addEventListener('error', onError);

                // Set timeout for load (10 seconds initial)
                timeoutId = setTimeout(onTimeout, 10000);

                // Try to trigger load
                this.videoElement.load();
            });

        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }

    /**
     * Load HLS stream using HLS.js with error recovery
     * Configuration matches jellyfin-web for maximum compatibility
     * @private
     */
    loadWithHlsJs(url, options = {}) {
        return new Promise((resolve, reject) => {
            console.log('[HTML5+HLS.js] Loading HLS stream:', url.substring(0, 100) + '...');

            // Destroy existing HLS player
            if (this.hlsPlayer) {
                try {
                    this.hlsPlayer.destroy();
                } catch (e) {
                    console.warn('[HTML5+HLS.js] Error destroying old player:', e);
                }
                this.hlsPlayer = null;
            }

            // HLS.js configuration matching jellyfin-web settings
            const hlsConfig = {
                // Loading timeouts
                manifestLoadingTimeOut: 20000,
                manifestLoadingMaxRetry: 4,
                manifestLoadingRetryDelay: 1000,
                levelLoadingTimeOut: 20000,
                levelLoadingMaxRetry: 4,
                levelLoadingRetryDelay: 1000,
                fragLoadingTimeOut: 20000,
                fragLoadingMaxRetry: 6,
                fragLoadingRetryDelay: 1000,

                // Buffer settings for smooth playback
                maxBufferLength: 30,
                maxMaxBufferLength: 600,
                maxBufferSize: 60 * 1000 * 1000, // 60 MB
                maxBufferHole: 0.5,

                // Back buffer for seeking back
                backBufferLength: 90,
                liveBackBufferLength: 90,

                // Low latency mode disabled for VOD transcodes
                lowLatencyMode: false,

                // Start position
                startPosition: options.startPosition || -1,

                // ABR (Adaptive Bitrate) settings
                abrEwmaDefaultEstimate: 5000000, // 5 Mbps default
                abrEwmaFastLive: 3.0,
                abrEwmaSlowLive: 9.0,
                abrEwmaFastVoD: 3.0,
                abrEwmaSlowVoD: 9.0,
                abrBandWidthFactor: 0.95,
                abrBandWidthUpFactor: 0.7,
                enableWorker: true,
                xhrSetup: (xhr, url) => {
                    xhr.withCredentials = options.withCredentials || false;
                }
            };

            console.log('[HTML5+HLS.js] Initializing with config:', {
                startPosition: hlsConfig.startPosition,
                maxBufferLength: hlsConfig.maxBufferLength,
                backBufferLength: hlsConfig.backBufferLength
            });

            const hls = new Hls(hlsConfig);
            console.log('[HTML5+HLS.js] HLS instance created');

            let manifestParsed = false;
            let hasError = false;

            console.log('[HTML5+HLS.js] Loading source...');
            hls.loadSource(url);
            console.log('[HTML5+HLS.js] Attaching media...');
            hls.attachMedia(this.videoElement);
            console.log('[HTML5+HLS.js] Waiting for manifest...');

            hls.on(Hls.Events.MEDIA_ATTACHED, () => {
                console.log('[HTML5+HLS.js] Media attached to video element');
            });

            hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
                manifestParsed = true;
                console.log('[HTML5+HLS.js] Manifest parsed successfully');
                console.log('[HTML5+HLS.js] Levels available:', data.levels.length);
                if (data.levels.length > 0) {
                    const level = data.levels[0];
                    console.log('[HTML5+HLS.js] First level:', level.width + 'x' + level.height, '@', level.bitrate, 'bps');
                }
                console.log('[HTML5+HLS.js] Audio tracks:', (data.audioTracks && data.audioTracks.length) || 0);

                this.emit('loaded', { url });
                this.emit('buffering', false);

                console.log('[HTML5+HLS.js] Video element state before play:', {
                    paused: this.videoElement.paused,
                    readyState: this.videoElement.readyState,
                    networkState: this.videoElement.networkState,
                    currentTime: this.videoElement.currentTime
                });

                // Try to play - critical for transcoded streams
                this.videoElement.play()
                    .then(() => {
                        console.log('[HTML5+HLS.js] Playback started successfully');
                        resolve();
                    })
                    .catch((err) => {
                        console.error('[HTML5+HLS.js] Play failed:', err);
                        console.error('[HTML5+HLS.js] Error name:', err.name);
                        console.error('[HTML5+HLS.js] Error message:', err.message);

                        // Log to server for diagnostics
                        if (typeof ServerLogger !== 'undefined') {
                            ServerLogger.logPlaybackWarning('HLS play() failed after manifest parsed', {
                                errorName: err.name,
                                errorMessage: err.message,
                                paused: this.videoElement.paused,
                                readyState: this.videoElement.readyState,
                                networkState: this.videoElement.networkState
                            });
                        }

                        // Still resolve. the player controller will handle retrying
                        resolve();
                    });
            });

            hls.on(Hls.Events.LEVEL_LOADED, (event, data) => {
                console.log('[HTML5+HLS.js] Level loaded:', data.level, 'fragments:', data.details.fragments.length);
            });

            hls.on(Hls.Events.FRAG_LOADED, (event, data) => {
                // Log first few fragments for debugging
                if (data.frag.sn < 3) {
                    console.log('[HTML5+HLS.js] Fragment loaded:', data.frag.sn, 'duration:', data.frag.duration.toFixed(2) + 's');
                }
            });

            hls.on(Hls.Events.ERROR, (event, data) => {
                console.error('[HTML5+HLS.js] Error:', data.type, data.details);
                if (data.response) {
                    console.error('[HTML5+HLS.js] Response:', data.response.code, data.response.text);
                }
                if (data.url) {
                    console.error('[HTML5+HLS.js] URL:', data.url.substring(0, 100));
                }
                if (data.reason) {
                    console.error('[HTML5+HLS.js] Reason:', data.reason);
                }

                if (data.fatal) {
                    hasError = true;
                    console.error('[HTML5+HLS.js] Fatal error occurred');

                    // Log to ServerLogger for diagnostics
                    if (typeof ServerLogger !== 'undefined') {
                        ServerLogger.logPlaybackError('HLS.js fatal error: ' + data.type + ' - ' + data.details, {
                            errorType: data.type,
                            errorDetails: data.details,
                            responseCode: data.response ? data.response.code : 'N/A',
                            url: data.url ? data.url.substring(0, 100) : 'N/A',
                            reason: data.reason || 'Unknown'
                        });
                    }

                    switch (data.type) {
                        case Hls.ErrorTypes.NETWORK_ERROR:
                            // Try to recover from network errors
                            if (data.response && data.response.code >= 400 && data.response.code < 500) {
                                // 4xx errors are unrecoverable (auth, not found, etc.)
                                console.error('[HTML5+HLS.js] Unrecoverable network error:', data.response.code);

                                // Special handling for 401/403 - likely reverse proxy auth issue
                                if (data.response.code === 401 || data.response.code === 403) {
                                    console.error('[HTML5+HLS.js] Authentication error - check reverse proxy configuration');
                                }

                                hls.destroy();
                                this.emit('error', { type: MediaError.SERVER_ERROR, details: data });
                                reject(new Error(MediaError.SERVER_ERROR + ': HTTP ' + data.response.code));
                            } else if (data.response && data.response.code === 0) {
                                // Status 0 often means CORS issue or network unreachable
                                console.error('[HTML5+HLS.js] Network error (status 0) - possible CORS or connectivity issue');
                                hls.startLoad();
                            } else {
                                // Try to recover from other network errors
                                console.log('[HTML5+HLS.js] Attempting network error recovery...');
                                hls.startLoad();
                            }
                            break;

                        case Hls.ErrorTypes.MEDIA_ERROR:
                            console.log('[HTML5+HLS.js] Media error, attempting recovery...');
                            if (handleHlsJsMediaError(hls)) {
                                console.log('[HTML5+HLS.js] Media error recovery initiated');
                            } else {
                                console.error('[HTML5+HLS.js] Media error recovery exhausted');
                                hls.destroy();
                                this.emit('error', { type: MediaError.MEDIA_DECODE_ERROR, details: data });
                                reject(new Error(MediaError.MEDIA_DECODE_ERROR));
                            }
                            break;

                        default:
                            console.error('[HTML5+HLS.js] Unhandled fatal error type:', data.type);
                            hls.destroy();
                            this.emit('error', { type: MediaError.FATAL_HLS_ERROR, details: data });
                            reject(new Error(MediaError.FATAL_HLS_ERROR + ': ' + data.details));
                            break;
                    }
                } else {
                    console.warn('[HTML5+HLS.js] Non-fatal error:', data.details);
                }
            });

            hls.on(Hls.Events.FRAG_BUFFERED, () => {
                this.emit('buffering', false);
            });

            this.hlsPlayer = hls;
            this.emit('buffering', true);

            setTimeout(() => {
                if (!manifestParsed && !hasError) {
                    console.error('[HTML5+HLS.js] Manifest load timeout');
                    hls.destroy();
                    this.hlsPlayer = null;
                    reject(new Error('HLS manifest load timeout'));
                }
            }, 30000);
        });
    }

    selectAudioTrack(trackId) {
        try {
            const audioTracks = this.videoElement.audioTracks;
            if (audioTracks && trackId >= 0 && trackId < audioTracks.length) {
                for (let i = 0; i < audioTracks.length; i++) {
                    audioTracks[i].enabled = (i === trackId);
                }
                return true;
            }
            return false;
        } catch (error) {
            return false;
        }
    }

    selectSubtitleTrack(trackId) {
        try {
            const textTracks = this.videoElement.textTracks;

            if (trackId === -1) {
                for (let i = 0; i < textTracks.length; i++) {
                    textTracks[i].mode = 'disabled';
                }
                return true;
            }

            if (textTracks && trackId >= 0 && trackId < textTracks.length) {
                for (let i = 0; i < textTracks.length; i++) {
                    textTracks[i].mode = (i === trackId) ? 'showing' : 'disabled';
                }
                return true;
            }
            return false;
        } catch (error) {
            return false;
        }
    }

    getAudioTracks() {
        const audioTracks = this.videoElement.audioTracks;
        if (!audioTracks) return [];

        const tracks = [];
        for (let i = 0; i < audioTracks.length; i++) {
            const track = audioTracks[i];
            tracks.push({
                id: i,
                language: track.language,
                label: track.label || track.language,
                enabled: track.enabled
            });
        }
        return tracks;
    }

    getSubtitleTracks() {
        const textTracks = this.videoElement.textTracks;
        if (!textTracks) return [];

        const tracks = [];
        for (let i = 0; i < textTracks.length; i++) {
            const track = textTracks[i];
            if (track.kind === 'subtitles' || track.kind === 'captions') {
                tracks.push({
                    id: i,
                    language: track.language,
                    label: track.label || track.language,
                    kind: track.kind
                });
            }
        }
        return tracks;
    }

    /**
     * Get playback statistics
     * @returns {Object} Playback stats
     */
    getStats() {
        const stats = {
            categories: []
        };

        if (!this.videoElement) {
            return stats;
        }

        const videoCategory = {
            type: 'video',
            stats: []
        };

        // Video resolution
        if (this.videoElement.videoWidth && this.videoElement.videoHeight) {
            videoCategory.stats.push({
                label: 'Video Resolution',
                value: `${this.videoElement.videoWidth}x${this.videoElement.videoHeight}`
            });
        }

        // Dropped/corrupted frames
        if (this.videoElement.getVideoPlaybackQuality) {
            const quality = this.videoElement.getVideoPlaybackQuality();
            videoCategory.stats.push({
                label: 'Dropped Frames',
                value: quality.droppedVideoFrames || 0
            });
            videoCategory.stats.push({
                label: 'Corrupted Frames',
                value: quality.corruptedVideoFrames || 0
            });
        }

        stats.categories.push(videoCategory);
        return stats;
    }

    async destroy() {
        // Cleanup HLS.js player
        if (this.hlsPlayer) {
            try {
                this.hlsPlayer.destroy();
            } catch (err) {
                console.error('[HTML5VideoAdapter] Error destroying HLS player:', err);
            }
            this.hlsPlayer = null;
        }

        this.videoElement.innerHTML = '';
        this.initialized = false;
        await super.destroy();
    }

    getName() {
        return 'HTML5Video';
    }
}

/**
 * Video Player Factory
 * Creates the best available player adapter with automatic fallback
 */
class VideoPlayerFactory {
    /**
     * Create a video player adapter with automatic capability detection
     * @param {HTMLVideoElement} videoElement - Video element to use
     * @param {Object} options - Creation options
     * @param {boolean} options.preferTizen - Prefer Tizen AVPlay adapter for HDR/Dolby Vision
     * @param {boolean} options.preferHTML5 - Prefer HTML5 video element for direct files
     * @param {boolean} options.preferHLS - Prefer HLS.js (HTML5 adapter) for HLS streams
     * @returns {Promise<VideoPlayerAdapter>} Initialized player adapter
     */
    static async createPlayer(videoElement, options = {}) {
        // Check if HLS.js is available for HLS streams
        const hlsAvailable = typeof Hls !== 'undefined' && Hls.isSupported();

        // Log availability
        console.log('[PlayerFactory] HLS.js available:', hlsAvailable);
        console.log('[PlayerFactory] Options:', JSON.stringify(options));

        // Determine adapter priority based on platform and playback needs
        let adapters;

        if (options.preferTizen) {
            // For Dolby Vision/HDR: Tizen AVPlay > Shaka > HTML5
            console.log('[PlayerFactory] Mode: Prefer Tizen (HDR/DV content)');
            adapters = [
                TizenVideoAdapter,
                ShakaPlayerAdapter,
                HTML5VideoAdapter
            ];
        } else if (options.preferHLS && hlsAvailable) {
            // For HLS transcoded streams: HTML5+HLS.js > Shaka > Tizen
            // This is the recommended path for transcoded content
            console.log('[PlayerFactory] Mode: Prefer HLS.js for transcoded streams');
            adapters = [
                HTML5VideoAdapter,  // Will use HLS.js internally for .m3u8
                ShakaPlayerAdapter,
                TizenVideoAdapter
            ];
        } else if (options.preferHTML5) {
            // For direct files: HTML5 > Shaka > Tizen
            console.log('[PlayerFactory] Mode: Prefer HTML5 (direct play)');
            adapters = [
                HTML5VideoAdapter,
                ShakaPlayerAdapter,
                TizenVideoAdapter
            ];
        } else {
            // Default: Try Shaka first (handles DASH/HLS), then HTML5, then Tizen
            console.log('[PlayerFactory] Mode: Default (Shaka preferred)');
            adapters = [
                ShakaPlayerAdapter,
                HTML5VideoAdapter,
                TizenVideoAdapter
            ];
        }

        for (const AdapterClass of adapters) {
            try {
                console.log('[PlayerFactory] Attempting:', AdapterClass.name);
                const adapter = new AdapterClass(videoElement);
                const success = await adapter.initialize();

                if (success) {
                    console.log('[PlayerFactory] Using:', adapter.getName());
                    return adapter;
                }
            } catch (error) {
                console.warn('[PlayerFactory]', AdapterClass.name, 'failed:', error.message);
            }
        }

        throw new Error('No video player adapter could be initialized');
    }
}
