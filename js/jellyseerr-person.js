/**
 * Jellyseerr Person Details Page
 * Displays detailed information about a cast member/person
 */

(function() {
    'use strict';

    // Get person ID from URL parameters
    var urlParams = new URLSearchParams(window.location.search);
    var personId = parseInt(urlParams.get('id'));
    var personName = urlParams.get('name') || '';

    // State
    var personDetails = null;
    var personCredits = null;
    var biographyExpanded = false;

    // Elements
    var elements = {
        loadingIndicator: null,
        mainContent: null,
        profileImage: null,
        personName: null,
        birthInfo: null,
        knownFor: null,
        biographySection: null,
        biographyText: null,
        biographyToggle: null,
        appearancesSection: null,
        appearancesList: null
    };

    /**
     * Initialize the page
     */
    function init() {
        console.log('[Jellyseerr Person] Initializing page for person ID:', personId, 'name:', personName);

        // Cache DOM elements
        cacheElements();

        // Load person data
        if (personId) {
            console.log('[Jellyseerr Person] Person ID valid, loading details...');
            loadPersonDetails();
        } else {
            console.error('[Jellyseerr Person] No person ID specified');
            alert('Error: No person ID specified');
            history.back();
        }

        // Setup event listeners
        setupEventListeners();
    }

    /**
     * Cache DOM elements
     */
    function cacheElements() {
        elements.loadingIndicator = document.getElementById('loadingIndicator');
        elements.mainContent = document.getElementById('mainContent');
        elements.profileImage = document.getElementById('profileImage');
        elements.personName = document.getElementById('personName');
        elements.birthInfo = document.getElementById('birthInfo');
        elements.knownFor = document.getElementById('knownFor');
        elements.biographySection = document.getElementById('biographySection');
        elements.biographyText = document.getElementById('biographyText');
        elements.biographyToggle = document.getElementById('biographyToggle');
        elements.appearancesSection = document.getElementById('appearancesSection');
        elements.appearancesList = document.getElementById('appearancesList');
    }

    /**
     * Setup event listeners
     */
    function setupEventListeners() {
        // Biography toggle
        if (elements.biographyToggle) {
            elements.biographyToggle.addEventListener('click', toggleBiography);
            elements.biographyToggle.addEventListener('keydown', function(evt) {
                if (evt.keyCode === KeyCodes.ENTER || evt.keyCode === KeyCodes.OK) {
                    evt.preventDefault();
                    toggleBiography();
                }
            });
        }

        // Back button handler
        document.addEventListener('keydown', handleKeyDown);
    }
    
    /**
     * Handle keyboard navigation
     */
    function handleKeyDown(evt) {
        if (evt.keyCode === KeyCodes.BACK) {
            evt.preventDefault();
            window.history.back();
            return;
        }
        
        // Handle ENTER on biography toggle
        var activeElement = document.activeElement;
        if (activeElement === elements.biographyToggle && evt.keyCode === KeyCodes.ENTER) {
            evt.preventDefault();
            toggleBiography();
            return;
        }
        
        // Navigation between sections
        if (activeElement === elements.biographyToggle) {
            if (evt.keyCode === KeyCodes.DOWN) {
                evt.preventDefault();
                var firstCard = document.querySelector('.appearance-card');
                if (firstCard) firstCard.focus();
            }
        }
        
        // Navigate between appearance cards
        if (activeElement && activeElement.classList.contains('appearance-card')) {
            var cards = Array.from(document.querySelectorAll('.appearance-card'));
            var currentIndex = cards.indexOf(activeElement);
            
            // Calculate grid dimensions (5 items per row based on 200px width + 20px gap)
            var itemsPerRow = 5;
            
            if (evt.keyCode === KeyCodes.LEFT && currentIndex > 0) {
                evt.preventDefault();
                cards[currentIndex - 1].focus();
            } else if (evt.keyCode === KeyCodes.RIGHT && currentIndex < cards.length - 1) {
                evt.preventDefault();
                cards[currentIndex + 1].focus();
            } else if (evt.keyCode === KeyCodes.UP) {
                evt.preventDefault();
                var targetIndex = currentIndex - itemsPerRow;
                if (targetIndex >= 0) {
                    cards[targetIndex].focus();
                } else if (elements.biographyToggle && elements.biographyToggle.style.display !== 'none') {
                    elements.biographyToggle.focus();
                }
            } else if (evt.keyCode === KeyCodes.DOWN) {
                evt.preventDefault();
                var targetIndex = currentIndex + itemsPerRow;
                if (targetIndex < cards.length) {
                    cards[targetIndex].focus();
                }
            }
        }
    }

    /**
     * Load person details
     */
    function loadPersonDetails() {
        console.log('[Jellyseerr Person] Starting to load person details for ID:', personId);
        
        // Check if JellyseerrAPI is initialized
        if (typeof JellyseerrAPI === 'undefined') {
            console.error('[Jellyseerr Person] JellyseerrAPI is not defined!');
            alert('Error: JellyseerrAPI not loaded');
            history.back();
            return;
        }
        
        console.log('[Jellyseerr Person] JellyseerrAPI exists, checking initialization...');
        
        elements.loadingIndicator.style.display = 'flex';
        elements.mainContent.style.display = 'none';

        console.log('[Jellyseerr Person] Initializing JellyseerrAPI...');
        
        // Check if running on Tizen - use API key auth
        if (typeof tizen !== 'undefined') {
            console.log('[Jellyseerr Person] Tizen detected - checking for API key auth...');
            var settingsStr = storage.getUserPreference('jellyfin_settings', null);
            console.log('[Jellyseerr Person] Settings string:', settingsStr);
            var settings = null;
            var hasApiKey = false;
            var hasUrl = false;
            
            if (settingsStr) {
                try {
                    settings = JSON.parse(settingsStr);
                    console.log('[Jellyseerr Person] Settings - jellyseerrApiKey:', settings.jellyseerrApiKey ? 'SET' : 'NOT SET');
                    console.log('[Jellyseerr Person] Settings - jellyseerrUrl:', settings.jellyseerrUrl || 'NOT SET');
                    hasApiKey = settings.jellyseerrApiKey && settings.jellyseerrApiKey.length > 0;
                    hasUrl = settings.jellyseerrUrl && settings.jellyseerrUrl.length > 0;
                } catch (e) {
                    console.log('[Jellyseerr Person] Error parsing settings:', e);
                }
            }
            
            if (!hasApiKey || !hasUrl) {
                console.log('[Jellyseerr Person] No Jellyseerr configuration found');
                alert('Jellyseerr is not configured. Please configure it in settings.');
                history.back();
                return;
            }
            
            // On Tizen with API key, initialize directly
            console.log('[Jellyseerr Person] Tizen with API key - initializing directly...');
            
            var jellyseerrUrl = settings.jellyseerrUrl;
            var jellyseerrApiKey = settings.jellyseerrApiKey;
            
            console.log('[Jellyseerr Person] Jellyseerr URL:', jellyseerrUrl);
            console.log('[Jellyseerr Person] API Key length:', jellyseerrApiKey ? jellyseerrApiKey.length : 0);
            
            // Get user ID
            var auth = JellyfinAPI.getStoredAuth();
            var userId = auth ? auth.userId : null;
            
            // Set API key first
            JellyseerrAPI.setApiKey(jellyseerrApiKey);
            
            // Initialize with URL and make API calls
            JellyseerrAPI.initialize(jellyseerrUrl, jellyseerrApiKey, userId)
                .then(function() {
                    console.log('[Jellyseerr Person] API initialized, making calls...');
                    return Promise.all([
                        JellyseerrAPI.getPersonDetails(personId),
                        JellyseerrAPI.getPersonCombinedCredits(personId)
                    ]);
                })
                .then(function(results) {
                    console.log('[Jellyseerr Person] API calls successful:', results);
                    renderPersonDetails(results[0], results[1]);
                })
                .catch(function(error) {
                    console.error('[Jellyseerr Person] Error:', error);
                    elements.loadingIndicator.style.display = 'none';
                    alert('Failed to load person details: ' + (error.message || 'Unknown error'));
                    history.back();
                });
            return;
        }
        
        // Non-Tizen: Check if Jellyseerr is configured via jellyfin_settings
        var settingsStr = storage.getUserPreference('jellyfin_settings', null);
        console.log('[Jellyseerr Person] Settings:', settingsStr);
        
        if (!settingsStr) {
            console.error('[Jellyseerr Person] No settings found');
            alert('Jellyseerr is not configured. Please configure it in settings.');
            history.back();
            return;
        }
        
        var parsedSettings = JSON.parse(settingsStr);
        console.log('[Jellyseerr Person] Parsed settings:', parsedSettings);
        
        if (!parsedSettings.jellyseerrUrl) {
            console.error('[Jellyseerr Person] Jellyseerr URL not configured');
            alert('Jellyseerr is not configured. Please configure it in settings.');
            history.back();
            return;
        }
        
        // Initialize JellyseerrAPI first
        JellyseerrAPI.initializeFromPreferences()
            .then(function(isAuthenticated) {
                console.log('[Jellyseerr Person] initializeFromPreferences result:', isAuthenticated);
                
                if (!isAuthenticated) {
                    // Initialize with just the server URL (no auth required for TMDB data)
                    var auth = JellyfinAPI.getStoredAuth();
                    var userId = auth && auth.userId ? auth.userId : null;
                    return JellyseerrAPI.initialize(parsedSettings.jellyseerrUrl, null, userId);
                }
                return Promise.resolve();
            })
            .then(function() {
                console.log('[Jellyseerr Person] API initialized, making calls...');
                return Promise.all([
                    JellyseerrAPI.getPersonDetails(personId),
                    JellyseerrAPI.getPersonCombinedCredits(personId)
                ]);
            })
        .then(function(results) {
            console.log('[Jellyseerr Person] API calls successful:', results);
            personDetails = results[0];
            personCredits = results[1];
            
            displayPersonDetails();
            displayAppearances();
            
            elements.loadingIndicator.style.display = 'none';
            elements.mainContent.style.display = 'block';
            
            // Focus first focusable element
            setTimeout(function() {
                var firstFocusable = null;
                
                // Try biography toggle first (only if visible)
                if (elements.biographyToggle && elements.biographyToggle.style.display !== 'none') {
                    firstFocusable = elements.biographyToggle;
                }
                
                // If no toggle or hidden, try first appearance card
                if (!firstFocusable) {
                    firstFocusable = document.querySelector('.appearance-card');
                }
                
                if (firstFocusable) {
                    firstFocusable.focus();
                }
            }, 100);
        })
        .catch(function(error) {
            console.error('[Jellyseerr Person] Error loading person details:', error);
            elements.loadingIndicator.style.display = 'none';
            alert('Failed to load person details: ' + (error.message || 'Unknown error'));
            history.back();
        });
    }

    /**
     * Display person details
     */
    function displayPersonDetails() {
        // Profile image
        if (personDetails.profilePath) {
            elements.profileImage.src = ImageHelper.getTMDBImageUrl(personDetails.profilePath, 'w185');
        }

        // Name
        elements.personName.textContent = personDetails.name || personName;

        // Birth info
        var birthParts = [];
        if (personDetails.birthday) {
            var birthDate = formatDate(personDetails.birthday);
            if (birthDate) {
                birthParts.push('Born ' + birthDate);
            }
        }
        if (personDetails.placeOfBirth) {
            birthParts.push('in ' + personDetails.placeOfBirth);
        }
        if (birthParts.length > 0) {
            elements.birthInfo.textContent = birthParts.join(' ');
        }

        // Known for
        if (personDetails.knownForDepartment) {
            elements.knownFor.textContent = 'Known for: ' + personDetails.knownForDepartment;
        }

        // Biography
        if (personDetails.biography && personDetails.biography.trim()) {
            elements.biographySection.style.display = 'block';
            elements.biographyText.textContent = personDetails.biography;
            
            // Check if biography is long enough to need collapse (more than 4 lines)
            setTimeout(function() {
                var lineHeight = parseFloat(window.getComputedStyle(elements.biographyText).lineHeight) || 24;
                var maxHeight = lineHeight * 4;
                var actualHeight = elements.biographyText.scrollHeight;
                
                if (actualHeight > maxHeight) {
                    elements.biographyText.classList.add('collapsed');
                    elements.biographyToggle.style.display = 'inline-block';
                    elements.biographyToggle.textContent = 'Show More';
                }
            }, 100);
        }
    }

    /**
     * Toggle biography expanded/collapsed
     */
    function toggleBiography() {
        if (!elements.biographyText || !elements.biographyToggle) return;
        
        biographyExpanded = !biographyExpanded;
        
        if (biographyExpanded) {
            elements.biographyText.classList.remove('collapsed');
            elements.biographyToggle.textContent = 'Show Less';
        } else {
            elements.biographyText.classList.add('collapsed');
            elements.biographyToggle.textContent = 'Show More';
            // Scroll back to biography
            elements.biographySection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }

    /**
     * Display appearances
     */
    function displayAppearances() {
        if (!personCredits || !personCredits.cast || personCredits.cast.length === 0) {
            return;
        }

        // Filter and sort appearances
        var appearances = personCredits.cast
            .filter(function(item) {
                return item.posterPath; // Only show items with posters
            })
            .sort(function(a, b) {
                var titleA = (a.title || a.name || '').toLowerCase();
                var titleB = (b.title || b.name || '').toLowerCase();
                return titleA.localeCompare(titleB);
            })
            .slice(0, 30); // Limit to 30 items

        if (appearances.length === 0) {
            return;
        }

        elements.appearancesSection.style.display = 'block';
        elements.appearancesList.innerHTML = '';

        appearances.forEach(function(item) {
            var card = createAppearanceCard(item);
            elements.appearancesList.appendChild(card);
        });
    }

    /**
     * Create appearance card
     */
    function createAppearanceCard(item) {
        var card = document.createElement('div');
        card.className = 'appearance-card';
        card.tabIndex = 0;
        
        var posterContainer = document.createElement('div');
        posterContainer.className = 'card-poster-container';
        
        var poster = document.createElement('img');
        poster.className = 'card-poster';
        poster.src = ImageHelper.getTMDBImageUrl(item.posterPath, 'w500');
        poster.alt = item.title || item.name;
        posterContainer.appendChild(poster);
        card.appendChild(posterContainer);
        
        var title = document.createElement('p');
        title.className = 'card-title';
        title.textContent = item.title || item.name || 'Unknown';
        card.appendChild(title);
        
        var year = document.createElement('p');
        year.className = 'card-year';
        var yearText = item.releaseDate ? item.releaseDate.substring(0, 4) : 
                      item.firstAirDate ? item.firstAirDate.substring(0, 4) : '';
        year.textContent = yearText;
        card.appendChild(year);
        
        // Click handler - navigate to media details
        card.addEventListener('click', function() {
            navigateToMediaDetails(item);
        });
        
        card.addEventListener('keydown', function(evt) {
            if (evt.keyCode === KeyCodes.ENTER || evt.keyCode === KeyCodes.OK) {
                evt.preventDefault();
                navigateToMediaDetails(item);
            }
        });
        
        return card;
    }

    /**
     * Navigate to media details
     */
    function navigateToMediaDetails(item) {
        console.log('[Jellyseerr Person] Navigating to media details:', item);
        
        // Determine media type
        var mediaType = item.mediaType;
        if (!mediaType) {
            // If mediaType not set, infer from other properties
            mediaType = item.firstAirDate || item.name ? 'tv' : 'movie';
        }
        
        console.log('[Jellyseerr Person] Media type:', mediaType, 'ID:', item.id);
        window.location.href = 'jellyseerr-details.html?type=' + mediaType + '&id=' + item.id;
    }

    /**
     * Toggle biography expanded/collapsed
     */
    function toggleBiography() {
        biographyExpanded = !biographyExpanded;
        
        if (biographyExpanded) {
            elements.biographyText.classList.remove('collapsed');
            elements.biographyToggle.textContent = 'Show Less';
        } else {
            elements.biographyText.classList.add('collapsed');
            elements.biographyToggle.textContent = 'Show More';
        }
    }

    /**
     * Format date string
     */
    function formatDate(dateString) {
        if (!dateString) return null;
        
        try {
            var date = new Date(dateString);
            var options = { year: 'numeric', month: 'long', day: 'numeric' };
            return date.toLocaleDateString('en-US', options);
        } catch (e) {
            return null;
        }
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
