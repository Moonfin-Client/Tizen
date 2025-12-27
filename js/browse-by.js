/**
 * Browse By Controller
 * Manages content browsing filtered by genre or network with pagination,
 * sorting, and filtering capabilities.
 * @module BrowseByController
 */
var BrowseByController = (function() {
    'use strict';

    var elements = {};
    var browseType = null;
    var browseId = null;
    var browseName = null;
    var mediaType = null;
    var items = [];
    var currentPage = 1;
    var totalPages = 1;
    var isLoading = false;
    var currentSort = 'popularity.desc';
    var currentFilter = 'all';
    
    var focusManager = {
        inGrid: true,
        inControls: false,
        inModal: false,
        currentGridIndex: 0,
        currentControlIndex: 0,
        currentModalIndex: 0
    };
    
    var cachedCards = null;
    var cacheVersion = 0;

    /**
     * Retrieves cached card elements, recomputing only when grid version changes.
     * @private
     * @returns {HTMLElement[]} Array of content card elements
     */
    function getCards() {
        var currentVersion = parseInt(elements.contentGrid.getAttribute('data-version') || '0');
        if (!cachedCards || currentVersion !== cacheVersion) {
            cachedCards = Array.from(elements.contentGrid.querySelectorAll('.content-card'));
            cacheVersion = currentVersion;
        }
        return cachedCards;
    }
    
    /**
     * Invalidates card cache by updating grid version.
     * Call after adding/removing cards from grid.
     * @private
     */
    function invalidateCardCache() {
        var newVersion = Date.now();
        elements.contentGrid.setAttribute('data-version', newVersion);
        cachedCards = null;
    }

    /**
     * Initializes the browse-by controller.
     * Sets up DOM elements, URL parameters, navigation, and event listeners.
     * @public
     */
    function init() {
        console.log('[BrowseBy] Initializing controller');
        
        getElements();
        parseUrlParams();
        NavbarController.init('discover');
        
        setTimeout(function() {
            var navButtons = document.querySelectorAll('.nav-btn');
            navButtons.forEach(function(btn) {
                btn.addEventListener('keydown', function(e) {
                    if (e.keyCode === KeyCodes.DOWN) {
                        e.preventDefault();
                        e.stopPropagation();
                        console.log('[BrowseBy] DOWN from navbar, returning to controls');
                        focusManager.inControls = true;
                        focusManager.inGrid = false;
                        elements.sortBtn.focus();
                    }
                });
            });
        }, 500);
        
        // Setup event listeners
        setupEventListeners();
        
        // Initialize Jellyseerr API - assumes auth is already done from discover page
        initializeJellyseerr()
            .then(function() {
                console.log('[BrowseBy] Initialization complete, loading content');
                return loadContent();
            })
            .then(function() {
                // Restore scroll position if returning from details
                var savedPosition = sessionStorage.getItem('browse_by_scroll_position');
                if (savedPosition) {
                    try {
                        var position = JSON.parse(savedPosition);
                        console.log('[BrowseBy] Restoring position:', position);
                        // Verify we're on the same browse page
                        if (position.browseType === browseType && position.browseId === browseId) {
                            setTimeout(function() {
                                if (position.gridIndex !== undefined) {
                                    focusManager.currentGridIndex = position.gridIndex;
                                    var cards = getCards();
                                    if (cards[position.gridIndex]) {
                                        cards[position.gridIndex].focus();
                                    }
                                }
                                sessionStorage.removeItem('browse_by_scroll_position');
                            }, 500);
                        }
                    } catch (e) {
                        console.error('[BrowseBy] Error restoring position:', e);
                    }
                }
            })
            .catch(function(error) {
                console.error('[BrowseBy] Initialization error:', error);
                showError('Failed to load content. Please try again.');
            });
    }

    /**
     * Caches references to DOM elements.
     * @private
     */
    function getElements() {
        elements.headerTitle = document.getElementById('headerTitle');
        elements.headerImage = document.getElementById('headerImage');
        elements.headerLogo = document.getElementById('headerLogo');
        elements.sortBtn = document.getElementById('sortBtn');
        elements.filterBtn = document.getElementById('filterBtn');
        elements.activeFiltersDisplay = document.getElementById('activeFiltersDisplay');
        elements.loadingIndicator = document.getElementById('loadingIndicator');
        elements.errorMessage = document.getElementById('errorMessage');
        elements.errorText = document.getElementById('errorText');
        elements.retryBtn = document.getElementById('retryBtn');
        elements.contentGrid = document.getElementById('contentGrid');
        elements.emptyState = document.getElementById('emptyState');
        elements.sortModal = document.getElementById('sortModal');
        elements.filterModal = document.getElementById('filterModal');
        elements.sortModalClose = document.getElementById('sortModalClose');
        elements.filterModalClose = document.getElementById('filterModalClose');
        elements.globalBackdropImage = document.getElementById('globalBackdropImage');
        
        // Hide backdrop initially
        if (elements.globalBackdropImage) {
            elements.globalBackdropImage.style.display = 'none';
            elements.globalBackdropImage.style.opacity = '0';
        }
    }

    /**
     * Parses URL query parameters and updates page state.
     * Extracts browse type, ID, name, and media type from URL.
     * @private
     */
    function parseUrlParams() {
        var params = new URLSearchParams(window.location.search);
        browseType = params.get('type'); // 'genre', 'network', 'studio', or 'keyword'
        browseId = params.get('id');
        browseName = params.get('name');
        mediaType = params.get('mediaType') || 'movie';
        
        console.log('[BrowseBy] Params:', { browseType: browseType, browseId: browseId, browseName: browseName, mediaType: mediaType });
        
        // Update header
        if (browseType === 'genre') {
            elements.headerTitle.textContent = browseName || 'Genre';
            elements.headerImage.style.display = 'none';
        } else if (browseType === 'network' || browseType === 'studio') {
            elements.headerTitle.style.display = 'none';
            elements.headerImage.style.display = 'block';
            // Network/Studio logos use TMDB filter
            var logoPath = params.get('logo');
            if (logoPath) {
                elements.headerLogo.src = 'https://image.tmdb.org/t/p/w780_filter(duotone,ffffff,bababa)/' + logoPath;
            }
            elements.headerLogo.alt = browseName || (browseType === 'studio' ? 'Studio' : 'Network');
        } else if (browseType === 'keyword') {
            elements.headerTitle.textContent = browseName || 'Keyword';
            elements.headerImage.style.display = 'none';
        }
    }

    /**
     * Initializes Jellyseerr API connection with stored preferences.
     * Attempts auto-login if no stored session exists.
     * @private
     * @returns {Promise<void>} Resolves when API is initialized
     */
    function initializeJellyseerr() {
        console.log('[BrowseBy] Initializing Jellyseerr API...');
        
        // Check if running on Tizen - use API key auth
        if (typeof tizen !== 'undefined') {
            console.log('[BrowseBy] Tizen detected - checking for API key auth...');
            var settingsStr = storage.getUserPreference('jellyfin_settings', null);
            console.log('[BrowseBy] Settings string:', settingsStr);
            var settings = null;
            var hasApiKey = false;
            var hasUrl = false;
            
            if (settingsStr) {
                try {
                    settings = JSON.parse(settingsStr);
                    console.log('[BrowseBy] Settings - jellyseerrApiKey:', settings.jellyseerrApiKey ? 'SET' : 'NOT SET');
                    console.log('[BrowseBy] Settings - jellyseerrUrl:', settings.jellyseerrUrl || 'NOT SET');
                    hasApiKey = settings.jellyseerrApiKey && settings.jellyseerrApiKey.length > 0;
                    hasUrl = settings.jellyseerrUrl && settings.jellyseerrUrl.length > 0;
                } catch (e) {
                    console.log('[BrowseBy] Error parsing settings:', e);
                }
            }
            
            if (!hasApiKey || !hasUrl) {
                console.log('[BrowseBy] No Jellyseerr configuration found');
                return Promise.reject(new Error('Jellyseerr not configured'));
            }
            
            // On Tizen with API key, initialize directly
            console.log('[BrowseBy] Tizen with API key - initializing directly...');
            
            var jellyseerrUrl = settings.jellyseerrUrl;
            var jellyseerrApiKey = settings.jellyseerrApiKey;
            
            console.log('[BrowseBy] Jellyseerr URL:', jellyseerrUrl);
            console.log('[BrowseBy] API Key length:', jellyseerrApiKey ? jellyseerrApiKey.length : 0);
            
            // Get user ID
            var auth = JellyfinAPI.getStoredAuth();
            var userId = auth ? auth.userId : null;
            
            // Set API key first
            JellyseerrAPI.setApiKey(jellyseerrApiKey);
            
            // Initialize with URL
            return JellyseerrAPI.initialize(jellyseerrUrl, jellyseerrApiKey, userId)
                .then(function() {
                    console.log('[BrowseBy] JellyseerrAPI.initialize() succeeded');
                    console.log('[BrowseBy] isInitialized:', JellyseerrAPI.isInitialized());
                    return Promise.resolve();
                })
                .catch(function(error) {
                    console.error('[BrowseBy] Error during initialization:', error);
                    return Promise.reject(error);
                });
        }
        
        // Non-Tizen: Try to initialize from stored preferences first
        return JellyseerrAPI.initializeFromPreferences()
            .then(function(success) {
                if (success) {
                    console.log('[BrowseBy] Initialized from preferences');
                    return Promise.resolve();
                }
                
                // If no stored session, initialize with server URL and attempt auto-login
                console.log('[BrowseBy] No stored session, initializing with server URL');
                var settingsStr = storage.getUserPreference('jellyfin_settings', null);
                if (!settingsStr) {
                    return Promise.reject(new Error('No Jellyfin settings found'));
                }
                
                var parsedSettings = JSON.parse(settingsStr);
                if (!parsedSettings.jellyseerrUrl) {
                    return Promise.reject(new Error('No Jellyseerr URL configured'));
                }
                
                var auth = JellyfinAPI.getStoredAuth();
                var userId = auth && auth.userId ? auth.userId : null;
                
                // Initialize API with server URL
                return JellyseerrAPI.initialize(parsedSettings.jellyseerrUrl, null, userId)
                    .then(function() {
                        // Try auto-login
                        return JellyseerrAPI.attemptAutoLogin();
                    })
                    .then(function(loginSuccess) {
                        if (loginSuccess) {
                            console.log('[BrowseBy] Auto-login successful');
                            return Promise.resolve();
                        } else {
                            console.log('[BrowseBy] Auto-login failed, API initialized without auth');
                            return Promise.resolve();
                        }
                    });
            });
    }

    /**
     * Attaches event listeners for buttons, modals, and keyboard navigation.
     * @private
     */
    function setupEventListeners() {
        elements.sortBtn.addEventListener('click', function() {
            openSortModal();
        });
        
        elements.filterBtn.addEventListener('click', function() {
            openFilterModal();
        });
        
        elements.retryBtn.addEventListener('click', function() {
            loadContent();
        });
        
        elements.sortModalClose.addEventListener('click', function() {
            closeSortModal();
        });
        
        elements.filterModalClose.addEventListener('click', function() {
            closeFilterModal();
        });
        var sortOptions = elements.sortModal.querySelectorAll('.modal-option');
        sortOptions.forEach(function(option) {
            option.addEventListener('click', function() {
                var sort = this.getAttribute('data-sort');
                currentSort = sort;
                currentPage = 1;
                closeSortModal();
                loadContent();
            });
        });
        
        var filterOptions = elements.filterModal.querySelectorAll('.modal-option');
        filterOptions.forEach(function(option) {
            option.addEventListener('click', function() {
                var filter = this.getAttribute('data-filter');
                currentFilter = filter;
                currentPage = 1;
                
                // Update active state
                filterOptions.forEach(function(opt) { opt.classList.remove('active'); });
                this.classList.add('active');
                
                closeFilterModal();
                loadContent();
            });
        });
        
        document.addEventListener('keydown', handleKeyDown);
    }

    /**
     * Loads content from Jellyseerr API based on current browse type and filters.
     * Handles pagination, sorting, and filtering.
     * @private
     */
    function loadContent() {
        if (isLoading) return;
        
        isLoading = true;
        elements.loadingIndicator.style.display = 'flex';
        elements.errorMessage.style.display = 'none';
        elements.contentGrid.style.display = 'none';
        elements.emptyState.style.display = 'none';
        
        var discoverOptions = {
            page: currentPage,
            sortBy: currentSort
        };
        
        if (browseType === 'genre') {
            discoverOptions.genre = browseId;
        } else if (browseType === 'network') {
            discoverOptions.network = browseId;
        } else if (browseType === 'studio') {
            discoverOptions.studio = browseId;
        }
        
        var apiMethod = mediaType === 'movie' 
            ? JellyseerrAPI.discoverMovies 
            : JellyseerrAPI.discoverTv;
        
        apiMethod.call(JellyseerrAPI, discoverOptions)
            .then(function(response) {
                console.log('[BrowseBy] Content loaded:', response);
                isLoading = false;
                
                items = response.results || [];
                totalPages = response.totalPages || 1;
                
                console.log('[BrowseBy] Before filter, items count:', items.length, 'Filter:', currentFilter);
                
                // Apply filter
                if (currentFilter === 'available') {
                    items = items.filter(function(item) {
                        return item.mediaInfo && (item.mediaInfo.status === 3 || item.mediaInfo.status === 4 || item.mediaInfo.status === 5);
                    });
                } else if (currentFilter === 'requested') {
                    items = items.filter(function(item) {
                        return item.mediaInfo && (item.mediaInfo.status === 1 || item.mediaInfo.status === 2);
                    });
                }
                // 'all' filter doesn't filter anything
                
                console.log('[BrowseBy] After filter, items count:', items.length);
                
                renderContent();
            })
            .catch(function(error) {
                console.error('[BrowseBy] Error loading content:', error);
                isLoading = false;
                
                // Handle session expiration
                if (error.message && error.message.includes('Session expired')) {
                    JellyseerrAPI.handleSessionExpiration(function() {
                        loadContent();
                        return Promise.resolve();
                    }, 'BrowseBy')
                        .catch(function(retryError) {
                            console.error('[BrowseBy] Re-initialization failed:', retryError);
                            showError('Session expired. Please return to discover page.');
                        });
                } else {
                    // Check if it's an authentication error
                    var errorMessage = error && error.message ? error.message : 'Failed to load content';
                    if (errorMessage.includes('authenticate')) {
                        showError('Please authenticate with Jellyseerr in Settings');
                    } else {
                        showError(errorMessage);
                    }
                }
            });
    }

    /**
     * Loads additional content for pagination.
     * Appends new items to existing grid without replacing current content.
     * @private
     */
    function loadMoreContent() {
        if (isLoading) return;
        
        console.log('[BrowseBy] Loading more content, page:', currentPage);
        isLoading = true;
        
        var discoverOptions = {
            sortBy: currentSort,
            page: currentPage
        };
        
        if (browseType === 'genre') {
            discoverOptions.genre = browseId;
        } else if (browseType === 'network') {
            discoverOptions.network = browseId;
        } else if (browseType === 'keyword') {
            discoverOptions.keywords = browseId;
        }
        
        var apiMethod = mediaType === 'movie' 
            ? JellyseerrAPI.discoverMovies 
            : JellyseerrAPI.discoverTv;
        
        apiMethod.call(JellyseerrAPI, discoverOptions)
            .then(function(response) {
                console.log('[BrowseBy] More content loaded:', response);
                isLoading = false;
                
                // Update totalPages from response (important for keyword filters)
                totalPages = response.totalPages || totalPages;
                
                var newItems = response.results || [];
                
                // Apply filter
                if (currentFilter === 'available') {
                    newItems = newItems.filter(function(item) {
                        return item.mediaInfo && (item.mediaInfo.status === 3 || item.mediaInfo.status === 4 || item.mediaInfo.status === 5);
                    });
                } else if (currentFilter === 'requested') {
                    newItems = newItems.filter(function(item) {
                        return item.mediaInfo && (item.mediaInfo.status === 1 || item.mediaInfo.status === 2);
                    });
                }
                
                console.log('[BrowseBy] Filtered new items count:', newItems.length);
                
                // Append new items to existing array
                var startIndex = items.length;
                items = items.concat(newItems);
                
                // Render new cards
                newItems.forEach(function(item, index) {
                    var card = createCard(item, startIndex + index);
                    elements.contentGrid.appendChild(card);
                });
                
                // Invalidate cache after appending new cards
                invalidateCardCache();
                
                console.log('[BrowseBy] Total items now:', items.length);
            })
            .catch(function(error) {
                console.error('[BrowseBy] Error loading more content:', error);
                isLoading = false;
                currentPage--; // Revert page increment
                
                // Handle session expiration
                if (error.message && error.message.includes('Session expired')) {
                    JellyseerrAPI.handleSessionExpiration(function() {
                        currentPage++; // Re-increment page
                        loadMoreContent();
                        return Promise.resolve();
                    }, 'BrowseBy')
                        .catch(function(retryError) {
                            console.error('[BrowseBy] Re-initialization failed:', retryError);
                        });
                }
            });
    }

    /**
     * Renders content grid with current items.
     * Clears existing grid and rebuilds with filtered/sorted items.
     * @private
     */
    function renderContent() {
        elements.loadingIndicator.style.display = 'none';
        
        if (items.length === 0) {
            elements.emptyState.style.display = 'block';
            return;
        }
        
        elements.contentGrid.style.display = 'grid';
        elements.contentGrid.innerHTML = '';
        
        items.forEach(function(item, index) {
            var card = createCard(item, index);
            elements.contentGrid.appendChild(card);
        });
        
        // Invalidate cache after grid rebuild
        invalidateCardCache();
        
        // Focus first card in grid initially
        setTimeout(function() {
            var cards = getCards();
            if (cards.length > 0) {
                cards[0].classList.add('focused');
                cards[0].focus();
                focusManager.inGrid = true;
                focusManager.inControls = false;
                focusManager.currentGridIndex = 0;
            }
        }, 100);
    }

    /**
     * Creates a content card element for a media item.
     * @private
     * @param {Object} item - Media item data
     * @param {number} index - Index position in grid
     * @returns {HTMLElement} Content card element
     */
    function createCard(item, index) {
        var card = document.createElement('div');
        card.className = 'content-card';
        card.setAttribute('tabindex', '0');
        card.setAttribute('data-index', index);
        card.setAttribute('data-id', item.id);
        card.setAttribute('data-media-type', item.mediaType || mediaType);
        
        var posterContainer = document.createElement('div');
        posterContainer.className = 'card-poster';
        
        if (item.posterPath) {
            var poster = document.createElement('img');
            poster.src = ImageHelper.getTMDBImageUrl(item.posterPath, 'w500');
            poster.alt = item.title || item.name;
            posterContainer.appendChild(poster);
        } else {
            var placeholder = document.createElement('div');
            placeholder.className = 'poster-placeholder';
            placeholder.textContent = '🎬';
            posterContainer.appendChild(placeholder);
        }
        
        // Status badge
        if (item.mediaInfo && item.mediaInfo.status) {
            var badge = document.createElement('div');
            badge.className = 'status-badge';
            
            if (item.mediaInfo.status >= 3) {
                badge.classList.add('available');
                badge.textContent = 'Available';
            } else if (item.mediaInfo.status === 1 || item.mediaInfo.status === 2) {
                badge.classList.add('requested');
                badge.textContent = 'Requested';
            }
            
            posterContainer.appendChild(badge);
        }
        
        card.appendChild(posterContainer);
        
        var cardInfo = document.createElement('div');
        cardInfo.className = 'card-info';
        
        var title = document.createElement('div');
        title.className = 'card-title';
        title.textContent = item.title || item.name || 'Unknown';
        cardInfo.appendChild(title);
        
        var meta = document.createElement('div');
        meta.className = 'card-meta';
        
        // Year
        var year = null;
        if (item.releaseDate) {
            year = new Date(item.releaseDate).getFullYear();
        } else if (item.firstAirDate) {
            year = new Date(item.firstAirDate).getFullYear();
        }
        if (year) {
            var yearSpan = document.createElement('span');
            yearSpan.className = 'card-year';
            yearSpan.textContent = year;
            meta.appendChild(yearSpan);
        }
        
        // Rating
        if (item.voteAverage) {
            var rating = document.createElement('span');
            rating.className = 'card-rating';
            rating.textContent = '⭐ ' + item.voteAverage.toFixed(1);
            meta.appendChild(rating);
        }
        
        cardInfo.appendChild(meta);
        card.appendChild(cardInfo);
        
        // Click handler
        card.addEventListener('click', function() {
            navigateToDetails(item.id, item.mediaType || mediaType);
        });
        
        // Focus handler for backdrop and index sync
        card.addEventListener('focus', function() {
            // Sync grid index
            var index = parseInt(this.getAttribute('data-index'));
            if (!isNaN(index)) {
                focusManager.currentGridIndex = index;
                console.log('[BrowseBy] Card focused, syncing index to', index);
            }
            
            if (item.backdropPath && elements.globalBackdropImage) {
                var backdropUrl = ImageHelper.getTMDBImageUrl(item.backdropPath, 'original');
                elements.globalBackdropImage.src = backdropUrl;
                elements.globalBackdropImage.style.display = 'block';
                elements.globalBackdropImage.style.opacity = '1';
            }
        });
        
        return card;
    }

    /**
     * Navigates to Jellyseerr details page for selected media item.
     * @private
     * @param {string|number} id - TMDB media ID
     * @param {string} type - Media type ('movie' or 'tv')
     */
    function navigateToDetails(id, type) {
        // Save current scroll position
        sessionStorage.setItem('browse_by_scroll_position', JSON.stringify({
            gridIndex: focusManager.currentGridIndex,
            browseType: browseType,
            browseId: browseId,
            browseName: browseName,
            mediaType: mediaType
        }));
        window.location.href = 'jellyseerr-details.html?type=' + type + '&id=' + id;
    }

    /**
     * Handles keyboard navigation for grid, controls, and modals.
     * Supports arrow keys, enter, and back button.
     * @private
     * @param {KeyboardEvent} event - Keyboard event
     */
    function handleKeyDown(event) {
        var keyCode = event.keyCode;
        console.log('[BrowseBy] Key pressed:', keyCode, 'Modal:', focusManager.inModal, 'Controls:', focusManager.inControls, 'Grid:', focusManager.inGrid, 'GridIndex:', focusManager.currentGridIndex);
        
        // Handle modal navigation
        if (focusManager.inModal) {
            handleModalKeyDown(event);
            return;
        }
        
        // Back button
        if (keyCode === KeyCodes.BACK || keyCode === KeyCodes.ESC) {
            event.preventDefault();
            console.log('[BrowseBy] Back button pressed');
            window.history.back();
            return;
        }
        
        // Navigation between controls and grid
        if (keyCode === KeyCodes.UP) {
            event.preventDefault();
            console.log('[BrowseBy] UP pressed');
            if (focusManager.inControls) {
                // Move to navbar
                console.log('[BrowseBy] Moving from controls to navbar');
                focusManager.inControls = false;
                NavbarController.focusNavbar();
            } else if (focusManager.inGrid) {
                var cards = getCards();
                var currentIndex = focusManager.currentGridIndex;
                // Calculate columns based on grid width and card size
                var gridWidth = elements.contentGrid.offsetWidth;
                var cols = Math.floor(gridWidth / 220); // 200px card + 20px gap
                console.log('[BrowseBy] Grid calculations - Width:', gridWidth, 'Cols:', cols, 'Cards:', cards.length);
                
                if (currentIndex < cols) {
                    // Move to controls
                    console.log('[BrowseBy] Moving from grid to controls');
                    focusManager.inGrid = false;
                    focusManager.inControls = true;
                    // Remove focused class from all cards
                    cards.forEach(function(c) { c.classList.remove('focused'); });
                    elements.sortBtn.focus();
                } else {
                    // Move up in grid
                    var newIndex = Math.max(0, currentIndex - cols);
                    console.log('[BrowseBy] Moving up in grid from', currentIndex, 'to', newIndex);
                    focusManager.currentGridIndex = newIndex;
                    // Remove focused class from all cards
                    cards.forEach(function(c) { c.classList.remove('focused'); });
                    // Add focused class and focus
                    cards[newIndex].classList.add('focused');
                    cards[newIndex].focus();
                    cards[newIndex].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
            }
        } else if (keyCode === KeyCodes.DOWN) {
            event.preventDefault();
            console.log('[BrowseBy] DOWN pressed');
            if (focusManager.inControls) {
                // Move to grid
                console.log('[BrowseBy] Moving from controls to grid');
                focusManager.inControls = false;
                focusManager.inGrid = true;
                var cards = getCards();
                if (cards.length > 0) {
                    focusManager.currentGridIndex = 0;
                    // Remove focused class from all cards
                    cards.forEach(function(c) { c.classList.remove('focused'); });
                    // Add focused class and focus
                    cards[0].classList.add('focused');
                    cards[0].focus();
                    cards[0].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
            } else if (focusManager.inGrid) {
                var cards = getCards();
                var currentIndex = focusManager.currentGridIndex;
                // Calculate columns based on grid width and card size
                var gridWidth = elements.contentGrid.offsetWidth;
                var cols = Math.floor(gridWidth / 220); // 200px card + 20px gap
                var newIndex = Math.min(cards.length - 1, currentIndex + cols);
                
                if (newIndex !== currentIndex) {
                    console.log('[BrowseBy] Moving down in grid from', currentIndex, 'to', newIndex);
                    focusManager.currentGridIndex = newIndex;
                    // Remove focused class from all cards
                    cards.forEach(function(c) { c.classList.remove('focused'); });
                    // Add focused class and focus
                    cards[newIndex].classList.add('focused');
                    cards[newIndex].focus();
                    cards[newIndex].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    
                    // Check if we need to load more content (within 2 rows of bottom)
                    var itemsFromEnd = cards.length - 1 - newIndex;
                    var rowsFromEnd = Math.floor(itemsFromEnd / cols);
                    if (rowsFromEnd <= 2 && currentPage < totalPages && !isLoading) {
                        console.log('[BrowseBy] Near bottom (rows from end:', rowsFromEnd, '), loading next page:', currentPage + 1, 'of', totalPages);
                        currentPage++;
                        loadMoreContent();
                    }
                } else if (newIndex === cards.length - 1 && currentPage < totalPages && !isLoading) {
                    // At bottom of grid and more pages available
                    console.log('[BrowseBy] At bottom, loading next page:', currentPage + 1, 'of', totalPages);
                    currentPage++;
                    loadMoreContent();
                }
            }
        } else if (keyCode === KeyCodes.LEFT) {
            event.preventDefault();
            console.log('[BrowseBy] LEFT pressed');
            if (focusManager.inControls) {
                // Toggle between sort and filter
                if (document.activeElement === elements.filterBtn) {
                    console.log('[BrowseBy] Moving from Filter to Sort button');
                    elements.sortBtn.focus();
                }
            } else if (focusManager.inGrid) {
                var cards = getCards();
                var currentIndex = focusManager.currentGridIndex;
                
                if (currentIndex > 0) {
                    console.log('[BrowseBy] Moving left in grid from', currentIndex, 'to', currentIndex - 1);
                    focusManager.currentGridIndex = currentIndex - 1;
                    // Remove focused class from all cards
                    cards.forEach(function(c) { c.classList.remove('focused'); });
                    // Add focused class and focus
                    cards[currentIndex - 1].classList.add('focused');
                    cards[currentIndex - 1].focus();
                    cards[currentIndex - 1].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
            }
        } else if (keyCode === KeyCodes.RIGHT) {
            event.preventDefault();
            console.log('[BrowseBy] RIGHT pressed');
            if (focusManager.inControls) {
                // Toggle between sort and filter
                if (document.activeElement === elements.sortBtn) {
                    console.log('[BrowseBy] Moving from Sort to Filter button');
                    elements.filterBtn.focus();
                }
            } else if (focusManager.inGrid) {
                var cards = getCards();
                var currentIndex = focusManager.currentGridIndex;
                
                if (currentIndex < cards.length - 1) {
                    console.log('[BrowseBy] Moving right in grid from', currentIndex, 'to', currentIndex + 1);
                    focusManager.currentGridIndex = currentIndex + 1;
                    // Remove focused class from all cards
                    cards.forEach(function(c) { c.classList.remove('focused'); });
                    // Add focused class and focus
                    cards[currentIndex + 1].classList.add('focused');
                    cards[currentIndex + 1].focus();
                    cards[currentIndex + 1].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
            }
        } else if (keyCode === KeyCodes.ENTER || keyCode === KeyCodes.OK) {
            console.log('[BrowseBy] ENTER pressed');
            if (focusManager.inGrid) {
                event.preventDefault();
                var cards = getCards();
                var card = cards[focusManager.currentGridIndex];
                if (card) {
                    var id = card.getAttribute('data-id');
                    var type = card.getAttribute('data-media-type');
                    console.log('[BrowseBy] Navigating to details:', id, type);
                    navigateToDetails(id, type);
                }
            }
        }
    }

    /**
     * Handles keyboard navigation within modal dialogs.
     * @private
     * @param {KeyboardEvent} event - Keyboard event
     */
    function handleModalKeyDown(event) {
        var keyCode = event.keyCode;
        var modal = elements.sortModal.style.display !== 'none' ? elements.sortModal : elements.filterModal;
        var options = Array.from(modal.querySelectorAll('.modal-option, .modal-close'));
        
        if (keyCode === KeyCodes.UP) {
            event.preventDefault();
            if (focusManager.currentModalIndex > 0) {
                focusManager.currentModalIndex--;
                options[focusManager.currentModalIndex].focus();
            }
        } else if (keyCode === KeyCodes.DOWN) {
            event.preventDefault();
            if (focusManager.currentModalIndex < options.length - 1) {
                focusManager.currentModalIndex++;
                options[focusManager.currentModalIndex].focus();
            }
        } else if (keyCode === KeyCodes.BACK || keyCode === KeyCodes.ESC) {
            event.preventDefault();
            if (elements.sortModal.style.display !== 'none') {
                closeSortModal();
            } else {
                closeFilterModal();
            }
        }
    }

    /**
     * Opens sort modal and focuses first option.
     * @private
     */
    function openSortModal() {
        elements.sortModal.style.display = 'flex';
        focusManager.inModal = true;
        focusManager.inControls = false;
        focusManager.currentModalIndex = 0;
        
        var options = Array.from(elements.sortModal.querySelectorAll('.modal-option'));
        if (options.length > 0) {
            options[0].focus();
        }
    }

    /**
     * Closes sort modal and returns focus to sort button.
     * @private
     */
    function closeSortModal() {
        elements.sortModal.style.display = 'none';
        focusManager.inModal = false;
        focusManager.inControls = true;
        elements.sortBtn.focus();
    }

    /**
     * Opens filter modal and focuses first option.
     * @private
     */
    function openFilterModal() {
        elements.filterModal.style.display = 'flex';
        focusManager.inModal = true;
        focusManager.inControls = false;
        focusManager.currentModalIndex = 0;
        
        var options = Array.from(elements.filterModal.querySelectorAll('.modal-option'));
        if (options.length > 0) {
            options[0].focus();
        }
    }

    /**
     * Closes filter modal and returns focus to filter button.
     * @private
     */
    function closeFilterModal() {
        elements.filterModal.style.display = 'none';
        focusManager.inModal = false;
        focusManager.inControls = true;
        elements.filterBtn.focus();
    }

    /**
     * Displays error message and hides other content.
     * @private
     * @param {string} message - Error message to display
     */
    function showError(message) {
        elements.loadingIndicator.style.display = 'none';
        elements.contentGrid.style.display = 'none';
        elements.emptyState.style.display = 'none';
        elements.errorMessage.style.display = 'flex';
        elements.errorText.textContent = message;
    }

    return {
        init: init
    };
})();

document.addEventListener('DOMContentLoaded', function() {
    BrowseByController.init();
});
