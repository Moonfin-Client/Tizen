/**
 * PlaybackManager Adapter
 * 
 * Thin wrapper around jellyfin-web's PlaybackManager that:
 * 1. Translates PlaybackManager events to Moonfin UI callbacks
 * 2. Exposes a simplified API for player.js
 * 3. Preserves all existing UI code unchanged
 * 
 */

var PlaybackManagerAdapter = (function() {
   'use strict';

   let playbackManager = null;
   let currentPlayer = null;
   let uiCallbacks = {};
   let isInitialized = false;

   /**
    * Initialize the adapter with jellyfin-web's PlaybackManager
    * @param {Object} callbacks - UI update callback functions
    * @param {Function} callbacks.onTimeUpdate - (currentTicks, durationTicks) => void
    * @param {Function} callbacks.onPause - () => void
    * @param {Function} callbacks.onUnpause - () => void
    * @param {Function} callbacks.onPlaybackStart - (state) => void
    * @param {Function} callbacks.onPlaybackStop - (stopInfo) => void
    * @param {Function} callbacks.onMediaStreamsChange - () => void
    * @param {Function} callbacks.onError - (error) => void
    * @returns {boolean} Success status
    */
   function init(callbacks) {
      console.log('[PM-Adapter] Initializing PlaybackManager adapter...');

      if (isInitialized) {
         console.warn('[PM-Adapter] Already initialized');
         return true;
      }

      uiCallbacks = callbacks || {};

      if (typeof window !== 'undefined' && window.playbackManager) {
         playbackManager = window.playbackManager;
         console.log('[PM-Adapter] Found playbackManager:', !!playbackManager);
      } else {
         console.log('[PM-Adapter] playbackManager not available, using legacy mode');
         return false;
      }

      // Listen for player changes
      if (window.Events && playbackManager) {
         window.Events.on(playbackManager, 'playerchange', onPlayerChange);
         
         // Check if there's already a current player
         currentPlayer = playbackManager.getCurrentPlayer();
         if (currentPlayer) {
            console.log('[PM-Adapter] Found existing player, binding events');
            bindPlayerEvents(currentPlayer);
         }
      } else {
         console.error('[PM-Adapter] Events system not found');
         return false;
      }

      isInitialized = true;
      console.log('[PM-Adapter] Initialization complete');
      return true;
   }

   function destroy() {
      console.log('[PM-Adapter] Destroying adapter...');
      
      if (currentPlayer) {
         unbindPlayerEvents(currentPlayer);
         currentPlayer = null;
      }

      if (playbackManager && window.Events) {
         window.Events.off(playbackManager, 'playerchange', onPlayerChange);
      }

      uiCallbacks = {};
      isInitialized = false;
   }

   function onPlayerChange(e, newPlayer, newTarget, previousPlayer) {
      console.log('[PM-Adapter] Player changed:', {
         hasNewPlayer: !!newPlayer,
         hasPrevious: !!previousPlayer
      });

      if (previousPlayer === currentPlayer && currentPlayer) {
         unbindPlayerEvents(currentPlayer);
      }

      currentPlayer = newPlayer;

      if (newPlayer) {
         bindPlayerEvents(newPlayer);
      }
   }

   /**
    * Bind to player instance events
    * These are the events that drive UI updates
    */
   function bindPlayerEvents(player) {
      if (!player || !window.Events) return;

      console.log('[PM-Adapter] Binding events to player');

      // Lifecycle events
      window.Events.on(player, 'playbackstart', onPlaybackStart);
      window.Events.on(player, 'playbackstop', onPlaybackStop);

      // Playback state events
      window.Events.on(player, 'timeupdate', onTimeUpdate);
      window.Events.on(player, 'pause', onPause);
      window.Events.on(player, 'unpause', onUnpause);
      window.Events.on(player, 'statechange', onStateChange);

      // Media events
      window.Events.on(player, 'mediastreamschange', onMediaStreamsChange);
      window.Events.on(player, 'volumechange', onVolumeChange);

      // Playlist events (future)
      window.Events.on(player, 'playlistitemadd', onPlaylistItemAdd);
      window.Events.on(player, 'playlistitemremove', onPlaylistItemRemove);
      window.Events.on(player, 'repeatmodechange', onRepeatModeChange);

      // Error events
      window.Events.on(player, 'error', onError);
   }

   /**
    * Unbind all events from player
    */
   function unbindPlayerEvents(player) {
      if (!player || !window.Events) return;

      console.log('[PM-Adapter] Unbinding events from player');

      window.Events.off(player, 'playbackstart', onPlaybackStart);
      window.Events.off(player, 'playbackstop', onPlaybackStop);
      window.Events.off(player, 'timeupdate', onTimeUpdate);
      window.Events.off(player, 'pause', onPause);
      window.Events.off(player, 'unpause', onUnpause);
      window.Events.off(player, 'statechange', onStateChange);
      window.Events.off(player, 'mediastreamschange', onMediaStreamsChange);
      window.Events.off(player, 'volumechange', onVolumeChange);
      window.Events.off(player, 'playlistitemadd', onPlaylistItemAdd);
      window.Events.off(player, 'playlistitemremove', onPlaylistItemRemove);
      window.Events.off(player, 'repeatmodechange', onRepeatModeChange);
      window.Events.off(player, 'error', onError);
   }

   function onPlaybackStart(e, state) {
      console.log('[PM-Adapter] Playback started', state);

      if (uiCallbacks.onPlaybackStart) {
         uiCallbacks.onPlaybackStart(state);
      }
   }

   function onPlaybackStop(e, stopInfo) {
      console.log('[PM-Adapter] Playback stopped', stopInfo);

      if (uiCallbacks.onPlaybackStop) {
         uiCallbacks.onPlaybackStop(stopInfo);
      }
   }

   function onTimeUpdate() {
      if (!currentPlayer || !playbackManager) return;

      try {
         // Get current time and duration in ticks (ms * 10000)
         var currentSeconds = playbackManager.currentTime(currentPlayer);
         var durationSeconds = playbackManager.duration(currentPlayer);

         if (currentSeconds === undefined || durationSeconds === undefined) return;

         var currentTicks = Math.floor(currentSeconds * 10000);
         var durationTicks = Math.floor(durationSeconds * 10000);

         if (uiCallbacks.onTimeUpdate) {
            uiCallbacks.onTimeUpdate(currentTicks, durationTicks);
         }
      } catch (err) {
         console.error('[PM-Adapter] Error in timeupdate handler:', err);
      }
   }

   function onPause() {
      console.log('[PM-Adapter] Paused');

      if (uiCallbacks.onPause) {
         uiCallbacks.onPause();
      }
   }

   function onUnpause() {
      console.log('[PM-Adapter] Unpaused');

      if (uiCallbacks.onUnpause) {
         uiCallbacks.onUnpause();
      }
   }

   function onStateChange(e, state) {
      console.log('[PM-Adapter] State changed');
   }

   function onMediaStreamsChange() {
      console.log('[PM-Adapter] Media streams changed');

      if (uiCallbacks.onMediaStreamsChange) {
         uiCallbacks.onMediaStreamsChange();
      }
   }

   function onVolumeChange() {
      console.log('[PM-Adapter] Volume changed');
   }

   function onPlaylistItemAdd() {
      console.log('[PM-Adapter] Playlist item added');
   }

   function onPlaylistItemRemove() {
      console.log('[PM-Adapter] Playlist item removed');
   }

   function onRepeatModeChange() {
      console.log('[PM-Adapter] Repeat mode changed');
   }

   function onError(e, error) {
      console.error('[PM-Adapter] Playback error:', error);

      if (uiCallbacks.onError) {
         uiCallbacks.onError(error);
      }
   }

   /**
    * Start playback of an item
    * @param {Object} options - Playback options
    * @param {Array} options.items - Items to play (BaseItemDto[])
    * @param {number} [options.startPositionTicks] - Starting position
    * @param {number} [options.audioStreamIndex] - Audio track index
    * @param {number} [options.subtitleStreamIndex] - Subtitle track index
    * @returns {Promise}
    */
   function play(options) {
      if (!playbackManager) {
         return Promise.reject(new Error('PlaybackManager not initialized'));
      }

      console.log('[PM-Adapter] play() called with options:', options);
      return playbackManager.play(options);
   }

   function pause() {
      if (!playbackManager || !currentPlayer) {
         console.warn('[PM-Adapter] Cannot pause - no active player');
         return;
      }

      console.log('[PM-Adapter] pause() called');
      playbackManager.pause(currentPlayer);
   }

   function unpause() {
      if (!playbackManager || !currentPlayer) {
         console.warn('[PM-Adapter] Cannot unpause - no active player');
         return;
      }

      console.log('[PM-Adapter] unpause() called');
      playbackManager.unpause(currentPlayer);
   }

   function playPause() {
      if (!playbackManager || !currentPlayer) {
         console.warn('[PM-Adapter] Cannot playPause - no active player');
         return;
      }

      console.log('[PM-Adapter] playPause() called');
      playbackManager.playPause(currentPlayer);
   }

   function stop() {
      if (!playbackManager || !currentPlayer) {
         console.warn('[PM-Adapter] Cannot stop - no active player');
         return Promise.resolve();
      }

      console.log('[PM-Adapter] stop() called');
      return playbackManager.stop(currentPlayer);
   }

   /**
    * Seek to position
    * @param {number} ticks - Position in ticks (ms * 10000)
    */
   function seek(ticks) {
      if (!playbackManager || !currentPlayer) {
         console.warn('[PM-Adapter] Cannot seek - no active player');
         return;
      }

      console.log('[PM-Adapter] seek() called, ticks:', ticks);
      playbackManager.seek(ticks, currentPlayer);
   }

   /**
    * Get current playback position in seconds
    * @returns {number}
    */
   function currentTime() {
      if (!playbackManager || !currentPlayer) return 0;
      return playbackManager.currentTime(currentPlayer) || 0;
   }

   /**
    * Get media duration in seconds
    * @returns {number}
    */
   function duration() {
      if (!playbackManager || !currentPlayer) return 0;
      return playbackManager.duration(currentPlayer) || 0;
   }

   /**
    * Get paused state
    * @returns {boolean}
    */
   function paused() {
      if (!playbackManager || !currentPlayer) return true;
      return playbackManager.paused(currentPlayer);
   }

   /**
    * Get current item being played
    * @returns {Object|null} BaseItemDto
    */
   function currentItem() {
      if (!playbackManager || !currentPlayer) return null;
      return playbackManager.currentItem(currentPlayer);
   }

   /**
    * Get current media source
    * @returns {Object|null} MediaSource
    */
   function currentMediaSource() {
      if (!playbackManager || !currentPlayer) return null;
      return playbackManager.currentMediaSource(currentPlayer);
   }

   /**
    * Get play method (DirectPlay, DirectStream, Transcode)
    * @returns {string|null}
    */
   function playMethod() {
      if (!playbackManager || !currentPlayer) return null;
      return playbackManager.playMethod(currentPlayer);
   }

   /**
    * Get current player state
    * @returns {Object|null}
    */
   function getPlayerState() {
      if (!playbackManager || !currentPlayer) return null;
      return playbackManager.getPlayerState(currentPlayer);
   }

   /**
    * Get available audio tracks
    * @returns {Array}
    */
   function audioTracks() {
      if (!playbackManager || !currentPlayer) return [];
      return playbackManager.audioTracks(currentPlayer) || [];
   }

   function getAudioStreamIndex() {
      if (!playbackManager || !currentPlayer) return -1;
      return playbackManager.getAudioStreamIndex(currentPlayer);
   }

   /**
    * Set audio track
    * @param {number} index - Audio stream index
    */
   function setAudioStreamIndex(index) {
      if (!playbackManager || !currentPlayer) {
         console.warn('[PM-Adapter] Cannot set audio track - no active player');
         return;
      }

      console.log('[PM-Adapter] setAudioStreamIndex() called, index:', index);
      playbackManager.setAudioStreamIndex(index, currentPlayer);
   }

   /**
    * Get available subtitle tracks
    * @returns {Array}
    */
   function subtitleTracks() {
      if (!playbackManager || !currentPlayer) return [];
      return playbackManager.subtitleTracks(currentPlayer) || [];
   }

   /**
    * Get current subtitle track index
    * @returns {number}
    */
   function getSubtitleStreamIndex() {
      if (!playbackManager || !currentPlayer) return -1;
      return playbackManager.getSubtitleStreamIndex(currentPlayer);
   }

   /**
    * Set subtitle track
    * @param {number} index - Subtitle stream index (-1 to disable)
    */
   function setSubtitleStreamIndex(index) {
      if (!playbackManager || !currentPlayer) {
         console.warn('[PM-Adapter] Cannot set subtitle track - no active player');
         return;
      }

      console.log('[PM-Adapter] setSubtitleStreamIndex() called, index:', index);
      playbackManager.setSubtitleStreamIndex(index, currentPlayer);
   }

   function nextTrack() {
      if (!playbackManager || !currentPlayer) return;
      console.log('[PM-Adapter] nextTrack() called');
      playbackManager.nextTrack(currentPlayer);
   }

   function previousTrack() {
      if (!playbackManager || !currentPlayer) return;
      console.log('[PM-Adapter] previousTrack() called');
      playbackManager.previousTrack(currentPlayer);
   }

   return {
      // Initialization
      init: init,
      destroy: destroy,

      // Playback control
      play: play,
      pause: pause,
      unpause: unpause,
      playPause: playPause,
      stop: stop,
      seek: seek,

      // Playback state
      currentTime: currentTime,
      duration: duration,
      paused: paused,
      currentItem: currentItem,
      currentMediaSource: currentMediaSource,
      playMethod: playMethod,
      getPlayerState: getPlayerState,

      // Track management
      audioTracks: audioTracks,
      getAudioStreamIndex: getAudioStreamIndex,
      setAudioStreamIndex: setAudioStreamIndex,
      subtitleTracks: subtitleTracks,
      getSubtitleStreamIndex: getSubtitleStreamIndex,
      setSubtitleStreamIndex: setSubtitleStreamIndex,

      // Queue management
      nextTrack: nextTrack,
      previousTrack: previousTrack,

      // Debug
      isInitialized: function() { return isInitialized; },
      getPlaybackManager: function() { return playbackManager; },
      getCurrentPlayer: function() { return currentPlayer; }
   };
})();
