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

   // Supported features list
   var SupportedFeatures = [
      'exit',
      'exitmenu',
      'externallinkdisplay',
      'htmlaudioautoplay',
      'htmlvideoautoplay',
      'physicalvolumecontrol',
      'displaylanguage',
      'otherapppromotions',
      'targetblank',
      'screensaver',
      'multiserver',
      'subtitleappearancesettings',
      'subtitleburnsettings'
   ];

   /**
    * Generate comprehensive device profile for Tizen TV
    * This ensures proper DirectPlay and minimal transcoding
    */
   function generateDeviceProfile() {
      var tizenVersion = 6; // Default to Tizen 6 (2020+ TVs)
      try {
         var match = navigator.userAgent.match(/Tizen\s+(\d+)\.(\d+)/i);
         if (match) {
            tizenVersion = parseInt(match[1], 10) + parseInt(match[2], 10) / 10;
         }
      } catch (e) {
         console.log('[Tizen] Could not detect Tizen version:', e);
      }

      console.log('[Tizen] Generating device profile for Tizen', tizenVersion);

      // Build audio codec list based on Tizen version
      // DTS is NOT supported on Tizen 4.0+ (Samsung 2018+ TVs)
      var videoAudioCodecs = 'aac,mp3,ac3,eac3,opus,vorbis,pcm_s16le,pcm_s24le,aac_latm';
      var mkvAudioCodecs = videoAudioCodecs;
      if (tizenVersion < 4) {
         // Only older Tizen TVs support DTS
         mkvAudioCodecs += ',dca,dts,truehd';
      }
      // Note: FLAC excluded from video causes sync issues on Tizen
      
      // Build video codec list based on Tizen version
      var mp4VideoCodecs = 'h264,hevc';
      var mkvVideoCodecs = 'h264,hevc';
      if (tizenVersion >= 5.5) {
         // AV1 only supported on Tizen 5.5+ (2020 TVs)
         mp4VideoCodecs += ',av1';
         mkvVideoCodecs += ',av1';
      }
      mp4VideoCodecs += ',vp9';
      mkvVideoCodecs += ',vp9';

      return {
         MaxStreamingBitrate: 120000000,
         MaxStaticBitrate: 100000000,
         MusicStreamingTranscodingBitrate: 384000,
         
         DirectPlayProfiles: [
            // Video - MP4/M4V container
            {
               Container: 'mp4,m4v',
               Type: 'Video',
               VideoCodec: mp4VideoCodecs,
               AudioCodec: videoAudioCodecs
            },
            // Video - MKV container  
            {
               Container: 'mkv',
               Type: 'Video',
               VideoCodec: mkvVideoCodecs,
               AudioCodec: mkvAudioCodecs
            },
            // Video - WebM container
            {
               Container: 'webm',
               Type: 'Video',
               VideoCodec: tizenVersion >= 5.5 ? 'vp8,vp9,av1' : 'vp8,vp9',
               AudioCodec: 'vorbis,opus'
            },
            // Video - TS/MPEGTS container (Tizen specific)
            {
               Container: 'ts,mpegts',
               Type: 'Video',
               VideoCodec: 'h264,hevc,mpeg2video,vc1',
               AudioCodec: 'aac,mp3,ac3,eac3,opus,pcm_s16le,pcm_s24le,aac_latm'
            },
            // Video - M2TS container
            {
               Container: 'm2ts',
               Type: 'Video',
               VideoCodec: 'h264,hevc,mpeg2video,vc1',
               AudioCodec: 'aac,mp3,ac3,eac3,pcm_s16le,pcm_s24le'
            },
            // Video - Other Tizen-supported containers
            { Container: 'mov', Type: 'Video', VideoCodec: 'h264', AudioCodec: 'aac,mp3,ac3,eac3' },
            { Container: 'avi', Type: 'Video', VideoCodec: 'h264,hevc', AudioCodec: 'aac,mp3,ac3,eac3' },
            { Container: 'wmv', Type: 'Video' },
            { Container: 'asf', Type: 'Video' },
            // Video - HLS
            {
               Container: 'hls',
               Type: 'Video',
               VideoCodec: 'h264,hevc',
               AudioCodec: 'aac,mp3,ac3,eac3,opus'
            },
            // Audio formats
            { Container: 'mp3', Type: 'Audio' },
            { Container: 'aac', Type: 'Audio' },
            { Container: 'flac', Type: 'Audio' },
            { Container: 'opus', Type: 'Audio' },
            { Container: 'webm', AudioCodec: 'opus', Type: 'Audio' },
            { Container: 'wav', Type: 'Audio' },
            { Container: 'ogg', Type: 'Audio' },
            { Container: 'oga', Type: 'Audio' },
            { Container: 'wma', Type: 'Audio' },
            { Container: 'm4a', AudioCodec: 'aac', Type: 'Audio' },
            { Container: 'm4b', AudioCodec: 'aac', Type: 'Audio' }
         ],
         
         TranscodingProfiles: [
            // HLS video transcoding - fMP4 (Tizen 5+)
            {
               Container: 'mp4',
               Type: 'Video',
               AudioCodec: 'aac,mp3,ac3,eac3,opus',
               VideoCodec: 'h264,hevc',
               Context: 'Streaming',
               Protocol: 'hls',
               MaxAudioChannels: '6',
               MinSegments: '1',
               BreakOnNonKeyFrames: true
            },
            // HLS video transcoding - TS
            {
               Container: 'ts',
               Type: 'Video',
               AudioCodec: 'aac,mp3,ac3,eac3,opus',
               VideoCodec: 'h264,hevc',
               Context: 'Streaming',
               Protocol: 'hls',
               MaxAudioChannels: '6',
               MinSegments: '1',
               BreakOnNonKeyFrames: true
            },
            // Audio transcoding
            { Container: 'aac', Type: 'Audio', AudioCodec: 'aac', Context: 'Streaming', Protocol: 'http', MaxAudioChannels: '6' },
            { Container: 'mp3', Type: 'Audio', AudioCodec: 'mp3', Context: 'Streaming', Protocol: 'http', MaxAudioChannels: '6' },
            { Container: 'opus', Type: 'Audio', AudioCodec: 'opus', Context: 'Streaming', Protocol: 'http', MaxAudioChannels: '6' },
            { Container: 'wav', Type: 'Audio', AudioCodec: 'wav', Context: 'Streaming', Protocol: 'http', MaxAudioChannels: '6' },
            { Container: 'aac', Type: 'Audio', AudioCodec: 'aac', Context: 'Static', Protocol: 'http', MaxAudioChannels: '6' },
            { Container: 'mp3', Type: 'Audio', AudioCodec: 'mp3', Context: 'Static', Protocol: 'http', MaxAudioChannels: '6' },
            { Container: 'opus', Type: 'Audio', AudioCodec: 'opus', Context: 'Static', Protocol: 'http', MaxAudioChannels: '6' },
            { Container: 'wav', Type: 'Audio', AudioCodec: 'wav', Context: 'Static', Protocol: 'http', MaxAudioChannels: '6' }
         ],
         
         ContainerProfiles: tizenVersion < 6.5 ? [
            // Tizen <6.5 doesn't support more than 32 streams in a single file
            {
               Type: 'Video',
               Conditions: [{
                  Condition: 'LessThanEqual',
                  Property: 'NumStreams',
                  Value: '32',
                  IsRequired: false
               }]
            }
         ] : [],
         
         CodecProfiles: [
            // H264 codec profile
            {
               Type: 'Video',
               Codec: 'h264',
               Conditions: [
                  { Condition: 'EqualsAny', Property: 'VideoProfile', Value: 'high|main|baseline|constrained baseline', IsRequired: false },
                  { Condition: 'EqualsAny', Property: 'VideoRangeType', Value: 'SDR', IsRequired: false },
                  { Condition: 'LessThanEqual', Property: 'VideoLevel', Value: tizenVersion >= 5 ? '52' : '51', IsRequired: false },
                  { Condition: 'NotEquals', Property: 'IsAnamorphic', Value: 'true', IsRequired: false },
                  { Condition: 'NotEquals', Property: 'IsInterlaced', Value: 'true', IsRequired: false }
               ]
            },
            // HEVC codec profile
            {
               Type: 'Video',
               Codec: 'hevc',
               Conditions: [
                  { Condition: 'EqualsAny', Property: 'VideoProfile', Value: 'main|main 10', IsRequired: false },
                  // Tizen 3+ supports HDR10, HLG, and can play DV fallback
                  { Condition: 'EqualsAny', Property: 'VideoRangeType', Value: tizenVersion >= 3 ? 'SDR|HDR10|HDR10Plus|HLG|DOVIWithSDR|DOVIWithHDR10' : 'SDR', IsRequired: false },
                  { Condition: 'LessThanEqual', Property: 'VideoLevel', Value: '183', IsRequired: false },
                  { Condition: 'NotEquals', Property: 'IsAnamorphic', Value: 'true', IsRequired: false },
                  { Condition: 'NotEquals', Property: 'IsInterlaced', Value: 'true', IsRequired: false }
               ]
            },
            // AV1 codec profile (Tizen 5.5+ / 2021 TVs)
            {
               Type: 'Video',
               Codec: 'av1',
               Conditions: [
                  { Condition: 'EqualsAny', Property: 'VideoProfile', Value: 'main', IsRequired: false },
                  { Condition: 'EqualsAny', Property: 'VideoRangeType', Value: 'SDR|HDR10|HDR10Plus|HLG', IsRequired: false },
                  { Condition: 'LessThanEqual', Property: 'VideoLevel', Value: '15', IsRequired: false }
               ]
            },
            // VP9 codec profile
            {
               Type: 'Video',
               Codec: 'vp9',
               Conditions: [
                  { Condition: 'EqualsAny', Property: 'VideoRangeType', Value: 'SDR|HDR10|HDR10Plus|HLG', IsRequired: false }
               ]
            },
            // Audio channels limit
            {
               Type: 'VideoAudio',
               Conditions: [
                  { Condition: 'LessThanEqual', Property: 'AudioChannels', Value: '6', IsRequired: false }
               ]
            }
         ],
         
         SubtitleProfiles: [
            { Format: 'vtt', Method: 'External' },
            { Format: 'srt', Method: 'External' },
            { Format: 'ass', Method: 'External' },
            { Format: 'ssa', Method: 'External' },
            { Format: 'pgssub', Method: 'Encode' },
            { Format: 'dvdsub', Method: 'Encode' },
            { Format: 'dvbsub', Method: 'Encode' },
            { Format: 'sub', Method: 'Encode' }
         ],
         
         ResponseProfiles: [
            { Type: 'Video', Container: 'm4v', MimeType: 'video/mp4' }
         ]
      };
   }

   // Create NativeShell interface for jellyfin-web integration
   window.NativeShell = {
      AppHost: {
         init: function () {
            console.log('[Tizen] NativeShell.AppHost.init', AppInfo);
            return getSystemInfo().then(function () {
               return Promise.resolve(AppInfo);
            });
         },

         appName: function () {
            return AppInfo.appName;
         },

         appVersion: function () {
            return AppInfo.appVersion;
         },

         deviceId: function () {
            return AppInfo.deviceId;
         },

         deviceName: function () {
            return AppInfo.deviceName;
         },

         exit: function () {
            console.log('[Tizen] NativeShell.AppHost.exit');
            exitApp();
         },

         getDefaultLayout: function () {
            return 'tv';
         },

         /**
          * Get device profile using jellyfin-web's built-in profileBuilder
          * or generate one directly for custom implementations
          * @param {Function} profileBuilder
          * @returns {Object}
          */
         getDeviceProfile: function (profileBuilder) {
            console.log('[Tizen] NativeShell.AppHost.getDeviceProfile called');
            
            // If jellyfin-web's profileBuilder is provided, use it
            if (typeof profileBuilder === 'function') {
               console.log('[Tizen] Using jellyfin-web profileBuilder');
               return profileBuilder({
                  enableMkvProgressive: false,
                  enableSsaRender: true
               });
            }
            
            // Otherwise generate device profile directly
            console.log('[Tizen] Generating device profile directly');
            return generateDeviceProfile();
         },

         getSyncProfile: function (profileBuilder) {
            console.log('[Tizen] NativeShell.AppHost.getSyncProfile');
            return profileBuilder({ enableMkvProgressive: false });
         },

         screen: function () {
            return systeminfo ? {
               width: systeminfo.resolutionWidth,
               height: systeminfo.resolutionHeight
            } : null;
         },

         supports: function (command) {
            var isSupported = command && SupportedFeatures.indexOf(command.toLowerCase()) != -1;
            return isSupported;
         }
      },

      downloadFile: function (url) {
         console.log('[Tizen] NativeShell.downloadFile', url);
      },

      enableFullscreen: function () {
         console.log('[Tizen] NativeShell.enableFullscreen');
      },

      disableFullscreen: function () {
         console.log('[Tizen] NativeShell.disableFullscreen');
      },

      getPlugins: function () {
         return [];
      },

      openUrl: function (url, target) {
         console.log('[Tizen] NativeShell.openUrl', url, target);
      },

      updateMediaSession: function (mediaInfo) {
         console.log('[Tizen] NativeShell.updateMediaSession');
      },

      hideMediaSession: function () {
         console.log('[Tizen] NativeShell.hideMediaSession');
      }
   };

   // Create the global Tizen platform object for backward compatibility
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
