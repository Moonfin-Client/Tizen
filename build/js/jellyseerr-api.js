/*
 * Jellyseerr API Client for Tizen
 * Handles Jellyseerr server communication, authentication, and API calls
 * 
 * This module provides a complete HTTP client for interacting with Jellyseerr API
 * including cookie-based session management and API key authentication.
 */

var JellyseerrAPI = (function() {
    'use strict';

    // ==================== Constants ====================
    
    const REQUEST_TIMEOUT_MS = 30000; // 30 seconds
    const API_VERSION = 'v1';
    
    const LOG_LEVELS = {
        ERROR: 0,
        WARN: 1,
        SUCCESS: 2,
        INFO: 3,
        DEBUG: 4
    };

    let currentLogLevel = LOG_LEVELS.INFO;

    // ==================== Logger ====================
    
    const Logger = {
        levels: LOG_LEVELS,
        setLevel: function(level) {
            currentLogLevel = level;
        },
        _ts: function() {
            try { return new Date().toISOString(); } catch (e) { return '';
            }
        },
        _sanitize: function(args) {
            function maskString(str) {
                if (typeof str !== 'string') return str;
                // Mask tokens/keys that look long
                if (str.length > 12) return str.slice(0, 6) + '…' + str.slice(-4);
                return str;
            }
            function sanitizeValue(val) {
                if (val === null || val === undefined) return val;
                if (typeof val === 'string') return maskString(val);
                if (Array.isArray(val)) return val.map(sanitizeValue);
                if (typeof val === 'object') {
                    const out = {};
                    for (const k in val) {
                        if (!Object.prototype.hasOwnProperty.call(val, k)) continue;
                        const keyLower = ('' + k).toLowerCase();
                        if (keyLower.includes('password') || keyLower.includes('token') || keyLower.includes('apikey') || keyLower === 'authorization') {
                            out[k] = '***';
                        } else {
                            out[k] = sanitizeValue(val[k]);
                        }
                    }
                    return out;
                }
                return val;
            }
            try {
                return (args || []).map(sanitizeValue);
            } catch (e) {
                return args;
            }
        },
        _log: function(consoleMethod, levelName, message, args) {
            const prefix = '[Jellyseerr][' + levelName + '][' + this._ts() + ']';
            try {
                const sanitized = this._sanitize(args);
                // Use Function.prototype.apply to preserve proper console formatting
                consoleMethod.apply(console, [prefix, message].concat(sanitized));
            } catch (e) {
                // Fallback to basic logging
                consoleMethod(prefix + ' ' + message);
            }
        },
        debug: function(message, ...args) {
            if (currentLogLevel >= LOG_LEVELS.DEBUG) {
                this._log(console.debug || console.log, 'DEBUG', message, args);
            }
        },
        info: function(message, ...args) {
            if (currentLogLevel >= LOG_LEVELS.INFO) {
                this._log(console.log, 'INFO', message, args);
            }
        },
        success: function(message, ...args) {
            if (currentLogLevel >= LOG_LEVELS.SUCCESS) {
                // success as info level, different tag
                this._log(console.log, 'SUCCESS', message, args);
            }
        },
        warn: function(message, ...args) {
            if (currentLogLevel >= LOG_LEVELS.WARN) {
                this._log(console.warn || console.log, 'WARN', message, args);
            }
        },
        error: function(message, ...args) {
            if (currentLogLevel >= LOG_LEVELS.ERROR) {
                this._log(console.error || console.log, 'ERROR', message, args);
            }
        }
    };

    // Initialize log level from query param or localStorage for easier debugging
    try {
        var desiredLevel;
        if (typeof window !== 'undefined' && window.location && window.location.search) {
            var params = new URLSearchParams(window.location.search);
            if (params.has('jellyseerrDebug')) {
                desiredLevel = LOG_LEVELS.DEBUG;
            }
        }
        if (!desiredLevel && typeof localStorage !== 'undefined') {
            var storedLevel = localStorage.getItem('jellyseerrLogLevel');
            if (storedLevel && LOG_LEVELS[storedLevel.toUpperCase()] !== undefined) {
                desiredLevel = LOG_LEVELS[storedLevel.toUpperCase()];
            }
        }
        if (desiredLevel !== undefined) {
            currentLogLevel = desiredLevel;
            Logger.info('Log level set from settings:', desiredLevel);
        }
    } catch (e) {
        // ignore
    }

    // ==================== Platform Service Bridge ====================
    
    // Service proxy URL (local HTTP service running on Tizen)
    const SERVICE_PROXY_URL = 'http://127.0.0.1:8765';
    
    /**
     * Platform service communication for proxy requests
     * On Tizen, we use a local HTTP service that handles cookie management
     */
    const LunaServiceBridge = {
        /**
         * Check if platform service is available
         * Tries to connect to the local proxy service
         */
        checkAvailability: function() {
            return new Promise(function(resolve) {
                Logger.info('[Jellyseerr] Checking Tizen proxy service availability...');
                
                // Try to call the status endpoint of our local service
                var xhr = new XMLHttpRequest();
                xhr.open('POST', SERVICE_PROXY_URL + '/status', true);
                xhr.setRequestHeader('Content-Type', 'application/json');
                xhr.timeout = 3000;
                
                xhr.onload = function() {
                    if (xhr.status === 200) {
                        try {
                            var response = JSON.parse(xhr.responseText);
                            if (response.success && response.running) {
                                Logger.success('[Jellyseerr] Tizen proxy service is available');
                                proxyServiceAvailable = true;
                                useProxyService = true;
                                resolve(true);
                                return;
                            }
                        } catch (e) {
                            Logger.warn('[Jellyseerr] Invalid response from proxy service');
                        }
                    }
                    Logger.warn('[Jellyseerr] Proxy service not responding correctly');
                    proxyServiceAvailable = false;
                    resolve(false);
                };
                
                xhr.onerror = function() {
                    Logger.warn('[Jellyseerr] Proxy service not available - will use direct requests');
                    Logger.warn('[Jellyseerr] Cookie-based auth may not work without proxy service');
                    proxyServiceAvailable = false;
                    resolve(false);
                };
                
                xhr.ontimeout = function() {
                    Logger.warn('[Jellyseerr] Proxy service timeout - will use direct requests');
                    proxyServiceAvailable = false;
                    resolve(false);
                };
                
                try {
                    xhr.send(JSON.stringify({ userId: 'test' }));
                } catch (e) {
                    Logger.error('[Jellyseerr] Failed to check proxy service:', e.message);
                    proxyServiceAvailable = false;
                    resolve(false);
                }
            });
        },

        /**
         * Make HTTP request through local proxy service
         */
        request: function(url, options) {
            return new Promise(function(resolve, reject) {
                if (!proxyServiceAvailable) {
                    reject(new Error('Proxy service not available'));
                    return;
                }

                var method = options.method || 'GET';
                var headers = options.headers || {};
                var body = options.body;
                
                var params = {
                    userId: currentUserId,
                    url: url,
                    method: method,
                    headers: headers,
                    timeout: options.timeout || 30000
                };
                
                if (body) {
                    params.body = body;
                }
                
                Logger.debug('[Jellyseerr] Proxy request: ' + method + ' ' + url);
                
                var xhr = new XMLHttpRequest();
                xhr.open('POST', SERVICE_PROXY_URL + '/proxy', true);
                xhr.setRequestHeader('Content-Type', 'application/json');
                xhr.timeout = params.timeout + 5000; // Extra time for proxy overhead
                
                xhr.onload = function() {
                    try {
                        var response = JSON.parse(xhr.responseText);
                        if (response.success) {
                            resolve({
                                status: response.status,
                                headers: response.headers,
                                body: response.body
                            });
                        } else {
                            reject(new Error(response.error || 'Proxy request failed'));
                        }
                    } catch (e) {
                        reject(new Error('Invalid proxy response'));
                    }
                };
                
                xhr.onerror = function() {
                    reject(new Error('Proxy connection error'));
                };
                
                xhr.ontimeout = function() {
                    reject(new Error('Proxy request timeout'));
                };
                
                try {
                    xhr.send(JSON.stringify(params));
                } catch (e) {
                    reject(new Error('Failed to send proxy request: ' + e.message));
                }
            });
        },

        /**
         * Clear cookies for current user
         */
        clearCookies: function(domain) {
            return new Promise(function(resolve, reject) {
                if (!proxyServiceAvailable) {
                    resolve(); // Silent fail
                    return;
                }
                
                var xhr = new XMLHttpRequest();
                xhr.open('POST', SERVICE_PROXY_URL + '/clearCookies', true);
                xhr.setRequestHeader('Content-Type', 'application/json');
                xhr.timeout = 5000;
                
                xhr.onload = function() {
                    Logger.info('[Jellyseerr] Cookies cleared via proxy service');
                    resolve();
                };
                
                xhr.onerror = function() {
                    Logger.warn('[Jellyseerr] Failed to clear cookies via proxy');
                    resolve(); // Don't fail on this
                };
                
                xhr.ontimeout = function() {
                    resolve();
                };
                
                try {
                    xhr.send(JSON.stringify({
                        userId: currentUserId,
                        domain: domain
                    }));
                } catch (e) {
                    resolve();
                }
            });
        }
    };

    // ==================== State ====================
    
    let baseUrl = null;
    let apiKey = null;
    let currentUserId = null;
    let isInitialized = false;
    let sessionAuthenticated = false; // Track session-based auth (cookies)
    let autoReloginInProgress = false; // Prevent multiple simultaneous relogin attempts
    let autoReloginAttempted = false; // Track if auto-relogin was already attempted
    let useProxyService = false; // Use Node.js service for cookie handling
    let proxyServiceAvailable = false; // Track if proxy service is available
    let cookieOnlyAuth = false; // Track if using cookie-only auth (won't work without service)

    // ==================== Cookie Storage ====================
    
    /**
     * Cookie storage manager using localStorage
     * Cookies are stored per-user to support multiple Jellyfin users
     */
    const CookieStorage = {
        /**
         * Get the storage key for cookies
         * @private
         */
        _getStorageKey: function(userId) {
            return 'jellyseerr_cookies_' + (userId || 'default');
        },

        /**
         * Parse Set-Cookie header value
         * @private
         */
        _parseCookie: function(setCookieHeader) {
            if (!setCookieHeader) return null;

            const parts = setCookieHeader.split(';');
            const cookieValue = parts[0].trim();
            const nameValue = cookieValue.split('=');
            
            if (nameValue.length < 2) return null;

            const cookie = {
                name: nameValue[0].trim(),
                value: nameValue.slice(1).join('=').trim(),
                expires: null,
                maxAge: null,
                path: '/',
                domain: null,
                secure: false,
                httpOnly: false,
                sameSite: null
            };

            // Parse cookie attributes
            for (let i = 1; i < parts.length; i++) {
                const part = parts[i].trim();
                const attrParts = part.split('=');
                const attrName = attrParts[0].toLowerCase();
                const attrValue = attrParts[1];

                switch (attrName) {
                    case 'expires':
                        cookie.expires = attrValue;
                        break;
                    case 'max-age':
                        cookie.maxAge = parseInt(attrValue, 10);
                        break;
                    case 'path':
                        cookie.path = attrValue;
                        break;
                    case 'domain':
                        cookie.domain = attrValue;
                        break;
                    case 'secure':
                        cookie.secure = true;
                        break;
                    case 'httponly':
                        cookie.httpOnly = true;
                        break;
                    case 'samesite':
                        cookie.sameSite = attrValue;
                        break;
                }
            }

            return cookie;
        },

        /**
         * Save cookies from response headers
         */
        saveCookies: function(setCookieHeaders, userId) {
            if (!setCookieHeaders || setCookieHeaders.length === 0) {
                return;
            }

            const storageKey = this._getStorageKey(userId);
            let cookies = this.getCookies(userId) || {};

            // Handle both array and single string
            const cookieArray = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];

            cookieArray.forEach(function(setCookieHeader) {
                const cookie = CookieStorage._parseCookie(setCookieHeader);
                if (cookie) {
                    // Store cookie with timestamp for expiration checking
                    cookies[cookie.name] = {
                        value: cookie.value,
                        expires: cookie.expires,
                        maxAge: cookie.maxAge,
                        path: cookie.path,
                        domain: cookie.domain,
                        storedAt: Date.now()
                    };
                    Logger.debug('Saved cookie: ' + cookie.name);
                }
            });

            storage.set(storageKey, cookies, true);
            Logger.info('Saved ' + cookieArray.length + ' cookie(s) for user: ' + (userId || 'default'));
        },

        /**
         * Get all cookies for a user
         */
        getCookies: function(userId) {
            const storageKey = this._getStorageKey(userId);
            const cookies = storage.get(storageKey, true);
            
            if (!cookies) {
                return {};
            }

            // storage.get with isJSON=true already parses, just return
            if (typeof cookies === 'object') {
                return cookies;
            }
            
            // Fallback: try to parse if it's a string (shouldn't happen)
            try {
                return JSON.parse(cookies);
            } catch (e) {
                Logger.warn('Failed to parse cookies from storage:', e);
                return {};
            }
        },

        /**
         * Build Cookie header value from stored cookies
         */
        getCookieHeader: function(userId) {
            const cookies = this.getCookies(userId);
            const now = Date.now();
            const validCookies = [];

            for (const name in cookies) {
                if (cookies.hasOwnProperty(name)) {
                    const cookie = cookies[name];
                    
                    // Check if cookie has expired
                    let expired = false;
                    
                    if (cookie.maxAge) {
                        const age = (now - cookie.storedAt) / 1000; // age in seconds
                        if (age > cookie.maxAge) {
                            expired = true;
                        }
                    } else if (cookie.expires) {
                        const expiresDate = new Date(cookie.expires);
                        if (now > expiresDate.getTime()) {
                            expired = true;
                        }
                    }

                    if (!expired) {
                        validCookies.push(name + '=' + cookie.value);
                    }
                }
            }

            return validCookies.join('; ');
        },

        /**
         * Clear all cookies for a user
         */
        clearCookies: function(userId) {
            const storageKey = this._getStorageKey(userId);
            storage.remove(storageKey, true);
            Logger.info('Cleared cookies for user: ' + (userId || 'default'));
        },

        /**
         * Check if there are any valid cookies
         */
        hasCookies: function(userId) {
            const cookieHeader = this.getCookieHeader(userId);
            return cookieHeader.length > 0;
        }
    };

    // ==================== HTTP Client ====================

    /**
     * Make an unauthenticated HTTP request (for login/registration endpoints)
     * @private
     */
    function makeUnauthenticatedRequest(endpoint, options) {
        return new Promise(function(resolve, reject) {
            if (!isInitialized) {
                reject(new Error('Jellyseerr API not initialized. Call initialize() first.'));
                return;
            }

            // Use proxy service if available for cookie persistence across pages
            if (useProxyService && proxyServiceAvailable) {
                Logger.debug('Using proxy service for unauthenticated request');
                const method = options.method || 'GET';
                const url = baseUrl + '/api/' + API_VERSION + endpoint;
                
                const serviceOptions = {
                    method: method,
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                    timeout: options.timeout || REQUEST_TIMEOUT_MS
                };
                
                // Add custom headers
                if (options.headers) {
                    for (const header in options.headers) {
                        if (options.headers.hasOwnProperty(header)) {
                            serviceOptions.headers[header] = options.headers[header];
                        }
                    }
                }
                
                // Add body if present
                if (options.body) {
                    serviceOptions.body = typeof options.body === 'string' 
                        ? options.body 
                        : JSON.stringify(options.body);
                }
                
                return LunaServiceBridge.request(url, serviceOptions)
                    .then(function(response) {
                        if (response.status >= 200 && response.status < 300) {
                            try {
                                const data = response.body ? JSON.parse(response.body) : null;
                                resolve({
                                    data: data,
                                    xhr: { status: response.status }
                                });
                            } catch (e) {
                                reject(new Error('Invalid JSON response: ' + e.message));
                            }
                        } else {
                            const errorMessage = 'HTTP ' + response.status;
                            const error = new Error(errorMessage);
                            error.status = response.status;
                            reject(error);
                        }
                    })
                    .catch(function(error) {
                        reject(error);
                    });
            }

            const method = options.method || 'GET';
            const url = baseUrl + '/api/' + API_VERSION + endpoint;
            
            Logger.debug('Unauthenticated request: ' + method + ' ' + url);

            const xhr = new XMLHttpRequest();
            xhr.open(method, url);
            
            // Enable credentials to receive and send cookies
            xhr.withCredentials = true;

            // Set headers (no authentication)
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.setRequestHeader('Accept', 'application/json');

            // Add custom headers
            if (options.headers) {
                for (const header in options.headers) {
                    if (options.headers.hasOwnProperty(header)) {
                        xhr.setRequestHeader(header, options.headers[header]);
                    }
                }
            }

            // Set timeout
            xhr.timeout = options.timeout || REQUEST_TIMEOUT_MS;

            // Timeout handler
            xhr.ontimeout = function() {
                Logger.error('Request timeout: ' + url);
                reject(new Error('Request timeout after ' + xhr.timeout + 'ms'));
            };

            // Error handler
            xhr.onerror = function() {
                Logger.error('Network error: ' + url);
                reject(new Error('Network error'));
            };

            // Abort handler
            xhr.onabort = function() {
                Logger.warn('Request aborted: ' + url);
                reject(new Error('Request aborted'));
            };

            // Response handler
            xhr.onreadystatechange = function() {
                if (xhr.readyState !== XMLHttpRequest.DONE) {
                    return;
                }

                const status = xhr.status;
                Logger.debug('Response: ' + status + ' ' + url);

                if (status === 0) {
                    // Network error or CORS issue (commonly server unreachable/down)
                    Logger.error('No response (status 0). Server unreachable or CORS). URL:', url);
                    reject(new Error('Network error: server unreachable or CORS issue'));
                    return;
                }

                try {
                    const responseText = xhr.responseText;
                    let data = null;

                    if (responseText && responseText.length > 0) {
                        try {
                            data = JSON.parse(responseText);
                        } catch (parseError) {
                            Logger.warn('Failed to parse response as JSON:', responseText.substring(0, 100));
                            data = responseText;
                        }
                    }

                    if (status >= 200 && status < 300) {
                        // Note: Browsers automatically handle cookies for same-origin requests
                        // Attempting to read Set-Cookie via XHR is blocked for security
                        
                        resolve({
                            data: data,
                            xhr: xhr
                        });
                    } else {
                        const errorMessage = data && data.message ? data.message : 'HTTP ' + status;
                        const error = new Error(errorMessage);
                        error.status = status;
                        error.data = data;
                        Logger.error('Request failed: ' + method + ' ' + endpoint + ' - HTTP ' + status + ': ' + errorMessage);
                        if (data && typeof data === 'object') {
                            Logger.error('Error details:', JSON.stringify(data));
                        } else if (responseText) {
                            Logger.error('Response text:', responseText.substring(0, 500));
                        }
                        reject(error);
                    }
                } catch (error) {
                    Logger.error('Error processing response:', error);
                    reject(error);
                }
            };

            // Send request
            try {
                if (options.body) {
                    const bodyString = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
                    Logger.debug('Request body:', bodyString.substring(0, 200));
                    xhr.send(bodyString);
                } else {
                    xhr.send();
                }
            } catch (error) {
                Logger.error('Error sending request:', error);
                reject(error);
            }
        });
    }

    /**
     * Attempt automatic re-authentication when session expires (401)
     * @private
     * @returns {Promise<boolean>} True if re-authentication successful
     */
    function attemptAutoRelogin() {
        if (autoReloginInProgress) {
            Logger.debug('Auto-relogin already in progress, skipping duplicate attempt');
            return Promise.resolve(false);
        }
        
        autoReloginInProgress = true;
        
        return new Promise(function(resolve) {
            if (!currentUserId || typeof storage === 'undefined') {
                Logger.debug('Cannot auto-relogin: no user ID or storage unavailable');
                autoReloginInProgress = false;
                resolve(false);
                return;
            }
            
            // Get stored credentials
            var authMethod = storage.getJellyseerrUserSetting(currentUserId, 'authMethod', 'jellyfin');
            
            Logger.info('Attempting auto-relogin with method: ' + authMethod);
            
            if (authMethod === 'jellyfin') {
                // Try Jellyfin SSO auto-relogin
                var username = storage.getJellyseerrUserSetting(currentUserId, 'jellyfinUsername', null);
                var password = storage.getJellyseerrUserSetting(currentUserId, 'jellyfinPassword', null);
                var jellyfinUrl = storage.getJellyseerrUserSetting(currentUserId, 'jellyfinUrl', null);
                
                if (!username || !password || !jellyfinUrl) {
                    Logger.warn('Cannot auto-relogin: missing Jellyfin credentials');
                    autoReloginInProgress = false;
                    resolve(false);
                    return;
                }
                
                Logger.info('Re-authenticating with Jellyfin SSO...');
                
                var loginBody = {
                    username: username,
                    password: password
                };
                
                makeUnauthenticatedRequest('/auth/jellyfin', {
                    method: 'POST',
                    body: loginBody
                }).then(function(response) {
                    var user = response.data;
                    
                    // Save cookies from response
                    if (response.cookies && response.cookies.length > 0) {
                        response.cookies.forEach(function(cookieHeader) {
                            CookieStorage.saveCookies(cookieHeader, currentUserId);
                        });
                    }
                    
                    sessionAuthenticated = true;
                    autoReloginInProgress = false;
                    Logger.success('Auto-relogin successful!');
                    resolve(true);
                }).catch(function(error) {
                    Logger.error('Auto-relogin failed:', error);
                    sessionAuthenticated = false;
                    autoReloginInProgress = false;
                    resolve(false);
                });
                
            } else if (authMethod === 'local') {
                // Try local account auto-relogin
                var localEmail = storage.getJellyseerrUserSetting(currentUserId, 'localEmail', null);
                var localPassword = storage.getJellyseerrUserSetting(currentUserId, 'localPassword', null);
                
                if (!localEmail || !localPassword) {
                    Logger.warn('Cannot auto-relogin: missing local credentials');
                    autoReloginInProgress = false;
                    resolve(false);
                    return;
                }
                
                Logger.info('Re-authenticating with local account...');
                
                var loginBody = {
                    email: localEmail,
                    password: localPassword
                };
                
                makeUnauthenticatedRequest('/auth/local', {
                    method: 'POST',
                    body: loginBody
                }).then(function(response) {
                    var user = response.data;
                    
                    // Save API key if returned
                    if (user.apiKey) {
                        apiKey = user.apiKey;
                        storage.setJellyseerrUserSetting(currentUserId, 'apiKey', user.apiKey);
                        Logger.info('API key updated from auto-relogin');
                    }
                    
                    // Save cookies from response
                    if (response.cookies && response.cookies.length > 0) {
                        response.cookies.forEach(function(cookieHeader) {
                            CookieStorage.saveCookies(cookieHeader, currentUserId);
                        });
                    }
                    
                    sessionAuthenticated = true;
                    autoReloginInProgress = false;
                    Logger.success('Auto-relogin successful!');
                    resolve(true);
                }).catch(function(error) {
                    Logger.error('Auto-relogin failed:', error);
                    sessionAuthenticated = false;
                    autoReloginInProgress = false;
                    resolve(false);
                });
                
            } else {
                Logger.warn('Unknown auth method: ' + authMethod);
                autoReloginInProgress = false;
                resolve(false);
            }
        });
    }

    /**
     * Make request via Node.js proxy service (handles cookies properly)
     * @private
     */
    function makeRequestViaService(endpoint, options) {
        return new Promise(function(resolve, reject) {
            const method = options.method || 'GET';
            const url = baseUrl + '/api/' + API_VERSION + endpoint;
            
            const headers = {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            };
            
            // Add custom headers
            if (options.headers) {
                for (const header in options.headers) {
                    if (options.headers.hasOwnProperty(header)) {
                        headers[header] = options.headers[header];
                    }
                }
            }
            
            const serviceOptions = {
                method: method,
                headers: headers,
                timeout: options.timeout || REQUEST_TIMEOUT_MS
            };
            
            // Add body for POST/PUT/PATCH
            if (options.body) {
                serviceOptions.body = typeof options.body === 'string' 
                    ? options.body 
                    : JSON.stringify(options.body);
            }
            
            LunaServiceBridge.request(url, serviceOptions)
                .then(function(response) {
                    if (response.status >= 200 && response.status < 300) {
                        Logger.success('Service request succeeded: ' + method + ' ' + endpoint + ' (Status: ' + response.status + ')');
                        
                        // Handle empty response
                        if (response.status === 204 || !response.body) {
                            resolve({ success: true });
                            return;
                        }
                        
                        // Parse JSON response
                        try {
                            const data = JSON.parse(response.body);
                            resolve(data);
                        } catch (e) {
                            Logger.error('Failed to parse JSON response:', e);
                            reject(new Error('Invalid JSON response: ' + e.message));
                        }
                    } else if (response.status === 401) {
                        // Unauthorized - attempt auto-relogin
                        Logger.warn('Got 401 Unauthorized, attempting auto-relogin...');
                        
                        attemptAutoRelogin()
                            .then(function(success) {
                                if (success) {
                                    // Retry the original request
                                    Logger.info('Auto-relogin successful, retrying request');
                                    makeRequestViaService(endpoint, options)
                                        .then(resolve)
                                        .catch(reject);
                                } else {
                                    Logger.error('Auto-relogin failed');
                                    const error = new Error('Session expired. Please re-authenticate.');
                                    error.status = 401;
                                    reject(error);
                                }
                            })
                            .catch(function(error) {
                                Logger.error('Auto-relogin error:', error);
                                const authError = new Error('Session expired. Please re-authenticate.');
                                authError.status = 401;
                                reject(authError);
                            });
                    } else {
                        // Other error status
                        Logger.error('Request failed: ' + method + ' ' + endpoint + ' - HTTP ' + response.status);
                        
                        let errorMessage = 'HTTP ' + response.status;
                        try {
                            const errorData = JSON.parse(response.body);
                            errorMessage = errorData.message || errorMessage;
                        } catch (e) {
                            // Not JSON, use status code
                        }
                        
                        const error = new Error(errorMessage);
                        error.status = response.status;
                        reject(error);
                    }
                })
                .catch(function(error) {
                    Logger.error('Service request failed:', error.message);
                    reject(error);
                });
        });
    }

    /**
     * Make an HTTP request to Jellyseerr API
     * @private
     */
    function makeRequest(endpoint, options) {
        return new Promise(function(resolve, reject) {
            if (!isInitialized) {
                reject(new Error('Jellyseerr API not initialized. Call initialize() first.'));
                return;
            }

            // Check if proxy service should be used
            if (useProxyService && proxyServiceAvailable) {
                return makeRequestViaService(endpoint, options)
                    .then(resolve)
                    .catch(reject);
            }

            // Check authentication
            const hasApiKey = apiKey && apiKey.length > 0;
            const hasSession = sessionAuthenticated;
            
            Logger.debug('Auth check - hasApiKey:', hasApiKey, 'hasSession:', hasSession, 'cookieOnlyAuth:', cookieOnlyAuth, 'useProxyService:', useProxyService);
            
            // If using proxy service, we rely on cookies stored in the service
            if (!hasApiKey && !hasSession && !useProxyService) {
                Logger.error('Authentication failed - no API key or session. API key length:', apiKey ? apiKey.length : 0);
                reject(new Error('Not authenticated. Please login first.'));
                return;
            }

            const method = options.method || 'GET';
            const url = baseUrl + '/api/' + API_VERSION + endpoint;
            
            Logger.debug('Request: ' + method + ' ' + url + ' (auth: ' + (hasApiKey ? 'API Key' : 'Session') + ')');

            const xhr = new XMLHttpRequest();
            xhr.open(method, url);

            // Enable credentials for session-based auth
            xhr.withCredentials = true;

            // Set headers
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.setRequestHeader('Accept', 'application/json');
            
            // Add API key if available
            if (hasApiKey) {
                xhr.setRequestHeader('X-Api-Key', apiKey);
            }

            // Add custom headers
            if (options.headers) {
                for (const header in options.headers) {
                    if (options.headers.hasOwnProperty(header)) {
                        xhr.setRequestHeader(header, options.headers[header]);
                    }
                }
            }

            // Set timeout
            xhr.timeout = options.timeout || REQUEST_TIMEOUT_MS;

            // Timeout handler
            xhr.ontimeout = function() {
                Logger.error('Request timeout: ' + url);
                reject(new Error('Request timeout after ' + xhr.timeout + 'ms'));
            };

            // Error handler
            xhr.onerror = function() {
                Logger.error('Network error: ' + url);
                reject(new Error('Network error'));
            };

            // Abort handler
            xhr.onabort = function() {
                Logger.warn('Request aborted: ' + url);
                reject(new Error('Request aborted'));
            };

            // Response handler
            xhr.onreadystatechange = function() {
                if (xhr.readyState === XMLHttpRequest.DONE) {
                    // Handle response
                    if (xhr.status === 0) {
                        Logger.error('No response (status 0). Server unreachable or CORS). URL:', url);
                        reject(new Error('Network error: server unreachable or CORS issue'));
                        return;
                    }
                    if (xhr.status >= 200 && xhr.status < 300) {
                        Logger.success('Request succeeded: ' + method + ' ' + endpoint + ' (Status: ' + xhr.status + ')');
                        
                        // Handle empty response
                        if (xhr.status === 204 || xhr.responseText === '') {
                            resolve({ success: true });
                            return;
                        }

                        // Parse JSON response
                        try {
                            const data = JSON.parse(xhr.responseText);
                            resolve(data);
                        } catch (e) {
                            Logger.error('Failed to parse JSON response:', e);
                            reject(new Error('Invalid JSON response: ' + e.message));
                        }
                    } else if (xhr.status === 401) {
                        // Unauthorized - need to re-authenticate
                        
                        // Prevent infinite retry loops
                        if (autoReloginAttempted) {
                            Logger.error('Auto-relogin already attempted, authentication failed');
                            const error = new Error('Authentication failed. Please re-authenticate in settings.');
                            error.status = 401;
                            reject(error);
                            return;
                        }
                        
                        Logger.warn('Got 401 Unauthorized, attempting auto-relogin...');
                        autoReloginAttempted = true;
                        
                        attemptAutoRelogin()
                            .then(function(success) {
                                if (success) {
                                    // Retry the original request
                                    Logger.info('Auto-relogin successful, retrying request');
                                    makeRequest(endpoint, options)
                                        .then(function(result) {
                                            autoReloginAttempted = false;  // Reset on success
                                            resolve(result);
                                        })
                                        .catch(reject);
                                } else {
                                    Logger.error('Auto-relogin failed');
                                    const error = new Error('Session expired. Please re-authenticate.');
                                    error.status = 401;
                                    reject(error);
                                }
                            })
                            .catch(function(error) {
                                Logger.error('Auto-relogin error:', error);
                                const authError = new Error('Session expired. Please re-authenticate.');
                                authError.status = 401;
                                reject(authError);
                            });
                    } else {
                        // Handle error response
                        let errorMessage = 'HTTP ' + xhr.status;
                        let errorData = null;

                        try {
                            errorData = JSON.parse(xhr.responseText);
                            errorMessage += ': ' + (errorData.message || errorData.error || 'Unknown error');
                        } catch (e) {
                            if (xhr.responseText) {
                                errorMessage += ': ' + xhr.responseText;
                            }
                        }

                        Logger.error('Request failed: ' + method + ' ' + endpoint + ' - ' + errorMessage);
                        
                        const error = new Error(errorMessage);
                        error.status = xhr.status;
                        error.data = errorData;
                        reject(error);
                    }
                }
            };

            // Send request
            if (options.body) {
                const bodyJson = JSON.stringify(options.body);
                Logger.debug('Request body:', options.body);
                xhr.send(bodyJson);
            } else {
                xhr.send();
            }
        });
    }

    /**
     * Build URL with query parameters
     * @private
     */
    function buildUrlWithParams(endpoint, params) {
        if (!params || Object.keys(params).length === 0) {
            return endpoint;
        }

        const queryParts = [];
        for (const key in params) {
            if (params.hasOwnProperty(key) && params[key] !== null && params[key] !== undefined) {
                queryParts.push(encodeURIComponent(key) + '=' + encodeURIComponent(params[key]));
            }
        }

        return endpoint + (queryParts.length > 0 ? '?' + queryParts.join('&') : '');
    }

    // ==================== Public API ====================

    return {
        Logger: Logger,
        CookieStorage: CookieStorage,

        /**
         * Initialize the Jellyseerr API client
         * @param {string} serverUrl - Base URL of Jellyseerr server (e.g., https://jellyseerr.example.com)
         * @param {string} key - API key (optional, can use cookie auth)
         * @param {string} userId - Current Jellyfin user ID for cookie storage
         */
        initialize: function(serverUrl, key, userId) {
            if (!serverUrl) {
                throw new Error('Server URL is required');
            }

            // Remove trailing slash
            baseUrl = serverUrl.replace(/\/$/, '');
            apiKey = key || '';
            currentUserId = userId || null;
            isInitialized = true;

            Logger.info('Initialized Jellyseerr API client');
            Logger.info('Server URL: ' + baseUrl);
            Logger.info('User ID: ' + (userId || 'default'));
            Logger.info('Auth method: ' + (apiKey ? 'API Key' : 'Session Cookies'));
            
            // Check proxy service availability
            return LunaServiceBridge.checkAvailability().then(function(available) {
                Logger.info('Luna proxy service check completed');
                Logger.info('Service available: ' + available);
                Logger.info('useProxyService flag: ' + useProxyService);
                Logger.info('proxyServiceAvailable flag: ' + proxyServiceAvailable);
                
                if (available) {
                    Logger.success('Luna proxy service available - cookie authentication will work');
                    cookieOnlyAuth = false;
                } else {
                    Logger.warn('Luna proxy service not available');
                    if (!apiKey) {
                        Logger.warn('No API key configured - cookie-based auth may not work from file:// protocol');
                        Logger.warn('To use cookie auth, the app must be installed on TV with Luna service');
                        Logger.warn('Alternatively, configure an API token in settings');
                        cookieOnlyAuth = true;
                    }
                }
                
                // Handle user switching
                return JellyseerrAPI.handleUserSwitch(userId);
            });
        },

        /**
         * Handle Jellyfin user switching
         * Clears old cookies when user changes to ensure each user has their own session
         * @param {string} currentUserId - Current Jellyfin user ID
         */
        handleUserSwitch: function(currentUserId) {
            if (!currentUserId) return Promise.resolve();
            
            // Get the last user ID from global storage
            var lastUserId = storage.getJellyseerrSetting('lastJellyfinUserId', null);
            
            // If this is a different user, clear old cookies
            if (lastUserId && lastUserId !== currentUserId) {
                Logger.info('User switched from ' + lastUserId + ' to ' + currentUserId);
                Logger.info('Clearing old Jellyseerr cookies');
                
                // Clear cookies for old user (both local and service)
                CookieStorage.clearCookies(lastUserId);
                if (proxyServiceAvailable) {
                    LunaServiceBridge.clearCookies();
                }
                
                // Clear authentication state
                apiKey = null;
                sessionAuthenticated = false;
            }
            
            // Update the stored user ID
            storage.setJellyseerrSetting('lastJellyfinUserId', currentUserId);
            
            // Set current user ID for cookie storage
            this.setUserId(currentUserId);
            
            return Promise.resolve();
        },

        /**
         * Initialize Jellyseerr from stored preferences
         * Handles all the common checks and error handling
         * @returns {Promise<boolean>} Success status
         */
        initializeFromPreferences: function() {
            // Check if enabled
            var enabled = JellyseerrPreferences.get('enabled');
            if (!enabled) {
                Logger.info('Jellyseerr is disabled in preferences');
                return Promise.resolve(false);
            }
            
            // Check authentication
            var hasAuth = JellyseerrPreferences.hasAuth();
            if (!hasAuth) {
                Logger.warn('Jellyseerr enabled but not authenticated');
                try {
                    var method = JellyseerrPreferences.get('authMethod');
                    var key = JellyseerrPreferences.get('apiKey');
                    var keyInfo = key ? ('present(' + key.length + ')') : 'missing';
                    var cookies = (this.hasCookies && typeof this.hasCookies === 'function') ? this.hasCookies() : false;
                    Logger.info('Auth diagnostics - method:', method, 'apiKey:', keyInfo, 'hasCookies():', cookies, 'proxyServiceAvailable:', proxyServiceAvailable);
                } catch (e) {
                    // ignore
                }
                return Promise.resolve(false);
            }
            
            // Get server URL
            var serverUrl = JellyseerrPreferences.get('serverUrl');
            if (!serverUrl) {
                Logger.warn('Jellyseerr enabled but no server URL configured');
                return Promise.resolve(false);
            }
            
            // Get user ID for cookie storage
            var auth = JellyfinAPI.getStoredAuth();
            var userId = auth && auth.userId ? auth.userId : null;
            
            // Get stored API key from preferences (per-user storage)
            var storedApiKey = JellyseerrPreferences.get('apiKey', userId);
            Logger.debug('Retrieved API key from preferences:', storedApiKey ? ('present(' + storedApiKey.length + ')') : 'missing');
            
            // Initialize
            return this.initialize(serverUrl, storedApiKey, userId)
                .then(function() {
                    Logger.success('Jellyseerr initialized successfully from preferences');
                    
                    // Attempt auto-login if we have credentials
                    return JellyseerrAPI.attemptAutoLogin();
                })
                .then(function(success) {
                    return true;
                })
                .catch(function(error) {
                    Logger.error('Failed to initialize Jellyseerr:', error);
                    return false;
                });
        },

        /**
         * Check if API client is initialized
         */
        isInitialized: function() {
            return isInitialized;
        },

        /**
         * Get current base URL
         */
        getBaseUrl: function() {
            return baseUrl;
        },

        /**
         * Set API key for authentication
         */
        setApiKey: function(key) {
            apiKey = key || '';
            Logger.info('API key updated');
        },

        /**
         * Save authentication credentials for auto-login
         * @param {string} username - Jellyfin username
         * @param {string} password - Jellyfin password
         * @param {string} jellyfinUrl - Jellyfin server URL
         */
        saveCredentials: function(username, password, jellyfinUrl) {
            if (!currentUserId) {
                Logger.warn('Cannot save credentials: no user ID set');
                return;
            }
            
            // Store credentials per-user for auto-login
            if (typeof storage !== 'undefined') {
                storage.setJellyseerrUserSetting(currentUserId, 'jellyfinUsername', username);
                storage.setJellyseerrUserSetting(currentUserId, 'jellyfinPassword', password);
                storage.setJellyseerrUserSetting(currentUserId, 'jellyfinUrl', jellyfinUrl);
                Logger.info('Credentials saved for auto-login');
            }
        },

        /**
         * Attempt silent re-authentication using stored credentials
         * @returns {Promise<boolean>} True if authentication successful
         */
        attemptAutoLogin: function() {
            if (!currentUserId) {
                Logger.debug('No user ID set, skipping auto-login');
                return Promise.resolve(false);
            }
            
            if (!baseUrl) {
                Logger.debug('Jellyseerr not initialized, skipping auto-login');
                return Promise.resolve(false);
            }
            
            // Check if we already have an API key
            if (apiKey && apiKey.length > 0) {
                Logger.info('Already have API key, skipping auto-login');
                return Promise.resolve(true);
            }
            
            // Try to load stored credentials
            if (typeof storage === 'undefined') {
                Logger.debug('Storage not available, skipping auto-login');
                return Promise.resolve(false);
            }
            
            var username = storage.getJellyseerrUserSetting(currentUserId, 'jellyfinUsername', null);
            var password = storage.getJellyseerrUserSetting(currentUserId, 'jellyfinPassword', null);
            var jellyfinUrl = storage.getJellyseerrUserSetting(currentUserId, 'jellyfinUrl', null);
            
            var localEmail = storage.getJellyseerrUserSetting(currentUserId, 'localEmail', null);
            var localPassword = storage.getJellyseerrUserSetting(currentUserId, 'localPassword', null);
            
            // Try Jellyfin SSO first
            if (username && password && jellyfinUrl) {
                Logger.info('Attempting auto-login with Jellyfin credentials...');
                
                return this.loginWithJellyfin(username, password, jellyfinUrl)
                    .then(function(response) {
                        var user = response.user;
                        var storedApiKey = response.apiKey;
                        
                        if (storedApiKey) {
                            apiKey = storedApiKey;
                            if (typeof storage !== 'undefined') {
                                storage.setJellyseerrSetting('apiKey', storedApiKey);
                            }
                            Logger.success('Auto-login successful with API key');
                            sessionAuthenticated = true;
                            cookieOnlyAuth = false;
                            autoReloginAttempted = false;
                            return true;
                        } else {
                            Logger.info('Auto-login succeeded with session authentication');
                            sessionAuthenticated = true;
                            autoReloginAttempted = false;
                            return true;
                        }
                    })
                    .catch(function(error) {
                        Logger.warn('Jellyfin auto-login failed:', error.message);
                        sessionAuthenticated = false;
                        if (error.status === 401 || error.status === 403) {
                            Logger.info('Clearing invalid Jellyfin credentials');
                            if (typeof storage !== 'undefined') {
                                storage.removeJellyseerrUserSetting(currentUserId, 'jellyfinPassword');
                            }
                        }
                        return false;
                    });
            }
            
            // Try local account if Jellyfin credentials not found
            if (localEmail && localPassword) {
                Logger.info('Attempting auto-login with local credentials...');
                
                return this.loginLocal(localEmail, localPassword)
                    .then(function(response) {
                        var user = response.user || response.data || response;
                        var token = response.apiKey;
                        
                        if (token) {
                            apiKey = token;
                            Logger.success('Auto-login successful with API key');
                        } else {
                            Logger.info('Auto-login successful with session cookies');
                        }
                        sessionAuthenticated = true;
                        autoReloginAttempted = false;
                        return true;
                    })
                    .catch(function(error) {
                        Logger.warn('Local auto-login failed:', error.message);
                        sessionAuthenticated = false;
                        if (error.status === 401 || error.status === 403) {
                            Logger.info('Clearing invalid local credentials');
                            if (typeof storage !== 'undefined') {
                                storage.removeJellyseerrUserSetting(currentUserId, 'localPassword');
                            }
                        }
                        return false;
                    });
            }
            
            Logger.debug('No stored credentials found for auto-login');
            return Promise.resolve(false);
        },

        /**
         * Set current user ID for cookie storage
         */
        setUserId: function(userId) {
            currentUserId = userId;
            Logger.info('User ID updated: ' + userId);
        },

        /**
         * Clear authentication and reset state
         */
        reset: function() {
            baseUrl = null;
            apiKey = null;
            currentUserId = null;
            isInitialized = false;
            Logger.info('Jellyseerr API client reset');
        },

        /**
         * Test connection to Jellyseerr server
         * @returns {Promise<boolean>} True if connection successful
         */
        testConnection: function() {
            return makeRequest('/status', { method: 'GET' })
                .then(function(response) {
                    Logger.success('Connection test successful', response);
                    return true;
                })
                .catch(function(error) {
                    Logger.error('Connection test failed:', error);
                    return false;
                });
        },

        /**
         * Make a GET request
         * @param {string} endpoint - API endpoint (e.g., '/request')
         * @param {Object} params - Query parameters
         * @returns {Promise}
         */
        get: function(endpoint, params) {
            const url = buildUrlWithParams(endpoint, params);
            return makeRequest(url, { method: 'GET' });
        },

        /**
         * Make a POST request
         * @param {string} endpoint - API endpoint
         * @param {Object} body - Request body
         * @returns {Promise}
         */
        post: function(endpoint, body) {
            return makeRequest(endpoint, { 
                method: 'POST',
                body: body
            });
        },

        /**
         * Make a PUT request
         * @param {string} endpoint - API endpoint
         * @param {Object} body - Request body
         * @returns {Promise}
         */
        put: function(endpoint, body) {
            return makeRequest(endpoint, { 
                method: 'PUT',
                body: body
            });
        },

        /**
         * Make a DELETE request
         * @param {string} endpoint - API endpoint
         * @returns {Promise}
         */
        delete: function(endpoint) {
            return makeRequest(endpoint, { method: 'DELETE' });
        },

        /**
         * Check if session is valid by attempting to get current user
         * @returns {Promise<boolean>}
         */
        isSessionValid: function() {
            return makeRequest('/auth/me', { method: 'GET' })
                .then(function() {
                    return true;
                })
                .catch(function() {
                    return false;
                });
        },

        /**
         * Clear stored cookies
         */
        clearCookies: function() {
            CookieStorage.clearCookies(currentUserId);
        },

        /**
         * Check if cookies are available for authentication
         */
        hasCookies: function() {
            return CookieStorage.hasCookies(currentUserId);
        },

        // ==================== Authentication Endpoints ====================

        /**
         * Get current authenticated user
         * @returns {Promise<Object>} User object
         */
        getCurrentUser: function() {
            return makeRequest('/auth/me', { method: 'GET' });
        },

        /**
         * Login with Jellyfin credentials (SSO)
         * First attempts without hostname (for already-configured servers)
         * Falls back to including hostname (for initial setup)
         * 
         * @param {string} username - Jellyfin username
         * @param {string} password - Jellyfin password
         * @param {string} jellyfinUrl - Jellyfin server URL
         * @returns {Promise<Object>} User object with authentication details
         */
        loginWithJellyfin: function(username, password, jellyfinUrl) {
            // Clear any existing cookies to prevent stale sessions
            if (currentUserId) {
                CookieStorage.clearCookies(currentUserId);
            }
            if (proxyServiceAvailable) {
                LunaServiceBridge.clearCookies();
            }

            // First try without hostname (for already-configured Jellyfin server)
            var loginBody = {
                username: username,
                password: password
            };

            // Use service for login if available to capture cookies
            var loginPromise;
            if (proxyServiceAvailable) {
                Logger.info('LoginWithJellyfin using Luna proxy service');
                loginPromise = makeRequest('/auth/jellyfin', {
                    method: 'POST',
                    body: loginBody
                });
            } else {
                Logger.info('LoginWithJellyfin using direct XHR (no proxy service)');
                loginPromise = makeUnauthenticatedRequest('/auth/jellyfin', {
                    method: 'POST',
                    body: loginBody
                });
            }

            return loginPromise.then(function(response) {
                var user = response.data || response;
                
                // Success - return user
                sessionAuthenticated = true;
                Logger.success('Jellyfin SSO login succeeded');
                
                // Check for API key/token in response
                var token = null;
                if (response.token) token = response.token;
                else if (response.accessToken) token = response.accessToken;
                else if (response.access_token) token = response.access_token;
                else if (user && user.apiKey) token = user.apiKey;
                else if (user && user.api_key) token = user.api_key;
                else if (user && user.token) token = user.token;
                
                if (token) {
                    apiKey = token;
                    Logger.info('API key/token received (length):', token.length);
                } else {
                    Logger.info('No API key in response; relying on session cookies');
                    if (!proxyServiceAvailable) {
                        Logger.warn('No proxy service available; browser cannot read Set-Cookie headers. hasCookies() may be false even if session works.');
                    }
                }
                
                return {
                    user: user,
                    apiKey: token
                };
            }).catch(function(error) {
                // 401 - Server not configured yet, retry with hostname
                if (error && error.status === 401) {
                    loginBody.hostname = jellyfinUrl;
                    Logger.warn('401 on Jellyfin SSO without hostname; retrying with hostname:', jellyfinUrl);
                    
                    var retryPromise;
                    if (proxyServiceAvailable) {
                        retryPromise = makeRequest('/auth/jellyfin', {
                            method: 'POST',
                            body: loginBody
                        });
                    } else {
                        retryPromise = makeUnauthenticatedRequest('/auth/jellyfin', {
                            method: 'POST',
                            body: loginBody
                        });
                    }
                    
                    return retryPromise.then(function(response) {
                        var user = response.data || response;
                        sessionAuthenticated = true;
                        Logger.success('Jellyfin SSO login (with hostname) succeeded');
                        
                        var token = null;
                        if (response.token) token = response.token;
                        else if (response.accessToken) token = response.accessToken;
                        else if (response.access_token) token = response.access_token;
                        else if (user && user.apiKey) token = user.apiKey;
                        else if (user && user.api_key) token = user.api_key;
                        else if (user && user.token) token = user.token;
                        
                        if (token) {
                            apiKey = token;
                            Logger.info('API key/token received (length):', token.length);
                        } else {
                            Logger.info('No API key in response; relying on session cookies');
                            if (!proxyServiceAvailable) {
                                Logger.warn('No proxy service available; browser cannot read Set-Cookie headers. hasCookies() may be false even if session works.');
                            }
                        }
                        
                        return {
                            user: user,
                            apiKey: token
                        };
                    }).catch(function(retryError) {
                        // Handle errors from second attempt
                        var errorMsg = retryError.message || retryError.error || 'Unknown error';
                        throw new Error('Jellyfin login failed: ' + errorMsg);
                    });
                }
                
                // 500 - Likely wrong credentials on configured server
                if (error && error.status === 500) {
                    throw new Error('Authentication failed. Verify your username and password are correct, and that the Jellyfin server URL in Jellyseerr settings matches: ' + jellyfinUrl);
                }
                
                // Other errors
                var errorMsg = error.message || error.error || 'Unknown error';
                Logger.error('Jellyfin SSO login error:', errorMsg);
                throw new Error('Jellyfin login failed: ' + errorMsg);
            });
        },

        /**
         * Login with local Jellyseerr credentials
         * Returns user object with API key
         * 
         * @param {string} email - Jellyseerr email
         * @param {string} password - Jellyseerr password
         * @returns {Promise<Object>} User object with apiKey
         */
        loginLocal: function(email, password) {
            var loginBody = {
                email: email,
                password: password
            };

            return makeUnauthenticatedRequest('/auth/local', {
                method: 'POST',
                body: loginBody
            }).then(function(response) {
                var user = response.data || response;
                sessionAuthenticated = true;
                
                // Check for API key in response
                var token = null;
                if (response.token) token = response.token;
                else if (response.accessToken) token = response.accessToken;
                else if (response.access_token) token = response.access_token;
                else if (user && user.apiKey) token = user.apiKey;
                else if (user && user.api_key) token = user.api_key;
                else if (user && user.token) token = user.token;
                
                if (token) {
                    apiKey = token;
                } else {
                    // Save credentials for auto-login if no API key
                    if (currentUserId && typeof storage !== 'undefined') {
                        storage.setJellyseerrUserSetting(currentUserId, 'localEmail', email);
                        storage.setJellyseerrUserSetting(currentUserId, 'localPassword', password);
                    }
                }
                
                // Return normalized format (same as loginWithJellyfin)
                return {
                    user: user,
                    apiKey: token,
                    data: user  // Keep for backward compatibility
                };
            });
        },

        /**
         * Logout current user
         * Clears cookies and session data
         * 
         * @returns {Promise<void>}
         */
        logout: function() {
            Logger.info('Logging out...');
            
            return makeRequest('/auth/logout', {
                method: 'POST'
            }).then(function() {
                Logger.success('Logout successful');
                
                // Clear local state
                apiKey = null;
                sessionAuthenticated = false;
                CookieStorage.clearCookies(currentUserId);
                
                // Clear service cookies
                if (proxyServiceAvailable) {
                    return LunaServiceBridge.clearCookies().then(function() {
                        return true;
                    });
                }
                
                return true;
            }).catch(function(error) {
                Logger.warn('Logout request failed, clearing local state anyway:', error);
                
                // Clear local state even if server request fails
                apiKey = null;
                sessionAuthenticated = false;
                CookieStorage.clearCookies(currentUserId);
                
                // Clear service cookies
                if (proxyServiceAvailable) {
                    return LunaServiceBridge.clearCookies().then(function() {
                        return true;
                    });
                }
                
                return true;
            });
        },

        /**
         * Regenerate API key for current user
         * Requires active session
         * 
         * @param {string} sessionCookie - Session cookie from login (optional)
         * @returns {Promise<string>} New API key
         */
        regenerateApiKey: function(sessionCookie) {
            Logger.info('Regenerating API key...');
            
            var headers = {};
            if (sessionCookie) {
                headers['Cookie'] = sessionCookie;
                Logger.debug('Using provided session cookie');
            }
            
            return makeUnauthenticatedRequest('/settings/main/regenerate', {
                method: 'POST',
                headers: headers
            }).then(function(response) {
                var data = response.data;
                var newApiKey = data.apiKey;
                
                if (!newApiKey) {
                    throw new Error('No API key returned from server');
                }
                
                Logger.success('API key regenerated successfully');
                Logger.debug('New API key: ' + newApiKey.substring(0, 8) + '...');
                
                // Update local API key
                apiKey = newApiKey;
                
                return newApiKey;
            }).catch(function(error) {
                Logger.error('Failed to regenerate API key:', error);
                throw error;
            });
        },

        /**
         * Get Jellyseerr server status
         * @returns {Promise<Object>} Status object with version and initialization info
         */
        getStatus: function() {
            Logger.debug('Getting server status...');
            
            return makeRequest('/status', { method: 'GET' })
                .then(function(status) {
                    Logger.success('Server status retrieved', status);
                    return status;
                });
        },

        /**
         * Check authentication status and validate session
         * @returns {Promise<Object>} Object with isValid and user (if valid)
         */
        checkAuth: function() {
            Logger.debug('Checking authentication status...');
            
            return this.getCurrentUser()
                .then(function(user) {
                    Logger.success('Authentication valid');
                    return {
                        isValid: true,
                        user: user,
                        authMethod: apiKey && apiKey.length > 0 ? 'apikey' : 'cookie'
                    };
                })
                .catch(function(error) {
                    Logger.warn('Authentication invalid:', error);
                    return {
                        isValid: false,
                        user: null,
                        authMethod: null,
                        error: error.message
                    };
                });
        },

        /**
         * Validate and refresh session if needed
         * For cookie-based auth, this can trigger auto-renewal
         * 
         * @returns {Promise<boolean>} True if session is valid/renewed
         */
        validateSession: function() {
            Logger.debug('Validating session...');
            
            return this.isSessionValid()
                .then(function(isValid) {
                    if (isValid) {
                        Logger.success('Session is valid');
                        return true;
                    } else {
                        Logger.warn('Session is invalid');
                        return false;
                    }
                });
        },

        /**
         * Handle session expiration with automatic re-initialization and retry
         * Centralizes session expiration logic to avoid code duplication
         * 
         * @param {Function} retryCallback - Function to call after successful re-initialization
         * @param {string} contextName - Name of calling context for logging (e.g., 'BrowseBy', 'Discover')
         * @returns {Promise<*>} Result of retry callback
         */
        handleSessionExpiration: function(retryCallback, contextName) {
            var self = this;
            contextName = contextName || 'API';
            
            Logger.info('[' + contextName + '] Session expired, attempting re-initialization...');
            
            return this.initializeFromPreferences()
                .then(function(success) {
                    if (success) {
                        Logger.success('[' + contextName + '] Re-initialized from preferences, retrying operation');
                        return retryCallback();
                    }
                    
                    // If initializeFromPreferences failed, try auto-login
                    Logger.info('[' + contextName + '] Attempting auto-login...');
                    return self.attemptAutoLogin()
                        .then(function(loginSuccess) {
                            if (loginSuccess) {
                                Logger.success('[' + contextName + '] Auto-login successful, retrying operation');
                                return retryCallback();
                            }
                            throw new Error('Session re-initialization failed');
                        });
                });
        },

        /**
         * Auto-login with stored credentials
         * Attempts to restore session from cookies or re-authenticate
         * 
         * @param {Object} credentials - Stored credentials
         * @returns {Promise<Object>} User object if successful
         */
        autoLogin: function(credentials) {
            Logger.info('Attempting auto-login...');
            
            // First check if existing session is valid
            return this.validateSession()
                .then(function(isValid) {
                    if (isValid) {
                        Logger.success('Existing session is valid');
                        return this.getCurrentUser();
                    }
                    
                    // Session invalid, try to re-authenticate
                    Logger.info('Session expired, attempting re-authentication...');
                    
                    if (credentials.authMethod === 'jellyfin' && credentials.password) {
                        // Re-login with Jellyfin credentials
                        return this.loginWithJellyfin(
                            credentials.username,
                            credentials.password,
                            credentials.jellyfinUrl
                        ).then(function(user) {
                            // Try to regenerate API key for permanent auth
                            if (credentials.autoRegenerateApiKey) {
                                return this.regenerateApiKey()
                                    .then(function(newApiKey) {
                                        user.apiKey = newApiKey;
                                        return user;
                                    })
                                    .catch(function(error) {
                                        Logger.warn('Failed to auto-regenerate API key:', error);
                                        return user;
                                    }.bind(this));
                            }
                            return user;
                        }.bind(this));
                    } else if (credentials.authMethod === 'local' && credentials.localEmail && credentials.localPassword) {
                        // Re-login with local credentials
                        return this.loginLocal(credentials.localEmail, credentials.localPassword);
                    } else {
                        throw new Error('No valid credentials for auto-login');
                    }
                }.bind(this))
                .catch(function(error) {
                    Logger.error('Auto-login failed:', error);
                    throw error;
                });
        },

        // ==================== Request Management Endpoints ====================

        /**
         * Get all requests visible to the current user
         * 
         * @param {Object} options - Query options
         * @param {string} options.sort - Sort field (default: 'updated')
         * @param {string} options.filter - Filter by status: 'all', 'approved', 'available', 'pending', 'processing', 'unavailable', 'failed', 'deleted', 'completed'
         * @param {number} options.requestedBy - Filter by user ID
         * @param {string} options.requestType - Filter by type: 'movie' or 'tv'
         * @param {number} options.limit - Number of results per page (default: 50)
         * @param {number} options.offset - Offset for pagination (default: 0)
         * @returns {Promise<Object>} List response with pageInfo and results
         */
        getRequests: function(options) {
            options = options || {};
            
            Logger.info('Getting requests...');
            Logger.debug('Options:', options);

            var params = {
                skip: options.offset || 0,
                take: options.limit || 50,
                sort: options.sort || 'added'
            };

            if (options.filter) {
                params.filter = options.filter;
            }

            if (options.requestedBy) {
                params.requestedBy = options.requestedBy;
            }

            if (options.requestType) {
                params.type = options.requestType;
            }

            return this.get('/request', params)
                .then(function(response) {
                    Logger.success('Got ' + response.results.length + ' requests');
                    return response;
                });
        },

        /**
         * Get details of a specific request
         * 
         * @param {number} requestId - Request ID
         * @returns {Promise<Object>} Request object
         */
        getRequest: function(requestId) {
            Logger.info('Getting request: ' + requestId);
            
            return this.get('/request/' + requestId)
                .then(function(request) {
                    Logger.success('Got request details', request);
                    return request;
                });
        },

        /**
         * Create a new request for a movie or TV show
         * 
         * @param {Object} requestData - Request data
         * @param {number} requestData.mediaId - TMDB ID of the media
         * @param {string} requestData.mediaType - 'movie' or 'tv'
         * @param {*} requestData.seasons - For TV: 'all' or array of season numbers [1, 2, 3]
         * @param {boolean} requestData.is4k - Request in 4K quality (default: false)
         * @param {number} requestData.profileId - Quality profile ID (optional)
         * @param {number} requestData.rootFolderId - Root folder ID (optional)
         * @param {number} requestData.serverId - Server ID (optional)
         * @returns {Promise<Object>} Created request object
         */
        createRequest: function(requestData) {
            Logger.info('Creating request...');
            Logger.info('Media: ' + requestData.mediaType + ' #' + requestData.mediaId);
            Logger.debug('Request data:', requestData);

            var body = {
                mediaId: requestData.mediaId,
                mediaType: requestData.mediaType
            };

            // Handle seasons for TV shows
            if (requestData.mediaType === 'tv') {
                if (requestData.seasons === 'all' || !requestData.seasons) {
                    body.seasons = 'all';
                } else if (Array.isArray(requestData.seasons)) {
                    body.seasons = requestData.seasons;
                } else {
                    body.seasons = 'all';
                }
                Logger.debug('Seasons: ' + (typeof body.seasons === 'string' ? body.seasons : JSON.stringify(body.seasons)));
            }

            // Add optional parameters
            if (requestData.is4k) {
                body.is4k = true;
            }

            if (requestData.profileId) {
                body.profileId = requestData.profileId;
            }

            if (requestData.rootFolderId) {
                body.rootFolderId = requestData.rootFolderId;
            }

            if (requestData.serverId) {
                body.serverId = requestData.serverId;
            }

            return this.post('/request', body)
                .then(function(request) {
                    Logger.success('Request created successfully!', request);
                    Logger.info('Request ID: ' + request.id);
                    Logger.info('Status: ' + request.status);
                    return request;
                })
                .catch(function(error) {
                    Logger.error('Failed to create request:', error);
                    
                    // Provide user-friendly error messages
                    if (error.status === 409) {
                        throw new Error('This content has already been requested');
                    } else if (error.status === 403) {
                        throw new Error('You do not have permission to request content');
                    } else if (error.status === 400) {
                        throw new Error('Invalid request parameters: ' + error.message);
                    }
                    
                    throw error;
                });
        },

        /**
         * Delete an existing request
         * 
         * @param {number} requestId - Request ID to delete
         * @returns {Promise<void>}
         */
        deleteRequest: function(requestId) {
            Logger.info('Deleting request: ' + requestId);
            
            return this.delete('/request/' + requestId)
                .then(function() {
                    Logger.success('Request deleted successfully');
                    return true;
                })
                .catch(function(error) {
                    Logger.error('Failed to delete request:', error);
                    
                    if (error.status === 404) {
                        throw new Error('Request not found');
                    } else if (error.status === 403) {
                        throw new Error('You do not have permission to delete this request');
                    }
                    
                    throw error;
                });
        },

        /**
         * Get requests for the current user
         * Convenience method that automatically filters by current user
         * 
         * @param {Object} options - Query options (see getRequests)
         * @returns {Promise<Object>} List response with user's requests
         */
        getMyRequests: function(options) {
            Logger.info('Getting current user requests...');
            
            // First get current user to get their ID
            return this.getCurrentUser()
                .then(function(user) {
                    Logger.debug('Current user ID: ' + user.id);
                    
                    // Get requests filtered by user ID
                    options = options || {};
                    options.requestedBy = user.id;
                    
                    return this.getRequests(options);
                }.bind(this))
                .catch(function(error) {
                    Logger.error('Failed to get user requests:', error);
                    throw error;
                });
        },

        /**
         * Get pending requests (not yet approved)
         * 
         * @param {number} limit - Number of results (default: 50)
         * @param {number} offset - Offset for pagination (default: 0)
         * @returns {Promise<Object>} List response with pending requests
         */
        getPendingRequests: function(limit, offset) {
            return this.getRequests({
                filter: 'pending',
                limit: limit || 50,
                offset: offset || 0
            });
        },

        /**
         * Get approved requests
         * 
         * @param {number} limit - Number of results (default: 50)
         * @param {number} offset - Offset for pagination (default: 0)
         * @returns {Promise<Object>} List response with approved requests
         */
        getApprovedRequests: function(limit, offset) {
            return this.getRequests({
                filter: 'approved',
                limit: limit || 50,
                offset: offset || 0
            });
        },

        /**
         * Get available requests (content now available)
         * 
         * @param {number} limit - Number of results (default: 50)
         * @param {number} offset - Offset for pagination (default: 0)
         * @returns {Promise<Object>} List response with available requests
         */
        getAvailableRequests: function(limit, offset) {
            return this.getRequests({
                filter: 'available',
                limit: limit || 50,
                offset: offset || 0
            });
        },

        /**
         * Quick request helper - Request a movie
         * 
         * @param {number} tmdbId - TMDB movie ID
         * @param {boolean} is4k - Request in 4K (default: false)
         * @param {Object} options - Additional options (profileId, rootFolderId, serverId)
         * @returns {Promise<Object>} Created request
         */
        requestMovie: function(tmdbId, is4k, options) {
            options = options || {};
            
            return this.createRequest({
                mediaId: tmdbId,
                mediaType: 'movie',
                is4k: is4k || false,
                profileId: options.profileId,
                rootFolderId: options.rootFolderId,
                serverId: options.serverId
            });
        },

        /**
         * Quick request helper - Request a TV show
         * 
         * @param {number} tmdbId - TMDB TV show ID
         * @param {*} seasons - 'all' or array of season numbers
         * @param {boolean} is4k - Request in 4K (default: false)
         * @param {Object} options - Additional options (profileId, rootFolderId, serverId)
         * @returns {Promise<Object>} Created request
         */
        requestTvShow: function(tmdbId, seasons, is4k, options) {
            options = options || {};
            
            return this.createRequest({
                mediaId: tmdbId,
                mediaType: 'tv',
                seasons: seasons || 'all',
                is4k: is4k || false,
                profileId: options.profileId,
                rootFolderId: options.rootFolderId,
                serverId: options.serverId
            });
        },

        // ==================== Discovery Endpoints ====================

        /**
         * Get genre slider for movies
         * @returns {Promise<Array>} Array of genres with backdrop images
         */
        getGenreSliderMovies: function() {
            return makeRequest('/discover/genreslider/movie', { method: 'GET' })
                .then(function(response) {
                    Logger.info('Retrieved movie genre slider');
                    return response;
                });
        },

        /**
         * Get genre slider for TV shows
         * @returns {Promise<Array>} Array of genres with backdrop images
         */
        getGenreSliderTv: function() {
            return makeRequest('/discover/genreslider/tv', { method: 'GET' })
                .then(function(response) {
                    Logger.info('Retrieved TV genre slider');
                    return response;
                });
        },

        /**
         * Discover movies with filters
         * 
         * @param {Object} options - Query options
         * @param {number} options.page - Page number (default: 1)
         * @param {string} options.sortBy - Sort method (default: 'popularity.desc')
         * @param {string} options.genre - Genre ID to filter by
         * @param {string} options.studio - Studio ID to filter by
         * @param {string} options.language - Language code (default: 'en')
         * @returns {Promise<Object>} Paginated movie results
         */
        discoverMovies: function(options) {
            options = options || {};
            var page = options.page || 1;
            var sortBy = options.sortBy || 'popularity.desc';
            var language = options.language || 'en';
            
            var endpoint = '/discover/movies?page=' + page + '&sortBy=' + sortBy + '&language=' + language;
            
            if (options.genre) {
                endpoint += '&genre=' + options.genre;
            }
            if (options.studio) {
                endpoint += '&studio=' + options.studio;
            }
            if (options.keywords) {
                endpoint += '&keywords=' + options.keywords;
            }
            
            return makeRequest(endpoint, { method: 'GET' })
                .then(function(response) {
                    Logger.info('Discovered movies with filters:', options);
                    return {
                        page: response.page || page,
                        totalPages: response.totalPages || 1,
                        totalResults: response.totalResults || 0,
                        results: (response.results || []).map(function(item) {
                            return JellyseerrModels.createDiscoverItem(item);
                        })
                    };
                });
        },

        /**
         * Discover TV shows with filters
         * 
         * @param {Object} options - Query options
         * @param {number} options.page - Page number (default: 1)
         * @param {string} options.sortBy - Sort method (default: 'popularity.desc')
         * @param {string} options.genre - Genre ID to filter by
         * @param {string} options.network - Network ID to filter by
         * @param {string} options.language - Language code (default: 'en')
         * @returns {Promise<Object>} Paginated TV show results
         */
        discoverTv: function(options) {
            options = options || {};
            var page = options.page || 1;
            var sortBy = options.sortBy || 'popularity.desc';
            var language = options.language || 'en';
            
            var endpoint = '/discover/tv?page=' + page + '&sortBy=' + sortBy + '&language=' + language;
            
            if (options.genre) {
                endpoint += '&genre=' + options.genre;
            }
            if (options.network) {
                endpoint += '&network=' + options.network;
            }
            if (options.keywords) {
                endpoint += '&keywords=' + options.keywords;
            }
            
            return makeRequest(endpoint, { method: 'GET' })
                .then(function(response) {
                    Logger.info('Discovered TV shows with filters:', options);
                    return {
                        page: response.page || page,
                        totalPages: response.totalPages || 1,
                        totalResults: response.totalResults || 0,
                        results: (response.results || []).map(function(item) {
                            return JellyseerrModels.createDiscoverItem(item);
                        })
                    };
                });
        },

        /**
         * Get trending content (movies and TV shows)
         * 
         * @param {Object} options - Query options
         * @param {number} options.page - Page number (default: 1)
         * @param {string} options.language - Language code (default: 'en')
         * @returns {Promise<Object>} Paginated trending items
         */
        getTrending: function(options) {
            options = options || {};
            var page = options.page || 1;
            var language = options.language || 'en';
            
            var endpoint = '/discover/trending?page=' + page + '&language=' + language;
            
            return makeRequest(endpoint, { method: 'GET' })
                .then(function(response) {
                    Logger.info('Retrieved trending items, page:', page);
                    return {
                        page: response.page || page,
                        totalPages: response.totalPages || 1,
                        totalResults: response.totalResults || 0,
                        results: (response.results || []).map(function(item) {
                            return JellyseerrModels.createDiscoverItem(item);
                        })
                    };
                });
        },

        /**
         * Get trending movies
         * 
         * @param {Object} options - Query options
         * @param {number} options.page - Page number (default: 1)
         * @param {string} options.language - Language code (default: 'en')
         * @returns {Promise<Object>} Paginated trending movies
         */
        getTrendingMovies: function(options) {
            options = options || {};
            var page = options.page || 1;
            var language = options.language || 'en';
            
            var endpoint = '/discover/movies?page=' + page + '&language=' + language;
            
            return makeRequest(endpoint, { method: 'GET' })
                .then(function(response) {
                    Logger.info('Retrieved trending movies, page:', page);
                    return {
                        page: response.page || page,
                        totalPages: response.totalPages || 1,
                        totalResults: response.totalResults || 0,
                        results: (response.results || []).map(function(item) {
                            return JellyseerrModels.createDiscoverItem(item);
                        })
                    };
                });
        },

        /**
         * Get trending TV shows
         * 
         * @param {Object} options - Query options
         * @param {number} options.page - Page number (default: 1)
         * @param {string} options.language - Language code (default: 'en')
         * @returns {Promise<Object>} Paginated trending TV shows
         */
        getTrendingTv: function(options) {
            options = options || {};
            var page = options.page || 1;
            var language = options.language || 'en';
            
            var endpoint = '/discover/tv?page=' + page + '&language=' + language;
            
            return makeRequest(endpoint, { method: 'GET' })
                .then(function(response) {
                    Logger.info('Retrieved trending TV shows, page:', page);
                    return {
                        page: response.page || page,
                        totalPages: response.totalPages || 1,
                        totalResults: response.totalResults || 0,
                        results: (response.results || []).map(function(item) {
                            return JellyseerrModels.createDiscoverItem(item);
                        })
                    };
                });
        },

        /**
         * Get top-rated movies
         * 
         * @param {Object} options - Query options
         * @param {number} options.page - Page number (default: 1)
         * @param {string} options.language - Language code (default: 'en')
         * @returns {Promise<Object>} Paginated top movies
         */
        getTopMovies: function(options) {
            options = options || {};
            var page = options.page || 1;
            var language = options.language || 'en';
            
            var endpoint = '/discover/movies/top?page=' + page + '&language=' + language;
            
            return makeRequest(endpoint, { method: 'GET' })
                .then(function(response) {
                    Logger.info('Retrieved top movies, page:', page);
                    return {
                        page: response.page || page,
                        totalPages: response.totalPages || 1,
                        totalResults: response.totalResults || 0,
                        results: (response.results || []).map(function(item) {
                            return JellyseerrModels.createDiscoverItem(item);
                        })
                    };
                });
        },

        /**
         * Get top-rated TV shows
         * 
         * @param {Object} options - Query options
         * @param {number} options.page - Page number (default: 1)
         * @param {string} options.language - Language code (default: 'en')
         * @returns {Promise<Object>} Paginated top TV shows
         */
        getTopTv: function(options) {
            options = options || {};
            var page = options.page || 1;
            var language = options.language || 'en';
            
            var endpoint = '/discover/tv/top?page=' + page + '&language=' + language;
            
            return makeRequest(endpoint, { method: 'GET' })
                .then(function(response) {
                    Logger.info('Retrieved top TV shows, page:', page);
                    return {
                        page: response.page || page,
                        totalPages: response.totalPages || 1,
                        totalResults: response.totalResults || 0,
                        results: (response.results || []).map(function(item) {
                            return JellyseerrModels.createDiscoverItem(item);
                        })
                    };
                });
        },

        /**
         * Get upcoming movies
         * 
         * @param {Object} options - Query options
         * @param {number} options.page - Page number (default: 1)
         * @param {string} options.language - Language code (default: 'en')
         * @returns {Promise<Object>} Paginated upcoming movies
         */
        getUpcomingMovies: function(options) {
            options = options || {};
            var page = options.page || 1;
            var language = options.language || 'en';
            
            var endpoint = '/discover/movies/upcoming?page=' + page + '&language=' + language;
            
            return makeRequest(endpoint, { method: 'GET' })
                .then(function(response) {
                    Logger.info('Retrieved upcoming movies, page:', page);
                    return {
                        page: response.page || page,
                        totalPages: response.totalPages || 1,
                        totalResults: response.totalResults || 0,
                        results: (response.results || []).map(function(item) {
                            return JellyseerrModels.createDiscoverItem(item);
                        })
                    };
                });
        },

        /**
         * Get upcoming TV shows
         * 
         * @param {Object} options - Query options
         * @param {number} options.page - Page number (default: 1)
         * @param {string} options.language - Language code (default: 'en')
         * @returns {Promise<Object>} Paginated upcoming TV shows
         */
        getUpcomingTv: function(options) {
            options = options || {};
            var page = options.page || 1;
            var language = options.language || 'en';
            
            var endpoint = '/discover/tv/upcoming?page=' + page + '&language=' + language;
            
            return makeRequest(endpoint, { method: 'GET' })
                .then(function(response) {
                    Logger.info('Retrieved upcoming TV shows, page:', page);
                    return {
                        page: response.page || page,
                        totalPages: response.totalPages || 1,
                        totalResults: response.totalResults || 0,
                        results: (response.results || []).map(function(item) {
                            return JellyseerrModels.createDiscoverItem(item);
                        })
                    };
                });
        },

        /**
         * Search for movies and TV shows
         * 
         * @param {string} query - Search query
         * @param {Object} options - Query options
         * @param {number} options.page - Page number (default: 1)
         * @param {string} options.language - Language code (default: 'en')
         * @param {string} options.mediaType - Filter by 'movie' or 'tv' (optional, defaults to all)
         * @returns {Promise<Object>} Paginated search results
         */
        search: function(query, options) {
            options = options || {};
            
            if (!query || typeof query !== 'string' || query.trim().length === 0) {
                return Promise.reject(new Error('Search query is required'));
            }
            
            var page = options.page || 1;
            var language = options.language || 'en';
            var encodedQuery = encodeURIComponent(query.trim());
            
            console.log('[JellyseerrAPI] Search query:', query);
            console.log('[JellyseerrAPI] Encoded query:', encodedQuery);
            
            var endpoint = '/search?query=' + encodedQuery + '&page=' + page + '&language=' + language;
            
            // Add media type filter if specified
            if (options.mediaType === 'movie' || options.mediaType === 'tv') {
                endpoint += '&mediaType=' + options.mediaType;
            }
            
            var self = this;
            return makeRequest(endpoint, { method: 'GET' })
                .then(function(response) {
                    Logger.info('Search completed for:', query, 'page:', page);
                    return {
                        page: response.page || page,
                        totalPages: response.totalPages || 1,
                        totalResults: response.totalResults || 0,
                        results: (response.results || []).map(function(item) {
                            return JellyseerrModels.createDiscoverItem(item);
                        })
                    };
                })
                .catch(function(error) {
                    // Handle session expiration
                    if (error.message && error.message.includes('Session expired')) {
                        Logger.info('Search session expired, attempting recovery...');
                        return self.handleSessionExpiration(function() {
                            return self.search(query, options);
                        }, 'Search');
                    }
                    throw error;
                });
        },

        /**
         * Get similar movies
         * 
         * @param {number} movieId - TMDB movie ID
         * @param {Object} options - Query options
         * @param {number} options.page - Page number (default: 1)
         * @param {string} options.language - Language code (default: 'en')
         * @returns {Promise<Object>} Paginated similar movies
         */
        getSimilarMovies: function(movieId, options) {
            options = options || {};
            
            if (!movieId) {
                return Promise.reject(new Error('Movie ID is required'));
            }
            
            var page = options.page || 1;
            var language = options.language || 'en';
            
            var endpoint = '/movie/' + movieId + '/similar?page=' + page + '&language=' + language;
            
            return makeRequest(endpoint, { method: 'GET' })
                .then(function(response) {
                    Logger.info('Retrieved similar movies for ID:', movieId, 'page:', page);
                    return {
                        page: response.page || page,
                        totalPages: response.totalPages || 1,
                        totalResults: response.totalResults || 0,
                        results: (response.results || []).map(function(item) {
                            return JellyseerrModels.createDiscoverItem(item);
                        })
                    };
                });
        },

        /**
         * Get similar TV shows
         * 
         * @param {number} tvId - TMDB TV show ID
         * @param {Object} options - Query options
         * @param {number} options.page - Page number (default: 1)
         * @param {string} options.language - Language code (default: 'en')
         * @returns {Promise<Object>} Paginated similar TV shows
         */
        getSimilarTv: function(tvId, options) {
            options = options || {};
            
            if (!tvId) {
                return Promise.reject(new Error('TV show ID is required'));
            }
            
            var page = options.page || 1;
            var language = options.language || 'en';
            
            var endpoint = '/tv/' + tvId + '/similar?page=' + page + '&language=' + language;
            
            return makeRequest(endpoint, { method: 'GET' })
                .then(function(response) {
                    Logger.info('Retrieved similar TV shows for ID:', tvId, 'page:', page);
                    return {
                        page: response.page || page,
                        totalPages: response.totalPages || 1,
                        totalResults: response.totalResults || 0,
                        results: (response.results || []).map(function(item) {
                            return JellyseerrModels.createDiscoverItem(item);
                        })
                    };
                });
        },

        /**
         * Get movie recommendations
         * 
         * @param {number} movieId - TMDB movie ID
         * @param {Object} options - Query options
         * @param {number} options.page - Page number (default: 1)
         * @param {string} options.language - Language code (default: 'en')
         * @returns {Promise<Object>} Paginated movie recommendations
         */
        getRecommendationsMovies: function(movieId, options) {
            options = options || {};
            
            if (!movieId) {
                return Promise.reject(new Error('Movie ID is required'));
            }
            
            var page = options.page || 1;
            var language = options.language || 'en';
            
            var endpoint = '/movie/' + movieId + '/recommendations?page=' + page + '&language=' + language;
            
            return makeRequest(endpoint, { method: 'GET' })
                .then(function(response) {
                    Logger.info('Retrieved movie recommendations for ID:', movieId, 'page:', page);
                    return {
                        page: response.page || page,
                        totalPages: response.totalPages || 1,
                        totalResults: response.totalResults || 0,
                        results: (response.results || []).map(function(item) {
                            return JellyseerrModels.createDiscoverItem(item);
                        })
                    };
                });
        },

        /**
         * Get TV show recommendations
         * 
         * @param {number} tvId - TMDB TV show ID
         * @param {Object} options - Query options
         * @param {number} options.page - Page number (default: 1)
         * @param {string} options.language - Language code (default: 'en')
         * @returns {Promise<Object>} Paginated TV show recommendations
         */
        getRecommendationsTv: function(tvId, options) {
            options = options || {};
            
            if (!tvId) {
                return Promise.reject(new Error('TV show ID is required'));
            }
            
            var page = options.page || 1;
            var language = options.language || 'en';
            
            var endpoint = '/tv/' + tvId + '/recommendations?page=' + page + '&language=' + language;
            
            return makeRequest(endpoint, { method: 'GET' })
                .then(function(response) {
                    Logger.info('Retrieved TV show recommendations for ID:', tvId, 'page:', page);
                    return {
                        page: response.page || page,
                        totalPages: response.totalPages || 1,
                        totalResults: response.totalResults || 0,
                        results: (response.results || []).map(function(item) {
                            return JellyseerrModels.createDiscoverItem(item);
                        })
                    };
                });
        },

        // ==================== Details Endpoints ====================

        /**
         * Get detailed information about a movie
         * 
         * @param {number} movieId - TMDB movie ID
         * @param {Object} options - Query options
         * @param {string} options.language - Language code (default: 'en')
         * @returns {Promise<Object>} Movie details
         */
        getMovieDetails: function(movieId, options) {
            options = options || {};
            
            if (!movieId) {
                return Promise.reject(new Error('Movie ID is required'));
            }
            
            var language = options.language || 'en';
            var endpoint = '/movie/' + movieId + '?language=' + language;
            
            return makeRequest(endpoint, { method: 'GET' })
                .then(function(response) {
                    Logger.info('Retrieved movie details for ID:', movieId);
                    return JellyseerrModels.createMovieDetails(response);
                });
        },

        /**
         * Get detailed information about a TV show
         * 
         * @param {number} tvId - TMDB TV show ID
         * @param {Object} options - Query options
         * @param {string} options.language - Language code (default: 'en')
         * @returns {Promise<Object>} TV show details
         */
        getTvDetails: function(tvId, options) {
            options = options || {};
            
            if (!tvId) {
                return Promise.reject(new Error('TV show ID is required'));
            }
            
            var language = options.language || 'en';
            var endpoint = '/tv/' + tvId + '?language=' + language;
            
            return makeRequest(endpoint, { method: 'GET' })
                .then(function(response) {
                    Logger.info('Retrieved TV show details for ID:', tvId);
                    return JellyseerrModels.createTvDetails(response);
                });
        },

        /**
         * Get detailed information about a person (actor, director, etc.)
         * 
         * @param {number} personId - TMDB person ID
         * @param {Object} options - Query options
         * @param {string} options.language - Language code (default: 'en')
         * @returns {Promise<Object>} Person details
         */
        getPersonDetails: function(personId, options) {
            options = options || {};
            
            if (!personId) {
                return Promise.reject(new Error('Person ID is required'));
            }
            
            var language = options.language || 'en';
            var endpoint = '/person/' + personId + '?language=' + language;
            
            return makeRequest(endpoint, { method: 'GET' })
                .then(function(response) {
                    Logger.info('Retrieved person details for ID:', personId);
                    return JellyseerrModels.createPersonDetails(response);
                });
        },

        /**
         * Get combined movie and TV credits for a person
         * 
         * @param {number} personId - TMDB person ID
         * @param {Object} options - Query options
         * @param {string} options.language - Language code (default: 'en')
         * @returns {Promise<Object>} Person's combined credits (cast and crew)
         */
        getPersonCombinedCredits: function(personId, options) {
            options = options || {};
            
            if (!personId) {
                return Promise.reject(new Error('Person ID is required'));
            }
            
            var language = options.language || 'en';
            var endpoint = '/person/' + personId + '/combined_credits?language=' + language;
            
            return makeRequest(endpoint, { method: 'GET' })
                .then(function(response) {
                    Logger.info('Retrieved combined credits for person ID:', personId);
                    
                    var cast = (response.cast || []).map(function(item) {
                        return JellyseerrModels.createDiscoverItem(item);
                    });
                    
                    var crew = (response.crew || []).map(function(item) {
                        return JellyseerrModels.createDiscoverItem(item);
                    });
                    
                    return {
                        cast: cast,
                        crew: crew,
                        id: response.id || personId
                    };
                });
        },

        /**
         * Get keywords for a movie
         * 
         * @param {number} movieId - TMDB movie ID
         * @returns {Promise<Array>} Array of keywords
         */
        getMovieKeywords: function(movieId) {
            if (!movieId) {
                return Promise.reject(new Error('Movie ID is required'));
            }
            
            var endpoint = '/movie/' + movieId + '/keywords';
            
            return makeRequest(endpoint, { method: 'GET' })
                .then(function(response) {
                    Logger.info('Retrieved keywords for movie:', movieId);
                    return response.keywords || [];
                });
        },

        /**
         * Get keywords for a TV show
         * 
         * @param {number} tvId - TMDB TV show ID
         * @returns {Promise<Array>} Array of keywords
         */
        getTvKeywords: function(tvId) {
            if (!tvId) {
                return Promise.reject(new Error('TV show ID is required'));
            }
            
            var endpoint = '/tv/' + tvId + '/keywords';
            
            return makeRequest(endpoint, { method: 'GET' })
                .then(function(response) {
                    Logger.info('Retrieved keywords for TV show:', tvId);
                    return response.results || [];
                });
        },

        // ==================== Configuration Endpoints ====================

        /**
         * Get the keyword blacklist for filtering content
         * 
         * @returns {Promise<Array>} Array of blacklisted keywords
         */
        getBlacklist: function() {
            var endpoint = '/settings/discover';
            
            return makeRequest(endpoint, { method: 'GET' })
                .then(function(response) {
                    Logger.info('Retrieved discover settings with blacklist');
                    
                    // Extract keyword blacklist from discover settings
                    var blacklist = [];
                    if (response && response.keywordBlacklist) {
                        blacklist = response.keywordBlacklist.map(function(item) {
                            return {
                                id: item.id,
                                keyword: item.keyword || item.name,
                                createdAt: item.createdAt
                            };
                        });
                    }
                    
                    return blacklist;
                });
        },

        /**
         * Get Radarr server configuration settings
         * 
         * @returns {Promise<Array>} Array of Radarr server configurations
         */
        getRadarrSettings: function() {
            var endpoint = '/settings/radarr';
            
            return makeRequest(endpoint, { method: 'GET' })
                .then(function(response) {
                    Logger.info('Retrieved Radarr settings');
                    
                    // Response is an array of Radarr server configurations
                    if (!Array.isArray(response)) {
                        return [];
                    }
                    
                    return response.map(function(server) {
                        return {
                            id: server.id,
                            name: server.name,
                            hostname: server.hostname,
                            port: server.port,
                            apiKey: server.apiKey ? '***' : null, // Mask API key
                            useSsl: server.useSsl || false,
                            baseUrl: server.baseUrl || '',
                            activeProfileId: server.activeProfileId,
                            activeDirectory: server.activeDirectory,
                            is4k: server.is4k || false,
                            minimumAvailability: server.minimumAvailability || 'released',
                            isDefault: server.isDefault || false,
                            externalUrl: server.externalUrl || '',
                            syncEnabled: server.syncEnabled || false,
                            preventSearch: server.preventSearch || false
                        };
                    });
                });
        },

        /**
         * Get Sonarr server configuration settings
         * 
         * @returns {Promise<Array>} Array of Sonarr server configurations
         */
        getSonarrSettings: function() {
            var endpoint = '/settings/sonarr';
            
            return makeRequest(endpoint, { method: 'GET' })
                .then(function(response) {
                    Logger.info('Retrieved Sonarr settings');
                    
                    // Response is an array of Sonarr server configurations
                    if (!Array.isArray(response)) {
                        return [];
                    }
                    
                    return response.map(function(server) {
                        return {
                            id: server.id,
                            name: server.name,
                            hostname: server.hostname,
                            port: server.port,
                            apiKey: server.apiKey ? '***' : null, // Mask API key
                            useSsl: server.useSsl || false,
                            baseUrl: server.baseUrl || '',
                            activeProfileId: server.activeProfileId,
                            activeDirectory: server.activeDirectory,
                            activeAnimeProfileId: server.activeAnimeProfileId,
                            activeAnimeDirectory: server.activeAnimeDirectory,
                            activeLanguageProfileId: server.activeLanguageProfileId,
                            activeAnimeLanguageProfileId: server.activeAnimeLanguageProfileId,
                            is4k: server.is4k || false,
                            isDefault: server.isDefault || false,
                            externalUrl: server.externalUrl || '',
                            syncEnabled: server.syncEnabled || false,
                            preventSearch: server.preventSearch || false,
                            enableSeasonFolders: server.enableSeasonFolders || false
                        };
                    });
                });
        },

        // ==================== Notification Settings ====================

        /**
         * Get user notification settings
         * 
         * @returns {Promise<Object>} User notification preferences
         */
        getUserNotificationSettings: function() {
            var endpoint = '/user/settings/notifications';
            
            return makeRequest(endpoint, { method: 'GET' })
                .then(function(response) {
                    Logger.info('Retrieved user notification settings');
                    return response;
                });
        },

        /**
         * Update user notification settings
         * 
         * @param {Object} settings - Notification settings to update
         * @returns {Promise<Object>} Updated notification settings
         */
        updateUserNotificationSettings: function(settings) {
            var endpoint = '/user/settings/notifications';
            
            return makeRequest(endpoint, { method: 'POST', body: settings })
                .then(function(response) {
                    Logger.success('Updated user notification settings');
                    return response;
                });
        },

        /**
         * Check if Jellyseerr is authenticated and ready to use
         * @returns {boolean} True if authenticated with API key or session
         */
        isAuthenticated: function() {
            if (!isInitialized) return false;
            
            // Check API key auth
            if (apiKey && apiKey.length > 0) return true;
            
            // Check session auth (cookies sent via withCredentials)
            if (sessionAuthenticated) return true;
            
            return false;
        }
    };
})();

// Make available globally
if (typeof module !== 'undefined' && module.exports) {
    module.exports = JellyseerrAPI;
}
