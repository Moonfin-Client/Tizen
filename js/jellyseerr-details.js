/*
 * Jellyseerr Details Controller
 * Handles media details display and request functionality
 */

var JellyseerrDetailsController = (function() {
    'use strict';

    var auth = null;
    var mediaType = null;
    var mediaId = null;
    var mediaData = null;
    var fullDetails = null;
    
    var focusManager = {
        currentSection: 'buttons',
        currentIndex: 0,
        inModal: false
    };
    
    var elements = {};
    var selectedSeasons = [];
    
    // Pagination state
    var recommendationsPagination = {
        currentPage: 0,
        totalPages: 1,
        hasMore: true,
        isLoading: false
    };
    
    var similarPagination = {
        currentPage: 0,
        totalPages: 1,
        hasMore: true,
        isLoading: false
    };

    /**
     * Initialize the controller
     */
    function init() {
        auth = JellyfinAPI.getStoredAuth();
        if (!auth) {
            window.location.href = 'login.html';
            return;
        }

        // Get media info from URL
        var params = new URLSearchParams(window.location.search);
        mediaType = params.get('type');
        mediaId = parseInt(params.get('id'));

        if (!mediaType || !mediaId) {
            window.location.href = 'discover.html';
            return;
        }

        cacheElements();
        setupEventListeners();
        
        // Initialize Jellyseerr API before loading details
        initializeJellyseerr()
            .then(function(initialized) {
                console.log('[Jellyseerr Details] Initialized:', initialized);
                // On Tizen with API key, we're already authenticated
                // For non-Tizen or when no API key, attempt auto-login
                if (typeof tizen === 'undefined' && !initialized) {
                    return JellyseerrAPI.attemptAutoLogin();
                }
                return initialized;
            })
            .then(function() {
                loadMediaDetails();
            })
            .catch(function(error) {
                console.error('[Jellyseerr Details] Initialization error:', error);
                showError('Failed to initialize Jellyseerr');
            });
        
        // Initialize navbar
        if (typeof NavbarController !== 'undefined') {
            NavbarController.init('discover');
        }
        
        // Add DOWN key handler to navbar buttons for returning to details
        setTimeout(function() {
            var navButtons = document.querySelectorAll('.nav-btn');
            navButtons.forEach(function(btn) {
                btn.addEventListener('keydown', function(e) {
                    if (e.keyCode === KeyCodes.DOWN) {
                        e.preventDefault();
                        e.stopPropagation();
                        // Return focus to buttons section
                        focusManager.currentSection = 'buttons';
                        focusManager.currentIndex = 0;
                        var buttons = getActionButtons();
                        if (buttons.length > 0) {
                            buttons[0].focus();
                        }
                    }
                });
            });
        }, 500);
    }
    
    /**
     * Initialize Jellyseerr API
     */
    /**
     * Initialize Jellyseerr integration
     * @private
     */
    function initializeJellyseerr() {
        console.log('[Jellyseerr Details] Initializing Jellyseerr API...');
        
        // Check if running on Tizen - use API key auth
        if (typeof tizen !== 'undefined') {
            console.log('[Jellyseerr Details] Tizen detected - checking for API key auth...');
            var settingsStr = storage.getUserPreference('jellyfin_settings', null);
            console.log('[Jellyseerr Details] Settings string:', settingsStr);
            var settings = null;
            var hasApiKey = false;
            var hasUrl = false;
            
            if (settingsStr) {
                try {
                    settings = JSON.parse(settingsStr);
                    console.log('[Jellyseerr Details] Settings - jellyseerrApiKey:', settings.jellyseerrApiKey ? 'SET' : 'NOT SET');
                    console.log('[Jellyseerr Details] Settings - jellyseerrUrl:', settings.jellyseerrUrl || 'NOT SET');
                    hasApiKey = settings.jellyseerrApiKey && settings.jellyseerrApiKey.length > 0;
                    hasUrl = settings.jellyseerrUrl && settings.jellyseerrUrl.length > 0;
                } catch (e) {
                    console.log('[Jellyseerr Details] Error parsing settings:', e);
                }
            }
            
            if (!hasApiKey || !hasUrl) {
                console.log('[Jellyseerr Details] No Jellyseerr configuration found');
                return Promise.resolve(false);
            }
            
            // On Tizen with API key, initialize directly
            console.log('[Jellyseerr Details] Tizen with API key - initializing directly...');
            
            var jellyseerrUrl = settings.jellyseerrUrl;
            var jellyseerrApiKey = settings.jellyseerrApiKey;
            
            console.log('[Jellyseerr Details] Jellyseerr URL:', jellyseerrUrl);
            console.log('[Jellyseerr Details] API Key length:', jellyseerrApiKey ? jellyseerrApiKey.length : 0);
            
            // Get user ID
            var auth = JellyfinAPI.getStoredAuth();
            var userId = auth ? auth.userId : null;
            
            // Set API key first
            JellyseerrAPI.setApiKey(jellyseerrApiKey);
            
            // Initialize with URL
            return JellyseerrAPI.initialize(jellyseerrUrl, jellyseerrApiKey, userId)
                .then(function() {
                    console.log('[Jellyseerr Details] JellyseerrAPI.initialize() succeeded');
                    console.log('[Jellyseerr Details] isInitialized:', JellyseerrAPI.isInitialized());
                    return true;
                })
                .catch(function(error) {
                    console.error('[Jellyseerr Details] Error during initialization:', error);
                    return false;
                });
        }
        
        // Non-Tizen: Try initializeFromPreferences first (for existing cookie auth)
        return JellyseerrAPI.initializeFromPreferences()
            .then(function(success) {
                if (success) {
                    console.log('[Jellyseerr Details] initializeFromPreferences succeeded');
                    return success;
                }
                
                // If initializeFromPreferences returns false, it means no auth yet
                // But we still need to initialize the API with the server URL
                console.log('[Jellyseerr Details] initializeFromPreferences returned false, trying direct initialization');
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
                        console.log('[Jellyseerr Details] Direct initialization succeeded');
                        return false; // Return false because we're not authenticated yet
                    });
            });
    }

    /**
     * Cache DOM elements
     */
    function cacheElements() {
        elements = {
            loadingIndicator: document.getElementById('loadingIndicator'),
            mainContent: document.getElementById('mainContent'),
            backdropImage: document.getElementById('backdropImage'),
            posterImage: document.getElementById('posterImage'),
            mediaTitle: document.getElementById('mediaTitle'),
            mediaYear: document.getElementById('mediaYear'),
            mediaRating: document.getElementById('mediaRating'),
            mediaRuntime: document.getElementById('mediaRuntime'),
            mediaGenres: document.getElementById('mediaGenres'),
            statusBadge: document.getElementById('statusBadge'),
            requestBtn: document.getElementById('requestBtn'),
            requestBtnWrapper: document.getElementById('requestBtnWrapper'),
            request4kBtn: document.getElementById('request4kBtn'),
            request4kBtnWrapper: document.getElementById('request4kBtnWrapper'),
            trailerBtn: document.getElementById('trailerBtn'),
            trailerBtnWrapper: document.getElementById('trailerBtnWrapper'),
            playBtn: document.getElementById('playBtn'),
            playBtnWrapper: document.getElementById('playBtnWrapper'),
            tagline: document.getElementById('tagline'),
            overview: document.getElementById('overview'),
            castSection: document.getElementById('castSection'),
            castList: document.getElementById('castList'),
            recommendationsSection: document.getElementById('recommendationsSection'),
            recommendationsList: document.getElementById('recommendationsList'),
            similarSection: document.getElementById('similarSection'),
            similarTitle: document.getElementById('similarTitle'),
            similarList: document.getElementById('similarList'),
            keywordsSection: document.getElementById('keywordsSection'),
            keywordsList: document.getElementById('keywordsList'),
            seasonModal: document.getElementById('seasonModal'),
            seasonList: document.getElementById('seasonList'),
            allSeasonsBtn: document.getElementById('allSeasonsBtn'),
            confirmRequestBtn: document.getElementById('confirmRequestBtn'),
            cancelRequestBtn: document.getElementById('cancelRequestBtn'),
            errorModal: document.getElementById('errorModal'),
            errorMessage: document.getElementById('errorMessage'),
            errorOkBtn: document.getElementById('errorOkBtn')
        };
    }

    /**
     * Setup event listeners
     */
    function setupEventListeners() {
        document.addEventListener('keydown', handleKeyDown);
        
        if (elements.requestBtn) {
            elements.requestBtn.addEventListener('click', function() {
                handleRequest(false);
            });
        }
        
        if (elements.request4kBtn) {
            elements.request4kBtn.addEventListener('click', function() {
                handleRequest(true);
            });
        }
        
        if (elements.trailerBtn) {
            elements.trailerBtn.addEventListener('click', handleTrailer);
        }
        
        if (elements.playBtn) {
            elements.playBtn.addEventListener('click', handlePlay);
        }
        
        // Modal buttons
        if (elements.allSeasonsBtn) {
            elements.allSeasonsBtn.addEventListener('click', selectAllSeasons);
        }
        if (elements.confirmRequestBtn) {
            elements.confirmRequestBtn.addEventListener('click', confirmRequest);
        }
        if (elements.cancelRequestBtn) {
            elements.cancelRequestBtn.addEventListener('click', closeModal);
        }
        
        // Error modal OK button
        if (elements.errorOkBtn) {
            elements.errorOkBtn.addEventListener('click', closeErrorModal);
        }
    }

    /**
     * Load media details from Jellyseerr API
     */
    function loadMediaDetails() {
        console.log('[Jellyseerr Details] Loading details for', mediaType, mediaId);
        
        var detailsPromise = mediaType === 'movie' 
            ? JellyseerrAPI.getMovieDetails(mediaId)
            : JellyseerrAPI.getTvDetails(mediaId);
        
        detailsPromise
            .then(function(details) {
                console.log('[Jellyseerr Details] Received details:', details);
                fullDetails = details;
                mediaData = details;
                renderMediaDetails();
                updateSimilarTitle();
                loadCast();
                loadRecommendations();
                loadSimilar();
                loadKeywords();
            })
            .catch(function(error) {
                console.error('[Jellyseerr Details] Failed to load details:', error);
                showError('Failed to load media details');
            });
    }

    /**
     * Render media details to the page
     */
    function renderMediaDetails() {
        console.log('[Jellyseerr Details] Rendering media details:', mediaData);
        
        // Hide loading, show content
        elements.loadingIndicator.style.display = 'none';
        elements.mainContent.style.display = 'block';
        
        // Backdrop
        if (mediaData.backdropPath) {
            elements.backdropImage.src = ImageHelper.getTMDBImageUrl(mediaData.backdropPath, 'original');
        }
        
        // Poster
        if (mediaData.posterPath) {
            elements.posterImage.src = ImageHelper.getTMDBImageUrl(mediaData.posterPath, 'w500');
        }
        
        // Title
        elements.mediaTitle.textContent = mediaData.title || mediaData.name || 'Unknown';
        
        // Year
        var year = null;
        if (mediaData.releaseDate) {
            year = new Date(mediaData.releaseDate).getFullYear();
        } else if (mediaData.firstAirDate) {
            year = new Date(mediaData.firstAirDate).getFullYear();
        }
        if (year) {
            elements.mediaYear.textContent = year;
            elements.mediaYear.style.display = 'inline';
        }
        
        // Rating
        if (mediaData.voteAverage) {
            elements.mediaRating.textContent = '⭐ ' + mediaData.voteAverage.toFixed(1);
            elements.mediaRating.style.display = 'inline';
        }
        
        // Runtime
        if (mediaData.runtime) {
            var hours = Math.floor(mediaData.runtime / 60);
            var minutes = mediaData.runtime % 60;
            elements.mediaRuntime.textContent = hours + 'h ' + minutes + 'm';
            elements.mediaRuntime.style.display = 'inline';
        }
        
        // Genres
        if (mediaData.genres && mediaData.genres.length > 0) {
            var genreNames = mediaData.genres.map(function(g) { return g.name; }).join(', ');
            elements.mediaGenres.textContent = genreNames;
            elements.mediaGenres.style.display = 'inline';
        }
        
        // Status badge
        updateStatusBadge();
        
        // Request buttons
        updateRequestButtons();
        
        // Tagline
        if (mediaData.tagline) {
            elements.tagline.textContent = mediaData.tagline;
            elements.tagline.style.display = 'block';
        }
        
        // Overview
        if (mediaData.overview) {
            elements.overview.textContent = mediaData.overview;
        }
        
        // Focus first button
        setTimeout(function() {
            var buttons = getActionButtons();
            if (buttons.length > 0) {
                buttons[0].focus();
            }
        }, 100);
    }

    /**
     * Update status badge based on media info
     */
    function updateStatusBadge() {
        if (!mediaData.mediaInfo || !mediaData.mediaInfo.status) {
            return;
        }
        
        var status = mediaData.mediaInfo.status;
        var statusText = '';
        var statusClass = '';
        
        switch (status) {
            case 2:
                statusText = 'Pending';
                statusClass = 'pending';
                break;
            case 3:
                statusText = 'Processing';
                statusClass = 'processing';
                break;
            case 4:
                statusText = 'Partially Available';
                statusClass = 'available';
                break;
            case 5:
                statusText = 'Available';
                statusClass = 'available';
                break;
        }
        
        if (statusText) {
            elements.statusBadge.textContent = statusText;
            elements.statusBadge.className = 'status-badge ' + statusClass;
            elements.statusBadge.style.display = 'inline-block';
        }
    }

    /**
     * Update request buttons state
     */
    function updateRequestButtons() {
        var mediaInfo = mediaData.mediaInfo;
        var hdStatus = mediaInfo ? mediaInfo.status : null;
        var status4k = mediaInfo ? mediaInfo.status4k : null;
        
        // HD button
        var hdDisabled = (hdStatus !== null && hdStatus >= 2 && hdStatus !== 4);
        elements.requestBtn.disabled = hdDisabled;
        var requestLabel = elements.requestBtnWrapper.querySelector('.btn-label');
        if (hdStatus === 2) {
            requestLabel.textContent = 'HD Pending';
        } else if (hdStatus === 3) {
            requestLabel.textContent = 'HD Processing';
        } else if (hdStatus === 5) {
            requestLabel.textContent = 'HD Available';
        } else if (hdStatus === 4) {
            requestLabel.textContent = 'Request More (HD)';
        }
        
        // 4K button
        var fourKDisabled = (status4k !== null && status4k >= 2 && status4k !== 4);
        elements.request4kBtn.disabled = fourKDisabled;
        var request4kLabel = elements.request4kBtnWrapper.querySelector('.btn-label');
        if (status4k === 2) {
            request4kLabel.textContent = '4K Pending';
        } else if (status4k === 3) {
            request4kLabel.textContent = '4K Processing';
        } else if (status4k === 5) {
            request4kLabel.textContent = '4K Available';
        } else if (status4k === 4) {
            request4kLabel.textContent = 'Request More (4K)';
        }
        
        // Show Play button if available
        if (hdStatus === 5 || hdStatus === 4) {
            elements.playBtnWrapper.style.display = 'flex';
        }
    }

    /**
     * Load cast members
     */
    function loadCast() {
        if (!mediaData.credits || !mediaData.credits.cast) {
            return;
        }
        
        var cast = mediaData.credits.cast.slice(0, 10); // Show first 10
        if (cast.length === 0) {
            return;
        }
        
        elements.castSection.style.display = 'block';
        elements.castList.innerHTML = '';
        
        cast.forEach(function(person) {
            var card = createCastCard(person);
            elements.castList.appendChild(card);
        });
    }

    /**
     * Create a cast card element
     */
    function createCastCard(person) {
        var card = document.createElement('div');
        card.className = 'cast-card';
        card.tabIndex = 0;
        card.dataset.personId = person.id;
        card.dataset.personName = person.name;
        
        var photoContainer = document.createElement('div');
        photoContainer.className = 'cast-photo-container';
        
        if (person.profilePath) {
            var photo = document.createElement('img');
            photo.className = 'cast-photo';
            photo.src = ImageHelper.getTMDBImageUrl(person.profilePath, 'w185');
            photo.alt = person.name;
            photoContainer.appendChild(photo);
        }
        
        card.appendChild(photoContainer);
        
        var name = document.createElement('p');
        name.className = 'cast-name';
        name.textContent = person.name;
        card.appendChild(name);
        
        if (person.character) {
            var character = document.createElement('p');
            character.className = 'cast-character';
            character.textContent = person.character;
            card.appendChild(character);
        }
        
        // Click handler - navigate to person details
        card.addEventListener('click', function(evt) {
            evt.preventDefault();
            evt.stopPropagation();
            navigateToPerson(person.id, person.name);
        });
        
        card.addEventListener('keydown', function(evt) {
            if (evt.keyCode === KeyCodes.ENTER || evt.keyCode === KeyCodes.OK) {
                evt.preventDefault();
                evt.stopPropagation();
                navigateToPerson(person.id, person.name);
            } else {
                handleCastKeyDown(evt);
            }
        });
        
        return card;
    }

    /**
     * Update similar section title based on media type
     */
    function updateSimilarTitle() {
        if (elements.similarTitle) {
            elements.similarTitle.textContent = mediaType === 'tv' ? 'Similar Series' : 'Similar Titles';
        }
    }

    /**
     * Load recommendations for the current media with pagination
     * @param {number} [page=1] - Page number to load
     * @returns {Promise} Promise that resolves when recommendations are loaded
     */
    function loadRecommendations(page) {
        page = page || 1;
        
        if (recommendationsPagination.isLoading) {
            console.log('[Jellyseerr Details] Already loading recommendations, skipping');
            return Promise.resolve();
        }
        
        console.log('[Jellyseerr Details] Loading recommendations page:', page, 'mediaType:', mediaType, 'mediaId:', mediaId);
        recommendationsPagination.isLoading = true;
        
        var recommendationsPromise = mediaType === 'movie'
            ? JellyseerrAPI.getRecommendationsMovies(mediaId, { page: page })
            : JellyseerrAPI.getRecommendationsTv(mediaId, { page: page });
        
        return recommendationsPromise
            .then(function(response) {
                console.log('[Jellyseerr Details] Recommendations page', page, 'loaded successfully:', response);
                recommendationsPagination.isLoading = false;
                
                if (!response.results || response.results.length === 0) {
                    if (page === 1) {
                        recommendationsPagination.hasMore = false;
                    }
                    return;
                }
                
                // Update pagination state
                recommendationsPagination.currentPage = page;
                recommendationsPagination.totalPages = response.totalPages || 1;
                recommendationsPagination.hasMore = page < response.totalPages;
                
                // Show section on first load
                if (page === 1) {
                    elements.recommendationsSection.style.display = 'block';
                    elements.recommendationsList.innerHTML = '';
                }
                
                // Add cards
                response.results.forEach(function(item) {
                    var card = createRecommendationCard(item);
                    elements.recommendationsList.appendChild(card);
                });
            })
            .catch(function(error) {
                console.error('[Jellyseerr Details] Failed to load recommendations:', error);
                
                // Check if session expired
                if (error && error.message && error.message.indexOf('Session expired') !== -1) {
                    console.log('[Jellyseerr Details] Session expired during recommendations load, attempting recovery');
                    
                    // Keep loading flag true during retry to prevent duplicate attempts
                    // Try to re-initialize session and retry this page
                    JellyseerrAPI.handleSessionExpiration(function() {
                        console.log('[Jellyseerr Details] Session re-initialized, retrying recommendations page', page);
                        // Reset loading flag before retry
                        recommendationsPagination.isLoading = false;
                        return loadRecommendations(page);
                    }, 'Recommendations Load')
                        .then(function() {
                            console.log('[Jellyseerr Details] Retry successful for recommendations page', page);
                        })
                        .catch(function(retryError) {
                            console.error('[Jellyseerr Details] Retry failed for recommendations page', page, retryError);
                            // Only stop pagination after retry fails
                            recommendationsPagination.isLoading = false;
                            recommendationsPagination.hasMore = false;
                        });
                } else {
                    // For other errors, stop pagination
                    recommendationsPagination.isLoading = false;
                    recommendationsPagination.hasMore = false;
                }
            });
    }

    /**
     * Create a recommendation card
     */
    function createRecommendationCard(item) {
        var card = document.createElement('div');
        card.className = 'recommendations-card';
        card.tabIndex = 0;
        
        if (item.posterPath) {
            var poster = document.createElement('img');
            poster.className = 'recommendations-poster';
            poster.src = ImageHelper.getTMDBImageUrl(item.posterPath, 'w500');
            poster.alt = item.title || item.name;
            card.appendChild(poster);
        }
        
        var title = document.createElement('div');
        title.className = 'recommendations-title';
        title.textContent = item.title || item.name || 'Unknown';
        card.appendChild(title);
        
        card.addEventListener('click', function() {
            window.location.href = 'jellyseerr-details.html?type=' + item.mediaType + '&id=' + item.id;
        });
        
        card.addEventListener('keydown', function(e) {
            if (e.keyCode === KeyCodes.ENTER) {
                e.preventDefault();
                window.location.href = 'jellyseerr-details.html?type=' + item.mediaType + '&id=' + item.id;
            }
            handleRecommendationsKeyDown(e);
        });
        
        return card;
    }

    /**
     * Load similar content for the current media with pagination
     * @param {number} [page=1] - Page number to load
     * @returns {Promise} Promise that resolves when similar content is loaded
     */
    function loadSimilar(page) {
        page = page || 1;
        
        if (similarPagination.isLoading) {
            return Promise.resolve();
        }
        
        similarPagination.isLoading = true;
        
        var similarPromise = mediaType === 'movie'
            ? JellyseerrAPI.getSimilarMovies(mediaId, { page: page })
            : JellyseerrAPI.getSimilarTv(mediaId, { page: page });
        
        return similarPromise
            .then(function(response) {
                similarPagination.isLoading = false;
                
                if (!response.results || response.results.length === 0) {
                    if (page === 1) {
                        similarPagination.hasMore = false;
                    }
                    return;
                }
                
                // Update pagination state
                similarPagination.currentPage = page;
                similarPagination.totalPages = response.totalPages || 1;
                similarPagination.hasMore = page < response.totalPages;
                
                // Show section on first load
                if (page === 1) {
                    elements.similarSection.style.display = 'block';
                    elements.similarList.innerHTML = '';
                }
                
                // Add cards
                response.results.forEach(function(item) {
                    var card = createSimilarCard(item);
                    elements.similarList.appendChild(card);
                });
            })
            .catch(function(error) {
                console.error('[Jellyseerr Details] Failed to load similar content:', error);
                similarPagination.isLoading = false;
                
                // Check if session expired
                if (error && error.message && error.message.indexOf('Session expired') !== -1) {
                    console.log('[Jellyseerr Details] Session expired during similar load');
                    // Stop trying to load more to prevent infinite loop
                    similarPagination.hasMore = false;
                    
                    // Try to re-initialize session for next time
                    JellyseerrAPI.handleSessionExpiration(function() {
                        console.log('[Jellyseerr Details] Session re-initialized after similar error');
                    }, 'Similar Load');
                } else {
                    // For other errors, stop pagination
                    similarPagination.hasMore = false;
                }
            });
    }

    /**
     * Create a similar content card
     */
    function createSimilarCard(item) {
        var card = document.createElement('div');
        card.className = 'similar-card';
        card.tabIndex = 0;
        
        if (item.posterPath) {
            var poster = document.createElement('img');
            poster.className = 'similar-poster';
            poster.src = ImageHelper.getTMDBImageUrl(item.posterPath, 'w500');
            poster.alt = item.title || item.name;
            card.appendChild(poster);
        }
        
        var title = document.createElement('div');
        title.className = 'similar-title';
        title.textContent = item.title || item.name || 'Unknown';
        card.appendChild(title);
        
        card.addEventListener('click', function() {
            window.location.href = 'jellyseerr-details.html?type=' + item.mediaType + '&id=' + item.id;
        });
        
        card.addEventListener('keydown', function(e) {
            if (e.keyCode === KeyCodes.ENTER) {
                e.preventDefault();
                window.location.href = 'jellyseerr-details.html?type=' + item.mediaType + '&id=' + item.id;
            }
            handleSimilarKeyDown(e);
        });
        
        return card;
    }

    /**
     * Load and display keywords from media details
     * Automatically hides section if no keywords available
     */
    function loadKeywords() {
        var keywords = mediaData.keywords;
        
        if (!keywords || keywords.length === 0) {
            elements.keywordsSection.style.display = 'none';
            return;
        }
        
        elements.keywordsSection.style.display = 'block';
        elements.keywordsList.innerHTML = '';
        
        keywords.forEach(function(keyword) {
            var tag = createKeywordTag(keyword);
            elements.keywordsList.appendChild(tag);
        });
    }

    /**
     * Create a keyword tag button element
     * @param {Object} keyword - Keyword object with id and name properties
     * @returns {HTMLElement} Keyword tag button
     */
    function createKeywordTag(keyword) {
        var tag = document.createElement('button');
        tag.className = 'keyword-tag';
        tag.tabIndex = 0;
        tag.textContent = keyword.name;
        tag.dataset.keywordId = keyword.id;
        tag.dataset.keywordName = keyword.name;
        
        tag.addEventListener('click', function() {
            navigateToKeyword(keyword.id, keyword.name);
        });
        
        tag.addEventListener('keydown', function(e) {
            if (e.keyCode === KeyCodes.ENTER) {
                e.preventDefault();
                navigateToKeyword(keyword.id, keyword.name);
            }
            handleKeywordsKeyDown(e);
        });
        
        return tag;
    }

    /**
     * Navigate to browse-by page filtered by keyword
     * @param {number} keywordId - TMDB keyword ID
     * @param {string} keywordName - Keyword display name
     */
    function navigateToKeyword(keywordId, keywordName) {
        var url = 'browse-by.html?type=keyword&id=' + keywordId + 
                  '&name=' + encodeURIComponent(keywordName) + 
                  '&mediaType=' + mediaType;
        window.location.href = url;
    }

    /**
     * Handle request button click
     */
    function handleRequest(is4k) {
        if (mediaType === 'tv') {
            // Show season selection modal
            showSeasonModal(is4k);
        } else {
            // Movie - request directly
            submitRequest(null, is4k);
        }
    }

    /**
     * Show season selection modal for TV shows
     */
    function showSeasonModal(is4k) {
        if (!fullDetails || !fullDetails.seasons) {
            submitRequest(null, is4k);
            return;
        }
        
        selectedSeasons = [];
        focusManager.inModal = true;
        focusManager.is4k = is4k;
        
        // Build season list
        elements.seasonList.innerHTML = '';
        fullDetails.seasons.forEach(function(season) {
            if (season.seasonNumber === 0) return; // Skip specials
            
            var checkbox = document.createElement('div');
            checkbox.className = 'season-checkbox';
            checkbox.tabIndex = 0;
            
            var input = document.createElement('input');
            input.type = 'checkbox';
            input.id = 'season-' + season.seasonNumber;
            input.value = season.seasonNumber;
            
            var label = document.createElement('label');
            label.htmlFor = 'season-' + season.seasonNumber;
            label.textContent = 'Season ' + season.seasonNumber;
            
            checkbox.appendChild(input);
            checkbox.appendChild(label);
            
            // Toggle on click
            checkbox.addEventListener('click', function() {
                input.checked = !input.checked;
            });
            
            // Toggle on ENTER or OK key
            checkbox.addEventListener('keydown', function(evt) {
                if (evt.keyCode === KeyCodes.ENTER || evt.keyCode === KeyCodes.OK) {
                    evt.preventDefault();
                    input.checked = !input.checked;
                }
            });
            
            elements.seasonList.appendChild(checkbox);
        });
        
        elements.seasonModal.style.display = 'flex';
        
        setTimeout(function() {
            elements.allSeasonsBtn.focus();
        }, 100);
    }

    /**
     * Select all seasons
     */
    function selectAllSeasons() {
        var checkboxes = elements.seasonList.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(function(checkbox) {
            checkbox.checked = true;
        });
    }

    /**
     * Select first season only
     */
    function selectFirstSeason() {
        var checkboxes = elements.seasonList.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(function(checkbox, index) {
            checkbox.checked = (index === 0);
        });
    }

    /**
     * Select latest season only
     */
    function selectLatestSeason() {
        var checkboxes = elements.seasonList.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(function(checkbox, index) {
            checkbox.checked = (index === checkboxes.length - 1);
        });
    }

    /**
     * Confirm request from modal
     */
    function confirmRequest() {
        var checkboxes = elements.seasonList.querySelectorAll('input[type="checkbox"]:checked');
        var seasons = Array.from(checkboxes).map(function(cb) {
            return parseInt(cb.value);
        });
        
        if (seasons.length === 0) {
            alert('Please select at least one season');
            return;
        }
        
        closeModal();
        submitRequest(seasons, focusManager.is4k);
    }

    /**
     * Submit request to Jellyseerr
     */
    function submitRequest(seasons, is4k) {
        
        var requestData = {
            mediaId: mediaId,
            mediaType: mediaType,
            is4k: is4k || false
        };
        
        // Add seasons for TV shows
        if (mediaType === 'tv') {
            if (seasons && seasons.length > 0) {
                requestData.seasons = seasons;
            } else {
                requestData.seasons = 'all';
            }
        }
        
        JellyseerrAPI.createRequest(requestData)
            .then(function(response) {
                showSuccessMessage((is4k ? '4K' : 'HD') + ' request submitted successfully!');
                // Reload details to update status
                loadMediaDetails();
            })
            .catch(function(error) {
                handleRequestError(error);
            });
    }

    /**
     * Navigate to person details page
     */
    function navigateToPerson(personId, personName) {
        console.log('[Jellyseerr Details] Navigating to person:', personId, personName);
        window.location.href = 'jellyseerr-person.html?id=' + personId + 
                             '&name=' + encodeURIComponent(personName);
    }

    /**
     * Handle request errors with proper messaging
     */
    function handleRequestError(error) {
        
        var message = 'Failed to submit request.';
        
        if (error.status === 403) {
            message = 'You do not have permission to request content. Please contact your administrator to grant you request permissions in Jellyseerr.';
        } else if (error.status === 401) {
            message = 'Authentication failed. Please check your Jellyseerr connection in settings.';
        } else if (error.status === 409) {
            message = 'This content has already been requested or is currently available.';
        } else if (error.status === 404) {
            message = 'Content not found in Jellyseerr. Please try again later.';
        } else if (error.message) {
            message = 'Request failed: ' + error.message;
        }
        
        showErrorDialog(message);
    }

    /**
     * Show error dialog
     */
    function showErrorDialog(message) {
        elements.errorMessage.textContent = message;
        elements.errorModal.style.display = 'flex';
        
        setTimeout(function() {
            elements.errorOkBtn.focus();
        }, 100);
    }

    /**
     * Show success message (using alert for now, could be replaced with toast)
     */
    function showSuccessMessage(message) {
        alert(message);
    }

    /**
     * Close error modal
     */
    function closeErrorModal() {
        elements.errorModal.style.display = 'none';
        
        // Return focus to last focused element
        setTimeout(function() {
            var buttons = getActionButtons();
            if (buttons.length > 0) {
                buttons[focusManager.currentIndex].focus();
            }
        }, 100);
    }

    /**
     * Close modal
     */
    function closeModal() {
        elements.seasonModal.style.display = 'none';
        focusManager.inModal = false;
        
        setTimeout(function() {
            var buttons = getActionButtons();
            if (buttons.length > 0) {
                buttons[focusManager.currentIndex].focus();
            }
        }, 100);
    }

    /**
     * Handle trailer button
     */
    function handleTrailer() {
        // Open YouTube search for trailer
        var title = mediaData.title || mediaData.name || 'Unknown';
        var year = '';
        if (mediaData.releaseDate) {
            year = new Date(mediaData.releaseDate).getFullYear();
        } else if (mediaData.firstAirDate) {
            year = new Date(mediaData.firstAirDate).getFullYear();
        }
        
        var searchQuery = encodeURIComponent(title + ' ' + year + ' official trailer');
        var youtubeUrl = 'https://www.youtube.com/results?search_query=' + searchQuery;
        
        try {
            // Try to launch YouTube app on Tizen
            if (typeof tizen !== 'undefined' && tizen.application) {
                tizen.application.launchAppControl(
                    new tizen.ApplicationControl(
                        'http://tizen.org/appcontrol/operation/view',
                        youtubeUrl
                    ),
                    null,
                    function() {
                        console.log('[JellyseerrDetails] YouTube launched');
                    },
                    function(e) {
                        console.error('[JellyseerrDetails] YouTube launch failed:', e);
                        window.open(youtubeUrl, '_blank');
                    }
                );
            } else {
                window.open(youtubeUrl, '_blank');
            }
        } catch (e) {
            window.open(youtubeUrl, '_blank');
        }
    }

    /**
     * Handle play button - search Jellyfin library and redirect to details
     */
    function handlePlay() {
        var searchTitle = mediaData.title || mediaData.name;
        var year = mediaData.releaseDate ? new Date(mediaData.releaseDate).getFullYear() : 
                   (mediaData.firstAirDate ? new Date(mediaData.firstAirDate).getFullYear() : null);
        
        // Search for this content in Jellyfin library
        var auth = JellyfinAPI.getStoredAuth();
        if (!auth) {
            window.location.href = 'search.html?query=' + encodeURIComponent(searchTitle);
            return;
        }
        
        // Build search query
        var params = [
            'SearchTerm=' + encodeURIComponent(searchTitle),
            'IncludeItemTypes=' + (mediaType === 'movie' ? 'Movie' : 'Series'),
            'Recursive=true',
            'Limit=10',
            'Fields=Overview,ProductionYear'
        ];
        
        var url = auth.serverAddress + '/Users/' + auth.userId + '/Items?' + params.join('&');
        
        ajax.request(url, {
            method: 'GET',
            headers: {
                'X-Emby-Token': auth.accessToken
            },
            success: function(response) {
                var items = response.Items || [];
                
                if (items.length === 0) {
                    // No results, go to search page
                    window.location.href = 'search.html?query=' + encodeURIComponent(searchTitle);
                    return;
                }
                
                // Try to find exact match by name and year
                var exactMatch = null;
                if (year) {
                    exactMatch = items.find(function(item) {
                        return item.ProductionYear === year;
                    });
                }
                
                // Use first result if no exact match
                var targetItem = exactMatch || items[0];
                
                // Redirect to details page
                window.location.href = 'details.html?id=' + targetItem.Id;
            },
            error: function(error) {
                // Fallback to search page
                window.location.href = 'search.html?query=' + encodeURIComponent(searchTitle);
            }
        });
    }

    /**
     * Navigate to similar content
     */
    function navigateToSimilar(id, type) {
        window.location.href = 'jellyseerr-details.html?type=' + type + '&id=' + id;
    }

    /**
     * Get action buttons
     */
    function getActionButtons() {
        return Array.from(document.querySelectorAll('.btn-action')).filter(function(btn) {
            var wrapper = btn.closest('.btn-wrapper');
            return wrapper && wrapper.style.display !== 'none' && !btn.disabled;
        });
    }
    
    /**
     * Check if we should load more recommendations
     */
    function checkRecommendationsLoadMore(currentIndex, totalItems) {
        if (!recommendationsPagination.hasMore || recommendationsPagination.isLoading) {
            return;
        }
        
        var itemsFromEnd = totalItems - currentIndex - 1;
        
        // Load more when within 3 items of the end
        if (itemsFromEnd <= 3) {
            console.log('[Jellyseerr Details] Loading more recommendations, page:', recommendationsPagination.currentPage + 1);
            loadRecommendations(recommendationsPagination.currentPage + 1);
        }
    }
    
    /**
     * Check if we should load more similar content
     */
    function checkSimilarLoadMore(currentIndex, totalItems) {
        if (!similarPagination.hasMore || similarPagination.isLoading) {
            return;
        }
        
        var itemsFromEnd = totalItems - currentIndex - 1;
        
        // Load more when within 3 items of the end
        if (itemsFromEnd <= 3) {
            console.log('[Jellyseerr Details] Loading more similar content, page:', similarPagination.currentPage + 1);
            loadSimilar(similarPagination.currentPage + 1);
        }
    }
    
    /**
     * Get cast cards
     */
    function getCastCards() {
        return Array.from(document.querySelectorAll('.cast-card'));
    }
    
    /**
     * Get recommendations cards
     */
    function getRecommendationsCards() {
        return Array.from(document.querySelectorAll('.recommendations-card'));
    }
    
    /**
     * Get similar cards
     */
    function getSimilarCards() {
        return Array.from(document.querySelectorAll('.similar-card'));
    }
    
    /**
     * Get keyword tags
     */
    function getKeywordTags() {
        return Array.from(document.querySelectorAll('.keyword-tag'));
    }

    /**
     * Handle keyboard navigation
     */
    function handleKeyDown(evt) {
        if (evt.keyCode === KeyCodes.BACK) {
            evt.preventDefault();
            if (focusManager.inModal) {
                closeModal();
            } else {
                window.history.back();
            }
            return;
        }
        
        if (focusManager.inModal) {
            handleModalKeyDown(evt);
            return;
        }
        
        if (focusManager.currentSection === 'buttons') {
            handleButtonKeyDown(evt);
        }
    }
    
    /**
     * Handle button section keyboard navigation
     */
    function handleButtonKeyDown(evt) {
        var buttons = getActionButtons();
        if (buttons.length === 0) return;
        
        switch (evt.keyCode) {
            case KeyCodes.ENTER:
            case KeyCodes.OK:
                evt.preventDefault();
                // Trigger click on the currently focused button
                if (buttons[focusManager.currentIndex]) {
                    console.log('[Jellyseerr Details] ENTER pressed on button:', buttons[focusManager.currentIndex].id);
                    buttons[focusManager.currentIndex].click();
                }
                break;
                
            case KeyCodes.UP:
                evt.preventDefault();
                // Navigate to navbar
                if (typeof NavbarController !== 'undefined' && NavbarController.focusNavbar) {
                    NavbarController.focusNavbar();
                }
                break;
                
            case KeyCodes.LEFT:
                evt.preventDefault();
                if (focusManager.currentIndex > 0) {
                    focusManager.currentIndex--;
                    buttons[focusManager.currentIndex].focus();
                }
                break;
                
            case KeyCodes.RIGHT:
                evt.preventDefault();
                if (focusManager.currentIndex < buttons.length - 1) {
                    focusManager.currentIndex++;
                    buttons[focusManager.currentIndex].focus();
                }
                break;
                
            case KeyCodes.DOWN:
                evt.preventDefault();
                var castCards = getCastCards();
                if (castCards.length > 0) {
                    focusManager.currentSection = 'cast';
                    focusManager.currentIndex = 0;
                    castCards[0].focus();
                } else {
                    var similarCards = getSimilarCards();
                    if (similarCards.length > 0) {
                        focusManager.currentSection = 'similar';
                        focusManager.currentIndex = 0;
                        similarCards[0].focus();
                    }
                }
                break;
        }
    }
    
    /**
     * Handle cast section keyboard navigation
     */
    function handleCastKeyDown(evt) {
        var castCards = getCastCards();
        var currentIndex = castCards.indexOf(document.activeElement);
        
        switch (evt.keyCode) {
            case KeyCodes.ENTER:
            case KeyCodes.OK:
                evt.preventDefault();
                var card = document.activeElement;
                var personId = parseInt(card.dataset.personId);
                var personName = card.dataset.personName;
                if (personId) {
                    navigateToPerson(personId, personName);
                }
                break;
                
            case KeyCodes.LEFT:
                evt.preventDefault();
                if (currentIndex > 0) {
                    castCards[currentIndex - 1].focus();
                }
                break;
                
            case KeyCodes.RIGHT:
                evt.preventDefault();
                if (currentIndex < castCards.length - 1) {
                    castCards[currentIndex + 1].focus();
                }
                break;
                
            case KeyCodes.UP:
                evt.preventDefault();
                focusManager.currentSection = 'buttons';
                focusManager.currentIndex = 0;
                var buttons = getActionButtons();
                if (buttons.length > 0) {
                    buttons[0].focus();
                }
                break;
                
            case KeyCodes.DOWN:
                evt.preventDefault();
                var recommendationsCards = getRecommendationsCards();
                var similarCards = getSimilarCards();
                if (recommendationsCards.length > 0) {
                    focusManager.currentSection = 'recommendations';
                    focusManager.currentIndex = 0;
                    recommendationsCards[0].focus();
                } else if (similarCards.length > 0) {
                    focusManager.currentSection = 'similar';
                    focusManager.currentIndex = 0;
                    similarCards[0].focus();
                }
                break;
        }
    }
    
    /**
     * Handle recommendations section keyboard navigation
     */
    function handleRecommendationsKeyDown(evt) {
        var recommendationsCards = getRecommendationsCards();
        var currentIndex = recommendationsCards.indexOf(document.activeElement);
        
        // Check if we should load more items
        checkRecommendationsLoadMore(currentIndex, recommendationsCards.length);
        
        switch (evt.keyCode) {
            case KeyCodes.LEFT:
                evt.preventDefault();
                if (currentIndex > 0) {
                    recommendationsCards[currentIndex - 1].focus();
                }
                break;
                
            case KeyCodes.RIGHT:
                evt.preventDefault();
                if (currentIndex < recommendationsCards.length - 1) {
                    recommendationsCards[currentIndex + 1].focus();
                } else {
                    // At the end, check if more items can be loaded
                    checkRecommendationsLoadMore(currentIndex, recommendationsCards.length);
                }
                break;
                
            case KeyCodes.UP:
                evt.preventDefault();
                var castCards = getCastCards();
                if (castCards.length > 0) {
                    focusManager.currentSection = 'cast';
                    focusManager.currentIndex = 0;
                    castCards[0].focus();
                } else {
                    focusManager.currentSection = 'buttons';
                    focusManager.currentIndex = 0;
                    var buttons = getActionButtons();
                    if (buttons.length > 0) {
                        buttons[0].focus();
                    }
                }
                break;
                
            case KeyCodes.DOWN:
                evt.preventDefault();
                var similarCards = getSimilarCards();
                if (similarCards.length > 0) {
                    focusManager.currentSection = 'similar';
                    focusManager.currentIndex = 0;
                    similarCards[0].focus();
                }
                break;
        }
    }

    /**
     * Handle similar section keyboard navigation
     */
    function handleSimilarKeyDown(evt) {
        var similarCards = getSimilarCards();
        var currentIndex = similarCards.indexOf(document.activeElement);
        
        // Check if we should load more items
        checkSimilarLoadMore(currentIndex, similarCards.length);
        
        switch (evt.keyCode) {
            case KeyCodes.LEFT:
                evt.preventDefault();
                if (currentIndex > 0) {
                    similarCards[currentIndex - 1].focus();
                }
                break;
                
            case KeyCodes.RIGHT:
                evt.preventDefault();
                if (currentIndex < similarCards.length - 1) {
                    similarCards[currentIndex + 1].focus();
                } else {
                    // At the end, check if more items can be loaded
                    checkSimilarLoadMore(currentIndex, similarCards.length);
                }
                break;
                
            case KeyCodes.UP:
                evt.preventDefault();
                var recommendationsCards = getRecommendationsCards();
                if (recommendationsCards.length > 0) {
                    focusManager.currentSection = 'recommendations';
                    focusManager.currentIndex = 0;
                    recommendationsCards[0].focus();
                } else {
                    var castCards = getCastCards();
                    if (castCards.length > 0) {
                        focusManager.currentSection = 'cast';
                        focusManager.currentIndex = 0;
                        castCards[0].focus();
                    } else {
                        focusManager.currentSection = 'buttons';
                        focusManager.currentIndex = 0;
                        var buttons = getActionButtons();
                        if (buttons.length > 0) {
                            buttons[0].focus();
                        }
                    }
                }
                break;
                
            case KeyCodes.DOWN:
                evt.preventDefault();
                var keywordTags = getKeywordTags();
                if (keywordTags.length > 0) {
                    focusManager.currentSection = 'keywords';
                    focusManager.currentIndex = 0;
                    keywordTags[0].focus();
                }
                break;
        }
    }

    /**
     * Handle keyboard navigation within keywords grid
     * Dynamically calculates row layout based on element positions
     * @param {KeyboardEvent} evt - Keyboard event
     */
    function handleKeywordsKeyDown(evt) {
        var keywordTags = getKeywordTags();
        var currentIndex = keywordTags.indexOf(document.activeElement);
        
        // Calculate actual grid layout based on element positions
        var rows = [];
        var currentRow = [];
        var lastTop = -1;
        
        keywordTags.forEach(function(tag, index) {
            var rect = tag.getBoundingClientRect();
            // Group elements with similar top positions into rows (within 5px tolerance)
            if (lastTop === -1 || Math.abs(rect.top - lastTop) < 5) {
                currentRow.push(index);
                lastTop = rect.top;
            } else {
                rows.push(currentRow);
                currentRow = [index];
                lastTop = rect.top;
            }
        });
        if (currentRow.length > 0) {
            rows.push(currentRow);
        }
        
        // Find which row and column the current element is in
        var currentRowIndex = -1;
        var currentColIndex = -1;
        for (var i = 0; i < rows.length; i++) {
            var colIndex = rows[i].indexOf(currentIndex);
            if (colIndex !== -1) {
                currentRowIndex = i;
                currentColIndex = colIndex;
                break;
            }
        }
        
        switch (evt.keyCode) {
            case KeyCodes.LEFT:
                evt.preventDefault();
                if (currentIndex > 0) {
                    keywordTags[currentIndex - 1].focus();
                }
                break;
                
            case KeyCodes.RIGHT:
                evt.preventDefault();
                if (currentIndex < keywordTags.length - 1) {
                    keywordTags[currentIndex + 1].focus();
                }
                break;
                
            case KeyCodes.UP:
                evt.preventDefault();
                if (currentRowIndex > 0) {
                    // Move up within keywords
                    var prevRow = rows[currentRowIndex - 1];
                    // Try to maintain column position, or go to last item in row if shorter
                    var targetColIndex = Math.min(currentColIndex, prevRow.length - 1);
                    keywordTags[prevRow[targetColIndex]].focus();
                } else {
                    // Move to similar section
                    var similarCards = getSimilarCards();
                    if (similarCards.length > 0) {
                        focusManager.currentSection = 'similar';
                        focusManager.currentIndex = 0;
                        similarCards[0].focus();
                    } else {
                        var recommendationsCards = getRecommendationsCards();
                        if (recommendationsCards.length > 0) {
                            focusManager.currentSection = 'recommendations';
                            focusManager.currentIndex = 0;
                            recommendationsCards[0].focus();
                        } else {
                            var castCards = getCastCards();
                            if (castCards.length > 0) {
                                focusManager.currentSection = 'cast';
                                focusManager.currentIndex = 0;
                                castCards[0].focus();
                            } else {
                                focusManager.currentSection = 'buttons';
                                focusManager.currentIndex = 0;
                                var buttons = getActionButtons();
                                if (buttons.length > 0) {
                                    buttons[0].focus();
                                }
                            }
                        }
                    }
                }
                break;
                
            case KeyCodes.DOWN:
                evt.preventDefault();
                if (currentRowIndex < rows.length - 1) {
                    // Move down within keywords
                    var nextRow = rows[currentRowIndex + 1];
                    // Try to maintain column position, or go to last item in row if shorter
                    var targetDownColIndex = Math.min(currentColIndex, nextRow.length - 1);
                    keywordTags[nextRow[targetDownColIndex]].focus();
                }
                // If at bottom of keywords, stay there (no section below)
                break;
        }
    }

    /**
     * Handle modal keyboard navigation
     */
    function handleModalKeyDown(evt) {
        // Get all focusable elements in modal
        var modalButtons = [elements.allSeasonsBtn];
        var checkboxes = Array.from(elements.seasonList.querySelectorAll('.season-checkbox'));
        var actionButtons = [elements.confirmRequestBtn, elements.cancelRequestBtn];
        
        var allFocusable = modalButtons.concat(checkboxes).concat(actionButtons).filter(function(el) { return el; });
        
        var currentIndex = allFocusable.indexOf(document.activeElement);
        if (currentIndex === -1) currentIndex = 0;
        
        switch (evt.keyCode) {
            case KeyCodes.LEFT:
            case KeyCodes.UP:
                evt.preventDefault();
                if (currentIndex > 0) {
                    allFocusable[currentIndex - 1].focus();
                }
                break;
                
            case KeyCodes.RIGHT:
            case KeyCodes.DOWN:
                evt.preventDefault();
                if (currentIndex < allFocusable.length - 1) {
                    allFocusable[currentIndex + 1].focus();
                }
                break;
        }
    }

    /**
     * Show error message
     */
    function showError(message) {
        elements.loadingIndicator.querySelector('p').textContent = message;
    }

    // Public API
    return {
        init: init
    };
})();

// Initialize on page load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', JellyseerrDetailsController.init);
} else {
    JellyseerrDetailsController.init();
}
