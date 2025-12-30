/**
 * Live TV Guide Module
 * Displays an electronic program guide (EPG) with channels and program schedules
 * Supports dual-mode navigation (controls/grid), favorites filtering, and direct channel access
 * @module LiveTVGuide
 */

(function() {
    'use strict';

    // State management
    let currentDate = new Date();
    let channels = [];
    let programs = {};
    let focusedElement = null;
    let showFavoritesOnly = false;
    let isLoading = false;
    let channelNumberBuffer = '';
    let channelNumberTimeout = null;
    let currentChannelIndex = 0;
    let totalChannels = 0;
    let hasMoreChannels = true;
    /** @type {('grid'|'controls')} Navigation mode */
    let focusMode = 'grid';
    let auth = null; // Store auth at module level
    
    // Configuration constants
    const CHANNELS_PER_BATCH = 50;
    const HOURS_TO_DISPLAY = 6;
    const PIXELS_PER_HOUR = 600;
    const MINUTES_PER_PIXEL = 60 / PIXELS_PER_HOUR;
    
    /**
     * Get authentication for the current page
     * Checks URL for serverId parameter and uses appropriate credentials
     */
    function getAuth() {
        if (auth) return auth; // Return cached auth
        
        // Check for serverId in URL
        const urlParams = new URLSearchParams(window.location.search);
        const serverId = urlParams.get('serverId');
        
        if (serverId && typeof MultiServerManager !== 'undefined') {
            // Check if this is the active server
            const activeServer = MultiServerManager.getActiveServer();
            if (activeServer && activeServer.serverId === serverId) {
                auth = {
                    serverAddress: activeServer.url,
                    userId: activeServer.userId,
                    accessToken: activeServer.accessToken
                };
            } else {
                // Get first user from specified server
                const users = MultiServerManager.getServerUsers(serverId);
                if (users && users.length > 0) {
                    const user = users[0];
                    const server = MultiServerManager.getServer(serverId);
                    auth = {
                        serverAddress: server.url,
                        userId: user.userId,
                        accessToken: user.accessToken
                    };
                }
            }
        }
        
        // Fall back to stored auth
        if (!auth) {
            auth = JellyfinAPI.getStoredAuth();
        }
        
        return auth;
    }
    
    /**
     * Build Jellyfin image URL with quality parameters
     * @param {string} itemId - Jellyfin item ID
     * @param {string} imageType - Image type (Primary, Backdrop, etc.)
     * @param {Object} options - Image options
     * @param {number} [options.maxWidth] - Maximum width
     * @param {number} [options.maxHeight] - Maximum height
     * @returns {string} Complete image URL
     */
    function buildImageUrl(itemId, imageType, options) {
        const auth = getAuth();
        if (!auth || !itemId) return '';
        
        let params = 'quality=90';
        if (options.maxWidth) {
            params += '&maxWidth=' + options.maxWidth;
        }
        if (options.maxHeight) {
            params += '&maxHeight=' + options.maxHeight;
        }
        
        return auth.serverAddress + '/Items/' + itemId + '/Images/' + imageType + '?' + params;
    }
    
    // Initialize
    document.addEventListener('DOMContentLoaded', function() {
        console.log('Live TV Guide initializing...');
        
        // Get and store auth for this page
        const pageAuth = getAuth();
        if (!pageAuth || !pageAuth.serverAddress || !pageAuth.userId) {
            console.error('[LIVE-TV] No valid auth found');
            window.location.href = 'login.html';
            return;
        }
        
        // Update stored auth so JellyfinAPI calls use correct server
        storage.set('jellyfin_auth', pageAuth);
        
        initializeDateDisplay();
        setupEventListeners();
        loadGuideData();
    });
    
    // Initialize date display
    function initializeDateDisplay() {
        updateDateDisplay();
    }
    
    // Update date display
    function updateDateDisplay() {
        const dateElement = document.getElementById('guideDate');
        const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        dateElement.textContent = currentDate.toLocaleDateString('en-US', options);
    }
    
    // Setup event listeners
    function setupEventListeners() {
        // Date navigation
        document.getElementById('prevDayBtn').addEventListener('click', () => changeDay(-1));
        document.getElementById('nextDayBtn').addEventListener('click', () => changeDay(1));
        document.getElementById('todayBtn').addEventListener('click', () => goToToday());
        document.getElementById('filterBtn').addEventListener('click', () => toggleFavorites());
        document.getElementById('recordingsBtn').addEventListener('click', () => {
            window.location.href = 'recordings.html';
        });
        
        // Scroll listener for lazy loading
        const guideContent = document.getElementById('guideContent');
        guideContent.addEventListener('scroll', handleScroll);
        
        // Keyboard navigation
        document.addEventListener('keydown', handleKeyPress);
        
        // Popup close
        document.getElementById('popupCloseBtn').addEventListener('click', closePopup);
        document.getElementById('popupWatchBtn').addEventListener('click', handleWatchProgram);
        document.getElementById('popupRecordBtn').addEventListener('click', handleRecordProgram);
        document.getElementById('popupFavoriteBtn').addEventListener('click', handleFavoriteChannel);
    }
    
    /**
     * Handle keyboard navigation
     * Routes keys based on current focus mode (controls vs grid)
     */
    function handleKeyPress(event) {
        const keyCode = event.keyCode;
        
        // Close popup if open
        const popup = document.getElementById('programDetailPopup');
        if (popup && popup.style.display !== 'none') {
            if (keyCode === KeyCodes.BACK || keyCode === KeyCodes.ESC) {
                event.preventDefault();
                closePopup();
                return;
            }
            // Handle navigation within popup
            if (keyCode === KeyCodes.UP || keyCode === KeyCodes.DOWN || 
                keyCode === KeyCodes.LEFT || keyCode === KeyCodes.RIGHT) {
                event.preventDefault();
                handlePopupNavigation(keyCode);
                return;
            }
            if (keyCode === KeyCodes.OK || keyCode === KeyCodes.ENTER) {
                event.preventDefault();
                handlePopupOK();
                return;
            }
            // Don't process other keys when popup is open
            return;
        }
        
        // Handle number keys for direct channel navigation (0-9)
        if (keyCode >= 48 && keyCode <= 57) {
            event.preventDefault();
            handleChannelNumber(String.fromCharCode(keyCode));
            return;
        }
        
        // Handle navigation based on focus mode
        if (focusMode === 'controls') {
            if (keyCode === KeyCodes.UP) {
                event.preventDefault();
                // Stay in controls
            } else if (keyCode === KeyCodes.DOWN) {
                event.preventDefault();
                // Move to grid
                focusMode = 'grid';
                const firstRow = document.querySelector('.channel-row');
                if (firstRow) {
                    focusCurrentProgramInChannel(firstRow);
                }
            } else if (keyCode === KeyCodes.LEFT) {
                event.preventDefault();
                navigateControls(-1);
            } else if (keyCode === KeyCodes.RIGHT) {
                event.preventDefault();
                navigateControls(1);
            } else if (keyCode === KeyCodes.OK || keyCode === KeyCodes.ENTER) {
                event.preventDefault();
                const focused = document.activeElement;
                if (focused && focused.tagName === 'BUTTON') {
                    focused.click();
                }
            } else if (keyCode === KeyCodes.BACK) {
                event.preventDefault();
                window.location.href = 'discover.html';
            }
        } else {
            // Grid navigation
            if (keyCode === KeyCodes.UP) {
                event.preventDefault();
                const result = navigateVertical(-1);
                // If at top of grid, move to controls
                if (result === 'top') {
                    focusMode = 'controls';
                    focusFirstControl();
                }
            } else if (keyCode === KeyCodes.DOWN) {
                event.preventDefault();
                navigateVertical(1);
            } else if (keyCode === KeyCodes.LEFT) {
                event.preventDefault();
                navigateHorizontal(-1);
            } else if (keyCode === KeyCodes.RIGHT) {
                event.preventDefault();
                navigateHorizontal(1);
            } else if (keyCode === KeyCodes.OK || keyCode === KeyCodes.ENTER) {
                event.preventDefault();
                if (focusedElement && focusedElement.classList.contains('program-cell')) {
                    const programId = focusedElement.dataset.programId;
                    const channelId = focusedElement.dataset.channelId;
                    showProgramDetail(programId, channelId);
                }
            } else if (keyCode === KeyCodes.BACK) {
                event.preventDefault();
                window.location.href = 'discover.html';
            } else if (keyCode === KeyCodes.CHANNEL_UP) {
                event.preventDefault();
                navigateVertical(-1);
            } else if (keyCode === KeyCodes.CHANNEL_DOWN) {
                event.preventDefault();
                navigateVertical(1);
            }
        }
    }
    
    // Handle direct channel number input
    function handleChannelNumber(digit) {
        // Clear previous timeout
        if (channelNumberTimeout) {
            clearTimeout(channelNumberTimeout);
        }
        
        // Add digit to buffer
        channelNumberBuffer += digit;
        
        // Show channel number overlay
        showChannelNumberOverlay(channelNumberBuffer);
        
        // Set timeout to jump to channel after 2 seconds
        channelNumberTimeout = setTimeout(() => {
            jumpToChannel(channelNumberBuffer);
            channelNumberBuffer = '';
            hideChannelNumberOverlay();
        }, 2000);
    }
    
    // Jump to specific channel by number
    function jumpToChannel(channelNumber) {
        const channelRows = Array.from(document.querySelectorAll('.channel-row'));
        
        // Find channel by number
        for (let row of channelRows) {
            const channelId = row.dataset.channelId;
            const channel = channels.find(ch => ch.Id === channelId);
            
            if (channel && channel.ChannelNumber === channelNumber) {
                // Scroll to channel
                row.scrollIntoView({ behavior: 'smooth', block: 'center' });
                
                // Focus current program in this channel
                setTimeout(() => {
                    focusCurrentProgramInChannel(row);
                }, 300);
                
                return;
            }
        }
        
        console.log('Channel not found:', channelNumber);
    }
    
    // Show channel number overlay
    function showChannelNumberOverlay(number) {
        let overlay = document.getElementById('channelNumberOverlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'channelNumberOverlay';
            overlay.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); ' +
                'background: rgba(0, 0, 0, 0.9); color: white; padding: 30px 50px; ' +
                'border-radius: 10px; font-size: 48px; font-weight: bold; z-index: 999; ' +
                'border: 2px solid #00a4dc;';
            document.body.appendChild(overlay);
        }
        overlay.textContent = number;
        overlay.style.display = 'block';
    }
    
    // Hide channel number overlay
    function hideChannelNumberOverlay() {
        const overlay = document.getElementById('channelNumberOverlay');
        if (overlay) {
            overlay.style.display = 'none';
        }
    }
    
    /**
     * Navigate vertically through channel rows
     * @param {number} direction - Direction to navigate (-1 for up, 1 for down)
     * @returns {string|undefined} Returns 'top' if at first row and trying to go up
     */
    function navigateVertical(direction) {
        const channelRows = Array.from(document.querySelectorAll('.channel-row'));
        if (channelRows.length === 0) return;
        
        let currentRowIndex = focusedElement ? 
            channelRows.indexOf(focusedElement.closest('.channel-row')) : -1;
        if (currentRowIndex === -1) {
            // No focus, focus first channel's current program
            for (let i = 0; i < channelRows.length; i++) {
                if (focusCurrentProgramInChannel(channelRows[i])) {
                    return;
                }
            }
        } else {
            // Check if trying to go up from first row
            if (direction === -1 && currentRowIndex === 0) {
                return 'top';
            }
            
            // Move to next/previous channel with programs
            let newRowIndex = currentRowIndex + direction;
            const currentTime = focusedElement ? 
                parseFloat(focusedElement.style.left) : getCurrentTimePosition();
            
            // Keep trying until we find a channel with programs
            while (newRowIndex >= 0 && newRowIndex < channelRows.length) {
                const focused = focusProgramAtPosition(channelRows[newRowIndex], currentTime);
                if (focused) {
                    // Successfully focused, scroll to keep visible
                    const newRow = channelRows[newRowIndex];
                    newRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    return;
                }
                
                // No programs in this channel, try next
                newRowIndex += direction;
            }
        }
    }
    
    /**
     * Navigate horizontally through programs in current channel
     * @param {number} direction - Direction (-1 left, 1 right)
     */
    function navigateHorizontal(direction) {
        if (!focusedElement) {
            navigateVertical(0); // Initialize focus
            return;
        }
        
        const channelRow = focusedElement.closest('.channel-row');
        const programs = Array.from(channelRow.querySelectorAll('.program-cell'));
        const currentIndex = programs.indexOf(focusedElement);
        
        if (currentIndex !== -1) {
            const newIndex = currentIndex + direction;
            if (newIndex >= 0 && newIndex < programs.length) {
                setFocus(programs[newIndex]);
            }
        }
    }
    
    // Focus current program in channel
    function focusCurrentProgramInChannel(channelRow) {
        const currentTimePosition = getCurrentTimePosition();
        return focusProgramAtPosition(channelRow, currentTimePosition);
    }
    
    // Focus program at specific position
    function focusProgramAtPosition(channelRow, position) {
        const programs = Array.from(channelRow.querySelectorAll('.program-cell'));
        
        if (programs.length === 0) {
            console.log('No programs found in channel');
            return false;
        }
        
        // Find program at position
        for (let program of programs) {
            const left = parseFloat(program.style.left);
            const width = parseFloat(program.style.width);
            
            if (position >= left && position < left + width) {
                setFocus(program);
                return true;
            }
        }
        
        // Fallback to first program
        if (programs.length > 0) {
            setFocus(programs[0]);
            return true;
        }
        
        return false;
    }
    
    // Get current time position in pixels
    function getCurrentTimePosition() {
        const startTime = getGuideStartTime();
        const now = new Date();
        const minutesSinceStart = (now - startTime) / (1000 * 60);
        return minutesSinceStart / MINUTES_PER_PIXEL;
    }
    
    /**
     * Set focus on a program cell element
     * @param {HTMLElement} element - Element to focus
     */
    function setFocus(element) {
        if (focusedElement) {
            focusedElement.classList.remove('focused');
        }
        
        focusedElement = element;
        
        if (focusedElement) {
            focusedElement.classList.add('focused');
            focusedElement.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }
    }
    
    // Get control buttons
    function getControlButtons() {
        return [
            document.getElementById('prevDayBtn'),
            document.getElementById('nextDayBtn'),
            document.getElementById('todayBtn'),
            document.getElementById('filterBtn'),
            document.getElementById('recordingsBtn')
        ].filter(btn => btn);
    }
    
    // Focus first control button
    function focusFirstControl() {
        const buttons = getControlButtons();
        if (buttons.length > 0) {
            buttons[0].focus();
        }
    }
    
    // Navigate through control buttons
    function navigateControls(direction) {
        const buttons = getControlButtons();
        if (buttons.length === 0) return;
        
        let currentIndex = buttons.findIndex(btn => document.activeElement === btn);
        if (currentIndex === -1) currentIndex = 0;
        
        currentIndex = (currentIndex + direction + buttons.length) % buttons.length;
        buttons[currentIndex].focus();
    }
    
    // Change day
    function changeDay(days) {
        currentDate.setDate(currentDate.getDate() + days);
        updateDateDisplay();
        loadGuideData();
    }
    
    // Go to today
    function goToToday() {
        currentDate = new Date();
        updateDateDisplay();
        loadGuideData();
    }
    
    // Toggle favorites filter
    function toggleFavorites() {
        showFavoritesOnly = !showFavoritesOnly;
        const btn = document.getElementById('filterBtn');
        btn.textContent = showFavoritesOnly ? 'All Channels' : 'Favorites';
        renderChannels(); // Re-render all loaded channels with filter
    }
    
    // Load guide data
    async function loadGuideData() {
        if (isLoading) return;
        
        isLoading = true;
        showLoading(true);
        
        try {
            console.log('loadGuideData: Resetting state...');
            // Reset state
            channels = [];
            programs = {};
            currentChannelIndex = 0;
            hasMoreChannels = true;
            
            // Clear guide content
            const guideContent = document.getElementById('guideContent');
            guideContent.innerHTML = '';
            
            console.log('loadGuideData: Loading first batch...');
            // Load first batch
            await loadMoreChannels();
            
            console.log('loadGuideData: Rendering guide...');
            // Render guide
            renderTimeHeader();
            renderCurrentTimeIndicator();
            
            // Set initial focus
            setTimeout(() => {
                const firstRow = document.querySelector('.channel-row');
                if (firstRow) {
                    focusCurrentProgramInChannel(firstRow);
                }
            }, 100);
            
            console.log('loadGuideData: Complete');
            
        } catch (error) {
            console.error('Error loading guide data:', error);
            alert('Failed to load TV guide. Please try again.');
        } finally {
            isLoading = false;
            showLoading(false);
        }
    }
    
    // Load more channels (for lazy loading)
    async function loadMoreChannels() {
        if (!hasMoreChannels) {
            console.log('loadMoreChannels: No more channels to load');
            return;
        }
        
        // Prevent duplicate loads (only when called from scroll, not from initial load)
        if (isLoading && currentChannelIndex > 0) {
            console.log('loadMoreChannels: Already loading, skipping');
            return;
        }
        
        const wasLoading = isLoading;
        isLoading = true;
        
        try {
            console.log('Loading channels starting at index:', currentChannelIndex);
            
            // Get next batch of channels (all channels, not just favorites)
            const newChannels = await new Promise((resolve, reject) => {
                JellyfinAPI.getChannels(null, currentChannelIndex, CHANNELS_PER_BATCH, false, (err, data) => {
                    if (err) reject(err);
                    else resolve(data);
                });
            });
            
            if (!newChannels || newChannels.length === 0) {
                hasMoreChannels = false;
                console.log('No more channels to load');
                return;
            }
            
            console.log('Loaded', newChannels.length, 'channels');
            
            // Get programs for new channels
            const startTime = getGuideStartTime();
            const endTime = getGuideEndTime();
            
            console.log('Fetching programs from', startTime, 'to', endTime);
            
            // Batch fetch all programs for all channels in one API call
            const channelIds = newChannels.map(ch => ch.Id);
            const allPrograms = await new Promise((resolve, reject) => {
                JellyfinAPI.getPrograms(channelIds, startTime, endTime, (err, data) => {
                    if (err) {
                        console.error('Error fetching programs:', err);
                        reject(err);
                    } else {
                        console.log('Batch fetched', data ? data.length : 0, 'programs for', channelIds.length, 'channels');
                        resolve(data || []);
                    }
                });
            });
            
            // Group programs by channel ID
            const programsByChannel = {};
            allPrograms.forEach(program => {
                const channelId = program.ChannelId;
                if (!programsByChannel[channelId]) {
                    programsByChannel[channelId] = [];
                }
                programsByChannel[channelId].push(program);
            });
            
            // Add to existing channels and programs
            let totalPrograms = 0;
            newChannels.forEach(channel => {
                channels.push(channel);
                programs[channel.Id] = programsByChannel[channel.Id] || [];
                totalPrograms += programs[channel.Id].length;
                if (programs[channel.Id].length === 0) {
                    console.log('No programs for channel:', channel.Name);
                }
            });
            
            console.log('Batch loaded', totalPrograms, 'programs for', newChannels.length, 'channels');
            
            // Render new channels
            renderNewChannels(newChannels);
            
            // Update index
            currentChannelIndex += newChannels.length;
            
            // Check if we got less than requested (means no more channels)
            if (newChannels.length < CHANNELS_PER_BATCH) {
                hasMoreChannels = false;
                console.log('Reached end of channels. Total:', channels.length);
            }
            
        } catch (error) {
            console.error('Error loading more channels:', error);
            hasMoreChannels = false;
        } finally {
            // Only set isLoading to false if we set it to true
            if (!wasLoading || currentChannelIndex > 0) {
                isLoading = false;
            }
        }
    }
    
    // Handle scroll for lazy loading
    function handleScroll() {
        const guideContent = document.getElementById('guideContent');
        
        // Vertical scroll - load more channels
        const scrollPosition = guideContent.scrollTop + guideContent.clientHeight;
        const scrollHeight = guideContent.scrollHeight;
        
        // Load more when within 500px of bottom
        if (scrollPosition >= scrollHeight - 500 && hasMoreChannels && !isLoading) {
            console.log('Near bottom, loading more channels...');
            loadMoreChannels();
        }
        
        // Horizontal scroll - load more time (future hours)
        const scrollRight = guideContent.scrollLeft + guideContent.clientWidth;
        const scrollWidth = guideContent.scrollWidth;
        
        // Load more hours when within 1000px of right edge
        if (scrollRight >= scrollWidth - 1000 && !isLoading) {
            console.log('Near right edge, loading more hours...');
            loadMoreHours();
        }
    }
    
    // Get guide start time (start of current hour)
    function getGuideStartTime() {
        const start = new Date(currentDate);
        const currentHour = new Date().getHours();
        start.setHours(currentHour, 0, 0, 0);
        return start;
    }
    
    // Get guide end time
    function getGuideEndTime() {
        const end = new Date(getGuideStartTime());
        end.setHours(end.getHours() + HOURS_TO_DISPLAY);
        return end;
    }
    
    // Render guide
    function renderGuide() {
        renderTimeHeader();
        renderChannels();
        renderCurrentTimeIndicator();
        
        // Set initial focus
        setTimeout(() => {
            const firstRow = document.querySelector('.channel-row');
            if (firstRow) {
                focusCurrentProgramInChannel(firstRow);
            }
        }, 100);
    }
    
    // Render time header
    function renderTimeHeader() {
        const timeSlotsContainer = document.getElementById('timeSlots');
        timeSlotsContainer.innerHTML = '';
        
        const startTime = getGuideStartTime();
        
        // Display 30-minute increments
        const totalSlots = HOURS_TO_DISPLAY * 2; // 2 slots per hour (0:00 and 0:30)
        for (let i = 0; i < totalSlots; i++) {
            const slotTime = new Date(startTime);
            slotTime.setMinutes(slotTime.getMinutes() + (i * 30));
            
            const timeSlot = document.createElement('div');
            timeSlot.className = 'time-slot';
            timeSlot.style.width = (PIXELS_PER_HOUR / 2) + 'px'; // 300px for 30-minute slot
            timeSlot.textContent = slotTime.toLocaleTimeString('en-US', { 
                hour: 'numeric', 
                minute: '2-digit',
                hour12: true 
            });
            
            timeSlotsContainer.appendChild(timeSlot);
        }
    }
    
    // Render channels
    function renderChannels() {
        const guideContent = document.getElementById('guideContent');
        guideContent.innerHTML = '';
        
        const channelsToShow = showFavoritesOnly ? 
            channels.filter(ch => ch.UserData && ch.UserData.IsFavorite) : 
            channels;
        
        channelsToShow.forEach(channel => {
            const channelRow = createChannelRow(channel);
            guideContent.appendChild(channelRow);
        });
    }
    
    // Load more hours (extend time window to the right)
    async function loadMoreHours() {
        if (isLoading) return;
        
        try {
            isLoading = true;
            console.log('Loading more hours...');
            
            // Extend hours display
            const previousHours = HOURS_TO_DISPLAY;
            HOURS_TO_DISPLAY += 3; // Add 3 more hours
            
            // Get new end time
            const newEndTime = getGuideEndTime();
            const oldEndTime = new Date(newEndTime);
            oldEndTime.setHours(oldEndTime.getHours() - 3);
            
            // Fetch programs for the extended time range for all loaded channels
            const channelIds = channels.map(ch => ch.Id);
            const newPrograms = await new Promise((resolve, reject) => {
                JellyfinAPI.getPrograms(channelIds, oldEndTime, newEndTime, (err, data) => {
                    if (err) reject(err);
                    else resolve(data || []);
                });
            });
            
            // Group new programs by channel
            const programsByChannel = {};
            newPrograms.forEach(program => {
                const channelId = program.ChannelId;
                if (!programsByChannel[channelId]) {
                    programsByChannel[channelId] = [];
                }
                programsByChannel[channelId].push(program);
            });
            
            // Add new programs to existing data
            channels.forEach(channel => {
                const newChannelPrograms = programsByChannel[channel.Id] || [];
                if (newChannelPrograms.length > 0) {
                    // Add only programs that aren't already in the array
                    const existingProgramIds = new Set(programs[channel.Id].map(p => p.Id));
                    const uniqueNewPrograms = newChannelPrograms.filter(p => !existingProgramIds.has(p.Id));
                    programs[channel.Id] = [...programs[channel.Id], ...uniqueNewPrograms];
                }
            });
            
            console.log('Extended from', previousHours, 'to', HOURS_TO_DISPLAY, 'hours, loaded', newPrograms.length, 'programs');
            
            // Re-render time header and all channel programs
            renderTimeHeader();
            
            // Update all channel rows with new programs
            const channelRows = document.querySelectorAll('.channel-row');
            channelRows.forEach(row => {
                const channelId = row.dataset.channelId;
                const channelPrograms = programs[channelId] || [];
                
                // Find the programs container
                const programsContainer = row.querySelector('.programs-container');
                if (programsContainer) {
                    // Clear and re-render programs
                    programsContainer.innerHTML = '';
                    renderPrograms(programsContainer, channelPrograms);
                }
            });
            
        } catch (error) {
            console.error('Error loading more hours:', error);
        } finally {
            isLoading = false;
        }
    }
    
    // Render new channels (for lazy loading)
    function renderNewChannels(newChannels) {
        const guideContent = document.getElementById('guideContent');
        
        const channelsToShow = showFavoritesOnly ? 
            newChannels.filter(ch => ch.UserData && ch.UserData.IsFavorite) : 
            newChannels;
        
        channelsToShow.forEach(channel => {
            const channelRow = createChannelRow(channel);
            guideContent.appendChild(channelRow);
        });
    }
    
    // Create channel row
    function createChannelRow(channel) {
        const row = document.createElement('div');
        row.className = 'channel-row';
        row.dataset.channelId = channel.Id;
        
        // Channel info
        const channelInfo = document.createElement('div');
        channelInfo.className = 'channel-info';
        
        const channelNumber = document.createElement('div');
        channelNumber.className = 'channel-number';
        channelNumber.textContent = channel.ChannelNumber || '';
        
        const channelName = document.createElement('div');
        channelName.className = 'channel-name';
        channelName.textContent = channel.Name || 'Unknown Channel';
        
        channelInfo.appendChild(channelNumber);
        channelInfo.appendChild(channelName);
        
        // Channel logo if available
        if (channel.ImageTags && channel.ImageTags.Primary) {
            const logo = document.createElement('img');
            logo.className = 'channel-logo';
            logo.src = buildImageUrl(channel.Id, 'Primary', { maxWidth: 120 });
            logo.onerror = () => logo.style.display = 'none';
            channelInfo.appendChild(logo);
        }
        
        // Programs container
        const programsContainer = document.createElement('div');
        programsContainer.className = 'programs-container';
        programsContainer.style.width = (HOURS_TO_DISPLAY * PIXELS_PER_HOUR) + 'px';
        
        // Add programs
        const channelPrograms = programs[channel.Id] || [];
        const startTime = getGuideStartTime();
        const now = new Date();
        
        channelPrograms.forEach(program => {
            const programCell = createProgramCell(program, channel, startTime, now);
            if (programCell) {
                programsContainer.appendChild(programCell);
            }
        });
        
        row.appendChild(channelInfo);
        row.appendChild(programsContainer);
        
        return row;
    }
    
    /**
     * Create a program cell DOM element for the guide grid
     * @param {Object} program - Program data from Jellyfin
     * @param {Object} channel - Channel data
     * @param {Date} startTime - Guide window start time
     * @param {Date} now - Current time for highlighting
     * @returns {HTMLElement|null} Program cell element or null if outside window
     */
    function createProgramCell(program, channel, startTime, now) {
        const programStart = new Date(program.StartDate);
        const programEnd = new Date(program.EndDate);
        
        // Calculate position and width
        const minutesFromStart = (programStart - startTime) / (1000 * 60);
        const durationMinutes = (programEnd - programStart) / (1000 * 60);
        
        let left = minutesFromStart / MINUTES_PER_PIXEL;
        let width = durationMinutes / MINUTES_PER_PIXEL;
        
        // If program starts before guide window, clip it
        if (left < 0) {
            width = width + left; // Reduce width by the amount that's off-screen
            left = 0;
        }
        
        const guideEndTime = new Date(startTime.getTime() + HOURS_TO_DISPLAY * 60 * 60 * 1000);
        
        // Skip if program ends before guide starts or starts after guide ends
        if (programEnd <= startTime || programStart > guideEndTime) {
            console.log('Filtering out program:', program.Name, 
                'Start:', programStart.toISOString(), 
                'End:', programEnd.toISOString(),
                'Guide window:', startTime.toISOString(), 'to', guideEndTime.toISOString());
            return null;
        }
        
        // Skip if width is too small after clipping
        if (width < 1) {
            console.log('Program too narrow:', program.Name, 'width:', width);
            return null;
        }
        
        const cell = document.createElement('div');
        cell.className = 'program-cell';
        cell.dataset.programId = program.Id;
        cell.dataset.channelId = channel.Id;
        
        // Subtract margin from width to prevent overlap (margin-right: 6px in CSS)
        cell.style.left = left + 'px';
        cell.style.width = (width - 6) + 'px';
        
        // Mark current program
        if (now >= programStart && now < programEnd) {
            cell.classList.add('current');
        }
        
        // Program time
        const timeDiv = document.createElement('div');
        timeDiv.className = 'program-time';
        timeDiv.textContent = programStart.toLocaleTimeString('en-US', { 
            hour: 'numeric', 
            minute: '2-digit',
            hour12: true 
        });
        
        // Program title
        const titleDiv = document.createElement('div');
        titleDiv.className = 'program-title';
        titleDiv.textContent = program.Name || 'Unknown';
        
        cell.appendChild(timeDiv);
        cell.appendChild(titleDiv);
        
        // Episode info if available
        if (program.EpisodeTitle) {
            const episodeDiv = document.createElement('div');
            episodeDiv.className = 'program-episode';
            episodeDiv.textContent = program.EpisodeTitle;
            cell.appendChild(episodeDiv);
        }
        
        // Click handler
        cell.addEventListener('click', () => showProgramDetail(program.Id, channel.Id));
        
        return cell;
    }
    
    // Render current time indicator
    function renderCurrentTimeIndicator() {
        // Remove existing indicator
        document.querySelectorAll('.current-time-indicator').forEach(el => el.remove());
        
        const now = new Date();
        const startTime = getGuideStartTime();
        const endTime = getGuideEndTime();
        
        // Only show if current time is within guide range
        if (now >= startTime && now <= endTime) {
            const minutesFromStart = (now - startTime) / (1000 * 60);
            const position = minutesFromStart / MINUTES_PER_PIXEL;
            
            document.querySelectorAll('.programs-container').forEach(container => {
                const indicator = document.createElement('div');
                indicator.className = 'current-time-indicator';
                indicator.style.left = position + 'px';
                container.appendChild(indicator);
            });
        }
    }
    
    // Show program detail popup
    async function showProgramDetail(programId, channelId) {
        try {
            const program = await new Promise((resolve, reject) => {
                JellyfinAPI.getProgram(programId, (err, data) => {
                    if (err) reject(err);
                    else resolve(data);
                });
            });
            
            const channel = channels.find(ch => ch.Id === channelId);
            
            if (!program || !channel) return;
            
            // Update popup content
            let title = program.Name || 'Unknown';
            
            // Add episode info if available
            if (program.ParentIndexNumber && program.IndexNumber) {
                title += ' - S' + program.ParentIndexNumber + 'E' + program.IndexNumber;
            }
            
            document.getElementById('popupTitle').textContent = title;
            
            // Show series name if this is an episode
            const episodeInfo = document.getElementById('popupEpisodeInfo');
            if (program.SeriesName && program.SeriesName !== program.Name) {
                episodeInfo.textContent = program.SeriesName;
                episodeInfo.style.display = 'block';
            } else if (program.EpisodeTitle) {
                episodeInfo.textContent = program.EpisodeTitle;
                episodeInfo.style.display = 'block';
            } else {
                episodeInfo.style.display = 'none';
            }
            
            const startTime = new Date(program.StartDate);
            const endTime = new Date(program.EndDate);
            document.getElementById('popupTime').textContent = 
                `${startTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })} - ` +
                `${endTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`;
            
            document.getElementById('popupChannel').textContent = channel.Name;
            document.getElementById('popupOverview').textContent = program.Overview || 'No description available.';
            
            // Image
            const img = document.getElementById('popupImage');
            if (program.ImageTags && program.ImageTags.Primary) {
                img.src = buildImageUrl(program.Id, 'Primary', { maxWidth: 300 });
                img.style.display = 'block';
            } else if (program.SeriesId) {
                img.src = buildImageUrl(program.SeriesId, 'Primary', { maxWidth: 300 });
                img.style.display = 'block';
            } else {
                img.style.display = 'none';
            }
            
            // Rating
            if (program.OfficialRating) {
                document.getElementById('popupRating').textContent = program.OfficialRating;
                document.getElementById('popupRatingContainer').style.display = 'flex';
            } else {
                document.getElementById('popupRatingContainer').style.display = 'none';
            }
            
            // Year
            const yearContainer = document.getElementById('popupYearContainer');
            if (program.ProductionYear) {
                document.getElementById('popupYear').textContent = program.ProductionYear;
                yearContainer.style.display = 'flex';
            } else {
                yearContainer.style.display = 'none';
            }
            
            // Genres
            if (program.Genres && program.Genres.length > 0) {
                document.getElementById('popupGenres').textContent = program.Genres.join(', ');
                document.getElementById('popupGenresContainer').style.display = 'flex';
            } else {
                document.getElementById('popupGenresContainer').style.display = 'none';
            }
            
            // Watch button - only show if currently airing
            const now = new Date();
            const watchBtn = document.getElementById('popupWatchBtn');
            if (now >= startTime && now < endTime) {
                watchBtn.style.display = 'block';
                watchBtn.dataset.channelId = channelId;
            } else {
                watchBtn.style.display = 'none';
            }
            
            // Record button - show if program is in the future or currently airing
            const recordBtn = document.getElementById('popupRecordBtn');
            if (now <= endTime) {
                recordBtn.style.display = 'block';
                recordBtn.dataset.programId = programId;
                
                // Check if already scheduled for recording
                checkRecordingStatus(program, recordBtn);
            } else {
                recordBtn.style.display = 'none';
            }
            
            // Favorite channel button - always show
            const favoriteBtn = document.getElementById('popupFavoriteBtn');
            favoriteBtn.style.display = 'block';
            favoriteBtn.dataset.channelId = channelId;
            
            // Check if channel is already favorited
            checkChannelFavoriteStatus(channelId, favoriteBtn);
            
            // Show popup
            document.getElementById('programDetailPopup').style.display = 'flex';
            
            // Focus first visible button
            setTimeout(() => {
                focusFirstPopupButton();
            }, 100);
            
        } catch (error) {
            console.error('Error loading program details:', error);
        }
    }
    
    // Check if program is scheduled for recording
    function checkRecordingStatus(program, recordBtn) {
        JellyfinAPI.getRecordingTimers((err, timers) => {
            if (err || !timers) return;
            
            // Find timer for this program
            const existingTimer = timers.find(timer => 
                timer.ProgramId === program.Id || 
                (timer.ChannelId === program.ChannelId && 
                 timer.StartDate === program.StartDate)
            );
            
            if (existingTimer) {
                recordBtn.textContent = 'Cancel Recording';
                recordBtn.classList.add('recording-scheduled');
                recordBtn.dataset.timerId = existingTimer.Id;
                recordBtn.dataset.isScheduled = 'true';
            } else {
                recordBtn.textContent = 'Record';
                recordBtn.classList.remove('recording-scheduled');
                recordBtn.dataset.timerId = '';
                recordBtn.dataset.isScheduled = 'false';
            }
        });
    }
    
    // Close popup
    function closePopup() {
        document.getElementById('programDetailPopup').style.display = 'none';
        // Return focus to guide
        if (focusedElement) {
            focusedElement.focus();
        }
    }
    
    // Focus first visible popup button
    function focusFirstPopupButton() {
        const buttons = getVisiblePopupButtons();
        if (buttons.length > 0) {
            buttons[0].focus();
            buttons[0].classList.add('popup-btn-focused');
        }
    }
    
    // Get visible popup buttons
    function getVisiblePopupButtons() {
        const allButtons = [
            document.getElementById('popupWatchBtn'),
            document.getElementById('popupRecordBtn'),
            document.getElementById('popupFavoriteBtn'),
            document.getElementById('popupCloseBtn')
        ];
        return allButtons.filter(btn => btn && btn.style.display !== 'none');
    }
    
    // Handle popup navigation
    function handlePopupNavigation(keyCode) {
        const buttons = getVisiblePopupButtons();
        if (buttons.length === 0) return;
        
        // Find currently focused button
        let currentIndex = buttons.findIndex(btn => document.activeElement === btn || btn.classList.contains('popup-btn-focused'));
        if (currentIndex === -1) currentIndex = 0;
        
        // Remove focus class from all buttons
        buttons.forEach(btn => btn.classList.remove('popup-btn-focused'));
        
        // Navigate based on key
        if (keyCode === KeyCodes.LEFT || keyCode === KeyCodes.UP) {
            currentIndex = (currentIndex - 1 + buttons.length) % buttons.length;
        } else if (keyCode === KeyCodes.RIGHT || keyCode === KeyCodes.DOWN) {
            currentIndex = (currentIndex + 1) % buttons.length;
        }
        
        // Focus new button
        buttons[currentIndex].focus();
        buttons[currentIndex].classList.add('popup-btn-focused');
    }
    
    // Handle OK/Enter on popup
    function handlePopupOK() {
        const focused = document.activeElement;
        if (focused && focused.tagName === 'BUTTON') {
            focused.click();
        }
    }
    
    // Handle watch program
    function handleWatchProgram() {
        const channelId = document.getElementById('popupWatchBtn').dataset.channelId;
        if (channelId) {
            window.location.href = 'player.html?id=' + channelId + '&mediaType=livetv';
        }
    }
    
    // Handle record program
    function handleRecordProgram() {
        const recordBtn = document.getElementById('popupRecordBtn');
        const programId = recordBtn.dataset.programId;
        const isScheduled = recordBtn.dataset.isScheduled === 'true';
        const timerId = recordBtn.dataset.timerId;
        
        if (!programId) return;
        
        // Disable button while processing
        recordBtn.disabled = true;
        const originalText = recordBtn.textContent;
        recordBtn.textContent = 'Processing...';
        
        if (isScheduled && timerId) {
            // Cancel recording
            JellyfinAPI.cancelRecordingTimer(timerId, (err, result) => {
                recordBtn.disabled = false;
                
                if (err) {
                    console.error('Failed to cancel recording:', err);
                    recordBtn.textContent = originalText;
                    showNotification('Failed to cancel recording', 'error');
                    return;
                }
                
                recordBtn.textContent = 'Record';
                recordBtn.classList.remove('recording-scheduled');
                recordBtn.dataset.timerId = '';
                recordBtn.dataset.isScheduled = 'false';
                showNotification('Recording canceled', 'success');
            });
        } else {
            // Get full program details first to create proper timer
            JellyfinAPI.getProgram(programId, (err, program) => {
                if (err || !program) {
                    recordBtn.disabled = false;
                    recordBtn.textContent = originalText;
                    showNotification('Failed to get program details', 'error');
                    return;
                }
                
                // Create recording with full program data
                JellyfinAPI.createRecordingTimer(program, (err, result) => {
                    recordBtn.disabled = false;
                    
                    if (err) {
                        console.error('Failed to schedule recording:', err);
                        recordBtn.textContent = originalText;
                        showNotification('Failed to schedule recording', 'error');
                        return;
                    }
                    
                    console.log('Recording created, result:', result);
                    
                    // Update button state
                    recordBtn.textContent = 'Cancel Recording';
                    recordBtn.classList.add('recording-scheduled');
                    recordBtn.dataset.isScheduled = 'true';
                    
                    // Set timerId from result or fetch from server
                    if (result && result.Id) {
                        recordBtn.dataset.timerId = result.Id;
                        showNotification('Recording scheduled', 'success');
                    } else {
                        // Fetch timer list to get the newly created timer ID
                        checkRecordingStatus(program, recordBtn);
                        showNotification('Recording scheduled', 'success');
                    }
                });
            });
        }
    }
    
    // Handle favorite/unfavorite channel
    function handleFavoriteChannel() {
        const favoriteBtn = document.getElementById('popupFavoriteBtn');
        const channelId = favoriteBtn.dataset.channelId;
        const isFavorited = favoriteBtn.dataset.isFavorited === 'true';
        
        if (!channelId) return;
        
        // Disable button while processing
        favoriteBtn.disabled = true;
        
        if (isFavorited) {
            // Remove from favorites
            JellyfinAPI.unfavoriteItem(channelId, (err, result) => {
                favoriteBtn.disabled = false;
                
                if (err) {
                    console.error('Failed to remove from favorites:', err);
                    showNotification('Failed to remove from favorites', 'error');
                    return;
                }
                
                favoriteBtn.textContent = 'Add channel to Favorites';
                favoriteBtn.classList.remove('channel-favorited');
                favoriteBtn.dataset.isFavorited = 'false';
                showNotification('Removed from favorites', 'success');
            });
        } else {
            // Add to favorites
            JellyfinAPI.favoriteItem(channelId, (err, result) => {
                favoriteBtn.disabled = false;
                
                if (err) {
                    console.error('Failed to add to favorites:', err);
                    showNotification('Failed to add to favorites', 'error');
                    return;
                }
                
                favoriteBtn.textContent = 'Remove channel from Favorites';
                favoriteBtn.classList.add('channel-favorited');
                favoriteBtn.dataset.isFavorited = 'true';
                showNotification('Added to favorites', 'success');
            });
        }
    }
    
    // Check if channel is favorited
    function checkChannelFavoriteStatus(channelId, favoriteBtn) {
        JellyfinAPI.getItem(channelId, (err, channel) => {
            if (err || !channel) return;
            
            if (channel.UserData && channel.UserData.IsFavorite) {
                favoriteBtn.textContent = 'Remove channel from Favorites';
                favoriteBtn.classList.add('channel-favorited');
                favoriteBtn.dataset.isFavorited = 'true';
            } else {
                favoriteBtn.textContent = 'Add channel to Favorites';
                favoriteBtn.classList.remove('channel-favorited');
                favoriteBtn.dataset.isFavorited = 'false';
            }
        });
    }
    
    // Show notification
    function showNotification(message, type) {
        let notification = document.getElementById('notification');
        if (!notification) {
            notification = document.createElement('div');
            notification.id = 'notification';
            notification.style.cssText = 'position: fixed; top: 100px; left: 50%; transform: translateX(-50%); ' +
                'padding: 15px 30px; border-radius: 8px; font-size: 18px; z-index: 9999; ' +
                'animation: slideDown 0.3s ease-out;';
            document.body.appendChild(notification);
        }
        
        notification.textContent = message;
        notification.style.background = type === 'error' ? 
            'linear-gradient(135deg, #dc3545, #c82333)' : 
            'linear-gradient(135deg, #28a745, #218838)';
        notification.style.display = 'block';
        
        setTimeout(() => {
            notification.style.display = 'none';
        }, 3000);
    }
    
    // Show/hide loading indicator
    function showLoading(show) {
        document.getElementById('loadingIndicator').style.display = show ? 'block' : 'none';
    }
    
    // Update current time indicator periodically
    setInterval(() => {
        renderCurrentTimeIndicator();
    }, 60000); // Update every minute
    
})();
