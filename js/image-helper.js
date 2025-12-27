/**
 * Image Helper Module
 * Handles image URL generation and selection based on user settings
 */
var ImageHelper = (function() {
    'use strict';

    /**
     * Current image type preference ('Primary' or 'Thumb')
     * @type {string}
     */
    var imageType = 'Primary';
    var posterSize = 300;

    /**
     * Set the image type preference
     * @param {string} type - 'Primary' or 'Thumb'
     */
    function setImageType(type) {
        imageType = type;
    }

    /**
     * Set the poster size
     * @param {number} size - Size in pixels
     */
    function setPosterSize(size) {
        posterSize = size;
    }

    /**
     * Get the current image type setting
     * @returns {string} Current image type
     */
    function getImageType() {
        return imageType;
    }

    /**
     * Get image URL for an item based on current settings
     * @param {string} serverAddress - Jellyfin server address
     * @param {Object} item - Jellyfin item object
     * @returns {string} Image URL
     */
    function getImageUrl(serverAddress, item) {
        if (!item || !serverAddress) return '';

        var itemId = item.Id;
        var imageTag = null;

        // For episodes: use series poster when imageType is Primary, episode thumbnail when Thumb
        if (item.Type === 'Episode' && imageType === 'Primary') {
            if (item.SeriesId && item.SeriesPrimaryImageTag) {
                itemId = item.SeriesId;
                imageTag = item.SeriesPrimaryImageTag;
            }
        }

        // Determine which image type to use
        var imgType = imageType;
        var hasRequestedType = false;

        if (imageType === 'Primary' && item.ImageTags && item.ImageTags.Primary) {
            hasRequestedType = true;
            imageTag = imageTag || item.ImageTags.Primary;
        } else if (imageType === 'Thumb' && item.ImageTags && item.ImageTags.Thumb) {
            hasRequestedType = true;
            imageTag = item.ImageTags.Thumb;
        } else if (imageType === 'Banner' && item.ImageTags && item.ImageTags.Banner) {
            hasRequestedType = true;
            imageTag = item.ImageTags.Banner;
        }

        // Fallback to Primary if requested type not available
        if (!hasRequestedType) {
            if (item.ImageTags && item.ImageTags.Primary) {
                imgType = 'Primary';
                imageTag = item.ImageTags.Primary;
            } else if (item.ImageTags && item.ImageTags.Thumb) {
                imgType = 'Thumb';
                imageTag = item.ImageTags.Thumb;
            } else if (item.ImageTags && item.ImageTags.Banner) {
                imgType = 'Banner';
                imageTag = item.ImageTags.Banner;
            }
        }

        if (!imageTag) return '';

        // Build URL with appropriate size parameters based on aspect ratio
        var params = 'quality=90';
        var aspect = getAspectRatio(item, imgType);
        
        if (imgType === 'Primary') {
            // Portrait poster - height-based (2:3 aspect)
            params += '&maxHeight=' + posterSize;
            params += '&maxWidth=' + Math.round(posterSize * aspect);
        } else if (imgType === 'Thumb') {
            // Landscape thumbnail - width-based (16:9 aspect)
            var thumbWidth = Math.round(posterSize * aspect);
            params += '&maxWidth=' + thumbWidth;
            params += '&maxHeight=' + posterSize;
        } else if (imgType === 'Banner') {
            // Wide banner - width-based
            var bannerWidth = Math.round(posterSize * aspect * 1.5);
            params += '&maxWidth=' + bannerWidth;
            params += '&maxHeight=' + posterSize;
        }
        params += '&tag=' + imageTag;

        return serverAddress + '/Items/' + itemId + '/Images/' + imgType + '?' + params;
    }

    /**
     * Get placeholder URL for items without images
     * @param {Object} item - Jellyfin item object
     * @param {string} [color='%23333'] - Placeholder color
     * @returns {string} SVG data URL
     */
    function getPlaceholderUrl(item, color) {
        color = color || '%23333';
        var aspect = getAspectRatio(item, imageType);
        
        var width = 200;
        var height = Math.round(width / aspect);
        
        return 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" ' +
               'width="' + width + '" height="' + height + '"%3E%3Crect fill="' + color +
               '" width="' + width + '" height="' + height + '"/%3E%3C/svg%3E';
    }

    /**
     * Get aspect ratio for an item based on image type
     * @param {Object} item - Jellyfin item object
     * @param {string} type - Image type
     * @returns {number} Aspect ratio (width/height)
     */
    function getAspectRatio(item, type) {
        // For episodes in Primary mode, use series poster aspect ratio
        if (item.Type === 'Episode' && type === 'Primary' && imageType === 'Primary') {
            return item.SeriesPrimaryImageAspectRatio || 0.667;
        }
        
        // Use PrimaryImageAspectRatio if available
        if (item.PrimaryImageAspectRatio && type === 'Primary') {
            return item.PrimaryImageAspectRatio;
        }

        // Default aspect ratios by type
        if (type === 'Thumb' || type === 'Banner') {
            return 1.78; // 16:9 landscape
        } else {
            // Primary/Poster - portrait
            return 0.667; // 2:3 portrait (common for posters)
        }
    }

    /**
     * Get TMDB image URL
     * @param {string} path - TMDB image path (with leading slash)
     * @param {string} size - Image size (w185, w500, w780, original, etc.)
     * @returns {string|null} Full TMDB image URL or null if no path
     */
    function getTMDBImageUrl(path, size) {
        if (!path) return null;
        
        // Remove leading slash if present
        var cleanPath = path.startsWith('/') ? path : '/' + path;
        
        // Default size if not specified
        var imageSize = size || 'w500';
        
        return 'https://image.tmdb.org/t/p/' + imageSize + cleanPath;
    }

    /**
     * Load settings from storage and apply them
     * @private
     */
    function loadSettingsFromStorage() {
        if (typeof storage === 'undefined') return;
        
        var stored = storage.getUserPreference('jellyfin_settings', null);
        if (stored) {
            try {
                var settings = JSON.parse(stored);
                
                if (settings.imageType) {
                    imageType = settings.imageType;
                }
                if (settings.posterSize !== undefined) {
                    posterSize = settings.posterSize;
                }
            } catch (e) {
                console.error('Failed to load ImageHelper settings:', e);
            }
        }
    }

    // Auto-initialize from storage when module loads
    loadSettingsFromStorage();

    return {
        setImageType: setImageType,
        setPosterSize: setPosterSize,
        getImageType: getImageType,
        getImageUrl: getImageUrl,
        getPlaceholderUrl: getPlaceholderUrl,
        getAspectRatio: getAspectRatio,
        getTMDBImageUrl: getTMDBImageUrl
    };
})();
