/**
 * Track Selector Module
 * Shared functionality for audio and subtitle track selection modals
 */

var TrackSelector = (function () {
    'use strict';

    /**
     * Builds audio track modal content
     * @param {Array} audioStreams - Array of audio stream objects
     * @param {number} currentIndex - Currently selected audio track index
     * @param {HTMLElement} container - Container element for track list
     * @param {Function} onSelect - Callback when track is selected
     * @returns {Array} Array of focusable track items
     */
    function buildAudioTrackList(audioStreams, currentIndex, container, onSelect) {
        console.log('[TrackSelector] Building audio track list:', audioStreams.length, 'tracks, current:', currentIndex);
        container.innerHTML = '';
        const focusableItems = [];

        audioStreams.forEach(function (stream, index) {
            const trackItem = document.createElement('div');
            trackItem.className = 'track-item';
            trackItem.tabIndex = 0;

            const lang = stream.Language || 'Unknown';
            const codec = stream.Codec ? stream.Codec.toUpperCase() : '';
            const channels = stream.Channels ? stream.Channels + 'ch' : '';
            const isDefault = stream.IsDefault ? ' [Default]' : '';

            trackItem.innerHTML = '<span class="track-name">' + lang + '</span>' +
                '<span class="track-info">' + codec + ' ' + channels + isDefault + '</span>';

            if (index === currentIndex) {
                trackItem.classList.add('selected');
            }

            trackItem.addEventListener('click', function (evt) {
                evt.stopPropagation();
                onSelect(index);
            });

            container.appendChild(trackItem);
            focusableItems.push(trackItem);
        });

        return focusableItems;
    }

    /**
     * Builds subtitle track modal content
     * @param {Array} subtitleStreams - Array of subtitle stream objects
     * @param {number} currentIndex - Currently selected subtitle track index (-1 for none)
     * @param {HTMLElement} container - Container element for track list
     * @param {Function} onSelect - Callback when track is selected
     * @returns {Array} Array of focusable track items
     */
    function buildSubtitleTrackList(subtitleStreams, currentIndex, container, onSelect) {
        console.log('[TrackSelector] Building subtitle track list:', subtitleStreams.length, 'tracks, current:', currentIndex);
        container.innerHTML = '';
        const focusableItems = [];

        const noneItem = document.createElement('div');
        noneItem.className = 'track-item';
        noneItem.tabIndex = 0;
        noneItem.innerHTML = '<span class="track-name">None</span>';

        if (currentIndex === -1) {
            noneItem.classList.add('selected');
        }

        noneItem.addEventListener('click', function (evt) {
            evt.stopPropagation();
            onSelect(-1);
        });

        container.appendChild(noneItem);
        focusableItems.push(noneItem);

        subtitleStreams.forEach(function (stream, index) {
            const trackItem = document.createElement('div');
            trackItem.className = 'track-item';
            trackItem.tabIndex = 0;

            const lang = stream.Language || 'Unknown';
            const codec = stream.Codec ? stream.Codec.toUpperCase() : '';
            const forced = stream.IsForced ? ' [Forced]' : '';
            const isDefault = stream.IsDefault ? ' [Default]' : '';

            trackItem.innerHTML = '<span class="track-name">' + lang + '</span>' +
                '<span class="track-info">' + codec + forced + isDefault + '</span>';

            if (index === currentIndex) {
                trackItem.classList.add('selected');
            }

            trackItem.addEventListener('click', function (evt) {
                evt.stopPropagation();
                onSelect(index);
            });

            container.appendChild(trackItem);
            focusableItems.push(trackItem);
        });

        return focusableItems;
    }

    /**
     * Handles keyboard navigation within track selection modals
     * @param {Event} evt - Keyboard event
     * @param {Array} focusableItems - Array of focusable elements
     * @param {number} currentFocusIndex - Current focus index
     * @param {Function} onClose - Callback to close modal
     * @returns {number} New focus index
     */
    function handleModalKeyDown(evt, focusableItems, currentFocusIndex, onClose) {

        switch (evt.keyCode) {
            case KeyCodes.UP:
                evt.preventDefault();
                if (currentFocusIndex > 0) {
                    currentFocusIndex--;
                    focusableItems[currentFocusIndex].focus();
                }
                break;

            case KeyCodes.DOWN:
                evt.preventDefault();
                if (currentFocusIndex < focusableItems.length - 1) {
                    currentFocusIndex++;
                    focusableItems[currentFocusIndex].focus();
                }
                break;

            case KeyCodes.ENTER:
                console.log('[TrackSelector] Track selected at index:', currentFocusIndex);
                evt.preventDefault();
                if (focusableItems[currentFocusIndex]) {
                    focusableItems[currentFocusIndex].click();
                }
                break;

            case KeyCodes.BACK:
            case KeyCodes.ESC:
                evt.preventDefault();
                onClose();
                break;

            default:
        }

        return currentFocusIndex;
    }

    return {
        buildAudioTrackList: buildAudioTrackList,
        buildSubtitleTrackList: buildSubtitleTrackList,
        handleModalKeyDown: handleModalKeyDown
    };
})();
