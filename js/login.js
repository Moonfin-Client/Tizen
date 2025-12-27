var LoginController = (function() {
    'use strict';

    var currentServers = [];
    var selectedServerIndex = -1;
    var connectedServer = null;
    var publicUsers = [];
    var selectedUser = null;
    var quickConnectSecret = null;
    var quickConnectInterval = null;
    var elements = {};
    
    // Timing Constants
    const FOCUS_DELAY_MS = 100;
    const UI_TRANSITION_DELAY_MS = 500;
    const QUICK_CONNECT_POLL_INTERVAL_MS = 3000;
    const LOGIN_SUCCESS_DELAY_MS = 1000;

    function init() {
        console.log('[LOGIN] init() called');
        
        // Set up navigation detection for debugging
        if (storage.get('adding_server_flow')) {
            console.log('[LOGIN] Setting up popstate listener to detect navigation');
            window.addEventListener('beforeunload', function() {
                console.error('[LOGIN] Page is about to unload!');
                console.trace();
            });
        }
        
        JellyfinAPI.init();
        cacheElements();
        setupEventListeners();
        
        // Check if we're coming from server manager with a pending server
        var pendingServer = storage.get('pending_server');
        console.log('[LOGIN] Checking pending_server:', pendingServer);
        if (pendingServer && pendingServer.url) {
            console.log('[LOGIN] Found pending server:', pendingServer);
            // Set flag to indicate we're adding (not replacing) a server
            storage.set('adding_server_flow', true);
            // Clear the pending server flag
            storage.remove('pending_server');
            
            // Pre-fill the server URL and connect directly
            if (elements.serverUrlInput) {
                elements.serverUrlInput.value = pendingServer.url;
            }
            showStatus('Connecting to ' + pendingServer.name + '...', 'info');
            
            // Get server info first, then load users
            setTimeout(function() {
                console.log('[LOGIN] setTimeout callback executing, fetching system info for:', pendingServer.url);
                JellyfinAPI.getPublicSystemInfo(pendingServer.url, function(err, systemInfo) {
                    console.log('[LOGIN] getPublicSystemInfo callback - err:', err, 'systemInfo:', systemInfo);
                    if (err || !systemInfo) {
                        showError('Failed to connect to server');
                        return;
                    }
                    
                    // Set connected server info
                    connectedServer = {
                        address: pendingServer.url,
                        name: systemInfo.ServerName || pendingServer.name,
                        id: systemInfo.Id,
                        version: systemInfo.Version
                    };
                    console.log('[LOGIN] Set connectedServer:', connectedServer);
                    
                    // Store the server info for returning after logout
                    storage.set('last_server', {
                        name: connectedServer.name,
                        address: connectedServer.address,
                        id: connectedServer.id,
                        version: connectedServer.version
                    }, true);
                    
                    showStatus('Connected to ' + connectedServer.name + '! Loading users...', 'success');
                    console.log('[LOGIN] About to call loadPublicUsers for:', connectedServer.address);
                    loadPublicUsers(connectedServer.address);
                });
            }, 500);
            console.log('[LOGIN] Returning early - pending server flow');
            return; // Stop here - don't check for existing auth or do discovery
        }
        
        console.log('[LOGIN] No pending server, checking stored auth');
        // Check if user has valid auth
        var hasAuth = checkStoredAuth();
        
        // If no valid auth, check for saved servers or show server selection
        if (!hasAuth) {
            showSavedServersOrServerInput();
        }
        
        startServerDiscovery();
    }

    function cacheElements() {
        elements = {
            serverUrlInput: document.getElementById('serverUrl'),
            connectBtn: document.getElementById('connectBtn'),
            backToServerListBtn: document.getElementById('backToServerListBtn'),
            serverList: document.getElementById('serverList'),
            
            savedServersSection: document.getElementById('savedServersSection'),
            savedServerRow: document.getElementById('savedServerRow'),
            addNewServerBtn: document.getElementById('addNewServerBtn'),
            
            userSelection: document.getElementById('userSelection'),
            userRow: document.getElementById('userRow'),
            
            loginForm: document.getElementById('loginForm'),
            useQuickConnectBtn: document.getElementById('useQuickConnectBtn'),
            usePasswordBtn: document.getElementById('usePasswordBtn'),
            
            passwordForm: document.getElementById('passwordForm'),
            passwordInput: document.getElementById('password'),
            selectedUserAvatar: document.getElementById('selectedUserAvatar'),
            selectedUserName: document.getElementById('selectedUserName'),
            loginBtn: document.getElementById('loginBtn'),
            cancelLoginBtn: document.getElementById('cancelLoginBtn'),
            
            quickConnectForm: document.getElementById('quickConnectForm'),
            qcSelectedUserAvatar: document.getElementById('qcSelectedUserAvatar'),
            qcSelectedUserName: document.getElementById('qcSelectedUserName'),
            quickConnectCode: document.getElementById('quickConnectCode'),
            quickConnectStatus: document.getElementById('quickConnectStatus'),
            cancelQuickConnectBtn: document.getElementById('cancelQuickConnectBtn'),
            
            showManualLoginBtn: document.getElementById('showManualLoginBtn'),
            deleteServerBtn: document.getElementById('deleteServerBtn'),
            backToServerBtn: document.getElementById('backToServerBtn'),
            
            manualLoginSection: document.getElementById('manualLoginSection'),
            useManualPasswordBtn: document.getElementById('useManualPasswordBtn'),
            useManualQuickConnectBtn: document.getElementById('useManualQuickConnectBtn'),
            manualPasswordForm: document.getElementById('manualPasswordForm'),
            manualUsername: document.getElementById('manualUsername'),
            manualPassword: document.getElementById('manualPassword'),
            manualLoginBtn: document.getElementById('manualLoginBtn'),
            cancelManualLoginBtn: document.getElementById('cancelManualLoginBtn'),
            manualQuickConnectForm: document.getElementById('manualQuickConnectForm'),
            manualQuickConnectCode: document.getElementById('manualQuickConnectCode'),
            manualQuickConnectStatus: document.getElementById('manualQuickConnectStatus'),
            cancelManualQuickConnectBtn: document.getElementById('cancelManualQuickConnectBtn'),
            
            errorMessage: document.getElementById('errorMessage'),
            statusMessage: document.getElementById('statusMessage'),
            manualServerSection: document.getElementById('manualServerSection'),
            discoveredServersSection: document.getElementById('discoveredServersSection')
        };
    }

    function setupEventListeners() {
        if (elements.connectBtn) {
            elements.connectBtn.addEventListener('click', handleConnect);
            elements.connectBtn.addEventListener('keydown', function(e) {
                if (e.keyCode === KeyCodes.UP) {
                    e.preventDefault();
                    if (elements.serverUrlInput) {
                        elements.serverUrlInput.focus();
                    }
                } else if (e.keyCode === KeyCodes.RIGHT) {
                    e.preventDefault();
                    if (elements.backToServerListBtn) {
                        elements.backToServerListBtn.focus();
                    }
                }
            });
        }
        if (elements.backToServerListBtn) {
            elements.backToServerListBtn.addEventListener('click', backToServerSelection);
            elements.backToServerListBtn.addEventListener('keydown', function(e) {
                if (e.keyCode === KeyCodes.UP) {
                    e.preventDefault();
                    if (elements.serverUrlInput) {
                        elements.serverUrlInput.focus();
                    }
                } else if (e.keyCode === KeyCodes.LEFT) {
                    e.preventDefault();
                    if (elements.connectBtn) {
                        elements.connectBtn.focus();
                    }
                }
            });
        }
        if (elements.serverUrlInput) {
            elements.serverUrlInput.addEventListener('keydown', function(e) {
                if (e.keyCode === KeyCodes.ENTER) {
                    handleConnect();
                } else if (e.keyCode === KeyCodes.DOWN) {
                    e.preventDefault();
                    if (elements.connectBtn) {
                        elements.connectBtn.focus();
                    }
                }
            });
        }
        
        // Add New Server button
        if (elements.addNewServerBtn) {
            elements.addNewServerBtn.addEventListener('click', showAddServerForm);
        }
        
        // Manual Login button
        if (elements.showManualLoginBtn) {
            elements.showManualLoginBtn.addEventListener('click', showManualLoginForm);
        }
        if (elements.useManualPasswordBtn) {
            elements.useManualPasswordBtn.addEventListener('click', showManualPasswordForm);
        }
        if (elements.useManualQuickConnectBtn) {
            elements.useManualQuickConnectBtn.addEventListener('click', showManualQuickConnectForm);
        }
        if (elements.manualLoginBtn) {
            elements.manualLoginBtn.addEventListener('click', handleManualLogin);
        }
        if (elements.cancelManualLoginBtn) {
            elements.cancelManualLoginBtn.addEventListener('click', cancelManualLogin);
        }
        if (elements.cancelManualQuickConnectBtn) {
            elements.cancelManualQuickConnectBtn.addEventListener('click', cancelManualLogin);
        }
        if (elements.manualPassword) {
            elements.manualPassword.addEventListener('keydown', function(e) {
                if (e.keyCode === KeyCodes.ENTER) handleManualLogin();
            });
        }
        
        // Login form listeners
        if (elements.useQuickConnectBtn) {
            elements.useQuickConnectBtn.addEventListener('click', showQuickConnectForm);
        }
        if (elements.usePasswordBtn) {
            elements.usePasswordBtn.addEventListener('click', showPasswordForm);
        }
        if (elements.loginBtn) {
            elements.loginBtn.addEventListener('click', handlePasswordLogin);
        }
        if (elements.cancelLoginBtn) {
            elements.cancelLoginBtn.addEventListener('click', backToUserSelection);
        }
        if (elements.cancelQuickConnectBtn) {
            elements.cancelQuickConnectBtn.addEventListener('click', backToUserSelection);
        }
        if (elements.manualLoginSubmitBtn) {
            elements.manualLoginSubmitBtn.addEventListener('click', handleManualLogin);
        }
        if (elements.manualUsername) {
            elements.manualUsername.addEventListener('keydown', function(e) {
                if (e.keyCode === KeyCodes.ENTER) {
                    e.preventDefault();
                    e.stopPropagation();
                    elements.manualPassword.focus();
                } else if (e.keyCode === KeyCodes.DOWN) {
                    e.preventDefault();
                    e.stopPropagation();
                    if (elements.manualPassword && elements.manualPassword.offsetParent !== null) {
                        elements.manualPassword.focus();
                    }
                } else if (e.keyCode === KeyCodes.UP) {
                    e.preventDefault();
                    e.stopPropagation();
                }
            });
        }
        if (elements.manualPassword) {
            elements.manualPassword.addEventListener('keydown', function(e) {
                if (e.keyCode === KeyCodes.ENTER) {
                    e.preventDefault();
                    e.stopPropagation();
                    handleManualLogin();
                }
                else if (e.keyCode === KeyCodes.UP) {
                    e.preventDefault();
                    e.stopPropagation();
                    if (elements.manualUsername && elements.manualUsername.offsetParent !== null) {
                        elements.manualUsername.focus();
                    }
                } else if (e.keyCode === KeyCodes.DOWN) {
                    e.preventDefault();
                    e.stopPropagation();
                    if (elements.manualLoginBtn && elements.manualLoginBtn.offsetParent !== null) {
                        elements.manualLoginBtn.focus();
                    }
                }
            });
        }
        if (elements.deleteServerBtn) {
            elements.deleteServerBtn.addEventListener('click', deleteConnectedServer);
        }
        if (elements.backToServerBtn) {
            elements.backToServerBtn.addEventListener('click', backToServerSelection);
        }
        if (elements.passwordInput) {
            elements.passwordInput.addEventListener('keydown', function(e) {
                if (e.keyCode === KeyCodes.ENTER) handlePasswordLogin();
            });
        }
    }

    function checkStoredAuth() {
        // Don't auto-redirect if we're adding a server
        var isAddingServer = storage.get('adding_server_flow');
        if (isAddingServer) {
            console.log('[LOGIN] Skipping auto-redirect - in adding_server_flow mode');
            return false;
        }
        
        var auth = JellyfinAPI.getStoredAuth();
        if (auth && auth.serverAddress && auth.userId) {
            showStatus('Resuming session as ' + auth.username + '...', 'info');
            setTimeout(function() {
                window.location.href = 'browse.html';
            }, UI_TRANSITION_DELAY_MS);
            return true;
        }
        
        // If auth is invalid, clear it
        if (auth && (!auth.serverAddress || !auth.userId)) {
            console.log('[LOGIN] Clearing invalid auth');
            storage.remove('jellyfin_auth');
        }
        
        // Check for auto-login setting
        var settingsStr = storage.getUserPreference('jellyfin_settings', null);
        var settings = null;
        if (settingsStr) {
            try {
                settings = JSON.parse(settingsStr);
            } catch (e) {}
        }
        if (settings && settings.autoLogin) {
            var lastLogin = storage.get('last_login');
            if (lastLogin && lastLogin.serverAddress && lastLogin.username) {
                attemptAutoLogin(lastLogin);
                return true;
            }
        }
        
        return false;
    }
    
    function attemptAutoLogin(lastLogin) {
        showStatus('Auto-login: connecting to ' + (lastLogin.serverName || 'server') + '...', 'info');
        
        // Connect to server first
        JellyfinAPI.getPublicSystemInfo(lastLogin.serverAddress, function(err, systemInfo) {
            if (err) {
                showError('Auto-login failed: cannot connect to server');
                clearAutoLoginData();
                setTimeout(function() {
                    showSavedServersOrServerInput();
                }, 1000);
                return;
            }
            
            connectedServer = {
                address: lastLogin.serverAddress,
                name: systemInfo.ServerName || lastLogin.serverName,
                id: systemInfo.Id
            };
            
            // Get public users to find the user
            JellyfinAPI.getPublicUsers(lastLogin.serverAddress, function(err, users) {
                if (err || !users || users.length === 0) {
                    showError('Auto-login failed: cannot get users');
                    clearAutoLoginData();
                    setTimeout(function() {
                        showSavedServersOrServerInput();
                    }, 1000);
                    return;
                }
                
                // Find the user
                var user = users.find(function(u) {
                    return u.Name === lastLogin.username;
                });
                
                if (!user) {
                    showError('Auto-login failed: user not found');
                    clearAutoLoginData();
                    setTimeout(function() {
                        showSavedServersOrServerInput();
                    }, 1000);
                    return;
                }
                
                selectedUser = user;
                
                // Attempt login with empty password (for passwordless users)
                showStatus('Auto-login: logging in as ' + user.Name + '...', 'info');
                
                JellyfinAPI.authenticateByName(lastLogin.serverAddress, user.Name, '', function(err, authData) {
                    if (err || !authData || !authData.AccessToken) {
                        // Auto-login failed, show normal login
                        showError('Auto-login failed: password required. Please login manually.');
                        clearAutoLoginData();
                        setTimeout(function() {
                            // Show user selection for manual login
                            connectedServer = {
                                address: lastLogin.serverAddress,
                                name: systemInfo.ServerName || lastLogin.serverName,
                                id: systemInfo.Id
                            };
                            publicUsers = users;
                            showUserSelection();
                        }, 1500);
                        return;
                    }
                    
                    showStatus('Auto-login successful! Welcome, ' + authData.User.Name + '!', 'success');
                    
                    setTimeout(function() {
                        window.location.href = 'browse.html';
                    }, LOGIN_SUCCESS_DELAY_MS);
                });
            });
        });
    }
    
    function clearAutoLoginData() {
        // Clear auto-login data if it fails
        storage.remove('last_login');
    }
    
    /**
     * Show saved servers if any exist, otherwise show server input form
     */
    function showSavedServersOrServerInput() {
        if (typeof MultiServerManager === 'undefined') {
            // No multi-server support, show manual input
            showManualServerInput();
            return;
        }
        
        var uniqueServers = MultiServerManager.getUniqueServers();
        
        if (uniqueServers && uniqueServers.length > 0) {
            // Show saved servers
            renderSavedServers(uniqueServers);
            if (elements.savedServersSection) {
                elements.savedServersSection.style.display = 'block';
            }
            if (elements.manualServerSection) {
                elements.manualServerSection.style.display = 'none';
            }
        } else {
            // No saved servers, show manual input
            showManualServerInput();
        }
    }
    
    /**
     * Render saved servers as clickable cards
     */
    function renderSavedServers(servers) {
        if (!elements.savedServerRow) return;
        
        elements.savedServerRow.innerHTML = '';
        
        servers.forEach(function(server, index) {
            var serverCard = document.createElement('div');
            serverCard.className = 'user-card';
            serverCard.setAttribute('tabindex', '0');
            serverCard.setAttribute('data-server-index', index);
            
            var avatar = document.createElement('div');
            avatar.className = 'user-avatar';
            avatar.textContent = server.name.charAt(0).toUpperCase();
            
            var name = document.createElement('div');
            name.className = 'user-name';
            name.textContent = server.name;
            
            serverCard.appendChild(avatar);
            serverCard.appendChild(name);
            
            // Click handler
            serverCard.addEventListener('click', function() {
                handleSavedServerClick(server);
            });
            
            // Keyboard handler
            serverCard.addEventListener('keydown', function(e) {
                var currentIndex = parseInt(this.getAttribute('data-server-index'));
                var cards = elements.savedServerRow.querySelectorAll('.user-card');
                
                if (e.keyCode === KeyCodes.ENTER) {
                    e.preventDefault();
                    handleSavedServerClick(server);
                } else if (e.keyCode === KeyCodes.RIGHT && currentIndex < cards.length - 1) {
                    e.preventDefault();
                    cards[currentIndex + 1].focus();
                } else if (e.keyCode === KeyCodes.LEFT && currentIndex > 0) {
                    e.preventDefault();
                    cards[currentIndex - 1].focus();
                } else if (e.keyCode === KeyCodes.DOWN) {
                    e.preventDefault();
                    // Move to Add New Server button
                    if (elements.addNewServerBtn) {
                        elements.addNewServerBtn.focus();
                    }
                }
            });
            
            elements.savedServerRow.appendChild(serverCard);
        });
        
        // Add keyboard navigation for Add New Server button
        if (elements.addNewServerBtn) {
            var buttonHandler = function(e) {
                if (e.keyCode === KeyCodes.UP) {
                    e.preventDefault();
                    var cards = elements.savedServerRow.querySelectorAll('.user-card');
                    if (cards.length > 0) {
                        cards[cards.length - 1].focus();
                    }
                }
            };
            // Remove old handler if exists
            elements.addNewServerBtn.removeEventListener('keydown', buttonHandler);
            elements.addNewServerBtn.addEventListener('keydown', buttonHandler);
        }
        
        // Focus first server card
        setTimeout(function() {
            var firstCard = elements.savedServerRow.querySelector('.user-card');
            if (firstCard) firstCard.focus();
        }, FOCUS_DELAY_MS);
    }
    
    /**
     * Handle click on a saved server
     */
    function handleSavedServerClick(server) {
        showStatus('Loading users for ' + server.name + '...', 'info');
        clearError();
        
        // Set connected server
        connectedServer = {
            address: server.url,
            name: server.name,
            id: server.id
        };
        
        // Get saved users for this server
        var savedUsers = MultiServerManager.getServerUsers(server.id);
        
        // Also get public users from server
        JellyfinAPI.getPublicUsers(server.url, function(err, pubUsers) {
            // Hide saved servers section
            if (elements.savedServersSection) {
                elements.savedServersSection.style.display = 'none';
            }
            
            if (err || !pubUsers) {
                showError('Failed to load users from server');
                return;
            }
            
            // Merge saved users with public users (prioritize saved credentials, but keep all public user data)
            var userMap = {};
            
            // Add public users first (they have full user data including images)
            pubUsers.forEach(function(pubUser) {
                userMap[pubUser.Id] = pubUser;
            });
            
            // Mark saved users (they have credentials)
            savedUsers.forEach(function(savedUser) {
                if (userMap[savedUser.userId]) {
                    userMap[savedUser.userId].isSaved = true;
                } else {
                    // User exists in saved but not in public list (account might be hidden)
                    userMap[savedUser.userId] = {
                        Id: savedUser.userId,
                        Name: savedUser.username,
                        HasPassword: true,
                        isSaved: true
                    };
                }
            });
            
            // Convert back to array
            var mergedUsers = [];
            for (var userId in userMap) {
                if (userMap.hasOwnProperty(userId)) {
                    mergedUsers.push(userMap[userId]);
                }
            }
            
            publicUsers = mergedUsers;
            
            // Show user selection
            renderUserRow(mergedUsers);
            if (elements.userSelection) {
                elements.userSelection.style.display = 'block';
            }
            
            clearStatus();
        });
    }
    
    /**
     * Show the add new server form
     */
    function showAddServerForm() {
        if (elements.savedServersSection) {
            elements.savedServersSection.style.display = 'none';
        }
        showManualServerInput();
    }
    
    /**
     * Show manual server input form
     */
    function showManualServerInput() {
        if (elements.manualServerSection) {
            elements.manualServerSection.style.display = 'block';
        }
        if (elements.savedServersSection) {
            elements.savedServersSection.style.display = 'none';
        }
        
        // Focus on server URL input
        setTimeout(function() {
            if (elements.serverUrlInput) {
                elements.serverUrlInput.focus();
            }
        }, FOCUS_DELAY_MS);
    }

    function startServerDiscovery() {
        showStatus('Discovering servers on your network...', 'info');
        clearError();
        
        if (elements.discoverBtn) {
            elements.discoverBtn.disabled = true;
            elements.discoverBtn.textContent = 'Searching...';
        }
        
        JellyfinAPI.discoverServers(function(err, servers) {
            if (elements.discoverBtn) {
                elements.discoverBtn.disabled = false;
                elements.discoverBtn.textContent = 'Discover Servers';
            }
            
            if (err) {
                clearStatus();
                renderServerList([]);
            } else {
                currentServers = Array.isArray(servers) ? servers : [servers];
                if (currentServers.length > 0) {
                    showStatus('Found ' + currentServers.length + ' server(s)!', 'success');
                } else {
                    clearStatus();
                }
                renderServerList(currentServers);
            }
        });
    }

    function renderServerList(servers) {
        if (!elements.serverList) return;
        
        elements.serverList.innerHTML = '';
        
        if (servers.length === 0) {
            elements.serverList.innerHTML = '<li class="server-item empty">No servers discovered</li>';
            if (elements.discoveredServersSection) {
                elements.discoveredServersSection.style.display = 'none';
            }
            return;
        }
        
        if (elements.discoveredServersSection) {
            elements.discoveredServersSection.style.display = 'block';
        }
        
        servers.forEach(function(server, index) {
            var li = document.createElement('li');
            li.className = 'server-item';
            li.setAttribute('tabindex', '0');
            
            var nameDiv = document.createElement('div');
            nameDiv.className = 'server-name';
            nameDiv.textContent = server.name || 'Jellyfin Server';
            
            var addressDiv = document.createElement('div');
            addressDiv.className = 'server-address';
            addressDiv.textContent = server.address;
            
            var versionDiv = document.createElement('div');
            versionDiv.className = 'server-version';
            versionDiv.textContent = 'Version: ' + (server.version || 'Unknown');
            
            li.appendChild(nameDiv);
            li.appendChild(addressDiv);
            li.appendChild(versionDiv);
            
            li.addEventListener('click', function() {
                selectServer(index);
            });
            
            li.addEventListener('keydown', function(e) {
                if (e.keyCode === KeyCodes.ENTER) {
                    selectServer(index);
                }
            });
            
            elements.serverList.appendChild(li);
        });
    }

    function selectServer(index) {
        selectedServerIndex = index;
        var server = currentServers[index];
        
        var allItems = elements.serverList.querySelectorAll('.server-item');
        allItems.forEach(function(item, i) {
            if (i === index) {
                item.classList.add('selected');
            } else {
                item.classList.remove('selected');
            }
        });
        
        if (elements.serverUrlInput) {
            elements.serverUrlInput.value = server.address;
        }
        
        showStatus('Selected: ' + server.name, 'success');
        
        handleConnect();
    }

    function handleConnect() {
        var serverUrl = elements.serverUrlInput.value.trim();
        
        if (!serverUrl) {
            showError('Please enter a server address or select a discovered server');
            return;
        }
        
        // Remove trailing slashes
        serverUrl = serverUrl.replace(/\/+$/, '');
        
        // Check if user provided a port
        var hasPort = /:(\d+)$/.test(serverUrl);
        var hasProtocol = /^https?:\/\//i.test(serverUrl);
        
        showStatus('Testing connection to ' + serverUrl + '...', 'info');
        clearError();
        
        if (elements.connectBtn) {
            elements.connectBtn.disabled = true;
            elements.connectBtn.textContent = 'Connecting...';
        }
        
        // If user specified a port, just try that
        if (hasPort) {
            var normalizedUrl = JellyfinAPI.normalizeServerAddress(serverUrl);
            elements.serverUrlInput.value = normalizedUrl;
            tryConnect(normalizedUrl);
        } else {
            // Try multiple ports and protocols
            var baseUrl = serverUrl.replace(/^https?:\/\//i, '');
            var urlsToTry = [];
            
            if (hasProtocol) {
                // User specified protocol, try both default and common ports
                if (serverUrl.toLowerCase().startsWith('https://')) {
                    urlsToTry = [
                        'https://' + baseUrl,           // HTTPS default (443)
                        'https://' + baseUrl + ':8920'  // HTTPS alternate
                    ];
                } else {
                    urlsToTry = [
                        'http://' + baseUrl,            // HTTP default (80)
                        'http://' + baseUrl + ':8096'   // Standard Jellyfin
                    ];
                }
            } else {
                // No protocol specified, try all common combinations
                urlsToTry = [
                    'http://' + baseUrl + ':8096',      // Standard Jellyfin HTTP (try first!)
                    'https://' + baseUrl,               // HTTPS default (443)
                    'http://' + baseUrl                 // HTTP default (80)
                ];
            }
            
            showStatus('Testing connection (trying ' + urlsToTry.length + ' configurations)...', 'info');
            tryMultiplePorts(urlsToTry, 0);
        }
        
        function tryMultiplePorts(urls, index) {
            console.log('[tryMultiplePorts] index:', index, 'of', urls.length);
            if (index >= urls.length) {
                console.log('[tryMultiplePorts] All URLs exhausted, showing error');
                if (elements.connectBtn) {
                    elements.connectBtn.disabled = false;
                    elements.connectBtn.textContent = 'Connect';
                }
                showError('Unable to connect to server. Tried ' + urls.length + ' configurations. Check the address or specify a port (e.g., http://192.168.1.1:8096)');
                return;
            }
            
            var currentUrl = urls[index];
            console.log('[tryMultiplePorts] Testing URL:', currentUrl);
            var triesRemaining = urls.length - index - 1;
            if (triesRemaining > 0) {
                showStatus('Testing ' + currentUrl + ' (' + triesRemaining + ' more to try)...', 'info');
            }
            
            JellyfinAPI.testServer(currentUrl, function(err, serverInfo) {
                console.log('[tryMultiplePorts] Callback received - err:', err, 'serverInfo:', serverInfo);
                if (err) {
                    console.log('[tryMultiplePorts] Error, trying next URL');
                    // Try next port
                    tryMultiplePorts(urls, index + 1);
                } else {
                    // Success!
                    console.log('[tryMultiplePorts] SUCCESS! Server found:', serverInfo.name);
                    if (elements.connectBtn) {
                        elements.connectBtn.disabled = false;
                        elements.connectBtn.textContent = 'Connect';
                    }
                    elements.serverUrlInput.value = currentUrl;
                    showStatus('Connected to ' + serverInfo.name + '! Loading users...', 'success');
                    
                    connectedServer = serverInfo;
                    
                    // Store the server info for returning after logout
                    console.log('[tryMultiplePorts] Storing server info...');
                    storage.set('last_server', {
                        name: serverInfo.name,
                        address: serverInfo.address,
                        id: serverInfo.id,
                        version: serverInfo.version
                    }, true);
                    
                    console.log('[tryMultiplePorts] Calling loadPublicUsers...');
                    loadPublicUsers(serverInfo.address);
                    console.log('[tryMultiplePorts] loadPublicUsers called');
                }
            });
        }
        
        function tryConnect(url) {
            JellyfinAPI.testServer(url, function(err, serverInfo) {
                if (elements.connectBtn) {
                    elements.connectBtn.disabled = false;
                    elements.connectBtn.textContent = 'Connect';
                }
                
                if (err) {
                    showError('Unable to connect to server. Check the address and try again.');
                } else {
                    showStatus('Connected to ' + serverInfo.name + '! Loading users...', 'success');
                    
                    connectedServer = serverInfo;
                    
                    // Store the server info for returning after logout
                    storage.set('last_server', {
                        name: serverInfo.name,
                        address: serverInfo.address,
                        id: serverInfo.id,
                        version: serverInfo.version
                    }, true);
                    
                    loadPublicUsers(serverInfo.address);
                }
            });
        }
    }

    function loadPublicUsers(serverAddress) {
        console.log('[LOGIN] loadPublicUsers called with serverAddress:', serverAddress);
        JellyfinAPI.getPublicUsers(serverAddress, function(err, users) {
            console.log('[LOGIN] getPublicUsers callback - err:', err, 'users count:', users ? users.length : 0);
            if (err) {
                showError('Connected to server but failed to load users');
                return;
            }
            
            if (!users || users.length === 0) {
                publicUsers = [];
                // Show toaster message
                showStatus('No public users found. Use "Add Account" to login manually.', 'info');
                // Auto-hide after 4 seconds
                setTimeout(function() {
                    clearStatus();
                }, 4000);
            } else {
                publicUsers = users;
            }
            
            console.log('[LOGIN] About to hide server selection and show user selection');
            // Hide server selection
            if (elements.manualServerSection) {
                elements.manualServerSection.style.display = 'none';
            }
            if (elements.discoveredServersSection) {
                elements.discoveredServersSection.style.display = 'none';
            }
            
            // Show user selection (even if empty)
            console.log('[LOGIN] Calling renderUserRow with', publicUsers.length, 'users');
            renderUserRow(publicUsers);
            if (elements.userSelection) {
                elements.userSelection.style.display = 'block';
            }
            
            console.log('[LOGIN] loadPublic Users complete - about to clear status');
            clearStatus();
            console.log('[LOGIN] clearStatus done - loadPublicUsers callback completed');
            
            // Add a listener to catch any unexpected navigation
            if (storage.get('adding_server_flow')) {
                console.log('[LOGIN] Adding navigation listener to catch unexpected redirects');
                var originalLocation = window.location.href;
                setTimeout(function() {
                    if (window.location.href !== originalLocation) {
                        console.error('[LOGIN] UNEXPECTED NAVIGATION DETECTED!');
                        console.error('[LOGIN] From:', originalLocation);
                        console.error('[LOGIN] To:', window.location.href);
                        console.trace();
                    }
                }, 100);
            }
        });
    }

    function renderUserRow(users) {
        if (!elements.userRow) return;
        
        elements.userRow.innerHTML = '';
        
        if (users.length === 0) {
            // Leave empty and focus Manual Login button
            if (elements.showManualLoginBtn) {
                setTimeout(function() {
                    elements.showManualLoginBtn.focus();
                }, FOCUS_DELAY_MS);
            }
            return;
        }
        
        users.forEach(function(user, index) {
            var userCard = document.createElement('div');
            userCard.className = 'user-card';
            userCard.setAttribute('tabindex', '0');
            userCard.setAttribute('data-user-index', index);
            
            var avatar = document.createElement('div');
            avatar.className = 'user-avatar';
            
            if (user.PrimaryImageTag) {
                var imgUrl = JellyfinAPI.getUserImageUrl(connectedServer.address, user.Id, user.PrimaryImageTag);
                var img = document.createElement('img');
                img.src = imgUrl;
                img.alt = user.Name;
                avatar.appendChild(img);
            } else {
                avatar.classList.add('no-image');
            }
            
            var userName = document.createElement('div');
            userName.className = 'user-name';
            userName.textContent = user.Name;
            
            userCard.appendChild(avatar);
            userCard.appendChild(userName);
            
            userCard.addEventListener('click', function() {
                selectUser(index);
            });
            
            userCard.addEventListener('keydown', function(e) {
                if (e.keyCode === KeyCodes.ENTER) {
                    e.preventDefault();
                    e.stopPropagation();
                    selectUser(index);
                } else if (e.keyCode === KeyCodes.RIGHT) {
                    e.preventDefault();
                    e.stopPropagation();
                    var nextSibling = this.nextElementSibling;
                    if (nextSibling && nextSibling.classList.contains('user-card')) {
                        nextSibling.focus();
                    }
                } else if (e.keyCode === KeyCodes.LEFT) {
                    e.preventDefault();
                    e.stopPropagation();
                    var prevSibling = this.previousElementSibling;
                    if (prevSibling && prevSibling.classList.contains('user-card')) {
                        prevSibling.focus();
                    }
                } else if (e.keyCode === KeyCodes.UP) {
                    e.preventDefault();
                    e.stopPropagation();
                    var prevSibling = this.previousElementSibling;
                    if (prevSibling && prevSibling.classList.contains('user-card')) {
                        prevSibling.focus();
                    }
                } else if (e.keyCode === KeyCodes.DOWN) {
                    e.preventDefault();
                    e.stopPropagation();
                    // First check if there's a next sibling card
                    var nextSibling = this.nextElementSibling;
                    if (nextSibling && nextSibling.classList.contains('user-card')) {
                        nextSibling.focus();
                    } else {
                        // Move to Manual Login button if we're at the last card
                        if (elements.showManualLoginBtn) {
                            elements.showManualLoginBtn.focus();
                        }
                    }
                }
            });
            
            elements.userRow.appendChild(userCard);
        });
        
        // Add keyboard navigation for buttons
        // Button order: Manual Login -> Delete Server -> Back to Server Selection
        if (elements.showManualLoginBtn) {
            var manualLoginHandler = function(e) {
                if (e.keyCode === KeyCodes.UP) {
                    e.preventDefault();
                    var cards = elements.userRow.querySelectorAll('.user-card');
                    if (cards.length > 0) {
                        cards[cards.length - 1].focus();
                    }
                } else if (e.keyCode === KeyCodes.RIGHT) {
                    e.preventDefault();
                    if (elements.deleteServerBtn) {
                        elements.deleteServerBtn.focus();
                    } else if (elements.backToServerBtn) {
                        elements.backToServerBtn.focus();
                    }
                } else if (e.keyCode === KeyCodes.LEFT) {
                    e.preventDefault();
                    var cards = elements.userRow.querySelectorAll('.user-card');
                    if (cards.length > 0) {
                        cards[cards.length - 1].focus();
                    }
                }
            };
            elements.showManualLoginBtn.removeEventListener('keydown', manualLoginHandler);
            elements.showManualLoginBtn.addEventListener('keydown', manualLoginHandler);
        }
        
        if (elements.deleteServerBtn) {
            var deleteServerHandler = function(e) {
                if (e.keyCode === KeyCodes.UP) {
                    e.preventDefault();
                    var cards = elements.userRow.querySelectorAll('.user-card');
                    if (cards.length > 0) {
                        cards[cards.length - 1].focus();
                    }
                } else if (e.keyCode === KeyCodes.RIGHT) {
                    e.preventDefault();
                    if (elements.backToServerBtn) {
                        elements.backToServerBtn.focus();
                    }
                } else if (e.keyCode === KeyCodes.LEFT) {
                    e.preventDefault();
                    if (elements.showManualLoginBtn) {
                        elements.showManualLoginBtn.focus();
                    }
                }
            };
            elements.deleteServerBtn.removeEventListener('keydown', deleteServerHandler);
            elements.deleteServerBtn.addEventListener('keydown', deleteServerHandler);
        }
        
        if (elements.backToServerBtn) {
            var backToServerHandler = function(e) {
                if (e.keyCode === KeyCodes.UP) {
                    e.preventDefault();
                    var cards = elements.userRow.querySelectorAll('.user-card');
                    if (cards.length > 0) {
                        cards[cards.length - 1].focus();
                    }
                } else if (e.keyCode === KeyCodes.LEFT) {
                    e.preventDefault();
                    if (elements.deleteServerBtn) {
                        elements.deleteServerBtn.focus();
                    } else if (elements.showManualLoginBtn) {
                        elements.showManualLoginBtn.focus();
                    }
                } else if (e.keyCode === KeyCodes.RIGHT) {
                    e.preventDefault();
                    if (elements.showManualLoginBtn) {
                        elements.showManualLoginBtn.focus();
                    }
                }
            };
            elements.backToServerBtn.removeEventListener('keydown', backToServerHandler);
            elements.backToServerBtn.addEventListener('keydown', backToServerHandler);
        }
        
        // Focus the first user card
        if (users.length > 0) {
            setTimeout(function() {
                var firstCard = elements.userRow.querySelector('.user-card');
                if (firstCard) {
                    firstCard.focus();
                }
            }, FOCUS_DELAY_MS);
        }
    }

    function selectUser(index) {
        selectedUser = publicUsers[index];
        
        // Update UI to show selected state
        var allCards = elements.userRow.querySelectorAll('.user-card');
        allCards.forEach(function(card, i) {
            if (i === index) {
                card.classList.add('selected');
            } else {
                card.classList.remove('selected');
            }
        });
        
        // Auto-login for saved users
        if (selectedUser.isSaved && connectedServer) {
            console.log('[LOGIN] Auto-logging in saved user:', selectedUser.Name);
            showStatus('Logging in as ' + selectedUser.Name + '...', 'info');
            
            // Get saved credentials from MultiServerManager
            var savedUsers = MultiServerManager.getServerUsers(connectedServer.id);
            var savedUser = savedUsers.find(function(u) { return u.userId === selectedUser.Id; });
            
            if (savedUser && savedUser.accessToken) {
                // Store authentication data
                var authData = {
                    serverAddress: connectedServer.address,
                    userId: savedUser.userId,
                    accessToken: savedUser.accessToken,
                    username: savedUser.username,
                    serverId: connectedServer.id,
                    serverName: connectedServer.name
                };
                storage.set('jellyfin_auth', authData);
                
                // Set as active server
                MultiServerManager.setActiveServer(connectedServer.id, savedUser.userId);
                
                // Verify authentication and redirect
                JellyfinAPI.getUserInfo(connectedServer.address, savedUser.userId, savedUser.accessToken, function(err, userInfo) {
                    if (err) {
                        console.log('[LOGIN] Saved credentials failed, showing login form:', err);
                        showError('Saved credentials expired. Please sign in again.');
                        showLoginOptions();
                    } else {
                        console.log('[LOGIN] Auto-login successful for:', userInfo.Name);
                        clearStatus();
                        window.location.href = 'browse.html';
                    }
                });
            } else {
                console.log('[LOGIN] Saved user has no access token');
                showLoginOptions();
            }
        } else {
            // Show login options for non-saved users
            showLoginOptions();
        }
    }

    function showLoginOptions() {
        if (elements.userSelection) {
            elements.userSelection.style.display = 'none';
        }
        if (elements.loginForm) {
            elements.loginForm.style.display = 'block';
        }
        if (elements.useQuickConnectBtn) {
            elements.useQuickConnectBtn.style.display = 'inline-block';
        }
        if (elements.usePasswordBtn) {
            elements.usePasswordBtn.style.display = 'inline-block';
        }
        
        // Default to password form
        showPasswordForm();
    }

    function showManualLoginForm() {
        if (!connectedServer) {
            showError('No server connected');
            return;
        }
        
        // Hide user selection
        if (elements.userSelection) {
            elements.userSelection.style.display = 'none';
        }
        
        // Show manual login section
        if (elements.manualLoginSection) {
            elements.manualLoginSection.style.display = 'block';
        }
        
        // Show both login method buttons
        if (elements.useManualPasswordBtn) {
            elements.useManualPasswordBtn.style.display = 'inline-block';
        }
        if (elements.useManualQuickConnectBtn) {
            elements.useManualQuickConnectBtn.style.display = 'inline-block';
        }
        
        // Show password form by default
        showManualPasswordForm();
        
        clearError();
        clearStatus();
    }
    
    function showManualPasswordForm() {
        // Hide Quick Connect form
        if (elements.manualQuickConnectForm) {
            elements.manualQuickConnectForm.style.display = 'none';
        }
        
        // Show password form
        if (elements.manualPasswordForm) {
            elements.manualPasswordForm.style.display = 'block';
        }
        
        // Hide Use Password button, show Use Quick Connect button
        if (elements.useManualPasswordBtn) {
            elements.useManualPasswordBtn.style.display = 'none';
        }
        if (elements.useManualQuickConnectBtn) {
            elements.useManualQuickConnectBtn.style.display = 'inline-block';
        }
        
        // Clear and focus username
        if (elements.manualUsername) {
            elements.manualUsername.value = '';
            elements.manualUsername.focus();
        }
        if (elements.manualPassword) {
            elements.manualPassword.value = '';
        }
        
        clearError();
    }
    
    function showManualQuickConnectForm() {
        // Hide password form
        if (elements.manualPasswordForm) {
            elements.manualPasswordForm.style.display = 'none';
        }
        
        // Show Quick Connect form
        if (elements.manualQuickConnectForm) {
            elements.manualQuickConnectForm.style.display = 'block';
        }
        
        // Hide Use Quick Connect button, show Use Password button
        if (elements.useManualQuickConnectBtn) {
            elements.useManualQuickConnectBtn.style.display = 'none';
        }
        if (elements.useManualPasswordBtn) {
            elements.useManualPasswordBtn.style.display = 'inline-block';
        }
        
        // Quick Connect doesn't need username - initiate directly
        initiateManualQuickConnect();
        
        clearError();
    }
    
    /**
     * Initiate Quick Connect flow (shared logic for manual and regular login)
     * @param {Object} config - Configuration object
     * @param {HTMLElement} config.codeElement - Element to display QC code
     * @param {HTMLElement} config.statusElement - Element to display status
     * @param {Function} config.onSuccess - Callback on successful authentication
     * @param {Function} config.onError - Callback on error
     */
    function initiateQuickConnectFlow(config) {
        if (!connectedServer) {
            showError('No server connected');
            return;
        }
        
        showStatus('Initiating Quick Connect...', 'info');
        
        JellyfinAPI.initiateQuickConnect(connectedServer.address, function(err, data) {
            if (err || !data || !data.Secret) {
                clearStatus();
                showError('Quick Connect is not available');
                if (config.onError) config.onError();
                return;
            }
            
            quickConnectSecret = data.Secret;
            
            if (config.codeElement) {
                config.codeElement.textContent = data.Code || '------';
            }
            if (config.statusElement) {
                config.statusElement.textContent = 'Waiting for authentication...';
                if (config.statusElement.classList) {
                    config.statusElement.classList.remove('authenticated');
                }
            }
            
            clearStatus();
            
            // Start polling for Quick Connect completion
            if (quickConnectInterval) {
                clearInterval(quickConnectInterval);
            }
            quickConnectInterval = setInterval(function() {
                pollQuickConnectStatus(config);
            }, QUICK_CONNECT_POLL_INTERVAL_MS);
            
            // Check immediately
            if (config.checkImmediately) {
                pollQuickConnectStatus(config);
            }
        });
    }
    
    /**
     * Poll Quick Connect status (shared logic for manual and regular login)
     * @param {Object} config - Configuration object (same as initiateQuickConnectFlow)
     */
    function pollQuickConnectStatus(config) {
        if (!quickConnectSecret || !connectedServer) {
            stopQuickConnectPolling();
            return;
        }
        
        // First check the status
        JellyfinAPI.checkQuickConnectStatus(connectedServer.address, quickConnectSecret, function(err, statusData) {
            if (err) {
                return; // Keep polling
            }
            
            if (!statusData) {
                // Still waiting
                return;
            }
            
            // Check if authenticated
            if (statusData.Authenticated !== true) {
                // Still waiting for user to approve
                return;
            }
            
            // User has approved! Now exchange the secret for access token
            JellyfinAPI.authenticateQuickConnect(connectedServer.address, quickConnectSecret, function(authErr, authData) {
                if (authErr) {
                    stopQuickConnectPolling();
                    showError('Quick Connect authentication failed: ' + (authErr.error || 'Unknown error'));
                    if (config.onError) config.onError();
                    return;
                }
                
                if (!authData || !authData.AccessToken || !authData.User) {
                    stopQuickConnectPolling();
                    showError('Quick Connect authentication response invalid');
                    if (config.onError) config.onError();
                    return;
                }
                
                stopQuickConnectPolling();
                
                // Update status if element provided
                if (config.statusElement) {
                    config.statusElement.textContent = 'Authenticated! Logging in...';
                    if (config.statusElement.classList) {
                        config.statusElement.classList.add('authenticated');
                    }
                }
                
                // Note: Auth is already stored by authenticateQuickConnect in jellyfin-api.js
                
                // Check if we're adding a server (not replacing)
                var isAddingServer = storage.get('adding_server_flow');
                if (isAddingServer) {
                    storage.remove('adding_server_flow');
                    
                    // Add to multi-server system
                    if (typeof MultiServerManager !== 'undefined') {
                        // Use server name from connectedServer (fetched from /System/Info/Public)
                        var serverName = connectedServer.name || 'Jellyfin Server';
                        MultiServerManager.addServer(
                            connectedServer.address,
                            serverName,
                            authData.User.Id,
                            authData.User.Name,
                            authData.AccessToken
                        );
                        
                        showStatus('Server added successfully!', 'success');
                        
                        setTimeout(function() {
                            window.location.href = 'settings.html';
                        }, LOGIN_SUCCESS_DELAY_MS);
                        return;
                    }
                }
                
                // Store server info for last login
                storage.set('jellyfin_last_server', {
                    address: connectedServer.address,
                    name: connectedServer.name,
                    username: authData.User.Name
                });
                
                // Save for auto-login
                storage.set('last_login', {
                    serverAddress: connectedServer.address,
                    serverName: connectedServer.name,
                    username: authData.User.Name,
                    isQuickConnect: true
                });
                
                showStatus('Login successful! Welcome, ' + authData.User.Name + '!', 'success');
                
                if (config.onSuccess) {
                    config.onSuccess(authData);
                } else {
                    setTimeout(function() {
                        window.location.href = 'browse.html';
                    }, LOGIN_SUCCESS_DELAY_MS);
                }
            });
        });
    }
    
    /**
     * Stop Quick Connect polling
     */
    function stopQuickConnectPolling() {
        if (quickConnectInterval) {
            clearInterval(quickConnectInterval);
            quickConnectInterval = null;
        }
        quickConnectSecret = null;
    }
    
    function initiateManualQuickConnect() {
        initiateQuickConnectFlow({
            codeElement: elements.manualQuickConnectCode,
            statusElement: elements.manualQuickConnectStatus,
            onError: null
        });
    }
    
    function cancelManualLogin() {
        // Stop Quick Connect polling if active
        stopQuickConnectPolling();
        
        // Hide manual login section
        if (elements.manualLoginSection) {
            elements.manualLoginSection.style.display = 'none';
        }
        if (elements.manualPasswordForm) {
            elements.manualPasswordForm.style.display = 'none';
        }
        if (elements.manualQuickConnectForm) {
            elements.manualQuickConnectForm.style.display = 'none';
        }
        
        // Show user selection
        if (elements.userSelection) {
            elements.userSelection.style.display = 'block';
        }
        
        // Focus first user card or Manual Login button
        setTimeout(function() {
            var userCards = document.querySelectorAll('.user-card');
            if (userCards.length > 0) {
                userCards[0].focus();
            } else if (elements.showManualLoginBtn) {
                elements.showManualLoginBtn.focus();
            }
        }, FOCUS_DELAY_MS);
        
        clearError();
    }
    
    function handleManualLogin() {
        if (!connectedServer) {
            showError('No server connected');
            return;
        }
        
        var username = elements.manualUsername ? elements.manualUsername.value.trim() : '';
        var password = elements.manualPassword ? elements.manualPassword.value : '';
        
        if (!username) {
            showError('Please enter a username');
            if (elements.manualUsername) {
                elements.manualUsername.focus();
            }
            return;
        }
        
        clearError();
        showStatus('Logging in as ' + username + '...', 'info');
        
        JellyfinAPI.authenticateByName(
            connectedServer.address,
            username,
            password,
            function(err, authData) {
                if (err || !authData) {
                    showError('Login failed! Check your username and password.');
                    return;
                }
                
                if (!authData.accessToken || !authData.userId) {
                    showError('Login failed! Invalid response from server.');
                    return;
                }
                
                // Note: authData from authenticateByName already stores auth, no need to call storeAuth again
                
                // Check if we're adding a server (not replacing)
                var isAddingServer = storage.get('adding_server_flow');
                if (isAddingServer) {
                    storage.remove('adding_server_flow');
                    
                    // Add to multi-server system
                    if (typeof MultiServerManager !== 'undefined') {
                        // Use server name from connectedServer (fetched from /System/Info/Public)
                        var serverName = connectedServer.name || 'Jellyfin Server';
                        MultiServerManager.addServer(
                            connectedServer.address,
                            serverName,
                            authData.userId,
                            authData.username,
                            authData.accessToken
                        );
                        
                        showStatus('Server added successfully!', 'success');
                        
                        setTimeout(function() {
                            window.location.href = 'settings.html';
                        }, LOGIN_SUCCESS_DELAY_MS);
                        return;
                    }
                }
                
                // Store server info for last login
                storage.set('jellyfin_last_server', {
                    address: connectedServer.address,
                    name: connectedServer.name,
                    username: authData.username
                });
                
                showStatus('Login successful! Welcome, ' + authData.username + '!', 'success');
                
                setTimeout(function() {
                    window.location.href = 'browse.html';
                }, LOGIN_SUCCESS_DELAY_MS);
            }
        );
    }

    function showPasswordForm() {
        hideAllLoginMethods();
        
        if (elements.passwordForm) {
            elements.passwordForm.style.display = 'block';
        }
        
        // Hide Use Password button, show Use Quick Connect button
        if (elements.usePasswordBtn) {
            elements.usePasswordBtn.style.display = 'none';
        }
        if (elements.useQuickConnectBtn) {
            elements.useQuickConnectBtn.style.display = 'inline-block';
        }
        
        // Update user info
        updateSelectedUserInfo(elements.selectedUserAvatar, elements.selectedUserName);
        
        if (elements.passwordInput) {
            elements.passwordInput.value = '';
            elements.passwordInput.focus();
        }
    }

    function showQuickConnectForm() {
        hideAllLoginMethods();
        
        if (elements.quickConnectForm) {
            elements.quickConnectForm.style.display = 'block';
        }
        
        // Hide Use Quick Connect button, show Use Password button
        if (elements.useQuickConnectBtn) {
            elements.useQuickConnectBtn.style.display = 'none';
        }
        if (elements.usePasswordBtn) {
            elements.usePasswordBtn.style.display = 'inline-block';
        }
        
        // Update user info
        updateSelectedUserInfo(elements.qcSelectedUserAvatar, elements.qcSelectedUserName);
        
        // Initiate Quick Connect
        initiateQuickConnect();
    }

    function hideAllLoginMethods() {
        if (elements.passwordForm) {
            elements.passwordForm.style.display = 'none';
        }
        if (elements.quickConnectForm) {
            elements.quickConnectForm.style.display = 'none';
        }
        if (elements.manualLoginForm) {
            elements.manualLoginForm.style.display = 'none';
        }
    }

    function updateSelectedUserInfo(avatarElement, nameElement) {
        if (!selectedUser) return;
        
        if (nameElement) {
            nameElement.textContent = selectedUser.Name;
        }
        
        if (avatarElement) {
            if (selectedUser.PrimaryImageTag) {
                var imgUrl = JellyfinAPI.getUserImageUrl(connectedServer.address, selectedUser.Id, selectedUser.PrimaryImageTag);
                avatarElement.src = imgUrl;
                avatarElement.classList.remove('no-image');
            } else {
                // Don't set src attribute when there's no image - this prevents broken image placeholder
                avatarElement.removeAttribute('src');
                avatarElement.classList.add('no-image');
            }
        }
    }

    function backToUserSelection() {
        stopQuickConnect();
        
        if (elements.loginForm) {
            elements.loginForm.style.display = 'none';
        }
        if (elements.manualLoginForm) {
            elements.manualLoginForm.style.display = 'none';
        }
        if (elements.userSelection) {
            elements.userSelection.style.display = 'block';
        }
        
        selectedUser = null;
    }
    
    function deleteConnectedServer() {
        if (!connectedServer) {
            showError('No server connected');
            return;
        }
        
        showConfirmation(
            'Delete Server',
            'Are you sure you want to delete "' + connectedServer.name + '" from this device? You can re-add it later.',
            function(confirmed) {
                if (confirmed) {
                    // Remove from MultiServerManager
                    if (typeof MultiServerManager !== 'undefined') {
                        // Get all users for this server
                        var usersForServer = MultiServerManager.getServerUsers(connectedServer.id);
                        
                        // Remove each user from the server
                        usersForServer.forEach(function(user) {
                            MultiServerManager.removeServer(connectedServer.id, user.userId);
                        });
                        
                        showStatus('Server deleted successfully', 'success');
                    }
                    
                    // Go back to server selection
                    setTimeout(function() {
                        backToServerSelection();
                    }, 1000);
                }
            }
        );
    }

    function backToServerSelection() {
        // Clear all connection state
        connectedServer = null;
        publicUsers = [];
        selectedUser = null;
        stopQuickConnect();
        storage.remove('last_server');
        
        // Hide user selection and login forms
        if (elements.userSelection) {
            elements.userSelection.style.display = 'none';
        }
        if (elements.loginForm) {
            elements.loginForm.style.display = 'none';
        }
        if (elements.manualLoginForm) {
            elements.manualLoginForm.style.display = 'none';
        }
        if (elements.manualServerSection) {
            elements.manualServerSection.style.display = 'none';
        }
        
        clearError();
        clearStatus();
        
        // Show saved servers or manual input
        showSavedServersOrServerInput();
    }

    function handlePasswordLogin() {
        if (!selectedUser || !connectedServer) {
            showError('Please select a user first');
            return;
        }
        
        var password = elements.passwordInput.value; // Don't trim - preserve empty string
        
        // Password can be empty (Jellyfin supports passwordless users)
        if (password === null || password === undefined) {
            showError('Password field is invalid');
            return;
        }
        
        showStatus('Logging in as ' + selectedUser.Name + '...', 'info');
        clearError();
        
        if (elements.loginBtn) {
            elements.loginBtn.disabled = true;
            elements.loginBtn.textContent = 'Logging in...';
        }
        
        JellyfinAPI.authenticateByName(connectedServer.address, selectedUser.Name, password, function(err, authData) {
            if (elements.loginBtn) {
                elements.loginBtn.disabled = false;
                elements.loginBtn.textContent = 'Login';
            }
            
            if (err) {
                showError('Login failed! Check your password.');
                return;
            }
            
            if (!authData || !authData.accessToken) {
                showError('Login failed! Invalid response from server.');
                return;
            }
            
            showStatus('Login successful! Welcome, ' + authData.username + '!', 'success');
            
            // Clear adding_server_flow flag if we're logging into an existing server
            // (not adding a new one from settings)
            var isAddingServer = storage.get('adding_server_flow');
            if (isAddingServer) {
                // Check if this server already existed in MultiServerManager by URL (not name)
                var existingServers = MultiServerManager ? MultiServerManager.getUniqueServers() : [];
                var serverExists = existingServers.some(function(s) {
                    // Normalize URLs for comparison (remove trailing slashes, standardize)
                    var normalizeUrl = function(url) {
                        return url.replace(/\/+$/, '').toLowerCase();
                    };
                    return normalizeUrl(s.url) === normalizeUrl(connectedServer.address);
                });
                
                // If server already existed, we're just logging in, not adding
                if (serverExists) {
                    console.log('[LOGIN] Clearing adding_server_flow - logging into existing server');
                    storage.remove('adding_server_flow');
                } else {
                    console.log('[LOGIN] Keeping adding_server_flow - this is a new server');
                }
            }
            
            // Save login info for auto-login (only for passwordless users)
            if (!password || password === '') {
                storage.set('last_login', {
                    serverAddress: connectedServer.address,
                    serverName: connectedServer.name,
                    username: selectedUser.Name
                });
            }
            
            elements.passwordInput.value = '';
            
            setTimeout(function() {
                window.location.href = 'browse.html';
            }, 1000);
        });
    }

    function initiateQuickConnect() {
        if (!connectedServer) {
            showError('No server connected');
            return;
        }
        
        if (elements.quickConnectCode) {
            elements.quickConnectCode.textContent = '------';
        }
        if (elements.quickConnectStatus) {
            elements.quickConnectStatus.textContent = 'Initiating Quick Connect...';
            elements.quickConnectStatus.classList.remove('authenticated');
        }
        
        initiateQuickConnectFlow({
            codeElement: elements.quickConnectCode,
            statusElement: elements.quickConnectStatus,
            checkImmediately: true,
            onError: backToUserSelection
        });
    }

    function stopQuickConnect() {
        stopQuickConnectPolling();
    }

    function handleManualLogin() {
        var username = elements.manualUsername ? elements.manualUsername.value.trim() : '';
        var password = elements.manualPassword ? elements.manualPassword.value : '';
        
        // Don't auto-login if we're adding a server and no credentials entered
        var isAddingServer = storage.get('adding_server_flow');
        if (isAddingServer && !username) {
            console.log('[LOGIN] handleManualLogin called but skipping - in adding_server_flow mode with no username entered');
            return;
        }
        
        if (!username) {
            showError('Please enter a username');
            if (elements.manualUsername) {
                elements.manualUsername.focus();
            }
            return;
        }
        
        if (!connectedServer) {
            showError('No server connected');
            return;
        }
        
        showStatus('Logging in as ' + username + '...', 'info');
        clearError();
        
        // Store connected server info for authentication to use
        var isAddingServer = storage.get('adding_server_flow');
        if (isAddingServer && connectedServer) {
            storage.set('pending_server', {
                name: connectedServer.name,
                url: connectedServer.address
            });
        }
        
        // Disable login button
        if (elements.manualLoginBtn) {
            elements.manualLoginBtn.disabled = true;
            elements.manualLoginBtn.textContent = 'Logging in...';
        }
        
        JellyfinAPI.authenticateByName(
            connectedServer.address,
            username,
            password,
            function(err, authData) {
                // Re-enable button
                if (elements.manualLoginBtn) {
                    elements.manualLoginBtn.disabled = false;
                    elements.manualLoginBtn.textContent = 'Login';
                }
                
                if (err) {
                    
                    if (err.error === 401) {
                        showError('Invalid username or password');
                    } else if (err.error === 'timeout') {
                        showError('Connection timeout. Please try again.');
                    } else {
                        showError('Login failed. Please try again.');
                    }
                    
                    if (elements.manualPassword) {
                        elements.manualPassword.value = '';
                        elements.manualPassword.focus();
                    }
                    return;
                }
                
                if (!authData || !authData.accessToken) {
                    showError('Login failed - no access token received');
                    return;
                }
                
                showStatus('Login successful! Welcome, ' + authData.username + '!', 'success');
                
                // Check if we're in the "adding server" flow
                const isAddingServer = storage.get('adding_server_flow');
                console.log('[LOGIN] After successful login, adding_server_flow:', isAddingServer);
                
                setTimeout(function() {
                    if (isAddingServer) {
                        console.log('[LOGIN] In adding_server_flow, redirecting to settings.html');
                        storage.remove('adding_server_flow');
                        storage.remove('pending_server');
                        window.location.href = 'settings.html';
                    } else {
                        console.log('[LOGIN] Normal login, redirecting to browse.html');
                        window.location.href = 'browse.html';
                    }
                }, LOGIN_SUCCESS_DELAY_MS);
            }
        );
    }

    function showError(message) {
        if (elements.errorMessage) {
            elements.errorMessage.textContent = message;
            elements.errorMessage.style.display = 'block';
        }
    }

    function clearError() {
        if (elements.errorMessage) {
            elements.errorMessage.style.display = 'none';
            elements.errorMessage.textContent = '';
        }
    }

    function showStatus(message, type) {
        if (elements.statusMessage) {
            elements.statusMessage.textContent = message;
            elements.statusMessage.className = 'status-message ' + (type || 'info');
            elements.statusMessage.style.display = 'block';
        }
    }
    
    function clearStatus() {
        if (elements.statusMessage) {
            elements.statusMessage.textContent = '';
            elements.statusMessage.style.display = 'none';
        }
    }

    return {
        init: init
    };
})();

window.addEventListener('load', function() {
    LoginController.init();
});
