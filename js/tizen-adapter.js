/**
 * Moonfin Tizen Platform Adapter
 * Provides platform-specific functionality for Samsung Tizen Smart TVs
 */

(function () {
   "use strict";

   console.log("[Tizen] Initializing Tizen adapter");

   // Generate a unique device ID
   function generateDeviceId() {
      return btoa(
         [navigator.userAgent, new Date().getTime()].join("|")
      ).replace(/=/g, "1");
   }

   // Get or create device ID
   function getDeviceId() {
      var deviceId = localStorage.getItem("_deviceId2");
      if (!deviceId) {
         deviceId = generateDeviceId();
         localStorage.setItem("_deviceId2", deviceId);
      }
      return deviceId;
   }

   var AppInfo = {
      deviceId: getDeviceId(),
      deviceName: "Samsung Smart TV",
      appName: "Moonfin for Tizen",
      appVersion: typeof APP_VERSION !== "undefined" ? APP_VERSION : "1.1.0",
   };

   // Try to get version from Tizen API
   try {
      if (typeof tizen !== "undefined" && tizen.application) {
         AppInfo.appVersion =
            tizen.application.getCurrentApplication().appInfo.version;
      }
   } catch (e) {
      console.log("[Tizen] Could not get app version from Tizen API:", e);
   }

   // System info cache
   var systeminfo = null;

   /**
    * Get system display information
    * @returns {Promise<Object>} Display information
    */
   function getSystemInfo() {
      if (systeminfo) {
         return Promise.resolve(systeminfo);
      }

      return new Promise(function (resolve) {
         try {
            if (typeof tizen !== "undefined" && tizen.systeminfo) {
               tizen.systeminfo.getPropertyValue(
                  "DISPLAY",
                  function (result) {
                     var devicePixelRatio = 1;

                     // Check for 8K/4K panel support
                     try {
                        if (
                           typeof webapis !== "undefined" &&
                           webapis.productinfo
                        ) {
                           if (
                              typeof webapis.productinfo.is8KPanelSupported ===
                                 "function" &&
                              webapis.productinfo.is8KPanelSupported()
                           ) {
                              console.log("[Tizen] 8K UHD is supported");
                              devicePixelRatio = 4;
                           } else if (
                              typeof webapis.productinfo.isUdPanelSupported ===
                                 "function" &&
                              webapis.productinfo.isUdPanelSupported()
                           ) {
                              console.log("[Tizen] 4K UHD is supported");
                              devicePixelRatio = 2;
                           } else {
                              console.log("[Tizen] UHD is not supported");
                           }
                        }
                     } catch (e) {
                        console.log("[Tizen] Could not check UHD support:", e);
                     }

                     systeminfo = Object.assign({}, result, {
                        resolutionWidth: Math.floor(
                           result.resolutionWidth * devicePixelRatio
                        ),
                        resolutionHeight: Math.floor(
                           result.resolutionHeight * devicePixelRatio
                        ),
                     });

                     resolve(systeminfo);
                  },
                  function (error) {
                     console.log("[Tizen] Could not get display info:", error);
                     systeminfo = {
                        resolutionWidth: window.screen.width,
                        resolutionHeight: window.screen.height,
                     };
                     resolve(systeminfo);
                  }
               );
            } else {
               systeminfo = {
                  resolutionWidth: window.screen.width,
                  resolutionHeight: window.screen.height,
               };
               resolve(systeminfo);
            }
         } catch (e) {
            console.log("[Tizen] Error getting system info:", e);
            systeminfo = {
               resolutionWidth: window.screen.width,
               resolutionHeight: window.screen.height,
            };
            resolve(systeminfo);
         }
      });
   }

   /**
    * Register remote control keys for the application
    */
   function registerKeys() {
      try {
         if (typeof tizen !== "undefined" && tizen.tvinputdevice) {
            var keysToRegister = [
               "MediaPlay",
               "MediaPause",
               "MediaPlayPause",
               "MediaStop",
               "MediaTrackPrevious",
               "MediaTrackNext",
               "MediaRewind",
               "MediaFastForward",
               "ColorF0Red",
               "ColorF1Green",
               "ColorF2Yellow",
               "ColorF3Blue",
               "Info",
               "Caption",
               "ChannelUp",
               "ChannelDown",
            ];

            keysToRegister.forEach(function (key) {
               try {
                  tizen.tvinputdevice.registerKey(key);
                  console.log("[Tizen] Registered key:", key);
               } catch (e) {
                  // Key might not be available on all devices
                  console.log(
                     "[Tizen] Could not register key:",
                     key,
                     e.message
                  );
               }
            });
         }
      } catch (e) {
         console.log("[Tizen] Error registering keys:", e);
      }
   }

   /**
    * Unregister a specific remote control key
    * @param {string} keyName - The key name to unregister
    */
   function unregisterKey(keyName) {
      try {
         if (typeof tizen !== "undefined" && tizen.tvinputdevice) {
            tizen.tvinputdevice.unregisterKey(keyName);
         }
      } catch (e) {
         console.log("[Tizen] Could not unregister key:", keyName, e);
      }
   }

   /**
    * Handle platform back navigation
    * Exits the app if at the root level
    */
   function platformBack() {
      try {
         if (typeof tizen !== "undefined" && tizen.application) {
            tizen.application.getCurrentApplication().exit();
         }
      } catch (e) {
         console.log("[Tizen] Error exiting app:", e);
      }
   }

   /**
    * Exit the application
    */
   function exitApp() {
      try {
         if (typeof tizen !== "undefined" && tizen.application) {
            tizen.application.getCurrentApplication().exit();
         }
      } catch (e) {
         console.log("[Tizen] Error exiting app:", e);
      }
   }

   /**
    * Get platform information including OS version and device details
    * @returns {Object} Platform information
    */
   function getPlatformInfo() {
      var platformInfo = {
         deviceName: "Samsung TV",
         osVersion: "Unknown",
         firmwareVersion: "Unknown",
         modelName: "Unknown",
      };

      try {
         // Try to get firmware version from webapis
         if (typeof webapis !== "undefined" && webapis.productinfo) {
            // Get firmware version (Tizen version)
            if (typeof webapis.productinfo.getFirmware === "function") {
               platformInfo.firmwareVersion = webapis.productinfo.getFirmware();
               platformInfo.osVersion = "Tizen " + platformInfo.firmwareVersion;
            }

            // Get model name
            if (typeof webapis.productinfo.getRealModel === "function") {
               platformInfo.modelName = webapis.productinfo.getRealModel();
            } else if (typeof webapis.productinfo.getModel === "function") {
               platformInfo.modelName = webapis.productinfo.getModel();
            }
         }
      } catch (e) {
         console.log("[Tizen] Error getting platform info:", e);
      }

      return platformInfo;
   }

   // Create the global Tizen platform object
   window.TizenPlatform = {
      AppInfo: AppInfo,
      getSystemInfo: getSystemInfo,
      getPlatformInfo: getPlatformInfo,
      registerKeys: registerKeys,
      unregisterKey: unregisterKey,
      platformBack: platformBack,
      exitApp: exitApp,
      getDeviceId: getDeviceId,
   };

   // Create backward compatibility shim for legacy code
   // This provides a minimal compatibility layer for existing code
   window.webOS = {
      platformBack: platformBack,
      fetchAppId: function () {
         return "org.moonfin.tizen";
      },
      fetchAppInfo: function (callback) {
         if (callback) {
            callback({
               id: "org.moonfin.tizen",
               version: AppInfo.appVersion,
               vendor: "Moonfin",
               type: "web",
               main: "browse.html",
               title: "Moonfin",
            });
         }
      },
      deviceInfo: function (callback) {
         getSystemInfo().then(function (info) {
            if (callback) {
               callback({
                  modelName: AppInfo.deviceName,
                  screenWidth: info.resolutionWidth,
                  screenHeight: info.resolutionHeight,
               });
            }
         });
      },
      keyboard: {
         isShowing: function () {
            return false; // Tizen doesn't expose this easily
         },
      },
      service: {
         request: function (uri, params) {
            console.log(
               "[Tizen] webOS.service.request called (not supported):",
               uri
            );
            if (params && params.onFailure) {
               params.onFailure({
                  errorText: "Service not supported on Tizen",
               });
            }
            return { cancel: function () {} };
         },
      },
   };

   // Initialize on DOM ready
   if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () {
         registerKeys();
         getSystemInfo();
      });
   } else {
      registerKeys();
      getSystemInfo();
   }

   // Also register on window load as backup
   window.addEventListener("load", function () {
      registerKeys();
   });

   console.log("[Tizen] Tizen adapter initialized");
})();
