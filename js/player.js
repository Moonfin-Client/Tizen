/**
 * Player Controller Module
 * Manages video playback, controls, track selection, and playback reporting
 * Supports direct play, transcoding, and Live TV streaming
 * @module PlayerController
 */
var PlayerController = (function() {
    'use strict';

    let auth = null;
    let itemId = null;
    let itemData = null;
    let videoPlayer = null;
    /** @type {Object|null} Video player adapter (Shaka/Tizen/HTML5) */
    let playerAdapter = null;
    let controlsVisible = false;
    let controlsTimeout = null;
    let playbackInfo = null;
    let playSessionId = null;
    let progressInterval = null;
    let focusableButtons = [];
    let currentFocusIndex = 0;
    let audioStreams = [];
    let subtitleStreams = [];
    let currentAudioIndex = -1;
    let currentSubtitleIndex = -1;
    let audioLanguageMap = []; // Maps Jellyfin stream index to language code
    let modalFocusableItems = [];
    let currentModalFocusIndex = 0;
    let activeModal = null;
    let isSeekbarFocused = false;
    let seekPosition = 0;
    let loadingTimeout = null;
    let seekDebounceTimer = null;
    let isSeeking = false;
    let isSeekingActive = false; // True while user is actively seeking (before debounce completes)
    let pendingSeekPosition = null;
    let hasTriedTranscode = false;
    let currentMediaSource = null;
    let isTranscoding = false;
    let currentPlaybackSpeed = 1.0;
    let isDolbyVisionMedia = false; // Track if current media is Dolby Vision
    let willUseDirectPlay = false; // Track if we plan to use direct play before loading
    let playbackHealthCheckTimer = null; // Timer for checking playback health
    let forcePlayMode = null; // User override for playback mode ('direct' or 'transcode')
    const PLAYBACK_SPEEDS = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];
    let bitrateUpdateInterval = null;
    
    // Skip intro/outro variables
    let mediaSegments = [];
    let currentSkipSegment = null;
    let skipOverlayVisible = false;
    let nextEpisodeData = null;
    
    // Loading state machine
    const LoadingState = {
        IDLE: 'idle',
        INITIALIZING: 'initializing',
        LOADING: 'loading',
        READY: 'ready',
        ERROR: 'error'
    };
    let loadingState = LoadingState.IDLE;

    let elements = {};

    // Timing Constants
    const PROGRESS_REPORT_INTERVAL_MS = 10000;
    const CONTROLS_HIDE_DELAY_MS = 3000;
    const SKIP_INTERVAL_SECONDS = 10;
    const SEEK_DEBOUNCE_MS = 300;
    const BITRATE_UPDATE_INTERVAL_MS = 3000;
    const FOCUS_DELAY_MS = 100;
    const CONTROLS_FADE_DELAY_MS = 300;
    const AUTO_HIDE_CONTROLS_MS = 2000;
    const DIRECT_PLAY_TIMEOUT_MS = 15000;
    const TRANSCODE_TIMEOUT_MS = 45000;
    
    // Jellyfin Ticks Conversion
    const TICKS_PER_SECOND = 10000000;

    /**
     * Attempt fallback to transcoding if direct play fails
     * @param {Object} mediaSource - Original media source
     * @param {string} reason - Reason for fallback
     * @returns {boolean} True if fallback attempted, false if not possible
     */
    function attemptTranscodeFallback(mediaSource, reason) {
        if (hasTriedTranscode) {
            return false;
        }
        
        if (!mediaSource || !mediaSource.SupportsTranscoding) {
            return false;
        }
        
        hasTriedTranscode = true;
        willUseDirectPlay = false; // Reset flag since we're switching to transcoding
        
        var modifiedSource = Object.assign({}, mediaSource);
        modifiedSource.SupportsDirectPlay = false;
        
        clearLoadingTimeout();
        startPlayback(modifiedSource).catch(onError);
        return true;
    }
    
    /**
     * Clear loading timeout safely
     */
    function clearLoadingTimeout() {
        if (loadingTimeout) {
            clearTimeout(loadingTimeout);
            loadingTimeout = null;
        }
    }
    
    /**
     * Set loading state with automatic UI update
     */
    function setLoadingState(state) {
        loadingState = state;
        
        switch (state) {
            case LoadingState.LOADING:
            case LoadingState.INITIALIZING:
                showLoading();
                break;
            case LoadingState.READY:
            case LoadingState.ERROR:
            case LoadingState.IDLE:
                hideLoading();
                break;
        }
        
    }

    function init() {
        console.log('[Player] Initializing player controller');
        
        // Get auth for the specific server from URL params or active server
        auth = typeof MultiServerManager !== 'undefined' 
            ? MultiServerManager.getAuthForPage() 
            : JellyfinAPI.getStoredAuth();
        
        if (!auth) {
            window.location.href = 'login.html';
            return;
        }

        itemId = getItemIdFromUrl();
        if (!itemId) {
            showErrorDialog('Invalid Request', 'No media ID was provided. Please select a media item to play.');
            return;
        }

        cacheElements();
        setupEventListeners();
        // Initialize playback flow (adapter will be created once playback method is known)
        loadItemAndPlay();
    }

    function getItemIdFromUrl() {
        var params = new URLSearchParams(window.location.search);
        return params.get('id');
    }
    
    /**
     * Get the start position (in seconds) from the URL query parameter, if present
     * @returns {number|null} Start position in seconds, or null if not specified
     */
    function getStartPositionFromUrl() {
        var params = new URLSearchParams(window.location.search);
        var position = params.get('position');
        if (position !== null) {
            return parseInt(position, 10);
        }
        return null;
    }

    function cacheElements() {
        elements = {
            videoPlayer: document.getElementById('videoPlayer'),
            videoDimmer: document.getElementById('videoDimmer'),
            playerControls: document.getElementById('playerControls'),
            mediaLogo: document.getElementById('mediaLogo'),
            mediaTitle: document.getElementById('mediaTitle'),
            mediaSubtitle: document.getElementById('mediaSubtitle'),
            progressBar: document.getElementById('progressBar'),
            progressFill: document.getElementById('progressFill'),
            seekIndicator: document.getElementById('seekIndicator'),
            timeDisplay: document.getElementById('timeDisplay'),
            endTime: document.getElementById('endTime'),
            playPauseBtn: document.getElementById('playPauseBtn'),
            rewindBtn: document.getElementById('rewindBtn'),
            forwardBtn: document.getElementById('forwardBtn'),
            audioBtn: document.getElementById('audioBtn'),
            subtitleBtn: document.getElementById('subtitleBtn'),
            chaptersBtn: document.getElementById('chaptersBtn'),
            previousItemBtn: document.getElementById('previousItemBtn'),
            nextItemBtn: document.getElementById('nextItemBtn'),
            videoInfoBtn: document.getElementById('videoInfoBtn'),
            backBtn: document.getElementById('backBtn'),
            loadingIndicator: document.getElementById('loadingIndicator'),
            errorDialog: document.getElementById('errorDialog'),
            errorDialogTitle: document.getElementById('errorDialogTitle'),
            errorDialogMessage: document.getElementById('errorDialogMessage'),
            errorDialogDetails: document.getElementById('errorDialogDetails'),
            errorDialogBtn: document.getElementById('errorDialogBtn'),
            audioModal: document.getElementById('audioModal'),
            audioTrackList: document.getElementById('audioTrackList'),
            subtitleModal: document.getElementById('subtitleModal'),
            subtitleTrackList: document.getElementById('subtitleTrackList'),
            chaptersModal: document.getElementById('chaptersModal'),
            chaptersContent: document.getElementById('chaptersContent'),
            videoInfoModal: document.getElementById('videoInfoModal'),
            videoInfoContent: document.getElementById('videoInfoContent'),
            speedBtn: document.getElementById('speedBtn'),
            speedModal: document.getElementById('speedModal'),
            speedList: document.getElementById('speedList'),
            speedIndicator: document.getElementById('speedIndicator'),
            bitrateIndicator: document.getElementById('bitrateIndicator'),
            qualityBtn: document.getElementById('qualityBtn'),
            qualityModal: document.getElementById('qualityModal'),
            qualityList: document.getElementById('qualityList'),
            playModeBtn: document.getElementById('playModeBtn'),
            playModeModal: document.getElementById('playModeModal'),
            playModeList: document.getElementById('playModeList'),
            skipOverlay: document.getElementById('skipOverlay'),
            skipButton: document.getElementById('skipButton'),
            skipButtonText: document.getElementById('skipButtonText'),
            skipButtonTime: document.getElementById('skipButtonTime'),
            errorDialog: document.getElementById('errorDialog'),
            errorDialogTitle: document.getElementById('errorDialogTitle'),
            errorDialogMessage: document.getElementById('errorDialogMessage'),
            errorDialogDetails: document.getElementById('errorDialogDetails'),
            errorDialogBtn: document.getElementById('errorDialogBtn')
        };

        videoPlayer = elements.videoPlayer;
        
        // Create focusable buttons array for navigation
        focusableButtons = [
            elements.playPauseBtn,
            elements.rewindBtn,
            elements.forwardBtn,
            elements.audioBtn,
            elements.subtitleBtn,
            elements.playModeBtn,
            elements.chaptersBtn,
            elements.previousItemBtn,
            elements.nextItemBtn,
            elements.speedBtn,
            elements.qualityBtn,
            elements.videoInfoBtn,
            elements.backBtn
        ].filter(Boolean);
    }

    function setupEventListeners() {
        // Error dialog
        elements.errorDialogBtn.addEventListener('click', closeErrorDialog);
        // Keyboard controls
        document.addEventListener('keydown', handleKeyDown);

        // Video player events
        videoPlayer.addEventListener('play', onPlay);
        videoPlayer.addEventListener('pause', onPause);
        videoPlayer.addEventListener('timeupdate', onTimeUpdate);
        videoPlayer.addEventListener('ended', onEnded);
        videoPlayer.addEventListener('error', onError);
        videoPlayer.addEventListener('canplay', onCanPlay);
        videoPlayer.addEventListener('loadedmetadata', onLoadedMetadata);
        videoPlayer.addEventListener('waiting', onWaiting);
        videoPlayer.addEventListener('playing', onPlaying);

        // Control buttons
        if (elements.playPauseBtn) {
            elements.playPauseBtn.addEventListener('click', togglePlayPause);
        }
        if (elements.rewindBtn) {
            elements.rewindBtn.addEventListener('click', rewind);
        }
        if (elements.forwardBtn) {
            elements.forwardBtn.addEventListener('click', forward);
        }
        if (elements.backBtn) {
            elements.backBtn.addEventListener('click', exitPlayer);
        }
        if (elements.audioBtn) {
            elements.audioBtn.addEventListener('click', showAudioTrackSelector);
        }
        if (elements.subtitleBtn) {
            elements.subtitleBtn.addEventListener('click', showSubtitleTrackSelector);
        }
        if (elements.chaptersBtn) {
            elements.chaptersBtn.addEventListener('click', showChaptersModal);
        }
        if (elements.previousItemBtn) {
            elements.previousItemBtn.addEventListener('click', playPreviousItem);
        }
        if (elements.nextItemBtn) {
            elements.nextItemBtn.addEventListener('click', playNextItem);
        }
        if (elements.videoInfoBtn) {
            elements.videoInfoBtn.addEventListener('click', showVideoInfo);
        }
        if (elements.speedBtn) {
            elements.speedBtn.addEventListener('click', showPlaybackSpeedSelector);
        }
        if (elements.qualityBtn) {
            elements.qualityBtn.addEventListener('click', showQualitySelector);
        }
        if (elements.playModeBtn) {
            elements.playModeBtn.addEventListener('click', showPlayModeSelector);
        }

        // Skip button
        if (elements.skipButton) {
            elements.skipButton.addEventListener('click', executeSkip);
            elements.skipButton.addEventListener('keydown', function(evt) {
                if (evt.keyCode === KeyCodes.ENTER) {
                    evt.preventDefault();
                    executeSkip();
                }
            });
        }

        // Show controls on any interaction
        document.addEventListener('mousemove', showControls);
        document.addEventListener('click', showControls);
        
        // Progress bar interaction
        if (elements.progressBar) {
            elements.progressBar.setAttribute('tabindex', '0');
            elements.progressBar.addEventListener('click', handleProgressBarClick);
            elements.progressBar.addEventListener('focus', function() {
                isSeekbarFocused = true;
                seekPosition = videoPlayer.currentTime;
            });
            elements.progressBar.addEventListener('blur', function() {
                isSeekbarFocused = false;
            });
        }
    }

    async function ensurePlayerAdapter(options = {}) {
        try {
            // Reuse adapter if it already matches the preference
            if (playerAdapter) {
                const name = playerAdapter.getName();
                if (options.preferTizen && name === 'TizenVideo') {
                    return;
                }
                if (options.preferHTML5 && name === 'HTML5Video') {
                    return;
                }
                if (!options.preferTizen && !options.preferHTML5 && name === 'ShakaPlayer') {
                    return;
                }
                await playerAdapter.destroy();
            }

            showLoading();
            console.log('[Player] Initializing video player adapter');

            playerAdapter = await VideoPlayerFactory.createPlayer(videoPlayer, options);
            console.log('[Player] Using adapter:', playerAdapter.getName());
            
            // Setup adapter event listeners
            playerAdapter.on('error', function(error) {
                onError(error);
            });
            
            playerAdapter.on('buffering', function(buffering) {
                if (buffering) {
                    showLoading();
                } else {
                    hideLoading();
                }
            });
            
            playerAdapter.on('loaded', function(data) {
                hideLoading();
            });
            
            playerAdapter.on('qualitychange', function(data) {
            });
            
            playerAdapter.on('audiotrackchange', function(data) {
                detectCurrentAudioTrack();
            });
        } catch (error) {
            alert('Failed to initialize video player: ' + error.message);
            window.history.back();
        }
    }

    function handleKeyDown(evt) {
        evt = evt || window.event;

        // Handle error dialog first
        if (elements.errorDialog && elements.errorDialog.style.display !== 'none') {
            if (evt.keyCode === KeyCodes.OK || evt.keyCode === KeyCodes.ENTER || 
                evt.keyCode === KeyCodes.BACK) {
                evt.preventDefault();
                closeErrorDialog();
            }
            return;
        }

        // Handle modal navigation separately
        if (activeModal) {
            handleModalKeyDown(evt);
            return;
        }

        switch (evt.keyCode) {
            case KeyCodes.PLAY_PAUSE:
                evt.preventDefault();
                togglePlayPause();
                break;
                
            case KeyCodes.ENTER:
                // Only toggle play/pause if no button is focused
                if (!document.activeElement || !focusableButtons.includes(document.activeElement)) {
                    evt.preventDefault();
                    togglePlayPause();
                }
                // If a button is focused, let it handle the click naturally
                break;

            case KeyCodes.PLAY:
                evt.preventDefault();
                play();
                break;

            case KeyCodes.PAUSE:
                evt.preventDefault();
                pause();
                break;

            case KeyCodes.REWIND:
                evt.preventDefault();
                if (!document.activeElement || !focusableButtons.includes(document.activeElement)) {
                    rewind();
                }
                break;

            case KeyCodes.FORWARD:
                evt.preventDefault();
                if (!document.activeElement || !focusableButtons.includes(document.activeElement)) {
                    forward();
                }
                break;

            case KeyCodes.BACK:
                evt.preventDefault();
                // If controls are visible, just hide them instead of exiting
                if (controlsVisible) {
                    hideControls();
                    controlsVisible = false;
                } else {
                    exitPlayer();
                }
                break;

            case KeyCodes.UP:
                evt.preventDefault();
                showControls();
                // Move from seekbar to buttons above, or from bottom buttons to seekbar
                if (isSeekbarFocused) {
                    // Move from seekbar to first button (play button)
                    if (focusableButtons.length > 0) {
                        currentFocusIndex = 0;
                        focusableButtons[currentFocusIndex].focus();
                    }
                } else if (document.activeElement && focusableButtons.includes(document.activeElement)) {
                    // If on the bottom buttons (chaptersBtn or videoInfoBtn), move to seekbar
                    if (currentFocusIndex === focusableButtons.length - 1 || currentFocusIndex === focusableButtons.length - 2) {
                        if (elements.progressBar) {
                            elements.progressBar.focus();
                        }
                    }
                }
                break;
                
            case KeyCodes.DOWN:
                evt.preventDefault();
                showControls();
                // Move from buttons to seekbar, or from seekbar to bottom buttons
                if (document.activeElement && focusableButtons.includes(document.activeElement)) {
                    // If on any of the top buttons, move to seekbar
                    if (currentFocusIndex < focusableButtons.length - 2) {
                        if (elements.progressBar) {
                            elements.progressBar.focus();
                        }
                    }
                } else if (isSeekbarFocused) {
                    // Move from seekbar to first bottom button (chaptersBtn)
                    if (focusableButtons.length > 1) {
                        currentFocusIndex = focusableButtons.length - 2;
                        focusableButtons[currentFocusIndex].focus();
                    }
                } else if (focusableButtons.length > 0) {
                    currentFocusIndex = 0;
                    focusableButtons[currentFocusIndex].focus();
                }
                break;
                
            case KeyCodes.LEFT:
                if (isSeekbarFocused) {
                    // Seek backward on seekbar
                    evt.preventDefault();
                    seekBackward();
                } else if (document.activeElement && focusableButtons.includes(document.activeElement)) {
                    evt.preventDefault();
                    currentFocusIndex = (currentFocusIndex - 1 + focusableButtons.length) % focusableButtons.length;
                    focusableButtons[currentFocusIndex].focus();
                }
                break;
                
            case KeyCodes.RIGHT:
                if (isSeekbarFocused) {
                    // Seek forward on seekbar
                    evt.preventDefault();
                    seekForward();
                } else if (document.activeElement && focusableButtons.includes(document.activeElement)) {
                    evt.preventDefault();
                    currentFocusIndex = (currentFocusIndex + 1) % focusableButtons.length;
                    focusableButtons[currentFocusIndex].focus();
                }
                break;
        }
    }

    /**
     * Handle keyboard navigation within modal dialogs
     * @param {KeyboardEvent} evt - Keyboard event
     */
    function handleModalKeyDown(evt) {
        // Special handling for video info modal - scroll instead of navigating items
        if (activeModal === 'videoInfo') {
            switch (evt.keyCode) {
                case KeyCodes.UP:
                    evt.preventDefault();
                    if (elements.videoInfoContent) {
                        elements.videoInfoContent.scrollTop -= 60; // Scroll up
                    }
                    break;
                    
                case KeyCodes.DOWN:
                    evt.preventDefault();
                    if (elements.videoInfoContent) {
                        elements.videoInfoContent.scrollTop += 60; // Scroll down
                    }
                    break;
                    
                case KeyCodes.BACK:
                case KeyCodes.ESC:
                    evt.preventDefault();
                    closeModal();
                    break;
            }
            return;
        }
        
        // Standard modal navigation for other modals
        currentModalFocusIndex = TrackSelector.handleModalKeyDown(
            evt,
            modalFocusableItems,
            currentModalFocusIndex,
            closeModal
        );
    }

    function loadItemAndPlay() {
        showLoading();

        var endpoint = '/Users/' + auth.userId + '/Items/' + itemId;
        var params = {
            Fields: 'MediaSources,MediaStreams,Chapters'
        };

        JellyfinAPI.getItems(auth.serverAddress, auth.accessToken, endpoint, params, function(err, data) {
            if (err || !data) {
                alert('Failed to load media item');
                window.history.back();
                return;
            }

            itemData = data;
            console.log('[Player] Loaded item:', itemData.Name, 'Type:', itemData.Type);

            // Set media info. Prefering the logo over title text
            var hasLogo = false;
            
            // Try to get logo image (for series/movies with logo)
            if (itemData.ImageTags && itemData.ImageTags.Logo) {
                if (elements.mediaLogo) {
                    elements.mediaLogo.src = auth.serverAddress + '/Items/' + itemData.Id +
                        '/Images/Logo?quality=90&maxHeight=150';
                    elements.mediaLogo.style.display = 'block';
                    hasLogo = true;
                }
            } else if (itemData.SeriesId && itemData.Type === 'Episode') {
                // For episodes, try to get the series logo
                if (elements.mediaLogo) {
                    elements.mediaLogo.src = auth.serverAddress + '/Items/' + itemData.SeriesId +
                        '/Images/Logo?quality=90&maxHeight=150';
                    elements.mediaLogo.style.display = 'block';
                    hasLogo = true;
                }
            }
            
            // Fallback to title text if no logo :(
            if (!hasLogo && elements.mediaTitle) {
                elements.mediaTitle.textContent = itemData.Name;
                elements.mediaTitle.style.display = 'block';
                if (elements.mediaLogo) {
                    elements.mediaLogo.style.display = 'none';
                }
            } else if (elements.mediaTitle) {
                elements.mediaTitle.style.display = 'none';
            }

            if (elements.mediaSubtitle && itemData.Type === 'Episode') {
                var subtitle = '';
                if (itemData.SeriesName) subtitle += itemData.SeriesName;
                if (itemData.SeasonName) subtitle += ' - ' + itemData.SeasonName;
                if (itemData.IndexNumber) subtitle += ' - Episode ' + itemData.IndexNumber;
                elements.mediaSubtitle.textContent = subtitle;
            }

            // Load media segments and next episode data for episodes
            loadMediaSegments();
            loadNextEpisode();

            // Get playback info
            getPlaybackInfo();
        });
    }

    function getPlaybackInfo() {
        var playbackUrl = auth.serverAddress + '/Items/' + itemId + '/PlaybackInfo';
        
        // Check if this is Live TV
        var isLiveTV = itemData && itemData.Type === 'TvChannel';
        
        var requestData = {
            UserId: auth.userId,
            DeviceProfile: getDeviceProfile(),
            // For Live TV, we need to auto-open the live stream
            AutoOpenLiveStream: isLiveTV
        };

        ajax.request(playbackUrl, {
            method: 'POST',
            headers: {
                'X-Emby-Authorization': JellyfinAPI.getAuthHeader(auth.accessToken),
                'Content-Type': 'application/json'
            },
            data: requestData,
            success: function(response) {
                playbackInfo = response;
                
                // Detect if this is Dolby Vision content and set flag for adapter selection
                if (playbackInfo.MediaSources && playbackInfo.MediaSources.length > 0) {
                    var mediaSource = playbackInfo.MediaSources[0];
                    var videoStream = mediaSource.MediaStreams ? mediaSource.MediaStreams.find(function(s) { return s.Type === 'Video'; }) : null;
                    
                    isDolbyVisionMedia = videoStream && videoStream.Codec && 
                        (videoStream.Codec.toLowerCase().startsWith('dvhe') || videoStream.Codec.toLowerCase().startsWith('dvh1'));
                    
                    if (isDolbyVisionMedia) {
                        console.log('[Player] Dolby Vision media detected, will use Tizen native adapter if available');
                    }
                }
                
                // Start playback
                if (playbackInfo.MediaSources && playbackInfo.MediaSources.length > 0) {
                    startPlayback(playbackInfo.MediaSources[0]).catch(onError);
                } else {
                    showErrorDialog(
                        'No Media Sources',
                        'No playable media sources were found for this item.',
                        'The server did not provide any compatible media streams.'
                    );
                }
            },
            error: function(err) {
                var title = 'Playback Error';
                var message = 'Failed to get playback information from the server.';
                var details = '';
                
                if (err && err.error === 500) {
                    title = 'Server Error';
                    message = 'The Jellyfin server encountered an error processing this item.';
                    details = 'This may indicate:\n• Corrupted or incompatible media file\n• Missing codecs on the server\n• Server configuration issue\n\nError Code: 500\n\nCheck the Jellyfin server logs for more details.';
                } else if (err && err.error) {
                    details = 'Error Code: ' + err.error;
                    if (err.responseData && err.responseData.Message) {
                        details += '\nMessage: ' + err.responseData.Message;
                    }
                }
                
                showErrorDialog(title, message, details);
            }
        });
    }

    function getDeviceProfile() {
        return {
            MaxStreamingBitrate: 120000000,
            MaxStaticBitrate: 100000000,
            MusicStreamingTranscodingBitrate: 384000,
            DirectPlayProfiles: [
                // HEVC/H.265 with Dolby Vision and HDR10 support
                { Container: 'mp4', Type: 'Video', VideoCodec: 'hevc,h264,avc', AudioCodec: 'eac3,ac3,aac,mp3,dts,truehd,flac' },
                { Container: 'mkv', Type: 'Video', VideoCodec: 'hevc,h264,avc', AudioCodec: 'eac3,ac3,aac,mp3,dts,truehd,flac' },
                // Explicitly list Dolby Vision profiles (dvhe/dvh1)
                { Container: 'mp4', Type: 'Video', VideoCodec: 'dvhe,dvh1', AudioCodec: 'eac3,ac3,aac,mp3,dts,truehd' },
                { Container: 'mkv', Type: 'Video', VideoCodec: 'dvhe,dvh1', AudioCodec: 'eac3,ac3,aac,mp3,dts,truehd' }
            ],
            TranscodingProfiles: [
                { Container: 'ts', Type: 'Video', AudioCodec: 'aac,mp3,ac3', VideoCodec: 'h264', Protocol: 'hls', Context: 'Streaming', MaxAudioChannels: '6' },
                { Container: 'mp4', Type: 'Video', AudioCodec: 'aac,mp3', VideoCodec: 'h264', Context: 'Static' }
            ],
            ContainerProfiles: [],
            CodecProfiles: [
                {
                    Type: 'Video',
                    Codec: 'h264',
                    Conditions: [
                        { Condition: 'LessThanEqual', Property: 'Width', Value: '1920' },
                        { Condition: 'LessThanEqual', Property: 'Height', Value: '1000' },
                        { Condition: 'LessThanEqual', Property: 'VideoFramerate', Value: '60' },
                        { Condition: 'LessThanEqual', Property: 'VideoBitrate', Value: '40000000' }
                    ]
                },
                {
                    Type: 'Video',
                    Codec: 'hevc',
                    Conditions: [
                        { Condition: 'LessThanEqual', Property: 'Width', Value: '3840' },
                        { Condition: 'LessThanEqual', Property: 'Height', Value: '2000' },
                        { Condition: 'LessThanEqual', Property: 'VideoFramerate', Value: '60' },
                        { Condition: 'LessThanEqual', Property: 'VideoBitrate', Value: '100000000' }
                    ]
                },
                {
                    Type: 'VideoAudio',
                    Conditions: [
                        { Condition: 'LessThanEqual', Property: 'AudioChannels', Value: '6' }
                    ]
                }
            ],
            SubtitleProfiles: [
                // For HLS streaming, subtitles should be burned in (encoded into video)
                { Format: 'srt', Method: 'Encode' },
                { Format: 'ass', Method: 'Encode' },
                { Format: 'ssa', Method: 'Encode' },
                { Format: 'vtt', Method: 'Encode' },
                { Format: 'sub', Method: 'Encode' },
                { Format: 'idx', Method: 'Encode' },
                { Format: 'subrip', Method: 'Encode' }
            ],
            ResponseProfiles: []
        };
    }

    async function startPlayback(mediaSource) {
        playSessionId = generateUUID();
        currentMediaSource = mediaSource;
        isDolbyVisionMedia = false; // Reset flag for new playback session
        
        // Populate audio/subtitle streams early so preferences can be applied
        audioStreams = mediaSource.MediaStreams ? mediaSource.MediaStreams.filter(function(s) { return s.Type === 'Audio'; }) : [];
        subtitleStreams = mediaSource.MediaStreams ? mediaSource.MediaStreams.filter(function(s) { return s.Type === 'Subtitle'; }) : [];
        
        // Initialize track indices to default tracks
        currentAudioIndex = -1;
        currentSubtitleIndex = -1;
        for (var i = 0; i < audioStreams.length; i++) {
            if (audioStreams[i].IsDefault) {
                currentAudioIndex = i;
                break;
            }
        }
        if (currentAudioIndex < 0 && audioStreams.length > 0) {
            currentAudioIndex = 0;
        }
        for (var i = 0; i < subtitleStreams.length; i++) {
            if (subtitleStreams[i].IsDefault) {
                currentSubtitleIndex = i;
                break;
            }
        }
        
        var isLiveTV = itemData && itemData.Type === 'TvChannel';
        var streamUrl;
        var mimeType;
        var useDirectPlay = false;
        var params = new URLSearchParams({
            mediaSourceId: mediaSource.Id,
            deviceId: JellyfinAPI.init(),
            api_key: auth.accessToken,
            PlaySessionId: playSessionId
        });
        
        var videoStream = mediaSource.MediaStreams ? mediaSource.MediaStreams.find(function(s) { return s.Type === 'Video'; }) : null;
        var audioStream = mediaSource.MediaStreams ? mediaSource.MediaStreams.find(function(s) { return s.Type === 'Audio'; }) : null;
        
        // Check if this is a Dolby Vision or HDR file
        var isDolbyVision = videoStream && videoStream.Codec && 
            (videoStream.Codec.toLowerCase().startsWith('dvhe') || videoStream.Codec.toLowerCase().startsWith('dvh1'));
        var isHEVC10bit = videoStream && videoStream.Codec && 
            (videoStream.Codec.toLowerCase() === 'hevc' || videoStream.Codec.toLowerCase().startsWith('hev1') || 
             videoStream.Codec.toLowerCase().startsWith('hvc1')) && 
            videoStream.BitDepth === 10;
        
        var safeVideoCodecs = ['h264', 'avc', 'hevc', 'h265', 'hev1', 'hvc1', 'dvhe', 'dvh1'];
        var safeAudioCodecs = ['aac', 'mp3', 'ac3', 'eac3', 'dts', 'truehd', 'flac'];
        var safeContainers = ['mp4', 'mkv'];
        
        var canDirectPlay = mediaSource.SupportsDirectPlay && 
            mediaSource.Container && 
            safeContainers.indexOf(mediaSource.Container.toLowerCase()) !== -1 &&
            videoStream && videoStream.Codec && safeVideoCodecs.indexOf(videoStream.Codec.toLowerCase()) !== -1 &&
            audioStream && audioStream.Codec && safeAudioCodecs.indexOf(audioStream.Codec.toLowerCase()) !== -1;
        
        var canTranscode = mediaSource.SupportsTranscoding;
        
        var shouldUseDirectPlay = false;
        if (forcePlayMode === 'direct') {
            shouldUseDirectPlay = canDirectPlay;
        } else if (forcePlayMode === 'transcode') {
            shouldUseDirectPlay = false;
        } else {
            shouldUseDirectPlay = canDirectPlay;
        }
        
        // Check if media source has a pre-configured transcoding URL (for Live TV)
        if (mediaSource.TranscodingUrl) {
            streamUrl = auth.serverAddress + mediaSource.TranscodingUrl;
            
            params = new URLSearchParams();
            var urlParts = streamUrl.split('?');
            if (urlParts.length > 1) {
                streamUrl = urlParts[0];
                params = new URLSearchParams(urlParts[1]);
            }
            
            if (!params.has('api_key')) {
                params.append('api_key', auth.accessToken);
            }
            if (!params.has('PlaySessionId')) {
                params.append('PlaySessionId', playSessionId);
            }
            if (!params.has('deviceId')) {
                params.append('deviceId', JellyfinAPI.init());
            }
            
            mimeType = 'application/x-mpegURL';
            isTranscoding = true;
        } else if (shouldUseDirectPlay) {
            willUseDirectPlay = true;
            streamUrl = auth.serverAddress + '/Videos/' + itemId + '/stream';
            params.append('Static', 'true');
            var container = mediaSource.Container || 'mp4';
            mimeType = 'video/' + container;
            useDirectPlay = true;
            isTranscoding = false;
        } else if (canTranscode) {
            streamUrl = auth.serverAddress + '/Videos/' + itemId + '/master.m3u8';
            params.append('VideoCodec', 'h264');
            params.append('AudioCodec', 'aac');
            params.append('VideoBitrate', '20000000');  // Increased for better quality
            params.append('AudioBitrate', '256000');
            params.append('MaxWidth', '3840');  // Support 4K transcoding
            params.append('MaxHeight', '2160');
            params.append('SegmentLength', '6');
            params.append('MinSegments', '3');
            params.append('BreakOnNonKeyFrames', 'false');
            
            // Check for user-selected track preferences from details page (not for Live TV)
            if (!isLiveTV) {
                var preferredAudioIndex = localStorage.getItem('preferredAudioTrack_' + itemId);
                var preferredSubtitleIndex = localStorage.getItem('preferredSubtitleTrack_' + itemId);
                
                if (preferredAudioIndex !== null && audioStreams[preferredAudioIndex]) {
                    params.append('AudioStreamIndex', audioStreams[preferredAudioIndex].Index);
                }
                
                if (preferredSubtitleIndex !== null && preferredSubtitleIndex >= 0 && subtitleStreams[preferredSubtitleIndex]) {
                    params.append('SubtitleStreamIndex', subtitleStreams[preferredSubtitleIndex].Index);
                    params.append('SubtitleMethod', 'Encode');
                }
            }
            
            mimeType = 'application/x-mpegURL';
            isTranscoding = true;
        } else {
            console.log('Unsupported media source:', {
                container: mediaSource.Container,
                supportsDirectPlay: mediaSource.SupportsDirectPlay,
                supportsDirectStream: mediaSource.SupportsDirectStream,
                supportsTranscoding: mediaSource.SupportsTranscoding
            });
            setLoadingState(LoadingState.ERROR);
            alert('This video format is not supported');
            window.history.back();
            return;
        }

        // Prepare the correct adapter based on playback method
        var creationOptions = {};
        if (isDolbyVision) {
            creationOptions.preferTizen = true;
        } else if (useDirectPlay) {
            creationOptions.preferHTML5 = true;
        }
        await ensurePlayerAdapter(creationOptions);

        var videoUrl = streamUrl + '?' + params.toString();
        
        console.log('[Player] Starting playback');
        console.log('[Player] Method:', isLiveTV ? 'Live TV' : (useDirectPlay ? 'Direct Play' : 'Transcode'));
        console.log('[Player] Container:', mediaSource.Container);
        console.log('[Player] Video Codec:', videoStream ? videoStream.Codec : 'none');
        if (isDolbyVision || isHEVC10bit) {
            console.log('[Player] Note: For best Dolby Vision/HDR10 support, transcoding to HLS is recommended');
        }
        console.log('[Player] URL:', videoUrl.substring(0, 100) + '...');
        
        var startPosition = 0;
        var urlPosition = getStartPositionFromUrl();
        if (urlPosition !== null) {
            // Position specified in URL takes precedence
            startPosition = urlPosition;
        } else if (!isLiveTV && itemData.UserData && itemData.UserData.PlaybackPositionTicks > 0) {
            // Otherwise use saved position if available
            startPosition = itemData.UserData.PlaybackPositionTicks / TICKS_PER_SECOND;
        }
        
        // Setup timeout (smart for direct play, standard for streams)
        if (useDirectPlay) {
            setupDirectPlayTimeout(mediaSource);
        } else {
            var timeoutDuration = TRANSCODE_TIMEOUT_MS;
            loadingTimeout = setTimeout(function() {
                if (loadingState === LoadingState.LOADING) {
                    setLoadingState(LoadingState.ERROR);
                    alert('Video loading timed out. The server may be transcoding or the format is not supported.');
                    window.history.back();
                }
            }, timeoutDuration);
        }
        
        setLoadingState(LoadingState.LOADING);
        
        playerAdapter.load(videoUrl, {
            mimeType: mimeType,
            startPosition: startPosition
        }).then(function() {
            clearLoadingTimeout();
            console.log('[Player] Playback loaded successfully (' + (useDirectPlay ? 'direct' : 'stream') + ')');
            if (useDirectPlay) {
                startPlaybackHealthCheck(mediaSource);
            }
        }).catch(function(error) {
            handlePlaybackLoadError(error, mediaSource, useDirectPlay);
        });
    }
    
    /**
     * Monitor playback health and fallback to HLS if issues detected
     * Checks for: stuck playback, no video/audio tracks, stalled buffering
     */
    function startPlaybackHealthCheck(mediaSource) {
        console.log('[Player] Starting playback health check for direct play');
        
        // Clear any existing check
        if (playbackHealthCheckTimer) {
            clearTimeout(playbackHealthCheckTimer);
        }
        
        var checkCount = 0;
        var lastTime = videoPlayer.currentTime;
        
        function checkHealth() {
            // Stop checking after 3 attempts or if we're transcoding
            if (checkCount >= 3 || isTranscoding) {
                playbackHealthCheckTimer = null;
                return;
            }
            
            checkCount++;
            var currentTime = videoPlayer.currentTime;
            
            // Check 1: Is playback stuck? (time not advancing)
            var isStuck = !videoPlayer.paused && currentTime === lastTime && currentTime > 0;
            
            // Check 2: Video element in bad state?
            var isBadState = videoPlayer.error || 
                            videoPlayer.networkState === HTMLMediaElement.NETWORK_NO_SOURCE ||
                            (videoPlayer.readyState < HTMLMediaElement.HAVE_CURRENT_DATA && !videoPlayer.paused);
            
            // Check 3: No video or audio tracks? (for containers with track support)
            var noTracks = false;
            if (videoPlayer.videoTracks && videoPlayer.audioTracks) {
                noTracks = videoPlayer.videoTracks.length === 0 || videoPlayer.audioTracks.length === 0;
            }
            
            if (isStuck || isBadState || noTracks) {
                console.log('[Player] Playback health issue detected:', {
                    stuck: isStuck,
                    badState: isBadState,
                    noTracks: noTracks,
                    readyState: videoPlayer.readyState,
                    networkState: videoPlayer.networkState
                });
                
                playbackHealthCheckTimer = null;
                if (attemptTranscodeFallback(mediaSource, 'Playback health check failed')) {
                    console.log('[Player] Falling back to HLS transcoding due to playback issues');
                }
            } else {
                lastTime = currentTime;
                playbackHealthCheckTimer = setTimeout(checkHealth, 2000); // Check every 2 seconds
            }
        }
        
        // Start checking after 2 seconds (give it time to start)
        playbackHealthCheckTimer = setTimeout(checkHealth, 2000);
    }

    /**
     * Handle playback load errors with appropriate fallback logic
     * @param {Error} error - Load error from adapter
     * @param {Object} mediaSource - Current media source
     * @param {boolean} isDirectPlay - Whether this was a direct play attempt
     */
    function handlePlaybackLoadError(error, mediaSource, isDirectPlay) {
        clearLoadingTimeout();
        console.log('[Player] Playback load failed:', error.message);
        
        if (isDirectPlay && mediaSource && attemptTranscodeFallback(mediaSource, error.message || 'Load error')) {
            alert('Direct playback failed. Switching to transcoding...');
        } else {
            setLoadingState(LoadingState.ERROR);
            alert('Failed to start playback: ' + (error.message || error));
            window.history.back();
        }
    }
    
    /**
     * Setup smart timeout for direct play with buffering progress detection
     * Monitors progress events and extends timeout if buffering is active
     * @param {Object} mediaSource - Current media source for fallback
     */
    function setupDirectPlayTimeout(mediaSource) {
        var timeoutDuration = DIRECT_PLAY_TIMEOUT_MS;
        var directPlayStartTime = Date.now();
        var hasProgressedSinceStart = false;
        
        // Create event handlers with closure over mutable flags
        var onProgress = function() {
            hasProgressedSinceStart = true;
            console.log('[Player] Buffering progress detected for direct play');
        };
        
        var onLoadedMetadata = function() {
            hasProgressedSinceStart = true;
            console.log('[Player] Media metadata loaded for direct play');
        };
        
        var onCanPlay = function() {
            hasProgressedSinceStart = true;
            console.log('[Player] Video ready to play - direct play is working');
        };
        
        // Attach listeners
        videoPlayer.addEventListener('progress', onProgress);
        videoPlayer.addEventListener('loadedmetadata', onLoadedMetadata);
        videoPlayer.addEventListener('canplay', onCanPlay);
        
        loadingTimeout = setTimeout(function() {
            // Clean up listeners immediately to prevent leaks
            videoPlayer.removeEventListener('progress', onProgress);
            videoPlayer.removeEventListener('loadedmetadata', onLoadedMetadata);
            videoPlayer.removeEventListener('canplay', onCanPlay);
            
            // Exit if playback already loaded or errored
            if (loadingState !== LoadingState.LOADING) {
                return;
            }
            
            // Decision logic based on buffering progress
            if (!hasProgressedSinceStart) {
                // No activity in timeout period - network issue
                var elapsedSeconds = ((Date.now() - directPlayStartTime) / 1000).toFixed(1);
                console.log('[Player] Direct play timeout after ' + elapsedSeconds + 's (no buffering progress)');
                if (mediaSource && attemptTranscodeFallback(mediaSource, 'No buffering progress')) {
                    alert('Direct playback not responding. Switching to transcoding...');
                }
            } else {
                // Buffering started but canplay didn't fire - give it more time
                console.log('[Player] Direct play buffering but not ready. Extending timeout...');
                var extendedTimeout = setTimeout(function() {
                    if (loadingState === LoadingState.LOADING && mediaSource) {
                        console.log('[Player] Extended timeout reached, switching to transcoding');
                        if (attemptTranscodeFallback(mediaSource, 'Extended timeout')) {
                            alert('Direct playback too slow. Switching to transcoding...');
                        }
                    }
                }, 10000); // Additional 10 seconds if buffering detected
                
                loadingTimeout = extendedTimeout;
            }
        }, timeoutDuration);
    }

    // ============================================================================
    // UTILITY FUNCTIONS
    // ============================================================================

    /**
     * Generate a UUID v4
     * @returns {string} UUID string
     */
    function generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    /**
     * Format seconds into human-readable time string
     * @param {number} seconds - Time in seconds
     * @returns {string} Formatted time (e.g., "1:23:45" or "12:34")
     */
    function formatTime(seconds) {
        if (isNaN(seconds)) return '0:00';
        
        var hours = Math.floor(seconds / 3600);
        var minutes = Math.floor((seconds % 3600) / 60);
        var secs = Math.floor(seconds % 60);
        
        if (hours > 0) {
            return hours + ':' + padZero(minutes) + ':' + padZero(secs);
        }
        return minutes + ':' + padZero(secs);
    }

    /**
     * Pad number with leading zero
     * @param {number} num - Number to pad
     * @returns {string} Padded number
     */
    function padZero(num) {
        return num < 10 ? '0' + num : num;
    }

    /**
     * Build playback data object for Jellyfin API
     * @returns {Object} Playback data
     */
    function buildPlaybackData() {
        return {
            ItemId: itemId,
            PlaySessionId: playSessionId,
            PositionTicks: Math.floor(videoPlayer.currentTime * 10000000),
            IsPaused: videoPlayer.paused,
            IsMuted: videoPlayer.muted,
            VolumeLevel: Math.floor(videoPlayer.volume * 100)
        };
    }

    /**
     * Make Jellyfin API request with auth headers
     * @param {string} url - API endpoint URL
     * @param {Object} data - Request data
     * @param {Function} onSuccess - Success callback
     * @param {Function} onError - Error callback
     */
    function makePlaybackRequest(url, data, onSuccess, onError) {
        ajax.request(url, {
            method: 'POST',
            headers: {
                'X-Emby-Authorization': JellyfinAPI.getAuthHeader(auth.accessToken),
                'Content-Type': 'application/json'
            },
            data: data,
            success: onSuccess,
            error: onError
        });
    }

    // ============================================================================
    // PLAYBACK REPORTING
    // ============================================================================

    /**
     * Report playback start to Jellyfin server
     */
    function reportPlaybackStart() {
        makePlaybackRequest(
            auth.serverAddress + '/Sessions/Playing',
            buildPlaybackData(),
            function() {
            },
            function(err) {
            }
        );
    }

    /**
     * Report playback progress to Jellyfin server
     */
    function reportPlaybackProgress() {
        if (!playSessionId) return;

        console.log('[Player] Reporting progress to:', auth.serverAddress);
        makePlaybackRequest(
            auth.serverAddress + '/Sessions/Playing/Progress',
            buildPlaybackData(),
            function() {
                console.log('[Player] Progress reported successfully');
            },
            function(err) {
                console.error('[Player] Failed to report progress:', err);
            }
        );
    }

    /**
     * Report playback stop to Jellyfin server
     */
    function reportPlaybackStop() {
        if (!playSessionId) return;

        console.log('[Player] Reporting stop to:', auth.serverAddress);
        makePlaybackRequest(
            auth.serverAddress + '/Sessions/Playing/Stopped',
            buildPlaybackData(),
            function() {
                console.log('[Player] Stop reported successfully');
            },
            function(err) {
                console.error('[Player] Failed to report stop:', err);
            }
        );
    }

    /**
     * Start periodic progress reporting to server
     */
    /**
     * Start periodic progress reporting to server
     */
    function startProgressReporting() {
        if (progressInterval) clearInterval(progressInterval);
        
        progressInterval = setInterval(function() {
            reportPlaybackProgress();
        }, PROGRESS_REPORT_INTERVAL_MS);
    }

    /**
     * Stop periodic progress reporting
     */
    /**
     * Stop periodic progress reporting
     */
    function stopProgressReporting() {
        if (progressInterval) {
            clearInterval(progressInterval);
            progressInterval = null;
        }
    }

    // ============================================================================
    // PLAYBACK CONTROLS
    // ============================================================================

    /**
     * Toggle between play and pause states
     */
    // ============================================================================
    // PLAYBACK CONTROLS
    // ============================================================================

    /**
     * Toggle between play and pause states
     */
    function togglePlayPause() {
        if (videoPlayer.paused) {
            play();
        } else {
            pause();
        }
    }

    /**
     * Play video and update UI
     */
    /**
     * Play video and update UI
     */
    function play() {
        videoPlayer.play();
        if (elements.playPauseBtn) {
            const icon = elements.playPauseBtn.querySelector('.btn-icon');
            if (icon) icon.src = 'assets/pause.png';
        }
        showControls();
    }

    /**
     * Pause video and update UI
     */
    /**
     * Pause video and update UI
     */
    function pause() {
        videoPlayer.pause();
        if (elements.playPauseBtn) {
            const icon = elements.playPauseBtn.querySelector('.btn-icon');
            if (icon) icon.src = 'assets/play.png';
        }
        showControls();
    }

    /**
     * Skip backward by configured interval
     */
    /**
     * Skip backward by configured interval
     */
    function rewind() {
        seekTo(Math.max(0, videoPlayer.currentTime - SKIP_INTERVAL_SECONDS));
        showControls();
    }

    /**
     * Skip forward by configured interval
     */
    /**
     * Skip forward by configured interval
     */
    function forward() {
        seekTo(Math.min(videoPlayer.duration, videoPlayer.currentTime + SKIP_INTERVAL_SECONDS));
        showControls();
    }
    
    /**
     * Seek forward by interval on seekbar
     */
    function seekForward() {
        if (videoPlayer.duration) {
            // Use pending seek position if a seek is in progress, otherwise use current video time
            var currentPosition = pendingSeekPosition !== null ? pendingSeekPosition : videoPlayer.currentTime;
            seekPosition = Math.min(currentPosition + SKIP_INTERVAL_SECONDS, videoPlayer.duration);
            seekTo(seekPosition);
            showControls();
        }
    }
    
    /**
     * Seek backward by interval on seekbar
     */
    function seekBackward() {
        // Use pending seek position if a seek is in progress, otherwise use current video time
        var currentPosition = pendingSeekPosition !== null ? pendingSeekPosition : videoPlayer.currentTime;
        seekPosition = Math.max(currentPosition - SKIP_INTERVAL_SECONDS, 0);
        seekTo(seekPosition);
        showControls();
    }
    
    /**
     * Debounced seek function to prevent rapid seek operations
     * @param {number} position - Target position in seconds
     */
    function seekTo(position) {
        if (!videoPlayer.duration || isNaN(position)) return;
        
        position = Math.max(0, Math.min(position, videoPlayer.duration));
        pendingSeekPosition = position;
        isSeekingActive = true; // Prevent onTimeUpdate from overriding seek preview
        
        updateSeekPreview(position);
        
        if (seekDebounceTimer) {
            clearTimeout(seekDebounceTimer);
        }
        
        seekDebounceTimer = setTimeout(function() {
            performSeek(pendingSeekPosition);
            seekDebounceTimer = null;
        }, SEEK_DEBOUNCE_MS);
    }
    
    /**
     * Actually perform the seek operation
     * @param {number} position - Target position in seconds
     */
    function performSeek(position) {
        if (isSeeking) return;
        
        isSeeking = true;
        showSeekingIndicator();
        
        try {
            if (playerAdapter && playerAdapter.seek) {
                playerAdapter.seek(position);
            } else {
                videoPlayer.currentTime = position;
            }
        } catch (error) {
        }
        
        setTimeout(function() {
            isSeeking = false;
            isSeekingActive = false; // Allow onTimeUpdate to update seek indicator again
            hideSeekingIndicator();
        }, FOCUS_DELAY_MS);
    }
    
    /**
     * Update seek preview UI
     * @param {number} position - Preview position in seconds
     */
    function updateSeekPreview(position) {
        if (!videoPlayer.duration) return;
        
        var progress = (position / videoPlayer.duration) * 100;
        
        if (elements.seekIndicator) {
            elements.seekIndicator.style.left = progress + '%';
            elements.seekIndicator.style.opacity = '1';
        }
        
        if (elements.timeDisplay) {
            elements.timeDisplay.textContent = formatTime(position) + ' / ' + formatTime(videoPlayer.duration);
        }
        
        if (elements.endTime) {
            var remainingSeconds = videoPlayer.duration - position;
            var endDate = new Date(Date.now() + remainingSeconds * 1000);
            var hours = endDate.getHours();
            var minutes = endDate.getMinutes();
            var ampm = hours >= 12 ? 'PM' : 'AM';
            hours = hours % 12;
            hours = hours ? hours : 12;
            var timeString = hours + ':' + (minutes < 10 ? '0' + minutes : minutes) + ' ' + ampm;
            elements.endTime.textContent = 'Ends at ' + timeString;
        }
    }
    
    /**
     * Show visual seeking indicator
     */
    function showSeekingIndicator() {
        if (elements.seekIndicator) {
            elements.seekIndicator.classList.add('seeking');
        }
    }
    
    /**
     * Hide visual seeking indicator
     */
    function hideSeekingIndicator() {
        if (elements.seekIndicator) {
            elements.seekIndicator.classList.remove('seeking');
            elements.seekIndicator.style.opacity = '';
        }
    }
    
    /**
     * Handle progress bar click for seeking
     * @param {MouseEvent} evt - Click event
     */
    function handleProgressBarClick(evt) {
        var rect = elements.progressBar.getBoundingClientRect();
        var pos = (evt.clientX - rect.left) / rect.width;
        var targetTime = pos * videoPlayer.duration;
        seekTo(targetTime);
        showControls();
    }

    // ============================================================================
    // UI CONTROLS
    // ============================================================================

    /**
     * Show player controls and set auto-hide timer
     */
    function showControls() {
        if (elements.playerControls) {
            elements.playerControls.classList.add('visible');
        }
        if (elements.videoDimmer) {
            elements.videoDimmer.classList.add('visible');
        }
        document.body.classList.add('controls-visible');
        controlsVisible = true;
        
        // Temporarily hide skip button when controls are shown to avoid focus conflicts
        if (skipOverlayVisible && elements.skipOverlay) {
            elements.skipOverlay.style.opacity = '0';
            elements.skipOverlay.style.pointerEvents = 'none';
        }

        if (controlsTimeout) clearTimeout(controlsTimeout);
        
        controlsTimeout = setTimeout(function() {
            if (!videoPlayer.paused) {
                hideControls();
            }
        }, CONTROLS_HIDE_DELAY_MS);
    }

    /**
     * Hide player controls
     */
    /**
     * Hide player controls
     */
    function hideControls() {
        if (elements.playerControls) {
            elements.playerControls.classList.remove('visible');
        }
        if (elements.videoDimmer) {
            elements.videoDimmer.classList.remove('visible');
        }
        document.body.classList.remove('controls-visible');
        controlsVisible = false;
        
        // Restore skip button visibility when controls hide
        if (skipOverlayVisible && elements.skipOverlay) {
            elements.skipOverlay.style.opacity = '1';
            elements.skipOverlay.style.pointerEvents = 'all';
            // Refocus skip button if it was visible
            if (elements.skipButton) {
                elements.skipButton.focus();
            }
        }
    }

    // ============================================================================
    // VIDEO EVENT HANDLERS
    // ============================================================================

    /**
     * Handle video play event
     */
    // ============================================================================
    // VIDEO EVENT HANDLERS
    // ============================================================================

    /**
     * Handle video play event
     */
    function onPlay() {
    }

    /**
     * Handle video pause event
     */
    /**
     * Handle video pause event
     */
    function onPause() {
    }
    
    /**
     * Handle video ready to play event
     */
    /**
     * Handle video ready to play event
     */
    function onCanPlay() {
        console.log('[Player] Video ready to play');
        clearLoadingTimeout();
        setLoadingState(LoadingState.READY);
        
        if (videoPlayer.paused && videoPlayer.readyState >= 3) {
            videoPlayer.play().catch(function(err) {
            });
        }
    }
    
    /**
     * Handle video metadata loaded event
     */
    /**
     * Handle video metadata loaded event
     */
    function onLoadedMetadata() {
        clearLoadingTimeout();
    }
    
    /**
     * Handle video buffering event
     */
    /**
     * Handle video buffering event
     */
    function onWaiting() {
    }
    
    /**
     * Handle video playing event (playback started)
     */
    /**
     * Handle video playing event (playback started)
     */
    function onPlaying() {
        clearLoadingTimeout();
        setLoadingState(LoadingState.READY);
        
        if (!progressInterval) {
            reportPlaybackStart();
            startProgressReporting();
            detectCurrentAudioTrack();
        }
        
        // Apply playback speed
        if (videoPlayer && currentPlaybackSpeed !== 1.0) {
            videoPlayer.playbackRate = currentPlaybackSpeed;
        }
        
        // Start bitrate monitoring
        startBitrateMonitoring();
        
        showControls();
        
        if (elements.progressBar && !document.activeElement.classList.contains('progress-bar')) {
            setTimeout(function() {
                elements.progressBar.focus();
            }, FOCUS_DELAY_MS);
        }
    }

    /**
     * Handle video time update event
     */
    /**
     * Handle video time update event
     */
    function onTimeUpdate() {
        if (!videoPlayer.duration) return;

        var progress = (videoPlayer.currentTime / videoPlayer.duration) * 100;
        if (elements.progressFill) {
            elements.progressFill.style.width = progress + '%';
        }
        
        // Don't update seek indicator position while user is actively seeking
        // to prevent jumping back and forth during seek preview
        if (elements.seekIndicator && !isSeekingActive) {
            elements.seekIndicator.style.left = progress + '%';
        }

        if (elements.timeDisplay) {
            elements.timeDisplay.textContent = formatTime(videoPlayer.currentTime) + ' / ' + formatTime(videoPlayer.duration);
        }

        if (elements.endTime) {
            var remainingSeconds = videoPlayer.duration - videoPlayer.currentTime;
            var endDate = new Date(Date.now() + remainingSeconds * 1000);
            var hours = endDate.getHours();
            var minutes = endDate.getMinutes();
            var ampm = hours >= 12 ? 'PM' : 'AM';
            hours = hours % 12;
            hours = hours ? hours : 12; // 0 should be 12
            var timeString = hours + ':' + (minutes < 10 ? '0' + minutes : minutes) + ' ' + ampm;
            elements.endTime.textContent = 'Ends at ' + timeString;
        }
        
        // Check for skip segments
        checkSkipSegments(videoPlayer.currentTime);
        
        // Update skip button countdown if visible
        if (skipOverlayVisible && currentSkipSegment) {
            var timeLeft = Math.ceil(currentSkipSegment.EndTicks / 10000000 - videoPlayer.currentTime);
            updateSkipButtonTime(timeLeft);
        }
    }

    /**
     * Handle video ended event
     */
    function onEnded() {
        console.log('[Player] Playback ended');
        reportPlaybackStop();
        stopProgressReporting();
        stopBitrateMonitoring();
        
        // Clear health check timer
        if (playbackHealthCheckTimer) {
            clearTimeout(playbackHealthCheckTimer);
            playbackHealthCheckTimer = null;
        }
        
        window.history.back();
    }

    /**
     * Handle video error event
     * @param {Event} evt - Error event
     */
    function onError(evt) {
        console.error('[Player] Playback error:', evt);
        
        var errorCode = videoPlayer.error ? videoPlayer.error.code : 'unknown';
        var errorMessage = videoPlayer.error ? videoPlayer.error.message : 'Unknown error';
        console.error('[Player] Error code:', errorCode, 'Message:', errorMessage);
        
        
        clearLoadingTimeout();
        setLoadingState(LoadingState.ERROR);
        
        if (currentMediaSource && currentMediaSource.SupportsDirectPlay && 
            attemptTranscodeFallback(currentMediaSource, 'Playback error: ' + errorCode)) {
            alert('Direct playback error (code: ' + errorCode + '). Switching to transcoding...');
            return;
        }
        
        alert('Playback error occurred (code: ' + errorCode + ')');
    }

    /**
     * Exit player and clean up resources
     */
    /**
     * Exit player and clean up resources
     */
    /**
     * Play previous item in queue/playlist
     */
    function playPreviousItem() {
        
        // Stop current playback
        reportPlaybackStop();
        stopProgressReporting();
        stopBitrateMonitoring();
        
        // Navigate back and let the previous page handle loading the previous item
        // In a future enhancement, this could be integrated with a proper queue system
        window.history.back();
    }
    
    /**
     * Play next item in queue/playlist
     */
    function playNextItem() {
        
        // Stop current playback
        reportPlaybackStop();
        stopProgressReporting();
        stopBitrateMonitoring();
        
        // Navigate back and let the previous page handle loading the next item
        // In a future enhancement, this could be integrated with a proper queue system
        window.history.back();
    }

    function exitPlayer() {
        // Report stop with current position before navigating away
        if (playSessionId) {
            makePlaybackRequest(
                auth.serverAddress + '/Sessions/Playing/Stopped',
                buildPlaybackData(),
                function() {
                    // Navigate after stop report succeeds
                    finishExit();
                },
                function(err) {
                    // Navigate even if stop report fails
                    finishExit();
                }
            );
        } else {
            finishExit();
        }
        
        function finishExit() {
            stopProgressReporting();
            
            clearLoadingTimeout();
            
            if (seekDebounceTimer) {
                clearTimeout(seekDebounceTimer);
                seekDebounceTimer = null;
            }
            
            // Clear health check timer
            if (playbackHealthCheckTimer) {
                clearTimeout(playbackHealthCheckTimer);
                playbackHealthCheckTimer = null;
            }
            
            if (playerAdapter) {
                playerAdapter.destroy().catch(function(err) {
                });
                playerAdapter = null;
            }
            
            setLoadingState(LoadingState.IDLE);
            window.history.back();
        }
    }

    // ============================================================================
    // LOADING STATE MANAGEMENT
    // ============================================================================

    /**
     * Show loading indicator
     */
    // ============================================================================
    // LOADING STATE MANAGEMENT
    // ============================================================================

    /**
     * Show loading indicator
     */
    function showLoading() {
        if (elements.loadingIndicator) {
            elements.loadingIndicator.style.display = 'flex';
        }
    }

    /**
     * Hide loading indicator
     */
    /**
     * Hide loading indicator
     */
    function hideLoading() {
        if (elements.loadingIndicator) {
            elements.loadingIndicator.style.display = 'none';
        }
    }

    /**
     * Show user-friendly error dialog
     * @param {string} title - Error title
     * @param {string} message - User-friendly error message
     * @param {string} [details] - Technical details (optional)
     */
    function showErrorDialog(title, message, details) {
        hideLoading();
        
        if (!elements.errorDialog) return;
        
        elements.errorDialogTitle.textContent = title || 'Playback Error';
        elements.errorDialogMessage.textContent = message || 'An error occurred during playback';
        
        if (details) {
            elements.errorDialogDetails.textContent = details;
            elements.errorDialogDetails.style.display = 'block';
        } else {
            elements.errorDialogDetails.style.display = 'none';
        }
        
        elements.errorDialog.style.display = 'flex';
        setTimeout(() => {
            elements.errorDialogBtn.focus();
        }, 100);
    }

    /**
     * Close error dialog and navigate back
     */
    function closeErrorDialog() {
        if (elements.errorDialog) {
            elements.errorDialog.style.display = 'none';
        }
        window.history.back();
    }

    /**
     * Detect which audio track is currently playing and update currentAudioIndex
     */
    function detectCurrentAudioTrack() {
        if (!playerAdapter || !itemData || !itemData.MediaSources) return;
        
        try {
            // For Shaka Player, get the current audio language
            if (playerAdapter.getName() === 'ShakaPlayer' && playerAdapter.player) {
                var currentVariant = playerAdapter.player.getVariantTracks().find(function(t) {
                    return t.active;
                });
                
                if (currentVariant && currentVariant.language) {
                    var audioStreams = itemData.MediaSources[0].MediaStreams.filter(function(s) {
                        return s.Type === 'Audio';
                    });
                    
                    // Find matching stream by language
                    for (var i = 0; i < audioStreams.length; i++) {
                        if (audioStreams[i].Language === currentVariant.language) {
                            currentAudioIndex = i;
                            break;
                        }
                    }
                }
            } else {
                // For non-Shaka, initialize to default track
                initializeDefaultTrackIndices();
            }
        } catch (error) {
        }
    }
    
    function initializeDefaultTrackIndices() {
        if (!itemData || !itemData.MediaSources || !itemData.MediaSources[0].MediaStreams) return;
        
        var mediaStreams = itemData.MediaSources[0].MediaStreams;
        
        // Initialize audio index to default track if not already set
        if (currentAudioIndex < 0) {
            var audioStreams = mediaStreams.filter(function(s) { return s.Type === 'Audio'; });
            for (var i = 0; i < audioStreams.length; i++) {
                if (audioStreams[i].IsDefault) {
                    currentAudioIndex = i;
                    break;
                }
            }
            // If no default, use first track
            if (currentAudioIndex < 0 && audioStreams.length > 0) {
                currentAudioIndex = 0;
            }
        }
        
        // Initialize subtitle index to default track if not already set
        if (currentSubtitleIndex === -1) {
            var subtitleStreams = mediaStreams.filter(function(s) { return s.Type === 'Subtitle'; });
            for (var i = 0; i < subtitleStreams.length; i++) {
                if (subtitleStreams[i].IsDefault) {
                    currentSubtitleIndex = i;
                    break;
                }
            }
        }
    }

    // ============================================================================
    // TRACK SELECTION
    // ============================================================================

    /**
     * Show audio track selector modal
     */
    // ============================================================================
    // TRACK SELECTION
    // ============================================================================

    /**
     * Show audio track selector modal
     */
    function showAudioTrackSelector() {
        
        if (!itemData || !itemData.MediaSources || !itemData.MediaSources[0].MediaStreams) {
            return;
        }

        audioStreams = itemData.MediaSources[0].MediaStreams.filter(function(s) {
            return s.Type === 'Audio';
        });

        if (audioStreams.length === 0) {
            return;
        }


        // Build language map for Shaka Player
        audioLanguageMap = audioStreams.map(function(s) {
            return s.Language || 'und';
        });

        modalFocusableItems = TrackSelector.buildAudioTrackList(
            audioStreams,
            currentAudioIndex,
            elements.audioTrackList,
            selectAudioTrack
        );
        

        activeModal = 'audio';
        elements.audioModal.style.display = 'flex';
        currentModalFocusIndex = Math.max(0, currentAudioIndex);
        if (modalFocusableItems[currentModalFocusIndex]) {
            modalFocusableItems[currentModalFocusIndex].focus();
        }
    }

    /**
     * Show subtitle track selector modal
     */
    /**
     * Show subtitle track selector modal
     */
    function showSubtitleTrackSelector() {
        
        if (!itemData || !itemData.MediaSources || !itemData.MediaSources[0].MediaStreams) {
            return;
        }

        subtitleStreams = itemData.MediaSources[0].MediaStreams.filter(function(s) {
            return s.Type === 'Subtitle';
        });


        modalFocusableItems = TrackSelector.buildSubtitleTrackList(
            subtitleStreams,
            currentSubtitleIndex,
            elements.subtitleTrackList,
            selectSubtitleTrack
        );
        

        activeModal = 'subtitle';
        elements.subtitleModal.style.display = 'flex';
        currentModalFocusIndex = currentSubtitleIndex + 1; // +1 because of "None" option
        if (modalFocusableItems[currentModalFocusIndex]) {
            modalFocusableItems[currentModalFocusIndex].focus();
        }
    }

    /**
     * Select audio track by index
     * @param {number} index - Track index
     */
    /**
     * Select audio track by index
     * @param {number} index - Track index
     */
    function selectAudioTrack(index) {
        console.log('[Player] Selecting audio track:', index);
        
        if (index < 0 || index >= audioStreams.length) {
            console.warn('[Player] Invalid audio track index:', index);
            return;
        }

        // Update the visual selection in modal before processing
        if (modalFocusableItems && modalFocusableItems.length > 0) {
            modalFocusableItems.forEach(function(item) {
                item.classList.remove('selected');
            });
            if (modalFocusableItems[index]) {
                modalFocusableItems[index].classList.add('selected');
            }
        }
        
        currentAudioIndex = index;
        var stream = audioStreams[index];
        var language = stream.Language || 'und';
        
        
        // Skip Shaka adapter for transcoded streams - they only have one baked-in audio track
        // Must reload video with new AudioStreamIndex parameter
        if (!isTranscoding && playerAdapter && typeof playerAdapter.selectAudioTrack === 'function') {
            try {
                // For Shaka, we need to pass the language, not the array index
                var adapterIndex = index;
                
                // If using Shaka adapter, it expects a language-based index
                // We need to find which unique language position this is
                if (playerAdapter.constructor.name === 'ShakaPlayerAdapter') {
                    var uniqueLanguages = [];
                    var seenLanguages = new Set();
                    audioStreams.forEach(function(s) {
                        var lang = s.Language || 'und';
                        if (!seenLanguages.has(lang)) {
                            seenLanguages.add(lang);
                            uniqueLanguages.push(lang);
                        }
                    });
                    adapterIndex = uniqueLanguages.indexOf(language);
                }
                
                var result = playerAdapter.selectAudioTrack(adapterIndex);
                
                if (result) {
                    closeModal();
                    return;
                } else {
                }
            } catch (error) {
            }
        }
        
        reloadVideoWithTrack('audio', stream);
        closeModal();
    }

    /**
     * Select subtitle track by index
     * @param {number} index - Track index (-1 to disable)
     */
    /**
     * Select subtitle track by index
     * @param {number} index - Track index (-1 to disable)
     */
    function selectSubtitleTrack(index) {
        console.log('[Player] Selecting subtitle track:', index === -1 ? 'None' : index);
        
        // Update the visual selection in modal before processing
        // Account for "None" option at index 0 in the modal
        if (modalFocusableItems && modalFocusableItems.length > 0) {
            modalFocusableItems.forEach(function(item) {
                item.classList.remove('selected');
            });
            var modalIndex = index === -1 ? 0 : index + 1; // +1 because "None" is at position 0
            if (modalFocusableItems[modalIndex]) {
                modalFocusableItems[modalIndex].classList.add('selected');
            }
        }
        
        currentSubtitleIndex = index;
        
        // Skip Shaka adapter for transcoded streams - they don't include subtitle tracks
        // Must reload video with new SubtitleStreamIndex parameter  
        if (!isTranscoding && playerAdapter && typeof playerAdapter.selectSubtitleTrack === 'function') {
            try {
                // For subtitles, -1 means disable, otherwise use the array index
                var adapterIndex = index;
                
                // If using Shaka adapter and not disabling, map to unique subtitle tracks
                if (index >= 0 && playerAdapter.constructor.name === 'ShakaPlayerAdapter') {
                    if (index >= subtitleStreams.length) {
                        return;
                    }
                    var stream = subtitleStreams[index];
                }
                
                var result = playerAdapter.selectSubtitleTrack(adapterIndex);
                
                closeModal();
                if (index >= 0 && index < subtitleStreams.length) {
                    var stream = subtitleStreams[index];
                } else {
                }
                return;
            } catch (error) {
            }
        }
        
        var tracks = videoPlayer.textTracks;
        for (var i = 0; i < tracks.length; i++) {
            tracks[i].mode = 'disabled';
        }

        if (index >= 0 && index < subtitleStreams.length) {
            var stream = subtitleStreams[index];
            reloadVideoWithTrack('subtitle', stream);
        } else {
        }

        closeModal();
    }

    /**
     * Reload video with specific track selection (fallback for non-Shaka adapters)
     * @param {string} trackType - 'audio' or 'subtitle'
     * @param {Object} stream - The stream object to select
     */
    function reloadVideoWithTrack(trackType, stream) {
        console.log('[Player] Reloading video with', trackType, 'track:', stream.Index);
        
        var currentTime = videoPlayer.currentTime;
        var wasPaused = videoPlayer.paused;
        
        // Generate a NEW PlaySessionId to force Jellyfin to create a fresh transcode with the selected tracks
        var newPlaySessionId = generateUUID();
        
        // Build stream URL with track-specific parameters
        var streamUrl = auth.serverAddress + '/Videos/' + itemId + '/master.m3u8';
        var params = new URLSearchParams({
            mediaSourceId: currentMediaSource.Id,
            deviceId: JellyfinAPI.init(),
            api_key: auth.accessToken,
            PlaySessionId: newPlaySessionId,  // New session ID
            VideoCodec: 'h264',
            AudioCodec: 'aac',
            VideoBitrate: '20000000',  // Increased for better quality
            AudioBitrate: '256000',
            MaxWidth: '3840',  // Support 4K transcoding
            MaxHeight: '2160',
            SegmentLength: '6',
            MinSegments: '3',
            BreakOnNonKeyFrames: 'false'
        });

        // Set the specific track indices - these tell Jellyfin which tracks to transcode
        if (trackType === 'audio') {
            params.set('AudioStreamIndex', stream.Index);
            // Preserve subtitle selection
            if (currentSubtitleIndex >= 0 && currentSubtitleIndex < subtitleStreams.length) {
                params.set('SubtitleStreamIndex', subtitleStreams[currentSubtitleIndex].Index);
            }
        } else if (trackType === 'subtitle') {
            params.set('SubtitleStreamIndex', stream.Index);
            params.set('SubtitleMethod', 'Encode');  // Tell Jellyfin to burn in subtitles
            // Preserve audio selection
            if (currentAudioIndex >= 0 && currentAudioIndex < audioStreams.length) {
                params.set('AudioStreamIndex', audioStreams[currentAudioIndex].Index);
            }
        }

        var videoUrl = streamUrl + '?' + params.toString();
        
        // Update the global play session ID
        playSessionId = newPlaySessionId;
        
        setLoadingState(LoadingState.LOADING);
        
        // Use player adapter to load the new URL
        if (playerAdapter && typeof playerAdapter.load === 'function') {
            playerAdapter.load(videoUrl, { startPosition: currentTime })
                .then(function() {
                    if (!wasPaused) {
                        return videoPlayer.play();
                    }
                })
                .then(function() {
                    setLoadingState(LoadingState.READY);
                })
                .catch(function(err) {
                    setLoadingState(LoadingState.ERROR);
                    alert('Failed to switch track. The selected track may not be compatible.');
                });
        } else {
            videoPlayer.src = videoUrl;
            
            var onLoaded = function() {
                videoPlayer.removeEventListener('loadedmetadata', onLoaded);
                videoPlayer.currentTime = currentTime;
                
                if (!wasPaused) {
                    videoPlayer.play().catch(function(err) {
                    });
                }
                
                setLoadingState(LoadingState.READY);
            };
            
            videoPlayer.addEventListener('loadedmetadata', onLoaded);
        }
    }

    /**
     * Show video playback information modal
     */
    function showVideoInfo() {
        if (!itemData || !playbackInfo) {
            return;
        }

        var infoHtml = '<div class="info-section">';
        
        // Get real-time playback stats from player adapter
        var liveStats = null;
        if (playerAdapter && typeof playerAdapter.getPlaybackStats === 'function') {
            liveStats = playerAdapter.getPlaybackStats();
        }
        
        // Show live playback information first if available (what's actually playing)
        if (liveStats) {
            infoHtml += '<div class="info-header">Active Playback</div>';
            
            // Show HDR status prominently
            if (liveStats.hdrType && liveStats.hdrType !== 'SDR') {
                infoHtml += '<div class="info-row info-highlight"><span class="info-label">HDR:</span><span class="info-value">' + liveStats.hdrType + '</span></div>';
            }
            
            // Show actual video codec being decoded
            if (liveStats.videoCodec) {
                var codecDisplay = liveStats.videoCodec.split('.')[0].toUpperCase();
                if (liveStats.videoCodec.startsWith('dvhe') || liveStats.videoCodec.startsWith('dvh1')) {
                    codecDisplay = 'DOLBY VISION (' + liveStats.videoCodec + ')';
                } else if (liveStats.videoCodec.startsWith('hev1') || liveStats.videoCodec.startsWith('hvc1')) {
                    codecDisplay = 'HEVC (' + liveStats.videoCodec + ')';
                }
                infoHtml += '<div class="info-row"><span class="info-label">Video Codec:</span><span class="info-value">' + codecDisplay + '</span></div>';
            }
            
            // Show actual resolution being played
            if (liveStats.width && liveStats.height) {
                var resolution = liveStats.width + 'x' + liveStats.height;
                var resolutionName = '';
                if (liveStats.height >= 2160) resolutionName = ' (4K)';
                else if (liveStats.height >= 1080) resolutionName = ' (1080p)';
                else if (liveStats.height >= 720) resolutionName = ' (720p)';
                infoHtml += '<div class="info-row"><span class="info-label">Playing:</span><span class="info-value">' + resolution + resolutionName + '</span></div>';
            }
            
            // Show actual bitrate
            if (liveStats.bandwidth) {
                var bitrateMbps = (liveStats.bandwidth / 1000000).toFixed(1);
                infoHtml += '<div class="info-row"><span class="info-label">Stream Bitrate:</span><span class="info-value">' + bitrateMbps + ' Mbps</span></div>';
            }
            
            // Show audio codec
            if (liveStats.audioCodec) {
                var audioCodecDisplay = liveStats.audioCodec.split('.')[0].toUpperCase();
                infoHtml += '<div class="info-row"><span class="info-label">Audio Codec:</span><span class="info-value">' + audioCodecDisplay + '</span></div>';
            }
            
            // Show performance stats if there are issues
            if (liveStats.droppedFrames > 0) {
                infoHtml += '<div class="info-row info-warning"><span class="info-label">Dropped Frames:</span><span class="info-value">' + liveStats.droppedFrames + '</span></div>';
            }
            
            if (liveStats.stallsDetected > 0) {
                infoHtml += '<div class="info-row info-warning"><span class="info-label">Stalls:</span><span class="info-value">' + liveStats.stallsDetected + '</span></div>';
            }
            
            infoHtml += '</div><div class="info-section">';
        }
        
        infoHtml += '<div class="info-header">Playback Method</div>';
        var mediaSource = playbackInfo.MediaSources[0];
        if (mediaSource.SupportsDirectPlay && !mediaSource.SupportsTranscoding) {
            infoHtml += '<div class="info-row"><span class="info-label">Method:</span><span class="info-value">Direct Play</span></div>';
        } else if (!mediaSource.SupportsDirectPlay && mediaSource.SupportsTranscoding) {
            infoHtml += '<div class="info-row"><span class="info-label">Method:</span><span class="info-value">Transcoding (HLS)</span></div>';
        } else {
            infoHtml += '<div class="info-row"><span class="info-label">Method:</span><span class="info-value">Direct Play (Transcode Available)</span></div>';
        }
        
        infoHtml += '</div><div class="info-section">';
        infoHtml += '<div class="info-header">Stream Information</div>';
        
        if (mediaSource.Container) {
            infoHtml += '<div class="info-row"><span class="info-label">Container:</span><span class="info-value">' + mediaSource.Container.toUpperCase() + '</span></div>';
        }
        
        if (mediaSource.Bitrate) {
            var bitrateMbps = (mediaSource.Bitrate / 1000000).toFixed(1);
            infoHtml += '<div class="info-row"><span class="info-label">Bitrate:</span><span class="info-value">' + bitrateMbps + ' Mbps</span></div>';
        }
        
        if (mediaSource.Size) {
            var sizeGB = (mediaSource.Size / 1073741824).toFixed(2);
            infoHtml += '<div class="info-row"><span class="info-label">File Size:</span><span class="info-value">' + sizeGB + ' GB</span></div>';
        }
        
        if (mediaSource.MediaStreams) {
            var videoStream = null;
            var audioStream = null;
            
            for (var i = 0; i < mediaSource.MediaStreams.length; i++) {
                var stream = mediaSource.MediaStreams[i];
                if (stream.Type === 'Video' && !videoStream) {
                    videoStream = stream;
                } else if (stream.Type === 'Audio' && !audioStream) {
                    audioStream = stream;
                }
            }
            
            if (videoStream) {
                infoHtml += '</div><div class="info-section">';
                infoHtml += '<div class="info-header">Video (Source File)</div>';
                
                if (videoStream.DisplayTitle) {
                    infoHtml += '<div class="info-row"><span class="info-label">Stream:</span><span class="info-value">' + videoStream.DisplayTitle + '</span></div>';
                }
                
                if (videoStream.Codec) {
                    infoHtml += '<div class="info-row"><span class="info-label">Codec:</span><span class="info-value">' + videoStream.Codec.toUpperCase() + '</span></div>';
                }
                
                // Show codec profile if available (helps identify Dolby Vision profile)
                if (videoStream.Profile) {
                    infoHtml += '<div class="info-row"><span class="info-label">Profile:</span><span class="info-value">' + videoStream.Profile + '</span></div>';
                }
                
                if (videoStream.Width && videoStream.Height) {
                    var resolution = videoStream.Width + 'x' + videoStream.Height;
                    var resolutionName = '';
                    if (videoStream.Height >= 2160) resolutionName = ' (4K)';
                    else if (videoStream.Height >= 1080) resolutionName = ' (1080p)';
                    else if (videoStream.Height >= 720) resolutionName = ' (720p)';
                    else if (videoStream.Height >= 480) resolutionName = ' (480p)';
                    
                    infoHtml += '<div class="info-row"><span class="info-label">Resolution:</span><span class="info-value">' + resolution + resolutionName + '</span></div>';
                }
                
                if (videoStream.BitRate) {
                    var videoBitrateMbps = (videoStream.BitRate / 1000000).toFixed(1);
                    infoHtml += '<div class="info-row"><span class="info-label">Bitrate:</span><span class="info-value">' + videoBitrateMbps + ' Mbps</span></div>';
                }
                
                // Highlight HDR information from source file
                if (videoStream.VideoRange) {
                    var rangeDisplay = videoStream.VideoRange.toUpperCase();
                    var cssClass = (videoStream.VideoRange.toLowerCase() !== 'sdr') ? 'info-row info-highlight' : 'info-row';
                    infoHtml += '<div class="' + cssClass + '"><span class="info-label">Range:</span><span class="info-value">' + rangeDisplay + '</span></div>';
                }
                
                // Show color space and bit depth if available
                if (videoStream.ColorSpace) {
                    infoHtml += '<div class="info-row"><span class="info-label">Color Space:</span><span class="info-value">' + videoStream.ColorSpace + '</span></div>';
                }
                
                if (videoStream.BitDepth) {
                    infoHtml += '<div class="info-row"><span class="info-label">Bit Depth:</span><span class="info-value">' + videoStream.BitDepth + '-bit</span></div>';
                }
                
                if (videoStream.AverageFrameRate || videoStream.RealFrameRate) {
                    var fps = videoStream.AverageFrameRate || videoStream.RealFrameRate;
                    infoHtml += '<div class="info-row"><span class="info-label">Frame Rate:</span><span class="info-value">' + fps.toFixed(2) + ' fps</span></div>';
                }
            }
            
            if (audioStream) {
                infoHtml += '</div><div class="info-section">';
                infoHtml += '<div class="info-header">Audio</div>';
                
                if (audioStream.DisplayTitle) {
                    infoHtml += '<div class="info-row"><span class="info-label">Stream:</span><span class="info-value">' + audioStream.DisplayTitle + '</span></div>';
                }
                
                if (audioStream.Codec) {
                    infoHtml += '<div class="info-row"><span class="info-label">Codec:</span><span class="info-value">' + audioStream.Codec.toUpperCase() + '</span></div>';
                }
                
                if (audioStream.Channels) {
                    var channelLayout = audioStream.Channels + '.0';
                    if (audioStream.Channels === 6) channelLayout = '5.1';
                    else if (audioStream.Channels === 8) channelLayout = '7.1';
                    infoHtml += '<div class="info-row"><span class="info-label">Channels:</span><span class="info-value">' + channelLayout + '</span></div>';
                }
                
                if (audioStream.SampleRate) {
                    var sampleRateKHz = (audioStream.SampleRate / 1000).toFixed(1);
                    infoHtml += '<div class="info-row"><span class="info-label">Sample Rate:</span><span class="info-value">' + sampleRateKHz + ' kHz</span></div>';
                }
                
                if (audioStream.BitRate) {
                    var audioBitrateKbps = (audioStream.BitRate / 1000).toFixed(0);
                    infoHtml += '<div class="info-row"><span class="info-label">Bitrate:</span><span class="info-value">' + audioBitrateKbps + ' kbps</span></div>';
                }
                
                if (audioStream.Language) {
                    infoHtml += '<div class="info-row"><span class="info-label">Language:</span><span class="info-value">' + audioStream.Language.toUpperCase() + '</span></div>';
                }
            }
        }
        
        infoHtml += '</div>';
        
        elements.videoInfoContent.innerHTML = infoHtml;
        elements.videoInfoModal.style.display = 'flex';
        activeModal = 'videoInfo';
        
        // Make the content scrollable with remote control
        // Use the content container itself as the focusable element for scrolling
        setTimeout(function() {
            if (elements.videoInfoContent) {
                elements.videoInfoContent.setAttribute('tabindex', '0');
                elements.videoInfoContent.focus();
            }
        }, 100);
        
    }

    /**
     * Show chapters modal
     */
    function showChaptersModal() {
        if (!itemData || !itemData.Chapters || itemData.Chapters.length === 0) {
            // Still show modal but with "No chapters" message
            elements.chaptersContent.innerHTML = '<div class="no-chapters"><p>No chapters available for this video</p></div>';
            elements.chaptersModal.style.display = 'flex';
            activeModal = 'chapters';
            return;
        }

        // Build chapters list
        var chaptersHtml = '<div class="chapter-list">';
        
        var currentTime = videoPlayer.currentTime * 10000000; // Convert to ticks
        
        itemData.Chapters.forEach(function(chapter, index) {
            var chapterStartSeconds = chapter.StartPositionTicks / 10000000;
            var hours = Math.floor(chapterStartSeconds / 3600);
            var minutes = Math.floor((chapterStartSeconds % 3600) / 60);
            var seconds = Math.floor(chapterStartSeconds % 60);
            
            var timeStr = '';
            if (hours > 0) {
                timeStr = hours + ':' + (minutes < 10 ? '0' : '') + minutes + ':' + (seconds < 10 ? '0' : '') + seconds;
            } else {
                timeStr = minutes + ':' + (seconds < 10 ? '0' : '') + seconds;
            }
            
            var chapterName = chapter.Name || ('Chapter ' + (index + 1));
            
            // Check if this is the current chapter
            var isCurrent = false;
            if (index < itemData.Chapters.length - 1) {
                var nextChapterStart = itemData.Chapters[index + 1].StartPositionTicks;
                isCurrent = currentTime >= chapter.StartPositionTicks && currentTime < nextChapterStart;
            } else {
                // Last chapter
                isCurrent = currentTime >= chapter.StartPositionTicks;
            }
            
            var currentClass = isCurrent ? ' current-chapter' : '';
            var currentIndicator = isCurrent ? ' ► ' : '';
            
            chaptersHtml += '<div class="chapter-item' + currentClass + '" data-chapter-index="' + index + '" data-start-ticks="' + chapter.StartPositionTicks + '" tabindex="0">';
            chaptersHtml += '<div class="chapter-time">' + currentIndicator + timeStr + '</div>';
            chaptersHtml += '<div class="chapter-name">' + chapterName + '</div>';
            chaptersHtml += '</div>';
        });
        
        chaptersHtml += '</div>';
        
        elements.chaptersContent.innerHTML = chaptersHtml;
        elements.chaptersModal.style.display = 'flex';
        activeModal = 'chapters';
        
        // Set up focusable items for keyboard navigation
        modalFocusableItems = Array.from(document.querySelectorAll('.chapter-item'));
        currentModalFocusIndex = 0;
        
        // Find current chapter and focus it
        var currentChapterIndex = 0;
        itemData.Chapters.forEach(function(chapter, index) {
            if (index < itemData.Chapters.length - 1) {
                var nextChapterStart = itemData.Chapters[index + 1].StartPositionTicks;
                if (currentTime >= chapter.StartPositionTicks && currentTime < nextChapterStart) {
                    currentChapterIndex = index;
                }
            } else if (currentTime >= chapter.StartPositionTicks) {
                currentChapterIndex = index;
            }
        });
        
        currentModalFocusIndex = currentChapterIndex;
        
        if (modalFocusableItems.length > 0) {
            modalFocusableItems[currentModalFocusIndex].focus();
            modalFocusableItems[currentModalFocusIndex].classList.add('focused');
        }
        
        // Add click/enter handlers for chapters
        modalFocusableItems.forEach(function(item) {
            item.addEventListener('click', function(evt) {
                evt.stopPropagation();
                var startTicks = parseInt(item.getAttribute('data-start-ticks'));
                seekToChapter(startTicks);
            });
        });
        
    }

    /**
     * Seek to a chapter by its start position
     */
    function seekToChapter(startTicks) {
        var startSeconds = startTicks / 10000000;
        
        
        // Seek the video
        if (playerAdapter && typeof playerAdapter.seek === 'function') {
            playerAdapter.seek(startSeconds);
        } else {
            videoPlayer.currentTime = startSeconds;
        }
        
        // Close the modal
        closeModal();
    }

    /**
     * Show playback speed selector modal
     */
    function showPlaybackSpeedSelector() {
        if (!elements.speedList || !elements.speedModal) {
            return;
        }
        
        var listHtml = '';
        PLAYBACK_SPEEDS.forEach(function(speed) {
            var isSelected = Math.abs(speed - currentPlaybackSpeed) < 0.01;
            listHtml += '<div class="track-item' + (isSelected ? ' selected' : '') + '" tabindex="0" data-speed="' + speed + '">';
            listHtml += '<span class="track-name">' + speed.toFixed(2) + 'x</span>';
            if (isSelected) {
                listHtml += '<span class="selected-indicator">✓</span>';
            }
            listHtml += '</div>';
        });
        
        elements.speedList.innerHTML = listHtml;
        elements.speedModal.style.display = 'flex';
        activeModal = 'speed';
        
        modalFocusableItems = Array.from(elements.speedList.querySelectorAll('.track-item'));
        currentModalFocusIndex = PLAYBACK_SPEEDS.indexOf(currentPlaybackSpeed);
        if (currentModalFocusIndex < 0) currentModalFocusIndex = 3; // Default to 1.0x
        
        if (modalFocusableItems.length > 0) {
            modalFocusableItems[currentModalFocusIndex].focus();
            modalFocusableItems[currentModalFocusIndex].classList.add('focused');
        }
        
        // Add click handlers
        modalFocusableItems.forEach(function(item) {
            item.addEventListener('click', function(evt) {
                evt.stopPropagation();
                var speed = parseFloat(item.getAttribute('data-speed'));
                setPlaybackSpeed(speed);
            });
        });
        
    }
    
    /**
     * Set playback speed
     * @param {number} speed - Playback speed multiplier
     */
    function setPlaybackSpeed(speed) {
        if (speed < 0.25 || speed > 2.0) {
            return;
        }
        
        currentPlaybackSpeed = speed;
        
        if (videoPlayer) {
            videoPlayer.playbackRate = speed;
        }
        
        // Show speed indicator briefly
        if (elements.speedIndicator) {
            elements.speedIndicator.textContent = speed.toFixed(1) + 'x';
            elements.speedIndicator.style.display = 'block';
            elements.speedIndicator.style.opacity = '1';
            
            setTimeout(function() {
                elements.speedIndicator.style.opacity = '0';
                setTimeout(function() {
                    elements.speedIndicator.style.display = 'none';
                }, CONTROLS_FADE_DELAY_MS);
            }, AUTO_HIDE_CONTROLS_MS);
        }
        
        closeModal();
    }
    
    // Quality/Bitrate profiles (in Mbps)
    var QUALITY_PROFILES = [
        { value: '200000000', label: '200 Mbps' },
        { value: '180000000', label: '180 Mbps' },
        { value: '140000000', label: '140 Mbps' },
        { value: '120000000', label: '120 Mbps' },
        { value: '110000000', label: '110 Mbps' },
        { value: '100000000', label: '100 Mbps' },
        { value: '90000000', label: '90 Mbps' },
        { value: '80000000', label: '80 Mbps' },
        { value: '70000000', label: '70 Mbps' },
        { value: '60000000', label: '60 Mbps' },
        { value: '50000000', label: '50 Mbps' },
        { value: '40000000', label: '40 Mbps' },
        { value: '30000000', label: '30 Mbps' },
        { value: '20000000', label: '20 Mbps' },
        { value: '15000000', label: '15 Mbps' },
        { value: '10000000', label: '10 Mbps' },
        { value: '5000000', label: '5 Mbps' },
        { value: '3000000', label: '3 Mbps' },
        { value: '2000000', label: '2 Mbps' },
        { value: '1000000', label: '1 Mbps' },
        { value: '720000', label: '720 Kbps' },
        { value: '420000', label: '420 Kbps' }
    ];
    
    /**
     * Show quality/bitrate selector modal
     */
    function showQualitySelector() {
        if (!elements.qualityList || !elements.qualityModal) {
            return;
        }
        
        // Get current max bitrate setting (stored in bps)
        var currentMaxBitrate = storage.get('maxBitrate', false) || '120000000';
        
        var listHtml = '';
        QUALITY_PROFILES.forEach(function(profile) {
            var isSelected = profile.value === currentMaxBitrate;
            listHtml += '<div class="track-item' + (isSelected ? ' selected' : '') + '" tabindex="0" data-bitrate="' + profile.value + '">';
            listHtml += '<span class="track-name">' + profile.label + '</span>';
            if (isSelected) {
                listHtml += '<span class="selected-indicator">✓</span>';
            }
            listHtml += '</div>';
        });
        
        elements.qualityList.innerHTML = listHtml;
        elements.qualityModal.style.display = 'flex';
        activeModal = 'quality';
        
        modalFocusableItems = Array.from(elements.qualityList.querySelectorAll('.track-item'));
        
        // Find the index of current selection
        currentModalFocusIndex = QUALITY_PROFILES.findIndex(function(p) {
            return p.value === currentMaxBitrate;
        });
        if (currentModalFocusIndex < 0) currentModalFocusIndex = 3; // Default to 120 Mbps
        
        if (modalFocusableItems.length > 0 && modalFocusableItems[currentModalFocusIndex]) {
            modalFocusableItems[currentModalFocusIndex].focus();
            modalFocusableItems[currentModalFocusIndex].classList.add('focused');
        }
        
        // Add click handlers
        modalFocusableItems.forEach(function(item) {
            item.addEventListener('click', function(evt) {
                evt.stopPropagation();
                var bitrate = item.getAttribute('data-bitrate');
                setMaxBitrate(bitrate);
            });
        });
        
    }
    
    /**
     * Set max bitrate preference
     * @param {string} bitrate - Max bitrate in bps
     */
    function setMaxBitrate(bitrate) {
        storage.set('maxBitrate', bitrate, false);
        
        var profile = QUALITY_PROFILES.find(function(p) { return p.value === bitrate; });
        var label = profile ? profile.label : bitrate;
        
        
        // Show indicator briefly
        if (elements.bitrateIndicator) {
            elements.bitrateIndicator.textContent = 'Max: ' + label;
            elements.bitrateIndicator.style.display = 'block';
            elements.bitrateIndicator.style.opacity = '1';
            
            setTimeout(function() {
                elements.bitrateIndicator.style.opacity = '0';
                setTimeout(function() {
                    elements.bitrateIndicator.style.display = 'none';
                }, CONTROLS_FADE_DELAY_MS);
            }, AUTO_HIDE_CONTROLS_MS);
        }
        
        closeModal();
    }
    
    function showPlayModeSelector() {
        if (!elements.playModeList || !elements.playModeModal) {
            return;
        }
        
        if (!currentMediaSource) {
            return;
        }
        
        var modes = [];
        if (currentMediaSource.SupportsDirectPlay) {
            modes.push({ label: 'Direct Play', value: 'direct' });
        }
        if (currentMediaSource.SupportsTranscoding) {
            modes.push({ label: 'Transcode', value: 'transcode' });
        }
        
        if (modes.length === 0) {
            return;
        }
        
        var listHtml = '';
        modes.forEach(function(mode) {
            var isSelected = forcePlayMode === mode.value;
            listHtml += '<div class="track-item' + (isSelected ? ' selected' : '') + '" tabindex="0" data-mode="' + mode.value + '">';
            listHtml += '<span class="track-name">' + mode.label + '</span>';
            if (isSelected) {
                listHtml += '<span class="selected-indicator">✓</span>';
            }
            listHtml += '</div>';
        });
        
        elements.playModeList.innerHTML = listHtml;
        elements.playModeModal.style.display = 'flex';
        activeModal = 'playmode';
        
        modalFocusableItems = Array.from(elements.playModeList.querySelectorAll('.track-item'));
        
        currentModalFocusIndex = 0;
        if (forcePlayMode) {
            currentModalFocusIndex = modes.findIndex(function(m) { return m.value === forcePlayMode; });
            if (currentModalFocusIndex < 0) currentModalFocusIndex = 0;
        }
        
        if (modalFocusableItems.length > 0 && modalFocusableItems[currentModalFocusIndex]) {
            modalFocusableItems[currentModalFocusIndex].focus();
            modalFocusableItems[currentModalFocusIndex].classList.add('focused');
        }
        
        modalFocusableItems.forEach(function(item) {
            item.addEventListener('click', function(evt) {
                evt.stopPropagation();
                var mode = item.getAttribute('data-mode');
                setPlayMode(mode);
            });
        });
    }
    
    function setPlayMode(mode) {
        forcePlayMode = mode;
        hideControls();
        closeModal();
    }
    
    /**
     * Start monitoring bitrate and update indicator
     */
    function startBitrateMonitoring() {
        if (bitrateUpdateInterval) {
            clearInterval(bitrateUpdateInterval);
        }
        
        bitrateUpdateInterval = setInterval(function() {
            updateBitrateIndicator();
        }, BITRATE_UPDATE_INTERVAL_MS);
    }
    
    /**
     * Stop bitrate monitoring
     */
    function stopBitrateMonitoring() {
        if (bitrateUpdateInterval) {
            clearInterval(bitrateUpdateInterval);
            bitrateUpdateInterval = null;
        }
        
        if (elements.bitrateIndicator) {
            elements.bitrateIndicator.style.display = 'none';
        }
    }
    
    /**
     * Update bitrate indicator based on current playback
     */
    function updateBitrateIndicator() {
        if (!elements.bitrateIndicator || !playbackInfo || !playbackInfo.MediaSource) {
            return;
        }
        
        var mediaSource = playbackInfo.MediaSource;
        var bitrate = 0;
        
        // Get bitrate from media source
        if (mediaSource.Bitrate) {
            bitrate = mediaSource.Bitrate;
        } else if (playbackInfo.PlayMethod === 'Transcode' && playbackInfo.TranscodingInfo) {
            // For transcoding, use target bitrate
            bitrate = playbackInfo.TranscodingInfo.Bitrate || 0;
        }
        
        if (bitrate > 0) {
            var bitrateMbps = (bitrate / 1000000).toFixed(1);
            elements.bitrateIndicator.textContent = bitrateMbps + ' Mbps';
            elements.bitrateIndicator.style.display = 'block';
        }
    }

    /**
     * Close all modals
     */
    /**
     * Close all modals
     */
    function closeModal() {
        if (elements.audioModal) {
            elements.audioModal.style.display = 'none';
        }
        if (elements.subtitleModal) {
            elements.subtitleModal.style.display = 'none';
        }
        if (elements.speedModal) {
            elements.speedModal.style.display = 'none';
        }
        if (elements.qualityModal) {
            elements.qualityModal.style.display = 'none';
        }
        if (elements.playModeModal) {
            elements.playModeModal.style.display = 'none';
        }
        if (elements.videoInfoModal) {
            elements.videoInfoModal.style.display = 'none';
        }
        if (elements.chaptersModal) {
            elements.chaptersModal.style.display = 'none';
        }
        activeModal = null;
        modalFocusableItems = [];
        
        if (elements.playModeBtn && focusableButtons.indexOf(elements.playModeBtn) !== -1) {
            setTimeout(function() {
                elements.playModeBtn.focus();
            }, 100);
        }
    }

    /**
     * Load media segments (intro/outro markers) from Jellyfin server
     */
    function loadMediaSegments() {
        if (!auth || !itemId) {
            return;
        }
        
        var url = auth.serverAddress + '/MediaSegments/' + itemId;
        
        var authHeader = 'MediaBrowser Client="' + JellyfinAPI.appName + '", Device="' + JellyfinAPI.deviceName + 
                         '", DeviceId="' + JellyfinAPI.deviceId + '", Version="' + JellyfinAPI.appVersion + '", Token="' + auth.accessToken + '"';
        
        ajax.request(url, {
            method: 'GET',
            headers: {
                'X-Emby-Authorization': authHeader
            },
            success: function(response) {
                try {
                    var data = response;
                    if (data && data.Items && data.Items.length > 0) {
                        data.Items.forEach(function(seg, idx) {
                            var duration = (seg.EndTicks - seg.StartTicks) / 10000000;
                            console.log('Segment', idx, seg.Type,
                                        'from', (seg.StartTicks / 10000000).toFixed(0), 'to', (seg.EndTicks / 10000000).toFixed(0));
                        });
                        
                        // Filter out very short segments (< 1 second)
                        mediaSegments = data.Items.filter(function(segment) {
                            var duration = (segment.EndTicks - segment.StartTicks) / 10000000;
                            return duration >= 1;
                        });
                        mediaSegments.forEach(function(seg) {
                        });
                    } else {
                        mediaSegments = [];
                    }
                } catch (e) {
                    mediaSegments = [];
                }
            },
            error: function(errorObj) {
                mediaSegments = [];
            }
        });
    }

    /**
     * Load next episode data for "Play Next Episode" button
     */
    function loadNextEpisode() {
        console.log('[loadNextEpisode] START');
        console.log('[loadNextEpisode] auth:', !!auth, 'itemData:', !!itemData);
        
        if (!auth || !itemData) {
            console.log('[loadNextEpisode] Missing auth or itemData, returning');
            return;
        }
        
        console.log('[loadNextEpisode] itemData.Type:', itemData.Type, 'itemData.SeriesId:', itemData.SeriesId);
        
        // Only load next episode for TV episodes
        if (itemData.Type !== 'Episode' || !itemData.SeriesId) {
            console.log('[loadNextEpisode] Not an episode or no SeriesId, returning');
            return;
        }
        
        var url = auth.serverAddress + '/Shows/' + itemData.SeriesId + '/Episodes';
        var params = {
            UserId: auth.userId,
            StartItemId: itemId,
            Limit: 2,
            Fields: 'Overview'
        };
        
        var queryString = Object.keys(params).map(function(key) {
            return encodeURIComponent(key) + '=' + encodeURIComponent(params[key]);
        }).join('&');
        
        console.log('[loadNextEpisode] Making request to:', url + '?' + queryString);
        
        ajax.request(url + '?' + queryString, {
            method: 'GET',
            headers: {
                'X-Emby-Authorization': JellyfinAPI.getAuthHeader(auth.accessToken)
            },
            success: function(response) {
                try {
                    var data = response;
                    console.log('[loadNextEpisode] Response:', data);
                    if (data && data.Items && data.Items.length > 1) {
                        nextEpisodeData = data.Items[1]; // Second item is the next episode
                        console.log('[loadNextEpisode] Next episode loaded:', nextEpisodeData.Name, nextEpisodeData.Id);
                    } else {
                        nextEpisodeData = null;
                        console.log('[loadNextEpisode] No next episode available - Items length:', data && data.Items ? data.Items.length : 'N/A');
                    }
                } catch (e) {
                    console.log('[loadNextEpisode] Error parsing next episode:', e);
                    nextEpisodeData = null;
                }
            },
            error: function(status, response) {
                console.log('[loadNextEpisode] Request failed - status:', status, 'response:', response);
                nextEpisodeData = null;
            }
        });
    }

    /**
     * Check if current playback position is within a skip segment
     */
    function checkSkipSegments(currentTime) {
        if (!mediaSegments || mediaSegments.length === 0) return;
        
        // Check if skip intro feature is enabled
        var stored = storage.getUserPreference('jellyfin_settings', null);
        if (stored) {
            try {
                var settings = JSON.parse(stored);
                if (settings.skipIntro === false) {
                    // Skip intro is disabled, don't show skip buttons
                    if (skipOverlayVisible) {
                        hideSkipOverlay();
                    }
                    return;
                }
            } catch (e) {
                // If parsing fails, continue with default behavior
            }
        }
        
        var currentTicks = currentTime * 10000000;
        
        // Check each segment
        for (var i = 0; i < mediaSegments.length; i++) {
            var segment = mediaSegments[i];
            
            if (currentTicks >= segment.StartTicks && currentTicks <= segment.EndTicks) {
                // We're in a skip segment
                if (!skipOverlayVisible || currentSkipSegment !== segment) {
                    currentSkipSegment = segment;
                    showSkipOverlay(segment);
                }
                return;
            }
        }
        
        // Not in any segment - hide overlay if visible
        if (skipOverlayVisible) {
            hideSkipOverlay();
        }
    }

    /**
     * Show skip overlay button
     */
    function showSkipOverlay(segment) {
        if (!elements.skipOverlay || !elements.skipButton || !elements.skipButtonText) return;
        
        var buttonText = getSkipButtonText(segment.Type);
        elements.skipButtonText.textContent = buttonText;
        
        elements.skipOverlay.style.display = 'block';
        setTimeout(function() {
            elements.skipOverlay.classList.add('visible');
            // Auto-focus the skip button for remote control
            if (elements.skipButton) {
                elements.skipButton.focus();
            }
        }, 10);
        
        skipOverlayVisible = true;
    }

    /**
     * Hide skip overlay button
     */
    function hideSkipOverlay() {
        if (!elements.skipOverlay) return;
        
        elements.skipOverlay.classList.remove('visible');
        setTimeout(function() {
            elements.skipOverlay.style.display = 'none';
        }, 300);
        
        skipOverlayVisible = false;
        currentSkipSegment = null;
    }

    /**
     * Get button text based on segment type
     */
    function getSkipButtonText(segmentType) {
        switch (segmentType) {
            case 'Intro':
                return 'Skip Intro';
            case 'Outro':
            case 'Credits':
                // Check if we have next episode data
                if (nextEpisodeData) {
                    return 'Play Next Episode';
                }
                return 'Skip Credits';
            case 'Preview':
                return 'Skip Preview';
            case 'Recap':
                return 'Skip Recap';
            default:
                return 'Skip';
        }
    }

    /**
     * Update skip button countdown time
     */
    function updateSkipButtonTime(seconds) {
        if (!elements.skipButtonTime) return;
        
        if (seconds > 0) {
            elements.skipButtonTime.textContent = seconds + 's';
        } else {
            elements.skipButtonTime.textContent = '';
        }
    }

    /**
     * Play next episode without page reload
     */
    /**
     * Play the next episode in the series without reloading the page
     */
    function playNextEpisode() {
        console.log('[playNextEpisode] START');
        if (!nextEpisodeData) {
            console.log('[playNextEpisode] No next episode data available');
            return;
        }
        
        console.log('[playNextEpisode] Next episode:', nextEpisodeData.Name, nextEpisodeData.Id);
        
        // Save next episode ID before clearing
        var nextEpisodeId = nextEpisodeData.Id;
        console.log('[playNextEpisode] Saved next episode ID:', nextEpisodeId);
        
        // Stop current playback reporting
        console.log('[playNextEpisode] Stopping current playback...');
        console.log('[playNextEpisode] Reporting playback stop...');
        reportPlaybackStop();
        console.log('[playNextEpisode] Stopping progress reporting...');
        stopProgressReporting();
        
        // Clear current state
        console.log('[playNextEpisode] Clearing current state...');
        currentSkipSegment = null;
        skipOverlayVisible = false;
        hideSkipOverlay();
        mediaSegments = [];
        nextEpisodeData = null;
        
        // Update browser history so BACK goes to correct details page
        if (window && window.history && window.location) {
            var newUrl = 'player.html?id=' + nextEpisodeId;
            window.history.replaceState({}, '', newUrl);
        }
        // Load and play the next episode (keep playerAdapter alive)
        console.log('[playNextEpisode] Setting itemId to:', nextEpisodeId);
        itemId = nextEpisodeId;
        console.log('[playNextEpisode] Calling loadItemAndPlay()...');
        loadItemAndPlay();
        console.log('[playNextEpisode] END');
    }
    
    /**
     * Execute skip action (seek past segment or play next episode)
     */
    /**
     * Execute skip action (seek past segment or play next episode)
     */
    function executeSkip() {
        console.log('[executeSkip] START - currentSkipSegment:', currentSkipSegment);
        if (!currentSkipSegment) {
            console.log('[executeSkip] No currentSkipSegment, returning');
            return;
        }
        
        var segmentType = currentSkipSegment.Type;
        console.log('[executeSkip] segmentType:', segmentType, 'nextEpisodeData:', nextEpisodeData);
        
        // For outro/credits with next episode available, play next episode directly
        // (User manually pressed skip, so honor that intent regardless of autoPlay setting)
        if ((segmentType === 'Outro' || segmentType === 'Credits') && nextEpisodeData) {
            console.log('[executeSkip] Conditions met - calling playNextEpisode()');
            playNextEpisode();
            console.log('[executeSkip] Returned from playNextEpisode()');
            return;
        }
        
        // Otherwise, seek past the segment
        var skipToTime = currentSkipSegment.EndTicks / 10000000;
        console.log('[executeSkip] Seeking to:', skipToTime);
        videoPlayer.currentTime = skipToTime;
        hideSkipOverlay();
        console.log('[executeSkip] END');
    }

    return {
        init: init
    };
})();

window.addEventListener('load', function() {
    PlayerController.init();
});
