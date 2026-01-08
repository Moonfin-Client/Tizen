/**
 * Jellyfin Web Shim
 * 
 * Provides device profile builder with full parity to jellyfin-web.
 */

(function() {
   'use strict';

   console.log('[JF-Shim] Initializing Jellyfin Web Shim...');

   /**
    * Device profile builder for Jellyfin playback
    */
   function createProfileBuilder() {
      return function(options) {
         options = options || {};
         
         console.log('[JF-Shim] Building device profile with options:', options);

         const isTizen = navigator.userAgent.indexOf('Tizen') !== -1;
         const isWebOS = navigator.userAgent.indexOf('Web0S') !== -1;
         
         let maxVideoWidth = 3840;
         let maxVideoHeight = 2160;

         // Check for 8K support on Tizen
         if (isTizen) {
            try {
               if (typeof webapis !== 'undefined' && webapis.productinfo) {
                  if (typeof webapis.productinfo.is8KPanelSupported === 'function' &&
                      webapis.productinfo.is8KPanelSupported()) {
                     maxVideoWidth = 7680;
                     maxVideoHeight = 4320;
                     console.log('[JF-Shim] 8K panel detected');
                  }
               }
            } catch (e) {
               console.log('[JF-Shim] Could not check 8K support:', e);
            }
         }

         const profile = {
            MaxStreamingBitrate: 120000000,
            MaxStaticBitrate: 100000000,
            MusicStreamingTranscodingBitrate: 384000,
            DirectPlayProfiles: [
               // Video containers
               {
                  Container: 'mkv,webm',
                  Type: 'Video',
                  VideoCodec: 'h264,hevc,vp8,vp9,av1',
                  AudioCodec: 'aac,ac3,eac3,mp3,opus,flac,vorbis,pcm,truehd,dts'
               },
               {
                  Container: 'mp4,m4v',
                  Type: 'Video',
                  VideoCodec: 'h264,hevc,vp9,av1',
                  AudioCodec: 'aac,ac3,eac3,mp3,opus,flac,alac'
               },
               {
                  Container: 'ts,m2ts,mpegts',
                  Type: 'Video',
                  VideoCodec: 'h264,hevc,mpeg2video',
                  AudioCodec: 'aac,ac3,eac3,mp3,dts,truehd,pcm'
               },
               {
                  Container: 'avi',
                  Type: 'Video',
                  VideoCodec: 'h264,mpeg4,msmpeg4v3,vc1',
                  AudioCodec: 'aac,ac3,mp3,pcm'
               },
               {
                  Container: 'mov',
                  Type: 'Video',
                  VideoCodec: 'h264,hevc',
                  AudioCodec: 'aac,ac3,eac3,alac,pcm'
               },
               // Audio containers
               { Container: 'mp3', Type: 'Audio' },
               { Container: 'aac,m4a,m4b', Type: 'Audio', AudioCodec: 'aac' },
               { Container: 'flac', Type: 'Audio' },
               { Container: 'wav', Type: 'Audio' },
               { Container: 'ogg', Type: 'Audio', AudioCodec: 'opus,vorbis' }
            ],
            TranscodingProfiles: [
               {
                  Container: 'ts',
                  Type: 'Video',
                  AudioCodec: 'aac,ac3,eac3,mp3',
                  VideoCodec: 'h264',
                  Context: 'Streaming',
                  Protocol: 'hls',
                  MaxAudioChannels: '6',
                  MinSegments: 2,
                  BreakOnNonKeyFrames: true
               },
               {
                  Container: 'mp4',
                  Type: 'Video',
                  AudioCodec: 'aac,ac3,eac3',
                  VideoCodec: 'h264',
                  Context: 'Static',
                  Protocol: 'http'
               },
               {
                  Container: 'mp3',
                  Type: 'Audio',
                  AudioCodec: 'mp3',
                  Context: 'Streaming',
                  Protocol: 'http'
               },
               {
                  Container: 'aac',
                  Type: 'Audio',
                  AudioCodec: 'aac',
                  Context: 'Streaming',
                  Protocol: 'http',
                  MaxAudioChannels: '6'
               }
            ],
            ContainerProfiles: [],
            CodecProfiles: [
               {
                  Type: 'Video',
                  Codec: 'h264',
                  Conditions: [
                     { Condition: 'NotEquals', Property: 'IsAnamorphic', Value: 'true', IsRequired: false },
                     { Condition: 'EqualsAny', Property: 'VideoProfile', Value: 'high|main|baseline|constrained baseline', IsRequired: false },
                     { Condition: 'LessThanEqual', Property: 'VideoLevel', Value: '52', IsRequired: false },
                     { Condition: 'LessThanEqual', Property: 'Width', Value: String(maxVideoWidth), IsRequired: false },
                     { Condition: 'LessThanEqual', Property: 'Height', Value: String(maxVideoHeight), IsRequired: false }
                  ]
               },
               {
                  Type: 'Video',
                  Codec: 'hevc',
                  Conditions: [
                     { Condition: 'LessThanEqual', Property: 'Width', Value: String(maxVideoWidth), IsRequired: false },
                     { Condition: 'LessThanEqual', Property: 'Height', Value: String(maxVideoHeight), IsRequired: false }
                  ]
               },
               {
                  Type: 'VideoAudio',
                  Codec: 'aac,ac3,eac3',
                  Conditions: [
                     { Condition: 'LessThanEqual', Property: 'AudioChannels', Value: '8', IsRequired: false }
                  ]
               }
            ],
            SubtitleProfiles: [
               { Format: 'srt', Method: 'External' },
               { Format: 'srt', Method: 'Embed' },
               { Format: 'ass', Method: 'External' },
               { Format: 'ass', Method: 'Embed' },
               { Format: 'ssa', Method: 'External' },
               { Format: 'ssa', Method: 'Embed' },
               { Format: 'sub', Method: 'Embed' },
               { Format: 'sub', Method: 'External' },
               { Format: 'vtt', Method: 'External' },
               { Format: 'vtt', Method: 'Embed' },
               { Format: 'pgs', Method: 'Embed' },
               { Format: 'pgssub', Method: 'Embed' },
               { Format: 'dvdsub', Method: 'Embed' },
               { Format: 'dvbsub', Method: 'Embed' }
            ],
            ResponseProfiles: []
         };

         console.log('[JF-Shim] Profile built successfully');
         return profile;
      };
   }

   window.jellyfinProfileBuilder = createProfileBuilder();
   console.log('[JF-Shim] profileBuilder exposed at window.jellyfinProfileBuilder');

})();
