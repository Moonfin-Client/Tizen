/*
 * Settings Controller
 * Handles settings navigation and configuration
 */

var SettingsController = (function () {
   "use strict";

   var auth = null;

   var focusManager = {
      inSidebar: true,
      inNavBar: false,
      navBarIndex: 0,
      sidebarIndex: 0,
      contentIndex: 0,
      currentCategory: "general",
      inSliderMode: false,
      sliderSetting: null,
   };

   var elements = {};

   // Timing Constants
   var FOCUS_DELAY_MS = 100;

   // Carousel Speed Options (in milliseconds)
   var CAROUSEL_SPEEDS = [5000, 8000, 10000, 15000, 20000];
   var DEFAULT_CAROUSEL_SPEED_MS = 8000;
   var CAROUSEL_SPEED_TO_SECONDS = 1000;

   var settings = {
      /**
       * Play theme music in details view
       * @type {boolean}
       */
      playThemeMusic: true,
      autoLogin: false,
      clockDisplay: "12-hour",
      skipIntro: true,
      autoPlay: true,
      theme: "dark",
      accentColor: "blue",
      carouselSpeed: DEFAULT_CAROUSEL_SPEED_MS,
      homeRows: null, // Will be initialized with defaults
      showShuffleButton: true,
      showGenresButton: true,
      showFavoritesButton: true,
      showLibrariesInToolbar: true,
      showFeaturedBanner: true,
      // Image Helper settings
      imageType: "Primary",
      posterSize: 300, // X-Large (always highest quality)
      // Continue Watching settings
      mergeContinueWatchingNextUp: false,
      // Backdrop blur settings
      backdropBlurHome: 3,
      backdropBlurDetail: 3,
      // Jellyseerr settings
      jellyseerrEnabled: false,
      jellyseerrUrl: "",
      jellyseerrApiKey: "",
      jellyseerrFilterNSFW: true,
   };

   // Default home rows configuration
   var defaultHomeRows = [
      { id: "resume", name: "Continue Watching", enabled: true, order: 0 },
      { id: "nextup", name: "Next Up", enabled: true, order: 1 },
      { id: "latest-movies", name: "Latest Movies", enabled: true, order: 2 },
      { id: "latest-shows", name: "Latest TV Shows", enabled: true, order: 2 },
      { id: "latest-music", name: "Latest Music", enabled: true, order: 2 },
      {
         id: "livetv-channels",
         name: "Live TV Channels",
         enabled: true,
         order: 3,
      },
      { id: "livetv-recordings", name: "Recordings", enabled: true, order: 3 },
      { id: "library-tiles", name: "My Media", enabled: false, order: 4 },
      { id: "collections", name: "Collections", enabled: false, order: 5 },
   ];

   var homeRowsModal = {
      isOpen: false,
      focusedIndex: 0,
      rows: [],
      // Store references to event handlers for cleanup
      saveHandler: null,
      cancelHandler: null,
      resetHandler: null,
   };

   /**
    * Utility function to clean up modal keyboard event handlers
    * @param {HTMLElement} modal - Modal element
    * @param {string} handlerProp - Property name of the handler (e.g., '_serverManagerKeyHandler')
    * @private
    */
   function cleanupModalKeyHandler(modal, handlerProp) {
      if (modal && modal[handlerProp]) {
         modal.removeEventListener("keydown", modal[handlerProp]);
         modal[handlerProp] = null;
      }
   }

   /**
    * Initialize the settings controller
    * Loads settings, displays user info, and sets up navigation
    */
   function init() {
      // Use MultiServerManager if available, otherwise fall back to JellyfinAPI
      auth =
         typeof MultiServerManager !== "undefined"
            ? MultiServerManager.getAuthForPage()
            : JellyfinAPI.getStoredAuth();

      if (!auth) {
         window.location.href = "login.html";
         return;
      }

      cacheElements();

      loadSettings();
      displayUserInfo();
      attachEventListeners();
      updateSettingValues();
      applyAccentColor();

      focusToSidebar();
   }

   /**
    * Cache frequently accessed DOM elements for better performance
    * @private
    */
   function cacheElements() {
      elements = {
         username: document.getElementById("username"),
         userAvatar: document.getElementById("userAvatar"),
         homeBtn: document.getElementById("homeBtn"),
         moviesBtn: document.getElementById("moviesBtn"),
         showsBtn: document.getElementById("showsBtn"),
         searchBtn: document.getElementById("searchBtn"),
         settingsBtn: document.getElementById("settingsBtn"),
         settingsSidebar: document.getElementById("settingsSidebar"),
         settingsContent: document.getElementById("settingsContent"),
      };
   }

   /**
    * Update platform information in the About section
    * @private
    */
   function updatePlatformInfo() {
      try {
         if (
            typeof TizenPlatform !== "undefined" &&
            TizenPlatform.getPlatformInfo
         ) {
            var platformInfo = TizenPlatform.getPlatformInfo();

            // Find the platform setting-value elements in the About section
            var aboutPanel = document.getElementById("aboutPanel");
            if (aboutPanel) {
               var settingItems = aboutPanel.querySelectorAll(".setting-item");
               settingItems.forEach(function (item) {
                  var title = item.querySelector(".setting-title");
                  if (title && title.textContent.trim() === "Platform") {
                     var valueElement = item.querySelector(".setting-value");
                     var descElement = item.querySelector(
                        ".setting-description"
                     );
                     if (valueElement) {
                        valueElement.textContent = platformInfo.deviceName;
                     }
                     if (descElement && platformInfo.osVersion !== "Unknown") {
                        descElement.textContent = platformInfo.osVersion;
                     }
                  }
               });
            }
         }
      } catch (e) {
         console.log("[Settings] Error updating platform info:", e);
      }
   }

   /**
    * Display current user information in the UI
    * @private
    */
   function displayUserInfo() {
      // Ensure migration has run
      var totalUsers =
         typeof MultiServerManager !== "undefined"
            ? MultiServerManager.getTotalUserCount()
            : 0;
      if (totalUsers === 0 && auth && auth.serverAddress) {
         // Migration didn't happen yet, trigger it manually
         console.log(
            "[SETTINGS] No servers found, checking for legacy auth..."
         );
         var legacyAuth = storage.get("jellyfin_auth", true);
         if (legacyAuth && legacyAuth.serverAddress && legacyAuth.accessToken) {
            console.log(
               "[SETTINGS] Found legacy auth, adding to MultiServerManager..."
            );
            var serverName = legacyAuth.serverName || "My Server";
            MultiServerManager.addServer(
               legacyAuth.serverAddress,
               serverName,
               legacyAuth.userId,
               legacyAuth.username,
               legacyAuth.accessToken
            );
         }
      }

      // Try to get active server info from MultiServerManager
      var activeServer = MultiServerManager.getActiveServer();
      var displayUsername = activeServer
         ? activeServer.username
         : auth.username;
      var displayServer = activeServer ? activeServer.url : auth.serverAddress;
      var displayAccessToken = activeServer
         ? activeServer.accessToken
         : auth.accessToken;

      if (elements.username) {
         elements.username.textContent = displayUsername;
      }
      if (elements.userAvatar && displayUsername) {
         elements.userAvatar.textContent = displayUsername
            .charAt(0)
            .toUpperCase();
      }

      var usernameValue = document.getElementById("usernameValue");
      if (usernameValue) {
         usernameValue.textContent = displayUsername;
      }

      var serverValue = document.getElementById("serverValue");
      if (serverValue) {
         if (activeServer) {
            serverValue.textContent =
               activeServer.name + " (" + displayServer + ")";
         } else {
            serverValue.textContent = displayServer;
         }
      }

      // Update server count display
      updateServerCountDisplay();

      // Fetch and display server version
      var serverVersionValue = document.getElementById("serverVersionValue");
      if (serverVersionValue && displayServer) {
         // Try authenticated endpoint first, then fall back to public endpoint
         var tryPublicEndpoint = function () {
            JellyfinAPI.getSystemInfo(
               displayServer,
               function (err, data) {
                  if (!err && data && data.Version) {
                     serverVersionValue.textContent = data.Version;
                  } else {
                     serverVersionValue.textContent = "Unknown";
                     console.warn("[Settings] Failed to get server version from public endpoint:", err);
                  }
               }
            );
         };

         if (displayAccessToken) {
            JellyfinAPI.getSystemInfo(
               displayServer,
               displayAccessToken,
               function (err, data) {
                  if (!err && data && data.Version) {
                     serverVersionValue.textContent = data.Version;
                  } else {
                     // Fallback to public endpoint (handles reverse proxy auth issues)
                     console.log("[Settings] Authenticated system info failed, trying public endpoint...");
                     tryPublicEndpoint();
                  }
               }
            );
         } else {
            tryPublicEndpoint();
         }
      }

      // Update platform information in About section
      updatePlatformInfo();

      // Update app version in About section
      var appVersionValue = document.getElementById("appVersionValue");
      if (appVersionValue) {
         appVersionValue.textContent = typeof APP_VERSION !== "undefined" ? APP_VERSION : "1.0.0";
      }
   }

   /**
    * Apply default values for any missing settings
    * @private
    * @param {Object} loadedSettings - Settings object to populate with defaults
    * @returns {boolean} True if settings were modified
    */
   function applyDefaultSettings(loadedSettings) {
      var modified = false;

      // Ensure homeRows exists
      if (!loadedSettings.homeRows) {
         loadedSettings.homeRows = JSON.parse(JSON.stringify(defaultHomeRows));
         modified = true;
      }

      // Apply defaults for all settings
      var defaults = {
         autoLogin: false,
         clockDisplay: "12-hour",
         skipIntro: true,
         autoPlay: true,
         theme: "dark",
         accentColor: "blue",
         carouselSpeed: DEFAULT_CAROUSEL_SPEED_MS,
         showShuffleButton: true,
         showGenresButton: true,
         showFavoritesButton: true,
         showLibrariesInToolbar: true,
         showFeaturedBanner: true,
         featuredMediaFilter: "both",
         imageType: "Primary",
         posterSize: 300,
         preferParentThumb: false,
         mergeContinueWatchingNextUp: false,
         backdropBlurHome: 3,
         backdropBlurDetail: 3,
         serverLogging: true,
      };

      for (var key in defaults) {
         if (typeof loadedSettings[key] === "undefined") {
            loadedSettings[key] = defaults[key];
            modified = true;
         }
      }

      return modified;
   }

   /**
    * Load settings from persistent storage (user-scoped)
    * @private
    */
   function loadSettings() {
      var stored = storage.getUserPreference("jellyfin_settings", null);
      if (stored) {
         try {
            settings = JSON.parse(stored);

            // Apply defaults for any missing settings and save if modified
            if (applyDefaultSettings(settings)) {
               saveSettings();
            }
         } catch (e) {
            settings.homeRows = JSON.parse(JSON.stringify(defaultHomeRows));
         }
      } else {
         settings.homeRows = JSON.parse(JSON.stringify(defaultHomeRows));
         saveSettings();
      }

      // Initialize ImageHelper with settings
      if (typeof ImageHelper !== "undefined") {
         syncImageHelperSettings();
      }

      // Apply accent color on load
      applyAccentColor();
   }

   /**
    * Save current settings to persistent storage (user-scoped)
    * @private
    */
   function saveSettings() {
      storage.setUserPreference("jellyfin_settings", JSON.stringify(settings));
   }

   /**
    * Apply the selected accent color to the page
    * @private
    */
   function applyAccentColor() {
      var root = document.documentElement;
      if (settings.accentColor === "purple") {
         root.style.setProperty("--accent-color", "#6d4aff");
         root.style.setProperty("--accent-color-rgb", "109, 74, 255");
      } else {
         root.style.setProperty("--accent-color", "#007bff");
         root.style.setProperty("--accent-color-rgb", "0, 123, 255");
      }
   }

   /**
    * Update all setting value displays in the UI
    * @private
    */
   function updateSettingValues() {
      // Update theme music setting value
      var playThemeMusicValue = document.getElementById("playThemeMusicValue");
      if (playThemeMusicValue) {
         playThemeMusicValue.textContent = settings.playThemeMusic
            ? "On"
            : "Off";
      }
      var autoLoginValue = document.getElementById("autoLoginValue");
      if (autoLoginValue) {
         autoLoginValue.textContent = settings.autoLogin ? "On" : "Off";
      }

      var clockDisplayValue = document.getElementById("clockDisplayValue");
      if (clockDisplayValue) {
         clockDisplayValue.textContent =
            settings.clockDisplay === "12-hour" ? "12-Hour" : "24-Hour";
      }

      var maxBitrateValue = document.getElementById("maxBitrateValue");
      if (maxBitrateValue) {
         maxBitrateValue.textContent =
            settings.maxBitrate === "auto"
               ? "Auto"
               : settings.maxBitrate + " Mbps";
      }

      var skipIntroValue = document.getElementById("skipIntroValue");
      if (skipIntroValue) {
         skipIntroValue.textContent = settings.skipIntro ? "On" : "Off";
      }

      var autoPlayValue = document.getElementById("autoPlayValue");
      if (autoPlayValue) {
         autoPlayValue.textContent = settings.autoPlay ? "On" : "Off";
      }

      var audioLanguageValue = document.getElementById("audioLanguageValue");
      if (audioLanguageValue) {
         audioLanguageValue.textContent = "English"; // Simplified
      }

      var subtitleLanguageValue = document.getElementById(
         "subtitleLanguageValue"
      );
      if (subtitleLanguageValue) {
         subtitleLanguageValue.textContent =
            settings.subtitleLanguage === "none"
               ? "None"
               : settings.subtitleLanguage;
      }

      var themeValue = document.getElementById("themeValue");
      if (themeValue) {
         themeValue.textContent = settings.theme === "dark" ? "Dark" : "Light";
      }

      var accentColorValue = document.getElementById("accentColorValue");
      if (accentColorValue) {
         accentColorValue.textContent =
            settings.accentColor === "blue" ? "Blue" : "Purple";
      }

      var carouselSpeedValue = document.getElementById("carouselSpeedValue");
      if (carouselSpeedValue) {
         carouselSpeedValue.textContent =
            settings.carouselSpeed / CAROUSEL_SPEED_TO_SECONDS + " seconds";
      }

      // Image Helper settings
      var imageTypeValue = document.getElementById("imageTypeValue");
      if (imageTypeValue) {
         var imageTypeText =
            settings.imageType === "Primary" ? "Poster" : "Thumbnail";
         imageTypeValue.textContent = imageTypeText;
      }

      var mergeContinueWatchingValue = document.getElementById(
         "merge-continue-watching-value"
      );
      if (mergeContinueWatchingValue) {
         mergeContinueWatchingValue.textContent =
            settings.mergeContinueWatchingNextUp ? "On" : "Off";
      }

      // Moonfin settings
      var showShuffleButtonValue = document.getElementById(
         "showShuffleButtonValue"
      );
      if (showShuffleButtonValue) {
         showShuffleButtonValue.textContent = settings.showShuffleButton
            ? "On"
            : "Off";
      }

      var showGenresButtonValue = document.getElementById(
         "showGenresButtonValue"
      );
      if (showGenresButtonValue) {
         showGenresButtonValue.textContent = settings.showGenresButton
            ? "On"
            : "Off";
      }

      var showFavoritesButtonValue = document.getElementById(
         "showFavoritesButtonValue"
      );
      if (showFavoritesButtonValue) {
         showFavoritesButtonValue.textContent = settings.showFavoritesButton
            ? "On"
            : "Off";
      }

      var showLibrariesInToolbarValue = document.getElementById(
         "showLibrariesInToolbarValue"
      );
      if (showLibrariesInToolbarValue) {
         showLibrariesInToolbarValue.textContent =
            settings.showLibrariesInToolbar ? "On" : "Off";
      }

      var showFeaturedBannerValue = document.getElementById(
         "show-featured-banner-value"
      );
      if (showFeaturedBannerValue) {
         showFeaturedBannerValue.textContent = settings.showFeaturedBanner
            ? "On"
            : "Off";
      }

      var featuredMediaFilterValue = document.getElementById(
         "featured-media-filter-value"
      );
      if (featuredMediaFilterValue) {
         var filterText = "Both";
         if (settings.featuredMediaFilter === "movies") {
            filterText = "Movies Only";
         } else if (settings.featuredMediaFilter === "tv") {
            filterText = "TV Shows Only";
         }
         featuredMediaFilterValue.textContent = filterText;
      }

      // Backdrop blur settings
      var backdropBlurHomeValue = document.getElementById(
         "backdrop-blur-home-value"
      );
      if (backdropBlurHomeValue) {
         backdropBlurHomeValue.textContent =
            settings.backdropBlurHome !== undefined
               ? settings.backdropBlurHome
               : 3;
      }

      var backdropBlurDetailValue = document.getElementById(
         "backdrop-blur-detail-value"
      );
      if (backdropBlurDetailValue) {
         backdropBlurDetailValue.textContent =
            settings.backdropBlurDetail !== undefined
               ? settings.backdropBlurDetail
               : 3;
      }

      // Server logging setting
      var serverLoggingValue = document.getElementById("serverLoggingValue");
      if (serverLoggingValue) {
         serverLoggingValue.textContent = settings.serverLogging ? "On" : "Off";
      }

      // Jellyseerr settings
      updateJellyseerrSettingValues();
   }

   /**
    * Update Jellyseerr-specific setting values
    * @private
    */
   function updateJellyseerrSettingValues() {
      var jellyseerrEnabledValue = document.getElementById(
         "jellyseerrEnabledValue"
      );
      if (jellyseerrEnabledValue) {
         jellyseerrEnabledValue.textContent = settings.jellyseerrEnabled
            ? "On"
            : "Off";
      }

      var jellyseerrUrlValue = document.getElementById("jellyseerrUrlValue");
      if (jellyseerrUrlValue) {
         jellyseerrUrlValue.textContent = settings.jellyseerrUrl || "Not Set";
      }

      var jellyseerrApiKeyValue = document.getElementById(
         "jellyseerrApiKeyValue"
      );
      if (jellyseerrApiKeyValue) {
         if (
            settings.jellyseerrApiKey &&
            settings.jellyseerrApiKey.length > 0
         ) {
            // Show masked API key
            jellyseerrApiKeyValue.textContent =
               "••••••••" + settings.jellyseerrApiKey.slice(-4);
         } else {
            jellyseerrApiKeyValue.textContent = "Not Set";
         }
      }

      var jellyseerrFilterNSFWValue = document.getElementById(
         "jellyseerrFilterNSFWValue"
      );
      if (jellyseerrFilterNSFWValue) {
         jellyseerrFilterNSFWValue.textContent = settings.jellyseerrFilterNSFW
            ? "On"
            : "Off";
      }
   }

   function attachEventListeners() {
      document.addEventListener("keydown", handleKeyDown);

      if (elements.homeBtn) {
         elements.homeBtn.addEventListener("click", function () {
            window.location.href = "browse.html";
         });
      }

      var categories = document.querySelectorAll(".settings-category");
      categories.forEach(function (cat, index) {
         cat.addEventListener("click", function () {
            selectCategory(index);
         });
      });

      var settingItems = document.querySelectorAll(
         ".setting-item:not(.non-interactive)"
      );
      settingItems.forEach(function (item) {
         item.addEventListener("click", function () {
            handleSettingActivation(item);
         });
      });

      // Alert modal OK button
      var alertOkBtn = document.getElementById("alertOkBtn");
      if (alertOkBtn) {
         alertOkBtn.addEventListener("click", closeAlert);
      }
   }

   /**
    * ModalManager - Handles modal display, event management, and cleanup
    * @class
    */
   var ModalManager = {
      /**
       * Show a modal with inputs and buttons
       * @param {Object} config - Modal configuration
       * @param {string} config.modalId - Modal element ID
       * @param {string[]} config.inputIds - Input element IDs
       * @param {string[]} config.buttonIds - Button element IDs (save, cancel)
       * @param {Function} config.onSave - Save handler function
       * @param {Function} config.onCancel - Cancel handler function
       * @param {string} [config.focusTarget] - ID of element to focus (defaults to first input)
       * @param {string} [config.focusReturn] - Selector for element to focus when closing
       * @param {boolean} [config.clearInputs] - Whether to clear input values (default: true)
       */
      show: function (config) {
         var modal = document.getElementById(config.modalId);
         if (!modal) return;

         // Get all elements
         var inputs = config.inputIds
            .map(function (id) {
               return document.getElementById(id);
            })
            .filter(function (el) {
               return el !== null;
            });

         var buttons = config.buttonIds
            .map(function (id) {
               return document.getElementById(id);
            })
            .filter(function (el) {
               return el !== null;
            });

         // Clear input values only if requested (default true for backward compatibility)
         if (config.clearInputs !== false) {
            inputs.forEach(function (input) {
               input.value = "";
            });
         }

         // Show modal
         modal.style.display = "flex";

         // Create handlers
         var saveHandler = function () {
            config.onSave(inputs);
         };

         var cancelHandler = function () {
            config.onCancel();
         };

         var enterHandler = function (e) {
            if (e.keyCode === KeyCodes.ENTER) {
               saveHandler();
            }
         };

         // Add event listeners
         if (buttons[0]) buttons[0].addEventListener("click", saveHandler);
         if (buttons[1]) buttons[1].addEventListener("click", cancelHandler);
         inputs.forEach(function (input) {
            input.addEventListener("keydown", enterHandler);
         });

         // Store handlers for cleanup
         modal._saveHandler = saveHandler;
         modal._cancelHandler = cancelHandler;
         modal._enterHandler = enterHandler;
         modal._config = config;

         // Focus
         setTimeout(function () {
            var focusElement = config.focusTarget
               ? document.getElementById(config.focusTarget)
               : inputs[0];
            if (focusElement) focusElement.focus();
         }, 100);
      },

      /**
       * Close a modal and cleanup event listeners
       * @param {string} modalId - Modal element ID
       */
      close: function (modalId) {
         var modal = document.getElementById(modalId);
         if (!modal) return;

         var config = modal._config;
         if (!config) {
            modal.style.display = "none";
            return;
         }

         // Get elements
         var inputs = config.inputIds
            .map(function (id) {
               return document.getElementById(id);
            })
            .filter(function (el) {
               return el !== null;
            });

         var buttons = config.buttonIds
            .map(function (id) {
               return document.getElementById(id);
            })
            .filter(function (el) {
               return el !== null;
            });

         // Remove event listeners
         if (modal._saveHandler && buttons[0]) {
            buttons[0].removeEventListener("click", modal._saveHandler);
         }
         if (modal._cancelHandler && buttons[1]) {
            buttons[1].removeEventListener("click", modal._cancelHandler);
         }
         if (modal._enterHandler) {
            inputs.forEach(function (input) {
               input.removeEventListener("keydown", modal._enterHandler);
            });
         }

         // Cleanup
         delete modal._saveHandler;
         delete modal._cancelHandler;
         delete modal._enterHandler;
         delete modal._config;

         // Hide modal
         modal.style.display = "none";

         // Return focus
         if (config.focusReturn) {
            var returnElement = document.querySelector(config.focusReturn);
            if (returnElement) {
               setTimeout(function () {
                  returnElement.focus();
               }, 100);
            }
         }
      },
   };

   // Modal configuration registry
   var modalConfigs = {
      alert: {
         modalId: "customAlertModal",
         closeHandler: closeAlert,
         fieldIds: ["alertOkBtn"],
         simpleMode: true, // Only BACK/ENTER to close
      },
      jellyseerrUrl: {
         modalId: "jellyseerrUrlModal",
         closeHandler: closeJellyseerrUrlModal,
         fieldIds: [
            "jellyseerrUrlInput",
            "saveJellyseerrUrlBtn",
            "cancelJellyseerrUrlBtn",
         ],
      },
      jellyseerrApiKey: {
         modalId: "jellyseerrApiKeyModal",
         closeHandler: closeJellyseerrApiKeyModal,
         fieldIds: [
            "jellyseerrApiKeyInput",
            "saveJellyseerrApiKeyBtn",
            "cancelJellyseerrApiKeyBtn",
         ],
      },
      jellyseerrJellyfinAuth: {
         modalId: "jellyseerrJellyfinAuthModal",
         closeHandler: closeJellyseerrJellyfinAuthModal,
         fieldIds: [
            "jellyseerrJellyfinAuthPasswordInput",
            "saveJellyseerrJellyfinAuthBtn",
            "cancelJellyseerrJellyfinAuthBtn",
         ],
      },
      jellyseerrLocal: {
         modalId: "jellyseerrLocalModal",
         closeHandler: closeJellyseerrLocalModal,
         fieldIds: [
            "jellyseerrEmailInput",
            "jellyseerrLocalPasswordInput",
            "saveJellyseerrLocalBtn",
            "cancelJellyseerrLocalBtn",
         ],
      },
   };

   /**
    * Generic modal keyboard handler
    * @param {KeyboardEvent} evt - Keyboard event
    * @param {Object} config - Modal configuration
    * @returns {boolean} True if modal was handled
    * @private
    */
   function handleGenericModal(evt, config) {
      var modal = document.getElementById(config.modalId);
      if (!modal || modal.style.display !== "flex") {
         return false; // Modal not open
      }

      // Handle BACK key
      if (evt.keyCode === KeyCodes.BACK) {
         evt.preventDefault();
         config.closeHandler();
         return true;
      }

      // For simple modals (like alert), also close on ENTER
      if (config.simpleMode && evt.keyCode === KeyCodes.ENTER) {
         evt.preventDefault();
         config.closeHandler();
         return true;
      }

      // Handle ENTER on buttons
      if (evt.keyCode === KeyCodes.ENTER) {
         var activeElement = document.activeElement;
         if (activeElement && activeElement.tagName === "BUTTON") {
            evt.preventDefault();
            activeElement.click();
            return true;
         }
      }

      // Get modal fields and handle navigation
      var fields = config.fieldIds
         .map(function (id) {
            return document.getElementById(id);
         })
         .filter(function (el) {
            return el !== null;
         });

      return handleModalFieldNavigation(evt, fields);
   }

   function handleKeyDown(evt) {
      evt = evt || window.event;

      // Check all generic modals
      for (var key in modalConfigs) {
         if (handleGenericModal(evt, modalConfigs[key])) {
            return;
         }
      }

      // Check if modal is open
      if (homeRowsModal.isOpen) {
         handleHomeRowsModalNavigation(evt);
         return;
      }

      if (evt.keyCode === KeyCodes.BACK) {
         evt.preventDefault();
         window.location.href = "browse.html";
         return;
      }

      if (focusManager.inNavBar) {
         handleNavBarNavigation(evt);
      } else if (focusManager.inSidebar) {
         handleSidebarNavigation(evt);
      } else {
         handleContentNavigation(evt);
      }
   }

   /**
    * Get all navbar button elements
    * @returns {HTMLElement[]} Array of navbar button elements
    * @private
    */
   function getNavButtons() {
      return Array.from(
         document.querySelectorAll(".nav-left .nav-btn, .nav-center .nav-btn")
      ).filter(function (btn) {
         return btn.offsetParent !== null; // Only include visible buttons
      });
   }

   /**
    * Get all settings category elements
    * @returns {NodeList} NodeList of category elements
    * @private
    */
   function getCategories() {
      return document.querySelectorAll(".settings-category");
   }

   /**
    * Get all settings category elements as array
    * @returns {HTMLElement[]} Array of category elements
    * @private
    */
   function getCategoriesArray() {
      return Array.from(getCategories());
   }

   /**
    * Handle keyboard navigation within navbar
    * @param {KeyboardEvent} evt - Keyboard event
    * @private
    */
   function handleNavBarNavigation(evt) {
      var navButtons = getNavButtons();

      navButtons.forEach(function (btn) {
         btn.classList.remove("focused");
      });

      switch (evt.keyCode) {
         case KeyCodes.LEFT: // Left
            evt.preventDefault();
            if (focusManager.navBarIndex > 0) {
               focusManager.navBarIndex--;
            }
            navButtons[focusManager.navBarIndex].classList.add("focused");
            navButtons[focusManager.navBarIndex].focus();
            break;

         case KeyCodes.RIGHT: // Right
            evt.preventDefault();
            if (focusManager.navBarIndex < navButtons.length - 1) {
               focusManager.navBarIndex++;
            }
            navButtons[focusManager.navBarIndex].classList.add("focused");
            navButtons[focusManager.navBarIndex].focus();
            break;

         case KeyCodes.DOWN: // Down
            evt.preventDefault();
            focusToSidebar();
            break;

         case KeyCodes.ENTER: // Enter
            evt.preventDefault();
            var currentBtn = navButtons[focusManager.navBarIndex];
            if (currentBtn) {
               currentBtn.click();
            }
            break;
      }
   }

   /**
    * Handle keyboard navigation within settings sidebar
    * @param {KeyboardEvent} evt - Keyboard event
    * @private
    */
   function handleSidebarNavigation(evt) {
      var categories = getCategoriesArray();

      switch (evt.keyCode) {
         case KeyCodes.UP: // Up
            evt.preventDefault();
            if (focusManager.sidebarIndex > 0) {
               focusManager.sidebarIndex--;
               selectCategory(focusManager.sidebarIndex);
            } else {
               focusToNavBar();
            }
            break;

         case KeyCodes.DOWN: // Down
            evt.preventDefault();
            if (focusManager.sidebarIndex < categories.length - 1) {
               focusManager.sidebarIndex++;
               selectCategory(focusManager.sidebarIndex);
            }
            break;

         case KeyCodes.RIGHT: // Right
            evt.preventDefault();
            focusToContent();
            break;

         case KeyCodes.ENTER: // Enter
            evt.preventDefault();
            selectCategory(focusManager.sidebarIndex);
            focusToContent();
            break;
      }
   }

   /**
    * Handle keyboard navigation within settings content area
    * @param {KeyboardEvent} evt - Keyboard event
    * @private
    */
   function handleContentNavigation(evt) {
      // If in slider mode, handle slider navigation
      if (focusManager.inSliderMode) {
         handleSliderNavigation(evt);
         return;
      }

      var panel = document.querySelector(".settings-panel.active");
      if (!panel) return;

      var items = Array.from(
         panel.querySelectorAll(".setting-item:not(.non-interactive)")
      );
      if (items.length === 0) return;

      switch (evt.keyCode) {
         case KeyCodes.UP: // Up
            evt.preventDefault();
            if (focusManager.contentIndex > 0) {
               focusManager.contentIndex--;
               updateContentFocus(items);
            }
            break;

         case KeyCodes.DOWN: // Down
            evt.preventDefault();
            if (focusManager.contentIndex < items.length - 1) {
               focusManager.contentIndex++;
               updateContentFocus(items);
            }
            break;

         case KeyCodes.LEFT: // Left
            evt.preventDefault();
            focusToSidebar();
            break;

         case KeyCodes.ENTER: // Enter
            evt.preventDefault();
            handleSettingActivation(items[focusManager.contentIndex]);
            break;
      }
   }

   function focusToNavBar() {
      focusManager.inNavBar = true;
      focusManager.inSidebar = false;

      var navButtons = getNavButtons();
      navButtons.forEach(function (btn) {
         btn.classList.remove("focused");
      });

      // Start at home button (index 1), not user avatar (index 0)
      if (
         focusManager.navBarIndex === 0 ||
         focusManager.navBarIndex >= navButtons.length
      ) {
         focusManager.navBarIndex = navButtons.length > 1 ? 1 : 0;
      }

      if (navButtons[focusManager.navBarIndex]) {
         navButtons[focusManager.navBarIndex].classList.add("focused");
         navButtons[focusManager.navBarIndex].focus();
      }

      var categories = getCategories();
      categories.forEach(function (cat) {
         cat.classList.remove("focused");
      });

      var items = document.querySelectorAll(".setting-item");
      items.forEach(function (item) {
         item.classList.remove("focused");
      });
   }

   function focusToSidebar() {
      focusManager.inSidebar = true;
      focusManager.inNavBar = false;
      updateSidebarFocus();

      var navButtons = document.querySelectorAll(".nav-btn");
      navButtons.forEach(function (btn) {
         btn.classList.remove("focused");
      });

      var items = document.querySelectorAll(".setting-item");
      items.forEach(function (item) {
         item.classList.remove("focused");
      });
   }

   function focusToContent() {
      focusManager.inSidebar = false;
      focusManager.inNavBar = false;
      focusManager.contentIndex = 0;

      var panel = document.querySelector(".settings-panel.active");
      if (!panel) return;

      var items = Array.from(
         panel.querySelectorAll(".setting-item:not(.non-interactive)")
      );
      updateContentFocus(items);

      var categories = getCategories();
      categories.forEach(function (cat) {
         cat.classList.remove("focused");
      });
   }

   function updateSidebarFocus() {
      var categories = getCategories();
      categories.forEach(function (cat, index) {
         if (index === focusManager.sidebarIndex) {
            cat.classList.add("focused");
            cat.scrollIntoView({ behavior: "smooth", block: "nearest" });
         } else {
            cat.classList.remove("focused");
         }
      });
   }

   function updateContentFocus(items) {
      items.forEach(function (item, index) {
         if (index === focusManager.contentIndex) {
            item.classList.add("focused");
            item.scrollIntoView({ behavior: "smooth", block: "nearest" });
         } else {
            item.classList.remove("focused");
         }
      });
   }

   /**
    * Select and display a settings category
    * @param {number} index - Index of category to select
    * @private
    */
   function selectCategory(index) {
      focusManager.sidebarIndex = index;
      focusManager.contentIndex = 0;

      var categories = getCategoriesArray();
      var category = categories[index];
      if (!category) return;

      var categoryName = category.dataset.category;
      focusManager.currentCategory = categoryName;

      var panels = document.querySelectorAll(".settings-panel");
      panels.forEach(function (panel) {
         panel.classList.remove("active");
      });

      var panel = document.getElementById(categoryName + "Panel");
      if (panel) {
         panel.classList.add("active");
      }

      updateSidebarFocus();
   }

   /**
    * Handle activation of a setting item
    * @param {HTMLElement} item - Setting item element
    * @private
    */
   function handleSettingActivation(item) {
      var settingName = item.dataset.setting;

      switch (settingName) {
         case "playThemeMusic":
            // Toggle theme music setting
            settings.playThemeMusic = !settings.playThemeMusic;
            saveSettings();
            updateSettingValues();
            if (typeof ThemeMusicPlayer !== "undefined") {
               ThemeMusicPlayer.setEnabled(settings.playThemeMusic);
            }
            break;
         case "homeSections":
            openHomeRowsModal();
            break;

         case "autoLogin":
            settings.autoLogin = !settings.autoLogin;
            saveSettings();
            updateSettingValues();

            var message = settings.autoLogin
               ? "Auto-login enabled. You will be automatically logged in on app start."
               : "Auto-login disabled. You will need to login manually.";
            break;

         case "clockDisplay":
            // Toggle between 12-hour and 24-hour format
            settings.clockDisplay =
               settings.clockDisplay === "12-hour" ? "24-hour" : "12-hour";
            saveSettings();
            updateSettingValues();
            // Update clock immediately
            if (
               typeof NavbarController !== "undefined" &&
               NavbarController.updateClock
            ) {
               NavbarController.updateClock();
            }
            break;

         case "skipIntro":
            settings.skipIntro = !settings.skipIntro;
            saveSettings();
            updateSettingValues();
            break;

         case "autoPlay":
            settings.autoPlay = !settings.autoPlay;
            saveSettings();
            updateSettingValues();
            break;

         case "showShuffleButton":
            settings.showShuffleButton = !settings.showShuffleButton;
            saveSettings();
            updateSettingValues();
            applyToolbarSettingsLive();
            break;

         case "showGenresButton":
            settings.showGenresButton = !settings.showGenresButton;
            saveSettings();
            updateSettingValues();
            applyToolbarSettingsLive();
            break;

         case "showFavoritesButton":
            settings.showFavoritesButton = !settings.showFavoritesButton;
            saveSettings();
            updateSettingValues();
            applyToolbarSettingsLive();
            break;

         case "showLibrariesInToolbar":
            settings.showLibrariesInToolbar = !settings.showLibrariesInToolbar;
            saveSettings();
            updateSettingValues();
            applyToolbarSettingsLive();
            break;

         case "theme":
            // Theme switching not implemented yet
            break;

         case "accentColor":
            settings.accentColor =
               settings.accentColor === "blue" ? "purple" : "blue";
            saveSettings();
            applyAccentColor();
            updateSettingValues();
            break;

         case "carouselSpeed":
            // Cycle through speeds: 5s, 8s, 10s, 15s, 20s
            var speeds = [5000, 8000, 10000, 15000, 20000];
            var currentIndex = speeds.indexOf(settings.carouselSpeed);
            var nextIndex = (currentIndex + 1) % speeds.length;
            settings.carouselSpeed = speeds[nextIndex];
            saveSettings();
            updateSettingValues();
            break;

         case "jellyseerrEnabled":
            settings.jellyseerrEnabled = !settings.jellyseerrEnabled;
            saveSettings();
            updateSettingValues();
            if (settings.jellyseerrEnabled && settings.jellyseerrUrl) {
               initializeJellyseerr();
            }
            // Update navbar to show/hide Jellyseerr buttons
            applyToolbarSettingsLive();
            if (
               typeof NavbarController !== "undefined" &&
               NavbarController.checkJellyseerrAvailability
            ) {
               NavbarController.checkJellyseerrAvailability();
            }
            break;

         case "jellyseerrUrl":
            promptJellyseerrUrl();
            break;

         case "jellyseerrApiKey":
            promptJellyseerrApiKey();
            break;

         case "jellyseerrAuthJellyfin":
            handleJellyseerrAuthJellyfin();
            break;

         case "jellyseerrAuthLocal":
            handleJellyseerrAuthLocal();
            break;

         case "testJellyseerrConnection":
            testJellyseerrConnection();
            break;

         case "imageType":
            // Toggle between: Primary <-> Thumb
            if (settings.imageType === "Primary") {
               settings.imageType = "Thumb";
            } else {
               settings.imageType = "Primary";
            }
            // Always keep posterSize at maximum (300)
            settings.posterSize = 300;
            saveSettings();
            updateSettingValues();
            syncImageHelperSettings();
            break;

         case "merge-continue-watching":
            settings.mergeContinueWatchingNextUp =
               !settings.mergeContinueWatchingNextUp;
            saveSettings();
            updateSettingValues();
            break;

         case "jellyseerrShowDiscover":
            settings.jellyseerrShowDiscover = !settings.jellyseerrShowDiscover;
            saveSettings();
            updateSettingValues();
            break;

         case "show-featured-banner":
            settings.showFeaturedBanner = !settings.showFeaturedBanner;
            saveSettings();
            updateSettingValues();
            break;

         case "featured-media-filter":
            // Cycle through: both -> movies -> tv -> both
            if (settings.featuredMediaFilter === "both") {
               settings.featuredMediaFilter = "movies";
            } else if (settings.featuredMediaFilter === "movies") {
               settings.featuredMediaFilter = "tv";
            } else {
               settings.featuredMediaFilter = "both";
            }
            saveSettings();
            updateSettingValues();
            break;

         case "jellyseerrFilterNSFW":
            settings.jellyseerrFilterNSFW = !settings.jellyseerrFilterNSFW;
            saveSettings();
            updateSettingValues();
            break;

         case "backdrop-blur-home":
            enterSliderMode("backdrop-blur-home", settings.backdropBlurHome);
            break;

         case "backdrop-blur-detail":
            enterSliderMode(
               "backdrop-blur-detail",
               settings.backdropBlurDetail
            );
            break;

         case "clearJellyseerrCache":
            clearJellyseerrCache();
            break;

         case "disconnectJellyseerr":
            disconnectJellyseerr();
            break;

         case "serverLogging":
            settings.serverLogging = !settings.serverLogging;
            saveSettings();
            updateSettingValues();
            if (typeof ServerLogger !== "undefined") {
               ServerLogger.setEnabled(settings.serverLogging);
               if (settings.serverLogging) {
                  ServerLogger.logAppInfo(
                     "Server logging enabled from settings",
                     { source: "settings" }
                  );
               }
            }
            break;

         case "sendTestLog":
            console.log("[Settings] Test log button pressed, serverLogging:", settings.serverLogging);
            if (typeof ServerLogger !== "undefined" && settings.serverLogging) {
               // Check if auth is available first
               var testAuth = null;
               if (typeof MultiServerManager !== "undefined" && MultiServerManager.getAuthForPage) {
                  testAuth = MultiServerManager.getAuthForPage();
               } else if (typeof JellyfinAPI !== "undefined" && JellyfinAPI.getStoredAuth) {
                  testAuth = JellyfinAPI.getStoredAuth();
               }

               if (!testAuth || !testAuth.accessToken) {
                  console.log("[Settings] No auth available for test log");
                  showAlert("Not logged in. Please log in first to send test logs.", "Error");
                  break;
               }

               console.log("[Settings] Sending test log to server:", testAuth.serverAddress);
               ServerLogger.logAppInfo("Test log from Moonfin settings", {
                  test: true,
                  timestamp: new Date().toISOString(),
                  appVersion: typeof APP_VERSION !== "undefined" ? APP_VERSION : "unknown",
                  serverAddress: testAuth.serverAddress
               });
               showAlert(
                  "Test log sent to your Jellyfin server (" + testAuth.serverAddress + "). Check Dashboard > Logs to verify.",
                  "Success"
               );
            } else if (!settings.serverLogging) {
               console.log("[Settings] Server logging is disabled");
               showAlert("Please enable server logging first.", "Info");
            } else {
               console.log("[Settings] ServerLogger is not available");
               showAlert("Server logger is not available.", "Error");
            }
            break;

         case "logout":
            handleLogout();
            break;

         case "manageServers":
            openServerManager();
            break;

         default:
      }
   }

   /**
    * Augment home rows with per-server variants when in multi-server mode
    * @param {Array} baseRows - Base home rows configuration
    * @returns {Array} Same rows (aggregation happens at render time with Android TV pattern)
    * @private
    */
   function augmentRowsForMultiServer(baseRows) {
      // With the new aggregated approach (Android TV pattern),
      // we no longer need to split rows per-server in settings UI.
      // A single "Continue Watching" row aggregates items from ALL servers.
      // A single "Next Up" row aggregates items from ALL servers.
      // Latest media rows show libraries with server names appended when needed.
      return baseRows;
   }

   /**
    * Open the Home Rows configuration modal
    * @private
    */
   function openHomeRowsModal() {
      var modal = document.getElementById("homeRowsModal");
      if (!modal) return;

      // Load base rows from settings
      var baseRows = JSON.parse(JSON.stringify(settings.homeRows));
      console.log(
         "[settings] Base home rows:",
         baseRows
            .map(function (r) {
               return (
                  r.id + " (order: " + r.order + ", enabled: " + r.enabled + ")"
               );
            })
            .join(", ")
      );

      // Augment with per-server rows if in multi-server mode
      homeRowsModal.rows = augmentRowsForMultiServer(baseRows);
      console.log(
         "[settings] Augmented home rows for modal:",
         homeRowsModal.rows
            .map(function (r) {
               return (
                  r.id + " (order: " + r.order + ", enabled: " + r.enabled + ")"
               );
            })
            .join(", ")
      );
      homeRowsModal.isOpen = true;
      homeRowsModal.focusedIndex = 0;

      renderHomeRowsList();
      modal.style.display = "flex";

      // Setup modal event listeners with cleanup support
      var saveBtn = document.getElementById("saveRowsBtn");
      var cancelBtn = document.getElementById("cancelRowsBtn");
      var resetBtn = document.getElementById("resetRowsBtn");

      if (saveBtn) {
         homeRowsModal.saveHandler = saveHomeRows;
         saveBtn.addEventListener("click", homeRowsModal.saveHandler);
      }
      if (cancelBtn) {
         homeRowsModal.cancelHandler = closeHomeRowsModal;
         cancelBtn.addEventListener("click", homeRowsModal.cancelHandler);
      }
      if (resetBtn) {
         homeRowsModal.resetHandler = resetHomeRows;
         resetBtn.addEventListener("click", homeRowsModal.resetHandler);
      }

      // Focus first item
      setTimeout(function () {
         updateHomeRowsFocus();
      }, 100);
   }

   /**
    * Render the home rows list in the modal
    * @private
    */
   function renderHomeRowsList() {
      var list = document.getElementById("homeRowsList");
      if (!list) return;

      list.innerHTML = "";

      // Sort by order
      homeRowsModal.rows.sort(function (a, b) {
         return a.order - b.order;
      });

      homeRowsModal.rows.forEach(function (row, index) {
         var rowDiv = document.createElement("div");
         rowDiv.className = "home-row-item";
         rowDiv.dataset.rowId = row.id;
         rowDiv.dataset.index = index;
         rowDiv.tabIndex = 0;

         var checkbox = document.createElement("div");
         checkbox.className = "row-checkbox " + (row.enabled ? "checked" : "");
         if (row.enabled) {
            checkbox.innerHTML =
               '<img src="assets/icons/check.png" alt="" class="checkbox-icon">';
         }

         var name = document.createElement("div");
         name.className = "row-name";
         name.textContent = row.name;

         var controls = document.createElement("div");
         controls.className = "row-controls";

         var upBtn = document.createElement("button");
         upBtn.className = "row-btn";
         upBtn.textContent = "▲";
         upBtn.disabled = index === 0;
         upBtn.onclick = function (e) {
            e.stopPropagation();
            moveRowUp(index);
         };

         var downBtn = document.createElement("button");
         downBtn.className = "row-btn";
         downBtn.textContent = "▼";
         downBtn.disabled = index === homeRowsModal.rows.length - 1;
         downBtn.onclick = function (e) {
            e.stopPropagation();
            moveRowDown(index);
         };

         controls.appendChild(upBtn);
         controls.appendChild(downBtn);

         rowDiv.appendChild(checkbox);
         rowDiv.appendChild(name);
         rowDiv.appendChild(controls);

         rowDiv.onclick = function () {
            toggleRowEnabled(index);
         };

         list.appendChild(rowDiv);
      });
   }

   /**
    * Toggle a row's enabled state
    * @param {number} index - Row index
    * @private
    */
   function toggleRowEnabled(index) {
      var row = homeRowsModal.rows[index];
      row.enabled = !row.enabled;

      // If this is a per-server row, update the corresponding base row too
      if (row.baseId) {
         var baseRow = homeRowsModal.rows.find(function (r) {
            return r.id === row.baseId && !r.serverId;
         });
         if (baseRow) {
            baseRow.enabled = row.enabled;
         }
      }
      // If this is a base row with server variants, update all variants
      else if (!row.serverId) {
         homeRowsModal.rows.forEach(function (r) {
            if (r.baseId === row.id) {
               r.enabled = row.enabled;
            }
         });
      }

      renderHomeRowsList();
      updateHomeRowsFocus();
   }

   /**
    * Move a row up in the order
    * @param {number} index - Row index
    * @private
    */
   function moveRowUp(index) {
      if (index === 0) return;

      var temp = homeRowsModal.rows[index];
      homeRowsModal.rows[index] = homeRowsModal.rows[index - 1];
      homeRowsModal.rows[index - 1] = temp;

      // Update order values
      homeRowsModal.rows.forEach(function (row, i) {
         row.order = i;
      });

      homeRowsModal.focusedIndex = index - 1;
      renderHomeRowsList();
      updateHomeRowsFocus();
   }

   /**
    * Move a row down in the order
    * @param {number} index - Row index
    * @private
    */
   function moveRowDown(index) {
      if (index >= homeRowsModal.rows.length - 1) return;

      var temp = homeRowsModal.rows[index];
      homeRowsModal.rows[index] = homeRowsModal.rows[index + 1];
      homeRowsModal.rows[index + 1] = temp;

      // Update order values
      homeRowsModal.rows.forEach(function (row, i) {
         row.order = i;
      });

      homeRowsModal.focusedIndex = index + 1;
      renderHomeRowsList();
      updateHomeRowsFocus();
   }

   /**
    * Update focus in home rows list
    * @private
    */
   function updateHomeRowsFocus() {
      var items = document.querySelectorAll(".home-row-item");
      items.forEach(function (item, index) {
         if (index === homeRowsModal.focusedIndex) {
            item.classList.add("focused");
            item.scrollIntoView({ behavior: "smooth", block: "nearest" });
         } else {
            item.classList.remove("focused");
         }
      });
   }

   /**
    * Save home rows configuration
    * @private
    */
   function saveHomeRows() {
      // Extract only base rows (rows without serverId or baseId)
      // Per-server rows will be regenerated at load time
      var rowsToSave = homeRowsModal.rows.filter(function (row) {
         // Keep rows that don't have a serverId or baseId (these are base rows)
         return !row.serverId && !row.baseId;
      });

      // Sort by current order to maintain relative positioning
      rowsToSave.sort(function (a, b) {
         return a.order - b.order;
      });

      // DON'T renumber - preserve the order values to maintain groupings
      // (e.g., all latest-* rows should stay at order 2 to alphabetize together)

      // Clean up any orphaned server-specific metadata
      rowsToSave = rowsToSave.map(function (row) {
         var cleanRow = JSON.parse(JSON.stringify(row));
         delete cleanRow.serverName;
         delete cleanRow.serverId;
         delete cleanRow.baseId;
         return cleanRow;
      });

      // Remove rows for servers that no longer exist
      if (typeof MultiServerManager !== "undefined") {
         var validServerIds = {};
         MultiServerManager.getAllServersArray().forEach(function (server) {
            validServerIds[server.serverId] = true;
         });

         rowsToSave = rowsToSave.filter(function (row) {
            if (row.serverId) {
               return validServerIds[row.serverId];
            }
            return true;
         });
      }

      console.log(
         "[settings] Saving base home rows:",
         rowsToSave
            .map(function (r) {
               return (
                  r.id + " (order: " + r.order + ", enabled: " + r.enabled + ")"
               );
            })
            .join(", ")
      );
      settings.homeRows = rowsToSave;
      saveSettings();
      closeHomeRowsModal();
   }

   /**
    * Reset home rows to defaults
    * @private
    */
   function resetHomeRows() {
      // Reset to defaults and save immediately
      settings.homeRows = JSON.parse(JSON.stringify(defaultHomeRows));
      saveSettings();
      console.log(
         "[settings] Home rows reset to defaults:",
         settings.homeRows
            .map(function (r) {
               return r.id + " (order: " + r.order + ")";
            })
            .join(", ")
      );

      // Update modal display with augmented rows
      homeRowsModal.rows = augmentRowsForMultiServer(
         JSON.parse(JSON.stringify(settings.homeRows))
      );
      homeRowsModal.focusedIndex = 0;
      renderHomeRowsList();
      updateHomeRowsFocus();
   }

   /**
    * Close the home rows modal
    * Cleans up event listeners to prevent memory leaks
    * @private
    */
   function closeHomeRowsModal() {
      var modal = document.getElementById("homeRowsModal");
      if (modal) {
         modal.style.display = "none";
      }

      // Remove event listeners to prevent memory leaks
      var saveBtn = document.getElementById("saveRowsBtn");
      var cancelBtn = document.getElementById("cancelRowsBtn");
      var resetBtn = document.getElementById("resetRowsBtn");

      if (saveBtn && homeRowsModal.saveHandler) {
         saveBtn.removeEventListener("click", homeRowsModal.saveHandler);
      }
      if (cancelBtn && homeRowsModal.cancelHandler) {
         cancelBtn.removeEventListener("click", homeRowsModal.cancelHandler);
      }
      if (resetBtn && homeRowsModal.resetHandler) {
         resetBtn.removeEventListener("click", homeRowsModal.resetHandler);
      }

      // Clear handler references
      homeRowsModal.saveHandler = null;
      homeRowsModal.cancelHandler = null;
      homeRowsModal.resetHandler = null;

      homeRowsModal.isOpen = false;
      focusToContent();
   }

   /**
    * Handle keyboard navigation in home rows modal
    * @param {KeyboardEvent} evt - Keyboard event
    * @private
    */
   function handleHomeRowsModalNavigation(evt) {
      var items = document.querySelectorAll(".home-row-item");
      var buttons = document.querySelectorAll(
         "#homeRowsModal .modal-actions button"
      );
      var totalItems = items.length;
      var activeElement = document.activeElement;

      // Check if a button is currently focused
      var buttonFocused = false;
      var currentButtonIndex = -1;
      buttons.forEach(function (btn, index) {
         if (btn === activeElement) {
            buttonFocused = true;
            currentButtonIndex = index;
         }
      });

      if (buttonFocused) {
         // Handle navigation when a button is focused
         switch (evt.keyCode) {
            case KeyCodes.UP:
               evt.preventDefault();
               // Go back to the list (last item)
               homeRowsModal.focusedIndex = totalItems - 1;
               updateHomeRowsFocus();
               break;

            case KeyCodes.LEFT:
               evt.preventDefault();
               // Move to previous button
               if (currentButtonIndex > 0) {
                  buttons[currentButtonIndex - 1].focus();
               }
               break;

            case KeyCodes.RIGHT:
               evt.preventDefault();
               // Move to next button
               if (currentButtonIndex < buttons.length - 1) {
                  buttons[currentButtonIndex + 1].focus();
               }
               break;

            case KeyCodes.BACK:
               evt.preventDefault();
               closeHomeRowsModal();
               break;
         }
      } else {
         // Handle navigation when a list item is focused
         switch (evt.keyCode) {
            case KeyCodes.UP:
               evt.preventDefault();
               if (homeRowsModal.focusedIndex > 0) {
                  homeRowsModal.focusedIndex--;
                  updateHomeRowsFocus();
               }
               break;

            case KeyCodes.DOWN:
               evt.preventDefault();
               if (homeRowsModal.focusedIndex < totalItems - 1) {
                  homeRowsModal.focusedIndex++;
                  updateHomeRowsFocus();
               } else if (homeRowsModal.focusedIndex === totalItems - 1) {
                  // Move to first button (Reset to Default)
                  buttons[0].focus();
               }
               break;

            case KeyCodes.LEFT:
               evt.preventDefault();
               moveRowUp(homeRowsModal.focusedIndex);
               break;

            case KeyCodes.RIGHT:
               evt.preventDefault();
               moveRowDown(homeRowsModal.focusedIndex);
               break;

            case KeyCodes.ENTER:
               evt.preventDefault();
               var currentItem = items[homeRowsModal.focusedIndex];
               if (currentItem) {
                  currentItem.click();
               }
               break;

            case KeyCodes.BACK:
               evt.preventDefault();
               closeHomeRowsModal();
               break;
         }
      }
   }

   function handleLogout() {
      var returnFocus = document.querySelector('[data-setting="logout"]');

      showConfirm(
         "Are you sure you want to sign out? This will remove saved credentials and redirect to the login page.",
         "Sign Out",
         function () {
            try {
               // Get current server/user before logging out
               var activeServer = MultiServerManager.getActiveServer();

               // Clear Jellyfin credentials
               JellyfinAPI.logout();

               // Remove saved server/user from MultiServerManager
               if (activeServer && activeServer.serverId && activeServer.userId) {
                  MultiServerManager.removeServer(
                     activeServer.serverId,
                     activeServer.userId
                  );
                  // Use console.log for safety as Logger might not be globally available
                  console.log(
                     "[LOGOUT] Removed saved credentials for user:",
                     activeServer.userId
                  );
               }
            } catch (error) {
               console.error("[LOGOUT] Error during logout cleanup:", error);
            } finally {
               window.location.href = "login.html";
            }
         },
         function () {
            if (returnFocus) returnFocus.focus();
         }
      );
   }

   /**
    * Apply toolbar settings live to the current page's navbar
    * @private
    */
   function applyToolbarSettingsLive() {
      var shuffleBtn = document.getElementById("shuffleBtn");
      var genresBtn = document.getElementById("genresBtn");
      var favoritesBtn = document.getElementById("favoritesBtn");
      var discoverBtn = document.getElementById("discoverBtn");
      var requestsBtn = document.getElementById("requestsBtn");
      var libraryButtons = document.querySelectorAll(
         ".nav-btn[data-library-id]"
      );

      if (shuffleBtn) {
         if (settings.showShuffleButton) {
            shuffleBtn.style.display = "";
            shuffleBtn.style.pointerEvents = "";
            shuffleBtn.setAttribute("tabindex", "0");
         } else {
            shuffleBtn.style.display = "none";
            shuffleBtn.style.pointerEvents = "none";
            shuffleBtn.setAttribute("tabindex", "-1");
         }
      }

      if (genresBtn) {
         if (settings.showGenresButton) {
            genresBtn.style.display = "";
            genresBtn.style.pointerEvents = "";
            genresBtn.setAttribute("tabindex", "0");
         } else {
            genresBtn.style.display = "none";
            genresBtn.style.pointerEvents = "none";
            genresBtn.setAttribute("tabindex", "-1");
         }
      }

      if (favoritesBtn) {
         if (settings.showFavoritesButton) {
            favoritesBtn.style.display = "";
            favoritesBtn.style.pointerEvents = "";
            favoritesBtn.setAttribute("tabindex", "0");
         } else {
            favoritesBtn.style.display = "none";
            favoritesBtn.style.pointerEvents = "none";
            favoritesBtn.setAttribute("tabindex", "-1");
         }
      }

      // Apply library buttons visibility
      if (libraryButtons && libraryButtons.length > 0) {
         libraryButtons.forEach(function (btn) {
            if (settings.showLibrariesInToolbar) {
               btn.style.display = "";
               btn.style.pointerEvents = "";
               btn.setAttribute("tabindex", "0");
            } else {
               btn.style.display = "none";
               btn.style.pointerEvents = "none";
               btn.setAttribute("tabindex", "-1");
            }
         });
      }

      // Hide Jellyseerr buttons if Jellyseerr is disabled
      if (!settings.jellyseerrEnabled) {
         if (discoverBtn) {
            discoverBtn.style.display = "none";
            discoverBtn.style.pointerEvents = "none";
            discoverBtn.setAttribute("tabindex", "-1");
         }
         if (requestsBtn) {
            requestsBtn.style.display = "none";
            requestsBtn.style.pointerEvents = "none";
            requestsBtn.setAttribute("tabindex", "-1");
         }
      } else {
         if (discoverBtn) {
            discoverBtn.style.display = "";
            discoverBtn.style.pointerEvents = "";
            discoverBtn.setAttribute("tabindex", "0");
         }
         if (requestsBtn) {
            requestsBtn.style.display = "";
            requestsBtn.style.pointerEvents = "";
            requestsBtn.setAttribute("tabindex", "0");
         }
      }
   }

   /**
    * Sync settings with ImageHelper module
    * @private
    */
   function syncImageHelperSettings() {
      // Sync theme music setting
      if (typeof ThemeMusicPlayer !== "undefined") {
         ThemeMusicPlayer.setEnabled(settings.playThemeMusic);
      }
      if (typeof ImageHelper === "undefined") return;

      ImageHelper.setImageType(settings.imageType);
      ImageHelper.setPosterSize(settings.posterSize);
   }

   /**
    * Get home rows settings for use by other pages (user-scoped)
    * @returns {Array} Array of home row configurations
    */
   function getHomeRowsSettings() {
      var stored = storage.getUserPreference("jellyfin_settings", null);
      if (stored) {
         try {
            var parsedSettings = JSON.parse(stored);
            if (parsedSettings.homeRows) {
               // Merge saved settings with defaults - saved values take precedence
               var merged = JSON.parse(JSON.stringify(defaultHomeRows));
               parsedSettings.homeRows.forEach(function (savedRow) {
                  var defaultRow = merged.find(function (r) {
                     return r.id === savedRow.id;
                  });
                  if (defaultRow) {
                     // Update existing default with saved values
                     defaultRow.enabled = savedRow.enabled;
                     // Use default order for latest-* rows so they group together alphabetically
                     if (savedRow.id.indexOf("latest-") !== 0) {
                        defaultRow.order = savedRow.order;
                     }
                  } else {
                     // Add saved row that's not in defaults
                     merged.push(savedRow);
                  }
               });
               return merged;
            }
         } catch (e) { }
      }
      return JSON.parse(JSON.stringify(defaultHomeRows));
   }

   /**
    * Enter slider mode for blur settings
    * @param {string} settingName - The setting name
    * @param {number} currentValue - The current value
    * @private
    */
   function enterSliderMode(settingName, currentValue) {
      focusManager.inSliderMode = true;
      focusManager.sliderSetting = settingName;

      var settingItem = document.querySelector(
         '[data-setting="' + settingName + '"]'
      );
      if (!settingItem) return;

      // Initialize slider with current value
      var percentage = (currentValue / 5) * 100;
      var fillElement = settingItem.querySelector(".slider-fill");
      var sliderValueDisplay = settingItem.querySelector(
         ".slider-value-display"
      );

      if (fillElement) {
         fillElement.style.width = percentage + "%";
      }
      if (sliderValueDisplay) {
         sliderValueDisplay.textContent = currentValue;
      }

      // Hide the value display, show the slider
      var valueDisplay = settingItem.querySelector(".setting-value");
      var sliderContainer = settingItem.querySelector(".slider-container");

      if (valueDisplay) valueDisplay.style.display = "none";
      if (sliderContainer) sliderContainer.style.display = "flex";

      settingItem.classList.add("slider-active");
   }

   /**
    * Exit slider mode and update setting
    * @param {string} settingName - The setting name
    * @param {number} newValue - The new value
    * @private
    */
   function exitSliderMode(settingName, newValue) {
      focusManager.inSliderMode = false;
      focusManager.sliderSetting = null;

      // Update the setting based on which blur control
      if (settingName === "backdrop-blur-home") {
         settings.backdropBlurHome = newValue;
      } else if (settingName === "backdrop-blur-detail") {
         settings.backdropBlurDetail = newValue;
      }

      saveSettings();
      updateSettingValues();

      var settingItem = document.querySelector(
         '[data-setting="' + settingName + '"]'
      );
      if (!settingItem) return;

      // Show the value display, hide the slider
      var valueDisplay = settingItem.querySelector(".setting-value");
      var sliderContainer = settingItem.querySelector(".slider-container");

      if (valueDisplay) valueDisplay.style.display = "block";
      if (sliderContainer) sliderContainer.style.display = "none";

      settingItem.classList.remove("slider-active");
   }

   /**
    * Handle navigation within slider mode
    * @param {KeyboardEvent} evt - Keyboard event
    * @private
    */
   function handleSliderNavigation(evt) {
      var settingName = focusManager.sliderSetting;
      var currentValue =
         settingName === "backdrop-blur-home"
            ? settings.backdropBlurHome
            : settings.backdropBlurDetail;

      switch (evt.keyCode) {
         case KeyCodes.LEFT: // Left - decrease value
            evt.preventDefault();
            if (currentValue > 0) {
               var newValue = Math.max(0, currentValue - 1);
               updateSliderDisplay(settingName, newValue);
            }
            break;

         case KeyCodes.RIGHT: // Right - increase value
            evt.preventDefault();
            if (currentValue < 5) {
               var newValue = Math.min(5, currentValue + 1);
               updateSliderDisplay(settingName, newValue);
            }
            break;

         case KeyCodes.UP: // Up - increase value
            evt.preventDefault();
            if (currentValue < 5) {
               var newValue = Math.min(5, currentValue + 1);
               updateSliderDisplay(settingName, newValue);
            }
            break;

         case KeyCodes.DOWN: // Down - decrease value
            evt.preventDefault();
            if (currentValue > 0) {
               var newValue = Math.max(0, currentValue - 1);
               updateSliderDisplay(settingName, newValue);
            }
            break;

         case KeyCodes.ENTER: // Enter - confirm and exit slider mode
            evt.preventDefault();
            exitSliderMode(settingName, currentValue);
            break;

         case KeyCodes.BACKSPACE: // Back - cancel slider mode
         case KeyCodes.ESCAPE:
            evt.preventDefault();
            // Reset to original value
            exitSliderMode(
               settingName,
               settingName === "backdrop-blur-home"
                  ? settings.backdropBlurHome
                  : settings.backdropBlurDetail
            );
            break;
      }
   }

   // ==================== Jellyseerr Functions ====================

   /**
    * Initialize Jellyseerr connection
    * @private
    */
   /**
    * Initialize Jellyseerr integration
    * @private
    */
   function initializeJellyseerr() {
      // In settings context, use the in-memory settings object if available
      if (!settings.jellyseerrEnabled || !settings.jellyseerrUrl) {
         return Promise.resolve(false);
      }

      return JellyseerrAPI.initializeFromPreferences();
   }

   /**
    * Prompt for Jellyseerr URL using modal
    * @private
    */
   function promptJellyseerrUrl() {
      var input = document.getElementById("jellyseerrUrlInput");
      if (input) {
         input.value = settings.jellyseerrUrl || "";
      }

      ModalManager.show({
         modalId: "jellyseerrUrlModal",
         inputIds: ["jellyseerrUrlInput"],
         buttonIds: ["saveJellyseerrUrlBtn", "cancelJellyseerrUrlBtn"],
         focusReturn: '[data-setting="jellyseerrUrl"]',
         clearInputs: false, // Preserve current URL value for editing
         onSave: function (inputs) {
            var newUrl = inputs[0].value.trim();

            if (newUrl !== "") {
               // Basic URL validation
               if (
                  !newUrl.startsWith("http://") &&
                  !newUrl.startsWith("https://")
               ) {
                  showAlert(
                     "Invalid URL. Please include http:// or https://",
                     "Invalid URL"
                  );
                  return;
               }

               settings.jellyseerrUrl = newUrl;
               saveSettings();
               updateSettingValues();

               if (settings.jellyseerrEnabled) {
                  initializeJellyseerr();
               }
            }

            closeJellyseerrUrlModal();
         },
         onCancel: closeJellyseerrUrlModal,
      });
   }

   /**
    * Close Jellyseerr URL modal
    * @private
    */
   function closeJellyseerrUrlModal() {
      ModalManager.close("jellyseerrUrlModal");
   }

   /**
    * Prompt for Jellyseerr API Key using modal
    * @private
    */
   function promptJellyseerrApiKey() {
      var input = document.getElementById("jellyseerrApiKeyInput");
      if (input) {
         input.value = settings.jellyseerrApiKey || "";
      }

      ModalManager.show({
         modalId: "jellyseerrApiKeyModal",
         inputIds: ["jellyseerrApiKeyInput"],
         buttonIds: ["saveJellyseerrApiKeyBtn", "cancelJellyseerrApiKeyBtn"],
         focusReturn: '[data-setting="jellyseerrApiKey"]',
         clearInputs: false,
         onSave: function (inputs) {
            var newApiKey = inputs[0].value.trim();

            settings.jellyseerrApiKey = newApiKey;
            saveSettings();
            updateSettingValues();

            // Save to JellyseerrPreferences (per-user storage)
            if (typeof JellyseerrPreferences !== "undefined") {
               JellyseerrPreferences.set("apiKey", newApiKey);
               // Set auth method to API key when using manual API key entry
               if (newApiKey) {
                  JellyseerrPreferences.set("authMethod", "jellyfin-apikey");
               }
            }

            // Also update the API client directly
            if (typeof JellyseerrAPI !== "undefined") {
               JellyseerrAPI.setApiKey(newApiKey);
            }

            if (newApiKey) {
               showAlert(
                  "API Key saved. Jellyseerr should now work on Tizen.",
                  "Success"
               );
            }

            closeJellyseerrApiKeyModal();
         },
         onCancel: closeJellyseerrApiKeyModal,
      });
   }

   /**
    * Close Jellyseerr API Key modal
    * @private
    */
   function closeJellyseerrApiKeyModal() {
      ModalManager.close("jellyseerrApiKeyModal");
   }

   /**
    * Handle Jellyseerr Jellyfin authentication
    * @private
    */
   function handleJellyseerrAuthJellyfin() {
      if (!settings.jellyseerrEnabled) {
         showAlert("Please enable Jellyseerr first", "Error");
         return;
      }

      if (!settings.jellyseerrUrl) {
         showAlert("Please set Jellyseerr URL first", "Error");
         return;
      }

      // Get Jellyfin auth info
      if (!auth || !auth.username || !auth.serverAddress) {
         showAlert("Jellyfin authentication not found", "Error");
         return;
      }

      var username = auth.username;
      var jellyfinUrl = auth.serverAddress;
      var userId = auth.userId;

      // Initialize Jellyseerr first with direct initialize() call (not initializeFromPreferences which requires auth)
      console.log(
         "[Settings] Initializing Jellyseerr with URL:",
         settings.jellyseerrUrl
      );
      JellyseerrAPI.initialize(settings.jellyseerrUrl, null, userId)
         .then(function () {
            console.log("[Settings] Jellyseerr initialized successfully");
            // Show Jellyfin authentication modal
            showJellyseerrJellyfinAuthModal(username, jellyfinUrl);
         })
         .catch(function (error) {
            console.error("[Settings] Failed to initialize Jellyseerr:", error);
            showAlert(
               "Failed to initialize Jellyseerr. Please check your server URL.",
               "Initialization Error"
            );
         });
   }

   /**
    * Handle Jellyseerr local account authentication
    * @private
    */
   function handleJellyseerrAuthLocal() {
      if (!settings.jellyseerrEnabled) {
         showAlert("Please enable Jellyseerr first", "Error");
         return;
      }

      if (!settings.jellyseerrUrl) {
         showAlert("Please set Jellyseerr URL first", "Error");
         return;
      }

      // Get current user ID for cookie storage
      var userId = auth && auth.userId ? auth.userId : null;

      // Initialize Jellyseerr first with direct initialize() call (not initializeFromPreferences which requires auth)
      console.log(
         "[Settings] Initializing Jellyseerr with URL:",
         settings.jellyseerrUrl
      );
      JellyseerrAPI.initialize(settings.jellyseerrUrl, null, userId)
         .then(function () {
            console.log("[Settings] Jellyseerr initialized successfully");
            // Show local login modal
            showJellyseerrLocalModal();
         })
         .catch(function (error) {
            console.error("[Settings] Failed to initialize Jellyseerr:", error);
            showAlert(
               "Failed to initialize Jellyseerr. Please check your server URL.",
               "Initialization Error"
            );
         });
   }

   /**
    * Show Jellyseerr Jellyfin authentication modal
    * @private
    */
   function showJellyseerrJellyfinAuthModal(username, jellyfinUrl) {
      console.log(
         "[Settings] Showing Jellyfin auth modal for user:",
         username,
         "jellyfin URL:",
         jellyfinUrl
      );

      ModalManager.show({
         modalId: "jellyseerrJellyfinAuthModal",
         inputIds: ["jellyseerrJellyfinAuthPasswordInput"],
         buttonIds: [
            "saveJellyseerrJellyfinAuthBtn",
            "cancelJellyseerrJellyfinAuthBtn",
         ],
         focusReturn: '[data-setting="jellyseerrAuthJellyfin"]',
         clearInputs: true, // Clear password for security
         onSave: function (inputs) {
            var password = inputs[0].value;

            console.log(
               "[Settings] Auth modal onSave called, password length:",
               password ? password.length : 0
            );
            console.log(
               "[Settings] Calling JellyseerrAPI.loginWithJellyfin with username:",
               username
            );

            if (!password) {
               showAlert("Password is required", "Error");
               return;
            }

            // Login with Jellyfin SSO
            JellyseerrAPI.loginWithJellyfin(username, password, jellyfinUrl)
               .then(function (response) {
                  console.log("[Settings] Login successful:", response);
                  var user = response.user;
                  var apiKey = response.apiKey;

                  // Save credentials for auto-login
                  JellyseerrAPI.saveCredentials(
                     username,
                     password,
                     jellyfinUrl
                  );

                  if (apiKey) {
                     // API key was in the login response - save it
                     JellyseerrAPI.setApiKey(apiKey);
                     storage.setJellyseerrSetting("apiKey", apiKey);
                  }

                  // Clear local auth credentials
                  storage.removeJellyseerrUserSetting(
                     auth.userId,
                     "localEmail"
                  );
                  storage.removeJellyseerrUserSetting(
                     auth.userId,
                     "localPassword"
                  );

                  // Reinitialize API to ensure session is active
                  initializeJellyseerr()
                     .then(function () {
                        showAlert(
                           "Successfully authenticated with Jellyseerr as " +
                           (user.displayName || user.username) +
                           "!",
                           "Success"
                        );
                        updateSettingValues();
                        closeJellyseerrJellyfinAuthModal();
                     })
                     .catch(function (error) {
                        showAlert(
                           "Authentication succeeded but failed to initialize session. Please try again.",
                           "Warning"
                        );
                        closeJellyseerrJellyfinAuthModal();
                     });
               })
               .catch(function (error) {
                  console.error("[Settings] Login failed:", error);
                  showAlert(
                     "Failed to authenticate with Jellyseerr. Please check your password and try again.",
                     "Authentication Failed"
                  );
                  inputs[0].value = "";
                  inputs[0].focus();
               });
         },
         onCancel: closeJellyseerrJellyfinAuthModal,
      });
   }

   /**
    * Close Jellyseerr Jellyfin authentication modal
    * @private
    */
   function closeJellyseerrJellyfinAuthModal() {
      ModalManager.close("jellyseerrJellyfinAuthModal");
   }

   /**
    * Show Jellyseerr local account modal
    * @private
    */
   function showJellyseerrLocalModal() {
      ModalManager.show({
         modalId: "jellyseerrLocalModal",
         inputIds: ["jellyseerrEmailInput", "jellyseerrLocalPasswordInput"],
         buttonIds: ["saveJellyseerrLocalBtn", "cancelJellyseerrLocalBtn"],
         focusReturn: '[data-setting="jellyseerrAuthLocal"]',
         clearInputs: true, // Clear credentials for security
         onSave: function (inputs) {
            var email = inputs[0].value.trim();
            var password = inputs[1].value;

            console.log(
               "[Settings] Local auth onSave called, email:",
               email,
               "password length:",
               password ? password.length : 0
            );

            if (!email || !password) {
               showAlert("Email and password are required", "Error");
               return;
            }

            console.log("[Settings] Calling JellyseerrAPI.loginLocal");

            JellyseerrAPI.loginLocal(email, password)
               .then(function (response) {
                  console.log("[Settings] Local login successful:", response);
                  var user = response.data || response;

                  // Clear Jellyfin auth credentials (keep URL)
                  storage.removeJellyseerrUserSetting(
                     auth.userId,
                     "jellyfinUsername"
                  );
                  storage.removeJellyseerrUserSetting(
                     auth.userId,
                     "jellyfinPassword"
                  );

                  // Reinitialize API to ensure session is active
                  initializeJellyseerr()
                     .then(function () {
                        showAlert(
                           "Successfully logged in to Jellyseerr as " +
                           user.displayName,
                           "Success"
                        );
                        updateSettingValues();
                        closeJellyseerrLocalModal();
                     })
                     .catch(function (error) {
                        showAlert(
                           "Login succeeded but failed to initialize session. Please try again.",
                           "Warning"
                        );
                        closeJellyseerrLocalModal();
                     });
               })
               .catch(function (error) {
                  console.error("[Settings] Local login failed:", error);
                  showAlert(
                     "Failed to login. Please check your credentials and try again.",
                     "Login Failed"
                  );
                  inputs[1].value = "";
                  inputs[1].focus();
               });
         },
         onCancel: closeJellyseerrLocalModal,
      });
   }

   /**
    * Close Jellyseerr local account modal
    * @private
    */
   function closeJellyseerrLocalModal() {
      ModalManager.close("jellyseerrLocalModal");
   }

   /**
    * Update the slider display as user adjusts value
    * @param {string} settingName - The setting name
    * @param {number} newValue - The new value
    * @private
    */
   function updateSliderDisplay(settingName, newValue) {
      // Update setting temporarily (for display)
      if (settingName === "backdrop-blur-home") {
         settings.backdropBlurHome = newValue;
      } else if (settingName === "backdrop-blur-detail") {
         settings.backdropBlurDetail = newValue;
      }

      // Temporarily save to apply the blur in real-time
      saveSettings();

      // Apply blur to current page in real-time (if applicable)
      if (settingName === "backdrop-blur-home") {
         var homeBackdrop = document.getElementById("globalBackdropImage");
         if (homeBackdrop && typeof storage !== "undefined") {
            storage.applyBackdropBlur(homeBackdrop, "backdropBlurHome", 20);
         }
      } else if (settingName === "backdrop-blur-detail") {
         var detailBackdrop = document.querySelector(".backdrop-image");
         if (detailBackdrop && typeof storage !== "undefined") {
            storage.applyBackdropBlur(detailBackdrop, "backdropBlurDetail", 15);
         }
      }

      // Find the setting item - first try active panel, then search all panels
      var settingItem = document.querySelector(
         '[data-setting="' + settingName + '"]'
      );
      if (!settingItem) return;

      // Update the slider fill width (0-5 maps to 0-100%)
      var fillElement = settingItem.querySelector(".slider-fill");
      if (fillElement) {
         var percentage = (newValue / 5) * 100;
         fillElement.style.width = percentage + "%";
      }

      // Update the slider value display
      var sliderValueDisplay = settingItem.querySelector(
         ".slider-value-display"
      );
      if (sliderValueDisplay) {
         sliderValueDisplay.textContent = newValue;
      }
   }

   /**
    * Test connection to Jellyseerr server
    * @private
    */
   function testJellyseerrConnection() {
      if (!settings.jellyseerrUrl) {
         showAlert("Please set Jellyseerr URL first", "Error");
         return;
      }

      // Initialize with the URL
      var auth = JellyfinAPI.getStoredAuth();
      var userId = auth && auth.userId ? auth.userId : null;

      JellyseerrAPI.initialize(settings.jellyseerrUrl, null, userId)
         .then(function () {
            return JellyseerrAPI.getStatus();
         })
         .then(function (status) {
            var message =
               "Connection successful!\n\n" +
               "Version: " +
               (status.version || "Unknown") +
               "\n" +
               "Status: " +
               (status.status || "Online");
            showAlert(message, "Connection Test");
         })
         .catch(function (error) {
            showAlert(
               "Connection failed. Please check the URL and ensure Jellyseerr is running.\n\nError: " +
               (error.message || error),
               "Connection Failed"
            );
         });
   }

   /**
    * Clear Jellyseerr cache and stored data
    * @private
    */
   function clearJellyseerrCache() {
      var returnFocus = document.querySelector(
         '[data-setting="clearJellyseerrCache"]'
      );

      showConfirm(
         "Clear all Jellyseerr cached data? This will not affect your server settings.",
         "Clear Cache",
         function () {
            try {
               JellyseerrPreferences.clearCache();
               showAlert("Jellyseerr cache cleared successfully", "Success");
               if (returnFocus) returnFocus.focus();
            } catch (error) {
               showAlert("Failed to clear cache", "Error");
               if (returnFocus) returnFocus.focus();
            }
         },
         function () {
            if (returnFocus) returnFocus.focus();
         }
      );
   }

   /**
    * Disconnect current user from Jellyseerr
    * Logs out the current user without affecting other users or global settings
    * @private
    */
   function disconnectJellyseerr() {
      var returnFocus = document.querySelector(
         '[data-setting="disconnectJellyseerr"]'
      );

      showConfirm(
         "Disconnect from Jellyseerr? You will need to re-authenticate to use Jellyseerr features.",
         "Disconnect",
         function () {
            try {
               JellyseerrAPI.logout();
               showAlert(
                  "Successfully disconnected from Jellyseerr",
                  "Success"
               );
               if (returnFocus) returnFocus.focus();
            } catch (error) {
               showAlert(
                  "Disconnected from Jellyseerr (with errors)",
                  "Warning"
               );
               if (returnFocus) returnFocus.focus();
            }
         },
         function () {
            if (returnFocus) returnFocus.focus();
         }
      );
   }

   /**
    * Show custom alert modal with D-pad support
    * @param {string} message - Alert message to display
    * @param {string} [title='Alert'] - Alert title
    * @private
    */
   function showAlert(message, title) {
      var modal = document.getElementById("customAlertModal");
      var titleElement = document.getElementById("alertTitle");
      var messageElement = document.getElementById("alertMessage");
      var okBtn = document.getElementById("alertOkBtn");

      if (!modal || !titleElement || !messageElement || !okBtn) return;

      titleElement.textContent = title || "Alert";
      messageElement.textContent = message;
      modal.style.display = "flex";

      setTimeout(function () {
         okBtn.focus();
      }, 100);
   }

   /**
    * Close custom alert modal
    * @private
    */
   function closeAlert() {
      var modal = document.getElementById("customAlertModal");
      if (modal) {
         modal.style.display = "none";
      }
   }

   /**
    * Show custom confirmation modal with D-pad support and remote navigation
    * Handles LEFT/RIGHT navigation between buttons and BACK key to cancel
    * @param {string} message - Confirmation message to display
    * @param {string} [title='Confirm Action'] - Confirmation title
    * @param {Function} onConfirm - Callback when confirmed
    * @param {Function} onCancel - Callback when cancelled
    * @private
    */
   function showConfirm(message, title, onConfirm, onCancel) {
      var modal = document.getElementById("confirmModal");
      var titleElement = document.getElementById("confirmTitle");
      var messageElement = document.getElementById("confirmMessage");
      var okBtn = document.getElementById("confirmOkBtn");
      var cancelBtn = document.getElementById("confirmCancelBtn");

      if (!modal || !titleElement || !messageElement || !okBtn || !cancelBtn)
         return;

      titleElement.textContent = title || "Confirm Action";
      messageElement.textContent = message;
      modal.style.display = "flex";

      // Remove any existing listeners
      var newOkBtn = okBtn.cloneNode(true);
      var newCancelBtn = cancelBtn.cloneNode(true);
      okBtn.parentNode.replaceChild(newOkBtn, okBtn);
      cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);

      // Add new listeners
      newOkBtn.addEventListener("click", function () {
         closeConfirm();
         if (onConfirm) onConfirm();
      });

      newCancelBtn.addEventListener("click", function () {
         closeConfirm();
         if (onCancel) onCancel();
      });

      // Handle keyboard navigation within modal
      var modalKeyHandler = function (evt) {
         if (evt.keyCode === KeyCodes.BACK) {
            evt.preventDefault();
            closeConfirm();
            if (onCancel) onCancel();
            modal.removeEventListener("keydown", modalKeyHandler);
         } else if (
            evt.keyCode === KeyCodes.LEFT ||
            evt.keyCode === KeyCodes.RIGHT
         ) {
            evt.preventDefault();
            if (document.activeElement === newOkBtn) {
               newCancelBtn.focus();
            } else {
               newOkBtn.focus();
            }
         } else if (evt.keyCode === KeyCodes.ENTER) {
            evt.preventDefault();
            // Trigger click on the focused button (Confirm or Cancel)
            if (
               document.activeElement === newOkBtn ||
               document.activeElement === newCancelBtn
            ) {
               document.activeElement.click();
            }
         }
      };

      modal.addEventListener("keydown", modalKeyHandler);

      setTimeout(function () {
         newCancelBtn.focus();
      }, 100);
   }

   /**
    * Close custom confirmation modal
    * @private
    */
   function closeConfirm() {
      var modal = document.getElementById("confirmModal");
      if (modal) {
         modal.style.display = "none";
      }
   }

   /**
    * Helper function to handle modal field navigation with UP/DOWN keys
    * @param {KeyboardEvent} evt - Keyboard event
    * @param {HTMLElement[]} fields - Array of focusable fields in order
    * @returns {boolean} True if navigation was handled
    * @private
    */
   function handleModalFieldNavigation(evt, fields) {
      if (
         evt.keyCode !== KeyCodes.UP &&
         evt.keyCode !== KeyCodes.DOWN &&
         evt.keyCode !== KeyCodes.LEFT &&
         evt.keyCode !== KeyCodes.RIGHT
      ) {
         return false;
      }

      var activeElement = document.activeElement;
      var currentIndex = fields.indexOf(activeElement);

      if (currentIndex === -1) return false;

      // Handle UP/DOWN for all fields
      if (evt.keyCode === KeyCodes.UP || evt.keyCode === KeyCodes.DOWN) {
         evt.preventDefault();
         var newIndex =
            evt.keyCode === KeyCodes.UP ? currentIndex - 1 : currentIndex + 1;
         if (newIndex >= 0 && newIndex < fields.length) {
            fields[newIndex].focus();
         }
         return true;
      }

      // Handle LEFT/RIGHT only for buttons in modal-actions
      var currentField = fields[currentIndex];
      if (
         currentField.classList.contains("modal-btn") ||
         (currentField.parentElement &&
            currentField.parentElement.classList.contains("modal-actions"))
      ) {
         if (evt.keyCode === KeyCodes.LEFT || evt.keyCode === KeyCodes.RIGHT) {
            evt.preventDefault();

            // Find buttons in modal-actions
            var buttons = [];
            for (var i = 0; i < fields.length; i++) {
               if (
                  fields[i].classList.contains("modal-btn") ||
                  (fields[i].parentElement &&
                     fields[i].parentElement.classList.contains(
                        "modal-actions"
                     ))
               ) {
                  buttons.push(fields[i]);
               }
            }

            if (buttons.length > 1) {
               var buttonIndex = buttons.indexOf(currentField);
               var newButtonIndex =
                  evt.keyCode === KeyCodes.LEFT
                     ? buttonIndex - 1
                     : buttonIndex + 1;

               // Wrap around
               if (newButtonIndex < 0) newButtonIndex = buttons.length - 1;
               if (newButtonIndex >= buttons.length) newButtonIndex = 0;

               buttons[newButtonIndex].focus();
            }
            return true;
         }
      }

      return false;
   }

   /**
    * Open the Server Manager modal
    * @private
    */
   function openServerManager() {
      var modal = document.getElementById("serverManagerModal");
      if (!modal) return;

      // Check if modal is already open to prevent duplicate setup
      if (modal.style.display === "flex") {
         console.log("[SERVER MANAGER] Modal already open, skipping setup");
         return;
      }

      renderServerList();
      modal.style.display = "flex";

      // Setup event listeners
      var addServerBtn = document.getElementById("addServerBtn");
      var closeBtn = document.getElementById("closeServerManagerBtn");

      // Note: We rely on the keyboard handler for ENTER key, not onclick
      // This prevents duplicate event handling and infinite loops

      // Add comprehensive keyboard navigation for modal
      var keyHandler = function (e) {
         if (e.keyCode === KeyCodes.BACK || e.keyCode === KeyCodes.ESC) {
            e.preventDefault();
            closeServerManager();
            return;
         }

         if (e.keyCode === KeyCodes.ENTER) {
            var currentEl = document.activeElement;
            e.preventDefault();
            e.stopPropagation();

            // Trigger appropriate action
            if (currentEl === addServerBtn) {
               openAddServerModal();
               return;
            } else if (currentEl === closeBtn) {
               closeServerManager();
               return;
            }

            // Handle server items
            if (currentEl.classList.contains("server-item")) {
               var serverId = currentEl.dataset.serverId;
               if (serverId) {
                  var activeServer = MultiServerManager.getActiveServer();
                  if (!activeServer || serverId !== activeServer.id) {
                     setActiveServerHandler(serverId);
                  }
               }
               return;
            }
         }

         // Get all focusable elements in the modal
         var focusableElements = modal.querySelectorAll(
            ".server-item, .server-action-btn, #addServerBtn, #closeServerManagerBtn"
         );
         var focusableArray = Array.prototype.slice.call(focusableElements);
         var currentIndex = focusableArray.indexOf(document.activeElement);

         if (currentIndex === -1) return;

         var handled = false;

         // Handle UP/DOWN navigation
         if (e.keyCode === KeyCodes.UP) {
            e.preventDefault();
            var newIndex = currentIndex - 1;
            if (newIndex < 0) newIndex = focusableArray.length - 1;
            focusableArray[newIndex].focus();
            handled = true;
         } else if (e.keyCode === KeyCodes.DOWN) {
            e.preventDefault();
            var newIndex = currentIndex + 1;
            if (newIndex >= focusableArray.length) newIndex = 0;
            focusableArray[newIndex].focus();
            handled = true;
         }

         // Handle LEFT/RIGHT for buttons in modal-actions or server-actions
         else if (e.keyCode === KeyCodes.LEFT || e.keyCode === KeyCodes.RIGHT) {
            var currentEl = document.activeElement;
            var parentActions = currentEl.parentElement;

            // Check if we're in modal-actions or server-actions
            if (
               parentActions &&
               (parentActions.classList.contains("modal-actions") ||
                  parentActions.classList.contains("server-actions"))
            ) {
               e.preventDefault();
               var siblings = parentActions.querySelectorAll("button");
               var siblingArray = Array.prototype.slice.call(siblings);
               var siblingIndex = siblingArray.indexOf(currentEl);

               if (siblingIndex !== -1) {
                  var newSiblingIndex =
                     e.keyCode === KeyCodes.LEFT
                        ? siblingIndex - 1
                        : siblingIndex + 1;
                  if (newSiblingIndex < 0)
                     newSiblingIndex = siblingArray.length - 1;
                  if (newSiblingIndex >= siblingArray.length)
                     newSiblingIndex = 0;
                  siblingArray[newSiblingIndex].focus();
                  handled = true;
               }
            }
            // If we're on a server-item, RIGHT opens its first action button
            else if (
               e.keyCode === KeyCodes.RIGHT &&
               currentEl.classList.contains("server-item")
            ) {
               e.preventDefault();
               var firstAction = currentEl.querySelector(".server-action-btn");
               if (firstAction) {
                  firstAction.focus();
                  handled = true;
               }
            }
         }
      };

      // Remove any existing handler before adding new one
      cleanupModalKeyHandler(modal, "_serverManagerKeyHandler");

      // Store handler reference for proper removal
      modal._serverManagerKeyHandler = keyHandler;
      modal.addEventListener("keydown", keyHandler);
      modal.setAttribute("data-key-handler", "true");

      // Focus management
      setTimeout(function () {
         var firstServer = modal.querySelector(".server-item");
         if (firstServer) {
            firstServer.focus();
         } else if (addServerBtn) {
            addServerBtn.focus();
         } else if (closeBtn) {
            closeBtn.focus();
         }
      }, 150);
   }

   /**
    * Render the server list in the modal
    * @private
    */
   function renderServerList() {
      var list = document.getElementById("serverList");
      if (!list) return;

      var servers = MultiServerManager.getAllServersArray();
      var activeServer = MultiServerManager.getActiveServer();

      list.innerHTML = "";

      if (servers.length === 0) {
         list.innerHTML =
            '<div class="empty-servers">' +
            '<div class="empty-servers-icon">🖥️</div>' +
            '<div class="empty-servers-text">No servers configured</div>' +
            '<div class="empty-servers-hint">Click "Add Server" to get started</div>' +
            "</div>";
         return;
      }

      servers.forEach(function (server) {
         var serverDiv = document.createElement("div");
         serverDiv.className = "server-item";
         if (
            activeServer &&
            server.serverId === activeServer.serverId &&
            server.userId === activeServer.userId
         ) {
            serverDiv.className += " active";
         }
         serverDiv.tabIndex = 0;
         serverDiv.dataset.serverId = server.serverId;
         serverDiv.dataset.userId = server.userId;

         // Check server health
         checkServerHealth(server.serverId, server.userId);

         var infoDiv = document.createElement("div");
         infoDiv.className = "server-info";

         var nameDiv = document.createElement("div");
         nameDiv.className = "server-name";
         nameDiv.textContent = server.name;

         var urlDiv = document.createElement("div");
         urlDiv.className = "server-url";
         urlDiv.textContent = server.url;

         var userDiv = document.createElement("div");
         userDiv.className = "server-user";
         userDiv.textContent = server.username;

         var statusDiv = document.createElement("div");
         statusDiv.className = "server-status";
         statusDiv.id =
            "server-status-" + server.serverId + "-" + server.userId;
         if (
            activeServer &&
            server.serverId === activeServer.serverId &&
            server.userId === activeServer.userId
         ) {
            statusDiv.className += " active";
            statusDiv.textContent = "Active";
         } else {
            statusDiv.className += " connected";
            statusDiv.textContent = "Checking...";
         }

         infoDiv.appendChild(nameDiv);
         infoDiv.appendChild(urlDiv);
         infoDiv.appendChild(userDiv);
         infoDiv.appendChild(statusDiv);

         var actionsDiv = document.createElement("div");
         actionsDiv.className = "server-actions";

         // Only show "Set Active" if not already active
         if (
            !activeServer ||
            server.serverId !== activeServer.serverId ||
            server.userId !== activeServer.userId
         ) {
            var activateBtn = document.createElement("button");
            activateBtn.className = "server-action-btn";
            activateBtn.textContent = "Set Active";
            activateBtn.onclick = function (e) {
               e.stopPropagation();
               setActiveServerHandler(server.serverId, server.userId);
            };
            actionsDiv.appendChild(activateBtn);
         }

         var removeBtn = document.createElement("button");
         removeBtn.className = "server-action-btn danger";
         removeBtn.textContent = "Remove";
         removeBtn.onclick = function (e) {
            e.stopPropagation();
            removeServerHandler(
               server.serverId,
               server.userId,
               server.name,
               server.username
            );
         };
         actionsDiv.appendChild(removeBtn);

         serverDiv.appendChild(infoDiv);
         serverDiv.appendChild(actionsDiv);

         // Click to set active
         serverDiv.onclick = function () {
            if (
               !activeServer ||
               server.serverId !== activeServer.serverId ||
               server.userId !== activeServer.userId
            ) {
               setActiveServerHandler(server.serverId, server.userId);
            }
         };

         // Keyboard handler for server item
         serverDiv.onkeydown = function (e) {
            if (e.keyCode === KeyCodes.ENTER) {
               e.preventDefault();
               if (
                  !activeServer ||
                  server.serverId !== activeServer.serverId ||
                  server.userId !== activeServer.userId
               ) {
                  setActiveServerHandler(server.serverId, server.userId);
               }
            } else if (e.keyCode === KeyCodes.RIGHT) {
               e.preventDefault();
               e.stopPropagation();
               var firstBtn = actionsDiv.querySelector(".server-action-btn");
               if (firstBtn) {
                  firstBtn.focus();
               }
            }
         };

         // Add keyboard handlers to action buttons
         var actionButtons = actionsDiv.querySelectorAll(".server-action-btn");
         actionButtons.forEach(function (btn) {
            btn.onkeydown = function (e) {
               if (e.keyCode === KeyCodes.LEFT) {
                  e.preventDefault();
                  e.stopPropagation();
                  serverDiv.focus();
               }
            };
         });

         list.appendChild(serverDiv);
      });

      // Update server count display
      updateServerCountDisplay();
   }

   /**
    * Check server health/connectivity
    * @private
    * @param {string} serverId - Server ID to check
    * @param {string} userId - User ID to check
    */
   function checkServerHealth(serverId, userId) {
      var server = MultiServerManager.getServer(serverId, userId);
      if (!server) return;

      var statusEl = document.getElementById(
         "server-status-" + serverId + "-" + userId
      );

      // Try to get system info from the server
      JellyfinAPI.getSystemInfo(
         server.url,
         server.accessToken,
         function (err, data) {
            if (!statusEl) return; // Element might have been removed

            if (err || !data) {
               statusEl.className = "server-status disconnected";
               statusEl.textContent = "Offline";
               statusEl.style.background = "rgba(200, 0, 0, 0.2)";
               statusEl.style.color = "#ff4444";

               // Update user connection status
               MultiServerManager.updateServer(serverId, null, userId, {
                  connected: false,
               });
            } else {
               var activeServer = MultiServerManager.getActiveServer();
               if (
                  activeServer &&
                  server.serverId === activeServer.serverId &&
                  server.userId === activeServer.userId
               ) {
                  statusEl.className = "server-status active";
                  statusEl.textContent = "Active";
               } else {
                  statusEl.className = "server-status connected";
                  statusEl.textContent = "Connected";
               }

               // Update user connection status
               MultiServerManager.updateServer(serverId, null, userId, {
                  connected: true,
               });
            }
         }
      );
   }

   /**
    * Set active server handler
    * @private
    * @param {string} serverId - Server ID to activate
    * @param {string} userId - User ID to activate
    */
   function setActiveServerHandler(serverId, userId) {
      var server = MultiServerManager.getServer(serverId, userId);
      if (!server) return;

      // Check if server is online first
      JellyfinAPI.getSystemInfo(
         server.url,
         server.accessToken,
         function (err, data) {
            if (err || !data) {
               showAlert(
                  "Server Offline",
                  "Cannot connect to " +
                  server.name +
                  ". Please check if the server is running."
               );
               return;
            }

            if (MultiServerManager.setActiveServer(serverId, userId)) {
               // Update global auth to point to new server/user
               auth = MultiServerManager.getServerAuth(serverId, userId);
               storage.set("jellyfin_auth", auth);

               // Refresh the server list
               renderServerList();

               // Update user info display
               displayUserInfo();

               showAlert(
                  "Server Changed",
                  "Now connected to " +
                  server.name +
                  " as " +
                  server.username +
                  ". Reloading..."
               );

               // Reload the page to refresh libraries and content
               setTimeout(function () {
                  window.location.href = "browse.html";
               }, 1500);
            }
         }
      );
   }

   /**
    * Remove server handler
    * @private
    * @param {string} serverId - Server ID to remove
    * @param {string} userId - User ID to remove
    * @param {string} serverName - Server name for confirmation
    * @param {string} username - Username for confirmation
    */
   function removeServerHandler(serverId, userId, serverName, username) {
      var activeServer = MultiServerManager.getActiveServer();

      if (
         activeServer &&
         serverId === activeServer.serverId &&
         userId === activeServer.userId &&
         MultiServerManager.getTotalUserCount() === 1
      ) {
         showAlert(
            "Cannot Remove",
            "Cannot remove the only configured user. Add another user or server first."
         );
         return;
      }

      showConfirm(
         "Remove User",
         'Are you sure you want to remove "' +
         username +
         '" from server "' +
         serverName +
         '"?',
         function () {
            if (MultiServerManager.removeServer(serverId, userId)) {
               renderServerList();

               // If we removed the active user, check if there are any servers left
               if (
                  activeServer &&
                  serverId === activeServer.serverId &&
                  userId === activeServer.userId
               ) {
                  var newAuth = MultiServerManager.getServerAuth();

                  if (!newAuth) {
                     // No servers left, redirect to login
                     storage.remove("jellyfin_auth");
                     showAlert(
                        "User Removed",
                        "No servers remaining. Redirecting to login..."
                     );
                     setTimeout(function () {
                        window.location.href = "login.html";
                     }, 1500);
                  } else {
                     // Switch to another server/user
                     auth = newAuth;
                     storage.set("jellyfin_auth", auth);
                     displayUserInfo();
                     showAlert(
                        "User Removed",
                        "Switched to another user. Reloading..."
                     );
                     setTimeout(function () {
                        window.location.href = "browse.html";
                     }, 1500);
                  }
               }
            }
         }
      );
   }

   /**
    * Open add server modal
    * @private
    */
   function openAddServerModal() {
      console.log("[ADD SERVER] Opening modal...");

      var modal = document.getElementById("addServerModal");
      if (!modal) {
         console.error("[ADD SERVER] Modal element not found!");
         return;
      }

      // Check if modal is already open to prevent duplicate setup
      if (modal.style.display === "flex") {
         console.log("[ADD SERVER] Modal already open, skipping setup");
         return;
      }

      // Hide server manager modal first
      var serverManagerModal = document.getElementById("serverManagerModal");
      if (serverManagerModal) {
         serverManagerModal.style.display = "none";
         console.log("[ADD SERVER] Hid server manager modal");
      }

      modal.style.display = "flex";
      console.log("[ADD SERVER] Modal display set to flex");

      var urlInput = document.getElementById("newServerUrlInput");
      var connectBtn = document.getElementById("connectNewServerBtn");
      var cancelBtn = document.getElementById("cancelAddServerBtn");
      console.log("[ADD SERVER] Elements:", {
         urlInput: !!urlInput,
         connectBtn: !!connectBtn,
         cancelBtn: !!cancelBtn,
      });

      // Clear input
      if (urlInput) urlInput.value = "";

      // Remove any existing handler BEFORE setting up new one
      console.log(
         "[ADD SERVER] Removing existing key handler before adding new one"
      );
      cleanupModalKeyHandler(modal, "_addServerKeyHandler");

      // Note: Removed onclick handlers - keyboard handler now calls functions directly
      // This prevents the infinite loop issue caused by .click() triggering onclick

      // Add keyboard navigation for modal
      var lastKeyTime = 0;
      var keyHandler = function (e) {
         // Debounce rapid key events
         var now = Date.now();
         if (now - lastKeyTime < 50) {
            console.log("[ADD SERVER NAV] Debounced rapid key event");
            e.preventDefault();
            e.stopPropagation();
            return;
         }
         lastKeyTime = now;

         var currentEl = document.activeElement;
         console.log(
            "[ADD SERVER NAV] Key:",
            e.keyCode,
            "Current element:",
            currentEl.id || currentEl.tagName
         );

         // Always allow BACK/ESC to close
         if (e.keyCode === KeyCodes.BACK || e.keyCode === KeyCodes.ESC) {
            e.preventDefault();
            console.log("[ADD SERVER NAV] Closing modal");
            closeAddServerModal();
            return;
         }

         // ENTER: move between fields or submit
         if (e.keyCode === KeyCodes.ENTER) {
            e.preventDefault();
            e.stopPropagation();
            console.log("[ADD SERVER NAV] ENTER pressed on:", currentEl.id);

            if (currentEl === urlInput) {
               console.log(
                  "[ADD SERVER NAV] Moving from URL to Connect button"
               );
               connectBtn.focus();
               return;
            } else if (currentEl === connectBtn) {
               console.log("[ADD SERVER NAV] Connect button activated");
               var serverUrl = urlInput ? urlInput.value.trim() : "";

               if (!serverUrl) {
                  showAlert("Invalid Input", "Please enter a server URL.");
                  return;
               }

               // Remove trailing slashes
               serverUrl = serverUrl.replace(/\/+$/, "");

               // Test connection, fetch server name, and redirect to login
               testAndAddServer(serverUrl);
               return;
            } else if (currentEl === cancelBtn) {
               console.log("[ADD SERVER NAV] Cancel button activated");
               closeAddServerModal();
               return;
            }
         }

         var focusableElements = [urlInput, connectBtn, cancelBtn].filter(
            function (el) {
               return el;
            }
         );
         var currentIndex = focusableElements.indexOf(currentEl);

         console.log(
            "[ADD SERVER NAV] Current index:",
            currentIndex,
            "Total elements:",
            focusableElements.length
         );
         console.log(
            "[ADD SERVER NAV] Focusable elements:",
            focusableElements.map(function (el) {
               return el.id || el.tagName;
            })
         );

         if (currentIndex === -1) {
            console.log(
               "[ADD SERVER NAV] Current element not in focusable list, ignoring"
            );
            return;
         }

         // Handle UP/DOWN navigation between all fields
         if (e.keyCode === KeyCodes.UP) {
            e.preventDefault();
            var newIndex = currentIndex - 1;
            if (newIndex < 0) newIndex = focusableElements.length - 1;
            console.log(
               "[ADD SERVER NAV] UP pressed, moving from index",
               currentIndex,
               "to",
               newIndex
            );
            focusableElements[newIndex].focus();
            console.log(
               "[ADD SERVER NAV] Focused element:",
               focusableElements[newIndex].id
            );
         } else if (e.keyCode === KeyCodes.DOWN) {
            e.preventDefault();
            var newIndex = currentIndex + 1;
            if (newIndex >= focusableElements.length) newIndex = 0;
            console.log(
               "[ADD SERVER NAV] DOWN pressed, moving from index",
               currentIndex,
               "to",
               newIndex
            );
            focusableElements[newIndex].focus();
            console.log(
               "[ADD SERVER NAV] Focused element:",
               focusableElements[newIndex].id
            );
         }
         // Handle LEFT/RIGHT for buttons only
         else if (
            (e.keyCode === KeyCodes.LEFT || e.keyCode === KeyCodes.RIGHT) &&
            (currentEl === connectBtn || currentEl === cancelBtn)
         ) {
            e.preventDefault();
            console.log("[ADD SERVER NAV] LEFT/RIGHT on button");
            if (currentEl === connectBtn) {
               cancelBtn.focus();
               console.log("[ADD SERVER NAV] Moved to Cancel button");
            } else {
               connectBtn.focus();
               console.log("[ADD SERVER NAV] Moved to Connect button");
            }
         }
      };

      // Store handler reference for proper removal (already removed above)
      modal._addServerKeyHandler = keyHandler;
      modal.addEventListener("keydown", keyHandler);
      modal.setAttribute("data-add-server-key-handler", "true");

      // Focus URL input with a longer delay to ensure modal is fully rendered
      setTimeout(function () {
         console.log(
            "[ADD SERVER] Setting focus. URL input:",
            !!urlInput,
            "Connect button:",
            !!connectBtn
         );
         if (urlInput) {
            urlInput.focus();
            console.log("[ADD SERVER] Focused URL input");
         } else if (connectBtn) {
            connectBtn.focus();
            console.log("[ADD SERVER] Focused connect button");
         }
         console.log(
            "[ADD SERVER] Active element after focus:",
            document.activeElement.tagName,
            document.activeElement.id
         );
      }, 100); // Reduced from 200ms to 100ms
   }

   /**
    * Test server connection and add if successful
    * @private
    * @param {string} serverName - Server display name
    * @param {string} serverUrl - Server URL
    */
   /**
    * Test server connection and add to multi-server list
    * Automatically fetches server name from the server
    * @private
    */
   function testAndAddServer(serverUrl) {
      showAlert("Testing Connection", "Connecting to server...");

      // Check if user provided a port
      var hasPort = /:(\d+)$/.test(serverUrl);
      var hasProtocol = /^https?:\/\//i.test(serverUrl);

      // If user specified a port, just try that
      if (hasPort) {
         var normalizedUrl = JellyfinAPI.normalizeServerAddress(serverUrl);
         tryConnect(normalizedUrl);
      } else {
         // Try multiple ports: 443 (HTTPS) first, then 8096 (HTTP)
         var baseUrl = hasProtocol ? serverUrl : serverUrl;
         var urlsToTry = [
            "https://" + baseUrl.replace(/^https?:\/\//i, "") + ":443",
            "http://" + baseUrl.replace(/^https?:\/\//i, "") + ":8096",
         ];

         tryMultiplePorts(urlsToTry, 0);
      }

      function tryMultiplePorts(urls, index) {
         if (index >= urls.length) {
            showAlert(
               "Connection Failed",
               "Unable to connect to server on ports 443 or 8096. Check the address and try again."
            );
            return;
         }

         var currentUrl = urls[index];

         JellyfinAPI.getPublicSystemInfo(currentUrl, function (err, data) {
            if (err || !data) {
               // Try next port
               tryMultiplePorts(urls, index + 1);
            } else {
               // Success!
               var serverName = data.ServerName || "Jellyfin Server";

               // Connection successful - redirect to login page for user selection
               closeAddServerModal();

               showAlert(
                  "Server Found",
                  'Found "' + serverName + '"! Redirecting to login...'
               );

               setTimeout(function () {
                  storage.set("pending_server", {
                     name: serverName,
                     url: currentUrl,
                  });
                  storage.set("adding_server_flow", true);
                  window.location.href = "login.html";
               }, 1500);
            }
         });
      }

      function tryConnect(url) {
         JellyfinAPI.getPublicSystemInfo(url, function (err, data) {
            if (err || !data) {
               showAlert(
                  "Connection Failed",
                  "Could not connect to the server. Please check the URL and try again."
               );
               return;
            }

            // Get server name from system info
            var serverName = data.ServerName || "Jellyfin Server";

            // Connection successful - redirect to login page for user selection
            closeAddServerModal();

            showAlert(
               "Server Found",
               'Found "' + serverName + '"! Redirecting to login...'
            );

            setTimeout(function () {
               storage.set("pending_server", {
                  name: serverName,
                  url: url,
               });
               storage.set("adding_server_flow", true);
               window.location.href = "login.html";
            }, 1500);
         });
      }
   }

   /**
    * Close server manager modal
    * @private
    */
   function closeServerManager() {
      var modal = document.getElementById("serverManagerModal");
      if (modal) {
         modal.style.display = "none";

         // Remove event listener properly
         cleanupModalKeyHandler(modal, "_serverManagerKeyHandler");
         modal.removeAttribute("data-key-handler");

         // Update server count in case it changed
         updateServerCountDisplay();

         // Return focus to manage servers button
         setTimeout(function () {
            var manageServersItem = document.querySelector(
               '[data-setting="manageServers"]'
            );
            if (manageServersItem) {
               manageServersItem.focus();
            }
         }, 100);
      }
   }

   /**
    * Close add server modal
    * @private
    */
   function closeAddServerModal() {
      var modal = document.getElementById("addServerModal");
      if (modal) {
         modal.style.display = "none";

         // Remove event listener properly
         cleanupModalKeyHandler(modal, "_addServerKeyHandler");
         modal.removeAttribute("data-add-server-key-handler");

         // Show server manager modal again
         var serverManagerModal = document.getElementById("serverManagerModal");
         if (serverManagerModal) {
            serverManagerModal.style.display = "flex";
            console.log("[ADD SERVER] Showing server manager modal again");

            // Return focus to add button
            setTimeout(function () {
               var addServerBtn = document.getElementById("addServerBtn");
               if (addServerBtn) {
                  addServerBtn.focus();
                  console.log(
                     "[ADD SERVER] Focused add server button in manager modal"
                  );
               }
            }, 100);
         }
      }
   }

   /**
    * Update server count display
    * @private
    */
   function updateServerCountDisplay() {
      var serverCountValue = document.getElementById("serverCountValue");
      if (serverCountValue) {
         var count = MultiServerManager.getServerCount();
         serverCountValue.textContent =
            count + (count === 1 ? " server" : " servers");
      }
   }

   return {
      init: init,
      getHomeRowsSettings: getHomeRowsSettings,
   };
})();

if (document.readyState === "loading") {
   document.addEventListener("DOMContentLoaded", SettingsController.init);
} else {
   SettingsController.init();
}
