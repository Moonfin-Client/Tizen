/**
 * Navbar Module
 * Manages navigation bar loading, user libraries, clock, and toolbar settings
 * @module Navbar
 */
(function() {
    'use strict';
    
    const CLOCK_UPDATE_INTERVAL_MS = 60000;
    
    /**
     * Load navbar HTML component
     * @param {Function} callback - Callback to execute after navbar loads
     */
    /**
     * Load navbar HTML component
     * @param {Function} callback - Callback to execute after navbar loads
     */
    function loadNavbar(callback) {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', 'components/navbar.html', true);
        xhr.onreadystatechange = function() {
            if (xhr.readyState === 4) {
                if (xhr.status === 200) {
                    var navbarContainer = document.createElement('div');
                    navbarContainer.innerHTML = xhr.responseText;
                    document.body.insertBefore(navbarContainer.firstElementChild, document.body.firstChild);
                    if (callback) callback();
                } else {
                    if (typeof JellyfinAPI !== 'undefined') {
                    }
                }
            }
        };
        xhr.send();
    }
    
    /**
     * Initialize the navbar, load user info, libraries, and set up handlers
     */
    function initNavbar() {
        // Use MultiServerManager if available, otherwise fall back to JellyfinAPI
        var auth = typeof MultiServerManager !== 'undefined' 
            ? MultiServerManager.getAuthForPage() 
            : JellyfinAPI.getStoredAuth();
        
        if (!auth) return;
        
        var userAvatar = document.getElementById('userAvatar');
        var userAvatarImg = document.getElementById('userAvatarImg');
        
        if (userAvatar && auth.username) {
            userAvatar.textContent = auth.username.charAt(0).toUpperCase();
            userAvatar.style.display = 'flex';
        }
        
        if (userAvatarImg && auth.userId && auth.serverAddress) {
            var avatarUrl = auth.serverAddress + '/Users/' + auth.userId + '/Images/Primary?width=80&height=80&quality=90';
            var img = new Image();
            img.onload = function() {
                userAvatarImg.src = avatarUrl;
                userAvatarImg.style.display = 'block';
                if (userAvatar) {
                    userAvatar.style.display = 'none';
                }
            };
            img.onerror = function() {
                if (userAvatar) {
                    userAvatar.style.display = 'flex';
                }
            };
            img.src = avatarUrl;
        }
        
        loadUserLibraries();
        
        applyToolbarSettings();
        
        updateClock();
        setInterval(updateClock, CLOCK_UPDATE_INTERVAL_MS);
        
        setupNavbarHandlers();
    }
    
    /**
     * Apply toolbar settings from storage to the navbar
     */
    function applyToolbarSettings() {
        var settingsStr = storage.getUserPreference('jellyfin_settings', null);
        console.log('[Navbar] applyToolbarSettings - settingsStr:', settingsStr);
        if (!settingsStr) return;
        
        try {
            var settings = JSON.parse(settingsStr);
            
            var shuffleBtn = document.getElementById('shuffleBtn');
            var genresBtn = document.getElementById('genresBtn');
            var favoritesBtn = document.getElementById('favoritesBtn');
            var discoverBtn = document.getElementById('discoverBtn');
            
            if (shuffleBtn) {
                if (settings.showShuffleButton === false) {
                    console.log('[Navbar] Hiding shuffleBtn');
                    shuffleBtn.style.display = 'none';
                    shuffleBtn.style.pointerEvents = 'none';
                    shuffleBtn.setAttribute('tabindex', '-1');
                } else {
                    console.log('[Navbar] Showing shuffleBtn');
                    shuffleBtn.style.display = '';
                    shuffleBtn.style.pointerEvents = '';
                    shuffleBtn.setAttribute('tabindex', '0');
                }
            }
            
            if (genresBtn) {
                if (settings.showGenresButton === false) {
                    console.log('[Navbar] Hiding genresBtn');
                    genresBtn.style.display = 'none';
                    genresBtn.style.pointerEvents = 'none';
                    genresBtn.setAttribute('tabindex', '-1');
                } else {
                    console.log('[Navbar] Showing genresBtn');
                    genresBtn.style.display = '';
                    genresBtn.style.pointerEvents = '';
                    genresBtn.setAttribute('tabindex', '0');
                }
            }
            
            if (favoritesBtn) {
                if (settings.showFavoritesButton === false) {
                    console.log('[Navbar] Hiding favoritesBtn');
                    favoritesBtn.style.display = 'none';
                    favoritesBtn.style.pointerEvents = 'none';
                    favoritesBtn.setAttribute('tabindex', '-1');
                } else {
                    console.log('[Navbar] Showing favoritesBtn');
                    favoritesBtn.style.display = '';
                    favoritesBtn.style.pointerEvents = '';
                    favoritesBtn.setAttribute('tabindex', '0');
                }
            }
            
            var jellyseerrEnabled = settings.jellyseerrEnabled;
            var jellyseerrShowDiscover = settings.jellyseerrShowDiscover !== false;
            
            if (discoverBtn) {
                if (!jellyseerrEnabled || !jellyseerrShowDiscover) {
                    console.log('[Navbar] Hiding discoverBtn');
                    discoverBtn.style.display = 'none';
                    discoverBtn.style.pointerEvents = 'none';
                    discoverBtn.setAttribute('tabindex', '-1');
                } else {
                    console.log('[Navbar] Showing discoverBtn');
                    discoverBtn.style.display = '';
                    discoverBtn.style.pointerEvents = '';
                    discoverBtn.setAttribute('tabindex', '0');
                }
            }
            
            var libraryButtons = document.querySelectorAll('.nav-btn[data-library-id]');
            libraryButtons.forEach(function(btn) {
                if (settings.showLibrariesInToolbar === false) {
                    console.log('[Navbar] Hiding library button:', btn.textContent.trim());
                    btn.style.display = 'none';
                    btn.style.pointerEvents = 'none';
                    btn.setAttribute('tabindex', '-1');
                } else {
                    console.log('[Navbar] Showing library button:', btn.textContent.trim());
                    btn.style.display = '';
                    btn.style.pointerEvents = '';
                    btn.setAttribute('tabindex', '0');
                }
            });
        } catch (e) {}
    }
    
    /**
     * Load user libraries and add them to the navbar
     */
    function loadUserLibraries() {
        var auth = typeof MultiServerManager !== 'undefined' 
            ? MultiServerManager.getAuthForPage() 
            : JellyfinAPI.getStoredAuth();
        
        if (!auth) return;
        
        var navPill = document.querySelector('.nav-pill');
        if (!navPill) return;
        
        var existingLibraryButtons = navPill.querySelectorAll('.nav-btn[data-library-id]');
        if (existingLibraryButtons.length > 0) {
            return;
        }
        
        if (typeof ConnectionPool !== 'undefined' && MultiServerManager.getServerCount() > 0) {
            ConnectionPool.getAllLibraries(function(err, allLibraries) {
                if (err || !allLibraries) {
                    console.error('Failed to load libraries from servers:', err);
                    return;
                }
                
                var libraries = allLibraries.filter(function(item) {
                    return item.CollectionType === 'movies' || 
                           item.CollectionType === 'tvshows' || 
                           item.CollectionType === 'music' ||
                           item.CollectionType === 'boxsets' ||
                           item.CollectionType === 'livetv';
                });
                
                renderLibraryButtons(libraries);
            });
        } else {
            JellyfinAPI.getUserViews(auth.serverAddress, auth.userId, auth.accessToken, function(err, response) {
                if (err || !response || !response.Items) {
                    return;
                }
                
                var libraries = response.Items.filter(function(item) {
                    return item.CollectionType === 'movies' || 
                           item.CollectionType === 'tvshows' || 
                           item.CollectionType === 'music' ||
                           item.CollectionType === 'boxsets' ||
                           item.CollectionType === 'livetv';
                });
                
                libraries.forEach(function(lib) {
                    lib.ServerId = null;
                    lib.ServerName = auth.serverName || 'Jellyfin Server';
                    lib.ServerUrl = auth.serverAddress;
                });
                
                renderLibraryButtons(libraries);
            });
        }
    }
    
    /**
     * Render library buttons in the navbar
     * @private
     * @param {Array} libraries - Array of library objects
     */
    function renderLibraryButtons(libraries) {
        var navPill = document.querySelector('.nav-pill');
        var settingsBtn = document.getElementById('settingsBtn');
        
        if (navPill && libraries.length > 0) {
            libraries.forEach(function(library) {
                var btn = document.createElement('button');
                btn.className = 'nav-btn';
                btn.setAttribute('tabindex', '0');
                btn.setAttribute('data-library-id', library.Id);
                if (library.ServerId) {
                    btn.setAttribute('data-server-id', library.ServerId);
                }
                
                var label = document.createElement('span');
                label.className = 'nav-label';
                
                var serverCount = typeof MultiServerManager !== 'undefined' ? MultiServerManager.getServerCount() : 0;
                if (library.ServerName && serverCount > 1) {
                    label.textContent = library.Name + ' (' + library.ServerName + ')';
                    btn.title = library.Name + ' - ' + library.ServerName;
                } else {
                    label.textContent = library.Name;
                }
                
                btn.appendChild(label);
                
                btn._libraryClickHandler = function() {
                    if (library.CollectionType === 'livetv') {
                        // If multi-server, pass server ID
                        if (library.ServerId) {
                            window.location.href = 'live-tv.html?serverId=' + library.ServerId;
                        } else {
                            window.location.href = 'live-tv.html';
                        }
                    } else {
                        var url = 'library.html?id=' + library.Id;
                        if (library.ServerId) {
                            url += '&serverId=' + library.ServerId;
                        }
                        window.location.href = url;
                    }
                };
                
                btn.addEventListener('click', btn._libraryClickHandler);
                
                btn.addEventListener('keydown', function(e) {
                    if (e.keyCode === KeyCodes.ENTER && btn.style.display !== 'none') {
                        e.preventDefault();
                        btn._libraryClickHandler();
                    }
                });
                
                btn.addEventListener('focus', function() {
                    console.log('[Navbar] Library button focused:', btn.textContent.trim(), 'display:', btn.style.display, 'tabindex:', btn.getAttribute('tabindex'));
                });
                
                navPill.appendChild(btn);
            });
            
            applyToolbarSettings();
            
            setupNavbarNavigation();
        }
    }
    
    /**
     * Update the clock display in the navbar
     */
    function updateClock() {
        var clockElement = document.getElementById('navClock');
        if (!clockElement) return;
        
        var settingsStr = storage.getUserPreference('jellyfin_settings', null);
        var use24Hour = false;
        if (settingsStr) {
            try {
                var settings = JSON.parse(settingsStr);
                use24Hour = settings.clockDisplay === '24-hour';
            } catch (e) {}
        }
        
        var now = new Date();
        var hours = now.getHours();
        var minutes = now.getMinutes();
        
        minutes = minutes < 10 ? '0' + minutes : minutes;
        
        if (use24Hour) {
            hours = hours < 10 ? '0' + hours : hours;
            clockElement.textContent = hours + ':' + minutes;
        } else {
            var ampm = hours >= 12 ? 'PM' : 'AM';
            hours = hours % 12;
            hours = hours ? hours : 12; // 0 becomes 12
            clockElement.textContent = hours + ':' + minutes + ' ' + ampm;
        }
    }
    
    /**
     * Handle click on the shuffle button to play a random item
     */
    function handleShuffleClick() {
        
        var auth = JellyfinAPI.getStoredAuth();
        if (!auth) {
            return;
        }
        
        // Fetch random movie or TV show (exclude BoxSets/Collections)
        var params = {
            userId: auth.userId,
            limit: 1,
            includeItemTypes: 'Movie,Series',
            filters: 'IsNotFolder',
            sortBy: 'Random',
            fields: 'PrimaryImageAspectRatio,BasicSyncInfo',
            recursive: true,
            excludeItemTypes: 'BoxSet'
        };
        
        JellyfinAPI.getItems(auth.serverAddress, auth.accessToken, '/Users/' + auth.userId + '/Items', params, function(err, data) {
            if (err || !data || !data.Items || data.Items.length === 0) {
                return;
            }
            
            var randomItem = data.Items[0];
            window.location.href = 'details.html?id=' + randomItem.Id;
        });
    }
    
    /**
     * Set up event handlers for all navbar buttons
     */
    function setupNavbarHandlers() {
        var homeBtn = document.getElementById('homeBtn');
        var searchBtn = document.getElementById('searchBtn');
        var shuffleBtn = document.getElementById('shuffleBtn');
        var genresBtn = document.getElementById('genresBtn');
        var favoritesBtn = document.getElementById('favoritesBtn');
        var discoverBtn = document.getElementById('discoverBtn');
        var settingsBtn = document.getElementById('settingsBtn');
        var userBtn = document.getElementById('userBtn');
        
        function handleUserLogout() {
            if (typeof JellyfinAPI !== 'undefined') {
                
                // Get the current server info before logging out
                var auth = JellyfinAPI.getStoredAuth();
                var serverAddress = auth ? auth.serverAddress : null;
                
                // Logout (clears jellyfin_auth)
                JellyfinAPI.logout();
                
                // Redirect to login page
                // The login page will automatically load users for the last connected server
                window.location.href = 'login.html';
            }
        }
        
        if (homeBtn) {
            homeBtn.addEventListener('click', function() {
                window.location.href = 'browse.html';
            });
            homeBtn.addEventListener('keydown', function(e) {
                if (e.keyCode === KeyCodes.ENTER) {
                    e.preventDefault();
                    window.location.href = 'browse.html';
                }
            });
            homeBtn.addEventListener('focus', function() {
                console.log('[Navbar] homeBtn focused - display:', homeBtn.style.display, 'tabindex:', homeBtn.getAttribute('tabindex'));
            });
        }
        
        if (searchBtn) {
            searchBtn.addEventListener('click', function() {
                window.location.href = 'search.html';
            });
            searchBtn.addEventListener('keydown', function(e) {
                if (e.keyCode === KeyCodes.ENTER) {
                    e.preventDefault();
                    window.location.href = 'search.html';
                }
            });
            searchBtn.addEventListener('focus', function() {
                console.log('[Navbar] searchBtn focused - display:', searchBtn.style.display, 'tabindex:', searchBtn.getAttribute('tabindex'));
            });
        }
        
        if (shuffleBtn) {
            shuffleBtn._clickHandler = function() {
                handleShuffleClick();
            };
            
            shuffleBtn.addEventListener('click', shuffleBtn._clickHandler);
            shuffleBtn.addEventListener('keydown', function(e) {
                if (e.keyCode === KeyCodes.ENTER && shuffleBtn.style.display !== 'none') {
                    e.preventDefault();
                    handleShuffleClick();
                }
            });
            shuffleBtn.addEventListener('focus', function() {
                console.log('[Navbar] shuffleBtn focused - display:', shuffleBtn.style.display, 'tabindex:', shuffleBtn.getAttribute('tabindex'));
            });
        }
        
        if (genresBtn) {
            genresBtn._clickHandler = function() {
                window.location.href = 'genres.html';
            };
            
            genresBtn.addEventListener('click', genresBtn._clickHandler);
            genresBtn.addEventListener('keydown', function(e) {
                if (e.keyCode === KeyCodes.ENTER && genresBtn.style.display !== 'none') {
                    e.preventDefault();
                    window.location.href = 'genres.html';
                }
            });
            genresBtn.addEventListener('focus', function() {
                console.log('[Navbar] genresBtn focused - display:', genresBtn.style.display, 'tabindex:', genresBtn.getAttribute('tabindex'));
            });
        }
        
        if (favoritesBtn) {
            favoritesBtn._clickHandler = function() {
                window.location.href = 'favorites.html';
            };
            
            favoritesBtn.addEventListener('click', favoritesBtn._clickHandler);
            favoritesBtn.addEventListener('keydown', function(e) {
                if (e.keyCode === KeyCodes.ENTER && favoritesBtn.style.display !== 'none') {
                    e.preventDefault();
                    window.location.href = 'favorites.html';
                }
            });
            favoritesBtn.addEventListener('focus', function() {
                console.log('[Navbar] favoritesBtn focused - display:', favoritesBtn.style.display, 'tabindex:', favoritesBtn.getAttribute('tabindex'));
            });
        }
        
        if (discoverBtn) {
            discoverBtn.addEventListener('click', function() {
                window.location.href = 'discover.html';
            });
            discoverBtn.addEventListener('keydown', function(e) {
                if (e.keyCode === KeyCodes.ENTER) {
                    e.preventDefault();
                    window.location.href = 'discover.html';
                }
            });
            discoverBtn.addEventListener('focus', function() {
                console.log('[Navbar] discoverBtn focused - display:', discoverBtn.style.display, 'tabindex:', discoverBtn.getAttribute('tabindex'));
            });
        }
        
        if (settingsBtn) {
            settingsBtn.addEventListener('click', function() {
                window.location.href = 'settings.html';
            });
            settingsBtn.addEventListener('keydown', function(e) {
                if (e.keyCode === KeyCodes.ENTER) {
                    e.preventDefault();
                    window.location.href = 'settings.html';
                }
            });
            settingsBtn.addEventListener('focus', function() {
                console.log('[Navbar] settingsBtn focused - display:', settingsBtn.style.display, 'tabindex:', settingsBtn.getAttribute('tabindex'));
            });
        }
        
        if (userBtn) {
            userBtn.addEventListener('click', handleUserLogout);
            userBtn.addEventListener('keydown', function(e) {
                if (e.keyCode === KeyCodes.ENTER) {
                    e.preventDefault();
                    handleUserLogout();
                }
            });
        }
        
        // Add global navigation handler for all navbar buttons
        setupNavbarNavigation();
    }
    
    /**
     * Set up keyboard navigation for navbar buttons
     */
    function setupNavbarNavigation() {
        var navButtons = document.querySelectorAll('.nav-btn');
        
        navButtons.forEach(function(button, index) {
            // Remove existing listener if it exists to avoid duplicates
            if (button._navKeydownHandler) {
                button.removeEventListener('keydown', button._navKeydownHandler);
            }
            
            // Create and store the handler
            button._navKeydownHandler = function(e) {
                // Only get visible buttons for navigation
                var allButtons = Array.from(document.querySelectorAll('.nav-btn')).filter(function(btn) {
                    return btn.offsetParent !== null; // Check if button is visible
                });
                
                console.log('[Navbar] Navigation - Visible buttons:', allButtons.map(function(b) { 
                    return b.id || b.textContent.trim(); 
                }));
                
                var currentIndex = allButtons.indexOf(button);
                console.log('[Navbar] Current button index:', currentIndex, 'id:', button.id || button.textContent.trim());
                
                if (e.keyCode === KeyCodes.LEFT) {
                    e.preventDefault();
                    if (currentIndex > 0) {
                        console.log('[Navbar] Moving LEFT to:', allButtons[currentIndex - 1].id || allButtons[currentIndex - 1].textContent.trim());
                        allButtons[currentIndex - 1].focus();
                        scrollNavButtonIntoView(allButtons[currentIndex - 1]);
                    }
                } else if (e.keyCode === KeyCodes.RIGHT) {
                    e.preventDefault();
                    if (currentIndex < allButtons.length - 1) {
                        console.log('[Navbar] Moving RIGHT to:', allButtons[currentIndex + 1].id || allButtons[currentIndex + 1].textContent.trim());
                        allButtons[currentIndex + 1].focus();
                        scrollNavButtonIntoView(allButtons[currentIndex + 1]);
                    }
                }
            };
            
            button.addEventListener('keydown', button._navKeydownHandler);
        });
    }
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            loadNavbar(initNavbar);
        });
    } else {
        loadNavbar(initNavbar);
    }
    
    window.NavbarController = {
        load: loadNavbar,
        init: function(activePage) {
            initNavbar();
            setActivePage(activePage);
        },
        focusNavbar: function() {
            var homeBtn = document.getElementById('homeBtn');
            if (homeBtn) {
                homeBtn.focus();
            }
        },
        scrollNavButtonIntoView: scrollNavButtonIntoView,
        updateClock: updateClock
    };
    
    /**
     * Set the active page in the navbar
     * @param {string} page - Page identifier
     */
    function setActivePage(page) {
        // Remove active class from all buttons
        var buttons = document.querySelectorAll('.nav-btn');
        buttons.forEach(function(btn) {
            btn.classList.remove('active');
        });
        
        // Add active class to the appropriate button
        var activeBtn = null;
        switch(page) {
            case 'browse':
            case 'home':
                activeBtn = document.getElementById('homeBtn');
                break;
            case 'search':
                activeBtn = document.getElementById('searchBtn');
                break;
            case 'genres':
                activeBtn = document.getElementById('genresBtn');
                break;
            case 'favorites':
                activeBtn = document.getElementById('favoritesBtn');
                break;
            case 'discover':
                activeBtn = document.getElementById('discoverBtn');
                break;
            case 'settings':
                activeBtn = document.getElementById('settingsBtn');
                break;
        }
        
        if (activeBtn) {
            activeBtn.classList.add('active');
        }
    }
    
    /**
     * Scroll a navbar button into view within the nav-pill container
     * @param {HTMLElement} button - The button to scroll into view
     */
    /**
     * Scroll a navbar button into view within the nav-pill container
     * @param {HTMLElement} button - The button to scroll into view
     */
    function scrollNavButtonIntoView(button) {
        if (!button) return;
        
        var navPill = document.querySelector('.nav-pill');
        if (!navPill) return;
        
        var buttonLeft = button.offsetLeft;
        var buttonRight = buttonLeft + button.offsetWidth;
        var scrollLeft = navPill.scrollLeft;
        var pillWidth = navPill.offsetWidth;
        
        var SCROLL_PADDING = 20;
        
        // Check if button is out of view on the right
        if (buttonRight > scrollLeft + pillWidth) {
            navPill.scrollLeft = buttonRight - pillWidth + SCROLL_PADDING;
        }
        // Check if button is out of view on the left
        else if (buttonLeft < scrollLeft) {
            navPill.scrollLeft = buttonLeft - SCROLL_PADDING;
        }
    }
})();
