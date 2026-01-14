/**
 * Player Controller Module
 * Manages video playback, controls, track selection, and playback reporting
 * Supports direct play, transcoding, and Live TV streaming
 * @module PlayerController
 */
var PlayerController = (function () {
   "use strict";

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
   let modalOpenerButton = null; // Track which button opened the modal for focus restoration
   let isSeekbarFocused = false;
   let seekPosition = 0;
   let loadingTimeout = null;
   let seekDebounceTimer = null;
   let isSeeking = false;
   let isSeekingActive = false; // True while user is actively seeking (before debounce completes)
   let pendingSeekPosition = null;
   let currentMediaSource = null;
   let isTranscoding = false;
   let currentPlaybackSpeed = 1.0;
   let isDolbyVisionMedia = false; // Track if current media is Dolby Vision
   let playbackHealthCheckTimer = null; // Timer for checking playback health
   let forcePlayMode = null; // User override for playback mode ('direct' or 'transcode')

   const USE_PLAYBACK_MANAGER = true;
   let playbackManagerReady = false;

   // Load persisted play mode on init
   function loadForcePlayMode() {
      if (typeof storage !== "undefined" && itemId) {
         forcePlayMode = storage.get("forcePlayMode_" + itemId, false) || null;
         if (forcePlayMode) {
            console.log("[Player] Loaded persisted play mode:", forcePlayMode);
         }
      }
   }

   // Save play mode to persist across reloads
   function saveForcePlayMode(mode) {
      if (typeof storage !== "undefined" && itemId) {
         if (mode) {
            storage.set("forcePlayMode_" + itemId, mode, false);
            console.log("[Player] Saved play mode to storage:", mode);
         } else {
            storage.remove("forcePlayMode_" + itemId);
         }
      }
   }
   const PLAYBACK_SPEEDS = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];
   let bitrateUpdateInterval = null;

   // Skip intro/outro variables
   let mediaSegments = [];
   let currentSkipSegment = null;
   let skipOverlayVisible = false;
   let nextEpisodeData = null;
   let previousEpisodeData = null;

   // Trickplay variables (Jellyfin Web compatible)
   let trickplayData = null;           // Trickplay info for current media source
   let trickplayResolution = null;     // Selected trickplay resolution info
   let trickplayVisible = false;

   // Audio normalization variables (Jellyfin Web compatible)
   let audioContext = null;
   let gainNode = null;
   let sourceNode = null;
   let normalizationGain = 1.0;
   let audioNormalizationEnabled = true; // Can be made into a user setting

   // Loading state machine
   const LoadingState = {
      IDLE: "idle",
      INITIALIZING: "initializing",
      LOADING: "loading",
      READY: "ready",
      ERROR: "error",
   };
   let loadingState = LoadingState.IDLE;

   let elements = {};

   // Timing Constants
   const PROGRESS_REPORT_INTERVAL_MS = 10000;
   const CONTROLS_HIDE_DELAY_MS = 8000;
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
      console.log("[Player] Initializing player controller");

      // Get auth for the specific server from URL params or active server
      auth =
         typeof MultiServerManager !== "undefined"
            ? MultiServerManager.getAuthForPage()
            : JellyfinAPI.getStoredAuth();

      if (!auth) {
         window.location.href = "login.html";
         return;
      }

      itemId = getItemIdFromUrl();
      if (!itemId) {
         showErrorDialog(
            "Invalid Request",
            "No media ID was provided. Please select a media item to play."
         );
         return;
      }

      loadForcePlayMode();

      cacheElements();
      setupEventListeners();

      if (USE_PLAYBACK_MANAGER) {
         initPlaybackManagerAdapter();
      }

      // Initialize playback flow (adapter will be created once playback method is known)
      loadItemAndPlay();
   }

   function initPlaybackManagerAdapter() {
      console.log('[Player] Initializing PlaybackManager adapter...');

      if (typeof PlaybackManagerAdapter === 'undefined') {
         console.error('[Player] PlaybackManagerAdapter not found! Make sure playback-manager-adapter.js is loaded');
         return;
      }

      // Define UI callbacks for PlaybackManager events
      var callbacks = {
         onTimeUpdate: function (currentTicks, durationTicks) {
            updateTimeDisplay();
            checkMediaSegments(currentTicks);
         },

         onPause: function () {
            updatePlayPauseButton();
            showControls();
         },

         onUnpause: function () {
            updatePlayPauseButton();
            showControls();
         },

         onPlaybackStart: function (state) {
            console.log('[Player] PlaybackManager playback started', state);
            showControls();

            // Update our internal state from PlaybackManager
            if (state && state.NowPlayingItem) {
               itemData = state.NowPlayingItem;
               itemId = itemData.Id;
            }

            // PlaybackManager handles server reporting automatically
            // No need to call reportPlaybackStart()

            // Load tracks from PlaybackManager
            loadAudioTracksFromPlaybackManager();
            loadSubtitleTracksFromPlaybackManager();

            // Start UI updates
            if (!progressInterval) {
               startProgressReporting(); // Keep our interval for UI updates
            }
         },

         onPlaybackStop: function (stopInfo) {
            console.log('[Player] PlaybackManager playback stopped', stopInfo);
            cleanup();
         },

         onMediaStreamsChange: function () {
            console.log('[Player] Media streams changed, reloading tracks');
            loadAudioTracksFromPlaybackManager();
            loadSubtitleTracksFromPlaybackManager();
         },

         onError: function (error) {
            console.error('[Player] PlaybackManager error:', error);
            showErrorDialog('Playback Error', error.message || 'An error occurred during playback');
         }
      };

      // Initialize adapter with callbacks
      playbackManagerReady = PlaybackManagerAdapter.init(callbacks);

      if (playbackManagerReady) {
         console.log('[Player] PlaybackManager adapter initialized successfully');
      } else {
         console.error('[Player] Failed to initialize PlaybackManager adapter, falling back to legacy mode');
      }
   }

   function getItemIdFromUrl() {
      var params = new URLSearchParams(window.location.search);
      return params.get("id");
   }

   /**
    * Get the start position (in seconds) from the URL query parameter, if present
    * @returns {number|null} Start position in seconds, or null if not specified
    */
   function getStartPositionFromUrl() {
      var params = new URLSearchParams(window.location.search);
      var position = params.get("position");
      if (position !== null) {
         return parseInt(position, 10);
      }
      return null;
   }

   function cacheElements() {
      elements = {
         videoPlayer: document.getElementById("videoPlayer"),
         videoDimmer: document.getElementById("videoDimmer"),
         playerControls: document.getElementById("playerControls"),
         mediaLogo: document.getElementById("mediaLogo"),
         mediaTitle: document.getElementById("mediaTitle"),
         mediaSubtitle: document.getElementById("mediaSubtitle"),
         progressBar: document.getElementById("progressBar"),
         progressFill: document.getElementById("progressFill"),
         seekIndicator: document.getElementById("seekIndicator"),
         timeDisplay: document.getElementById("timeDisplay"),
         endTime: document.getElementById("endTime"),
         playPauseBtn: document.getElementById("playPauseBtn"),
         rewindBtn: document.getElementById("rewindBtn"),
         forwardBtn: document.getElementById("forwardBtn"),
         audioBtn: document.getElementById("audioBtn"),
         subtitleBtn: document.getElementById("subtitleBtn"),
         chaptersBtn: document.getElementById("chaptersBtn"),
         previousItemBtn: document.getElementById("previousItemBtn"),
         nextItemBtn: document.getElementById("nextItemBtn"),
         videoInfoBtn: document.getElementById("videoInfoBtn"),
         backBtn: document.getElementById("backBtn"),
         loadingIndicator: document.getElementById("loadingIndicator"),
         errorDialog: document.getElementById("errorDialog"),
         errorDialogTitle: document.getElementById("errorDialogTitle"),
         errorDialogMessage: document.getElementById("errorDialogMessage"),
         errorDialogDetails: document.getElementById("errorDialogDetails"),
         errorDialogBtn: document.getElementById("errorDialogBtn"),
         audioModal: document.getElementById("audioModal"),
         audioTrackList: document.getElementById("audioTrackList"),
         subtitleModal: document.getElementById("subtitleModal"),
         subtitleTrackList: document.getElementById("subtitleTrackList"),
         chaptersModal: document.getElementById("chaptersModal"),
         chaptersContent: document.getElementById("chaptersContent"),
         videoInfoModal: document.getElementById("videoInfoModal"),
         videoInfoContent: document.getElementById("videoInfoContent"),
         speedBtn: document.getElementById("speedBtn"),
         speedModal: document.getElementById("speedModal"),
         speedList: document.getElementById("speedList"),
         speedIndicator: document.getElementById("speedIndicator"),
         bitrateIndicator: document.getElementById("bitrateIndicator"),
         qualityBtn: document.getElementById("qualityBtn"),
         qualityModal: document.getElementById("qualityModal"),
         qualityList: document.getElementById("qualityList"),
         playModeBtn: document.getElementById("playModeBtn"),
         playModeModal: document.getElementById("playModeModal"),
         playModeList: document.getElementById("playModeList"),
         skipOverlay: document.getElementById("skipOverlay"),
         skipButton: document.getElementById("skipButton"),
         skipButtonText: document.getElementById("skipButtonText"),
         skipButtonTime: document.getElementById("skipButtonTime"),
         errorDialog: document.getElementById("errorDialog"),
         errorDialogTitle: document.getElementById("errorDialogTitle"),
         errorDialogMessage: document.getElementById("errorDialogMessage"),
         errorDialogDetails: document.getElementById("errorDialogDetails"),
         errorDialogBtn: document.getElementById("errorDialogBtn"),
         // Trickplay elements
         trickplayBubble: document.getElementById("trickplayBubble"),
         trickplayThumb: document.getElementById("trickplayThumb"),
         trickplayChapterName: document.getElementById("trickplayChapterName"),
         trickplayTime: document.getElementById("trickplayTime"),
      };

      videoPlayer = elements.videoPlayer;

      // Set initial volume to maximum and ensure not muted
      if (videoPlayer) {
         videoPlayer.volume = 1.0;
         videoPlayer.muted = false;
         console.log('[Player] Set initial video volume to:', videoPlayer.volume, 'muted:', videoPlayer.muted);
      }

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
         elements.backBtn,
      ].filter(Boolean);
   }

   function setupEventListeners() {
      // Error dialog
      elements.errorDialogBtn.addEventListener("click", closeErrorDialog);
      // Keyboard controls
      document.addEventListener("keydown", handleKeyDown);

      // Video player events
      videoPlayer.addEventListener("play", onPlay);
      videoPlayer.addEventListener("pause", onPause);
      videoPlayer.addEventListener("timeupdate", onTimeUpdate);
      videoPlayer.addEventListener("ended", onEnded);
      videoPlayer.addEventListener("error", onError);
      videoPlayer.addEventListener("canplay", onCanPlay);
      videoPlayer.addEventListener("loadedmetadata", onLoadedMetadata);
      videoPlayer.addEventListener("loadeddata", onLoadedData);
      videoPlayer.addEventListener("waiting", onWaiting);
      videoPlayer.addEventListener("playing", onPlaying);

      // Control buttons
      if (elements.playPauseBtn) {
         elements.playPauseBtn.addEventListener("click", togglePlayPause);
      }
      if (elements.rewindBtn) {
         elements.rewindBtn.addEventListener("click", rewind);
      }
      if (elements.forwardBtn) {
         elements.forwardBtn.addEventListener("click", forward);
      }
      if (elements.backBtn) {
         elements.backBtn.addEventListener("click", exitPlayer);
      }
      if (elements.audioBtn) {
         elements.audioBtn.addEventListener("click", showAudioTrackSelector);
      }
      if (elements.subtitleBtn) {
         elements.subtitleBtn.addEventListener(
            "click",
            showSubtitleTrackSelector
         );
      }
      if (elements.chaptersBtn) {
         elements.chaptersBtn.addEventListener("click", showChaptersModal);
      }
      if (elements.previousItemBtn) {
         elements.previousItemBtn.addEventListener("click", playPreviousItem);
      }
      if (elements.nextItemBtn) {
         elements.nextItemBtn.addEventListener("click", playNextItem);
      }
      if (elements.videoInfoBtn) {
         elements.videoInfoBtn.addEventListener("click", showVideoInfo);
      }
      if (elements.speedBtn) {
         elements.speedBtn.addEventListener("click", showPlaybackSpeedSelector);
      }
      if (elements.qualityBtn) {
         elements.qualityBtn.addEventListener("click", showQualitySelector);
      }
      if (elements.playModeBtn) {
         elements.playModeBtn.addEventListener("click", showPlayModeSelector);
      }

      // Skip button
      if (elements.skipButton) {
         elements.skipButton.addEventListener("click", executeSkip);
         elements.skipButton.addEventListener("keydown", function (evt) {
            if (evt.keyCode === KeyCodes.ENTER) {
               evt.preventDefault();
               executeSkip();
            }
         });
      }

      document.addEventListener("mousemove", showControls);
      document.addEventListener("click", showControls);

      if (elements.progressBar) {
         elements.progressBar.setAttribute("tabindex", "0");
         elements.progressBar.addEventListener("click", handleProgressBarClick);
         elements.progressBar.addEventListener("focus", function () {
            isSeekbarFocused = true;
            seekPosition = videoPlayer.currentTime;
            showTrickplayBubble();
         });
         elements.progressBar.addEventListener("blur", function () {
            isSeekbarFocused = false;
            hideTrickplayBubble();
         });

         elements.progressBar.addEventListener("mousemove", function (evt) {
            if (!videoPlayer.duration) return;
            var rect = elements.progressBar.getBoundingClientRect();
            var percent = ((evt.clientX - rect.left) / rect.width) * 100;
            var positionTicks = (percent / 100) * videoPlayer.duration * TICKS_PER_SECOND;
            updateTrickplayBubble(positionTicks, percent);
         });

         elements.progressBar.addEventListener("mouseenter", function () {
            showTrickplayBubble();
         });

         elements.progressBar.addEventListener("mouseleave", function () {
            if (!isSeekbarFocused) {
               hideTrickplayBubble();
            }
         });
      }
   }

   async function ensurePlayerAdapter(options = {}) {
      try {
         // Reuse adapter if it already matches the preference
         if (playerAdapter) {
            const name = playerAdapter.getName();
            if (options.preferTizen && name === "TizenVideo") {
               return;
            }
            if (options.preferHTML5 && name === "HTML5Video") {
               return;
            }
            if (options.preferHLS && name === "HTML5Video") {
               return;
            }
            if (
               !options.preferTizen &&
               !options.preferHTML5 &&
               !options.preferHLS &&
               name === "ShakaPlayer"
            ) {
               return;
            }
            await playerAdapter.destroy();
         }

         showLoading();
         console.log("[Player] Adapter options:", JSON.stringify(options));

         playerAdapter = await VideoPlayerFactory.createPlayer(
            videoPlayer,
            options
         );

         playerAdapter.on("error", function (error) {
            onError(error);
         });

         playerAdapter.on("buffering", function (buffering) {
            if (buffering) {
               showLoading();
            } else {
               hideLoading();
            }
         });

         playerAdapter.on("loaded", function (data) {
            hideLoading();
         });

         playerAdapter.on("qualitychange", function (data) { });

         playerAdapter.on("audiotrackchange", function (data) {
            detectCurrentAudioTrack();
         });
      } catch (error) {
         alert("Failed to initialize video player: " + error.message);
         window.history.back();
      }
   }

   function handleKeyDown(evt) {
      evt = evt || window.event;

      // Handle error dialog first
      if (
         elements.errorDialog &&
         elements.errorDialog.style.display !== "none"
      ) {
         if (
            evt.keyCode === KeyCodes.OK ||
            evt.keyCode === KeyCodes.ENTER ||
            evt.keyCode === KeyCodes.BACK
         ) {
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
         case KeyCodes.OK:
            evt.preventDefault();
            // If a button is focused, trigger its click
            if (document.activeElement && focusableButtons.includes(document.activeElement)) {
               document.activeElement.click();
            } else if (isSeekbarFocused) {
               // If seekbar is focused, toggle play/pause
               togglePlayPause();
            } else {
               // Otherwise toggle play/pause and ensure focus
               togglePlayPause();

               // Ensure controls are visible and focus is on play button
               showControls();
               if (elements.playPauseBtn) {
                  elements.playPauseBtn.focus();
               }
            }
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
            if (
               !document.activeElement ||
               !focusableButtons.includes(document.activeElement)
            ) {
               rewind();
            }
            break;

         case KeyCodes.FORWARD:
            evt.preventDefault();
            if (
               !document.activeElement ||
               !focusableButtons.includes(document.activeElement)
            ) {
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
            } else if (
               document.activeElement &&
               focusableButtons.includes(document.activeElement)
            ) {
               // If on the bottom buttons (index >= 6), move to seekbar
               if (currentFocusIndex >= 6) {
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
            if (
               document.activeElement &&
               focusableButtons.includes(document.activeElement)
            ) {
               // If on any of the top buttons (index < 6), move to seekbar
               if (currentFocusIndex < 6) {
                  if (elements.progressBar) {
                     elements.progressBar.focus();
                  }
               }
            } else if (isSeekbarFocused) {
               // Move from seekbar to first bottom button (chaptersBtn at index 6)
               if (focusableButtons.length > 6) {
                  currentFocusIndex = 6;
                  focusableButtons[currentFocusIndex].focus();
               } else if (focusableButtons.length > 0) {
                  // Fallback if fewer buttons
                  currentFocusIndex = focusableButtons.length - 1;
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
            } else if (
               document.activeElement &&
               focusableButtons.includes(document.activeElement)
            ) {
               evt.preventDefault();
               currentFocusIndex =
                  (currentFocusIndex - 1 + focusableButtons.length) %
                  focusableButtons.length;
               focusableButtons[currentFocusIndex].focus();
            }
            break;

         case KeyCodes.RIGHT:
            if (isSeekbarFocused) {
               // Seek forward on seekbar
               evt.preventDefault();
               seekForward();
            } else if (
               document.activeElement &&
               focusableButtons.includes(document.activeElement)
            ) {
               evt.preventDefault();
               currentFocusIndex =
                  (currentFocusIndex + 1) % focusableButtons.length;
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
      if (activeModal === "videoInfo") {
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

      var endpoint = "/Users/" + auth.userId + "/Items/" + itemId;
      var params = {
         Fields: "MediaSources,MediaStreams,Chapters,Trickplay",
      };

      JellyfinAPI.getItems(
         auth.serverAddress,
         auth.accessToken,
         endpoint,
         params,
         function (err, data) {
            if (err || !data) {
               alert("Failed to load media item");
               window.history.back();
               return;
            }

            itemData = data;
            console.log(
               "[Player] Loaded item:",
               itemData.Name,
               "Type:",
               itemData.Type
            );

            var hasLogo = false;

            // Try to get logo image (for series/movies with logo)
            if (itemData.ImageTags && itemData.ImageTags.Logo) {
               if (elements.mediaLogo) {
                  elements.mediaLogo.src =
                     auth.serverAddress +
                     "/Items/" +
                     itemData.Id +
                     "/Images/Logo?quality=90&maxHeight=150";
                  elements.mediaLogo.style.display = "block";
                  hasLogo = true;
               }
            } else if (itemData.SeriesId && itemData.Type === "Episode") {
               // For episodes, try to get the series logo
               if (elements.mediaLogo) {
                  elements.mediaLogo.src =
                     auth.serverAddress +
                     "/Items/" +
                     itemData.SeriesId +
                     "/Images/Logo?quality=90&maxHeight=150";
                  elements.mediaLogo.style.display = "block";
                  hasLogo = true;
               }
            }

            // Fallback to title text if no logo :(
            if (!hasLogo && elements.mediaTitle) {
               elements.mediaTitle.textContent = itemData.Name;
               elements.mediaTitle.style.display = "block";
               if (elements.mediaLogo) {
                  elements.mediaLogo.style.display = "none";
               }
            } else if (elements.mediaTitle) {
               elements.mediaTitle.style.display = "none";
            }

            if (elements.mediaSubtitle && itemData.Type === "Episode") {
               var subtitle = "";
               if (itemData.SeriesName) subtitle += itemData.SeriesName;
               if (itemData.SeasonName) subtitle += " - " + itemData.SeasonName;
               if (itemData.IndexNumber)
                  subtitle += " - Episode " + itemData.IndexNumber;
               elements.mediaSubtitle.textContent = subtitle;
            }

            initializeTrickplay();

            loadMediaSegments();
            loadAdjacentEpisodes();

            if (USE_PLAYBACK_MANAGER && playbackManagerReady) {
               startPlaybackViaPlaybackManager();
            } else {
               getPlaybackInfo();
            }
         }
      );
   }

   /**
    * This replaces the manual getPlaybackInfo() → startPlayback() flow
    */
   function startPlaybackViaPlaybackManager() {
      console.log('[Player] Starting playback via PlaybackManager');

      if (!itemData) {
         console.error('[Player] No item data available');
         showErrorDialog('Playback Error', 'Item data not loaded');
         return;
      }

      // Get start position from URL or resume point
      var startPositionSeconds = getStartPositionFromUrl();
      var startPositionTicks = 0;

      if (startPositionSeconds !== null) {
         startPositionTicks = startPositionSeconds * 10000000; // Convert to ticks
         console.log('[Player] Starting at position:', startPositionSeconds, 'seconds');
      } else if (itemData.UserData && itemData.UserData.PlaybackPositionTicks) {
         startPositionTicks = itemData.UserData.PlaybackPositionTicks;
         console.log('[Player] Resuming from position:', startPositionTicks / 10000000, 'seconds');
      }

      // Build playback options for PlaybackManager
      var playOptions = {
         items: [itemData],
         startPositionTicks: startPositionTicks,
         fullscreen: true
      };

      // Add track preferences if available (from details page or previous selection)
      var preferredAudioIndex = localStorage.getItem('preferredAudioTrack_' + itemId);
      var preferredSubtitleIndex = localStorage.getItem('preferredSubtitleTrack_' + itemId);

      if (preferredAudioIndex !== null) {
         playOptions.audioStreamIndex = parseInt(preferredAudioIndex, 10);
         console.log('[Player] Preferred audio track:', preferredAudioIndex);
      }

      if (preferredSubtitleIndex !== null) {
         playOptions.subtitleStreamIndex = parseInt(preferredSubtitleIndex, 10);
         console.log('[Player] Preferred subtitle track:', preferredSubtitleIndex);
      }

      // Get max bitrate setting (in bps)
      var currentMaxBitrate = storage.get("maxBitrate", false) || "120000000";
      playOptions.maxBitrate = parseInt(currentMaxBitrate, 10);
      console.log('[Player] PlaybackManager play options:', playOptions);

      // Start playback via PlaybackManager
      PlaybackManagerAdapter.play(playOptions)
         .then(function () {
            console.log('[Player] PlaybackManager playback started successfully');
            hideLoading();

            // Generate session ID for our own tracking (PlaybackManager has its own)
            playSessionId = generateUUID();
         })
         .catch(function (error) {
            console.error('[Player] PlaybackManager play failed:', error);
            hideLoading();
            showErrorDialog(
               'Playback Failed',
               error.message || 'Failed to start playback via PlaybackManager',
               'Check console for details'
            );
         });
   }

   /**
    * Load audio tracks from PlaybackManager into our UI
    */
   function loadAudioTracksFromPlaybackManager() {
      if (!USE_PLAYBACK_MANAGER || !playbackManagerReady) {
         return;
      }

      try {
         var tracks = PlaybackManagerAdapter.audioTracks();
         console.log('[Player] Loaded audio tracks from PlaybackManager:', tracks);

         // Update UI with tracks (implementation depends on your track selector UI)
         // For now, just log the available tracks
         if (tracks && tracks.length > 0) {
            tracks.forEach(function (track, index) {
               console.log('[Player] Audio track ' + index + ':', {
                  index: track.index,
                  language: track.language,
                  codec: track.codec,
                  bitrate: track.bitrate,
                  channels: track.channels
               });
            });
         }
      } catch (error) {
         console.error('[Player] Failed to load audio tracks from PlaybackManager:', error);
      }
   }

   /**
    * Load subtitle tracks from PlaybackManager into our UI
    */
   function loadSubtitleTracksFromPlaybackManager() {
      if (!USE_PLAYBACK_MANAGER || !playbackManagerReady) {
         return;
      }

      try {
         var tracks = PlaybackManagerAdapter.subtitleTracks();
         console.log('[Player] Loaded subtitle tracks from PlaybackManager:', tracks);

         // Update UI with tracks
         if (tracks && tracks.length > 0) {
            tracks.forEach(function (track, index) {
               console.log('[Player] Subtitle track ' + index + ':', {
                  index: track.index,
                  language: track.language,
                  codec: track.codec,
                  deliveryMethod: track.deliveryMethod
               });
            });
         }
      } catch (error) {
         console.error('[Player] Failed to load subtitle tracks from PlaybackManager:', error);
      }
   }

   /**
    * LEGACY: Request playback info from server
    * NOTE: This function is only used when USE_PLAYBACK_MANAGER = false
    * When PlaybackManager is enabled, startPlaybackViaPlaybackManager() is used instead
    * 
    * This makes a manual PlaybackInfo API request and handles media source selection,
    * DirectPlay decision-making, and URL building. PlaybackManager handles all of this
    * automatically with full jellyfin-web parity.
    * 
    * @deprecated Use startPlaybackViaPlaybackManager() instead
    */
   function getPlaybackInfo() {
      var playbackUrl =
         auth.serverAddress + "/Items/" + itemId + "/PlaybackInfo";

      var isLiveTV = itemData && itemData.Type === "TvChannel";

      var deviceProfile = getDeviceProfile();

      // Check MKV support with ES5 loop for Tizen 4 compatibility
      var mkvSupported = false;
      var mkvProfile = null;
      if (deviceProfile && deviceProfile.DirectPlayProfiles) {
         for (var i = 0; i < deviceProfile.DirectPlayProfiles.length; i++) {
            var profile = deviceProfile.DirectPlayProfiles[i];
            if (profile.Container && profile.Container.indexOf('mkv') !== -1) {
               mkvSupported = true;
               if (!mkvProfile) {
                  mkvProfile = profile;
               }
            }
         }
      }

      var requestData = {
         UserId: auth.userId,
         // Must include DeviceProfile so server knows what we can play
         DeviceProfile: deviceProfile,
         AutoOpenLiveStream: isLiveTV,
      };

      if (typeof ServerLogger !== "undefined") {
         ServerLogger.logPlaybackInfo("Requesting playback info", {
            itemId: itemId,
            itemName: itemData ? itemData.Name : "Unknown",
            itemType: itemData ? itemData.Type : "Unknown",
            serverAddress: auth.serverAddress
         });
      }

      ajax.request(playbackUrl, {
         method: "POST",
         headers: {
            "X-Emby-Authorization": JellyfinAPI.getAuthHeader(auth.accessToken),
            "X-MediaBrowser-Token": auth.accessToken,
            "Content-Type": "application/json",
         },
         data: requestData,
         success: function (response) {
            playbackInfo = response;

            // Detect if this is Dolby Vision content and set flag for adapter selection
            isDolbyVisionMedia = false;
            if (
               playbackInfo.MediaSources &&
               playbackInfo.MediaSources.length > 0
            ) {
               var mediaSource = playbackInfo.MediaSources[0];
               var videoStream = mediaSource.MediaStreams
                  ? mediaSource.MediaStreams.find(function (s) {
                     return s.Type === "Video";
                  })
                  : null;
               var audioStream = mediaSource.MediaStreams
                  ? mediaSource.MediaStreams.find(function (s) {
                     return s.Type === "Audio";
                  })
                  : null;

               if (typeof ServerLogger !== "undefined") {
                  ServerLogger.logPlaybackInfo("Playback info received", {
                     itemId: itemId,
                     container: mediaSource.Container,
                     videoCodec: videoStream ? videoStream.Codec : "none",
                     audioCodec: audioStream ? audioStream.Codec : "none",
                     audioProfile: audioStream && audioStream.Profile ? audioStream.Profile : "none",
                     supportsDirectPlay: mediaSource.SupportsDirectPlay,
                     supportsDirectStream: mediaSource.SupportsDirectStream,
                     supportsTranscoding: mediaSource.SupportsTranscoding,
                     transcodingUrl: mediaSource.TranscodingUrl || "none",
                     directStreamUrl: mediaSource.DirectStreamUrl || "none"
                  });
               }

               // Additional debug logging for codec troubleshooting
               console.log("[Player] Server playback decision:", {
                  container: mediaSource.Container,
                  videoCodec: videoStream ? videoStream.Codec : "none",
                  audioCodec: audioStream ? audioStream.Codec : "none",
                  audioProfile: audioStream && audioStream.Profile ? audioStream.Profile : "none",
                  audioChannels: audioStream ? audioStream.Channels : "none",
                  supportsDirectPlay: mediaSource.SupportsDirectPlay,
                  supportsDirectStream: mediaSource.SupportsDirectStream,
                  supportsTranscoding: mediaSource.SupportsTranscoding
               });

               isDolbyVisionMedia =
                  videoStream &&
                  videoStream.Codec &&
                  (videoStream.Codec.toLowerCase().startsWith("dvhe") ||
                     videoStream.Codec.toLowerCase().startsWith("dvh1"));

               if (isDolbyVisionMedia) {
                  console.log(
                     "[Player] Dolby Vision media detected, will use Tizen native adapter if available"
                  );
               }
            }

            if (
               playbackInfo.MediaSources &&
               playbackInfo.MediaSources.length > 0
            ) {
               var mediaSourceToPlay = playbackInfo.MediaSources[0];

               // Tizen AVPlay supports EAC3 in MKV containers

               startPlayback(mediaSourceToPlay).catch(onError);
            } else {
               showErrorDialog(
                  "No Media Sources",
                  "No playable media sources were found for this item.",
                  "The server did not provide any compatible media streams."
               );
            }
         },
         error: function (err) {
            console.error("[Player] PlaybackInfo request failed:", err);

            var title = "Playback Error";
            var message = "Failed to get playback information from the server.";
            var details = "";

            if (err && err.error === 500) {
               title = "Server Error";
               message =
                  "The Jellyfin server encountered an error processing this item.";
               details =
                  "This may indicate:\n• Corrupted or incompatible media file\n• Missing codecs on the server\n• Server configuration issue\n\nError Code: 500\n\nCheck the Jellyfin server logs for more details.";
            } else if (err && (err.error === 401 || err.error === 403)) {
               title = "Authentication Error";
               message =
                  "Failed to authenticate with the server.";
               details =
                  "This may indicate:\n• Session expired\n• Reverse proxy not forwarding authentication headers\n• Server configuration issue\n\nError Code: " + err.error + "\n\nIf you're using a reverse proxy, ensure it forwards these headers:\n• X-Emby-Authorization\n• X-MediaBrowser-Token";
            } else if (err && err.error === 0) {
               title = "Network Error";
               message =
                  "Unable to reach the server.";
               details =
                  "This may indicate:\n• Server is unreachable\n• CORS misconfiguration on reverse proxy\n• Network connectivity issue\n\nCheck your server URL and network connection.";
            } else if (err && err.error) {
               details = "Error Code: " + err.error;
               if (err.responseData && err.responseData.Message) {
                  details += "\nMessage: " + err.responseData.Message;
               }
            }

            if (typeof ServerLogger !== "undefined") {
               ServerLogger.logPlaybackError("Failed to get playback info", {
                  itemId: itemId,
                  errorCode: err ? err.error : "unknown",
                  errorMessage:
                     err && err.responseData
                        ? err.responseData.Message
                        : message,
                  title: title,
               });
            }

            showErrorDialog(title, message, details);
         },
      });
   }

   /**
    * Get device profile for PlaybackInfo API request
    * Uses NativeShell.AppHost.getDeviceProfile() which handles both
    * jellyfin-web integration and custom player scenarios
    */
   function getDeviceProfile() {
      if (typeof NativeShell !== 'undefined' && NativeShell.AppHost && NativeShell.AppHost.getDeviceProfile) {
         return NativeShell.AppHost.getDeviceProfile();
      }
      return null;
   }

   /**
    * LEGACY: Start playback with a media source
    * NOTE: This function is only used when USE_PLAYBACK_MANAGER = false
    * When PlaybackManager is enabled, this is bypassed entirely.
    * 
    * This function handles DirectPlay, DirectStream, and Transcode logic manually.
    * PlaybackManager does all of this internally with full jellyfin-web parity.
    * 
    * @deprecated Use startPlaybackViaPlaybackManager() instead
    * @param {Object} mediaSource - Media source from PlaybackInfo response
    */
   async function startPlayback(mediaSource) {
      playSessionId = generateUUID();
      currentMediaSource = mediaSource;
      isDolbyVisionMedia = false; // Reset flag for new playback session

      // Reinitialize trickplay with the actual media source being played
      initializeTrickplayForMediaSource(mediaSource.Id);

      // Populate audio/subtitle streams early so preferences can be applied
      audioStreams = mediaSource.MediaStreams
         ? mediaSource.MediaStreams.filter(function (s) {
            return s.Type === "Audio";
         })
         : [];
      subtitleStreams = mediaSource.MediaStreams
         ? mediaSource.MediaStreams.filter(function (s) {
            return s.Type === "Subtitle";
         })
         : [];

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

      var isLiveTV = itemData && itemData.Type === "TvChannel";
      var streamUrl;
      var mimeType;
      var useDirectPlay = false;
      // URLSearchParams in Chrome 53 (webOS 4) / older Tizen doesn't support object constructor
      // Must append parameters one by one
      var params = new URLSearchParams();
      params.append('mediaSourceId', mediaSource.Id);
      params.append('deviceId', JellyfinAPI.init());
      params.append('api_key', auth.accessToken);
      params.append('PlaySessionId', playSessionId);

      var videoStream = mediaSource.MediaStreams
         ? mediaSource.MediaStreams.find(function (s) {
            return s.Type === "Video";
         })
         : null;
      var audioStream = mediaSource.MediaStreams
         ? mediaSource.MediaStreams.find(function (s) {
            return s.Type === "Audio";
         })
         : null;

      var isDolbyVision =
         videoStream &&
         videoStream.Codec &&
         (videoStream.Codec.toLowerCase().startsWith("dvhe") ||
            videoStream.Codec.toLowerCase().startsWith("dvh1"));
      var isHEVC = videoStream &&
         videoStream.Codec &&
         (videoStream.Codec.toLowerCase() === "hevc" ||
            videoStream.Codec.toLowerCase().startsWith("hev1") ||
            videoStream.Codec.toLowerCase().startsWith("hvc1"));
      // Detect 10-bit HEVC by BitDepth OR by Main 10 profile (some sources don't report BitDepth)
      var isHEVC10bit = isHEVC && (
         videoStream.BitDepth === 10 ||
         (videoStream.Profile && videoStream.Profile.toLowerCase().indexOf("main 10") !== -1)
      );
      var isHDR = videoStream &&
         (videoStream.VideoRangeType === "HDR10" ||
            videoStream.VideoRangeType === "HDR10Plus" ||
            videoStream.VideoRangeType === "HLG" ||
            videoStream.VideoRangeType === "DOVIWithHDR10");

      // Log video stream details for debugging playback issues
      console.log("[Player] Video stream analysis:", {
         codec: videoStream ? videoStream.Codec : "none",
         profile: videoStream ? videoStream.Profile : "none",
         bitDepth: videoStream ? videoStream.BitDepth : "none",
         videoRangeType: videoStream ? videoStream.VideoRangeType : "none",
         isHEVC: isHEVC,
         isHEVC10bit: isHEVC10bit,
         isDolbyVision: isDolbyVision,
         isHDR: isHDR
      });

      // Trust the server's decision based on our device profile
      // The server already evaluated our capabilities via the device profile we sent
      // This matches jellyfin-web behavior which trusts SupportsDirectPlay
      var canDirectPlay = mediaSource.SupportsDirectPlay;
      var canDirectStream = mediaSource.SupportsDirectStream;
      var canTranscode = mediaSource.SupportsTranscoding;

      console.log("[Player] Server playback capabilities:", {
         container: mediaSource.Container,
         videoCodec: videoStream ? videoStream.Codec : "none",
         audioCodec: audioStream ? audioStream.Codec : "none",
         supportsDirectPlay: mediaSource.SupportsDirectPlay,
         supportsDirectStream: mediaSource.SupportsDirectStream,
         supportsTranscoding: mediaSource.SupportsTranscoding
      });

      // Determine playback method based on server response and user preference
      // Priority: DirectPlay > DirectStream > Transcode (unless user forces specific mode)
      var shouldUseDirectPlay = false;
      var shouldUseDirectStream = false;

      if (forcePlayMode === "direct") {
         // User explicitly wants direct play - try it if server says we can
         shouldUseDirectPlay = canDirectPlay;
         if (!shouldUseDirectPlay && canDirectStream) {
            shouldUseDirectStream = true;
            console.log("[Player] Direct play not available, falling back to direct stream");
         }
         console.log("[Player] Force direct play mode selected");
      } else if (forcePlayMode === "directstream") {
         // User explicitly wants direct stream (remux only)
         shouldUseDirectPlay = false;
         shouldUseDirectStream = canDirectStream;
         console.log("[Player] Force direct stream mode selected");
      } else if (forcePlayMode === "transcode") {
         shouldUseDirectPlay = false;
         shouldUseDirectStream = false;
         console.log("[Player] Force transcode mode selected");
      } else {
         // Default: prefer DirectPlay, then DirectStream, then Transcode
         // This matches jellyfin-web behavior which trusts server capabilities
         if (canDirectPlay) {
            shouldUseDirectPlay = true;
            console.log("[Player] Server approved direct play - using it");
         } else if (canDirectStream) {
            shouldUseDirectStream = true;
            console.log("[Player] Server approved direct stream - using it (remux without transcode)");
         } else {
            console.log("[Player] Neither direct play nor direct stream available - will transcode");
         }
      }

      var playbackMethod = shouldUseDirectPlay ? "DirectPlay" : (shouldUseDirectStream ? "DirectStream" : (canTranscode ? "Transcode" : "None"));
      console.log("[Player] Playback decision:", {
         method: playbackMethod,
         videoCodec: videoStream ? videoStream.Codec : "none",
         audioCodec: audioStream ? audioStream.Codec : "none",
         container: mediaSource.Container
      });

      // Build playback URL based on selected method
      // Order matters: check user's choice first, not server's TranscodingUrl
      if (shouldUseDirectPlay) {
         // DirectPlay: Stream the file as-is, no server-side processing
         streamUrl = auth.serverAddress + "/Videos/" + itemId + "/stream";
         params.append("Static", "true");
         var container = mediaSource.Container || "mp4";
         // Use proper MIME types
         if (container.toLowerCase() === 'mkv') {
            mimeType = "video/x-matroska";
         } else if (container.toLowerCase() === 'webm') {
            mimeType = "video/webm";
         } else if (container.toLowerCase() === 'ogg' || container.toLowerCase() === 'ogv') {
            mimeType = "video/ogg";
         } else {
            mimeType = "video/" + container;
         }
         useDirectPlay = true;
         isTranscoding = false;
         console.log("[Player] Using DirectPlay for " + container + " container with MIME type: " + mimeType);
      } else if (shouldUseDirectStream) {
         // DirectStream: Server remuxes (changes container) but doesn't transcode video/audio
         // This is useful when the container is incompatible but codecs are fine
         streamUrl = auth.serverAddress + "/Videos/" + itemId + "/stream";
         params.append("Static", "false"); // Allow remuxing
         // Use a compatible container for streaming
         var targetContainer = mediaSource.Container || "mp4";
         if (targetContainer === "mkv") {
            // Remux MKV to MP4 for better browser compatibility
            targetContainer = "mp4";
         }
         mimeType = "video/" + targetContainer;
         useDirectPlay = true; // Treat as direct play for UI purposes
         isTranscoding = false; // Not transcoding, just remuxing
         console.log("[Player] Using DirectStream (remux to " + targetContainer + ")");
      } else if (canTranscode) {
         // Transcoding: Full video/audio conversion to compatible format
         // Use server-provided TranscodingUrl if available, otherwise build our own
         if (mediaSource.TranscodingUrl) {
            streamUrl = auth.serverAddress + mediaSource.TranscodingUrl;

            params = new URLSearchParams();
            var urlParts = streamUrl.split("?");
            if (urlParts.length > 1) {
               streamUrl = urlParts[0];
               params = new URLSearchParams(urlParts[1]);
            }

            if (!params.has("api_key")) {
               params.append("api_key", auth.accessToken);
            }
            if (!params.has("PlaySessionId")) {
               params.append("PlaySessionId", playSessionId);
            }
            if (!params.has("deviceId")) {
               params.append("deviceId", JellyfinAPI.init());
            }
         } else {
            streamUrl = auth.serverAddress + "/Videos/" + itemId + "/master.m3u8";
            params.append("VideoCodec", "h264");
            params.append("AudioCodec", "aac");
            params.append("VideoBitrate", "20000000"); // Increased for better quality
            params.append("AudioBitrate", "256000");
            params.append("MaxWidth", "3840"); // Support 4K transcoding
            params.append("MaxHeight", "2160");
            params.append("SegmentLength", "6");
            params.append("MinSegments", "3");
            params.append("BreakOnNonKeyFrames", "false");

            // Check for user-selected track preferences from details page (not for Live TV)
            if (!isLiveTV) {
               var preferredAudioIndex = localStorage.getItem(
                  "preferredAudioTrack_" + itemId
               );
               var preferredSubtitleIndex = localStorage.getItem(
                  "preferredSubtitleTrack_" + itemId
               );

               if (
                  preferredAudioIndex !== null &&
                  audioStreams[preferredAudioIndex]
               ) {
                  params.append(
                     "AudioStreamIndex",
                     audioStreams[preferredAudioIndex].Index
                  );
               }

               if (
                  preferredSubtitleIndex !== null &&
                  preferredSubtitleIndex >= 0 &&
                  subtitleStreams[preferredSubtitleIndex]
               ) {
                  params.append(
                     "SubtitleStreamIndex",
                     subtitleStreams[preferredSubtitleIndex].Index
                  );
                  params.append("SubtitleMethod", "Encode");
               }
            }
         }

         mimeType = "application/x-mpegURL";
         isTranscoding = true;
         console.log("[Player] Using HLS Transcoding");
      } else {
         console.log("Unsupported media source:", {
            container: mediaSource.Container,
            supportsDirectPlay: mediaSource.SupportsDirectPlay,
            supportsDirectStream: mediaSource.SupportsDirectStream,
            supportsTranscoding: mediaSource.SupportsTranscoding,
         });
         setLoadingState(LoadingState.ERROR);
         alert("This video format is not supported");
         window.history.back();
         return;
      }

      // Prepare the correct adapter based on playback method
      var creationOptions = {};

      // Containers supported by HTML5 video element on Tizen
      // Tizen's HTML5 <video> element supports MKV natively
      var html5SupportedContainers = ['mp4', 'm4v', 'webm', 'ogg', 'ogv', 'mov', 'mkv'];
      var containerLower = mediaSource.Container ? mediaSource.Container.toLowerCase() : '';
      var isHtml5Compatible = html5SupportedContainers.indexOf(containerLower) !== -1;

      // Check if content requires hardware decoder (HEVC 10-bit needs AVPlay, HTML5 can't decode it)
      var requiresHardwareDecoder = isHEVC10bit || isDolbyVision;

      if (requiresHardwareDecoder) {
         // HEVC 10-bit and Dolby Vision require Tizen AVPlay hardware decoder
         // HTML5 video element cannot decode these formats
         console.log("[Player] Content requires hardware decoder (HEVC 10-bit or DV), using Tizen AVPlay");
         creationOptions.preferTizen = true;
      } else if (useDirectPlay && isHtml5Compatible) {
         // Only use HTML5 for containers it supports (mp4, webm, etc.) with 8-bit video
         creationOptions.preferHTML5 = true;
      } else if (useDirectPlay && !isHtml5Compatible) {
         // For non-HTML5 containers, use Tizen AVPlay (native support)
         console.log("[Player] Container " + containerLower + " not HTML5 compatible, using Tizen AVPlay");
         creationOptions.preferTizen = true;
      } else if (isTranscoding) {
         // Try HTML5 with native HLS support first for better compatibility
         creationOptions.preferHTML5 = true;
         console.log("[Player] Using HTML5 native HLS for transcoded stream");
      }
      await ensurePlayerAdapter(creationOptions);

      var videoUrl = streamUrl + "?" + params.toString();

      console.log("[Player] Starting playback");
      console.log(
         "[Player] Method:",
         isLiveTV ? "Live TV" : useDirectPlay ? "Direct Play" : "Transcode"
      );
      console.log("[Player] Container:", mediaSource.Container);
      console.log(
         "[Player] Video Codec:",
         videoStream ? videoStream.Codec : "none"
      );
      console.log("[Player] URL:", videoUrl.substring(0, 100) + "...");

      var startPosition = 0;
      var urlPosition = getStartPositionFromUrl();
      if (urlPosition !== null) {
         // Position specified in URL takes precedence
         startPosition = urlPosition;
      } else if (
         !isLiveTV &&
         itemData.UserData &&
         itemData.UserData.PlaybackPositionTicks > 0
      ) {
         // Otherwise use saved position if available
         startPosition =
            itemData.UserData.PlaybackPositionTicks / TICKS_PER_SECOND;
      }

      // Setup timeout (smart for direct play, standard for streams)
      if (useDirectPlay) {
         setupDirectPlayTimeout(mediaSource);
      } else {
         var timeoutDuration = TRANSCODE_TIMEOUT_MS;
         loadingTimeout = setTimeout(function () {
            if (loadingState === LoadingState.LOADING) {
               setLoadingState(LoadingState.ERROR);
               alert(
                  "Video loading timed out. The server may be transcoding or the format is not supported."
               );
               window.history.back();
            }
         }, timeoutDuration);
      }

      setLoadingState(LoadingState.LOADING);

      playerAdapter
         .load(videoUrl, {
            mimeType: mimeType,
            startPosition: startPosition,
            container: mediaSource.Container,
            videoCodec: videoStream ? videoStream.Codec : null,
            audioCodec: audioStream ? audioStream.Codec : null,
            width: videoStream ? videoStream.Width : null,
            height: videoStream ? videoStream.Height : null,
            bitrate: mediaSource.Bitrate || null,
            isDirectPlay: useDirectPlay,
            isHEVC: isHEVC,
            isHEVC10bit: isHEVC10bit,
            isDolbyVision: isDolbyVision,
            mediaSource: mediaSource
         })
         .then(function () {
            clearLoadingTimeout();
            console.log(
               "[Player] Playback loaded successfully (" +
               (useDirectPlay ? "direct" : "stream") +
               ")"
            );

            // Try to start playback immediately (don't wait for canplay)
            // This helps detect codec issues faster
            // Use playerAdapter.play() to support both HTML5 and Tizen AVPlay
            console.log("[Player] Calling play() on adapter");
            playerAdapter.play().catch(function (err) {
               console.log("[Player] play() failed (may be normal):", err.message);
            });

            // Start health check for both direct play AND transcoding
            // This ensures playback actually starts regardless of method
            startPlaybackHealthCheck(mediaSource, useDirectPlay);
         })
         .catch(function (error) {
            handlePlaybackLoadError(error, mediaSource, useDirectPlay);
         });
   }

   /**
    * Fall back to HLS transcoding when native adapter fails
    * This is useful for simulators or when AVPlay can't decode the content
    */
   function fallbackToTranscoding() {
      console.log("[Player] Falling back to HLS transcoding...");

      if (!currentMediaSource) {
         console.error("[Player] No media source available for fallback");
         return;
      }

      // Stop current playback
      if (playerAdapter) {
         try {
            playerAdapter.stop();
         } catch (e) {
            console.warn("[Player] Error stopping adapter:", e);
         }
      }

      // Force transcode mode and reload
      forcePlayMode = "transcode";

      // Re-request playback info which will now use transcoding
      console.log("[Player] Reloading with transcode mode...");
      getPlaybackInfo();
   }

   /**
    * Monitor playback health and fallback to HLS if issues detected
    * Checks for: stuck playback, no video/audio tracks, stalled buffering
    * @param {Object} mediaSource - Current media source
    * @param {boolean} isDirectPlay - Whether this is direct play (true) or transcoding (false)
    */
   function startPlaybackHealthCheck(mediaSource, isDirectPlay) {
      console.log("[Player] Starting playback health check (isDirectPlay=" + isDirectPlay + ")");

      // Clear any existing check
      if (playbackHealthCheckTimer) {
         clearTimeout(playbackHealthCheckTimer);
      }

      var checkCount = 0;
      var lastTime = 0;
      var playbackEverStarted = false;

      // Helper to get current time from adapter or video element
      function getCurrentTime() {
         if (playerAdapter && typeof playerAdapter.getCurrentTime === 'function') {
            return playerAdapter.getCurrentTime();
         }
         return videoPlayer.currentTime;
      }

      // Helper to check if playback is paused
      function isPaused() {
         if (USE_PLAYBACK_MANAGER && playbackManagerReady) {
            return PlaybackManagerAdapter.paused();
         }

         // Legacy: Use adapter if available
         if (playerAdapter && typeof playerAdapter.isPaused === 'function') {
            return playerAdapter.isPaused();
         }
         return videoPlayer.paused;
      }

      // Helper to check if adapter is a Tizen adapter (doesn't use HTML5 video element)
      function isNativeAdapter() {
         return playerAdapter && playerAdapter.getName &&
            (playerAdapter.getName() === 'TizenAVPlay' || playerAdapter.getName() === 'Shaka');
      }

      function checkHealth() {
         // Stop checking after 5 attempts for direct play, or 8 attempts for transcoding (needs more time)
         var maxChecks = isDirectPlay ? 5 : 8;
         if (checkCount >= maxChecks || (isTranscoding && !isDirectPlay)) {
            // If we were checking transcoding and it's still working, stop checking
            if (!isDirectPlay && playbackEverStarted) {
               console.log("[Player] Transcode playback is progressing, stopping health checks");
               playbackHealthCheckTimer = null;
               return;
            }

            playbackHealthCheckTimer = null;

            // Final check: if playback never started after all attempts
            var currentTime = getCurrentTime();
            if (!playbackEverStarted && currentTime === 0) {
               console.log("[Player] Playback never started after " + checkCount + " health checks");
               console.error("[Player] Video element state:", {
                  paused: isPaused(),
                  currentTime: currentTime,
                  readyState: videoPlayer.readyState,
                  networkState: videoPlayer.networkState,
                  error: videoPlayer.error ? videoPlayer.error.message : "none",
                  adapter: playerAdapter ? playerAdapter.getName() : "none"
               });

               // Try one more play() call as last resort (only for HTML5)
               if (!isNativeAdapter() && isPaused()) {
                  console.log("[Player] Attempting final play() call...");
                  if (playerAdapter && typeof playerAdapter.play === 'function') {
                     playerAdapter.play().catch(function (err) {
                        console.error("[Player] Final play() attempt failed:", err);
                     });
                  } else {
                     videoPlayer.play().catch(function (err) {
                        console.error("[Player] Final play() attempt failed:", err);
                     });
                  }
               }
            }
            return;
         }

         checkCount++;
         var currentTime = getCurrentTime();

         // Track if playback ever progressed
         if (currentTime > 0) {
            playbackEverStarted = true;
         }

         // For native adapters (Tizen AVPlay, Shaka), use simpler checks
         if (isNativeAdapter()) {
            var paused = isPaused();
            var isStuck = !paused && currentTime === lastTime && checkCount > 1;

            console.log("[Player] Health check #" + checkCount + " (native adapter):", {
               currentTime: currentTime,
               paused: paused,
               adapter: playerAdapter.getName(),
               stuck: isStuck
            });

            // For native adapters, only fail if stuck for multiple checks
            if (isStuck && checkCount >= 3) {
               console.log("[Player] Native adapter playback appears stuck");
               console.log("[Player] This may be a simulator without real AVPlay - falling back to HLS transcoding");
               playbackHealthCheckTimer = null;

               // Fall back to HLS transcoding which works in simulators/browsers
               fallbackToTranscoding();
               return;
            }

            // Initialize progress reporting on first successful health check
            if (checkCount === 1 && currentTime >= 0 && !progressInterval) {
               console.log("[Player] First health check passed - initializing progress reporting");
               console.log("[Player] Starting progress reporting for session:", playSessionId);
               reportPlaybackStart();
               startProgressReporting();

               // Send immediate progress report to establish position
               setTimeout(function () {
                  console.log("[Player] Sending immediate progress report");
                  reportPlaybackProgress();
               }, 1000);

               detectCurrentAudioTrack();
               initializeAudioNormalization();
            }

            // Playback is fine, schedule next check
            lastTime = currentTime;
            playbackHealthCheckTimer = setTimeout(checkHealth, 2000);
            return;
         }

         // HTML5 video element checks (original logic)
         // Check 1: Is playback stuck? (time not advancing when it should)
         var isStuck = !videoPlayer.paused && currentTime === lastTime;

         // Check 1b: Specifically detect stuck at 0:00 - common for unsupported codecs
         // This can happen when video is paused OR playing but codec failed to initialize
         var stuckAtStart = currentTime === 0 &&
            videoPlayer.readyState < HTMLMediaElement.HAVE_FUTURE_DATA && checkCount >= 2;

         // Check 1c: Video still paused after several checks - canplay never fired
         // For transcoding, be more lenient (check >= 4) as HLS needs time to buffer
         var pausedThreshold = isDirectPlay ? 3 : 4;
         var stuckPaused = videoPlayer.paused && currentTime === 0 &&
            videoPlayer.readyState < HTMLMediaElement.HAVE_METADATA && checkCount >= pausedThreshold;

         // Check 2: Video element in bad state?
         // For transcoding, also be more lenient with ready state checks
         var readyStateThreshold = isDirectPlay ? 3 : 4;
         var isBadState =
            videoPlayer.error ||
            videoPlayer.networkState === HTMLMediaElement.NETWORK_NO_SOURCE ||
            (videoPlayer.readyState < HTMLMediaElement.HAVE_CURRENT_DATA &&
               checkCount >= readyStateThreshold);

         // Check 3: No video or audio tracks? (for containers with track support)
         var noTracks = false;
         if (videoPlayer.videoTracks && videoPlayer.audioTracks) {
            noTracks =
               videoPlayer.videoTracks.length === 0 ||
               videoPlayer.audioTracks.length === 0;
         }

         // Log current state for debugging
         console.log("[Player] Health check #" + checkCount + ":", {
            currentTime: currentTime,
            paused: videoPlayer.paused,
            readyState: videoPlayer.readyState,
            networkState: videoPlayer.networkState,
            hasError: !!videoPlayer.error
         });

         if (isStuck || isBadState || noTracks || stuckAtStart || stuckPaused) {
            console.log("[Player] Playback health issue detected:", {
               stuck: isStuck,
               stuckAtStart: stuckAtStart,
               stuckPaused: stuckPaused,
               badState: isBadState,
               noTracks: noTracks,
               readyState: videoPlayer.readyState,
               networkState: videoPlayer.networkState,
            });

            // Log to server for diagnostics
            if (typeof ServerLogger !== "undefined") {
               var logMessage = isDirectPlay ? "Direct play health check failed" : "Transcode playback health check failed";
               ServerLogger.logPlaybackWarning(logMessage, {
                  checkCount: checkCount,
                  isDirectPlay: isDirectPlay,
                  stuck: isStuck,
                  stuckAtStart: stuckAtStart,
                  stuckPaused: stuckPaused,
                  badState: isBadState,
                  noTracks: noTracks,
                  readyState: videoPlayer.readyState,
                  networkState: videoPlayer.networkState,
                  currentTime: currentTime,
                  paused: videoPlayer.paused,
                  videoCodec: currentMediaSource ? currentMediaSource.VideoCodecs : "unknown",
                  container: currentMediaSource ? currentMediaSource.Container : "unknown"
               });
            }

            playbackHealthCheckTimer = null;

            // Log the issue but DON'T automatically switch to transcoding
            // This matches jellyfin-web behavior - let the user decide via play mode button
            console.error("[Player] Playback issue detected - video may not be playing");

            // Try one more play() call as last resort
            if (isPaused()) {
               console.log("[Player] Attempting to restart playback...");
               if (playerAdapter && typeof playerAdapter.play === 'function') {
                  playerAdapter.play().catch(function (err) {
                     console.error("[Player] Failed to restart playback:", err);
                  });
               } else {
                  videoPlayer.play().catch(function (err) {
                     console.error("[Player] Failed to restart playback:", err);
                  });
               }
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
      console.error("[Player] Playback load failed:", error.message || error);

      // If Tizen AVPlay failed on direct play, try HTML5 fallback
      if (isDirectPlay && playerAdapter && playerAdapter.getName && playerAdapter.getName() === 'TizenAVPlay') {
         console.log("[Player] Tizen AVPlay failed, trying HTML5 fallback...");

         fallbackToHTML5(mediaSource);
         return;
      }

      // If HTML5 failed on direct play, try transcoding
      if (isDirectPlay && playerAdapter && playerAdapter.getName && playerAdapter.getName() === 'HTML5') {
         console.log("[Player] HTML5 direct play failed, trying transcode...");

         fallbackToTranscoding();
         return;
      }

      // Complete failure - show error to user
      setLoadingState(LoadingState.ERROR);
      showErrorDialog(
         "Playback Failed",
         "Failed to start playback: " + (error.message || error),
         "Try switching play mode in settings or selecting a different quality."
      );
   }

   /**
    * Fall back to HTML5 adapter when Tizen AVPlay fails
    */
   function fallbackToHTML5(mediaSource) {
      console.log("[Player] Falling back to HTML5 adapter...");

      if (!mediaSource) {
         console.error("[Player] No media source for HTML5 fallback");
         return;
      }

      // Stop current adapter
      if (playerAdapter) {
         try {
            playerAdapter.stop();
         } catch (e) {
            console.warn("[Player] Error stopping Tizen adapter:", e);
         }
      }

      // Retry with HTML5
      ensurePlayerAdapter({ preferHTML5: true }).then(function () {
         console.log("[Player] Retrying playback with HTML5 adapter");
         startPlayback(mediaSource).catch(function (err) {
            console.error("[Player] HTML5 fallback also failed:", err);
            // HTML5 failed too, try transcoding as last resort
            fallbackToTranscoding();
         });
      }).catch(function (err) {
         console.error("[Player] Failed to create HTML5 adapter:", err);
         fallbackToTranscoding();
      });
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
      var onProgress = function () {
         hasProgressedSinceStart = true;
         console.log("[Player] Buffering progress detected for direct play");
      };

      var onLoadedMetadata = function () {
         hasProgressedSinceStart = true;
         console.log("[Player] Media metadata loaded for direct play");
      };

      var onCanPlay = function () {
         hasProgressedSinceStart = true;
         console.log("[Player] Video ready to play - direct play is working");
      };

      // Attach listeners
      videoPlayer.addEventListener("progress", onProgress);
      videoPlayer.addEventListener("loadedmetadata", onLoadedMetadata);
      videoPlayer.addEventListener("canplay", onCanPlay);

      loadingTimeout = setTimeout(function () {
         // Clean up listeners immediately to prevent leaks
         videoPlayer.removeEventListener("progress", onProgress);
         videoPlayer.removeEventListener("loadedmetadata", onLoadedMetadata);
         videoPlayer.removeEventListener("canplay", onCanPlay);

         // Exit if playback already loaded or errored
         if (loadingState !== LoadingState.LOADING) {
            return;
         }

         // Decision logic based on buffering progress
         if (!hasProgressedSinceStart) {
            // No activity in timeout period - network issue
            var elapsedSeconds = (
               (Date.now() - directPlayStartTime) /
               1000
            ).toFixed(1);
            console.log(
               "[Player] Direct play timeout after " +
               elapsedSeconds +
               "s (no buffering progress)"
            );
            setLoadingState(LoadingState.ERROR);
            alert("Direct playback timed out. Try using the Play Mode option to switch playback methods.");
         } else {
            // Buffering started but canplay didn't fire - give it more time
            console.log(
               "[Player] Direct play buffering but not ready. Extending timeout..."
            );
            var extendedTimeout = setTimeout(function () {
               if (loadingState === LoadingState.LOADING) {
                  console.log(
                     "[Player] Extended timeout reached"
                  );
                  setLoadingState(LoadingState.ERROR);
                  alert("Direct playback too slow. Try using the Play Mode option to switch playback methods.");
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
      return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
         /[xy]/g,
         function (c) {
            var r = (Math.random() * 16) | 0,
               v = c === "x" ? r : (r & 0x3) | 0x8;
            return v.toString(16);
         }
      );
   }

   /**
    * Format seconds into human-readable time string
    * @param {number} seconds - Time in seconds
    * @returns {string} Formatted time (e.g., "1:23:45" or "12:34")
    */
   function formatTime(seconds) {
      if (isNaN(seconds)) return "0:00";

      var hours = Math.floor(seconds / 3600);
      var minutes = Math.floor((seconds % 3600) / 60);
      var secs = Math.floor(seconds % 60);

      if (hours > 0) {
         return hours + ":" + padZero(minutes) + ":" + padZero(secs);
      }
      return minutes + ":" + padZero(secs);
   }

   /**
    * Pad number with leading zero
    * @param {number} num - Number to pad
    * @returns {string} Padded number
    */
   function padZero(num) {
      return num < 10 ? "0" + num : num;
   }

   /**
    * Uses PlaybackManager if enabled, otherwise falls back to video element
    * @returns {number} Current time in seconds
    */
   function getCurrentTime() {
      if (USE_PLAYBACK_MANAGER && playbackManagerReady) {
         return PlaybackManagerAdapter.currentTime();
      }

      // Legacy: Use video element
      if (playerAdapter && typeof playerAdapter.getCurrentTime === 'function') {
         return playerAdapter.getCurrentTime();
      }
      return videoPlayer ? videoPlayer.currentTime : 0;
   }

   /**
    * Uses PlaybackManager if enabled, otherwise falls back to video element
    * @returns {number} Duration in seconds
    */
   function getDuration() {
      if (USE_PLAYBACK_MANAGER && playbackManagerReady) {
         return PlaybackManagerAdapter.duration();
      }

      // Legacy: Use video element
      if (playerAdapter && typeof playerAdapter.getDuration === 'function') {
         return playerAdapter.getDuration();
      }
      return videoPlayer ? videoPlayer.duration : 0;
   }

   /**
    * Build playback data object for Jellyfin API
    * @returns {Object} Playback data
    */
   function buildPlaybackData() {
      var currentTimeTicks = Math.floor(getCurrentTime() * 10000000);

      // Determine paused state - prioritize adapter over HTML5 video element
      var isPausedState;
      if (USE_PLAYBACK_MANAGER && playbackManagerReady) {
         isPausedState = PlaybackManagerAdapter.paused();
      } else if (playerAdapter && typeof playerAdapter.isPaused === 'function') {
         isPausedState = playerAdapter.isPaused();
      } else {
         isPausedState = videoPlayer ? videoPlayer.paused : true;
      }

      var playMethod = "DirectPlay";
      if (isTranscoding) {
         playMethod = "Transcode";
      } else if (currentMediaSource && !currentMediaSource.SupportsDirectPlay && currentMediaSource.SupportsDirectStream) {
         playMethod = "DirectStream";
      }

      var data = {
         ItemId: itemId,
         PlaySessionId: playSessionId,
         PositionTicks: currentTimeTicks,
         IsPaused: isPausedState,
         IsMuted: videoPlayer ? videoPlayer.muted : false,
         VolumeLevel: videoPlayer ? Math.floor(videoPlayer.volume * 100) : 100,
         CanSeek: true,
         PlayMethod: playMethod
      };

      // Add MediaSourceId - required for Jellyfin to save position correctly
      if (currentMediaSource && currentMediaSource.Id) {
         data.MediaSourceId = currentMediaSource.Id;
      }

      return data;
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
         method: "POST",
         headers: {
            "X-Emby-Authorization": JellyfinAPI.getAuthHeader(auth.accessToken),
            "Content-Type": "application/json",
         },
         data: data,
         success: onSuccess,
         error: onError,
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
         auth.serverAddress + "/Sessions/Playing",
         buildPlaybackData(),
         function () { },
         function (err) { }
      );
   }

   /**
    * Report playback progress to Jellyfin server
    */
   function reportPlaybackProgress() {
      console.log("[Player] reportPlaybackProgress() called - playSessionId:", playSessionId, "itemId:", itemId);
      if (!playSessionId) {
         console.warn("[Player] Skipping progress report - no playSessionId");
         return;
      }

      var playbackData = buildPlaybackData();
      console.log("[Player] Reporting progress:", {
         serverAddress: auth.serverAddress,
         positionTicks: playbackData.PositionTicks,
         positionSeconds: playbackData.PositionTicks / 10000000,
         isPaused: playbackData.IsPaused,
         mediaSourceId: playbackData.MediaSourceId,
         playMethod: playbackData.PlayMethod
      });

      makePlaybackRequest(
         auth.serverAddress + "/Sessions/Playing/Progress",
         playbackData,
         function () {
            console.log("[Player] Progress reported successfully");
         },
         function (err) {
            console.error("[Player] Failed to report progress:", err);
         }
      );
   }

   /**
    * Report playback stop to Jellyfin server
    */
   function reportPlaybackStop() {
      if (!playSessionId) return;

      console.log("[Player] Reporting stop to:", auth.serverAddress);
      makePlaybackRequest(
         auth.serverAddress + "/Sessions/Playing/Stopped",
         buildPlaybackData(),
         function () {
            console.log("[Player] Stop reported successfully");
         },
         function (err) {
            console.error("[Player] Failed to report stop:", err);
         }
      );
   }

   /**
    * Start periodic progress reporting to server
    */
   function startProgressReporting() {
      console.log("[Player] startProgressReporting() called - current interval:", progressInterval);
      if (progressInterval) clearInterval(progressInterval);

      progressInterval = setInterval(function () {
         reportPlaybackProgress();
      }, PROGRESS_REPORT_INTERVAL_MS);

      console.log("[Player] Progress reporting started - interval set to", PROGRESS_REPORT_INTERVAL_MS, "ms");
   }

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
   function togglePlayPause() {
      if (USE_PLAYBACK_MANAGER && playbackManagerReady) {
         PlaybackManagerAdapter.playPause();
         return;
      }

      // Legacy: Use adapter's isPaused if available, otherwise fallback to video element
      var isPaused = playerAdapter && typeof playerAdapter.isPaused === 'function'
         ? playerAdapter.isPaused()
         : videoPlayer.paused;

      if (isPaused) {
         play();
      } else {
         pause();
      }
   }

   /**
    * Play video and update UI
    */
   function play() {
      if (USE_PLAYBACK_MANAGER && playbackManagerReady) {
         PlaybackManagerAdapter.unpause();
         return;
      }

      // Legacy: Use adapter if available
      if (playerAdapter && typeof playerAdapter.play === 'function') {
         playerAdapter.play();
      } else {
         videoPlayer.play();
      }
      if (elements.playPauseBtn) {
         const icon = elements.playPauseBtn.querySelector(".btn-icon");
         if (icon) icon.src = "assets/pause.png";
      }
      showControls();
   }

   /**
    * Pause video and update UI
    */
   function pause() {
      if (USE_PLAYBACK_MANAGER && playbackManagerReady) {
         PlaybackManagerAdapter.pause();
         return;
      }

      // Legacy: Use adapter if available
      if (playerAdapter && typeof playerAdapter.pause === 'function') {
         playerAdapter.pause();
      } else {
         videoPlayer.pause();
      }
      if (elements.playPauseBtn) {
         const icon = elements.playPauseBtn.querySelector(".btn-icon");
         if (icon) icon.src = "assets/play.png";
      }
      showControls();
   }

   /**
    * Skip backward by configured interval
    */
   function rewind() {
      var currentTime = playerAdapter && typeof playerAdapter.getCurrentTime === 'function'
         ? playerAdapter.getCurrentTime()
         : videoPlayer.currentTime;
      seekTo(Math.max(0, currentTime - SKIP_INTERVAL_SECONDS));
      showControls();
   }

   /**
    * Skip forward by configured interval
    */
   function forward() {
      var currentTime = playerAdapter && typeof playerAdapter.getCurrentTime === 'function'
         ? playerAdapter.getCurrentTime()
         : videoPlayer.currentTime;
      var duration = playerAdapter && typeof playerAdapter.getDuration === 'function'
         ? playerAdapter.getDuration()
         : videoPlayer.duration;
      seekTo(Math.min(duration, currentTime + SKIP_INTERVAL_SECONDS));
      showControls();
   }

   /**
    * Seek forward by interval on seekbar
    */
   function seekForward() {
      var duration = getDuration();
      if (duration) {
         // Use pending seek position if a seek is in progress, otherwise use current time
         var currentTime = getCurrentTime();
         var currentPosition =
            pendingSeekPosition !== null
               ? pendingSeekPosition
               : currentTime;
         seekPosition = Math.min(
            currentPosition + SKIP_INTERVAL_SECONDS,
            duration
         );
         seekTo(seekPosition);

         // Update trickplay bubble during keyboard seeking
         if (isSeekbarFocused && duration) {
            var percent = (seekPosition / duration) * 100;
            updateTrickplayBubble(seekPosition * TICKS_PER_SECOND, percent);
         }

         showControls();
      }
   }

   /**
    * Seek backward by interval on seekbar
    */
   function seekBackward() {
      var duration = getDuration();
      // Use pending seek position if a seek is in progress, otherwise use current time
      var currentPosition =
         pendingSeekPosition !== null
            ? pendingSeekPosition
            : getCurrentTime();
      seekPosition = Math.max(currentPosition - SKIP_INTERVAL_SECONDS, 0);
      seekTo(seekPosition);

      // Update trickplay bubble during keyboard seeking
      if (isSeekbarFocused && duration) {
         var percent = (seekPosition / duration) * 100;
         updateTrickplayBubble(seekPosition * TICKS_PER_SECOND, percent);
      }

      showControls();
   }

   /**
    * Debounced seek function to prevent rapid seek operations
    * @param {number} position - Target position in seconds
    */
   function seekTo(position) {
      var duration = getDuration();
      if (!duration || isNaN(position)) return;

      position = Math.max(0, Math.min(position, duration));
      pendingSeekPosition = position;
      isSeekingActive = true; // Prevent onTimeUpdate from overriding seek preview

      updateSeekPreview(position);

      if (seekDebounceTimer) {
         clearTimeout(seekDebounceTimer);
      }

      seekDebounceTimer = setTimeout(function () {
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
         if (USE_PLAYBACK_MANAGER && playbackManagerReady) {
            var ticks = Math.floor(position * 10000000);
            PlaybackManagerAdapter.seek(ticks);
            console.log('[Player] Seeking via PlaybackManager to', position, 'seconds');
         } else if (playerAdapter && playerAdapter.seek) {
            // Legacy: Use adapter's seek method
            playerAdapter.seek(position);
         } else {
            // Legacy: Direct video element seek
            videoPlayer.currentTime = position;
         }
      } catch (error) {
         console.error('[Player] Seek error:', error);
      }

      setTimeout(function () {
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
      var duration = getDuration();
      if (!duration) return;

      var progress = (position / duration) * 100;

      if (elements.seekIndicator) {
         elements.seekIndicator.style.left = progress + "%";
         elements.seekIndicator.style.opacity = "1";
      }

      if (elements.timeDisplay) {
         elements.timeDisplay.textContent =
            formatTime(position) + " / " + formatTime(duration);
      }

      if (elements.endTime) {
         var remainingSeconds = duration - position;
         var endDate = new Date(Date.now() + remainingSeconds * 1000);
         var hours = endDate.getHours();
         var minutes = endDate.getMinutes();
         var ampm = hours >= 12 ? "PM" : "AM";
         hours = hours % 12;
         hours = hours ? hours : 12;
         var timeString =
            hours + ":" + (minutes < 10 ? "0" + minutes : minutes) + " " + ampm;
         elements.endTime.textContent = "Ends at " + timeString;
      }
   }

   /**
    * Show visual seeking indicator
    */
   function showSeekingIndicator() {
      if (elements.seekIndicator) {
         elements.seekIndicator.classList.add("seeking");
      }
   }

   /**
    * Hide visual seeking indicator
    */
   function hideSeekingIndicator() {
      if (elements.seekIndicator) {
         elements.seekIndicator.classList.remove("seeking");
         elements.seekIndicator.style.opacity = "";
      }
   }

   /**
    * Handle progress bar click for seeking
    * @param {MouseEvent} evt - Click event
    */
   function handleProgressBarClick(evt) {
      var rect = elements.progressBar.getBoundingClientRect();
      var pos = (evt.clientX - rect.left) / rect.width;
      var targetTime = pos * getDuration();
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
         elements.playerControls.classList.add("visible");
      }
      if (elements.videoDimmer) {
         elements.videoDimmer.classList.add("visible");
      }
      document.body.classList.add("controls-visible");
      controlsVisible = true;

      // Temporarily hide skip button when controls are shown to avoid focus conflicts
      if (skipOverlayVisible && elements.skipOverlay) {
         elements.skipOverlay.style.opacity = "0";
         elements.skipOverlay.style.pointerEvents = "none";
      }

      if (controlsTimeout) clearTimeout(controlsTimeout);

      controlsTimeout = setTimeout(function () {
         if (!videoPlayer.paused) {
            hideControls();
         }
      }, CONTROLS_HIDE_DELAY_MS);
   }

   /**
    * Hide player controls
    */
   function hideControls() {
      if (elements.playerControls) {
         elements.playerControls.classList.remove("visible");
      }
      if (elements.videoDimmer) {
         elements.videoDimmer.classList.remove("visible");
      }
      document.body.classList.remove("controls-visible");
      controlsVisible = false;

      // Restore skip button visibility when controls hide
      if (skipOverlayVisible && elements.skipOverlay) {
         elements.skipOverlay.style.opacity = "1";
         elements.skipOverlay.style.pointerEvents = "all";
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
    * Handle video play event - currently unused but kept for future use
    */
   function onPlay() {
      // Intentionally empty - events handled elsewhere
   }

   /**
    * Handle video pause event - currently unused but kept for future use
    */
   function onPause() {
      // Intentionally empty - events handled elsewhere
   }

   /**
    * Handle video ready to play event
    */
   function onCanPlay() {
      console.log("[Player] Video ready to play (canplay event)");
      console.log("[Player] Video state:", {
         paused: videoPlayer.paused,
         currentTime: videoPlayer.currentTime,
         readyState: videoPlayer.readyState,
         networkState: videoPlayer.networkState
      });

      clearLoadingTimeout();
      setLoadingState(LoadingState.READY);

      // If video is paused and ready, try to play it
      if (videoPlayer.paused && videoPlayer.readyState >= 3) {
         console.log("[Player] Video is paused but ready, calling play()");
         if (playerAdapter && typeof playerAdapter.play === 'function') {
            playerAdapter.play().catch(function (err) {
               console.error("[Player] play() in onCanPlay failed:", err);
            });
         } else {
            videoPlayer.play().catch(function (err) {
               console.error("[Player] play() in onCanPlay failed:", err);
            });
         }
      } else if (!videoPlayer.paused) {
         console.log("[Player] Video is already playing");
      }
   }

   /**
    * Handle video metadata loaded event
    */
   function onLoadedMetadata() {
      console.log("[Player] Video metadata loaded");
      clearLoadingTimeout();
   }

   /**
    * Handle video data loaded event (first frame available)
    */
   function onLoadedData() {
      console.log("[Player] Video data loaded (first frame ready)");
      console.log("[Player] Video dimensions:", videoPlayer.videoWidth + "x" + videoPlayer.videoHeight);
      clearLoadingTimeout();

      // Try to play if paused
      if (videoPlayer.paused) {
         console.log("[Player] Video has data but is paused, calling play()");
         if (playerAdapter && typeof playerAdapter.play === 'function') {
            playerAdapter.play().catch(function (err) {
               console.error("[Player] play() in onLoadedData failed:", err);
            });
         } else {
            videoPlayer.play().catch(function (err) {
               console.error("[Player] play() in onLoadedData failed:", err);
            });
         }
      }
   }

   /**
    * Handle video buffering event
    * For legacy mode, this could show a buffering indicator if needed.
    * Currently intentionally kept minimal.
    */
   function onWaiting() {
      // Intentionally minimal - PlaybackManager handles buffering automatically
      // Could be extended to show a buffering spinner if desired
   }

   /**
    * Handle video playing event (playback started)
    */
   function onPlaying() {
      console.log("[Player] Video playing event fired - playback has started!");
      console.log("[Player] Video state at playing:", {
         paused: videoPlayer.paused,
         currentTime: videoPlayer.currentTime,
         readyState: videoPlayer.readyState,
         duration: videoPlayer.duration,
         volume: videoPlayer.volume,
         muted: videoPlayer.muted
      });

      if (videoPlayer.audioTracks && videoPlayer.audioTracks.length > 0) {
         console.log("[Player] Audio tracks available:", videoPlayer.audioTracks.length);
         console.log("[Player] Selected audio index from media source:", currentAudioIndex);

         // Ensure at least one audio track is enabled 
         var hasEnabledTrack = false;
         for (var i = 0; i < videoPlayer.audioTracks.length; i++) {
            var track = videoPlayer.audioTracks[i];
            if (track.enabled) {
               hasEnabledTrack = true;
            }
            console.log("[Player] Audio track " + i + ":", {
               id: track.id,
               kind: track.kind,
               label: track.label,
               language: track.language,
               enabled: track.enabled
            });
         }

         // If no track is enabled, enable the user-selected or default track
         if (!hasEnabledTrack && videoPlayer.audioTracks.length > 0) {
            // Use currentAudioIndex if valid, otherwise fall back to first track
            var trackToEnable = currentAudioIndex >= 0 && currentAudioIndex < videoPlayer.audioTracks.length
               ? currentAudioIndex
               : 0;
            console.log("[Player] No audio track enabled, enabling track index:", trackToEnable);
            videoPlayer.audioTracks[trackToEnable].enabled = true;
         }
      } else {
         console.log("[Player] No audio tracks exposed via DOM API (embedded audio stream)");
      }

      clearLoadingTimeout();
      setLoadingState(LoadingState.READY);

      if (!progressInterval) {
         console.log("[Player] Starting progress reporting for session:", playSessionId);
         reportPlaybackStart();
         startProgressReporting();

         // Send immediate progress report to establish position
         setTimeout(function () {
            console.log("[Player] Sending immediate progress report");
            reportPlaybackProgress();
         }, 1000);

         detectCurrentAudioTrack();

         // Initialize audio normalization after playback starts
         initializeAudioNormalization();
      }

      // Apply playback speed
      if (videoPlayer && currentPlaybackSpeed !== 1.0) {
         videoPlayer.playbackRate = currentPlaybackSpeed;
      }

      // Start bitrate monitoring
      startBitrateMonitoring();

      showControls();

      if (
         elements.playPauseBtn &&
         !document.activeElement.classList.contains("control-btn")
      ) {
         setTimeout(function () {
            elements.playPauseBtn.focus();
         }, FOCUS_DELAY_MS);
      }
   }

   /**
    * Handle video time update event
    */
   function onTimeUpdate() {
      var duration = getDuration();
      if (!duration) return;

      var currentTime = getCurrentTime();
      var progress = (currentTime / duration) * 100;

      if (elements.progressFill) {
         elements.progressFill.style.width = progress + "%";
      }

      // Don't update seek indicator position while user is actively seeking
      // to prevent jumping back and forth during seek preview
      if (elements.seekIndicator && !isSeekingActive) {
         elements.seekIndicator.style.left = progress + "%";
      }

      if (elements.timeDisplay) {
         elements.timeDisplay.textContent =
            formatTime(currentTime) +
            " / " +
            formatTime(duration);
      }

      if (elements.endTime) {
         var remainingSeconds = duration - currentTime;
         var endDate = new Date(Date.now() + remainingSeconds * 1000);
         var hours = endDate.getHours();
         var minutes = endDate.getMinutes();
         var ampm = hours >= 12 ? "PM" : "AM";
         hours = hours % 12;
         hours = hours ? hours : 12; // 0 should be 12
         var timeString =
            hours + ":" + (minutes < 10 ? "0" + minutes : minutes) + " " + ampm;
         elements.endTime.textContent = "Ends at " + timeString;
      }

      // Check for skip segments
      checkSkipSegments(currentTime);

      // Update skip button countdown if visible
      if (skipOverlayVisible && currentSkipSegment) {
         var timeLeft = Math.ceil(
            currentSkipSegment.EndTicks / 10000000 - currentTime
         );
         updateSkipButtonTime(timeLeft);
      }
   }

   /**
    * Handle video ended event
    */
   function onEnded() {
      console.log("[Player] Playback ended");
      reportPlaybackStop();
      stopProgressReporting();
      stopBitrateMonitoring();

      // Clear health check timer
      if (playbackHealthCheckTimer) {
         clearTimeout(playbackHealthCheckTimer);
         playbackHealthCheckTimer = null;
      }

      // Check if autoPlay is enabled and we have a next episode
      var autoPlayEnabled = true; // default to true
      var stored = storage.getUserPreference("jellyfin_settings", null);
      if (stored) {
         try {
            var settings = JSON.parse(stored);
            if (settings.autoPlay === false) {
               autoPlayEnabled = false;
            }
         } catch (e) {
            // If parsing fails, use default (true)
         }
      }

      // If autoPlay is enabled and we have next episode data, play it
      if (autoPlayEnabled && nextEpisodeData) {
         console.log("[Player] AutoPlay enabled, playing next episode");
         playNextEpisode();
         return;
      }

      window.history.back();
   }

   /**
    * Handle video error event
    * @param {Event} evt - Error event
    */
   function onError(evt) {
      console.error("[Player] Playback error:", evt);

      var errorCode = videoPlayer.error ? videoPlayer.error.code : "unknown";
      var errorMessage = videoPlayer.error
         ? videoPlayer.error.message
         : "Unknown error";

      if (typeof ServerLogger !== "undefined") {
         var playbackContext = {
            errorCode: errorCode,
            errorMessage: errorMessage,
            itemId: itemId,
            itemName: itemData ? itemData.Name : "Unknown",
            mediaSource: currentMediaSource
               ? {
                  id: currentMediaSource.Id,
                  protocol: currentMediaSource.Protocol,
                  container: currentMediaSource.Container,
                  supportsDirectPlay: currentMediaSource.SupportsDirectPlay,
                  supportsDirectStream:
                     currentMediaSource.SupportsDirectStream,
                  supportsTranscoding: currentMediaSource.SupportsTranscoding,
               }
               : null,
            currentTime: videoPlayer.currentTime,
            duration: videoPlayer.duration,
            readyState: videoPlayer.readyState,
            networkState: videoPlayer.networkState,
         };
         ServerLogger.logPlaybackError(
            "Video playback error: " + errorCode,
            playbackContext
         );
      }

      clearLoadingTimeout();
      setLoadingState(LoadingState.ERROR);

      // Show error - don't auto-fallback (like jellyfin-web)
      // User can manually switch play mode if needed
      alert("Playback error occurred (code: " + errorCode + "). Try using the Play Mode option to switch playback methods.");
   }

   /**
    * Play previous item in queue/playlist
    */
   function playPreviousItem() {
      // If we have previous episode data, play it
      if (previousEpisodeData) {
         playPreviousEpisode();
         return;
      }

      // Otherwise, stop current playback and navigate back
      reportPlaybackStop();
      stopProgressReporting();
      stopBitrateMonitoring();
      window.history.back();
   }

   /**
    * Play next item in queue/playlist
    */
   function playNextItem() {
      // If we have next episode data, play it without page reload
      if (nextEpisodeData) {
         playNextEpisode();
         return;
      }

      // Otherwise, stop current playback and navigate back
      reportPlaybackStop();
      stopProgressReporting();
      stopBitrateMonitoring();
      window.history.back();
   }

   function exitPlayer() {
      // Report stop with current position before navigating away
      if (playSessionId) {
         makePlaybackRequest(
            auth.serverAddress + "/Sessions/Playing/Stopped",
            buildPlaybackData(),
            function () {
               // Navigate after stop report succeeds
               finishExit();
            },
            function (err) {
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

         saveForcePlayMode(null);

         if (playerAdapter) {
            playerAdapter.destroy().catch(function (err) { });
            playerAdapter = null;
         }

         // Cleanup audio normalization
         cleanupAudioNormalization();

         // Cleanup trickplay
         trickplayData = null;
         trickplayResolution = null;
         hideTrickplayBubble();

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
         elements.loadingIndicator.style.display = "flex";
      }
   }

   /**
    * Hide loading indicator
    */
   function hideLoading() {
      if (elements.loadingIndicator) {
         elements.loadingIndicator.style.display = "none";
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

      // Prevent multiple error dialogs from stacking
      if (elements.errorDialog.style.display === "flex") {
         console.log('[Player] Error dialog already visible, ignoring duplicate');
         return;
      }

      console.error('[Player] Showing error dialog:', title, message);
      if (details) {
         console.error('[Player] Error details:', details);
      }

      elements.errorDialogTitle.textContent = title || "Playback Error";
      elements.errorDialogMessage.textContent =
         message || "An error occurred during playback";

      if (details) {
         elements.errorDialogDetails.textContent = details;
         elements.errorDialogDetails.style.display = "block";
      } else {
         elements.errorDialogDetails.style.display = "none";
      }

      elements.errorDialog.style.display = "flex";
      setTimeout(() => {
         elements.errorDialogBtn.focus();
      }, 100);
   }

   /**
    * Close error dialog and navigate back
    */
   function closeErrorDialog() {
      if (elements.errorDialog) {
         elements.errorDialog.style.display = "none";
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
         if (
            playerAdapter.getName() === "ShakaPlayer" &&
            playerAdapter.player
         ) {
            var currentVariant = playerAdapter.player
               .getVariantTracks()
               .find(function (t) {
                  return t.active;
               });

            if (currentVariant && currentVariant.language) {
               var audioStreams = itemData.MediaSources[0].MediaStreams.filter(
                  function (s) {
                     return s.Type === "Audio";
                  }
               );

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
      } catch (error) { }
   }

   function initializeDefaultTrackIndices() {
      if (
         !itemData ||
         !itemData.MediaSources ||
         !itemData.MediaSources[0].MediaStreams
      )
         return;

      var mediaStreams = itemData.MediaSources[0].MediaStreams;

      // Initialize audio index to default track if not already set
      if (currentAudioIndex < 0) {
         var audioStreams = mediaStreams.filter(function (s) {
            return s.Type === "Audio";
         });
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
         var subtitleStreams = mediaStreams.filter(function (s) {
            return s.Type === "Subtitle";
         });
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
      if (
         !itemData ||
         !itemData.MediaSources ||
         !itemData.MediaSources[0].MediaStreams
      ) {
         return;
      }

      audioStreams = itemData.MediaSources[0].MediaStreams.filter(function (s) {
         return s.Type === "Audio";
      });

      if (audioStreams.length === 0) {
         return;
      }

      // Build language map for Shaka Player
      audioLanguageMap = audioStreams.map(function (s) {
         return s.Language || "und";
      });

      modalFocusableItems = TrackSelector.buildAudioTrackList(
         audioStreams,
         currentAudioIndex,
         elements.audioTrackList,
         selectAudioTrack
      );

      modalOpenerButton = elements.audioBtn; // Store the button that opened this modal
      activeModal = "audio";
      elements.audioModal.style.display = "flex";
      currentModalFocusIndex = Math.max(0, currentAudioIndex);
      if (modalFocusableItems[currentModalFocusIndex]) {
         modalFocusableItems[currentModalFocusIndex].focus();
      }
   }

   /**
    * Show subtitle track selector modal
    */
   function showSubtitleTrackSelector() {
      if (
         !itemData ||
         !itemData.MediaSources ||
         !itemData.MediaSources[0].MediaStreams
      ) {
         return;
      }

      subtitleStreams = itemData.MediaSources[0].MediaStreams.filter(function (
         s
      ) {
         return s.Type === "Subtitle";
      });

      modalFocusableItems = TrackSelector.buildSubtitleTrackList(
         subtitleStreams,
         currentSubtitleIndex,
         elements.subtitleTrackList,
         selectSubtitleTrack
      );

      modalOpenerButton = elements.subtitleBtn; // Store the button that opened this modal
      activeModal = "subtitle";
      elements.subtitleModal.style.display = "flex";
      currentModalFocusIndex = currentSubtitleIndex + 1; // +1 because of "None" option
      if (modalFocusableItems[currentModalFocusIndex]) {
         modalFocusableItems[currentModalFocusIndex].focus();
      }
   }

   /**
    * Select audio track by index
    * @param {number} index - Track index
    */
   function selectAudioTrack(index) {
      console.log("[Player] Selecting audio track:", index);

      if (index < 0 || index >= audioStreams.length) {
         console.warn("[Player] Invalid audio track index:", index);
         return;
      }

      // Update the visual selection in modal before processing
      if (modalFocusableItems && modalFocusableItems.length > 0) {
         modalFocusableItems.forEach(function (item) {
            item.classList.remove("selected");
         });
         if (modalFocusableItems[index]) {
            modalFocusableItems[index].classList.add("selected");
         }
      }

      currentAudioIndex = index;
      var stream = audioStreams[index];
      var language = stream.Language || "und";

      if (USE_PLAYBACK_MANAGER && playbackManagerReady) {
         try {
            PlaybackManagerAdapter.setAudioStreamIndex(stream.Index);
            console.log('[Player] Audio track switched via PlaybackManager:', stream.Index);
            closeModal();
            return;
         } catch (error) {
            console.error('[Player] Failed to switch audio via PlaybackManager:', error);
            // Fall through to legacy methods
         }
      }

      // Skip Shaka adapter for transcoded streams - they only have one baked-in audio track
      // Must reload video with new AudioStreamIndex parameter
      if (
         !isTranscoding &&
         playerAdapter &&
         typeof playerAdapter.selectAudioTrack === "function"
      ) {
         try {
            // For Shaka, we need to pass the language, not the array index
            var adapterIndex = index;

            // If using Shaka adapter, it expects a language-based index
            // We need to find which unique language position this is
            if (playerAdapter.constructor.name === "ShakaPlayerAdapter") {
               var uniqueLanguages = [];
               var seenLanguages = new Set();
               audioStreams.forEach(function (s) {
                  var lang = s.Language || "und";
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
         } catch (error) { }
      }

      reloadVideoWithTrack("audio", stream);
      closeModal();
   }

   /**
    * Select subtitle track by index
    * @param {number} index - Track index (-1 to disable)
    */
   function selectSubtitleTrack(index) {
      console.log(
         "[Player] Selecting subtitle track:",
         index === -1 ? "None" : index
      );

      // Update the visual selection in modal before processing
      // Account for "None" option at index 0 in the modal
      if (modalFocusableItems && modalFocusableItems.length > 0) {
         modalFocusableItems.forEach(function (item) {
            item.classList.remove("selected");
         });
         var modalIndex = index === -1 ? 0 : index + 1; // +1 because "None" is at position 0
         if (modalFocusableItems[modalIndex]) {
            modalFocusableItems[modalIndex].classList.add("selected");
         }
      }

      currentSubtitleIndex = index;

      if (USE_PLAYBACK_MANAGER && playbackManagerReady) {
         try {
            // PlaybackManager uses -1 to disable, or stream Index for subtitle
            var streamIndex = index >= 0 && index < subtitleStreams.length
               ? subtitleStreams[index].Index
               : -1;
            PlaybackManagerAdapter.setSubtitleStreamIndex(streamIndex);
            console.log('[Player] Subtitle track switched via PlaybackManager:', streamIndex);
            closeModal();
            return;
         } catch (error) {
            console.error('[Player] Failed to switch subtitle via PlaybackManager:', error);
            // Fall through to legacy methods
         }
      }

      // Skip Shaka adapter for transcoded streams - they don't include subtitle tracks
      // Must reload video with new SubtitleStreamIndex parameter
      if (
         !isTranscoding &&
         playerAdapter &&
         typeof playerAdapter.selectSubtitleTrack === "function"
      ) {
         try {
            // For subtitles, -1 means disable, otherwise use the array index
            var adapterIndex = index;

            // If using Shaka adapter and not disabling, map to unique subtitle tracks
            if (
               index >= 0 &&
               playerAdapter.constructor.name === "ShakaPlayerAdapter"
            ) {
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
         } catch (error) { }
      }

      var tracks = videoPlayer.textTracks;
      for (var i = 0; i < tracks.length; i++) {
         tracks[i].mode = "disabled";
      }

      if (index >= 0 && index < subtitleStreams.length) {
         var stream = subtitleStreams[index];
         reloadVideoWithTrack("subtitle", stream);
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
      console.log(
         "[Player] Reloading video with",
         trackType,
         "track:",
         stream.Index
      );

      var currentTime = videoPlayer.currentTime;
      var wasPaused = videoPlayer.paused;

      // Generate a NEW PlaySessionId to force Jellyfin to create a fresh transcode with the selected tracks
      var newPlaySessionId = generateUUID();

      // Build stream URL with track-specific parameters
      var streamUrl = auth.serverAddress + "/Videos/" + itemId + "/master.m3u8";
      // URLSearchParams in Chrome 53 (webOS 4) / older Tizen doesn't support object constructor
      var params = new URLSearchParams();
      params.append('mediaSourceId', currentMediaSource.Id);
      params.append('deviceId', JellyfinAPI.init());
      params.append('api_key', auth.accessToken);
      params.append('PlaySessionId', newPlaySessionId); // New session ID
      params.append('VideoCodec', 'h264');
      params.append('AudioCodec', 'aac');
      params.append('VideoBitrate', '20000000'); // Increased for better quality
      params.append('AudioBitrate', '256000');
      params.append('MaxWidth', '3840'); // Support 4K transcoding
      params.append('MaxHeight', '2160');
      params.append('SegmentLength', '6');
      params.append('MinSegments', '3');
      params.append('BreakOnNonKeyFrames', 'false');

      // Set the specific track indices - these tell Jellyfin which tracks to transcode
      if (trackType === "audio") {
         params.set("AudioStreamIndex", stream.Index);
         // Preserve subtitle selection
         if (
            currentSubtitleIndex >= 0 &&
            currentSubtitleIndex < subtitleStreams.length
         ) {
            params.set(
               "SubtitleStreamIndex",
               subtitleStreams[currentSubtitleIndex].Index
            );
         }
      } else if (trackType === "subtitle") {
         params.set("SubtitleStreamIndex", stream.Index);
         params.set("SubtitleMethod", "Encode"); // Tell Jellyfin to burn in subtitles
         // Preserve audio selection
         if (
            currentAudioIndex >= 0 &&
            currentAudioIndex < audioStreams.length
         ) {
            params.set(
               "AudioStreamIndex",
               audioStreams[currentAudioIndex].Index
            );
         }
      }

      var videoUrl = streamUrl + "?" + params.toString();

      // Update the global play session ID
      playSessionId = newPlaySessionId;

      setLoadingState(LoadingState.LOADING);

      // Use player adapter to load the new URL
      if (playerAdapter && typeof playerAdapter.load === "function") {
         playerAdapter
            .load(videoUrl, { startPosition: currentTime })
            .then(function () {
               if (!wasPaused) {
                  return playerAdapter.play();
               }
            })
            .then(function () {
               setLoadingState(LoadingState.READY);
            })
            .catch(function (err) {
               setLoadingState(LoadingState.ERROR);
               alert(
                  "Failed to switch track. The selected track may not be compatible."
               );
            });
      } else {
         videoPlayer.src = videoUrl;

         var onLoaded = function () {
            videoPlayer.removeEventListener("loadedmetadata", onLoaded);
            videoPlayer.currentTime = currentTime;

            if (!wasPaused) {
               playerAdapter ? playerAdapter.play() : videoPlayer.play().catch(function (err) { });
            }

            setLoadingState(LoadingState.READY);
         };

         videoPlayer.addEventListener("loadedmetadata", onLoaded);
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
      if (
         playerAdapter &&
         typeof playerAdapter.getPlaybackStats === "function"
      ) {
         liveStats = playerAdapter.getPlaybackStats();
      }

      // Show live playback information first if available (what's actually playing)
      if (liveStats) {
         infoHtml += '<div class="info-header">Active Playback</div>';

         // Show HDR status prominently
         if (liveStats.hdrType && liveStats.hdrType !== "SDR") {
            infoHtml +=
               '<div class="info-row info-highlight"><span class="info-label">HDR:</span><span class="info-value">' +
               liveStats.hdrType +
               "</span></div>";
         }

         // Show actual video codec being decoded
         if (liveStats.videoCodec) {
            var codecDisplay = liveStats.videoCodec.split(".")[0].toUpperCase();
            if (
               liveStats.videoCodec.startsWith("dvhe") ||
               liveStats.videoCodec.startsWith("dvh1")
            ) {
               codecDisplay = "DOLBY VISION (" + liveStats.videoCodec + ")";
            } else if (
               liveStats.videoCodec.startsWith("hev1") ||
               liveStats.videoCodec.startsWith("hvc1")
            ) {
               codecDisplay = "HEVC (" + liveStats.videoCodec + ")";
            }
            infoHtml +=
               '<div class="info-row"><span class="info-label">Video Codec:</span><span class="info-value">' +
               codecDisplay +
               "</span></div>";
         }

         // Show actual resolution being played
         if (liveStats.width && liveStats.height) {
            var resolution = liveStats.width + "x" + liveStats.height;
            var resolutionName = "";
            if (liveStats.height >= 2160) resolutionName = " (4K)";
            else if (liveStats.height >= 1080) resolutionName = " (1080p)";
            else if (liveStats.height >= 720) resolutionName = " (720p)";
            infoHtml +=
               '<div class="info-row"><span class="info-label">Playing:</span><span class="info-value">' +
               resolution +
               resolutionName +
               "</span></div>";
         }

         // Show actual bitrate
         if (liveStats.bandwidth) {
            var bitrateMbps = (liveStats.bandwidth / 1000000).toFixed(1);
            infoHtml +=
               '<div class="info-row"><span class="info-label">Stream Bitrate:</span><span class="info-value">' +
               bitrateMbps +
               " Mbps</span></div>";
         }

         // Show audio codec
         if (liveStats.audioCodec) {
            var audioCodecDisplay = liveStats.audioCodec
               .split(".")[0]
               .toUpperCase();
            infoHtml +=
               '<div class="info-row"><span class="info-label">Audio Codec:</span><span class="info-value">' +
               audioCodecDisplay +
               "</span></div>";
         }

         // Show performance stats if there are issues
         if (liveStats.droppedFrames > 0) {
            infoHtml +=
               '<div class="info-row info-warning"><span class="info-label">Dropped Frames:</span><span class="info-value">' +
               liveStats.droppedFrames +
               "</span></div>";
         }

         if (liveStats.stallsDetected > 0) {
            infoHtml +=
               '<div class="info-row info-warning"><span class="info-label">Stalls:</span><span class="info-value">' +
               liveStats.stallsDetected +
               "</span></div>";
         }

         infoHtml += '</div><div class="info-section">';
      }

      infoHtml += '<div class="info-header">Playback Method</div>';
      var mediaSource = playbackInfo.MediaSources[0];
      if (mediaSource.SupportsDirectPlay && !mediaSource.SupportsTranscoding) {
         infoHtml +=
            '<div class="info-row"><span class="info-label">Method:</span><span class="info-value">Direct Play</span></div>';
      } else if (
         !mediaSource.SupportsDirectPlay &&
         mediaSource.SupportsTranscoding
      ) {
         infoHtml +=
            '<div class="info-row"><span class="info-label">Method:</span><span class="info-value">Transcoding (HLS)</span></div>';
      } else {
         infoHtml +=
            '<div class="info-row"><span class="info-label">Method:</span><span class="info-value">Direct Play (Transcode Available)</span></div>';
      }

      infoHtml += '</div><div class="info-section">';
      infoHtml += '<div class="info-header">Stream Information</div>';

      if (mediaSource.Container) {
         infoHtml +=
            '<div class="info-row"><span class="info-label">Container:</span><span class="info-value">' +
            mediaSource.Container.toUpperCase() +
            "</span></div>";
      }

      if (mediaSource.Bitrate) {
         var bitrateMbps = (mediaSource.Bitrate / 1000000).toFixed(1);
         infoHtml +=
            '<div class="info-row"><span class="info-label">Bitrate:</span><span class="info-value">' +
            bitrateMbps +
            " Mbps</span></div>";
      }

      if (mediaSource.Size) {
         var sizeGB = (mediaSource.Size / 1073741824).toFixed(2);
         infoHtml +=
            '<div class="info-row"><span class="info-label">File Size:</span><span class="info-value">' +
            sizeGB +
            " GB</span></div>";
      }

      if (mediaSource.MediaStreams) {
         var videoStream = null;
         var audioStream = null;

         for (var i = 0; i < mediaSource.MediaStreams.length; i++) {
            var stream = mediaSource.MediaStreams[i];
            if (stream.Type === "Video" && !videoStream) {
               videoStream = stream;
            } else if (stream.Type === "Audio" && !audioStream) {
               audioStream = stream;
            }
         }

         if (videoStream) {
            infoHtml += '</div><div class="info-section">';
            infoHtml += '<div class="info-header">Video (Source File)</div>';

            if (videoStream.DisplayTitle) {
               infoHtml +=
                  '<div class="info-row"><span class="info-label">Stream:</span><span class="info-value">' +
                  videoStream.DisplayTitle +
                  "</span></div>";
            }

            if (videoStream.Codec) {
               infoHtml +=
                  '<div class="info-row"><span class="info-label">Codec:</span><span class="info-value">' +
                  videoStream.Codec.toUpperCase() +
                  "</span></div>";
            }

            // Show codec profile if available (helps identify Dolby Vision profile)
            if (videoStream.Profile) {
               infoHtml +=
                  '<div class="info-row"><span class="info-label">Profile:</span><span class="info-value">' +
                  videoStream.Profile +
                  "</span></div>";
            }

            if (videoStream.Width && videoStream.Height) {
               var resolution = videoStream.Width + "x" + videoStream.Height;
               var resolutionName = "";
               if (videoStream.Height >= 2160) resolutionName = " (4K)";
               else if (videoStream.Height >= 1080) resolutionName = " (1080p)";
               else if (videoStream.Height >= 720) resolutionName = " (720p)";
               else if (videoStream.Height >= 480) resolutionName = " (480p)";

               infoHtml +=
                  '<div class="info-row"><span class="info-label">Resolution:</span><span class="info-value">' +
                  resolution +
                  resolutionName +
                  "</span></div>";
            }

            if (videoStream.BitRate) {
               var videoBitrateMbps = (videoStream.BitRate / 1000000).toFixed(
                  1
               );
               infoHtml +=
                  '<div class="info-row"><span class="info-label">Bitrate:</span><span class="info-value">' +
                  videoBitrateMbps +
                  " Mbps</span></div>";
            }

            // Highlight HDR information from source file
            if (videoStream.VideoRange) {
               var rangeDisplay = videoStream.VideoRange.toUpperCase();
               var cssClass =
                  videoStream.VideoRange.toLowerCase() !== "sdr"
                     ? "info-row info-highlight"
                     : "info-row";
               infoHtml +=
                  '<div class="' +
                  cssClass +
                  '"><span class="info-label">Range:</span><span class="info-value">' +
                  rangeDisplay +
                  "</span></div>";
            }

            // Show color space and bit depth if available
            if (videoStream.ColorSpace) {
               infoHtml +=
                  '<div class="info-row"><span class="info-label">Color Space:</span><span class="info-value">' +
                  videoStream.ColorSpace +
                  "</span></div>";
            }

            if (videoStream.BitDepth) {
               infoHtml +=
                  '<div class="info-row"><span class="info-label">Bit Depth:</span><span class="info-value">' +
                  videoStream.BitDepth +
                  "-bit</span></div>";
            }

            if (videoStream.AverageFrameRate || videoStream.RealFrameRate) {
               var fps =
                  videoStream.AverageFrameRate || videoStream.RealFrameRate;
               infoHtml +=
                  '<div class="info-row"><span class="info-label">Frame Rate:</span><span class="info-value">' +
                  fps.toFixed(2) +
                  " fps</span></div>";
            }
         }

         if (audioStream) {
            infoHtml += '</div><div class="info-section">';
            infoHtml += '<div class="info-header">Audio</div>';

            if (audioStream.DisplayTitle) {
               infoHtml +=
                  '<div class="info-row"><span class="info-label">Stream:</span><span class="info-value">' +
                  audioStream.DisplayTitle +
                  "</span></div>";
            }

            if (audioStream.Codec) {
               infoHtml +=
                  '<div class="info-row"><span class="info-label">Codec:</span><span class="info-value">' +
                  audioStream.Codec.toUpperCase() +
                  "</span></div>";
            }

            if (audioStream.Channels) {
               var channelLayout = audioStream.Channels + ".0";
               if (audioStream.Channels === 6) channelLayout = "5.1";
               else if (audioStream.Channels === 8) channelLayout = "7.1";
               infoHtml +=
                  '<div class="info-row"><span class="info-label">Channels:</span><span class="info-value">' +
                  channelLayout +
                  "</span></div>";
            }

            if (audioStream.SampleRate) {
               var sampleRateKHz = (audioStream.SampleRate / 1000).toFixed(1);
               infoHtml +=
                  '<div class="info-row"><span class="info-label">Sample Rate:</span><span class="info-value">' +
                  sampleRateKHz +
                  " kHz</span></div>";
            }

            if (audioStream.BitRate) {
               var audioBitrateKbps = (audioStream.BitRate / 1000).toFixed(0);
               infoHtml +=
                  '<div class="info-row"><span class="info-label">Bitrate:</span><span class="info-value">' +
                  audioBitrateKbps +
                  " kbps</span></div>";
            }

            if (audioStream.Language) {
               infoHtml +=
                  '<div class="info-row"><span class="info-label">Language:</span><span class="info-value">' +
                  audioStream.Language.toUpperCase() +
                  "</span></div>";
            }
         }
      }

      infoHtml += "</div>";

      elements.videoInfoContent.innerHTML = infoHtml;
      elements.videoInfoModal.style.display = "flex";
      modalOpenerButton = elements.videoInfoBtn; // Store the button that opened this modal
      activeModal = "videoInfo";

      // Make the content scrollable with remote control
      // Use the content container itself as the focusable element for scrolling
      setTimeout(function () {
         if (elements.videoInfoContent) {
            elements.videoInfoContent.setAttribute("tabindex", "0");
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
         elements.chaptersContent.innerHTML =
            '<div class="no-chapters"><p>No chapters available for this video</p></div>';
         elements.chaptersModal.style.display = "flex";
         modalOpenerButton = elements.chaptersBtn; // Store the button that opened this modal
         activeModal = "chapters";
         return;
      }

      // Build chapters list
      var chaptersHtml = '<div class="chapter-list">';

      var currentTime = videoPlayer.currentTime * 10000000; // Convert to ticks

      itemData.Chapters.forEach(function (chapter, index) {
         var chapterStartSeconds = chapter.StartPositionTicks / 10000000;
         var hours = Math.floor(chapterStartSeconds / 3600);
         var minutes = Math.floor((chapterStartSeconds % 3600) / 60);
         var seconds = Math.floor(chapterStartSeconds % 60);

         var timeStr = "";
         if (hours > 0) {
            timeStr =
               hours +
               ":" +
               (minutes < 10 ? "0" : "") +
               minutes +
               ":" +
               (seconds < 10 ? "0" : "") +
               seconds;
         } else {
            timeStr = minutes + ":" + (seconds < 10 ? "0" : "") + seconds;
         }

         var chapterName = chapter.Name || "Chapter " + (index + 1);

         // Check if this is the current chapter
         var isCurrent = false;
         if (index < itemData.Chapters.length - 1) {
            var nextChapterStart =
               itemData.Chapters[index + 1].StartPositionTicks;
            isCurrent =
               currentTime >= chapter.StartPositionTicks &&
               currentTime < nextChapterStart;
         } else {
            // Last chapter
            isCurrent = currentTime >= chapter.StartPositionTicks;
         }

         var currentClass = isCurrent ? " current-chapter" : "";
         var currentIndicator = isCurrent ? " ► " : "";

         chaptersHtml +=
            '<div class="chapter-item' +
            currentClass +
            '" data-chapter-index="' +
            index +
            '" data-start-ticks="' +
            chapter.StartPositionTicks +
            '" tabindex="0">';
         chaptersHtml +=
            '<div class="chapter-time">' +
            currentIndicator +
            timeStr +
            "</div>";
         chaptersHtml += '<div class="chapter-name">' + chapterName + "</div>";
         chaptersHtml += "</div>";
      });

      chaptersHtml += "</div>";

      elements.chaptersContent.innerHTML = chaptersHtml;
      elements.chaptersModal.style.display = "flex";
      modalOpenerButton = elements.chaptersBtn; // Store the button that opened this modal
      activeModal = "chapters";

      // Set up focusable items for keyboard navigation
      modalFocusableItems = Array.from(
         document.querySelectorAll(".chapter-item")
      );
      currentModalFocusIndex = 0;

      // Find current chapter and focus it
      var currentChapterIndex = 0;
      itemData.Chapters.forEach(function (chapter, index) {
         if (index < itemData.Chapters.length - 1) {
            var nextChapterStart =
               itemData.Chapters[index + 1].StartPositionTicks;
            if (
               currentTime >= chapter.StartPositionTicks &&
               currentTime < nextChapterStart
            ) {
               currentChapterIndex = index;
            }
         } else if (currentTime >= chapter.StartPositionTicks) {
            currentChapterIndex = index;
         }
      });

      currentModalFocusIndex = currentChapterIndex;

      if (modalFocusableItems.length > 0) {
         modalFocusableItems[currentModalFocusIndex].focus();
         modalFocusableItems[currentModalFocusIndex].classList.add("focused");
      }

      // Add click/enter handlers for chapters
      modalFocusableItems.forEach(function (item) {
         item.addEventListener("click", function (evt) {
            evt.stopPropagation();
            var startTicks = parseInt(item.getAttribute("data-start-ticks"));
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
      if (playerAdapter && typeof playerAdapter.seek === "function") {
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

      var listHtml = "";
      PLAYBACK_SPEEDS.forEach(function (speed) {
         var isSelected = Math.abs(speed - currentPlaybackSpeed) < 0.01;
         listHtml +=
            '<div class="track-item' +
            (isSelected ? " selected" : "") +
            '" tabindex="0" data-speed="' +
            speed +
            '">';
         listHtml +=
            '<span class="track-name">' + speed.toFixed(2) + "x</span>";
         if (isSelected) {
            listHtml += '<span class="selected-indicator">✓</span>';
         }
         listHtml += "</div>";
      });

      elements.speedList.innerHTML = listHtml;
      elements.speedModal.style.display = "flex";
      modalOpenerButton = elements.speedBtn; // Store the button that opened this modal
      activeModal = "speed";

      modalFocusableItems = Array.from(
         elements.speedList.querySelectorAll(".track-item")
      );
      currentModalFocusIndex = PLAYBACK_SPEEDS.indexOf(currentPlaybackSpeed);
      if (currentModalFocusIndex < 0) currentModalFocusIndex = 3; // Default to 1.0x

      if (modalFocusableItems.length > 0) {
         modalFocusableItems[currentModalFocusIndex].focus();
         modalFocusableItems[currentModalFocusIndex].classList.add("focused");
      }

      // Add click handlers
      modalFocusableItems.forEach(function (item) {
         item.addEventListener("click", function (evt) {
            evt.stopPropagation();
            var speed = parseFloat(item.getAttribute("data-speed"));
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
         elements.speedIndicator.textContent = speed.toFixed(1) + "x";
         elements.speedIndicator.style.display = "block";
         elements.speedIndicator.style.opacity = "1";

         setTimeout(function () {
            elements.speedIndicator.style.opacity = "0";
            setTimeout(function () {
               elements.speedIndicator.style.display = "none";
            }, CONTROLS_FADE_DELAY_MS);
         }, AUTO_HIDE_CONTROLS_MS);
      }

      closeModal();
   }

   // Quality/Bitrate profiles (in Mbps)
   var QUALITY_PROFILES = [
      { value: "200000000", label: "200 Mbps" },
      { value: "180000000", label: "180 Mbps" },
      { value: "140000000", label: "140 Mbps" },
      { value: "120000000", label: "120 Mbps" },
      { value: "110000000", label: "110 Mbps" },
      { value: "100000000", label: "100 Mbps" },
      { value: "90000000", label: "90 Mbps" },
      { value: "80000000", label: "80 Mbps" },
      { value: "70000000", label: "70 Mbps" },
      { value: "60000000", label: "60 Mbps" },
      { value: "50000000", label: "50 Mbps" },
      { value: "40000000", label: "40 Mbps" },
      { value: "30000000", label: "30 Mbps" },
      { value: "20000000", label: "20 Mbps" },
      { value: "15000000", label: "15 Mbps" },
      { value: "10000000", label: "10 Mbps" },
      { value: "5000000", label: "5 Mbps" },
      { value: "3000000", label: "3 Mbps" },
      { value: "2000000", label: "2 Mbps" },
      { value: "1000000", label: "1 Mbps" },
      { value: "720000", label: "720 Kbps" },
      { value: "420000", label: "420 Kbps" },
   ];

   /**
    * Show quality/bitrate selector modal
    */
   function showQualitySelector() {
      if (!elements.qualityList || !elements.qualityModal) {
         return;
      }

      // Get current max bitrate setting (stored in bps)
      var currentMaxBitrate = storage.get("maxBitrate", false) || "120000000";

      var listHtml = "";
      QUALITY_PROFILES.forEach(function (profile) {
         var isSelected = profile.value === currentMaxBitrate;
         listHtml +=
            '<div class="track-item' +
            (isSelected ? " selected" : "") +
            '" tabindex="0" data-bitrate="' +
            profile.value +
            '">';
         listHtml += '<span class="track-name">' + profile.label + "</span>";
         if (isSelected) {
            listHtml += '<span class="selected-indicator">✓</span>';
         }
         listHtml += "</div>";
      });

      elements.qualityList.innerHTML = listHtml;
      elements.qualityModal.style.display = "flex";
      modalOpenerButton = elements.qualityBtn; // Store the button that opened this modal
      activeModal = "quality";

      modalFocusableItems = Array.from(
         elements.qualityList.querySelectorAll(".track-item")
      );

      // Find the index of current selection
      currentModalFocusIndex = QUALITY_PROFILES.findIndex(function (p) {
         return p.value === currentMaxBitrate;
      });
      if (currentModalFocusIndex < 0) currentModalFocusIndex = 3; // Default to 120 Mbps

      if (
         modalFocusableItems.length > 0 &&
         modalFocusableItems[currentModalFocusIndex]
      ) {
         modalFocusableItems[currentModalFocusIndex].focus();
         modalFocusableItems[currentModalFocusIndex].classList.add("focused");
      }

      // Add click handlers
      modalFocusableItems.forEach(function (item) {
         item.addEventListener("click", function (evt) {
            evt.stopPropagation();
            var bitrate = item.getAttribute("data-bitrate");
            setMaxBitrate(bitrate);
         });
      });
   }

   /**
    * Set max bitrate preference
    * @param {string} bitrate - Max bitrate in bps
    */
   function setMaxBitrate(bitrate) {
      storage.set("maxBitrate", bitrate, false);

      var profile = QUALITY_PROFILES.find(function (p) {
         return p.value === bitrate;
      });
      var label = profile ? profile.label : bitrate;

      // Show indicator briefly
      if (elements.bitrateIndicator) {
         elements.bitrateIndicator.textContent = "Max: " + label;
         elements.bitrateIndicator.style.display = "block";
         elements.bitrateIndicator.style.opacity = "1";

         setTimeout(function () {
            elements.bitrateIndicator.style.opacity = "0";
            setTimeout(function () {
               elements.bitrateIndicator.style.display = "none";
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
         modes.push({ label: "Direct Play", value: "direct", description: "No server processing" });
      }
      if (currentMediaSource.SupportsDirectStream) {
         modes.push({ label: "Direct Stream", value: "directstream", description: "Remux only, no transcode" });
      }
      if (currentMediaSource.SupportsTranscoding) {
         modes.push({ label: "Transcode", value: "transcode", description: "Full conversion" });
      }

      if (modes.length === 0) {
         return;
      }

      var listHtml = "";
      modes.forEach(function (mode) {
         var isSelected = forcePlayMode === mode.value;
         // Check if this mode is currently being used (when forcePlayMode is null)
         var isCurrentDefault = !forcePlayMode && (
            (mode.value === "direct" && currentMediaSource.SupportsDirectPlay) ||
            (mode.value === "directstream" && !currentMediaSource.SupportsDirectPlay && currentMediaSource.SupportsDirectStream)
         );
         listHtml +=
            '<div class="track-item' +
            (isSelected ? " selected" : "") +
            (isCurrentDefault ? " current-default" : "") +
            '" tabindex="0" data-mode="' +
            mode.value +
            '">';
         listHtml += '<span class="track-name">' + mode.label;
         if (mode.description) {
            listHtml += '<span class="track-description"> (' + mode.description + ')</span>';
         }
         listHtml += "</span>";
         if (isSelected) {
            listHtml += '<span class="selected-indicator">✓</span>';
         } else if (isCurrentDefault) {
            listHtml += '<span class="selected-indicator default-indicator">(auto)</span>';
         }
         listHtml += "</div>";
      });

      elements.playModeList.innerHTML = listHtml;
      elements.playModeModal.style.display = "flex";
      modalOpenerButton = elements.playModeBtn; // Store the button that opened this modal
      activeModal = "playmode";

      modalFocusableItems = Array.from(
         elements.playModeList.querySelectorAll(".track-item")
      );

      currentModalFocusIndex = 0;
      if (forcePlayMode) {
         currentModalFocusIndex = modes.findIndex(function (m) {
            return m.value === forcePlayMode;
         });
         if (currentModalFocusIndex < 0) currentModalFocusIndex = 0;
      }

      if (
         modalFocusableItems.length > 0 &&
         modalFocusableItems[currentModalFocusIndex]
      ) {
         modalFocusableItems[currentModalFocusIndex].focus();
         modalFocusableItems[currentModalFocusIndex].classList.add("focused");
      }

      modalFocusableItems.forEach(function (item) {
         item.addEventListener("click", function (evt) {
            evt.stopPropagation();
            var mode = item.getAttribute("data-mode");
            setPlayMode(mode);
         });
      });
   }

   function setPlayMode(mode) {
      if (forcePlayMode === mode) {
         closeModal();
         return;
      }

      forcePlayMode = mode;
      saveForcePlayMode(mode);
      console.log("[Player] Playback mode changed to:", mode, "- reloading video");

      var currentPos = videoPlayer ? Math.floor(videoPlayer.currentTime) : 0;

      if (videoPlayer) {
         reportPlaybackStop();
         stopProgressReporting();
         stopBitrateMonitoring();
      }

      closeModal();

      var params = new URLSearchParams(window.location.search);
      params.set('position', currentPos);
      window.location.search = params.toString();
   }

   /**
    * Start monitoring bitrate and update indicator
    */
   function startBitrateMonitoring() {
      if (bitrateUpdateInterval) {
         clearInterval(bitrateUpdateInterval);
      }

      bitrateUpdateInterval = setInterval(function () {
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
         elements.bitrateIndicator.style.display = "none";
      }
   }

   /**
    * Update bitrate indicator based on current playback
    */
   function updateBitrateIndicator() {
      if (
         !elements.bitrateIndicator ||
         !playbackInfo ||
         !playbackInfo.MediaSource
      ) {
         return;
      }

      var mediaSource = playbackInfo.MediaSource;
      var bitrate = 0;

      // Get bitrate from media source
      if (mediaSource.Bitrate) {
         bitrate = mediaSource.Bitrate;
      } else if (
         playbackInfo.PlayMethod === "Transcode" &&
         playbackInfo.TranscodingInfo
      ) {
         // For transcoding, use target bitrate
         bitrate = playbackInfo.TranscodingInfo.Bitrate || 0;
      }

      if (bitrate > 0) {
         var bitrateMbps = (bitrate / 1000000).toFixed(1);
         elements.bitrateIndicator.textContent = bitrateMbps + " Mbps";
         elements.bitrateIndicator.style.display = "block";
      }
   }

   /**
    * Close all modals
    */
   function closeModal() {
      if (elements.audioModal) {
         elements.audioModal.style.display = "none";
      }
      if (elements.subtitleModal) {
         elements.subtitleModal.style.display = "none";
      }
      if (elements.speedModal) {
         elements.speedModal.style.display = "none";
      }
      if (elements.qualityModal) {
         elements.qualityModal.style.display = "none";
      }
      if (elements.playModeModal) {
         elements.playModeModal.style.display = "none";
      }
      if (elements.videoInfoModal) {
         elements.videoInfoModal.style.display = "none";
      }
      if (elements.chaptersModal) {
         elements.chaptersModal.style.display = "none";
      }
      activeModal = null;
      modalFocusableItems = [];

      // Restore focus to the button that opened the modal
      if (
         modalOpenerButton &&
         focusableButtons.indexOf(modalOpenerButton) !== -1
      ) {
         var targetButton = modalOpenerButton;
         setTimeout(function () {
            targetButton.focus();
         }, 100);
      }
      modalOpenerButton = null; // Clear the reference
   }

   /**
    * Load media segments (intro/outro markers) from Jellyfin server
    */
   function loadMediaSegments() {
      if (!auth || !itemId) {
         return;
      }

      var url = auth.serverAddress + "/MediaSegments/" + itemId;

      var authHeader =
         'MediaBrowser Client="' +
         JellyfinAPI.appName +
         '", Device="' +
         JellyfinAPI.deviceName +
         '", DeviceId="' +
         JellyfinAPI.deviceId +
         '", Version="' +
         JellyfinAPI.appVersion +
         '", Token="' +
         auth.accessToken +
         '"';

      ajax.request(url, {
         method: "GET",
         headers: {
            "X-Emby-Authorization": authHeader,
         },
         success: function (response) {
            try {
               var data = response;
               if (data && data.Items && data.Items.length > 0) {
                  data.Items.forEach(function (seg, idx) {
                     var duration = (seg.EndTicks - seg.StartTicks) / 10000000;
                     console.log(
                        "Segment",
                        idx,
                        seg.Type,
                        "from",
                        (seg.StartTicks / 10000000).toFixed(0),
                        "to",
                        (seg.EndTicks / 10000000).toFixed(0)
                     );
                  });

                  // Filter out very short segments (< 1 second)
                  mediaSegments = data.Items.filter(function (segment) {
                     var duration =
                        (segment.EndTicks - segment.StartTicks) / 10000000;
                     return duration >= 1;
                  });
                  mediaSegments.forEach(function (seg) { });
               } else {
                  mediaSegments = [];
               }
            } catch (e) {
               mediaSegments = [];
            }
         },
         error: function (errorObj) {
            mediaSegments = [];
         },
      });
   }

   /**
    * Load adjacent episodes (previous and next) for navigation buttons
    */
   function loadAdjacentEpisodes() {
      console.log("[loadAdjacentEpisodes] START");
      console.log("[loadAdjacentEpisodes] auth:", !!auth, "itemData:", !!itemData);

      if (!auth || !itemData) {
         console.log("[loadAdjacentEpisodes] Missing auth or itemData, returning");
         return;
      }

      console.log(
         "[loadAdjacentEpisodes] itemData.Type:",
         itemData.Type,
         "itemData.SeriesId:",
         itemData.SeriesId
      );

      // Only load adjacent episodes for TV episodes
      if (itemData.Type !== "Episode" || !itemData.SeriesId) {
         console.log(
            "[loadAdjacentEpisodes] Not an episode or no SeriesId, returning"
         );
         return;
      }

      var url =
         auth.serverAddress + "/Shows/" + itemData.SeriesId + "/Episodes";

      // Fetch all episodes to find previous and next
      var params = {
         UserId: auth.userId,
         SeasonId: itemData.SeasonId,
         Fields: "Overview",
      };

      var queryString = Object.keys(params)
         .map(function (key) {
            return (
               encodeURIComponent(key) + "=" + encodeURIComponent(params[key])
            );
         })
         .join("&");

      console.log(
         "[loadAdjacentEpisodes] Making request to:",
         url + "?" + queryString
      );

      ajax.request(url + "?" + queryString, {
         method: "GET",
         headers: {
            "X-Emby-Authorization": JellyfinAPI.getAuthHeader(auth.accessToken),
         },
         success: function (response) {
            try {
               var data = response;
               console.log("[loadAdjacentEpisodes] Response - Total episodes:", data && data.Items ? data.Items.length : 0);

               if (data && data.Items && data.Items.length > 0) {
                  // Find current episode index
                  var currentIndex = -1;
                  for (var i = 0; i < data.Items.length; i++) {
                     if (data.Items[i].Id === itemId) {
                        currentIndex = i;
                        break;
                     }
                  }

                  console.log("[loadAdjacentEpisodes] Current episode index:", currentIndex);

                  // Set previous episode if exists
                  if (currentIndex > 0) {
                     previousEpisodeData = data.Items[currentIndex - 1];
                     console.log(
                        "[loadAdjacentEpisodes] Previous episode loaded:",
                        previousEpisodeData.Name,
                        previousEpisodeData.Id
                     );
                  } else {
                     previousEpisodeData = null;
                     console.log("[loadAdjacentEpisodes] No previous episode (first in season)");
                  }

                  // Set next episode if exists
                  if (currentIndex >= 0 && currentIndex < data.Items.length - 1) {
                     nextEpisodeData = data.Items[currentIndex + 1];
                     console.log(
                        "[loadAdjacentEpisodes] Next episode loaded:",
                        nextEpisodeData.Name,
                        nextEpisodeData.Id
                     );
                  } else {
                     nextEpisodeData = null;
                     console.log("[loadAdjacentEpisodes] No next episode (last in season)");
                  }
               } else {
                  previousEpisodeData = null;
                  nextEpisodeData = null;
                  console.log("[loadAdjacentEpisodes] No episodes found");
               }
            } catch (e) {
               console.log("[loadAdjacentEpisodes] Error parsing episodes:", e);
               previousEpisodeData = null;
               nextEpisodeData = null;
            }
         },
         error: function (status, response) {
            console.log(
               "[loadAdjacentEpisodes] Request failed - status:",
               status,
               "response:",
               response
            );
            previousEpisodeData = null;
            nextEpisodeData = null;
         },
      });
   }

   /**
    * Check if current playback position is within a skip segment
    */
   function checkSkipSegments(currentTime) {
      if (!mediaSegments || mediaSegments.length === 0) return;

      // Check if skip intro feature is enabled
      var stored = storage.getUserPreference("jellyfin_settings", null);
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

         if (
            currentTicks >= segment.StartTicks &&
            currentTicks <= segment.EndTicks
         ) {
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
      if (
         !elements.skipOverlay ||
         !elements.skipButton ||
         !elements.skipButtonText
      )
         return;

      var buttonText = getSkipButtonText(segment.Type);
      elements.skipButtonText.textContent = buttonText;

      elements.skipOverlay.style.display = "block";
      setTimeout(function () {
         elements.skipOverlay.classList.add("visible");
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

      elements.skipOverlay.classList.remove("visible");
      setTimeout(function () {
         elements.skipOverlay.style.display = "none";
      }, 300);

      skipOverlayVisible = false;
      currentSkipSegment = null;
   }

   /**
    * Get button text based on segment type
    */
   function getSkipButtonText(segmentType) {
      switch (segmentType) {
         case "Intro":
            return "Skip Intro";
         case "Outro":
         case "Credits":
            // Check if we have next episode data
            if (nextEpisodeData) {
               return "Play Next Episode";
            }
            return "Skip Credits";
         case "Preview":
            return "Skip Preview";
         case "Recap":
            return "Skip Recap";
         default:
            return "Skip";
      }
   }

   /**
    * Update skip button countdown time
    */
   function updateSkipButtonTime(seconds) {
      if (!elements.skipButtonTime) return;

      if (seconds > 0) {
         elements.skipButtonTime.textContent = seconds + "s";
      } else {
         elements.skipButtonTime.textContent = "";
      }
   }

   /**
    * Play the previous episode in the series without reloading the page
    */
   function playPreviousEpisode() {
      console.log("[playPreviousEpisode] START");

      if (USE_PLAYBACK_MANAGER && playbackManagerReady) {
         console.log('[Player] Playing previous episode via PlaybackManager');
         try {
            PlaybackManagerAdapter.previousTrack();
            console.log('[Player] Successfully triggered previous track');
            return;
         } catch (error) {
            console.error('[Player] Failed to play previous via PlaybackManager:', error);
            // Fall through to legacy method
         }
      }

      // Legacy method
      if (!previousEpisodeData) {
         console.log("[playPreviousEpisode] No previous episode data available");
         return;
      }

      console.log(
         "[playPreviousEpisode] Previous episode:",
         previousEpisodeData.Name,
         previousEpisodeData.Id
      );

      // Save previous episode ID before clearing
      var prevEpisodeId = previousEpisodeData.Id;

      // Stop current playback reporting
      reportPlaybackStop();
      stopProgressReporting();

      // Clear current state
      currentSkipSegment = null;
      skipOverlayVisible = false;
      hideSkipOverlay();
      mediaSegments = [];
      previousEpisodeData = null;
      nextEpisodeData = null;

      // Update browser history so BACK goes to correct details page
      if (window && window.history && window.location) {
         var newUrl = "player.html?id=" + prevEpisodeId;
         window.history.replaceState({}, "", newUrl);
      }

      // Load and play the previous episode
      itemId = prevEpisodeId;
      loadItemAndPlay();
      console.log("[playPreviousEpisode] END");
   }

   /**
    * Play the next episode in the series without reloading the page
    */
   function playNextEpisode() {
      console.log("[playNextEpisode] START");

      if (USE_PLAYBACK_MANAGER && playbackManagerReady) {
         console.log('[Player] Playing next episode via PlaybackManager');
         try {
            PlaybackManagerAdapter.nextTrack();
            console.log('[Player] Successfully triggered next track');
            return;
         } catch (error) {
            console.error('[Player] Failed to play next via PlaybackManager:', error);
            // Fall through to legacy method
         }
      }

      // Legacy method
      if (!nextEpisodeData) {
         console.log("[playNextEpisode] No next episode data available");
         return;
      }

      console.log(
         "[playNextEpisode] Next episode:",
         nextEpisodeData.Name,
         nextEpisodeData.Id
      );

      // Save next episode ID before clearing
      var nextEpisodeId = nextEpisodeData.Id;
      console.log("[playNextEpisode] Saved next episode ID:", nextEpisodeId);

      // Stop current playback reporting
      console.log("[playNextEpisode] Stopping current playback...");
      console.log("[playNextEpisode] Reporting playback stop...");
      reportPlaybackStop();
      console.log("[playNextEpisode] Stopping progress reporting...");
      stopProgressReporting();

      // Clear current state
      console.log("[playNextEpisode] Clearing current state...");
      currentSkipSegment = null;
      skipOverlayVisible = false;
      hideSkipOverlay();
      mediaSegments = [];
      previousEpisodeData = null;
      nextEpisodeData = null;

      // Update browser history so BACK goes to correct details page
      if (window && window.history && window.location) {
         var newUrl = "player.html?id=" + nextEpisodeId;
         window.history.replaceState({}, "", newUrl);
      }
      // Load and play the next episode (keep playerAdapter alive)
      console.log("[playNextEpisode] Setting itemId to:", nextEpisodeId);
      itemId = nextEpisodeId;
      console.log("[playNextEpisode] Calling loadItemAndPlay()...");
      loadItemAndPlay();
      console.log("[playNextEpisode] END");
   }

   /**
    * Execute skip action (seek past segment or play next episode)
    */
   function executeSkip() {
      console.log(
         "[executeSkip] START - currentSkipSegment:",
         currentSkipSegment
      );
      if (!currentSkipSegment) {
         console.log("[executeSkip] No currentSkipSegment, returning");
         return;
      }

      var segmentType = currentSkipSegment.Type;
      console.log(
         "[executeSkip] segmentType:",
         segmentType,
         "nextEpisodeData:",
         nextEpisodeData
      );

      // For outro/credits with next episode available, play next episode directly
      // (User manually pressed skip, so honor that intent regardless of autoPlay setting)
      if (
         (segmentType === "Outro" || segmentType === "Credits") &&
         nextEpisodeData
      ) {
         console.log(
            "[executeSkip] Conditions met - calling playNextEpisode()"
         );
         playNextEpisode();
         console.log("[executeSkip] Returned from playNextEpisode()");
         return;
      }

      // Otherwise, seek past the segment
      var skipToTime = currentSkipSegment.EndTicks / 10000000;
      console.log("[executeSkip] Seeking to:", skipToTime);
      videoPlayer.currentTime = skipToTime;
      hideSkipOverlay();
      console.log("[executeSkip] END");
   }

   // ============================================================================
   // TRICKPLAY THUMBNAILS (Jellyfin Web Compatible)
   // ============================================================================

   /**
    * Initialize trickplay data from item data
    * Following jellyfin-web implementation exactly
    */
   function initializeTrickplay() {
      trickplayData = null;
      trickplayResolution = null;

      if (!itemData || !itemData.Trickplay) {
         console.log("[Trickplay] No trickplay data available for this item");
         return;
      }

      // Get the primary media source ID
      var mediaSourceId = null;
      if (itemData.MediaSources && itemData.MediaSources.length > 0) {
         mediaSourceId = itemData.MediaSources[0].Id;
      }

      if (mediaSourceId) {
         initializeTrickplayForMediaSource(mediaSourceId);
      }
   }

   /**
    * Initialize trickplay for a specific media source ID
    * @param {string} mediaSourceId - The media source ID to use
    */
   function initializeTrickplayForMediaSource(mediaSourceId) {
      trickplayData = null;
      trickplayResolution = null;

      if (!itemData || !itemData.Trickplay) {
         console.log("[Trickplay] No trickplay data available for this item");
         return;
      }

      if (!mediaSourceId) {
         console.log("[Trickplay] No media source ID provided");
         return;
      }

      var trickplayResolutions = itemData.Trickplay[mediaSourceId];
      if (!trickplayResolutions) {
         console.log("[Trickplay] No trickplay resolutions for media source:", mediaSourceId);
         return;
      }

      // Prefer highest resolution <= 20% of screen width (following jellyfin-web)
      var maxWidth = window.screen.width * window.devicePixelRatio * 0.2;
      var bestWidth = null;

      for (var widthKey in trickplayResolutions) {
         if (trickplayResolutions.hasOwnProperty(widthKey)) {
            var info = trickplayResolutions[widthKey];
            var width = info.Width;

            if (!bestWidth ||
               (width < bestWidth && bestWidth > maxWidth) ||
               (width > bestWidth && width <= maxWidth)) {
               bestWidth = width;
            }
         }
      }

      if (bestWidth && trickplayResolutions[bestWidth]) {
         trickplayResolution = trickplayResolutions[bestWidth];
         trickplayData = {
            mediaSourceId: mediaSourceId,
            resolution: trickplayResolution
         };

         console.log("[Trickplay] Initialized with resolution:", bestWidth, "Info:", trickplayResolution);

         // Setup trickplay bubble dimensions
         if (elements.trickplayThumb) {
            elements.trickplayThumb.style.width = trickplayResolution.Width + "px";
            elements.trickplayThumb.style.height = trickplayResolution.Height + "px";
         }
      }
   }

   /**
    * Update trickplay bubble HTML - following jellyfin-web implementation exactly
    * @param {number} positionTicks - Position in ticks
    * @param {number} percent - Progress bar percentage
    */
   function updateTrickplayBubble(positionTicks, percent) {
      if (!elements.trickplayBubble) return;

      var bubble = elements.trickplayBubble;
      var progressBarRect = elements.progressBar.getBoundingClientRect();

      // Calculate bubble position
      var bubblePos = progressBarRect.width * percent / 100;
      bubble.style.left = bubblePos + "px";

      // If no trickplay data, just show time
      if (!trickplayResolution || !trickplayData) {
         bubble.classList.add("no-trickplay");
         if (elements.trickplayTime) {
            elements.trickplayTime.textContent = formatTime(positionTicks / TICKS_PER_SECOND);
         }
         if (elements.trickplayChapterName) {
            elements.trickplayChapterName.textContent = "";
         }
         bubble.style.display = "block";
         return;
      }

      bubble.classList.remove("no-trickplay");

      // Find current chapter name
      var chapterName = "";
      if (itemData && itemData.Chapters) {
         for (var i = 0; i < itemData.Chapters.length; i++) {
            var chapter = itemData.Chapters[i];
            if (positionTicks >= chapter.StartPositionTicks) {
               chapterName = chapter.Name || "";
            } else {
               break;
            }
         }
      }

      // Calculate trickplay tile position (following jellyfin-web exactly)
      var currentTimeMs = positionTicks / 10000; // Ticks to milliseconds
      var currentTile = Math.floor(currentTimeMs / trickplayResolution.Interval);
      var tileSize = trickplayResolution.TileWidth * trickplayResolution.TileHeight;
      var tileOffset = currentTile % tileSize;
      var imageIndex = Math.floor(currentTile / tileSize);

      var tileOffsetX = tileOffset % trickplayResolution.TileWidth;
      var tileOffsetY = Math.floor(tileOffset / trickplayResolution.TileWidth);
      var offsetX = -(tileOffsetX * trickplayResolution.Width);
      var offsetY = -(tileOffsetY * trickplayResolution.Height);

      // Build trickplay image URL (following jellyfin-web API format)
      var imgSrc = auth.serverAddress + "/Videos/" + itemId + "/Trickplay/" +
         trickplayResolution.Width + "/" + imageIndex + ".jpg?MediaSourceId=" +
         trickplayData.mediaSourceId;

      // Update thumbnail
      if (elements.trickplayThumb) {
         elements.trickplayThumb.style.backgroundImage = "url('" + imgSrc + "')";
         elements.trickplayThumb.style.backgroundPositionX = offsetX + "px";
         elements.trickplayThumb.style.backgroundPositionY = offsetY + "px";
         elements.trickplayThumb.style.width = trickplayResolution.Width + "px";
         elements.trickplayThumb.style.height = trickplayResolution.Height + "px";
      }

      // Update text
      if (elements.trickplayTime) {
         elements.trickplayTime.textContent = formatTime(positionTicks / TICKS_PER_SECOND);
      }
      if (elements.trickplayChapterName) {
         elements.trickplayChapterName.textContent = chapterName;
      }

      bubble.style.display = "block";
   }

   /**
    * Show trickplay bubble
    */
   function showTrickplayBubble() {
      if (elements.trickplayBubble) {
         trickplayVisible = true;
      }
   }

   /**
    * Hide trickplay bubble
    */
   function hideTrickplayBubble() {
      if (elements.trickplayBubble) {
         elements.trickplayBubble.style.display = "none";
         trickplayVisible = false;
      }
   }

   // ============================================================================
   // AUDIO NORMALIZATION (Jellyfin Web Compatible)
   // ============================================================================

   /**
    * Initialize audio normalization using Web Audio API
    * Following jellyfin-web implementation
    */
   function initializeAudioNormalization() {
      if (!audioNormalizationEnabled) {
         console.log("[AudioNorm] Audio normalization disabled");
         return;
      }

      // Check if item has normalization gain data
      var trackGain = itemData && itemData.NormalizationGain;
      var albumGain = null;

      // Get album gain from media source if available
      if (playbackInfo && playbackInfo.MediaSources && playbackInfo.MediaSources.length > 0) {
         albumGain = playbackInfo.MediaSources[0].albumNormalizationGain || null;
      }

      // Use track gain, falling back to album gain (TrackGain mode - default in jellyfin-web)
      var gainValue = trackGain || albumGain;

      if (!gainValue) {
         console.log("[AudioNorm] No normalization gain data available");
         cleanupAudioNormalization();
         return;
      }

      try {
         // Create or reuse AudioContext
         var AudioContextClass = window.AudioContext || window.webkitAudioContext;
         if (!AudioContextClass) {
            console.log("[AudioNorm] Web Audio API not supported");
            return;
         }

         if (!audioContext) {
            audioContext = new AudioContextClass();
         }

         // Resume audio context if suspended (required by browsers after user interaction)
         if (audioContext.state === "suspended") {
            audioContext.resume();
         }

         // Create gain node if not exists
         if (!gainNode) {
            gainNode = audioContext.createGain();
            gainNode.connect(audioContext.destination);
         }

         // Create media element source if not exists
         if (!sourceNode) {
            sourceNode = audioContext.createMediaElementSource(videoPlayer);
            sourceNode.connect(gainNode);
         }

         // Convert dB to linear gain (following jellyfin-web: Math.pow(10, normalizationGain / 20))
         normalizationGain = Math.pow(10, gainValue / 20);
         gainNode.gain.value = normalizationGain;

         console.log("[AudioNorm] Applied normalization gain:", gainValue, "dB -> linear:", normalizationGain);

      } catch (error) {
         console.error("[AudioNorm] Failed to initialize audio normalization:", error);
         cleanupAudioNormalization();
      }
   }

   /**
    * Cleanup audio normalization resources
    */
   function cleanupAudioNormalization() {
      if (gainNode) {
         gainNode.gain.value = 1.0;
      }
      normalizationGain = 1.0;
      // Note: We don't destroy the audioContext/sourceNode as they cannot be 
      // recreated once destroyed for the same video element
   }

   /**
    * Get current audio normalization setting
    * @returns {string} 'TrackGain', 'AlbumGain', or 'Off'
    */
   function getAudioNormalizationMode() {
      // Can be expanded to read from user settings storage
      return audioNormalizationEnabled ? "TrackGain" : "Off";
   }

   /**
    * Set audio normalization mode
    * @param {string} mode - 'TrackGain', 'AlbumGain', or 'Off'
    */
   function setAudioNormalizationMode(mode) {
      audioNormalizationEnabled = mode !== "Off";
      if (audioNormalizationEnabled && itemData) {
         initializeAudioNormalization();
      } else {
         cleanupAudioNormalization();
      }
   }

   return {
      init: init,
   };
})();

window.addEventListener("load", function () {
   PlayerController.init();
});
