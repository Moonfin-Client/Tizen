/*
 * Jellyfin API Client for Tizen
 * Handles server discovery, authentication, and API calls
 */
console.log("[JELLYFIN-API] Loading jellyfin-api.js");

/**
 * Jellyfin API Client for Tizen
 * Provides methods for server discovery, authentication, and media API calls
 * @module JellyfinAPI
 */
var JellyfinAPI = (function () {
   "use strict";
   console.log("[JELLYFIN-API] JellyfinAPI IIFE executing");

   /** @enum {number} Log level constants */
   const LOG_LEVELS = {
      ERROR: 0,
      WARN: 1,
      SUCCESS: 2,
      INFO: 3,
   };

   let currentLogLevel = LOG_LEVELS.ERROR;

   /** @type {Object} Internal logger for API operations */
   const Logger = {
      setLevel: function (level) {
         currentLogLevel = level;
      },
      info: function (message, data) {
         if (currentLogLevel >= LOG_LEVELS.INFO) {
         }
      },
      success: function (message, data) {
         if (currentLogLevel >= LOG_LEVELS.SUCCESS) {
         }
      },
      error: function (message, data) {
         if (currentLogLevel >= LOG_LEVELS.ERROR) {
         }
      },
      warn: function (message, data) {
         if (currentLogLevel >= LOG_LEVELS.WARN) {
         }
      },
   };

   let deviceId = null;
   const deviceName = "Samsung Smart TV";
   const appName = "Moonfin for Tizen";
   const appVersion =
      typeof APP_VERSION !== "undefined" ? APP_VERSION : "1.1.0";

   const SERVER_DISCOVERY_TIMEOUT_MS = 5000;
   const LAN_SCAN_TIMEOUT_MS = 2000;

   function initDeviceId() {
      deviceId = storage.get("_deviceId2", false);
      if (!deviceId) {
         deviceId = btoa(
            [navigator.userAgent, new Date().getTime()].join("|")
         ).replace(/=/g, "1");
         storage.set("_deviceId2", deviceId, false);
         Logger.info("Generated new device ID:", deviceId);
      }
      return deviceId;
   }

   function getAuthHeader(accessToken) {
      var header =
         'MediaBrowser Client="' +
         appName +
         '", Device="' +
         deviceName +
         '", DeviceId="' +
         deviceId +
         '", Version="' +
         appVersion +
         '"';
      if (accessToken) {
         header += ', Token="' + accessToken + '"';
      }
      return header;
   }

   function discoverServers(callback) {
      Logger.info("Starting server discovery...");

      var discoveryUrl = "https://jellyfin.org/api/v1/servers";

      ajax.request(discoveryUrl, {
         method: "GET",
         timeout: SERVER_DISCOVERY_TIMEOUT_MS,
         success: function (response) {
            Logger.success("Server discovery completed", response);
            if (callback) callback(null, response);
         },
         error: function (err) {
            Logger.warn(
               "Server discovery via jellyfin.org failed, trying local discovery",
               err
            );
            discoverLocalServers(callback);
         },
      });
   }

   function discoverLocalServers(callback) {
      Logger.info(
         "Attempting local network discovery - scanning LAN for port 8096..."
      );

      var localIP = getLocalIPPrefix();
      Logger.info("Detected local network:", localIP);

      var addressesToScan = [];

      addressesToScan.push("http://localhost:8096");
      addressesToScan.push("http://127.0.0.1:8096");
      addressesToScan.push("http://jellyfin:8096");

      if (localIP) {
         for (var i = 1; i <= 255; i++) {
            addressesToScan.push("http://" + localIP + i + ":8096");
         }
      } else {
         for (var i = 1; i <= 255; i++) {
            addressesToScan.push("http://192.168.1." + i + ":8096");
         }
         for (var i = 1; i <= 50; i++) {
            addressesToScan.push("http://192.168.0." + i + ":8096");
         }
         for (var i = 1; i <= 50; i++) {
            addressesToScan.push("http://10.0.0." + i + ":8096");
         }
      }

      Logger.info(
         "Scanning " +
            addressesToScan.length +
            " IP addresses for Jellyfin servers..."
      );

      var foundServers = [];
      var checkedCount = 0;
      var totalToCheck = addressesToScan.length;

      var batchSize = 20;
      var currentBatch = 0;

      function scanBatch() {
         var start = currentBatch * batchSize;
         var end = Math.min(start + batchSize, totalToCheck);

         for (var i = start; i < end; i++) {
            (function (address) {
               testServer(address, function (err, serverInfo) {
                  checkedCount++;

                  if (!err && serverInfo) {
                     foundServers.push(serverInfo);
                     Logger.success("Found server at:", address);
                  }

                  if (checkedCount % 50 === 0) {
                     Logger.info(
                        "Scan progress: " + checkedCount + "/" + totalToCheck
                     );
                  }

                  if (checkedCount === totalToCheck) {
                     if (foundServers.length > 0) {
                        Logger.success(
                           "Scan complete! Found " +
                              foundServers.length +
                              " server(s)",
                           foundServers
                        );
                        if (callback) callback(null, foundServers);
                     } else {
                        Logger.warn(
                           "Scan complete. No servers found on port 8096"
                        );
                        if (callback)
                           callback({ error: "No servers found" }, null);
                     }
                  }
               });
            })(addressesToScan[i]);
         }

         currentBatch++;
         if (end < totalToCheck) {
            setTimeout(scanBatch, 100);
         }
      }

      scanBatch();
   }

   function getLocalIPPrefix() {
      try {
         return null;
      } catch (e) {
         Logger.warn("Could not detect local IP, using default ranges");
         return null;
      }
   }

   function normalizeServerAddress(address) {
      if (!address || typeof address !== "string") {
         Logger.error(
            "Invalid address provided to normalizeServerAddress:",
            address
         );
         return null;
      }

      address = address.trim();

      if (address === "") {
         Logger.error("Empty address after trim");
         return null;
      }

      address = address.replace(/\/+$/, "");

      if (!/^https?:\/\//i.test(address)) {
         address = "http://" + address;
      }

      var hasPort = false;
      try {
         var match = address.match(/:(\d+)$/);
         if (match) {
            hasPort = true;
         }
      } catch (e) {
         Logger.warn("Error parsing address:", address);
      }

      if (!hasPort) {
         address = address + ":8096";
         Logger.info("No port specified, added default :8096 to address");
      }

      Logger.info("Normalized address:", address);
      return address;
   }

   /**
    * Get system information from Jellyfin server
    * @param {string} address - Server address
    * @param {string|Function} accessTokenOrCallback - Access token for authenticated endpoint, or callback for public endpoint
    * @param {Function} [callback] - Callback function (error, data) - optional if accessTokenOrCallback is a function
    */
   function getSystemInfo(address, accessTokenOrCallback, callback) {
      address = normalizeServerAddress(address);

      // Determine if we're using authenticated or public endpoint
      var isPublic = typeof accessTokenOrCallback === "function";
      var accessToken = isPublic ? null : accessTokenOrCallback;
      var finalCallback = isPublic ? accessTokenOrCallback : callback;

      var endpoint = isPublic ? "/System/Info/Public" : "/System/Info";
      var requestOptions = {
         method: "GET",
         timeout: 10000,
         success: function (response) {
            if (finalCallback) finalCallback(null, response);
         },
         error: function (err) {
            if (isAuthenticationError(err) && !isPublic) {
               handleAuthenticationError(err, address);
            }
            Logger.error("Failed to get system info:", err);
            if (finalCallback) finalCallback(err, null);
         },
      };

      // Add auth headers if using authenticated endpoint
      if (!isPublic && accessToken) {
         requestOptions.headers = {
            "X-Emby-Authorization": getAuthHeader(accessToken),
            "X-MediaBrowser-Token": accessToken,
         };
      }

      ajax.request(address + endpoint, requestOptions);
   }

   /**
    * Get public system information (no authentication required)
    * @param {string} address - Server address
    * @param {Function} callback - Callback function (error, data)
    * @deprecated Use getSystemInfo(address, callback) instead. This alias will be removed in a future version.
    */
   function getPublicSystemInfo(address, callback) {
      return getSystemInfo(address, callback);
   }

   function testServer(address, callback) {
      // Don't normalize - accept the address as-is with protocol and port
      if (!address) {
         Logger.error("Invalid server address");
         if (callback) callback({ error: "Invalid address" }, null);
         return;
      }

      console.log("[testServer] Testing address:", address);
      ajax.request(address + "/System/Info/Public", {
         method: "GET",
         timeout: LAN_SCAN_TIMEOUT_MS,
         headers: {
            "X-Emby-Authorization": getAuthHeader(),
         },
         success: function (response) {
            console.log(
               "[testServer] SUCCESS! Response:",
               JSON.stringify(response)
            );
            // Use ServerName if available, otherwise extract hostname from URL
            var serverName = response.serverName;
            if (!serverName || serverName.trim() === "") {
               try {
                  var url = new URL(address);
                  serverName = url.hostname;
               } catch (e) {
                  serverName = "Jellyfin Server";
               }
            }

            console.log("[testServer] Calling callback with server info");
            if (callback)
               callback(null, {
                  address: address,
                  name: serverName,
                  id: response.Id,
                  version: response.Version,
                  operatingSystem: response.OperatingSystem,
               });
            console.log("[testServer] Callback returned");
         },
         error: function (err) {
            console.log("[testServer] ERROR:", err);
            if (callback) callback(err, null);
         },
      });
   }

   function authenticateByName(serverAddress, username, password, callback) {
      if (
         !serverAddress ||
         typeof serverAddress !== "string" ||
         serverAddress.trim() === ""
      ) {
         Logger.error("Invalid server address provided to authenticateByName");
         if (callback) callback({ error: "Invalid server address" }, null);
         return;
      }

      if (!username || typeof username !== "string" || username.trim() === "") {
         Logger.error("Invalid username provided to authenticateByName");
         if (callback) callback({ error: "Username is required" }, null);
         return;
      }

      if (password === null || password === undefined) {
         Logger.error("Password is null or undefined");
         if (callback)
            callback(
               { error: "Password must be provided (can be empty string)" },
               null
            );
         return;
      }

      Logger.info("Attempting authentication for user:", username);

      var authUrl = serverAddress + "/Users/AuthenticateByName";

      ajax.request(authUrl, {
         method: "POST",
         headers: {
            "X-Emby-Authorization": getAuthHeader(),
            "Content-Type": "application/json",
         },
         data: {
            Username: username,
            Pw: password,
         },
         success: function (response) {
            Logger.success("Authentication successful!", {
               user: response.User.Name,
               userId: response.User.Id,
               serverId: response.ServerId,
               hasAccessToken: !!response.AccessToken,
            });

            var authData = {
               serverAddress: serverAddress,
               accessToken: response.AccessToken,
               userId: response.User.Id,
               username: response.User.Name,
               serverId: response.ServerId,
               serverName: response.ServerName || "Jellyfin Server",
            };

            Logger.info("=== STORING AUTHENTICATION ===");
            Logger.info("Auth data to store:", authData);

            // Check if MultiServerManager is available and add/update server
            var isAddingServer = storage.get("adding_server_flow");
            console.log("[AUTH] adding_server_flow:", isAddingServer);
            console.log(
               "[AUTH] MultiServerManager available:",
               typeof MultiServerManager !== "undefined"
            );

            if (typeof MultiServerManager !== "undefined") {
               var pendingServer = storage.get("pending_server");
               var serverName = pendingServer
                  ? pendingServer.name
                  : authData.serverName || "Jellyfin Server";

               console.log("[AUTH] Pending server:", pendingServer);
               console.log("[AUTH] Server name:", serverName);
               console.log("[AUTH] Server address:", serverAddress);

               // Check if this server/user combination already exists
               var existingServer = null;
               var existingUserId = null;
               var allServersArray = MultiServerManager.getAllServersArray();
               console.log(
                  "[AUTH] Current servers in MultiServerManager:",
                  allServersArray
               );

               for (var i = 0; i < allServersArray.length; i++) {
                  if (allServersArray[i].url === serverAddress) {
                     existingServer = allServersArray[i];
                     if (allServersArray[i].userId === authData.userId) {
                        existingUserId = authData.userId;
                     }
                     break;
                  }
               }

               if (existingServer && existingUserId) {
                  console.log(
                     "[AUTH] Updating existing server/user:",
                     existingServer
                  );
                  // Update existing user on server
                  MultiServerManager.updateServer(
                     existingServer.serverId,
                     null,
                     authData.userId,
                     {
                        username: authData.username,
                        accessToken: authData.accessToken,
                        connected: true,
                     }
                  );
                  // Only set as active if not in adding server flow
                  if (!isAddingServer) {
                     MultiServerManager.setActiveServer(
                        existingServer.serverId,
                        authData.userId
                     );
                  }
                  Logger.info(
                     "Updated existing user on server:",
                     existingServer.serverId
                  );
               } else {
                  console.log(
                     "[AUTH] Adding new user to server (or creating new server)"
                  );
                  // Add new user to server (or create new server)
                  var serverResult = MultiServerManager.addServer(
                     serverAddress,
                     serverName,
                     authData.userId,
                     authData.username,
                     authData.accessToken
                  );
                  console.log("[AUTH] Server/user added:", serverResult);

                  // Only set as active if not in adding server flow
                  if (!isAddingServer) {
                     console.log("[AUTH] Setting server/user as active");
                     MultiServerManager.setActiveServer(
                        serverResult.serverId,
                        serverResult.userId
                     );
                  } else {
                     console.log(
                        "[AUTH] NOT setting as active (in adding_server_flow mode)"
                     );
                  }
                  Logger.info("Added user to server:", serverResult.serverId);
               }

               // Clear pending server if it exists
               if (pendingServer) {
                  console.log("[AUTH] Clearing pending_server from storage");
                  storage.remove("pending_server");
               }

               console.log(
                  "[AUTH] Final servers in MultiServerManager:",
                  MultiServerManager.getAllServersArray()
               );
            }

            // Only store in legacy format if not in adding server flow (to preserve current auth)
            if (!isAddingServer) {
               storage.set("jellyfin_auth", authData);
            }

            var verification = storage.get("jellyfin_auth");
            if (
               verification &&
               verification.accessToken === authData.accessToken
            ) {
               Logger.success(
                  "Authentication data successfully stored and verified!"
               );
            } else {
               Logger.error(
                  "WARNING: Storage verification failed! Auth may not persist!"
               );
               Logger.error("Stored:", verification);
            }

            if (callback) callback(null, authData);
         },
         error: function (err) {
            Logger.error("Authentication failed!", err);
            if (callback) callback(err, null);
         },
      });
   }

   function getUserInfo(serverAddress, userId, accessToken, callback) {
      Logger.info("Fetching user info for userId:", userId);

      var userUrl = serverAddress + "/Users/" + userId;

      ajax.request(userUrl, {
         method: "GET",
         headers: {
            "X-Emby-Authorization": getAuthHeader(accessToken),
         },
         success: function (response) {
            Logger.success("User info retrieved:", response.Name);
            if (callback) callback(null, response);
         },
         error: function (err) {
            Logger.error("Failed to get user info:", err);
            if (callback) callback(err, null);
         },
      });
   }

   function logout() {
      Logger.info("Logging out and clearing stored credentials");
      storage.remove("jellyfin_auth");
      // Also clear auto-login data on logout
      storage.remove("last_login");
      Logger.success("Logout complete");
   }

   function getStoredAuth() {
      Logger.info("=== CHECKING STORED AUTHENTICATION ===");

      if (typeof localStorage !== "undefined") {
         Logger.info("localStorage is available");
         try {
            var rawData = localStorage.getItem("jellyfin_auth");
            Logger.info(
               "Raw jellyfin_auth data:",
               rawData ? rawData.substring(0, 100) + "..." : "null"
            );
         } catch (e) {
            Logger.error("Error accessing localStorage:", e);
         }
      }

      var auth = storage.get("jellyfin_auth");
      if (auth) {
         Logger.success("Found stored authentication for user:", auth.username);
         Logger.info("Server:", auth.serverAddress);
         Logger.info("Has access token:", !!auth.accessToken);
      } else {
         Logger.warn("No stored authentication found - user needs to log in");
      }
      return auth;
   }

   function getUserViews(serverAddress, userId, accessToken, callback) {
      Logger.info("Fetching user views for userId:", userId);

      var viewsUrl = serverAddress + "/Users/" + userId + "/Views";

      // Unsupported collection types
      var unsupportedCollectionTypes = ["books", "folders"];

      ajax.request(viewsUrl, {
         method: "GET",
         headers: {
            "X-Emby-Authorization": getAuthHeader(accessToken),
         },
         success: function (response) {
            if (!response || !response.Items) {
               Logger.error("Invalid user views response - missing Items");
               if (callback) callback(new Error("Invalid response"), null);
               return;
            }

            Logger.info(
               "Raw user views retrieved:",
               response.Items.length,
               "libraries"
            );

            // Filter out unsupported collection types and empty libraries
            var totalItems = response.Items.length;
            response.Items = response.Items.filter(function (view) {
               var collectionType = view.CollectionType
                  ? view.CollectionType.toLowerCase()
                  : "";

               // Check if collection type is supported
               var isSupported =
                  unsupportedCollectionTypes.indexOf(collectionType) === -1;
               if (!isSupported) {
                  Logger.info(
                     "Filtering out unsupported library:",
                     view.Name,
                     "(Type:",
                     view.CollectionType + ")"
                  );
                  return false;
               }

               // Check if library has content (skip empty libraries)
               var hasContent =
                  view.ChildCount === undefined || view.ChildCount > 0;
               if (!hasContent) {
                  Logger.info(
                     "Filtering out empty library:",
                     view.Name,
                     "(ChildCount: 0)"
                  );
                  return false;
               }

               Logger.info(
                  "Supporting library:",
                  view.Name,
                  "(Type:",
                  view.CollectionType || "unknown",
                  "Items:",
                  view.ChildCount || 0 + ")"
               );
               return true;
            });

            var filteredCount = totalItems - response.Items.length;
            if (filteredCount > 0) {
               Logger.info(
                  "Filtered out",
                  filteredCount,
                  "unsupported/empty libraries"
               );
            }

            Logger.success(
               "User views ready:",
               response.Items.length,
               "supported libraries"
            );

            if (callback) callback(null, response);
         },
         error: function (err) {
            if (isAuthenticationError(err)) {
               handleAuthenticationError(err, serverAddress);
            }
            Logger.error("Failed to get user views:", err);
            if (callback) callback(err, null);
         },
      });
   }

   function getItems(serverAddress, accessToken, endpoint, params, callback) {
      var queryString = "";
      if (params) {
         var parts = [];
         for (var key in params) {
            if (params.hasOwnProperty(key)) {
               parts.push(
                  encodeURIComponent(key) +
                     "=" +
                     encodeURIComponent(params[key])
               );
            }
         }
         queryString = "?" + parts.join("&");
      }

      var url = serverAddress + endpoint + queryString;

      ajax.request(url, {
         method: "GET",
         headers: {
            "X-Emby-Authorization": getAuthHeader(accessToken),
         },
         success: function (response) {
            if (callback) callback(null, response);
         },
         error: function (err) {
            Logger.error("Failed to get items from:", endpoint, err);
            if (callback) callback(err, null);
         },
      });
   }

   function setFavorite(
      serverAddress,
      userId,
      accessToken,
      itemId,
      isFavorite,
      callback
   ) {
      var endpoint = "/Users/" + userId + "/FavoriteItems/" + itemId;
      var method = isFavorite ? "POST" : "DELETE";

      ajax.request(serverAddress + endpoint, {
         method: method,
         headers: {
            "X-Emby-Authorization": getAuthHeader(accessToken),
         },
         success: function (response) {
            Logger.success("Favorite status updated:", isFavorite);
            if (callback) callback(null, response);
         },
         error: function (err) {
            Logger.error("Failed to update favorite status:", err);
            if (callback) callback(err, null);
         },
      });
   }

   function setPlayed(
      serverAddress,
      userId,
      accessToken,
      itemId,
      isPlayed,
      callback
   ) {
      var endpoint = "/Users/" + userId + "/PlayedItems/" + itemId;
      var method = isPlayed ? "POST" : "DELETE";

      ajax.request(serverAddress + endpoint, {
         method: method,
         headers: {
            "X-Emby-Authorization": getAuthHeader(accessToken),
         },
         success: function (response) {
            Logger.success("Played status updated:", isPlayed);
            if (callback) callback(null, response);
         },
         error: function (err) {
            Logger.error("Failed to update played status:", err);
            if (callback) callback(err, null);
         },
      });
   }

   /**
    * Get a single item with user data
    * @param {string} serverAddress - Jellyfin server URL
    * @param {string} userId - User ID
    * @param {string} accessToken - Access token
    * @param {string} itemId - Item ID to retrieve
    * @param {Function} callback - Callback(error, item)
    */
   function getItem(serverAddress, userId, accessToken, itemId, callback) {
      var endpoint = "/Users/" + userId + "/Items/" + itemId;

      ajax.request(serverAddress + endpoint, {
         method: "GET",
         headers: {
            "X-Emby-Authorization": getAuthHeader(accessToken),
         },
         success: function (response) {
            if (callback) callback(null, response);
         },
         error: function (err) {
            Logger.error("Failed to get item:", itemId, err);
            if (callback) callback(err, null);
         },
      });
   }

   /**
    * Check if error indicates invalid/expired credentials (401 Unauthorized)
    * @param {Object} err - Error object from ajax request
    * @returns {boolean} True if credentials are invalid
    */
   function isAuthenticationError(err) {
      return err && (err.error === 401 || err.status === 401);
   }

   /**
    * Handle 401 authentication errors - clear invalid credentials
    * @param {Object} err - Error object
    * @param {string} serverAddress - Server URL where auth failed
    */
   function handleAuthenticationError(err, serverAddress) {
      Logger.error(
         "[API] Authentication failed (401) for server:",
         serverAddress
      );
      Logger.warn(
         "[API] Access token may be invalid or expired - credentials will be cleared"
      );

      // Invalidate the stored auth for this server
      if (typeof MultiServerManager !== "undefined" && serverAddress) {
         var auth = getStoredAuth();
         if (auth && auth.serverAddress === serverAddress) {
            // Find and remove this user from MultiServerManager
            var servers = MultiServerManager.getAllServersArray();
            var matchingServer = servers.find(function (s) {
               return (
                  s.url === serverAddress && s.accessToken === auth.accessToken
               );
            });

            if (matchingServer) {
               Logger.warn(
                  "[API] Removing invalid credentials for:",
                  matchingServer.username
               );
               MultiServerManager.removeServer(
                  matchingServer.serverId,
                  matchingServer.userId
               );
            }
         }
      }
   }

   function getPublicUsers(serverAddress, callback) {
      var endpoint = serverAddress + "/Users/Public";

      ajax.request(endpoint, {
         method: "GET",
         headers: {
            "X-Emby-Authorization": getAuthHeader(),
         },
         success: function (response) {
            Logger.info("Retrieved public users:", response.length);
            if (callback) callback(null, response);
         },
         error: function (err) {
            if (isAuthenticationError(err)) {
               handleAuthenticationError(err, serverAddress);
            }
            Logger.error("Failed to get public users:", err);
            if (callback) callback(err, null);
         },
      });
   }

   function getUserImageUrl(serverAddress, userId, imageTag) {
      if (!imageTag) return null;
      return (
         serverAddress +
         "/Users/" +
         userId +
         "/Images/Primary?tag=" +
         imageTag +
         "&quality=90&maxWidth=400"
      );
   }

   function initiateQuickConnect(serverAddress, callback) {
      var endpoint = serverAddress + "/QuickConnect/Initiate";

      ajax.request(endpoint, {
         method: "POST",
         headers: {
            "X-Emby-Authorization": getAuthHeader(),
            "Content-Type": "application/json",
         },
         success: function (response) {
            Logger.info("Quick Connect initiated:", response.Code);
            if (callback) callback(null, response);
         },
         error: function (err) {
            Logger.error("Failed to initiate Quick Connect:", err);
            if (callback) callback(err, null);
         },
      });
   }

   function checkQuickConnectStatus(serverAddress, secret, callback) {
      var endpoint =
         serverAddress +
         "/QuickConnect/Connect?secret=" +
         encodeURIComponent(secret);

      ajax.request(endpoint, {
         method: "GET",
         headers: {
            "X-Emby-Authorization": getAuthHeader(),
         },
         success: function (response) {
            if (callback) callback(null, response);
         },
         error: function (err) {
            if (callback) callback(err, null);
         },
      });
   }

   function authenticateQuickConnect(serverAddress, secret, callback) {
      var endpoint = serverAddress + "/Users/AuthenticateWithQuickConnect";

      ajax.request(endpoint, {
         method: "POST",
         headers: {
            "X-Emby-Authorization": getAuthHeader(),
            "Content-Type": "application/json",
         },
         data: {
            Secret: secret,
         },
         success: function (response) {
            // Store credentials
            var authData = {
               serverAddress: serverAddress,
               accessToken: response.AccessToken,
               userId: response.User.Id,
               username: response.User.Name,
               serverId: response.ServerId,
               serverName: response.ServerName || "Jellyfin Server",
            };

            // Only store in legacy format if not in adding server flow (to preserve current auth)
            var isAddingServer = storage.get("adding_server_flow");
            if (!isAddingServer) {
               storage.set("jellyfin_auth", authData);
            }

            if (callback) callback(null, response);
         },
         error: function (err) {
            if (callback) callback(err, null);
         },
      });
   }

   /**
    * Get resume items (Continue Watching) for the user
    */
   function getResumeItems(serverAddress, userId, accessToken, callback) {
      Logger.info("Fetching resume items for userId:", userId);

      var params = {
         Limit: 50, // ITEM_LIMIT_RESUME
         Recursive: true,
         Fields:
            "PrimaryImageAspectRatio,BasicSyncInfo,MediaSourceCount,ProductionYear,ChildCount,RecursiveItemCount,Overview",
         ImageTypeLimit: 1,
         EnableImageTypes: "Primary,Backdrop,Thumb",
         MediaTypes: "Video",
         IncludeItemTypes: "Movie,Series,Episode",
         ExcludeItemTypes: "Recording",
         SortBy: "DatePlayed",
         SortOrder: "Descending",
      };

      var endpoint = "/Users/" + userId + "/Items/Resume";

      getItems(
         serverAddress,
         accessToken,
         endpoint,
         params,
         function (err, response) {
            if (err) {
               Logger.error("Failed to get resume items:", err);
               if (callback) callback(err, null);
               return;
            }

            Logger.success(
               "Resume items retrieved:",
               response.Items ? response.Items.length : 0
            );
            if (callback) callback(null, response);
         }
      );
   }

   /**
    * Get next up episodes for TV shows
    */
   function getNextUpItems(serverAddress, userId, accessToken, callback) {
      Logger.info("Fetching next up items for userId:", userId);

      var params = {
         Limit: 50, // ITEM_LIMIT_NEXT_UP
         Fields:
            "PrimaryImageAspectRatio,BasicSyncInfo,MediaSourceCount,ProductionYear,ChildCount,RecursiveItemCount,Overview",
         UserId: userId,
         ImageTypeLimit: 1,
         EnableImageTypes: "Primary,Backdrop,Thumb",
      };

      var endpoint = "/Shows/NextUp";

      getItems(
         serverAddress,
         accessToken,
         endpoint,
         params,
         function (err, response) {
            if (err) {
               Logger.error("Failed to get next up items:", err);
               if (callback) callback(err, null);
               return;
            }

            Logger.success(
               "Next up items retrieved:",
               response.Items ? response.Items.length : 0
            );
            if (callback) callback(null, response);
         }
      );
   }

   /**
    * Get merged Continue Watching (Resume + Next Up) items
    * Combines resume items and next up episodes, removes duplicates,
    * and sorts by last played date (most recent first)
    */
   function getMergedContinueWatching(
      serverAddress,
      userId,
      accessToken,
      callback
   ) {
      Logger.info(
         "Fetching merged continue watching items for userId:",
         userId
      );

      var resumeComplete = false;
      var nextUpComplete = false;
      var resumeItems = [];
      var nextUpItems = [];
      var errors = [];

      // Fetch resume items
      getResumeItems(serverAddress, userId, accessToken, function (err, data) {
         if (err) {
            errors.push(err);
         } else if (data && data.Items) {
            resumeItems = data.Items;
         }
         resumeComplete = true;
         checkComplete();
      });

      // Fetch next up items
      getNextUpItems(serverAddress, userId, accessToken, function (err, data) {
         if (err) {
            errors.push(err);
         } else if (data && data.Items) {
            nextUpItems = data.Items;
         }
         nextUpComplete = true;
         checkComplete();
      });

      function checkComplete() {
         if (!resumeComplete || !nextUpComplete) return;

         if (
            errors.length > 0 &&
            resumeItems.length === 0 &&
            nextUpItems.length === 0
         ) {
            Logger.error("Failed to get merged continue watching:", errors[0]);
            callback(errors[0], null);
            return;
         }

         // Combine items, prioritizing resume items (current episode)
         var itemMap = {};
         var mergedItems = [];

         // Add resume items first (they take precedence)
         resumeItems.forEach(function (item) {
            itemMap[item.Id] = true;
            mergedItems.push(item);
         });

         // Add next up items if not already in resume
         nextUpItems.forEach(function (item) {
            if (!itemMap[item.Id]) {
               itemMap[item.Id] = true;
               mergedItems.push(item);
            }
         });

         // Sort by last played date (most recent first)
         mergedItems.sort(function (a, b) {
            var dateA =
               a.UserData && a.UserData.LastPlayedDate
                  ? new Date(a.UserData.LastPlayedDate)
                  : new Date(0);
            var dateB =
               b.UserData && b.UserData.LastPlayedDate
                  ? new Date(b.UserData.LastPlayedDate)
                  : new Date(0);
            return dateB - dateA;
         });

         Logger.success(
            "Merged continue watching items retrieved:",
            mergedItems.length,
            "(",
            resumeItems.length,
            "resume +",
            nextUpItems.length - (mergedItems.length - resumeItems.length),
            "next up)"
         );
         callback(null, { Items: mergedItems });
      }
   }

   /**
    * Get latest media items for a library
    */
   function getLatestMedia(
      serverAddress,
      userId,
      accessToken,
      parentId,
      includeItemTypes,
      callback
   ) {
      Logger.info(
         "Fetching latest media for parentId:",
         parentId,
         "types:",
         includeItemTypes
      );

      var params = {
         Limit: 50,
         Fields:
            "PrimaryImageAspectRatio,BasicSyncInfo,ProductionYear,ChildCount,RecursiveItemCount,Overview",
         ParentId: parentId,
         ImageTypeLimit: 1,
         EnableImageTypes: "Primary,Backdrop,Thumb",
      };

      if (includeItemTypes) {
         params.IncludeItemTypes = includeItemTypes;
      }

      var endpoint = "/Users/" + userId + "/Items/Latest";

      getItems(
         serverAddress,
         accessToken,
         endpoint,
         params,
         function (err, response) {
            if (err) {
               Logger.error("Failed to get latest media:", err);
               if (callback) callback(err, null);
               return;
            }

            // Latest endpoint returns Items directly (not in TotalRecordCount wrapper)
            var items = response.Items || response;
            if (!Array.isArray(items)) {
               items = [items];
            }

            Logger.success("Latest media retrieved:", items.length, "items");

            // Wrap in standard response format if needed
            var result = response.Items
               ? response
               : { Items: items, TotalRecordCount: items.length };

            if (callback) callback(null, result);
         }
      );
   }

   /**
    * Check if Live TV is available and get channel count
    */
   function getLiveTVInfo(serverAddress, userId, accessToken, callback) {
      Logger.info("Checking Live TV availability for userId:", userId);

      // First check if user has Live TV library access
      getUserViews(serverAddress, userId, accessToken, function (err, views) {
         if (err) {
            Logger.error("Failed to check Live TV views:", err);
            if (callback) callback(err, null);
            return;
         }

         // Look for LiveTV collection type
         var liveTVView = views.Items.find(function (view) {
            return (
               view.CollectionType &&
               view.CollectionType.toLowerCase() === "livetv"
            );
         });

         if (!liveTVView) {
            Logger.info("No Live TV library found");
            if (callback) callback(null, { available: false, channelCount: 0 });
            return;
         }

         // Get channel count
         var params = {
            UserId: userId,
            Limit: 1,
            Fields: "ChannelInfo",
         };

         getItems(
            serverAddress,
            accessToken,
            "/LiveTv/Channels",
            params,
            function (err, response) {
               if (err) {
                  Logger.warn("Failed to get Live TV channels:", err);
                  if (callback)
                     callback(null, { available: false, channelCount: 0 });
                  return;
               }

               var channelCount = response.TotalRecordCount || 0;
               Logger.success("Live TV available:", channelCount, "channels");

               if (callback)
                  callback(null, {
                     available: channelCount > 0,
                     channelCount: channelCount,
                     viewId: liveTVView.Id,
                  });
            }
         );
      });
   }

   /**
    * Get Live TV channels
    */
   function getLiveTVChannels(serverAddress, userId, accessToken, callback) {
      Logger.info("Fetching Live TV channels for userId:", userId);

      var params = {
         UserId: userId,
         Limit: 50,
         Fields: "PrimaryImageAspectRatio,ChannelInfo",
         ImageTypeLimit: 1,
         EnableImageTypes: "Primary,Backdrop",
         SortBy: "SortName",
         SortOrder: "Ascending",
      };

      var endpoint = "/LiveTv/Channels";

      getItems(
         serverAddress,
         accessToken,
         endpoint,
         params,
         function (err, response) {
            if (err) {
               Logger.error("Failed to get Live TV channels:", err);
               if (callback) callback(err, null);
               return;
            }

            Logger.success(
               "Live TV channels retrieved:",
               response.Items ? response.Items.length : 0
            );
            if (callback) callback(null, response);
         }
      );
   }

   /**
    * Get Live TV recordings for the authenticated user
    * Convenience wrapper that uses stored authentication
    * @param {Function} callback - Callback(error, recordings)
    */
   function getLiveTVRecordings(callback) {
      const auth = getStoredAuth();
      if (!auth) {
         if (callback) callback("Not authenticated", null);
         return;
      }

      Logger.info("Fetching Live TV recordings for userId:", auth.userId);

      var params = {
         UserId: auth.userId,
         Limit: 50,
         Fields: "PrimaryImageAspectRatio,BasicSyncInfo,Overview",
         ImageTypeLimit: 1,
         EnableImageTypes: "Primary,Backdrop,Thumb",
         SortBy: "DateCreated",
         SortOrder: "Descending",
      };

      var endpoint = "/LiveTv/Recordings";

      getItems(
         auth.serverAddress,
         auth.accessToken,
         endpoint,
         params,
         function (err, response) {
            if (err) {
               Logger.error("Failed to get Live TV recordings:", err);
               if (callback) callback(err, null);
               return;
            }

            Logger.success(
               "Live TV recordings retrieved:",
               response.Items ? response.Items.length : 0
            );
            if (callback) callback(null, response);
         }
      );
   }

   /**
    * Get Live TV channels
    * @param {string} [userId] - User ID (uses stored auth if not provided)
    * @param {number} [startIndex=0] - Start index for pagination
    * @param {number} [limit=100] - Maximum number of channels to return
    * @param {boolean} [isFavorite=false] - If true, only return favorite channels
    * @param {Function} callback - Callback(error, channels)
    */
   function getChannels(userId, startIndex, limit, isFavorite, callback) {
      const auth = getStoredAuth();
      if (!auth) {
         if (callback) callback("Not authenticated", null);
         return;
      }

      Logger.info(
         "Fetching Live TV channels" + (isFavorite ? " (favorites only)" : "")
      );

      const params = {
         UserId: userId || auth.userId,
         StartIndex: startIndex || 0,
         Limit: limit || 100,
         Fields: "PrimaryImageAspectRatio,ChannelInfo",
         ImageTypeLimit: 1,
         EnableImageTypes: "Primary",
         SortBy: "SortName",
         SortOrder: "Ascending",
         EnableUserData: true,
      };

      if (isFavorite) {
         params.IsFavorite = true;
      }

      const endpoint = "/LiveTv/Channels";

      getItems(
         auth.serverAddress,
         auth.accessToken,
         endpoint,
         params,
         function (err, response) {
            if (err) {
               Logger.error("Failed to get Live TV channels:", err);
               if (callback) callback(err, null);
               return;
            }

            Logger.success(
               "Live TV channels retrieved:",
               response.Items ? response.Items.length : 0
            );
            if (callback) callback(null, response.Items || []);
         }
      );
   }

   /**
    * Get Live TV programs for channel(s) in a time range
    * @param {string|string[]} channelIds - Single channel ID or array of channel IDs
    * @param {Date} startDate - Start of time range
    * @param {Date} endDate - End of time range
    * @param {Function} callback - Callback(error, programs)
    */
   function getPrograms(channelIds, startDate, endDate, callback) {
      const auth = getStoredAuth();
      if (!auth) {
         if (callback) callback("Not authenticated", null);
         return;
      }

      // Convert single channelId to array, or accept array of channelIds
      const channelIdArray = Array.isArray(channelIds)
         ? channelIds
         : [channelIds];
      const channelIdsString = channelIdArray.join(",");

      Logger.info(
         "Fetching programs for",
         channelIdArray.length,
         "channel(s) from",
         startDate.toISOString(),
         "to",
         endDate.toISOString()
      );

      const params = {
         UserId: auth.userId,
         ChannelIds: channelIdsString,
         MinEndDate: startDate.toISOString(),
         MaxStartDate: endDate.toISOString(),
         Fields: "Overview,ChannelInfo",
         EnableUserData: true,
         EnableImageTypes: "Primary,Backdrop",
         ImageTypeLimit: 1,
         SortBy: "StartDate",
      };

      const endpoint = "/LiveTv/Programs";

      getItems(
         auth.serverAddress,
         auth.accessToken,
         endpoint,
         params,
         function (err, response) {
            if (err) {
               Logger.error("Failed to get programs:", err);
               console.error(
                  "Failed to get programs for channel",
                  channelId,
                  ":",
                  err
               );
               if (callback) callback(err, null);
               return;
            }

            const programCount = response.Items ? response.Items.length : 0;
            console.log(
               "API Response for",
               channelIdArray.length,
               "channel(s):",
               {
                  totalRecordCount: response.TotalRecordCount,
                  itemCount: programCount,
               }
            );
            Logger.success(
               "Programs retrieved:",
               programCount,
               "programs for",
               channelIdArray.length,
               "channel(s)"
            );
            if (programCount === 0) {
               Logger.warn(
                  "No programs found for",
                  channelIdArray.length,
                  "channel(s) in time range",
                  startDate.toISOString(),
                  "to",
                  endDate.toISOString()
               );
            }
            if (callback) callback(null, response.Items || []);
         }
      );
   }

   /**
    * Get a single Live TV program by ID
    * @param {string} programId - Program ID
    * @param {Function} callback - Callback(error, program)
    */
   function getProgram(programId, callback) {
      const auth = getStoredAuth();
      if (!auth) {
         if (callback) callback("Not authenticated", null);
         return;
      }

      Logger.info("Fetching program:", programId);

      const url =
         auth.serverAddress + "/Items/" + programId + "?UserId=" + auth.userId;

      ajax.request(url, {
         method: "GET",
         headers: {
            "X-Emby-Authorization": getAuthHeader(auth.accessToken),
         },
         success: function (response) {
            Logger.success("Program retrieved:", response.Name);
            if (callback) callback(null, response);
         },
         error: function (error) {
            Logger.error("Failed to get program:", error);
            if (callback) callback(error, null);
         },
      });
   }

   /**
    * Get collections (box sets)
    */
   function getCollections(serverAddress, userId, accessToken, callback) {
      Logger.info("Fetching collections for userId:", userId);

      var params = {
         UserId: userId,
         Limit: 50,
         IncludeItemTypes: "BoxSet",
         Recursive: true,
         Fields: "PrimaryImageAspectRatio,BasicSyncInfo,ChildCount,Overview",
         ImageTypeLimit: 1,
         EnableImageTypes: "Primary,Backdrop,Thumb",
         SortBy: "SortName",
         SortOrder: "Ascending",
      };

      var endpoint = "/Users/" + userId + "/Items";

      getItems(
         serverAddress,
         accessToken,
         endpoint,
         params,
         function (err, response) {
            if (err) {
               Logger.error("Failed to get collections:", err);
               if (callback) callback(err, null);
               return;
            }

            Logger.success(
               "Collections retrieved:",
               response.Items ? response.Items.length : 0
            );
            if (callback) callback(null, response);
         }
      );
   }

   /**
    * Get default timer settings with programId to get program-specific defaults
    */
   function getDefaultTimer(programId, callback) {
      const auth = getStoredAuth();
      if (!auth) {
         if (callback) callback("Not authenticated", null);
         return;
      }

      Logger.info("Getting default timer settings for programId:", programId);

      const url =
         auth.serverAddress +
         "/LiveTv/Timers/Defaults?programId=" +
         encodeURIComponent(programId);

      ajax.request(url, {
         method: "GET",
         headers: {
            "X-Emby-Authorization": getAuthHeader(auth.accessToken),
         },
         success: function (response) {
            Logger.success("Got default timer settings with program data");
            if (callback) callback(null, response);
         },
         error: function (error) {
            Logger.error("Failed to get default timer:", error);
            if (callback) callback(error, null);
         },
      });
   }

   /**
    * Create a Live TV recording timer
    * Automatically retrieves default timer settings and creates a one-time recording
    * @param {Object} program - Program object to record
    * @param {Function} callback - Callback(error, timer)
    */
   function createRecordingTimer(program, callback) {
      const auth = getStoredAuth();
      if (!auth) {
         if (callback) callback("Not authenticated", null);
         return;
      }

      Logger.info("Creating recording timer for program:", program.Name);

      // Get default timer to use as template
      getDefaultTimer(program.Id, function (err, defaultTimer) {
         if (err) {
            Logger.error("Failed to get default timer:", err);
            if (callback) callback(err, null);
            return;
         }

         const url = auth.serverAddress + "/LiveTv/Timers";

         // Build timer from defaultTimer but exclude series-specific fields
         // Based on API documentation example
         const timer = {
            ChannelId: defaultTimer.ChannelId,
            ProgramId: defaultTimer.ProgramId,
            StartDate: defaultTimer.StartDate,
            EndDate: defaultTimer.EndDate,
            PrePaddingSeconds: defaultTimer.PrePaddingSeconds,
            PostPaddingSeconds: defaultTimer.PostPaddingSeconds,
            IsPrePaddingRequired: defaultTimer.IsPrePaddingRequired,
            IsPostPaddingRequired: defaultTimer.IsPostPaddingRequired,
            KeepUntil: defaultTimer.KeepUntil,
            Priority: defaultTimer.Priority,
         };

         // Add optional fields from defaultTimer if present (excluding series-specific ones)
         if (defaultTimer.ChannelName)
            timer.ChannelName = defaultTimer.ChannelName;
         if (defaultTimer.ExternalChannelId)
            timer.ExternalChannelId = defaultTimer.ExternalChannelId;
         if (defaultTimer.ExternalProgramId)
            timer.ExternalProgramId = defaultTimer.ExternalProgramId;
         if (defaultTimer.Name) timer.Name = defaultTimer.Name;
         if (defaultTimer.Overview) timer.Overview = defaultTimer.Overview;
         if (defaultTimer.ServiceName)
            timer.ServiceName = defaultTimer.ServiceName;
         if (defaultTimer.ServerId) timer.ServerId = defaultTimer.ServerId;

         ajax.request(url, {
            method: "POST",
            headers: {
               "X-Emby-Authorization": getAuthHeader(auth.accessToken),
               "Content-Type": "application/json",
            },
            data: timer, // Pass object directly, ajax.js will stringify it
            success: function (response) {
               Logger.success("Recording timer created successfully");
               if (callback) callback(null, response);
            },
            error: function (error) {
               console.error("Timer creation failed. Timer object:", timer);
               console.error("Error response:", error);
               if (error.responseText) {
                  console.error("Error response body:", error.responseText);
               }
               if (error.responseData) {
                  console.error("Error response JSON:", error.responseData);
               }
               Logger.error("Failed to create recording timer:", error);
               if (callback) callback(error, null);
            },
         });
      });
   }

   /**
    * Cancel a scheduled Live TV recording timer
    * @param {string} timerId - Timer ID to cancel
    * @param {Function} callback - Callback(error, result)
    */
   function cancelRecordingTimer(timerId, callback) {
      const auth = getStoredAuth();
      if (!auth) {
         if (callback) callback("Not authenticated", null);
         return;
      }

      Logger.info("Canceling recording timer:", timerId);

      const url = auth.serverAddress + "/LiveTv/Timers/" + timerId;

      ajax.request(url, {
         method: "DELETE",
         headers: {
            "X-Emby-Authorization": getAuthHeader(auth.accessToken),
         },
         success: function (response) {
            Logger.success("Recording timer canceled successfully");
            if (callback) callback(null, response);
         },
         error: function (error) {
            Logger.error("Failed to cancel recording timer:", error);
            if (callback) callback(error, null);
         },
      });
   }

   /**
    * Get all scheduled Live TV recording timers
    * @param {Function} callback - Callback(error, timers)
    */
   function getRecordingTimers(callback) {
      const auth = getStoredAuth();
      if (!auth) {
         if (callback) callback("Not authenticated", null);
         return;
      }

      Logger.info("Fetching recording timers");

      const url = auth.serverAddress + "/LiveTv/Timers";

      ajax.request(url, {
         method: "GET",
         headers: {
            "X-Emby-Authorization": getAuthHeader(auth.accessToken),
         },
         success: function (response) {
            Logger.success(
               "Recording timers retrieved:",
               response.Items ? response.Items.length : 0
            );
            if (callback) callback(null, response.Items || []);
         },
         error: function (error) {
            Logger.error("Failed to get recording timers:", error);
            if (callback) callback(error, null);
         },
      });
   }

   /**
    * Get Live TV series timers (recurring recordings)
    */
   function getSeriesTimers(callback) {
      const auth = getStoredAuth();
      if (!auth) {
         if (callback) callback("Not authenticated", null);
         return;
      }

      Logger.info("Fetching series timers");

      const url = auth.serverAddress + "/LiveTv/SeriesTimers";

      ajax.request(url, {
         method: "GET",
         headers: {
            "X-Emby-Authorization": getAuthHeader(auth.accessToken),
         },
         success: function (response) {
            Logger.success(
               "Series timers retrieved:",
               response.Items ? response.Items.length : 0
            );
            if (callback) callback(null, response.Items || []);
         },
         error: function (error) {
            Logger.error("Failed to get series timers:", error);
            if (callback) callback(error, null);
         },
      });
   }

   /**
    * Delete a completed recording
    * @param {string} recordingId - Recording ID to delete
    * @param {Function} callback - Callback(error, result)
    */
   function deleteRecording(recordingId, callback) {
      const auth = getStoredAuth();
      if (!auth) {
         if (callback) callback("Not authenticated", null);
         return;
      }

      Logger.info("Deleting recording:", recordingId);

      const url = auth.serverAddress + "/LiveTv/Recordings/" + recordingId;

      ajax.request(url, {
         method: "DELETE",
         headers: {
            "X-Emby-Authorization": getAuthHeader(auth.accessToken),
         },
         success: function (response) {
            Logger.success("Recording deleted successfully");
            if (callback) callback(null, response);
         },
         error: function (error) {
            Logger.error("Failed to delete recording:", error);
            if (callback) callback(error, null);
         },
      });
   }

   /**
    * Mark an item as favorite (convenience wrapper)
    * @param {string} itemId - Item ID
    * @param {Function} callback - Callback(error, result)
    */
   function favoriteItem(itemId, callback) {
      const auth = getStoredAuth();
      if (!auth) {
         if (callback) callback("Not authenticated", null);
         return;
      }

      setFavorite(
         auth.serverAddress,
         auth.userId,
         auth.accessToken,
         itemId,
         true,
         callback
      );
   }

   /**
    * Remove an item from favorites (convenience wrapper)
    * @param {string} itemId - Item ID
    * @param {Function} callback - Callback(error, result)
    */
   function unfavoriteItem(itemId, callback) {
      const auth = getStoredAuth();
      if (!auth) {
         if (callback) callback("Not authenticated", null);
         return;
      }

      setFavorite(
         auth.serverAddress,
         auth.userId,
         auth.accessToken,
         itemId,
         false,
         callback
      );
   }

   /**
    * Get item by ID (convenience wrapper using stored auth)
    * @param {string} itemId - Item ID
    * @param {Function} callback - Callback(error, item)
    */
   function getItemById(itemId, callback) {
      const auth = getStoredAuth();
      if (!auth) {
         if (callback) callback("Not authenticated", null);
         return;
      }

      getItem(
         auth.serverAddress,
         auth.userId,
         auth.accessToken,
         itemId,
         callback
      );
   }

   return {
      init: initDeviceId,
      discoverServers: discoverServers,
      testServer: testServer,
      normalizeServerAddress: normalizeServerAddress,
      authenticateByName: authenticateByName,
      getPublicUsers: getPublicUsers,
      getUserImageUrl: getUserImageUrl,
      initiateQuickConnect: initiateQuickConnect,
      checkQuickConnectStatus: checkQuickConnectStatus,
      authenticateQuickConnect: authenticateQuickConnect,
      getUserInfo: getUserInfo,
      getUserViews: getUserViews,
      getItems: getItems,
      getResumeItems: getResumeItems,
      getNextUpItems: getNextUpItems,
      getMergedContinueWatching: getMergedContinueWatching,
      getLatestMedia: getLatestMedia,
      getLiveTVInfo: getLiveTVInfo,
      getLiveTVChannels: getLiveTVChannels,
      getLiveTVRecordings: getLiveTVRecordings,
      getChannels: getChannels,
      getPrograms: getPrograms,
      getProgram: getProgram,
      createRecordingTimer: createRecordingTimer,
      cancelRecordingTimer: cancelRecordingTimer,
      getDefaultTimer: getDefaultTimer,
      getRecordingTimers: getRecordingTimers,
      getSeriesTimers: getSeriesTimers,
      getPublicSystemInfo: getPublicSystemInfo,
      deleteRecording: deleteRecording,
      getCollections: getCollections,
      getSystemInfo: getSystemInfo,
      setFavorite: setFavorite,
      setPlayed: setPlayed,
      favoriteItem: favoriteItem,
      unfavoriteItem: unfavoriteItem,
      getItem: getItemById,
      logout: logout,
      getStoredAuth: getStoredAuth,
      getAuthHeader: getAuthHeader,
      isAuthenticationError: isAuthenticationError,
      handleAuthenticationError: handleAuthenticationError,
      Logger: Logger,
      LOG_LEVELS: LOG_LEVELS,
   };
})();
