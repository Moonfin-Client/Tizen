/*
 * Discover Controller (Row-based Layout)
 * Handles Jellyseerr content discovery with horizontal rows
 */

var DiscoverController = (function() {
    'use strict';

    var auth = null;
    var isLoading = false;
    
    // Focus management for row-based navigation
    var focusManager = {
        inNavBar: false,
        inRows: true,
        navBarIndex: 0,
        currentRowIndex: 0,
        currentItemIndex: 0,
        rows: [],
        rowPositions: {}, // Remember horizontal position in each row
        previousRowIndex: 0 // Track previous row for scroll direction
    };

    var elements = {};
    
    // Row configuration
    var rowConfigs = [
        { id: 'trending', title: 'Trending Now', apiMethod: 'getTrending', type: 'all' },
        { id: 'popularMovies', title: 'Popular Movies', apiMethod: 'getTrendingMovies', type: 'movie' },
        { id: 'popularTv', title: 'Popular TV Shows', apiMethod: 'getTrendingTv', type: 'tv' },
        { id: 'genreMovies', title: 'Browse Movies by Genre', apiMethod: 'getGenreSliderMovies', type: 'genreSlider', mediaType: 'movie' },
        { id: 'genreTv', title: 'Browse TV Shows by Genre', apiMethod: 'getGenreSliderTv', type: 'genreSlider', mediaType: 'tv' },
        { id: 'studios', title: 'Browse by Studio', apiMethod: 'getStudios', type: 'studios' },
        { id: 'networks', title: 'Browse by Network', apiMethod: 'getNetworks', type: 'networks' },
        { id: 'upcomingMovies', title: 'Upcoming Movies', apiMethod: 'getUpcomingMovies', type: 'movie' },
        { id: 'upcomingTv', title: 'Upcoming TV Shows', apiMethod: 'getUpcomingTv', type: 'tv' },
        { id: 'requests', title: 'My Requests', apiMethod: 'getRequests', type: 'requests' }
    ];
    
    // Store loaded data
    var rowData = {};
    
    // Pagination state for each row
    var rowPagination = {};
    
    // Popular streaming networks (hardcoded)
    var streamingNetworks = [
        { id: 213, name: 'Netflix', logo: 'wwemzKWzjKYJFfCeiB57q3r4Bcm.png' },
        { id: 2739, name: 'Disney+', logo: 'gJ8VX6JSu3ciXHuC2dDGAo2lvwM.png' },
        { id: 1024, name: 'Prime Video', logo: 'ifhbNuuVnlwYy5oXA5VIb2YR8AZ.png' },
        { id: 2552, name: 'Apple TV+', logo: '4KAy34EHvRM25Ih8wb82AuGU7zJ.png' },
        { id: 453, name: 'Hulu', logo: 'pqUTCleNUiTLAVlelGxUgWn1ELh.png' },
        { id: 49, name: 'HBO', logo: 'tuomPhY2UtuPTqqFnKMVHvSb724.png' },
        { id: 4353, name: 'Discovery+', logo: '1D1bS3Dyw4ScYnFWTlBOvJXC3nb.png' },
        { id: 2, name: 'ABC', logo: 'ndAvF4JLsliGreX87jAc9GdjmJY.png' },
        { id: 19, name: 'FOX', logo: '1DSpHrWyOORkL9N2QHX7Adt31mQ.png' },
        { id: 174, name: 'AMC', logo: 'pmvRmATOCaDykE6JrVoeYxlFHw3.png' },
        { id: 67, name: 'Showtime', logo: 'Allse9kbjiP6ExaQrnSpIhkurEi.png' },
        { id: 318, name: 'Starz', logo: '8GJjw3HHsAJYwIWKIPBPfqMxlEa.png' },
        { id: 71, name: 'The CW', logo: 'ge9hzeaU7nMtQ4PjkFlc68dGAJ9.png' },
        { id: 6, name: 'NBC', logo: 'o3OedEP0f9mfZr33jz2BfXOUK5.png' },
        { id: 16, name: 'CBS', logo: 'nm8d7P7MJNiBLdgIzUK0gkuEA4r.png' },
        { id: 4330, name: 'Paramount+', logo: 'fi83B1oztoS47xxcemFdPMhIzK.png' },
        { id: 4, name: 'BBC One', logo: 'mVn7xESaTNmjBUyUtGNvDQd3CT1.png' },
        { id: 56, name: 'Cartoon Network', logo: 'c5OC6oVCg6QP4eqzW6XIq17CQjI.png' },
        { id: 80, name: 'Adult Swim', logo: '9AKyspxVzywuaMuZ1Bvilu8sXly.png' },
        { id: 13, name: 'Nickelodeon', logo: 'ikZXxg6GnwpzqiZbRPhJGaZapqB.png' },
        { id: 3353, name: 'Peacock', logo: 'gIAcGTjKKr0KOHL5s4O36roJ8p7.png' }
    ];
    
    // Popular movie studios (hardcoded)
    var movieStudios = [
        { id: 2, name: 'Disney', logo: 'wdrCwmRnLFJhEoH8GSfymY85KHT.png' },
        { id: 127928, name: '20th Century Studios', logo: 'h0rjX5vjW5r8yEnUBStFarjcLT4.png' },
        { id: 34, name: 'Sony Pictures', logo: 'GagSvqWlyPdkFHMfQ3pNq6ix9P.png' },
        { id: 174, name: 'Warner Bros. Pictures', logo: 'ky0xOc5OrhzkZ1N6KyUxacfQsCk.png' },
        { id: 33, name: 'Universal', logo: '8lvHyhjr8oUKOOy2dKXoALWKdp0.png' },
        { id: 4, name: 'Paramount', logo: 'fycMZt242LVjagMByZOLUGbCvv3.png' },
        { id: 3, name: 'Pixar', logo: '1TjvGVDMYsj6JBxOAkUHpPEwLf7.png' },
        { id: 521, name: 'Dreamworks', logo: 'kP7t6RwGz2AvvTkvnI1uteEwHet.png' },
        { id: 420, name: 'Marvel Studios', logo: 'hUzeosd33nzE5MCNsZxCGEKTXaQ.png' },
        { id: 9993, name: 'DC', logo: '2Tc1P3Ac8M479naPp1kYT3izLS5.png' },
        { id: 41077, name: 'A24', logo: '1ZXsGaFPgrgS6ZZGS37AqD5uU12.png' }
    ];
    
    // Track rows currently loading more content
    var rowsLoadingMore = {};
    
    // Backdrop update debouncing
    var backdropUpdateTimer = null;
    const BACKDROP_UPDATE_DELAY = 300;
    const SCROLL_ANIMATION_DURATION_MS = 250;
    const SCROLL_THRESHOLD_PX = 2;
    const ROW_VERTICAL_POSITION = 0.45;
    
    // Horizontal scroll cooldown tracking
    var lastHorizontalScrollTime = 0;
    const SCROLL_COOLDOWN_MS = 300;

    /**
     * Initialize the discover controller
     */
    function init() {
        try {
            console.log('[Discover] init() called');
            auth = JellyfinAPI.getStoredAuth();
            if (!auth) {
                console.log('[Discover] No auth - would redirect to login but staying for debug');
                // window.location.href = 'login.html';
                // return;
            }
            console.log('[Discover] Auth:', auth ? 'found' : 'NOT FOUND');

            cacheElements();
            console.log('[Discover] Elements cached');
        
        // Check if running on Tizen without proxy service support
        // Jellyseerr requires cookie-based auth which needs a proxy service
        // that isn't available on Tizen web apps
        if (typeof tizen !== 'undefined') {
            console.log('[Discover] Tizen detected - checking for API key auth...');
            var settingsStr = storage.getUserPreference('jellyfin_settings', null);
            console.log('[Discover] Settings string:', settingsStr);
            var settings = null;
            var hasApiKey = false;
            var hasUrl = false;
            if (settingsStr) {
                try {
                    settings = JSON.parse(settingsStr);
                    console.log('[Discover] Settings - jellyseerrApiKey:', settings.jellyseerrApiKey ? 'SET' : 'NOT SET');
                    console.log('[Discover] Settings - jellyseerrUrl:', settings.jellyseerrUrl || 'NOT SET');
                    hasApiKey = settings.jellyseerrApiKey && settings.jellyseerrApiKey.length > 0;
                    hasUrl = settings.jellyseerrUrl && settings.jellyseerrUrl.length > 0;
                } catch (e) {
                    console.log('[Discover] Error parsing settings:', e);
                }
            }
            
            if (!hasApiKey) {
                console.log('[Discover] No Jellyseerr API key configured - feature not available on Tizen');
                showTizenNotSupported();
                return;
            }
            
            if (!hasUrl) {
                console.log('[Discover] No Jellyseerr URL configured');
                showConnectionRequired();
                return;
            }
            
            // On Tizen with API key, skip the normal flow and go straight to initialization
            console.log('[Discover] Tizen with API key - initializing directly...');
            
            // Initialize JellyseerrAPI directly with URL and API key
            var jellyseerrUrl = settings.jellyseerrUrl;
            var jellyseerrApiKey = settings.jellyseerrApiKey;
            
            console.log('[Discover] Jellyseerr URL:', jellyseerrUrl);
            console.log('[Discover] API Key length:', jellyseerrApiKey ? jellyseerrApiKey.length : 0);
            
            // Get user ID
            var userId = auth ? auth.userId : null;
            
            // Set API key first
            JellyseerrAPI.setApiKey(jellyseerrApiKey);
            
            // Initialize with URL
            JellyseerrAPI.initialize(jellyseerrUrl, jellyseerrApiKey, userId)
                .then(function() {
                    console.log('[Discover] JellyseerrAPI.initialize() succeeded');
                    console.log('[Discover] isInitialized:', JellyseerrAPI.isInitialized());
                    attachEventListeners();
                    loadAllRows();
                })
                .catch(function(error) {
                    console.error('[Discover] Error during initialization:', error);
                    showConnectionRequired();
                });
            
            loadAllRows();
            
            // Restore scroll position if returning from details
            var savedPosition = sessionStorage.getItem('discover_scroll_position');
            if (savedPosition) {
                try {
                    var position = JSON.parse(savedPosition);
                    console.log('[Discover] Restoring position:', position);
                    // Set position after content loads
                    setTimeout(function() {
                        if (position.rowIndex !== undefined && position.itemIndex !== undefined) {
                            focusManager.currentRowIndex = position.rowIndex;
                            focusManager.currentItemIndex = position.itemIndex;
                            updateFocus(position.rowIndex, position.itemIndex);
                        }
                        sessionStorage.removeItem('discover_scroll_position');
                    }, 500);
                } catch (e) {
                    console.error('[Discover] Error restoring position:', e);
                }
            }
            
            // Initialize navbar
            if (typeof NavbarController !== 'undefined') {
                NavbarController.init('discover');
            }
            return;
        }
        
        // Check if Jellyseerr is enabled and configured
        console.log('[Discover] Checking Jellyseerr connection...');
        if (!checkJellyseerrConnection()) {
            console.log('[Discover] Jellyseerr not configured, showing connection required');
            showConnectionRequired();
            return;
        }
        console.log('[Discover] Jellyseerr configured, initializing...');

        // Initialize Jellyseerr and wait for service check before auto-login
        initializeJellyseerr()
            .then(function() {
                console.log('[Discover] Jellyseerr initialized, attempting auto-login...');
                return JellyseerrAPI.attemptAutoLogin();
            })
            .then(function(success) {
                console.log('[Discover] Auto-login result:', success);
                if (success) {
                    attachEventListeners();
                    loadAllRows();
                } else {
                    // Authentication failed - show auth required message
                    console.log('[Discover] Auto-login failed, showing auth required message');
                    showAuthRequired();
                }
            })
            .catch(function(error) {
                console.error('[Discover] Error during initialization:', error);
                showAuthRequired();
            });
        
        // Initialize navbar
        if (typeof NavbarController !== 'undefined') {
            NavbarController.init('discover');
        }
        } catch (e) {
            console.error('[Discover] Error in init():', e);
            showConnectionRequired();
        }
    }

    /**
     * Cache DOM elements
     */
    function cacheElements() {
        elements.rowsContainer = document.getElementById('rowsContainer');
        elements.loadingIndicator = document.getElementById('loadingIndicator');
        elements.errorMessage = document.getElementById('errorMessage');
        elements.errorText = document.getElementById('errorText');
        elements.retryBtn = document.getElementById('retryBtn');
        elements.connectionRequired = document.getElementById('connectionRequired');
        elements.authRequired = document.getElementById('authRequired');
        elements.goToSettingsBtn = document.getElementById('goToSettingsBtn');
        elements.goBackBtn = document.getElementById('goBackBtn');
        elements.goToSettingsForAuthBtn = document.getElementById('goToSettingsForAuthBtn');
        elements.goBackFromAuthBtn = document.getElementById('goBackFromAuthBtn');
        elements.globalBackdropImage = document.getElementById('globalBackdropImage');
        elements.detailSection = document.getElementById('detailSection');
        elements.detailTitle = document.getElementById('detailTitle');
        elements.detailInfoRow = document.getElementById('detailInfoRow');
        elements.detailSummary = document.getElementById('detailSummary');
        
        // Cache row elements
        rowConfigs.forEach(function(config) {
            elements[config.id + 'Row'] = document.getElementById(config.id + 'Row');
            elements[config.id + 'Items'] = document.getElementById(config.id + 'Items');
        });
        
        // Stub getNetworks method
        if (!JellyseerrAPI.getNetworks) {
            JellyseerrAPI.getNetworks = function() {
                return Promise.resolve(streamingNetworks);
            };
        }
        
        // Stub getStudios method
        if (!JellyseerrAPI.getStudios) {
            JellyseerrAPI.getStudios = function() {
                return Promise.resolve(movieStudios);
            };
        }
    }

    /**
     * Check if Jellyseerr is properly configured
     */
    function checkJellyseerrConnection() {
        var settings = storage.getUserPreference('jellyfin_settings', null);
        if (!settings) return false;
        
        try {
            var parsedSettings = JSON.parse(settings);
            return parsedSettings.jellyseerrEnabled && parsedSettings.jellyseerrUrl;
        } catch (e) {
            return false;
        }
    }

    /**
     * Initialize Jellyseerr API
     */
    /**
     * Initialize Jellyseerr integration
     * @private
     */
    function initializeJellyseerr() {
        // First, load and set the API key if available
        var settings = storage.getUserPreference('jellyfin_settings', null);
        if (settings) {
            try {
                var parsedSettings = JSON.parse(settings);
                if (parsedSettings.jellyseerrApiKey && parsedSettings.jellyseerrApiKey.length > 0) {
                    console.log('[Discover] Setting API key for Jellyseerr');
                    JellyseerrAPI.setApiKey(parsedSettings.jellyseerrApiKey);
                }
            } catch (e) {}
        }
        
        // Try initializeFromPreferences first (for existing auth)
        return JellyseerrAPI.initializeFromPreferences()
            .then(function(success) {
                if (success) {
                    console.log('[Discover] initializeFromPreferences succeeded');
                    return success;
                }
                
                // If initializeFromPreferences returns false, it means no auth yet
                // But we still need to initialize the API with the server URL for login to work
                console.log('[Discover] initializeFromPreferences returned false, trying direct initialization');
                var settingsStr = storage.getUserPreference('jellyfin_settings', null);
                if (!settingsStr) return false;
                
                var parsedSettings = JSON.parse(settingsStr);
                if (!parsedSettings.jellyseerrUrl) return false;
                
                // Get user ID for cookie storage
                var auth = JellyfinAPI.getStoredAuth();
                var userId = auth && auth.userId ? auth.userId : null;
                
                // Initialize directly with just the server URL (no auth required)
                return JellyseerrAPI.initialize(parsedSettings.jellyseerrUrl, null, userId)
                    .then(function() {
                        console.log('[Discover] Direct initialization succeeded');
                        return false; // Return false because we're not authenticated yet
                    });
            });
    }

    /**
     * Show Tizen not supported message
     */
    function showTizenNotSupported() {
        // Create a modal to explain the limitation
        var modal = document.createElement('div');
        modal.className = 'settings-modal';
        modal.style.display = 'flex';
        modal.innerHTML = 
            '<div class="settings-modal-content">' +
                '<h2>Jellyseerr Not Available</h2>' +
                '<p style="margin: 20px 0; line-height: 1.6;">' +
                    'Jellyseerr requires cookie-based authentication which is not supported on Samsung Tizen TVs.<br><br>' +
                    '<strong>For Admins:</strong><br>' +
                    '1. Open Jellyseerr → Settings → General<br>' +
                    '2. Copy the API Key<br>' +
                    '3. In Moonfin: Settings → Jellyseerr → API Key<br><br>' +
                    '<strong>For Non-Admin Users:</strong><br>' +
                    'Unfortunately, Jellyseerr is not available on Tizen without admin access. ' +
                    'You can ask your Jellyseerr admin to provide the API key, but note that it grants full admin access.<br><br>' +
                    '<em>Alternatively, use Jellyseerr through a web browser.</em>' +
                '</p>' +
                '<button class="settings-btn" id="tizenBackBtn" style="cursor: pointer;">Go Back</button>' +
            '</div>';
        
        document.body.appendChild(modal);
        
        var backBtn = document.getElementById('tizenBackBtn');
        
        function goToBrowse(e) {
            if (e) e.preventDefault();
            window.location.href = 'browse.html';
        }
        
        backBtn.addEventListener('click', goToBrowse);
        backBtn.addEventListener('keydown', function(e) {
            if (e.keyCode === 13 || e.keyCode === 10009) { // Enter or Return
                goToBrowse(e);
            }
        });
        
        // Handle back button globally
        var backHandler = function(e) {
            if (e.keyCode === 10009 || e.keyCode === 27) { // Back or Escape
                e.preventDefault();
                e.stopPropagation();
                goToBrowse(e);
            }
        };
        document.addEventListener('keydown', backHandler);
        
        // Focus the button after DOM settles
        requestAnimationFrame(function() {
            backBtn.focus();
            console.log('[Discover] Modal button focused');
        });
    }

    /**
     * Show connection required message
     */
    function showConnectionRequired() {
        if (elements.connectionRequired) {
            elements.connectionRequired.style.display = 'flex';
        }
        
        setTimeout(function() {
            if (elements.goToSettingsBtn) {
                elements.goToSettingsBtn.focus();
            }
        }, 100);
    }

    /**
     * Show authentication required message
     */
    function showAuthRequired() {
        if (elements.authRequired) {
            elements.authRequired.style.display = 'flex';
        }
        
        setTimeout(function() {
            if (elements.goToSettingsForAuthBtn) {
                elements.goToSettingsForAuthBtn.focus();
            }
        }, 100);
    }

    /**
     * Attach event listeners
     */
    function attachEventListeners() {
        document.addEventListener('keydown', handleKeyPress);
        
        // Connection required buttons
        if (elements.goToSettingsBtn) {
            elements.goToSettingsBtn.addEventListener('click', function() {
                window.location.href = 'settings.html';
            });
        }
        if (elements.goBackBtn) {
            elements.goBackBtn.addEventListener('click', function() {
                window.location.href = 'browse.html';
            });
        }
        
        // Auth required buttons
        if (elements.goToSettingsForAuthBtn) {
            elements.goToSettingsForAuthBtn.addEventListener('click', function() {
                window.location.href = 'settings.html';
            });
        }
        if (elements.goBackFromAuthBtn) {
            elements.goBackFromAuthBtn.addEventListener('click', function() {
                window.location.href = 'browse.html';
            });
        }
        
        // Retry button
        if (elements.retryBtn) {
            elements.retryBtn.addEventListener('click', function() {
                loadAllRows();
            });
        }
    }

    /**
     * Load all rows on initialization
     */
    function loadAllRows() {
        console.log('[Discover] loadAllRows() called, isLoading:', isLoading);
        if (isLoading) return;
        
        isLoading = true;
        showLoading();
        console.log('[Discover] Loading content for', rowConfigs.length, 'rows');
        
        // Initialize pagination for each row
        rowConfigs.forEach(function(config) {
            rowPagination[config.id] = {
                currentPage: 1,
                totalPages: 1,
                hasMore: true
            };
        });
        
        var promises = rowConfigs.map(function(config) {
            return loadRowContent(config);
        });
        
        Promise.all(promises)
            .then(function() {
                hideLoading();
                isLoading = false;
                buildFocusableItemsCache();
                // Focus first item after content loads
                setTimeout(function() {
                    focusToFirstRow();
                }, 100);
            })
            .catch(function(error) {
                hideLoading();
                isLoading = false;
                showError('Failed to load content. Please try again.');
            });
    }

    /**
     * Load content for a specific row
     */
    function loadRowContent(config, page) {
        page = page || 1;
        
        return new Promise(function(resolve, reject) {
            var apiMethod = JellyseerrAPI[config.apiMethod];
            
            if (!apiMethod) {
                console.log('[Discover] No API method for', config.id);
                resolve();
                return;
            }
            
            // Handle genre slider rows (no pagination)
            if (config.type === 'genreSlider') {
                console.log('[Discover] Loading genre slider:', config.id);
                apiMethod.call(JellyseerrAPI)
                    .then(function(genres) {
                        console.log('[Discover] Genre slider', config.id, 'loaded:', genres.length, 'genres');
                        rowData[config.id] = genres;
                        renderGenreSliderRow(config.id, genres, config.mediaType);
                        resolve();
                    })
                    .catch(function(error) {
                        console.error('[Discover] Error loading genre slider', config.id, ':', error);
                        reject(error);
                    });
                return;
            }
            
            // Handle networks row (no API, use hardcoded data)
            if (config.type === 'networks') {
                console.log('[Discover] Loading networks row');
                rowData[config.id] = streamingNetworks;
                renderNetworksRow(config.id, streamingNetworks);
                resolve();
                return;
            }
            
            // Handle studios row (no API, use hardcoded data)
            if (config.type === 'studios') {
                console.log('[Discover] Loading studios row');
                rowData[config.id] = movieStudios;
                renderStudiosRow(config.id, movieStudios);
                resolve();
                return;
            }
            
            console.log('[Discover] Loading row:', config.id, 'method:', config.apiMethod, 'page:', page);
            var responseData; // Store response for pagination info
            
            apiMethod.call(JellyseerrAPI, { page: page })
                .then(function(response) {
                    console.log('[Discover] Row', config.id, 'loaded, results:', response.results ? response.results.length : 0);
                    responseData = response; // Capture response
                    var results = response.results || response || [];
                    
                    // Enrich requests with full media details (poster, backdrop, overview)
                    if (config.id === 'requests' && results.length > 0) {
                        return enrichRequestsWithMediaDetails(results);
                    }
                    
                    return results;
                })
                .then(function(results) {
                    // Filter NSFW content
                    results = filterNSFW(results);
                    
                    // Update pagination info
                    if (!rowPagination[config.id]) {
                        rowPagination[config.id] = {};
                    }
                    rowPagination[config.id].currentPage = page;
                    rowPagination[config.id].totalPages = responseData.totalPages || 1;
                    rowPagination[config.id].hasMore = page < (responseData.totalPages || 1);
                    
                    if (page === 1) {
                        rowData[config.id] = results;
                        renderRow(config.id, results);
                    } else {
                        // Deduplicate before appending - check if items already exist by ID
                        var existingData = rowData[config.id] || [];
                        var existingIds = existingData.map(function(item) { return item.id; });
                        var newResults = results.filter(function(item) {
                            return existingIds.indexOf(item.id) === -1;
                        });
                        
                        console.log('[Discover] Deduplication - existing:', existingData.length, 'new from API:', results.length, 'after dedup:', newResults.length);
                        
                        if (newResults.length > 0) {
                            // Append to existing data
                            rowData[config.id] = existingData.concat(newResults);
                            appendRowItems(config.id, newResults);
                        } else {
                            console.log('[Discover] All items were duplicates, skipping append');
                        }
                    }
                    
                    resolve();
                })
                .catch(function(error) {
                    console.error('[Discover] Error loading row', config.id, ':', error);
                    
                    // Handle session expiration
                    if (error.message && error.message.includes('Session expired')) {
                        JellyseerrAPI.handleSessionExpiration(function() {
                            // Retry the same page after re-initialization
                            return apiMethod.call(JellyseerrAPI, { page: page })
                                .then(function(response) {
                                    console.log('[Discover] Retry successful for row', config.id, 'page:', page, 'results:', response.results ? response.results.length : 0);
                                    responseData = response;
                                    var results = response.results || response || [];
                                    
                                    // Enrich requests if needed
                                    if (config.id === 'requests' && results.length > 0) {
                                        return enrichRequestsWithMediaDetails(results);
                                    }
                                    return results;
                                })
                                .then(function(results) {
                                    // Filter NSFW content
                                    results = filterNSFW(results);
                                    
                                    // Update pagination info
                                    if (!rowPagination[config.id]) {
                                        rowPagination[config.id] = {};
                                    }
                                    rowPagination[config.id].currentPage = page;
                                    rowPagination[config.id].totalPages = responseData.totalPages || 1;
                                    rowPagination[config.id].hasMore = page < (responseData.totalPages || 1);
                                    
                                    if (page === 1) {
                                        rowData[config.id] = results;
                                        renderRow(config.id, results);
                                    } else {
                                        // Deduplicate before appending - check if items already exist by ID
                                        var existingData = rowData[config.id] || [];
                                        var existingIds = existingData.map(function(item) { return item.id; });
                                        var newResults = results.filter(function(item) {
                                            return existingIds.indexOf(item.id) === -1;
                                        });
                                        
                                        console.log('[Discover] Deduplication - existing:', existingData.length, 'new from API:', results.length, 'after dedup:', newResults.length);
                                        
                                        if (newResults.length > 0) {
                                            // Append to existing data
                                            rowData[config.id] = existingData.concat(newResults);
                                            appendRowItems(config.id, newResults);
                                        } else {
                                            console.log('[Discover] All items were duplicates, skipping append');
                                        }
                                    }
                                    
                                    resolve();
                                });
                        }, 'Discover')
                            .catch(function(retryError) {
                                console.error('[Discover] Re-initialization failed for row:', config.id, retryError);
                                if (config.id === 'requests') {
                                    hideRow(config.id);
                                    resolve();
                                } else {
                                    reject(error);
                                }
                            });
                    } else if (config.id === 'requests') {
                        // If it's the requests row and fails (likely due to auth), just skip it
                        console.log('[Discover] Hiding requests row due to error');
                        hideRow(config.id);
                        resolve();
                    } else {
                        reject(error);
                    }
                });
        });
    }

    /**
     * Enrich requests with full media details
     * Fetches movie/TV details to get poster, backdrop, and overview
     */
    function enrichRequestsWithMediaDetails(requests) {
        // Fetch full details for each request in parallel
        var promises = requests.map(function(request) {
            var tmdbId = request.media && request.media.tmdbId;
            if (!tmdbId) {
                // No TMDB ID, return basic info
                return Promise.resolve(convertRequestToItem(request, null));
            }
            
            var mediaType = request.type; // 'movie' or 'tv'
            var detailsMethod = mediaType === 'movie' ? 'getMovieDetails' : 'getTvDetails';
            
            return JellyseerrAPI[detailsMethod](tmdbId)
                .then(function(details) {
                    return convertRequestToItem(request, details);
                })
                .catch(function(error) {
                    // If details fetch fails, use basic info
                    return convertRequestToItem(request, null);
                });
        });
        
        return Promise.all(promises);
    }

    /**
     * Convert a request object to a displayable item
     */
    function convertRequestToItem(request, fullDetails) {
        var media = request.media || {};
        
        // Use full details if available, otherwise fall back to request.media
        return {
            id: media.tmdbId || media.id || request.id,
            title: fullDetails ? (fullDetails.title || fullDetails.name) : (media.title || media.name),
            name: fullDetails ? (fullDetails.name || fullDetails.title) : (media.name || media.title),
            overview: fullDetails ? fullDetails.overview : media.overview,
            posterPath: fullDetails ? fullDetails.posterPath : media.posterPath,
            backdropPath: fullDetails ? fullDetails.backdropPath : media.backdropPath,
            releaseDate: fullDetails ? fullDetails.releaseDate : media.releaseDate,
            firstAirDate: fullDetails ? fullDetails.firstAirDate : media.firstAirDate,
            mediaType: request.type,
            voteAverage: fullDetails ? fullDetails.voteAverage : null,
            mediaInfo: {
                id: media.id,
                tmdbId: media.tmdbId,
                tvdbId: media.tvdbId,
                status: media.status,
                status4k: media.status4k,
                requests: media.requests
            }
        };
    }

    /**
     * Filter NSFW content based on settings
     */
    function filterNSFW(items) {
        var settingsStr = storage.getUserPreference('jellyfin_settings', null);
        var filterNSFW = true; // Default to filtering
        
        try {
            if (settingsStr) {
                var parsedSettings = JSON.parse(settingsStr);
                if (parsedSettings.jellyseerrFilterNSFW !== undefined) {
                    filterNSFW = parsedSettings.jellyseerrFilterNSFW;
                }
            }
        } catch (e) {
            // Use default
        }
        
        if (!filterNSFW) {
            return items; // Don't filter
        }
        
        return items.filter(function(item) {
            // Filter by adult flag
            if (item.adult === true) {
                return false;
            }
            
            // TODO: Add keyword blacklist filtering if needed
            
            return true;
        });
    }

    /**
     * Render a row with items
     */
    /**
     * Render genre slider row
     */
    function renderGenreSliderRow(rowId, genres) {
        var container = elements[rowId + 'Items'];
        if (!container) return;
        
        container.innerHTML = '';
        
        if (!genres || genres.length === 0) {
            hideRow(rowId);
            return;
        }
        
        var rowConfig = rowConfigs.find(function(r) { return r.id === rowId; });
        var mediaType = rowConfig ? rowConfig.mediaType : 'movie';
        
        genres.forEach(function(genre, index) {
            var card = document.createElement('div');
            card.className = 'content-card genre-slider-card';
            card.setAttribute('tabindex', '0');
            card.setAttribute('data-genre-id', genre.id);
            card.setAttribute('data-genre-name', genre.name);
            card.setAttribute('data-media-type', mediaType);
            card.setAttribute('data-row-id', rowId);
            card.setAttribute('data-index', index);
            
            // Use random backdrop image for variety (so genres don't show the same image)
            var backdropUrl = '';
            if (genre.backdrops && genre.backdrops.length > 0) {
                var randomIndex = Math.floor(Math.random() * genre.backdrops.length);
                backdropUrl = ImageHelper.getTMDBImageUrl(genre.backdrops[randomIndex], 'w1280');
            }
            
            var backdrop = document.createElement('img');
            backdrop.className = 'genre-slider-backdrop';
            backdrop.src = backdropUrl;
            backdrop.alt = genre.name;
            
            var overlay = document.createElement('div');
            overlay.className = 'genre-slider-overlay';
            
            var title = document.createElement('div');
            title.className = 'genre-slider-title';
            title.textContent = genre.name;
            
            overlay.appendChild(title);
            card.appendChild(backdrop);
            card.appendChild(overlay);
            
            // Add click handler to navigate to genre filter
            card.addEventListener('click', function() {
                navigateToGenre(genre.id, genre.name, mediaType);
            });
            
            // Add focus handler for backdrop update
            card.addEventListener('focus', function() {
                if (backdropUrl && elements.globalBackdropImage) {
                    elements.globalBackdropImage.src = backdropUrl;
                    elements.globalBackdropImage.style.display = 'block';
                    elements.globalBackdropImage.style.opacity = '1';
                }
            });
            
            container.appendChild(card);
        });
    }
    
    /**
     * Navigate to genre-filtered discover page
     */
    function navigateToGenre(genreId, genreName, mediaType) {
        console.log('[Discover] Navigate to genre:', genreName, 'ID:', genreId, 'Media type:', mediaType);
        window.location.href = 'browse-by.html?type=genre&id=' + genreId + '&name=' + encodeURIComponent(genreName) + '&mediaType=' + mediaType;
    }
    
    /**
     * Render networks row
     */
    function renderNetworksRow(rowId, networks) {
        var container = elements[rowId + 'Items'];
        if (!container) return;
        
        container.innerHTML = '';
        
        if (!networks || networks.length === 0) {
            hideRow(rowId);
            return;
        }
        
        networks.forEach(function(network, index) {
            var card = document.createElement('div');
            card.className = 'content-card network-card';
            card.setAttribute('tabindex', '0');
            card.setAttribute('data-network-id', network.id);
            card.setAttribute('data-network-name', network.name);
            card.setAttribute('data-row-id', rowId);
            card.setAttribute('data-index', index);
            
            var logoUrl = 'https://image.tmdb.org/t/p/w780_filter(duotone,ffffff,bababa)/' + network.logo;
            
            var logoContainer = document.createElement('div');
            logoContainer.className = 'network-logo-container';
            
            var logo = document.createElement('img');
            logo.className = 'network-logo';
            logo.src = logoUrl;
            logo.alt = network.name;
            
            logoContainer.appendChild(logo);
            card.appendChild(logoContainer);
            
            var gradient = document.createElement('div');
            gradient.className = 'network-gradient';
            card.appendChild(gradient);
            
            // Add click handler to navigate to network filter
            card.addEventListener('click', function() {
                navigateToNetwork(network.id, network.name);
            });
            
            container.appendChild(card);
        });
    }
    
    /**
     * Render studios row
     */
    function renderStudiosRow(rowId, studios) {
        var container = elements[rowId + 'Items'];
        if (!container) return;
        
        container.innerHTML = '';
        
        if (!studios || studios.length === 0) {
            hideRow(rowId);
            return;
        }
        
        studios.forEach(function(studio, index) {
            var card = document.createElement('div');
            card.className = 'content-card network-card';
            card.setAttribute('tabindex', '0');
            card.setAttribute('data-studio-id', studio.id);
            card.setAttribute('data-studio-name', studio.name);
            card.setAttribute('data-row-id', rowId);
            card.setAttribute('data-index', index);
            
            var logoUrl = 'https://image.tmdb.org/t/p/w780_filter(duotone,ffffff,bababa)/' + studio.logo;
            
            var logoContainer = document.createElement('div');
            logoContainer.className = 'network-logo-container';
            
            var logo = document.createElement('img');
            logo.className = 'network-logo';
            logo.src = logoUrl;
            logo.alt = studio.name;
            
            logoContainer.appendChild(logo);
            card.appendChild(logoContainer);
            
            var gradient = document.createElement('div');
            gradient.className = 'network-gradient';
            card.appendChild(gradient);
            
            // Add click handler to navigate to studio filter
            card.addEventListener('click', function() {
                navigateToStudio(studio.id, studio.name);
            });
            
            container.appendChild(card);
        });
    }
    
    /**
     * Navigate to network-filtered discover page
     */
    function navigateToNetwork(networkId, networkName) {
        console.log('[Discover] Navigate to network:', networkName, 'ID:', networkId);
        // Find the logo for this network
        var network = streamingNetworks.find(function(n) { return n.id === networkId; });
        var logo = network ? network.logo : '';
        window.location.href = 'browse-by.html?type=network&id=' + networkId + '&name=' + encodeURIComponent(networkName) + '&mediaType=tv&logo=' + encodeURIComponent(logo);
    }
    
    /**
     * Navigate to studio-filtered discover page
     */
    function navigateToStudio(studioId, studioName) {
        console.log('[Discover] Navigate to studio:', studioName, 'ID:', studioId);
        // Find the logo for this studio
        var studio = movieStudios.find(function(s) { return s.id === studioId; });
        var logo = studio ? studio.logo : '';
        window.location.href = 'browse-by.html?type=studio&id=' + studioId + '&name=' + encodeURIComponent(studioName) + '&mediaType=movie&logo=' + encodeURIComponent(logo);
    }
    
    /**
     * Render a media row
     */
    function renderRow(rowId, items) {
        var container = elements[rowId + 'Items'];
        if (!container) return;
        
        container.innerHTML = '';
        
        if (!items || items.length === 0) {
            hideRow(rowId);
            return;
        }
        
        items.forEach(function(item, index) {
            var card = createMediaCard(item, rowId, index);
            container.appendChild(card);
        });
    }
    
    /**
     * Append items to an existing row
     */
    function appendRowItems(rowId, items) {
        var container = elements[rowId + 'Items'];
        if (!container) return;
        
        var currentItemCount = rowData[rowId].length - items.length;
        
        items.forEach(function(item, index) {
            var card = createMediaCard(item, rowId, currentItemCount + index);
            container.appendChild(card);
        });
        
        // Update only this row's cards in the cache instead of rebuilding everything
        var rowIndex = focusManager.rows.findIndex(function(r) { return r.id === rowId; });
        if (rowIndex !== -1) {
            var cards = container.querySelectorAll('.content-card');
            focusManager.rows[rowIndex].cards = Array.from(cards);
        }
    }

    /**
     * Hide a row if it has no content
     */
    function hideRow(rowId) {
        var row = elements[rowId + 'Row'];
        if (row) {
            row.style.display = 'none';
        }
    }
    
    /**
     * Check if we should load more items for a row
     * Triggers when user focuses on items near the end
     */
    function checkAndLoadMoreItems(rowId, currentIndex) {
        var pagination = rowPagination[rowId];
        console.log('[discovery] checkAndLoadMoreItems - rowId:', rowId, 'currentIndex:', currentIndex, 'pagination:', pagination);
        
        if (!pagination || !pagination.hasMore) {
            console.log('[discovery] No more pages to load - hasMore:', pagination ? pagination.hasMore : 'no pagination');
            return;
        }
        
        // If already loading more for this row, skip
        if (rowsLoadingMore[rowId]) {
            console.log('[discovery] Already loading more for row:', rowId);
            return;
        }
        
        var items = rowData[rowId] || [];
        var itemsFromEnd = items.length - currentIndex - 1;
        console.log('[discovery] Items from end:', itemsFromEnd, 'total items:', items.length, 'currentIndex:', currentIndex);
        
        // Trigger load when within 5 items of the end
        if (itemsFromEnd <= 5) {
            console.log('[discovery] TRIGGERING pagination load for row:', rowId, 'next page:', pagination.currentPage + 1);
            rowsLoadingMore[rowId] = true;
            
            var config = rowConfigs.find(function(c) { return c.id === rowId; });
            if (!config) {
                rowsLoadingMore[rowId] = false;
                return;
            }
            
            var nextPage = pagination.currentPage + 1;
            
            loadRowContent(config, nextPage)
                .then(function() {
                    rowsLoadingMore[rowId] = false;
                })
                .catch(function(error) {
                    rowsLoadingMore[rowId] = false;
                });
        }
    }

    /**
     * Create a media card element
     */
    function createMediaCard(item, rowId, index) {
        var card = document.createElement('div');
        card.className = 'content-card';
        card.dataset.rowId = rowId;
        card.dataset.itemIndex = index;
        card.dataset.mediaId = item.id;
        card.dataset.mediaType = item.mediaType || 'movie';
        card.tabIndex = 0;
        
        // Store data for detail section
        card.dataset.title = item.title || item.name || '';
        card.dataset.overview = item.overview || '';
        card.dataset.releaseDate = item.releaseDate || item.firstAirDate || '';
        card.dataset.rating = item.voteAverage ? item.voteAverage.toFixed(1) : '';
        card.dataset.genres = (item.genres || []).map(function(g) { return g.name; }).join(', ');
        card.dataset.backdropUrl = item.backdropPath ? ImageHelper.getTMDBImageUrl(item.backdropPath, 'original') : '';
        
        var poster = document.createElement('div');
        poster.className = 'card-poster';
        
        if (item.posterPath) {
            var img = document.createElement('img');
            img.src = ImageHelper.getTMDBImageUrl(item.posterPath, 'w500');
            img.alt = item.title || item.name || 'Media poster';
            img.onerror = function() {
                this.style.display = 'none';
            };
            poster.appendChild(img);
        }
        
        // Add request status indicator if available
        if (item.mediaInfo && item.mediaInfo.status) {
            var statusBadge = document.createElement('div');
            statusBadge.className = 'status-badge status-' + item.mediaInfo.status;
            statusBadge.textContent = getStatusText(item.mediaInfo.status);
            poster.appendChild(statusBadge);
        }
        
        card.appendChild(poster);
        
        // Add click handler
        card.addEventListener('click', function() {
            openDetails(item);
        });
        
        // Add focus handler for backdrop update and infinite scroll
        card.addEventListener('focus', function() {
            updateBackdrop(item);
            // Use current focusManager index for pagination, not card's creation index
            checkAndLoadMoreItems(rowId, focusManager.currentItemIndex);
        });
        
        return card;
    }

    /**
     * Get status text from status code
     */
    function getStatusText(status) {
        var statusMap = {
            1: 'Pending',
            2: 'Processing',
            3: 'Available',
            4: 'Partially Available',
            5: 'Available'
        };
        return statusMap[status] || '';
    }

    /**
     * Update global backdrop
     */
    function updateBackdrop(item) {
        if (backdropUpdateTimer) {
            clearTimeout(backdropUpdateTimer);
        }
        
        backdropUpdateTimer = setTimeout(function() {
            // Check if current row is networks or studios - don't show backdrop
            var currentRow = focusManager.rows[focusManager.currentRowIndex];
            if (currentRow && (currentRow.id === 'networks' || currentRow.id === 'studios')) {
                if (elements.globalBackdropImage) {
                    elements.globalBackdropImage.style.opacity = '0';
                    elements.globalBackdropImage.style.display = 'none';
                }
                return;
            }
            
            if (!item.backdropPath) return;
            
            var backdropUrl = ImageHelper.getTMDBImageUrl(item.backdropPath, 'original');
            
            if (elements.globalBackdropImage) {
                elements.globalBackdropImage.src = backdropUrl;
                elements.globalBackdropImage.style.display = 'block';
                elements.globalBackdropImage.style.opacity = '1';
            }
        }, BACKDROP_UPDATE_DELAY);
    }

    /**
     * Open details page for an item
     */
    function openDetails(item) {
        // Check if content is available in Jellyfin (status 3, 4, or 5)
        if (item.mediaInfo && item.mediaInfo.status >= 3) {
            // Try to find in Jellyfin library
            searchJellyfinLibrary(item)
                .then(function(jellyfinItem) {
                    if (jellyfinItem) {
                        // Found in library, navigate to Jellyfin details
                        var url = 'details.html?id=' + jellyfinItem.Id;
                        if (jellyfinItem.MultiServerId) {
                            url += '&serverId=' + jellyfinItem.MultiServerId;
                        }
                        window.location.href = url;
                    } else {
                        // Not found, show Jellyseerr details (fallback to original behavior)
                        showJellyseerrDetails(item);
                    }
                })
                .catch(function(error) {
                    showJellyseerrDetails(item);
                });
        } else {
            // Not available, show Jellyseerr details
            showJellyseerrDetails(item);
        }
    }

    /**
     * Search Jellyfin library for matching content
     */
    function searchJellyfinLibrary(item) {
        return new Promise(function(resolve, reject) {
            var searchTerm = item.title || item.name;
            var year = null;
            
            // Extract year from release date
            if (item.releaseDate) {
                year = new Date(item.releaseDate).getFullYear();
            } else if (item.firstAirDate) {
                year = new Date(item.firstAirDate).getFullYear();
            }
            
            // Search Jellyfin library
            var searchUrl = auth.serverAddress + '/Items?' +
                'searchTerm=' + encodeURIComponent(searchTerm) +
                '&IncludeItemTypes=' + (item.mediaType === 'tv' ? 'Series' : 'Movie') +
                '&Recursive=true' +
                '&Fields=Overview,ProductionYear' +
                '&Limit=5' +
                '&api_key=' + auth.accessToken;
            
            ajax.get(searchUrl)
                .then(function(response) {
                    var results = response.Items || [];
                    
                    // Try to find exact match by year
                    if (year) {
                        var exactMatch = results.find(function(result) {
                            return result.ProductionYear === year;
                        });
                        if (exactMatch) {
                            resolve(exactMatch);
                            return;
                        }
                    }
                    
                    // Return first result if any
                    if (results.length > 0) {
                        resolve(results[0]);
                    } else {
                        resolve(null);
                    }
                })
                .catch(function(error) {
                    reject(error);
                });
        });
    }

    /**
     * Show Jellyseerr details
     */
    function showJellyseerrDetails(item) {
        var mediaType = item.mediaType || 'movie';
        var mediaId = item.id;
        // Save current scroll position
        sessionStorage.setItem('discover_scroll_position', JSON.stringify({
            rowIndex: focusManager.currentRowIndex,
            itemIndex: focusManager.currentItemIndex
        }));
        // Navigate to Jellyseerr details page
        window.location.href = 'jellyseerr-details.html?type=' + mediaType + '&id=' + mediaId;
    }

    /**
     * Build cache of focusable items for navigation
     */
    function buildFocusableItemsCache() {
        focusManager.rows = [];
        
        rowConfigs.forEach(function(config) {
            var rowElement = elements[config.id + 'Row'];
            var container = elements[config.id + 'Items'];
            if (!container || !rowElement || rowElement.style.display === 'none') return;
            
            var cards = container.querySelectorAll('.content-card');
            if (cards.length > 0) {
                focusManager.rows.push({
                    id: config.id,
                    element: rowElement,
                    container: container,
                    cards: Array.from(cards)
                });
            }
        });
    }

    /**
     * Focus to first row
     */
    function focusToFirstRow() {
        if (focusManager.rows.length === 0) return;
        
        focusManager.inNavBar = false;
        focusManager.inRows = true;
        focusManager.currentRowIndex = 0;
        focusManager.currentItemIndex = 0;
        
        updateFocus();
    }

    /**
     * Focus to navbar
     */
    function focusToNavBar() {
        focusManager.inNavBar = true;
        focusManager.inRows = false;
        
        var navButtons = document.querySelectorAll('.nav-left .nav-btn, .nav-center .nav-btn');
        if (navButtons.length > 0) {
            navButtons[focusManager.navBarIndex].focus();
        }
    }

    /**
     * Scroll item horizontally into view within its row
     * @param {HTMLElement} currentCard - The focused card
     * @param {HTMLElement} rowContainer - The row's items container
     */
    function scrollItemHorizontally(currentCard, rowContainer) {
        if (!currentCard || !rowContainer) return;
        
        // Check scroll cooldown to prevent excessive scroll calls
        var now = Date.now();
        if (now - lastHorizontalScrollTime < SCROLL_COOLDOWN_MS) {
            return;
        }
        
        var cardRect = currentCard.getBoundingClientRect();
        var containerRect = rowContainer.getBoundingClientRect();
        
        var HORIZONTAL_SCROLL_PADDING = 120;
        var EDGE_THRESHOLD = 200; // Increased from 100px for less aggressive scrolling
        
        // Calculate relative scroll adjustment needed
        var scrollAdjustment = 0;
        
        // Check if card is fully visible
        var cardFullyVisible = cardRect.left >= containerRect.left && cardRect.right <= containerRect.right;
        
        if (!cardFullyVisible) {
            if (cardRect.left < containerRect.left) {
                // Card is cut off on the left - scroll left to show full card
                scrollAdjustment = cardRect.left - (containerRect.left + HORIZONTAL_SCROLL_PADDING);
            } else if (cardRect.right > containerRect.right) {
                // Card is cut off on the right - scroll right to show full card
                scrollAdjustment = cardRect.right - (containerRect.right - HORIZONTAL_SCROLL_PADDING);
            }
        } else if (cardRect.left < containerRect.left + EDGE_THRESHOLD) {
            // Card is fully visible but near left edge - scroll left
            scrollAdjustment = cardRect.left - (containerRect.left + HORIZONTAL_SCROLL_PADDING);
        } else if (cardRect.right > containerRect.right - EDGE_THRESHOLD) {
            // Card is fully visible but near right edge - scroll right
            scrollAdjustment = cardRect.right - (containerRect.right - HORIZONTAL_SCROLL_PADDING);
        }
        
        if (Math.abs(scrollAdjustment) > 5) {
            lastHorizontalScrollTime = now;
            rowContainer.scrollBy({
                left: scrollAdjustment,
                behavior: 'smooth'
            });
        }
    }

    /**
     * Update focus on current item
     */
    function updateFocus() {
        // Remove all focused classes
        document.querySelectorAll('.content-card.focused').forEach(function(card) {
            card.classList.remove('focused');
        });
        
        if (!focusManager.inRows) return;
        
        var currentRow = focusManager.rows[focusManager.currentRowIndex];
        if (!currentRow) return;
        
        var currentCard = currentRow.cards[focusManager.currentItemIndex];
        if (!currentCard) return;
        
        console.log('[discovery] updateFocus - rowIndex:', focusManager.currentRowIndex, 'itemIndex:', focusManager.currentItemIndex, 'total cards:', currentRow.cards.length, 'card title:', currentCard.dataset.title);
        
        currentCard.classList.add('focused');
        currentCard.focus();
        
        // Update row visibility - fade rows above current
        updateRowVisibility();
        
        // Scroll card into view horizontally within the row
        scrollItemHorizontally(currentCard, currentRow.container);
        
        // Only apply vertical scroll when crossing row boundaries
        // This prevents forced repositioning on every LEFT/RIGHT navigation
        if (focusManager.currentRowIndex !== focusManager.previousRowIndex) {
            var scrollAdjustment = calculateVerticalScrollAdjustment(currentRow.element);
            applyVerticalScroll(scrollAdjustment);
            focusManager.previousRowIndex = focusManager.currentRowIndex;
        }
        
        // Update detail section after scroll starts (prevents layout interference)
        requestAnimationFrame(function() {
            updateDetailSection(currentCard);
        });
    }
    
    /**
     * Update visibility of rows based on current focus
     * Fade rows above the current focused row for better context
     */
    function updateRowVisibility() {
        focusManager.rows.forEach(function(row, index) {
            if (index < focusManager.currentRowIndex) {
                // Fade rows above current (not completely hidden)
                row.element.style.opacity = '0.2';
                row.element.style.pointerEvents = 'none';
            } else {
                // Show current and below rows
                row.element.style.opacity = '1';
                row.element.style.pointerEvents = 'auto';
            }
        });
    }

    /**
     * Update detail section with current item info
     */
    function updateDetailSection(card) {
        if (!elements.detailSection || !elements.detailTitle || !elements.detailInfoRow || !elements.detailSummary) {
            return;
        }
        
        if (!card || !card.dataset) {
            return;
        }
        
        var data = card.dataset;
        var rowId = data.rowId;
        
        // Hide detail section for genre slider, networks, and studios rows
        if (rowId === 'genreMovies' || rowId === 'genreTv' || rowId === 'networks' || rowId === 'studios') {
            elements.detailSection.style.display = 'none';
            if (elements.rowsContainer) {
                elements.rowsContainer.classList.remove('with-detail');
            }
            
            // Hide backdrop for networks and studios
            if ((rowId === 'networks' || rowId === 'studios') && elements.globalBackdropImage) {
                elements.globalBackdropImage.style.opacity = '0';
                elements.globalBackdropImage.style.display = 'none';
            }
            return;
        }
        
        // Show detail section and add padding to rows container
        elements.detailSection.style.display = 'block';
        if (elements.rowsContainer) {
            elements.rowsContainer.classList.add('with-detail');
        }
        
        // Update backdrop
        if (elements.globalBackdropImage && data.backdropUrl) {
            elements.globalBackdropImage.src = data.backdropUrl;
            elements.globalBackdropImage.style.display = 'block';
            elements.globalBackdropImage.style.opacity = '1';
        }
        
        // Update title
        elements.detailTitle.textContent = data.title || data.name || 'Unknown Title';
        
        // Clear and populate info row with badges
        elements.detailInfoRow.innerHTML = '';
        
        if (data.releaseDate) {
            var year = data.releaseDate.split('-')[0];
            if (year) {
                var yearBadge = document.createElement('span');
                yearBadge.className = 'info-badge';
                yearBadge.textContent = year;
                elements.detailInfoRow.appendChild(yearBadge);
            }
        }
        
        if (data.rating) {
            var ratingBadge = document.createElement('span');
            ratingBadge.className = 'info-badge';
            ratingBadge.textContent = data.rating;
            elements.detailInfoRow.appendChild(ratingBadge);
        }
        
        if (data.mediaType) {
            var typeBadge = document.createElement('span');
            typeBadge.className = 'info-badge';
            typeBadge.textContent = data.mediaType === 'tv' ? 'TV Show' : 'Movie';
            elements.detailInfoRow.appendChild(typeBadge);
        }
        
        if (data.genres) {
            var genresBadge = document.createElement('span');
            genresBadge.className = 'info-badge';
            genresBadge.textContent = data.genres;
            elements.detailInfoRow.appendChild(genresBadge);
        }
        
        // Update summary
        elements.detailSummary.textContent = data.overview || 'No description available.';
    }

    /**
     * Calculate vertical scroll adjustment to position row in viewport
     * @param {HTMLElement} currentRowElement - The current focused row element
     * @returns {number} Scroll adjustment in pixels
     */
    function calculateVerticalScrollAdjustment(currentRowElement) {
        if (!currentRowElement) return 0;
        
        var mainContent = document.querySelector('.main-content');
        if (!mainContent) return 0;
        
        // Use row title as the reference point for consistent positioning
        var rowTitle = currentRowElement.querySelector('.row-title');
        var referenceElement = rowTitle || currentRowElement;
        var rowRect = referenceElement.getBoundingClientRect();
        var mainRect = mainContent.getBoundingClientRect();
        
        // Position row title at configured viewport height (45% from top)
        var targetPosition = mainRect.top + (mainRect.height * ROW_VERTICAL_POSITION);
        var scrollAdjustment = rowRect.top - targetPosition;
        
        // No special constraints - all rows positioned consistently
        
        return Math.abs(scrollAdjustment) > SCROLL_THRESHOLD_PX ? scrollAdjustment : 0;
    }
    
    /**
     * Apply smooth vertical scroll animation
     * @param {number} scrollAdjustment - Target scroll adjustment in pixels
     */
    function applyVerticalScroll(scrollAdjustment) {
        if (scrollAdjustment === 0) return;
        
        var mainContent = document.querySelector('.main-content');
        if (mainContent) {
            var startScroll = mainContent.scrollTop;
            var targetScroll = startScroll + scrollAdjustment;
            var startTime = null;
            
            function animateScroll(currentTime) {
                if (!startTime) startTime = currentTime;
                var elapsed = currentTime - startTime;
                var progress = Math.min(elapsed / SCROLL_ANIMATION_DURATION_MS, 1);
                
                // Spring-like easing for more natural feel
                var easeProgress = progress < 0.5
                    ? 4 * progress * progress * progress
                    : 1 - Math.pow(-2 * progress + 2, 3) / 2;
                
                mainContent.scrollTop = startScroll + (scrollAdjustment * easeProgress);
                
                if (progress < 1) {
                    requestAnimationFrame(animateScroll);
                }
            }
            
            requestAnimationFrame(animateScroll);
        }
    }

    /**
     * Handle modal keyboard navigation
     */
    function handleModalNavigation(evt) {
        var activeElement = document.activeElement;
        
        switch (evt.keyCode) {
            case KeyCodes.LEFT:
                evt.preventDefault();
                if (activeElement === elements.goBackBtn && elements.goToSettingsBtn) {
                    elements.goToSettingsBtn.focus();
                }
                break;
                
            case KeyCodes.RIGHT:
                evt.preventDefault();
                if (activeElement === elements.goToSettingsBtn && elements.goBackBtn) {
                    elements.goBackBtn.focus();
                }
                break;
                
            case KeyCodes.ENTER:
            case KeyCodes.OK:
                evt.preventDefault();
                if (activeElement === elements.goToSettingsBtn) {
                    window.location.href = 'settings.html';
                } else if (activeElement === elements.goBackBtn) {
                    window.location.href = 'browse.html';
                }
                break;
                
            case KeyCodes.BACK:
                evt.preventDefault();
                window.location.href = 'browse.html';
                break;
        }
    }

    /**
     * Handle keyboard navigation
     */
    function handleKeyPress(evt) {
        // If connection modal is visible, handle modal navigation only
        if (elements.connectionRequired && elements.connectionRequired.style.display !== 'none') {
            handleModalNavigation(evt);
            return;
        }
        
        if (evt.keyCode === KeyCodes.BACK) {
            evt.preventDefault();
            if (focusManager.inRows) {
                focusToNavBar();
            } else if (focusManager.inNavBar) {
                window.history.back();
            }
            return;
        }
        
        if (focusManager.inNavBar) {
            handleNavBarNavigation(evt);
        } else if (focusManager.inRows) {
            handleRowNavigation(evt);
        }
    }

    /**
     * Handle navbar navigation
     */
    function handleNavBarNavigation(evt) {
        var navButtons = Array.from(document.querySelectorAll('.nav-left .nav-btn, .nav-center .nav-btn')).filter(function(btn) {
            return btn.offsetParent !== null; // Only include visible buttons
        });
        
        switch (evt.keyCode) {
            case KeyCodes.LEFT:
                evt.preventDefault();
                if (focusManager.navBarIndex > 0) {
                    focusManager.navBarIndex--;
                    navButtons[focusManager.navBarIndex].focus();
                }
                break;
                
            case KeyCodes.RIGHT:
                evt.preventDefault();
                if (focusManager.navBarIndex < navButtons.length - 1) {
                    focusManager.navBarIndex++;
                    navButtons[focusManager.navBarIndex].focus();
                }
                break;
                
            case KeyCodes.DOWN:
                evt.preventDefault();
                focusToFirstRow();
                break;
                
            case KeyCodes.ENTER:
                evt.preventDefault();
                var currentBtn = navButtons[focusManager.navBarIndex];
                if (currentBtn) {
                    currentBtn.click();
                }
                break;
        }
    }

    /**
     * Handle row-based navigation
     */
    function handleRowNavigation(evt) {
        if (focusManager.rows.length === 0) return;
        
        var currentRow = focusManager.rows[focusManager.currentRowIndex];
        if (!currentRow) return;
        
        switch (evt.keyCode) {
            case KeyCodes.LEFT:
                evt.preventDefault();
                console.log('[discovery] LEFT pressed - current:', focusManager.currentItemIndex, 'row length:', currentRow.cards.length);
                if (focusManager.currentItemIndex > 0) {
                    focusManager.currentItemIndex--;
                    console.log('[discovery] Moving LEFT to index:', focusManager.currentItemIndex);
                    updateFocus();
                } else {
                    console.log('[discovery] Already at first item');
                }
                break;
                
            case KeyCodes.RIGHT:
                evt.preventDefault();
                console.log('[discovery] RIGHT pressed - current:', focusManager.currentItemIndex, 'row length:', currentRow.cards.length);
                if (focusManager.currentItemIndex < currentRow.cards.length - 1) {
                    focusManager.currentItemIndex++;
                    console.log('[discovery] Moving RIGHT to index:', focusManager.currentItemIndex);
                    updateFocus();
                } else {
                    console.log('[discovery] Already at last item');
                }
                break;
                
            case KeyCodes.UP:
                evt.preventDefault();
                console.log('[discovery] UP pressed - current row:', focusManager.currentRowIndex);
                if (focusManager.currentRowIndex > 0) {
                    // Save current position before moving
                    focusManager.rowPositions[focusManager.currentRowIndex] = focusManager.currentItemIndex;
                    focusManager.previousRowIndex = focusManager.currentRowIndex;
                    
                    focusManager.currentRowIndex--;
                    console.log('[discovery] Moving UP to row:', focusManager.currentRowIndex);
                    
                    // Restore previous position or default to 0
                    focusManager.currentItemIndex = focusManager.rowPositions[focusManager.currentRowIndex] || 0;
                    
                    // Bounds check
                    var newRow = focusManager.rows[focusManager.currentRowIndex];
                    if (focusManager.currentItemIndex >= newRow.cards.length) {
                        focusManager.currentItemIndex = newRow.cards.length - 1;
                    }
                    
                    updateFocus();
                } else {
                    // At top row, go to navbar
                    focusToNavBar();
                }
                break;
                
            case KeyCodes.DOWN:
                evt.preventDefault();
                console.log('[discovery] DOWN pressed - current row:', focusManager.currentRowIndex);
                if (focusManager.currentRowIndex < focusManager.rows.length - 1) {
                    // Save current position before moving
                    focusManager.previousRowIndex = focusManager.currentRowIndex;
                    focusManager.rowPositions[focusManager.currentRowIndex] = focusManager.currentItemIndex;
                    
                    focusManager.currentRowIndex++;
                    console.log('[discovery] Moving DOWN to row:', focusManager.currentRowIndex);
                    
                    // Restore previous position or default to 0
                    focusManager.currentItemIndex = focusManager.rowPositions[focusManager.currentRowIndex] || 0;
                    
                    // Bounds check
                    var newRow = focusManager.rows[focusManager.currentRowIndex];
                    if (focusManager.currentItemIndex >= newRow.cards.length) {
                        focusManager.currentItemIndex = newRow.cards.length - 1;
                    }
                    
                    updateFocus();
                }
                break;
                
            case KeyCodes.ENTER:
                evt.preventDefault();
                var currentCard = currentRow.cards[focusManager.currentItemIndex];
                if (currentCard) {
                    currentCard.click();
                }
                break;
        }
    }

    /**
     * Show loading indicator
     */
    function showLoading() {
        if (elements.loadingIndicator) {
            elements.loadingIndicator.style.display = 'flex';
        }
        if (elements.rowsContainer) {
            elements.rowsContainer.style.display = 'none';
        }
    }

    /**
     * Hide loading indicator
     */
    function hideLoading() {
        if (elements.loadingIndicator) {
            elements.loadingIndicator.style.display = 'none';
        }
        if (elements.rowsContainer) {
            elements.rowsContainer.style.display = 'block';
        }
    }

    /**
     * Show error message
     */
    function showError(message) {
        if (elements.errorMessage) {
            elements.errorMessage.style.display = 'flex';
        }
        if (elements.errorText) {
            elements.errorText.textContent = message;
        }
        if (elements.rowsContainer) {
            elements.rowsContainer.style.display = 'none';
        }
    }

    // Public API
    return {
        init: init
    };
})();

// Initialize on page load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', DiscoverController.init);
} else {
    DiscoverController.init();
}
