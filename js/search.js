var SearchController = (function() {
    'use strict';

    let auth = null;
    let searchTimeout = null;
    let jellyseerrEnabled = false;
    let currentResults = {
        movies: [],
        shows: [],
        episodes: [],
        people: [],
        jellyseerr: []
    };
    
    const focusManager = {
        currentRow: -1,  // -1 for search input, 0-3 for result rows
        currentItem: 0,
        inInput: true,
        inNavBar: false,
        navBarIndex: 0
    };

    let elements = {};

    // Search Constants
    const SEARCH_DEBOUNCE_MS = 300;
    const MIN_SEARCH_LENGTH = 2;
    const FOCUS_DELAY_MS = 100;
    const SEARCH_INPUT_DEBOUNCE_MS = 500;

    /**
     * Initialize the search controller
     * Caches elements, sets up listeners, and focuses search input
     */
    function init() {
        
        auth = JellyfinAPI.getStoredAuth();
        if (!auth) {
            window.location.href = 'login.html';
            return;
        }

        
        cacheElements();
        initializeJellyseerr();
        setupNavbar();
        setupEventListeners();
        
        // Focus search input on load and open keyboard
        setTimeout(function() {
            if (elements.searchInput) {
                focusManager.inInput = true;
                elements.searchInput.focus();
            }
        }, 100);
    }

    /**
     * Cache frequently accessed DOM elements for better performance
     * @private
     */
    function cacheElements() {
        elements = {
            searchInput: document.getElementById('searchInput'),
            clearBtn: document.getElementById('clearBtn'),
            emptyState: document.getElementById('emptyState'),
            loadingIndicator: document.getElementById('loadingIndicator'),
            resultsContainer: document.getElementById('resultsContainer'),
            noResults: document.getElementById('noResults'),
            noResultsQuery: document.getElementById('noResultsQuery'),
            moviesRow: document.getElementById('moviesRow'),
            showsRow: document.getElementById('showsRow'),
            episodesRow: document.getElementById('episodesRow'),
            castRow: document.getElementById('castRow'),
            jellyseerrRow: document.getElementById('jellyseerrRow'),
            moviesList: document.getElementById('moviesList'),
            showsList: document.getElementById('showsList'),
            episodesList: document.getElementById('episodesList'),
            castList: document.getElementById('castList'),
            jellyseerrList: document.getElementById('jellyseerrList')
        };
    }

    /**
     * Initialize Jellyseerr integration
     * @private
     */
    function initializeJellyseerr() {
        // Check if running on Tizen - use API key auth
        if (typeof tizen !== 'undefined') {
            console.log('[Search] Tizen detected - checking for API key auth...');
            var settingsStr = storage.getUserPreference('jellyfin_settings', null);
            console.log('[Search] Settings string:', settingsStr);
            var settings = null;
            var hasApiKey = false;
            var hasUrl = false;
            
            if (settingsStr) {
                try {
                    settings = JSON.parse(settingsStr);
                    console.log('[Search] Settings - jellyseerrApiKey:', settings.jellyseerrApiKey ? 'SET' : 'NOT SET');
                    console.log('[Search] Settings - jellyseerrUrl:', settings.jellyseerrUrl || 'NOT SET');
                    hasApiKey = settings.jellyseerrApiKey && settings.jellyseerrApiKey.length > 0;
                    hasUrl = settings.jellyseerrUrl && settings.jellyseerrUrl.length > 0;
                } catch (e) {
                    console.log('[Search] Error parsing settings:', e);
                }
            }
            
            if (!hasApiKey || !hasUrl) {
                console.log('[Search] No Jellyseerr configuration found');
                jellyseerrEnabled = false;
                return Promise.resolve(false);
            }
            
            // On Tizen with API key, initialize directly
            console.log('[Search] Tizen with API key - initializing directly...');
            
            var jellyseerrUrl = settings.jellyseerrUrl;
            var jellyseerrApiKey = settings.jellyseerrApiKey;
            
            console.log('[Search] Jellyseerr URL:', jellyseerrUrl);
            console.log('[Search] API Key length:', jellyseerrApiKey ? jellyseerrApiKey.length : 0);
            
            // Get user ID
            var auth = JellyfinAPI.getStoredAuth();
            var userId = auth ? auth.userId : null;
            
            // Set API key first
            JellyseerrAPI.setApiKey(jellyseerrApiKey);
            
            // Initialize with URL
            return JellyseerrAPI.initialize(jellyseerrUrl, jellyseerrApiKey, userId)
                .then(function() {
                    console.log('[Search] JellyseerrAPI.initialize() succeeded');
                    console.log('[Search] isInitialized:', JellyseerrAPI.isInitialized());
                    jellyseerrEnabled = true;
                    return true;
                })
                .catch(function(error) {
                    console.error('[Search] Error during initialization:', error);
                    jellyseerrEnabled = false;
                    return false;
                });
        }
        
        // Non-Tizen: Try initializeFromPreferences first (for existing auth)
        return JellyseerrAPI.initializeFromPreferences()
            .then(function(success) {
                if (success) {
                    console.log('[Search] initializeFromPreferences succeeded');
                    jellyseerrEnabled = true;
                    return success;
                }
                
                // If initializeFromPreferences returns false, it means no auth yet
                // But we still need to initialize the API with the server URL for searches to work
                console.log('[Search] initializeFromPreferences returned false, trying direct initialization');
                var settingsStr = storage.getUserPreference('jellyfin_settings', null);
                if (!settingsStr) {
                    jellyseerrEnabled = false;
                    return false;
                }
                
                try {
                    var parsedSettings = JSON.parse(settingsStr);
                    if (!parsedSettings.jellyseerrUrl) {
                        jellyseerrEnabled = false;
                        return false;
                    }
                    
                    // Get user ID for cookie storage
                    var auth = JellyfinAPI.getStoredAuth();
                    var userId = auth && auth.userId ? auth.userId : null;
                    
                    // Initialize directly with just the server URL (no auth required)
                    return JellyseerrAPI.initialize(parsedSettings.jellyseerrUrl, null, userId)
                        .then(function() {
                            console.log('[Search] Direct initialization succeeded');
                            // Try auto-login to get authenticated
                            return JellyseerrAPI.attemptAutoLogin()
                                .then(function(loginSuccess) {
                                    jellyseerrEnabled = loginSuccess;
                                    console.log('[Search] Auto-login result:', loginSuccess);
                                    return loginSuccess;
                                });
                        })
                        .catch(function(error) {
                            console.error('[Search] Direct initialization failed:', error);
                            jellyseerrEnabled = false;
                            return false;
                        });
                } catch (e) {
                    console.error('[Search] Settings parsing failed:', e);
                    jellyseerrEnabled = false;
                    return false;
                }
            });
    }

    /**
     * Load navbar component dynamically
     * @private
     */
    function setupNavbar() {
        const navbarScript = document.createElement('script');
        navbarScript.src = 'js/navbar.js';
        document.body.appendChild(navbarScript);
    }

    /**
     * Set up keyboard and input event listeners
     * @private
     */
    function setupEventListeners() {
        // Search input
        if (elements.searchInput) {
            elements.searchInput.addEventListener('input', handleSearchInput);
            elements.searchInput.addEventListener('keydown', handleInputKeyDown);
        }

        // Clear button
        if (elements.clearBtn) {
            elements.clearBtn.addEventListener('click', clearSearch);
        }

        // Home button navigation
        setTimeout(function() {
            const homeBtn = document.getElementById('homeBtn');
            if (homeBtn) {
                homeBtn.addEventListener('click', function() {
                    window.location.href = 'browse.html';
                });
            }
        }, SEARCH_INPUT_DEBOUNCE_MS);

        // Global keyboard navigation
        document.addEventListener('keydown', handleGlobalKeyDown);
    }

    /**
     * Handle search input changes with debouncing
     * @param {Event} evt - Input event
     * @private
     */
    function handleSearchInput(evt) {
        const query = evt.target.value.trim();
        
        console.log('[Search] Input value:', evt.target.value);
        console.log('[Search] Query after trim:', query);
        
        // Show/hide clear button
        if (elements.clearBtn) {
            elements.clearBtn.style.display = query ? 'block' : 'none';
        }

        // Debounce search
        if (searchTimeout) {
            clearTimeout(searchTimeout);
        }

        if (query.length < MIN_SEARCH_LENGTH) {
            showEmptyState();
            return;
        }

        searchTimeout = setTimeout(function() {
            performSearch(query);
        }, SEARCH_DEBOUNCE_MS);
    }

    /**
     * Handle keyboard navigation when search input is focused
     * @param {KeyboardEvent} evt - Keyboard event
     * @private
     */
    function handleInputKeyDown(evt) {
        switch (evt.keyCode) {
            case KeyCodes.UP:
                evt.preventDefault();
                focusToNavBar();
                break;
            case KeyCodes.DOWN:
                evt.preventDefault();
                focusFirstResult();
                break;
            case KeyCodes.BACK:
                evt.preventDefault();
                window.history.back();
                break;
        }
    }

    /**
     * Handle keyboard navigation in search results
     * @param {KeyboardEvent} evt - Keyboard event
     * @private
     */
    function handleGlobalKeyDown(evt) {
        if (focusManager.inInput) return;

        // Handle navbar navigation separately
        if (focusManager.inNavBar) {
            handleNavBarNavigation(evt);
            return;
        }

        const visibleRows = getVisibleRows();
        if (visibleRows.length === 0) return;

        switch (evt.keyCode) {
            case KeyCodes.UP:
                evt.preventDefault();
                if (focusManager.currentRow > 0) {
                    focusManager.currentRow--;
                    updateFocus();
                } else {
                    focusSearchInput();
                }
                break;

            case KeyCodes.DOWN:
                evt.preventDefault();
                if (focusManager.currentRow < visibleRows.length - 1) {
                    focusManager.currentRow++;
                    updateFocus();
                }
                break;

            case KeyCodes.LEFT:
                evt.preventDefault();
                if (focusManager.currentItem > 0) {
                    focusManager.currentItem--;
                    updateFocus();
                }
                break;

            case KeyCodes.RIGHT:
                evt.preventDefault();
                const currentRowData = getCurrentRowData();
                if (currentRowData && focusManager.currentItem < currentRowData.length - 1) {
                    focusManager.currentItem++;
                    updateFocus();
                }
                break;

            case KeyCodes.ENTER:
                evt.preventDefault();
                selectCurrentItem();
                break;

            case KeyCodes.BACK:
                evt.preventDefault();
                window.history.back();
                break;
        }
    }

    /**
     * Perform search query against Jellyfin API
     * @param {string} query - Search query string
     * @private
     */
    function performSearch(query) {
        
        showLoading();
        performJellyfinSearch(query);
    }

    /**
     * Perform search against Jellyfin
     * @param {string} query - Search query string
     * @private
     */
    function performJellyfinSearch(query) {
        const endpoint = '/Users/' + auth.userId + '/Items';
        const params = {
            searchTerm: query,
            IncludeItemTypes: 'Movie,Series,Episode,Person',
            Recursive: true,
            Fields: 'PrimaryImageAspectRatio,CanDelete,MediaSourceCount',
            ImageTypeLimit: 1,
            EnableTotalRecordCount: false,
            Limit: 100
        };
        
        // Build query string manually
        var queryParts = [];
        for (var key in params) {
            if (params.hasOwnProperty(key)) {
                queryParts.push(encodeURIComponent(key) + '=' + encodeURIComponent(params[key]));
            }
        }
        var queryString = queryParts.join('&');
        
        const url = auth.serverAddress + endpoint + '?' + queryString;
        
        // Perform Jellyfin search using ajax.request with auth headers
        ajax.request(url, {
            method: 'GET',
            headers: {
                'X-Emby-Authorization': JellyfinAPI.getAuthHeader(auth.accessToken)
            },
            success: function(response) {
                processJellyfinResults(response.Items || [], query);
                
                // Also search Jellyseerr if enabled and authenticated
                if (jellyseerrEnabled) {
                    console.log('Jellyseerr enabled, starting search...');
                    console.log('[Search] Sending to Jellyseerr API:', query);
                    JellyseerrAPI.search(query).then(function(jellyseerrResponse) {
                        console.log('Jellyseerr search results:', jellyseerrResponse);
                        // Filter out people/actors from results
                        var filteredResults = (jellyseerrResponse.results || []).filter(function(item) {
                            return item.mediaType !== 'person';
                        });
                        // Add Jellyseerr results to current results
                        currentResults.jellyseerr = filteredResults;
                        console.log('Added', currentResults.jellyseerr.length, 'Jellyseerr results (actors excluded)');
                        // Re-display to show Jellyseerr row
                        displayResults();
                    }).catch(function(error) {
                        console.error('Jellyseerr search failed:', error);
                        // Still show Jellyfin results even if Jellyseerr fails
                    });
                } else {
                    console.log('Jellyseerr not enabled or not authenticated');
                }
            },
            error: function(error) {
                console.error('Jellyfin search failed:', error);
                showNoResults(query);
            }
        });
    }

    /**
     * Process and categorize search results from Jellyfin
     * @param {Object[]} items - Array of search result items
     * @param {string} query - Original search query
     * @private
     */
    function processJellyfinResults(items, query) {
        
        // Reset results (keep jellyseerr if it exists)
        var jellyseerrResults = currentResults.jellyseerr || [];
        currentResults = {
            movies: [],
            shows: [],
            episodes: [],
            people: [],
            jellyseerr: jellyseerrResults
        };

        // Categorize items
        items.forEach(function(item) {
            
            switch (item.Type) {
                case 'Movie':
                    currentResults.movies.push(item);
                    break;
                case 'Series':
                    currentResults.shows.push(item);
                    break;
                case 'Episode':
                    currentResults.episodes.push(item);
                    break;
                case 'Person':
                    currentResults.people.push(item);
                    break;
                default:
                    break;
            }
        });

        // Check if we have any results
        const hasResults = currentResults.movies.length > 0 ||
                          currentResults.shows.length > 0 ||
                          currentResults.episodes.length > 0 ||
                          currentResults.people.length > 0;

        if (!hasResults) {
            showNoResults(query);
            return;
        }

        displayResults();
    }

    /**
     * Process and categorize search results from Jellyseerr
     * @param {Object[]} items - Array of search result items
     * @param {string} query - Original search query
     * @private
     */
    function processJellyseerrResults(items, query) {
        
        // Reset results
        currentResults = {
            movies: [],
            shows: [],
            episodes: [],
            people: [],
            jellyseerr: []
        };

        // For Jellyseerr mode, just store all results in jellyseerr array
        currentResults.jellyseerr = items;

        // Check if we have any results
        const hasResults = currentResults.jellyseerr.length > 0;

        if (!hasResults) {
            showNoResults(query);
            return;
        }

        displayResults();
    }

    function displayResults() {
        hideAllStates();
        elements.resultsContainer.style.display = 'block';

        // Display all result rows
            // Display Movies
            if (currentResults.movies.length > 0) {
                elements.moviesRow.style.display = 'block';
                renderResultCards(currentResults.movies, elements.moviesList, 'movie');
            } else {
                elements.moviesRow.style.display = 'none';
            }

            // Display TV Shows
            if (currentResults.shows.length > 0) {
                elements.showsRow.style.display = 'block';
                renderResultCards(currentResults.shows, elements.showsList, 'show');
            } else {
                elements.showsRow.style.display = 'none';
            }

            // Display Episodes
            if (currentResults.episodes.length > 0) {
                elements.episodesRow.style.display = 'block';
                renderResultCards(currentResults.episodes, elements.episodesList, 'episode');
            } else {
                elements.episodesRow.style.display = 'none';
            }

            // Display People
            if (currentResults.people.length > 0) {
                elements.castRow.style.display = 'block';
                renderResultCards(currentResults.people, elements.castList, 'person');
            } else {
                elements.castRow.style.display = 'none';
            }
            
            // Display Jellyseerr results row if available
            if (currentResults.jellyseerr && currentResults.jellyseerr.length > 0) {
                elements.jellyseerrRow.style.display = 'block';
                renderResultCards(currentResults.jellyseerr, elements.jellyseerrList, 'jellyseerr');
            } else {
                elements.jellyseerrRow.style.display = 'none';
            }
    }

    function renderResultCards(items, container, type) {
        container.innerHTML = '';

        items.forEach(function(item, index) {
            const card = createResultCard(item, type, index);
            container.appendChild(card);
        });
    }

    function createResultCard(item, type, index) {
        const card = document.createElement('div');
        card.className = 'result-card' + (type === 'person' ? ' person' : '') + (type === 'episode' ? ' episode' : '');
        card.tabIndex = 0;
        
        if (type === 'jellyseerr') {
            card.dataset.tmdbId = item.id;
            card.dataset.mediaType = item.mediaType;
            card.dataset.type = item.mediaType === 'movie' ? 'movie' : (item.mediaType === 'tv' ? 'show' : 'person');
        } else {
            card.dataset.itemId = item.Id;
            card.dataset.type = type;
        }

        // Image wrapper
        const imageWrapper = document.createElement('div');
        imageWrapper.className = 'card-image-wrapper';

        let imageUrl = null;
        
        if (type === 'jellyseerr') {
            // Jellyseerr items
            if (item.posterPath) {
                imageUrl = ImageHelper.getTMDBImageUrl(item.posterPath, 'w500');
            } else if (item.profilePath) {
                imageUrl = ImageHelper.getTMDBImageUrl(item.profilePath, 'w500');
            }
        } else {
            // Jellyfin items
            const imageTag = item.ImageTags && item.ImageTags.Primary;
            if (imageTag) {
                if (type === 'episode') {
                    imageUrl = auth.serverAddress + '/Items/' + item.Id + '/Images/Primary?fillWidth=500&quality=90';
                } else {
                    imageUrl = auth.serverAddress + '/Items/' + item.Id + '/Images/Primary?fillWidth=300&quality=90';
                }
            }
        }

        if (imageUrl) {
            const img = document.createElement('img');
            img.className = 'card-image';
            img.src = imageUrl;
            img.alt = item.Name || item.name || item.title || 'Media';
            imageWrapper.appendChild(img);
        } else {
            const placeholder = document.createElement('div');
            placeholder.className = 'card-placeholder';
            placeholder.textContent = type === 'person' ? '👤' : '🎬';
            imageWrapper.appendChild(placeholder);
        }

        card.appendChild(imageWrapper);

        // Info
        const cardInfo = document.createElement('div');
        cardInfo.className = 'card-info';

        const title = document.createElement('div');
        title.className = 'card-title';
        title.textContent = item.Name || item.name || item.title || 'Unknown';
        cardInfo.appendChild(title);

        const subtitle = document.createElement('div');
        subtitle.className = 'card-subtitle';
        
        if (type === 'jellyseerr') {
            // Jellyseerr items
            if (item.mediaType === 'person') {
                subtitle.textContent = item.knownForDepartment || 'Actor';
            } else {
                var year = '';
                if (item.releaseDate) {
                    year = new Date(item.releaseDate).getFullYear();
                } else if (item.firstAirDate) {
                    year = new Date(item.firstAirDate).getFullYear();
                }
                subtitle.textContent = year || '';
            }
        } else {
            // Jellyfin items
            if (type === 'episode') {
                subtitle.textContent = (item.SeriesName || '') + (item.ParentIndexNumber ? ' S' + item.ParentIndexNumber : '') + 
                                      (item.IndexNumber ? 'E' + item.IndexNumber : '');
            } else if (type === 'person') {
                subtitle.textContent = item.Role || 'Actor';
            } else {
                subtitle.textContent = item.ProductionYear || '';
            }
        }
        
        cardInfo.appendChild(subtitle);
        card.appendChild(cardInfo);

        // Event listeners
        card.addEventListener('click', function() {
            navigateToItem(item, type);
        });

        card.addEventListener('focus', function() {
            focusManager.inInput = false;
            // Scroll into view if needed
            card.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        });

        return card;
    }

    function navigateToItem(item, type) {
        var isJellyseerrItem = type === 'jellyseerr';
        var actualType = type === 'jellyseerr' ? (item.mediaType === 'movie' ? 'movie' : (item.mediaType === 'tv' ? 'show' : 'person')) : type;
        
        if (actualType === 'person') {
            // Navigate to person page
            if (isJellyseerrItem) {
                // For Jellyseerr, navigate to person details page
                var personId = item.id;
                window.location.href = 'person.html?id=' + personId;
            }
            return;
        }
        
        if (isJellyseerrItem) {
            // Jellyseerr - navigate to details page with TMDB ID
            var tmdbId = item.id;
            var mediaType = item.mediaType === 'movie' ? 'Movie' : 'Series';
            window.location.href = 'details.html?id=' + tmdbId + '&type=' + mediaType + '&source=jellyseerr';
        } else {
            // Jellyfin
            var url = 'details.html?id=' + item.Id;
            if (item.MultiServerId) {
                url += '&serverId=' + item.MultiServerId;
            }
            window.location.href = url;
        }
    }

    function getVisibleRows() {
        const rows = [];
        if (currentResults.movies.length > 0) rows.push('movies');
        if (currentResults.shows.length > 0) rows.push('shows');
        if (currentResults.episodes.length > 0) rows.push('episodes');
        if (currentResults.people.length > 0) rows.push('people');
        if (currentResults.jellyseerr && currentResults.jellyseerr.length > 0) rows.push('jellyseerr');
        return rows;
    }

    function getCurrentRowData() {
        const visibleRows = getVisibleRows();
        if (focusManager.currentRow < 0 || focusManager.currentRow >= visibleRows.length) {
            return null;
        }

        const rowType = visibleRows[focusManager.currentRow];
        return currentResults[rowType];
    }

    function updateFocus() {
        const visibleRows = getVisibleRows();
        if (visibleRows.length === 0) return;

        const rowType = visibleRows[focusManager.currentRow];
        const container = getContainerForType(rowType);
        
        if (!container) return;

        const cards = container.querySelectorAll('.result-card');
        if (focusManager.currentItem >= cards.length) {
            focusManager.currentItem = cards.length - 1;
        }

        if (cards[focusManager.currentItem]) {
            cards[focusManager.currentItem].focus();
        }
    }

    function getContainerForType(type) {
        switch (type) {
            case 'movies': return elements.moviesList;
            case 'shows': return elements.showsList;
            case 'episodes': return elements.episodesList;
            case 'people': return elements.castList;
            case 'jellyseerr': return elements.jellyseerrList;
            default: return null;
        }
    }

    function focusFirstResult() {
        const visibleRows = getVisibleRows();
        if (visibleRows.length === 0) {
            // No results to focus
            return;
        }
        
        focusManager.inInput = false;
        focusManager.currentRow = 0;
        focusManager.currentItem = 0;
        updateFocus();
    }

    function focusSearchInput() {
        focusManager.inInput = true;
        focusManager.inNavBar = false;
        focusManager.currentRow = -1;
        if (elements.searchInput) {
            elements.searchInput.focus();
        }
    }

    function selectCurrentItem() {
        const currentRowData = getCurrentRowData();
        if (!currentRowData || focusManager.currentItem >= currentRowData.length) {
            return;
        }

        const item = currentRowData[focusManager.currentItem];
        const visibleRows = getVisibleRows();
        const type = visibleRows[focusManager.currentRow];
        
        navigateToItem(item, type);
    }

    function clearSearch() {
        if (elements.searchInput) {
            elements.searchInput.value = '';
            elements.searchInput.focus();
        }
        if (elements.clearBtn) {
            elements.clearBtn.style.display = 'none';
        }
        showEmptyState();
    }

    function showEmptyState() {
        hideAllStates();
        elements.emptyState.style.display = 'block';
    }

    function showLoading() {
        hideAllStates();
        elements.loadingIndicator.style.display = 'block';
    }

    function showNoResults(query) {
        hideAllStates();
        elements.noResults.style.display = 'block';
        if (elements.noResultsQuery) {
            elements.noResultsQuery.textContent = 'Try searching for something else';
        }
    }

    function hideAllStates() {
        elements.emptyState.style.display = 'none';
        elements.loadingIndicator.style.display = 'none';
        elements.resultsContainer.style.display = 'none';
        elements.noResults.style.display = 'none';
    }

    /**
     * Get all navbar button elements
     * @returns {HTMLElement[]} Array of navbar button elements
     * @private
     */
    function getNavButtons() {
        return Array.from(document.querySelectorAll('.nav-left .nav-btn, .nav-center .nav-btn')).filter(function(btn) {
            return btn.offsetParent !== null; // Only include visible buttons
        });
    }

    /**
     * Move focus from search input to navbar
     * @private
     */
    function focusToNavBar() {
        focusManager.inNavBar = true;
        focusManager.inInput = false;
        const navButtons = getNavButtons();
        
        // Start at home button (index 1), not user avatar (index 0)
        focusManager.navBarIndex = navButtons.length > 1 ? 1 : 0;
        
        if (navButtons.length > 0) {
            navButtons.forEach(btn => btn.classList.remove('focused'));
            navButtons[focusManager.navBarIndex].classList.add('focused');
            navButtons[focusManager.navBarIndex].focus();
        }
    }

    /**
     * Handle keyboard navigation within navbar
     * @param {KeyboardEvent} evt - Keyboard event
     * @private
     */
    function handleNavBarNavigation(evt) {
        const navButtons = getNavButtons();
        
        navButtons.forEach(btn => btn.classList.remove('focused'));
        
        switch (evt.keyCode) {
            case KeyCodes.LEFT:
                evt.preventDefault();
                if (focusManager.navBarIndex > 0) {
                    focusManager.navBarIndex--;
                }
                navButtons[focusManager.navBarIndex].classList.add('focused');
                navButtons[focusManager.navBarIndex].focus();
                break;
                
            case KeyCodes.RIGHT:
                evt.preventDefault();
                if (focusManager.navBarIndex < navButtons.length - 1) {
                    focusManager.navBarIndex++;
                }
                navButtons[focusManager.navBarIndex].classList.add('focused');
                navButtons[focusManager.navBarIndex].focus();
                break;
                
            case KeyCodes.DOWN:
                evt.preventDefault();
                focusManager.inNavBar = false;
                // Blur keyboard if open
                if (document.activeElement && document.activeElement.blur) {
                    document.activeElement.blur();
                }
                setTimeout(function() {
                    focusSearchInput();
                }, 50);
                break;
                
            case KeyCodes.ENTER:
                evt.preventDefault();
                const currentBtn = navButtons[focusManager.navBarIndex];
                if (currentBtn) {
                    currentBtn.click();
                }
                break;
        }
    }

    return {
        init: init
    };
})();

window.addEventListener('load', function() {
    SearchController.init();
});
