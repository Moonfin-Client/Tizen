var DetailsController = (function () {
   /**
    * Theme music URL for the current item
    * @type {string|null}
    */
   var themeMusicUrl = null;
   ("use strict");

   let auth = null;
   let itemId = null;
   let serverId = null;
   let itemData = null;
   const focusManager = {
      currentSection: "buttons",
      currentIndex: 0,
      inNavBar: false,
      navBarIndex: 0,
      sections: [
         "buttons",
         "nextup",
         "seasons",
         "episodes",
         "remainingepisodes",
         "cast",
         "similar",
      ],
   };
   let modalFocusableItems = [];
   let currentModalFocusIndex = 0;
   let activeModal = null;

   let elements = {};

   const FOCUS_DELAY_MS = 100;

   /**
    * Initialize the details controller
    * Authenticates, loads item details, and sets up navigation
    */
   function init() {
      // Check for serverId in URL params
      var params = new URLSearchParams(window.location.search);
      serverId = params.get("serverId");

      // Get auth for the specific server if serverId is provided
      auth =
         typeof MultiServerManager !== "undefined"
            ? MultiServerManager.getAuthForPage()
            : JellyfinAPI.getStoredAuth();

      if (!auth) {
         window.location.href = "login.html";
         return;
      }

      // Check if this is a Jellyseerr item
      var source = params.get("source");
      var type = params.get("type");
      var id = params.get("id");

      if (source === "jellyseerr" && id && type) {
         // Redirect to Jellyseerr details page
         var mediaType = type.toLowerCase() === "movie" ? "movie" : "tv";
         window.location.href =
            "jellyseerr-details.html?type=" + mediaType + "&id=" + id;
         return;
      }

      itemId = getItemIdFromUrl();
      if (!itemId) {
         showError("No item specified");
         return;
      }

      cacheElements();
      storage.applyBackdropBlur(
         document.querySelector(".backdrop-image"),
         "backdropBlurDetail",
         15
      );
      setupNavigation();
      loadItemDetails();
   }

   /**
    * Extract item ID from URL query parameter
    * @returns {string|null} Item ID or null if not found
    * @private
    */
   function getItemIdFromUrl() {
      var params = new URLSearchParams(window.location.search);
      return params.get("id");
   }

   /**
    * Cache frequently accessed DOM elements for better performance
    * @private
    */
   function cacheElements() {
      elements = {
         backdropImage: document.getElementById("backdropImage"),
         logoImage: document.getElementById("logoImage"),
         posterImage: document.getElementById("posterImage"),
         personContent: document.getElementById("personContent"),
         personPhoto: document.getElementById("personPhoto"),
         personOverview: document.getElementById("personOverview"),
         itemTitle: document.getElementById("itemTitle"),
         itemYear: document.getElementById("itemYear"),
         officialRating: document.getElementById("officialRating"),
         itemRuntime: document.getElementById("itemRuntime"),
         runtimeValue: document.getElementById("runtimeValue"),
         itemGenres: document.getElementById("itemGenres"),
         itemTagline: document.getElementById("itemTagline"),
         taglineRow: document.getElementById("taglineRow"),
         itemDirector: document.getElementById("itemDirector"),
         directorCell: document.getElementById("directorCell"),
         itemWriters: document.getElementById("itemWriters"),
         writersCell: document.getElementById("writersCell"),
         itemStudios: document.getElementById("itemStudios"),
         studiosCell: document.getElementById("studiosCell"),
         genresCell: document.getElementById("genresCell"),
         itemResolution: document.getElementById("itemResolution"),
         videoCodec: document.getElementById("videoCodec"),
         audioCodec: document.getElementById("audioCodec"),
         subtitles: document.getElementById("subtitles"),
         communityRating: document.getElementById("communityRating"),
         ratingValue: document.getElementById("ratingValue"),
         criticRating: document.getElementById("criticRating"),
         criticIcon: document.getElementById("criticIcon"),
         criticValue: document.getElementById("criticValue"),
         itemOverview: document.getElementById("itemOverview"),
         playBtn: document.getElementById("playBtn"),
         playBtnWrapper: document.getElementById("playBtnWrapper"),
         playBtnImage: document.querySelector("#playBtn img"),
         playBtnLabel: document.querySelector("#playBtnWrapper .btn-label"),
         resumeBtn: document.getElementById("resumeBtn"),
         resumeBtnWrapper: document.getElementById("resumeBtnWrapper"),
         resumeBtnLabel: document.querySelector("#resumeBtnWrapper .btn-label"),
         shuffleBtn: document.getElementById("shuffleBtn"),
         shuffleBtnWrapper: document.getElementById("shuffleBtnWrapper"),
         trailerBtn: document.getElementById("trailerBtn"),
         trailerBtnWrapper: document.getElementById("trailerBtnWrapper"),
         favoriteBtn: document.getElementById("favoriteBtn"),
         favoriteIcon: document.getElementById("favoriteIcon"),
         markPlayedBtn: document.getElementById("markPlayedBtn"),
         playedText: document.getElementById("playedText"),
         audioBtn: document.getElementById("audioBtn"),
         audioBtnWrapper: document.getElementById("audioBtnWrapper"),
         subtitleBtn: document.getElementById("subtitleBtn"),
         subtitleBtnWrapper: document.getElementById("subtitleBtnWrapper"),
         moreBtn: document.getElementById("moreBtn"),
         moreBtnWrapper: document.getElementById("moreBtnWrapper"),
         nextUpSection: document.getElementById("nextUpSection"),
         nextUpList: document.getElementById("nextUpList"),
         castSection: document.getElementById("castSection"),
         castList: document.getElementById("castList"),
         seasonsSection: document.getElementById("seasonsSection"),
         seasonsList: document.getElementById("seasonsList"),
         episodesSection: document.getElementById("episodesSection"),
         episodesList: document.getElementById("episodesList"),
         remainingEpisodesSection: document.getElementById(
            "remainingEpisodesSection"
         ),
         remainingEpisodesList: document.getElementById(
            "remainingEpisodesList"
         ),
         similarSection: document.getElementById("similarSection"),
         similarList: document.getElementById("similarList"),
         extrasSection: document.getElementById("extrasSection"),
         extrasList: document.getElementById("extrasList"),
         technicalSection: document.getElementById("technicalSection"),
         loadingIndicator: document.getElementById("loadingIndicator"),
         errorDisplay: document.getElementById("errorDisplay"),
         errorText: document.getElementById("errorText"),
         backBtn: document.getElementById("backBtn"),
         audioModal: document.getElementById("audioModal"),
         audioTrackList: document.getElementById("audioTrackList"),
         subtitleModal: document.getElementById("subtitleModal"),
         subtitleTrackList: document.getElementById("subtitleTrackList"),
         detailsContainer: document.querySelector(".details-container"),
         // Jellyseerr elements
         requestStatus: document.getElementById("requestStatus"),
         requestStatusIcon: document.getElementById("requestStatusIcon"),
         requestStatusText: document.getElementById("requestStatusText"),
         requestBtn: document.getElementById("requestBtn"),
         requestBtnWrapper: document.getElementById("requestBtnWrapper"),
         deleteRequestBtn: document.getElementById("deleteRequestBtn"),
         deleteRequestBtnWrapper: document.getElementById(
            "deleteRequestBtnWrapper"
         ),
         goToSeriesBtn: document.getElementById("goToSeriesBtn"),
         goToSeriesBtnWrapper: document.getElementById("goToSeriesBtnWrapper"),
         deleteRequestBtn: document.getElementById("deleteRequestBtn"),
         deleteRequestBtnWrapper: document.getElementById(
            "deleteRequestBtnWrapper"
         ),
         seasonSelectorModal: document.getElementById("seasonSelectorModal"),
         allSeasonsBtn: document.getElementById("allSeasonsBtn"),
         firstSeasonBtn: document.getElementById("firstSeasonBtn"),
         latestSeasonBtn: document.getElementById("latestSeasonBtn"),
         seasonCheckboxList: document.getElementById("seasonCheckboxList"),
         confirmRequestBtn: document.getElementById("confirmRequestBtn"),
         cancelRequestBtn: document.getElementById("cancelRequestBtn"),
      };
   }

   /**
    * Set up keyboard and click event listeners for navigation
    * @private
    */
   function setupNavigation() {
      if (elements.playBtn) {
         elements.playBtn.addEventListener("click", handlePlay);
      }
      if (elements.resumeBtn) {
         elements.resumeBtn.addEventListener("click", handleResume);
      }
      if (elements.shuffleBtn) {
         elements.shuffleBtn.addEventListener("click", handleShuffle);
      }
      if (elements.trailerBtn) {
         elements.trailerBtn.addEventListener("click", handleTrailer);
      }
      if (elements.favoriteBtn) {
         elements.favoriteBtn.addEventListener("click", handleFavorite);
      }
      if (elements.markPlayedBtn) {
         elements.markPlayedBtn.addEventListener("click", handleMarkPlayed);
      }
      if (elements.audioBtn) {
         elements.audioBtn.addEventListener("click", handleAudio);
      }
      if (elements.subtitleBtn) {
         elements.subtitleBtn.addEventListener("click", handleSubtitles);
      }
      if (elements.moreBtn) {
         elements.moreBtn.addEventListener("click", handleMore);
      }
      if (elements.goToSeriesBtn) {
         elements.goToSeriesBtn.addEventListener("click", handleGoToSeries);
      }
      if (elements.backBtn) {
         elements.backBtn.addEventListener("click", goBack);
      }

      document.addEventListener("keydown", handleKeyDown);
   }

   /**
    * Handle keyboard navigation in details view
    * @param {KeyboardEvent} evt - Keyboard event
    * @private
    */
   function handleKeyDown(evt) {
      evt = evt || window.event;

      // Handle modal navigation separately
      if (activeModal) {
         handleModalKeyDown(evt);
         return;
      }

      // Handle navbar navigation
      if (focusManager.inNavBar) {
         handleNavBarNavigation(evt);
         return;
      }

      if (evt.keyCode === KeyCodes.BACK || evt.keyCode === KeyCodes.ESCAPE) {
         goBack();
         return;
      }

      var currentItems = getCurrentSectionItems();
      if (!currentItems || currentItems.length === 0) return;

      switch (evt.keyCode) {
         case KeyCodes.LEFT:
            evt.preventDefault();
            if (focusManager.currentIndex > 0) {
               focusManager.currentIndex--;
               currentItems[focusManager.currentIndex].focus();
            }
            break;

         case KeyCodes.RIGHT:
            evt.preventDefault();
            if (focusManager.currentIndex < currentItems.length - 1) {
               focusManager.currentIndex++;
               currentItems[focusManager.currentIndex].focus();
            }
            break;

         case KeyCodes.UP:
            evt.preventDefault();
            // If at top section (buttons), go to navbar
            if (focusManager.currentSection === "buttons") {
               focusToNavBar();
            } else {
               moveToPreviousSection();
            }
            break;

         case KeyCodes.DOWN:
            evt.preventDefault();
            moveToNextSection();
            break;

         case KeyCodes.ENTER:
            evt.preventDefault();
            if (currentItems[focusManager.currentIndex]) {
               currentItems[focusManager.currentIndex].click();
            }
            break;
      }
   }

   function handleModalKeyDown(evt) {
      currentModalFocusIndex = TrackSelector.handleModalKeyDown(
         evt,
         modalFocusableItems,
         currentModalFocusIndex,
         closeModal
      );
   }

   function getCurrentSectionItems() {
      switch (focusManager.currentSection) {
         case "buttons":
            return Array.from(
               document.querySelectorAll(".action-buttons .btn-action")
            ).filter(function (btn) {
               var wrapper = btn.closest(".btn-wrapper");
               return !wrapper || wrapper.style.display !== "none";
            });
         case "nextup":
            if (elements.nextUpSection.style.display === "block") {
               return Array.from(
                  elements.nextUpList.querySelectorAll(".nextup-card")
               );
            }
            return [];
         case "seasons":
            if (elements.seasonsSection.style.display === "block") {
               return Array.from(
                  elements.seasonsList.querySelectorAll(".season-card")
               );
            }
            return [];
         case "episodes":
            if (elements.episodesSection.style.display === "block") {
               return Array.from(
                  elements.episodesList.querySelectorAll(".episode-card")
               );
            }
            return [];
         case "remainingepisodes":
            if (elements.remainingEpisodesSection.style.display === "block") {
               return Array.from(
                  elements.remainingEpisodesList.querySelectorAll(
                     ".episode-card"
                  )
               );
            }
            return [];
         case "cast":
            if (elements.castSection.style.display === "block") {
               return Array.from(
                  elements.castList.querySelectorAll(".cast-card")
               );
            }
            return [];
         case "collection":
            if (elements.collectionSection.style.display === "block") {
               return Array.from(
                  elements.collectionList.querySelectorAll(".collection-card")
               );
            }
            return [];
         case "similar":
            if (elements.similarSection.style.display === "block") {
               return Array.from(
                  elements.similarList.querySelectorAll(".similar-card")
               );
            }
            return [];
         default:
            return [];
      }
   }

   function moveToNextSection() {
      var currentSectionIndex = focusManager.sections.indexOf(
         focusManager.currentSection
      );

      for (
         var i = currentSectionIndex + 1;
         i < focusManager.sections.length;
         i++
      ) {
         focusManager.currentSection = focusManager.sections[i];
         var items = getCurrentSectionItems();
         if (items && items.length > 0) {
            focusManager.currentIndex = 0;
            items[0].focus();
            return;
         }
      }
   }

   function moveToPreviousSection() {
      var currentSectionIndex = focusManager.sections.indexOf(
         focusManager.currentSection
      );

      for (var i = currentSectionIndex - 1; i >= 0; i--) {
         focusManager.currentSection = focusManager.sections[i];
         var items = getCurrentSectionItems();
         if (items && items.length > 0) {
            focusManager.currentIndex = 0;
            items[0].focus();
            return;
         }
      }
   }

   /**
    * Move focus to the navigation bar
    * @private
    */
   function focusToNavBar() {
      focusManager.inNavBar = true;
      var navButtons = Array.from(
         document.querySelectorAll(".nav-left .nav-btn, .nav-center .nav-btn")
      ).filter(function (btn) {
         return btn.offsetParent !== null;
      });
      if (navButtons.length > 0) {
         focusManager.navBarIndex = Math.min(
            focusManager.navBarIndex,
            navButtons.length - 1
         );
         navButtons[focusManager.navBarIndex].classList.add("focused");
         navButtons[focusManager.navBarIndex].focus();
         if (
            typeof NavbarController !== "undefined" &&
            NavbarController.scrollNavButtonIntoView
         ) {
            NavbarController.scrollNavButtonIntoView(
               navButtons[focusManager.navBarIndex]
            );
         }
      }
   }

   /**
    * Handle keyboard navigation within navbar
    * @param {KeyboardEvent} evt - Keyboard event
    * @private
    */
   function handleNavBarNavigation(evt) {
      var navButtons = Array.from(
         document.querySelectorAll(".nav-left .nav-btn, .nav-center .nav-btn")
      ).filter(function (btn) {
         return btn.offsetParent !== null;
      });

      navButtons.forEach(function (btn) {
         btn.classList.remove("focused");
      });

      switch (evt.keyCode) {
         case KeyCodes.LEFT:
            evt.preventDefault();
            if (focusManager.navBarIndex > 0) {
               focusManager.navBarIndex--;
            }
            navButtons[focusManager.navBarIndex].classList.add("focused");
            navButtons[focusManager.navBarIndex].focus();
            if (
               typeof NavbarController !== "undefined" &&
               NavbarController.scrollNavButtonIntoView
            ) {
               NavbarController.scrollNavButtonIntoView(
                  navButtons[focusManager.navBarIndex]
               );
            }
            break;

         case KeyCodes.RIGHT:
            evt.preventDefault();
            if (focusManager.navBarIndex < navButtons.length - 1) {
               focusManager.navBarIndex++;
            }
            navButtons[focusManager.navBarIndex].classList.add("focused");
            navButtons[focusManager.navBarIndex].focus();
            if (
               typeof NavbarController !== "undefined" &&
               NavbarController.scrollNavButtonIntoView
            ) {
               NavbarController.scrollNavButtonIntoView(
                  navButtons[focusManager.navBarIndex]
               );
            }
            break;

         case KeyCodes.DOWN:
            evt.preventDefault();
            focusManager.inNavBar = false;
            focusManager.currentSection = "buttons";
            var items = getCurrentSectionItems();
            if (items && items.length > 0) {
               focusManager.currentIndex = 0;
               items[0].focus();
            }
            break;

         case KeyCodes.ENTER:
            evt.preventDefault();
            var currentBtn = navButtons[focusManager.navBarIndex];
            if (currentBtn && currentBtn.style.display !== "none") {
               currentBtn.click();
            }
            break;

         case KeyCodes.BACK:
         case KeyCodes.ESCAPE:
            evt.preventDefault();
            goBack();
            break;
      }
   }

   /**
    * Load item details from Jellyfin server
    * Fetches complete item metadata and displays it
    * @private
    */
   function loadItemDetails() {
      showLoading();

      var params = {
         userId: auth.userId,
         fields:
            "Overview,Genres,People,Studios,Taglines,CommunityRating,CriticRating,OfficialRating,ProductionYear,RunTimeTicks,MediaStreams,Path,ProviderIds",
         _: new Date().getTime(), // Cache-busting timestamp
      };

      var endpoint = "/Users/" + auth.userId + "/Items/" + itemId;

      JellyfinAPI.getItems(
         auth.serverAddress,
         auth.accessToken,
         endpoint,
         params,
         function (err, data) {
            hideLoading();

            if (err) {
               showError("Failed to load item details");
               return;
            }

            if (!data) {
               showError("Failed to load item details");
               return;
            }

            itemData = data;

            try {
               displayItemDetails();
               loadAdditionalContent();

               // Load Jellyseerr data if enabled
               initializeJellyseerr();
               loadJellyseerrData();
            } catch (displayError) {
               showError("Failed to display item details");
            }
         }
      );
   }

   /**
    * Display item details in the UI
    * Populates all metadata fields and action buttons
    * @private
    */
   function displayItemDetails() {
      // Play theme music if available and enabled
      if (
         typeof ThemeMusicPlayer !== "undefined" &&
         ThemeMusicPlayer.isEnabled()
      ) {
         themeMusicUrl = null;
         if (itemData) {
            if (itemData.ThemeSongId && auth && auth.serverAddress) {
               themeMusicUrl =
                  auth.serverAddress +
                  "/Audio/" +
                  itemData.ThemeSongId +
                  "/stream?static=true&api_key=" +
                  auth.accessToken;
            } else if (itemData.ThemeSongUrl) {
               themeMusicUrl = itemData.ThemeSongUrl;
            }
         }
         if (themeMusicUrl) {
            ThemeMusicPlayer.play(themeMusicUrl);
         } else {
            ThemeMusicPlayer.stop();
         }
      }
      // Check if this is a Person type (actor, director, etc.)
      if (itemData.Type === "Person") {
         displayPersonDetails();
         return;
      }

      // Hide action buttons for BoxSet/Collection types
      if (itemData.Type === "BoxSet") {
         var actionButtons = document.querySelector(".action-buttons");
         if (actionButtons) {
            actionButtons.style.display = "none";
         }
      }

      // Ensure critical elements exist
      if (!elements.itemTitle || !elements.itemOverview) {
         cacheElements();
         // If still null after recaching, abort
         if (!elements.itemTitle) {
            return;
         }
      }

      elements.itemTitle.textContent = itemData.Name;
      if (
         itemData.CommunityRating &&
         elements.communityRating &&
         elements.ratingValue
      ) {
         elements.communityRating.style.display = "inline-flex";
         elements.ratingValue.textContent = itemData.CommunityRating.toFixed(1);
      }

      if (
         itemData.CriticRating &&
         elements.criticRating &&
         elements.criticIcon &&
         elements.criticValue
      ) {
         elements.criticRating.style.display = "inline-flex";
         var rating = itemData.CriticRating;
         if (rating >= 60) {
            elements.criticIcon.textContent = "🍅";
         } else {
            elements.criticIcon.textContent = "🍅";
         }
         elements.criticValue.textContent = rating + "%";
      }

      if (itemData.ProductionYear && elements.itemYear) {
         elements.itemYear.textContent = itemData.ProductionYear;
         elements.itemYear.style.display = "inline-flex";
      }

      if (itemData.OfficialRating && elements.officialRating) {
         elements.officialRating.textContent = itemData.OfficialRating;
         elements.officialRating.style.display = "inline-flex";
      }

      if (
         itemData.RunTimeTicks &&
         elements.itemRuntime &&
         elements.runtimeValue
      ) {
         var minutes = Math.round(itemData.RunTimeTicks / 600000000);
         var hours = Math.floor(minutes / 60);
         var mins = minutes % 60;
         var runtimeText = hours > 0 ? hours + "h " + mins + "m" : mins + "m";
         elements.runtimeValue.textContent = runtimeText;
         elements.itemRuntime.style.display = "inline-flex";
      }

      if (itemData.MediaSources && itemData.MediaSources.length > 0) {
         var mediaSource = itemData.MediaSources[0];

         if (mediaSource.MediaStreams) {
            var videoStream = mediaSource.MediaStreams.find(function (s) {
               return s.Type === "Video";
            });
            if (
               videoStream &&
               videoStream.Width &&
               videoStream.Height &&
               elements.itemResolution
            ) {
               var resolution = getResolutionName(
                  videoStream.Width,
                  videoStream.Height
               );
               elements.itemResolution.textContent = resolution;
               elements.itemResolution.style.display = "inline-flex";
            }

            if (videoStream && videoStream.Codec && elements.videoCodec) {
               var codec = videoStream.Codec.toUpperCase();
               if (
                  videoStream.VideoRangeType &&
                  videoStream.VideoRangeType !== "SDR"
               ) {
                  codec = videoStream.VideoRangeType.toUpperCase();
               }
               elements.videoCodec.textContent = codec;
               elements.videoCodec.style.display = "inline-flex";
            }

            var audioStream = mediaSource.MediaStreams.find(function (s) {
               return s.Type === "Audio";
            });
            if (audioStream && audioStream.Codec && elements.audioCodec) {
               var audioCodec = audioStream.Codec.toUpperCase();
               if (
                  audioStream.Profile &&
                  audioStream.Profile.indexOf("Atmos") > -1
               ) {
                  audioCodec = "ATMOS";
               }
               elements.audioCodec.textContent = audioCodec;
               elements.audioCodec.style.display = "inline-flex";
            }

            if (elements.subtitles) {
               var hasSubtitles = mediaSource.MediaStreams.some(function (s) {
                  return s.Type === "Subtitle";
               });
               if (hasSubtitles) {
                  elements.subtitles.style.display = "inline-flex";
               }
            }
         }
      }

      if (
         itemData.Genres &&
         itemData.Genres.length > 0 &&
         elements.itemGenres &&
         elements.genresCell
      ) {
         elements.itemGenres.textContent = itemData.Genres.slice(0, 3).join(
            ", "
         );
         elements.genresCell.style.display = "flex";
      }

      if (
         itemData.Taglines &&
         itemData.Taglines.length > 0 &&
         elements.itemTagline &&
         elements.taglineRow
      ) {
         elements.itemTagline.textContent = itemData.Taglines[0];
         elements.taglineRow.style.display = "block";
      }

      if (itemData.People && itemData.People.length > 0) {
         var directors = itemData.People.filter(function (p) {
            return p.Type === "Director";
         });
         if (
            directors.length > 0 &&
            elements.itemDirector &&
            elements.directorCell
         ) {
            elements.itemDirector.textContent = directors
               .map(function (d) {
                  return d.Name;
               })
               .join(", ");
            elements.directorCell.style.display = "flex";
         }

         var writers = itemData.People.filter(function (p) {
            return p.Type === "Writer";
         });
         if (
            writers.length > 0 &&
            elements.itemWriters &&
            elements.writersCell
         ) {
            elements.itemWriters.textContent = writers
               .map(function (w) {
                  return w.Name;
               })
               .join(", ");
            elements.writersCell.style.display = "flex";
         }
      }

      if (
         itemData.Studios &&
         itemData.Studios.length > 0 &&
         elements.itemStudios &&
         elements.studiosCell
      ) {
         elements.itemStudios.textContent = itemData.Studios.map(function (s) {
            return s.Name;
         }).join(", ");
         elements.studiosCell.style.display = "flex";
      }

      if (itemData.Overview && elements.itemOverview) {
         elements.itemOverview.textContent = itemData.Overview;
      }

      if (elements.logoImage) {
         if (itemData.ImageTags && itemData.ImageTags.Logo) {
            elements.logoImage.src =
               auth.serverAddress +
               "/Items/" +
               itemData.Id +
               "/Images/Logo?quality=90&maxWidth=600";
            elements.logoImage.style.display = "block";
         } else if (itemData.ParentLogoImageTag && itemData.ParentLogoItemId) {
            elements.logoImage.src =
               auth.serverAddress +
               "/Items/" +
               itemData.ParentLogoItemId +
               "/Images/Logo?quality=90&maxWidth=600&tag=" +
               itemData.ParentLogoImageTag;
            elements.logoImage.style.display = "block";
         } else {
            elements.logoImage.style.display = "none";
         }
      }

      if (elements.backdropImage) {
         if (
            itemData.BackdropImageTags &&
            itemData.BackdropImageTags.length > 0
         ) {
            elements.backdropImage.src =
               auth.serverAddress +
               "/Items/" +
               itemData.Id +
               "/Images/Backdrop/0?quality=90&maxWidth=1920";
         } else if (
            itemData.ParentBackdropImageTags &&
            itemData.ParentBackdropImageTags.length > 0
         ) {
            elements.backdropImage.src =
               auth.serverAddress +
               "/Items/" +
               itemData.ParentBackdropItemId +
               "/Images/Backdrop/0?quality=90&maxWidth=1920";
         }

         // Reapply blur settings
         storage.applyBackdropBlur(
            elements.backdropImage,
            "backdropBlurDetail",
            15
         );
      }

      if (itemData.UserData) {
         if (elements.favoriteIcon) {
            if (itemData.UserData.IsFavorite) {
               elements.favoriteIcon.classList.add("favorited");
            } else {
               elements.favoriteIcon.classList.remove("favorited");
            }
         }

         if (elements.playedText && itemData.UserData.Played) {
            elements.playedText.textContent = "Mark Unplayed";
         }

         console.log("[Details] UserData:", itemData.UserData);
         console.log(
            "[Details] PlaybackPositionTicks:",
            itemData.UserData.PlaybackPositionTicks
         );

         if (itemData.UserData.PlaybackPositionTicks > 0) {
            var minutes = Math.round(
               itemData.UserData.PlaybackPositionTicks / 600000000
            );
            var hours = Math.floor(minutes / 60);
            var mins = minutes % 60;
            var timeText = hours > 0 ? hours + "h " + mins + "m" : mins + "m";

            if (elements.playBtnImage && elements.playBtnLabel) {
               elements.playBtnImage.src = "assets/restart.png";
               elements.playBtnLabel.textContent = "Play from beginning";
            }

            if (elements.resumeBtnWrapper && elements.resumeBtnLabel) {
               elements.resumeBtnWrapper.style.display = "flex";
               elements.resumeBtnLabel.textContent = "Resume from " + timeText;

               var actionButtons = elements.resumeBtnWrapper.parentElement;
               if (actionButtons && elements.playBtnWrapper) {
                  actionButtons.insertBefore(
                     elements.resumeBtnWrapper,
                     elements.playBtnWrapper
                  );
               }
            }
         } else {
            if (elements.playBtnImage && elements.playBtnLabel) {
               elements.playBtnImage.src = "assets/play.png";
               elements.playBtnLabel.textContent = "Play";
            }
            if (elements.resumeBtnWrapper) {
               elements.resumeBtnWrapper.style.display = "none";
            }
         }
      }

      if (
         itemData.LocalTrailerCount > 0 ||
         (itemData.RemoteTrailers && itemData.RemoteTrailers.length > 0)
      ) {
         if (elements.trailerBtnWrapper) {
            elements.trailerBtnWrapper.style.display = "flex";
         }
      }

      // Show shuffle button for containers (except BoxSet which has buttons hidden)
      if (
         itemData.Type === "Series" ||
         itemData.Type === "Season" ||
         itemData.Type === "Playlist" ||
         itemData.Type === "Folder" ||
         itemData.Type === "CollectionFolder"
      ) {
         if (elements.shuffleBtnWrapper) {
            elements.shuffleBtnWrapper.style.display = "flex";
         }
      }

      if (itemData.MediaSources && itemData.MediaSources.length > 0) {
         var mediaSource = itemData.MediaSources[0];
         if (mediaSource.MediaStreams) {
            var audioStreams = mediaSource.MediaStreams.filter(function (s) {
               return s.Type === "Audio";
            });
            if (audioStreams.length > 1 && elements.audioBtnWrapper) {
               elements.audioBtnWrapper.style.display = "flex";
            }

            var subtitleStreams = mediaSource.MediaStreams.filter(function (s) {
               return s.Type === "Subtitle";
            });
            if (subtitleStreams.length > 0 && elements.subtitleBtnWrapper) {
               elements.subtitleBtnWrapper.style.display = "flex";
            }
         }
      }

      // Show "Go to Series" button for episodes
      if (
         itemData.Type === "Episode" &&
         itemData.SeriesId &&
         elements.goToSeriesBtnWrapper
      ) {
         elements.goToSeriesBtnWrapper.style.display = "flex";
      }

      setTimeout(function () {
         var firstBtn = document.querySelector(".action-buttons .btn-action");
         if (firstBtn) {
            firstBtn.focus();
         }
      }, FOCUS_DELAY_MS);
   }

   function displayPersonDetails() {
      if (elements.itemTitle) {
         elements.itemTitle.textContent = itemData.Name;
      }

      if (elements.itemYear) elements.itemYear.style.display = "none";
      if (elements.officialRating)
         elements.officialRating.style.display = "none";
      if (elements.itemRuntime) elements.itemRuntime.style.display = "none";
      if (elements.itemResolution)
         elements.itemResolution.style.display = "none";
      if (elements.videoCodec) elements.videoCodec.style.display = "none";
      if (elements.audioCodec) elements.audioCodec.style.display = "none";
      if (elements.subtitles) elements.subtitles.style.display = "none";
      if (elements.communityRating)
         elements.communityRating.style.display = "none";
      if (elements.criticRating) elements.criticRating.style.display = "none";

      if (elements.personContent) {
         if (
            itemData.ImageTags &&
            itemData.ImageTags.Primary &&
            elements.personPhoto
         ) {
            elements.personPhoto.src =
               auth.serverAddress +
               "/Items/" +
               itemData.Id +
               "/Images/Primary?quality=90&maxHeight=450";
         }
         if (itemData.Overview && elements.personOverview) {
            elements.personOverview.textContent = itemData.Overview;
         }
         elements.personContent.style.display = "flex";
      }

      if (elements.playBtnWrapper)
         elements.playBtnWrapper.style.display = "none";
      if (elements.resumeBtnWrapper)
         elements.resumeBtnWrapper.style.display = "none";
      if (elements.shuffleBtnWrapper)
         elements.shuffleBtnWrapper.style.display = "none";
      if (elements.trailerBtnWrapper)
         elements.trailerBtnWrapper.style.display = "none";
      if (
         elements.markPlayedBtn &&
         elements.markPlayedBtn.closest(".btn-wrapper")
      ) {
         elements.markPlayedBtn.closest(".btn-wrapper").style.display = "none";
      }
      if (elements.audioBtnWrapper)
         elements.audioBtnWrapper.style.display = "none";
      if (elements.subtitleBtnWrapper)
         elements.subtitleBtnWrapper.style.display = "none";
      if (elements.moreBtnWrapper)
         elements.moreBtnWrapper.style.display = "none";

      if (itemData.UserData && elements.favoriteIcon) {
         if (itemData.UserData.IsFavorite) {
            elements.favoriteIcon.classList.add("favorited");
         } else {
            elements.favoriteIcon.classList.remove("favorited");
         }
      }

      setTimeout(function () {
         if (elements.favoriteBtn) {
            elements.favoriteBtn.focus();
         }
      }, FOCUS_DELAY_MS);

      loadPersonFilmography();
   }

   function getResolutionName(width, height) {
      if (width >= 3800 && height >= 2100) return "4K";
      if (width >= 2500 && height >= 1400) return "1440P";
      if (width >= 1900 && height >= 1000) return "1080P";
      if (width >= 1260 && height >= 700) return "720P";
      if (width >= 1000 && height >= 560) return "576P";
      if (width >= 850 && height >= 460) return "480P";
      return height + "P";
   }

   function loadAdditionalContent() {
      if (itemData.Type === "Person") {
         return;
      }

      if (itemData.Type === "BoxSet" || itemData.Type === "Collection") {
         loadCollectionMovies();
         return;
      }

      if (itemData.Type === "Series") {
         loadNextUp();
         loadSeasons();
      }

      if (itemData.Type === "Season") {
         loadEpisodes();
      }

      if (itemData.Type === "Episode") {
         loadRemainingEpisodes();
      }

      if (itemData.People && itemData.People.length > 0) {
         displayCast(itemData.People);
      }

      loadSimilarItems();
   }

   function loadCollectionMovies() {
      var params = {
         parentId: itemData.Id,
         sortBy: "ProductionYear,SortName",
         sortOrder: "Ascending",
         fields: "PrimaryImageAspectRatio,ProductionYear",
      };

      var endpoint = "/Users/" + auth.userId + "/Items";

      JellyfinAPI.getItems(
         auth.serverAddress,
         auth.accessToken,
         endpoint,
         params,
         function (err, data) {
            if (!err && data && data.Items && data.Items.length > 0) {
               displayCollectionMovies(data.Items);
            }
         }
      );
   }

   function displayCollectionMovies(items) {
      // Reuse the similar section for displaying collection movies
      elements.similarSection.style.display = "block";
      var titleElement =
         elements.similarSection.querySelector(".section-title");
      titleElement.textContent = "Movies in Collection";
      elements.similarList.innerHTML = "";

      items.forEach(function (item) {
         var card = document.createElement("div");
         card.className = "similar-card";
         card.setAttribute("tabindex", "0");

         var img = document.createElement("img");
         img.className = "similar-image";
         if (item.ImageTags && item.ImageTags.Primary) {
            img.src =
               auth.serverAddress +
               "/Items/" +
               item.Id +
               "/Images/Primary?quality=90&maxHeight=400";
         }

         var title = document.createElement("div");
         title.className = "similar-title";
         title.textContent = item.Name;
         if (item.ProductionYear) {
            title.textContent += " (" + item.ProductionYear + ")";
         }

         card.appendChild(img);
         card.appendChild(title);

         card.addEventListener("click", function () {
            window.location.href = "details.html?id=" + item.Id;
         });

         card.addEventListener("keydown", function (evt) {
            if (evt.keyCode === KeyCodes.ENTER) {
               evt.preventDefault();
               window.location.href = "details.html?id=" + item.Id;
            }
         });

         elements.similarList.appendChild(card);
      });

      // Focus on the first collection item
      setTimeout(function () {
         var firstCard = elements.similarList.querySelector(".similar-card");
         if (firstCard) {
            focusManager.currentSection = "similar";
            focusManager.currentIndex = 0;
            firstCard.focus();
         }
      }, FOCUS_DELAY_MS);
   }

   function loadPersonFilmography() {
      var params = {
         userId: auth.userId,
         personIds: itemData.Id,
         recursive: true,
         includeItemTypes: "Movie,Series",
         fields: "PrimaryImageAspectRatio,ProductionYear",
         sortBy: "ProductionYear,SortName",
         sortOrder: "Descending",
         limit: 100,
      };

      var endpoint = "/Users/" + auth.userId + "/Items";

      JellyfinAPI.getItems(
         auth.serverAddress,
         auth.accessToken,
         endpoint,
         params,
         function (err, data) {
            if (!err && data && data.Items && data.Items.length > 0) {
               displayFilmography(data.Items);
            }
         }
      );
   }

   function displayFilmography(items) {
      // Reuse the similar section for filmography display
      elements.similarSection.style.display = "block";
      var titleElement =
         elements.similarSection.querySelector(".section-title");
      if (titleElement) {
         titleElement.textContent = "Filmography";
      }

      elements.similarList.innerHTML = "";

      items.forEach(function (item) {
         var card = document.createElement("div");
         card.className = "similar-card";
         card.setAttribute("tabindex", "0");

         var img = document.createElement("img");
         img.className = "similar-image";
         if (item.ImageTags && item.ImageTags.Primary) {
            img.src =
               auth.serverAddress +
               "/Items/" +
               item.Id +
               "/Images/Primary?quality=90&maxHeight=400";
         }

         var title = document.createElement("div");
         title.className = "similar-title";
         title.textContent = item.Name;
         if (item.ProductionYear) {
            title.textContent += " (" + item.ProductionYear + ")";
         }

         card.appendChild(img);
         card.appendChild(title);

         card.addEventListener("click", function () {
            window.location.href = "details.html?id=" + item.Id;
         });

         card.addEventListener("keydown", function (evt) {
            if (evt.keyCode === KeyCodes.ENTER) {
               evt.preventDefault();
               window.location.href = "details.html?id=" + item.Id;
            }
         });

         elements.similarList.appendChild(card);
      });
   }

   function displayCast(people) {
      elements.castSection.style.display = "block";
      elements.castList.innerHTML = "";

      people.slice(0, 20).forEach(function (person) {
         var castCard = document.createElement("div");
         castCard.className = "cast-card";
         castCard.setAttribute("tabindex", "0");

         var img = document.createElement("img");
         img.className = "cast-image";
         if (person.PrimaryImageTag) {
            img.src =
               auth.serverAddress +
               "/Items/" +
               person.Id +
               "/Images/Primary?quality=90&maxHeight=300&tag=" +
               person.PrimaryImageTag;
         } else {
            img.src =
               'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="150" height="150"%3E%3Crect fill="%23444" width="150" height="150"/%3E%3Ctext x="50%25" y="50%25" fill="%23888" font-size="40" text-anchor="middle" dy=".3em"%3E' +
               person.Name.charAt(0) +
               "%3C/text%3E%3C/svg%3E";
         }

         var name = document.createElement("div");
         name.className = "cast-name";
         name.textContent = person.Name;

         var role = document.createElement("div");
         role.className = "cast-role";
         role.textContent = person.Role || person.Type;

         castCard.appendChild(img);
         castCard.appendChild(name);
         castCard.appendChild(role);

         castCard.addEventListener("click", function () {
            window.location.href = "details.html?id=" + person.Id;
         });

         castCard.addEventListener("keydown", function (evt) {
            if (evt.keyCode === KeyCodes.ENTER) {
               evt.preventDefault();
               window.location.href = "details.html?id=" + person.Id;
            }
         });

         elements.castList.appendChild(castCard);
      });
   }

   function loadNextUp() {
      var params = {
         userId: auth.userId,
         seriesId: itemData.Id,
         fields: "Overview,PrimaryImageAspectRatio,SeriesInfo,MediaStreams",
         enableImages: true,
         enableUserData: true,
         limit: 1,
      };

      var endpoint = "/Shows/NextUp";

      JellyfinAPI.getItems(
         auth.serverAddress,
         auth.accessToken,
         endpoint,
         params,
         function (err, data) {
            if (err || !data || !data.Items || data.Items.length === 0) {
               return;
            }

            var firstEpisode = data.Items[0];

            // If we have a next up episode, fetch all episodes from that season starting from this episode
            if (firstEpisode.SeasonId && firstEpisode.IndexNumber) {
               var episodeParams = {
                  userId: auth.userId,
                  seasonId: firstEpisode.SeasonId,
                  fields:
                     "Overview,PrimaryImageAspectRatio,SeriesInfo,MediaStreams",
                  startItemId: firstEpisode.Id,
                  limit: 50,
               };

               var episodesEndpoint =
                  "/Shows/" + firstEpisode.SeasonId + "/Episodes";

               JellyfinAPI.getItems(
                  auth.serverAddress,
                  auth.accessToken,
                  episodesEndpoint,
                  episodeParams,
                  function (err2, episodeData) {
                     if (
                        !err2 &&
                        episodeData &&
                        episodeData.Items &&
                        episodeData.Items.length > 0
                     ) {
                        // Filter to only unwatched episodes
                        var unwatchedEpisodes = episodeData.Items.filter(
                           function (ep) {
                              return !ep.UserData || !ep.UserData.Played;
                           }
                        );

                        if (unwatchedEpisodes.length > 0) {
                           displayNextUp(unwatchedEpisodes);
                        } else {
                           displayNextUp([firstEpisode]);
                        }
                     } else {
                        displayNextUp([firstEpisode]);
                     }
                  }
               );
            } else {
               displayNextUp([firstEpisode]);
            }
         }
      );
   }

   function displayNextUp(episodes) {
      elements.nextUpSection.style.display = "block";
      elements.nextUpList.innerHTML = "";

      episodes.forEach(function (episode) {
         var card = document.createElement("div");
         card.className = "nextup-card";
         card.setAttribute("tabindex", "0");

         var img = document.createElement("img");
         img.className = "nextup-image";

         // Use episode thumbnail if available, otherwise use series backdrop
         if (episode.ImageTags && episode.ImageTags.Primary) {
            img.src =
               auth.serverAddress +
               "/Items/" +
               episode.Id +
               "/Images/Primary?quality=90&maxWidth=420";
         } else if (episode.SeriesPrimaryImageTag && episode.SeriesId) {
            img.src =
               auth.serverAddress +
               "/Items/" +
               episode.SeriesId +
               "/Images/Primary?quality=90&maxWidth=420";
         }

         var title = document.createElement("div");
         title.className = "nextup-title";
         title.textContent = episode.Name;

         var info = document.createElement("div");
         info.className = "nextup-info";
         var seasonEpisode =
            "S" +
            (episode.ParentIndexNumber || 0) +
            ":E" +
            (episode.IndexNumber || 0);
         info.textContent = seasonEpisode;
         if (episode.SeriesName) {
            info.textContent = episode.SeriesName + " - " + seasonEpisode;
         }

         card.appendChild(img);
         card.appendChild(title);
         card.appendChild(info);

         // Add progress bar if episode is partially watched
         if (
            episode.UserData &&
            episode.UserData.PlaybackPositionTicks > 0 &&
            episode.RunTimeTicks
         ) {
            var progressContainer = document.createElement("div");
            progressContainer.className = "nextup-progress";

            var progressBar = document.createElement("div");
            progressBar.className = "nextup-progress-bar";
            var percentage =
               (episode.UserData.PlaybackPositionTicks / episode.RunTimeTicks) *
               100;
            progressBar.style.width = percentage + "%";

            progressContainer.appendChild(progressBar);
            card.appendChild(progressContainer);
         }

         card.addEventListener("click", function () {
            var url = "details.html?id=" + episode.Id;
            if (serverId) url += "&serverId=" + serverId;
            window.location.href = url;
         });

         elements.nextUpList.appendChild(card);
      });
   }

   function loadSeasons() {
      var params = {
         userId: auth.userId,
         fields: "Overview,PrimaryImageAspectRatio,ItemCounts,ChildCount",
      };

      var endpoint = "/Shows/" + itemData.Id + "/Seasons";

      JellyfinAPI.getItems(
         auth.serverAddress,
         auth.accessToken,
         endpoint,
         params,
         function (err, data) {
            if (!err && data && data.Items && data.Items.length > 0) {
               displaySeasons(data.Items);
            }
         }
      );
   }

   function displaySeasons(seasons) {
      elements.seasonsSection.style.display = "block";
      elements.seasonsList.innerHTML = "";

      seasons.forEach(function (season) {
         var seasonCard = document.createElement("div");
         seasonCard.className = "season-card";
         seasonCard.setAttribute("tabindex", "0");

         var img = document.createElement("img");
         img.className = "season-image";
         if (season.ImageTags && season.ImageTags.Primary) {
            img.src =
               auth.serverAddress +
               "/Items/" +
               season.Id +
               "/Images/Primary?quality=90&maxHeight=400";
         }

         var name = document.createElement("div");
         name.className = "season-name";
         name.textContent = season.Name;

         var episodes = document.createElement("div");
         episodes.className = "season-episodes";
         episodes.textContent = (season.ChildCount || 0) + " episodes";

         seasonCard.appendChild(img);
         seasonCard.appendChild(name);
         seasonCard.appendChild(episodes);

         seasonCard.addEventListener("click", function () {
            var url = "details.html?id=" + season.Id;
            if (serverId) url += "&serverId=" + serverId;
            window.location.href = url;
         });

         elements.seasonsList.appendChild(seasonCard);
      });
   }

   function loadEpisodes() {
      var params = {
         userId: auth.userId,
         seasonId: itemData.Id,
         fields: "Overview,PrimaryImageAspectRatio,MediaStreams",
         enableImages: true,
         enableUserData: true,
      };

      var endpoint = "/Shows/" + itemData.Id + "/Episodes";

      JellyfinAPI.getItems(
         auth.serverAddress,
         auth.accessToken,
         endpoint,
         params,
         function (err, data) {
            if (!err && data && data.Items && data.Items.length > 0) {
               displayEpisodes(data.Items);
            }
         }
      );
   }

   function displayEpisodes(episodes) {
      elements.episodesSection.style.display = "block";
      elements.episodesList.innerHTML = "";

      episodes.forEach(function (episode) {
         var card = document.createElement("div");
         card.className = "episode-card";
         card.setAttribute("tabindex", "0");

         var img = document.createElement("img");
         img.className = "episode-image";
         if (episode.ImageTags && episode.ImageTags.Primary) {
            img.src =
               auth.serverAddress +
               "/Items/" +
               episode.Id +
               "/Images/Primary?quality=90&maxWidth=420";
         } else if (episode.SeriesPrimaryImageTag && episode.SeriesId) {
            img.src =
               auth.serverAddress +
               "/Items/" +
               episode.SeriesId +
               "/Images/Primary?quality=90&maxWidth=420";
         }

         var title = document.createElement("div");
         title.className = "episode-title";
         title.textContent = episode.Name;

         var info = document.createElement("div");
         info.className = "episode-info";
         var episodeNum = "Episode " + (episode.IndexNumber || 0);
         if (episode.RunTimeTicks) {
            var minutes = Math.round(episode.RunTimeTicks / 600000000);
            episodeNum += " • " + minutes + " min";
         }
         info.textContent = episodeNum;

         var overview = document.createElement("div");
         overview.className = "episode-overview";
         overview.textContent = episode.Overview || "";

         card.appendChild(img);
         card.appendChild(title);
         card.appendChild(info);
         card.appendChild(overview);

         if (
            episode.UserData &&
            episode.UserData.PlaybackPositionTicks > 0 &&
            episode.RunTimeTicks
         ) {
            var progressContainer = document.createElement("div");
            progressContainer.className = "episode-progress";

            var progressBar = document.createElement("div");
            progressBar.className = "episode-progress-bar";
            var percentage =
               (episode.UserData.PlaybackPositionTicks / episode.RunTimeTicks) *
               100;
            progressBar.style.width = percentage + "%";

            progressContainer.appendChild(progressBar);
            card.appendChild(progressContainer);
         }

         card.addEventListener("click", function () {
            var url = "details.html?id=" + episode.Id;
            if (serverId) url += "&serverId=" + serverId;
            window.location.href = url;
         });

         card.addEventListener("keydown", function (evt) {
            if (evt.keyCode === KeyCodes.ENTER) {
               evt.preventDefault();
               var url = "details.html?id=" + episode.Id;
               if (serverId) url += "&serverId=" + serverId;
               window.location.href = url;
            }
         });

         elements.episodesList.appendChild(card);
      });
   }

   function loadRemainingEpisodes() {
      if (!itemData.SeasonId || !itemData.SeriesId) {
         return;
      }

      var params = {
         userId: auth.userId,
         seasonId: itemData.SeasonId,
         fields: "Overview,PrimaryImageAspectRatio,MediaStreams",
         enableImages: true,
         enableUserData: true,
      };

      var endpoint = "/Shows/" + itemData.SeasonId + "/Episodes";

      JellyfinAPI.getItems(
         auth.serverAddress,
         auth.accessToken,
         endpoint,
         params,
         function (err, data) {
            if (err || !data || !data.Items || data.Items.length === 0) {
               return;
            }

            // Filter to only episodes after current episode that are unwatched
            var currentEpisodeIndex = itemData.IndexNumber || 0;
            var remainingEpisodes = data.Items.filter(function (ep) {
               var epIndex = ep.IndexNumber || 0;
               return (
                  epIndex > currentEpisodeIndex &&
                  (!ep.UserData || !ep.UserData.Played)
               );
            });

            if (remainingEpisodes.length > 0) {
               displayRemainingEpisodes(remainingEpisodes);
            } else {
            }
         }
      );
   }

   function displayRemainingEpisodes(episodes) {
      elements.remainingEpisodesSection.style.display = "block";
      elements.remainingEpisodesList.innerHTML = "";

      episodes.forEach(function (episode) {
         var card = document.createElement("div");
         card.className = "episode-card";
         card.setAttribute("tabindex", "0");

         var img = document.createElement("img");
         img.className = "episode-image";
         if (episode.ImageTags && episode.ImageTags.Primary) {
            img.src =
               auth.serverAddress +
               "/Items/" +
               episode.Id +
               "/Images/Primary?quality=90&maxWidth=420";
         } else if (episode.SeriesPrimaryImageTag && episode.SeriesId) {
            img.src =
               auth.serverAddress +
               "/Items/" +
               episode.SeriesId +
               "/Images/Primary?quality=90&maxWidth=420";
         }

         var title = document.createElement("div");
         title.className = "episode-title";
         title.textContent = episode.Name;

         var info = document.createElement("div");
         info.className = "episode-info";
         var episodeNum = "Episode " + (episode.IndexNumber || 0);
         if (episode.RunTimeTicks) {
            var minutes = Math.round(episode.RunTimeTicks / 600000000);
            episodeNum += " • " + minutes + " min";
         }
         info.textContent = episodeNum;

         var overview = document.createElement("div");
         overview.className = "episode-overview";
         overview.textContent = episode.Overview || "";

         card.appendChild(img);
         card.appendChild(title);
         card.appendChild(info);
         card.appendChild(overview);

         card.addEventListener("click", function () {
            var url = "details.html?id=" + episode.Id;
            if (serverId) url += "&serverId=" + serverId;
            window.location.href = url;
         });

         card.addEventListener("keydown", function (evt) {
            if (evt.keyCode === KeyCodes.ENTER) {
               evt.preventDefault();
               var url = "details.html?id=" + episode.Id;
               if (serverId) url += "&serverId=" + serverId;
               window.location.href = url;
            }
         });

         elements.remainingEpisodesList.appendChild(card);
      });
   }

   function loadSimilarItems() {
      var params = {
         userId: auth.userId,
         limit: 12,
         fields: "PrimaryImageAspectRatio",
      };

      var endpoint = "/Items/" + itemData.Id + "/Similar";

      JellyfinAPI.getItems(
         auth.serverAddress,
         auth.accessToken,
         endpoint,
         params,
         function (err, data) {
            if (!err && data && data.Items && data.Items.length > 0) {
               displaySimilarItems(data.Items);
            }
         }
      );
   }

   function displaySimilarItems(items) {
      elements.similarSection.style.display = "block";
      elements.similarList.innerHTML = "";

      items.forEach(function (item) {
         var card = document.createElement("div");
         card.className = "similar-card";
         card.setAttribute("tabindex", "0");

         var img = document.createElement("img");
         img.className = "similar-image";
         if (item.ImageTags && item.ImageTags.Primary) {
            img.src =
               auth.serverAddress +
               "/Items/" +
               item.Id +
               "/Images/Primary?quality=90&maxHeight=400";
         }

         var title = document.createElement("div");
         title.className = "similar-title";
         title.textContent = item.Name;

         card.appendChild(img);
         card.appendChild(title);

         card.addEventListener("click", function () {
            window.location.href = "details.html?id=" + item.Id;
         });

         elements.similarList.appendChild(card);
      });
   }

   /**
    * Handle play button activation
    * Navigates to player page to start playback
    * For Series, plays the next episode to watch
    * @private
    */
   function handlePlay() {
      // For Series, find and play the next episode to watch
      if (itemData.Type === "Series") {
         var params = {
            userId: auth.userId,
            seriesId: itemData.Id,
            fields: "Overview",
            enableImages: true,
            enableUserData: true,
            limit: 1,
         };

         var endpoint = "/Shows/NextUp";

         JellyfinAPI.getItems(
            auth.serverAddress,
            auth.accessToken,
            endpoint,
            params,
            function (err, data) {
               if (!err && data && data.Items && data.Items.length > 0) {
                  // Play the next episode
                  var nextEpisode = data.Items[0];
                  var playUrl = "player.html?id=" + nextEpisode.Id;
                  if (serverId) playUrl += "&serverId=" + serverId;
                  window.location.href = playUrl;
               } else {
                  // No next up episode, just navigate to the series (might be fully watched)
                  alert("No episodes available to play");
               }
            }
         );
         return;
      }

      // For all other types, play directly
      // If there's a saved position, add position=0 to start from beginning
      var url = "player.html?id=" + itemData.Id;
      if (itemData.UserData && itemData.UserData.PlaybackPositionTicks > 0) {
         url += "&position=0";
      }
      if (serverId) url += "&serverId=" + serverId;
      window.location.href = url;
   }

   function handleResume() {
      var url = "player.html?id=" + itemData.Id;
      if (serverId) url += "&serverId=" + serverId;
      window.location.href = url;
   }

   function handleTrailer() {
      // First, try to play local trailer file
      var endpoint =
         "/Users/" + auth.userId + "/Items/" + itemData.Id + "/LocalTrailers";

      JellyfinAPI.getItems(
         auth.serverAddress,
         auth.accessToken,
         endpoint,
         {},
         function (err, localTrailers) {
            if (!err && localTrailers && localTrailers.length > 0) {
               // Local trailer found, play it
               alert(
                  "Local trailer playback not yet implemented. Trailer ID: " +
                  localTrailers[0].Id
               );
               return;
            }

            // No local trailer, check for remote trailers (YouTube URLs)
            if (itemData.RemoteTrailers && itemData.RemoteTrailers.length > 0) {
               var trailerUrl = itemData.RemoteTrailers[0].Url;

               // Extract YouTube video ID from URL
               var videoId = extractYouTubeVideoId(trailerUrl);
               if (videoId) {
                  openYouTubeApp(videoId);
               } else {
                  alert("Invalid YouTube trailer URL");
               }
            } else {
               alert("No trailers available for this item");
            }
         }
      );
   }

   function extractYouTubeVideoId(url) {
      // Handle various YouTube URL formats
      // https://www.youtube.com/watch?v=VIDEO_ID
      // https://youtu.be/VIDEO_ID
      // https://www.youtube.com/embed/VIDEO_ID

      var patterns = [
         /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
         /^([a-zA-Z0-9_-]{11})$/, // Just the video ID
      ];

      for (var i = 0; i < patterns.length; i++) {
         var match = url.match(patterns[i]);
         if (match && match[1]) {
            return match[1];
         }
      }

      return null;
   }

   function openYouTubeApp(videoId) {
      try {
         // Try to launch YouTube app on Tizen
         if (typeof tizen !== "undefined" && tizen.application) {
            tizen.application.launchAppControl(
               new tizen.ApplicationControl(
                  "http://tizen.org/appcontrol/operation/view",
                  "https://www.youtube.com/watch?v=" + videoId
               ),
               null,
               function () {
                  console.log("[Details] YouTube launched successfully");
               },
               function (e) {
                  console.error("[Details] Failed to launch YouTube:", e);
                  // Fallback: open YouTube in browser
                  window.open(
                     "https://www.youtube.com/watch?v=" + videoId,
                     "_blank"
                  );
               }
            );
         } else {
            // Fallback for development
            window.open("https://www.youtube.com/watch?v=" + videoId, "_blank");
         }
      } catch (e) {
         console.error("[Details] Error launching YouTube:", e);
         alert("Failed to open YouTube: " + e.message);
      }
   }

   /**
    * Toggle favorite status of current item
    * Updates server and refreshes UI
    * @private
    */
   function handleFavorite() {
      var isFavorite = itemData.UserData && itemData.UserData.IsFavorite;
      var newState = !isFavorite;

      JellyfinAPI.setFavorite(
         auth.serverAddress,
         auth.userId,
         auth.accessToken,
         itemData.Id,
         newState,
         function (err) {
            if (!err) {
               itemData.UserData.IsFavorite = newState;
               if (newState) {
                  elements.favoriteIcon.classList.add("favorited");
               } else {
                  elements.favoriteIcon.classList.remove("favorited");
               }
            }
         }
      );
   }

   function handleMarkPlayed() {
      var isPlayed = itemData.UserData && itemData.UserData.Played;
      var newState = !isPlayed;

      JellyfinAPI.setPlayed(
         auth.serverAddress,
         auth.userId,
         auth.accessToken,
         itemData.Id,
         newState,
         function (err) {
            if (!err) {
               itemData.UserData.Played = newState;
               elements.playedText.textContent = newState
                  ? "Mark Unplayed"
                  : "Mark Played";
            }
         }
      );
   }

   function handleShuffle() {
      alert("Shuffle playback not yet implemented");
   }

   function handleAudio() {
      if (!itemData.MediaSources || itemData.MediaSources.length === 0) {
         alert("No media sources available");
         return;
      }

      var mediaSource = itemData.MediaSources[0];
      if (!mediaSource.MediaStreams) {
         alert("No media streams available");
         return;
      }

      var audioStreams = mediaSource.MediaStreams.filter(function (s) {
         return s.Type === "Audio";
      });
      if (audioStreams.length === 0) {
         alert("No audio tracks available");
         return;
      }

      showAudioTrackSelector(audioStreams);
   }

   function handleSubtitles() {
      if (!itemData.MediaSources || itemData.MediaSources.length === 0) {
         alert("No media sources available");
         return;
      }

      var mediaSource = itemData.MediaSources[0];
      if (!mediaSource.MediaStreams) {
         alert("No media streams available");
         return;
      }

      var subtitleStreams = mediaSource.MediaStreams.filter(function (s) {
         return s.Type === "Subtitle";
      });

      showSubtitleTrackSelector(subtitleStreams);
   }

   function handleMore() {
      alert("More options menu not yet implemented");
   }

   function handleGoToSeries() {
      if (itemData && itemData.SeriesId) {
         window.location.href = "details.html?id=" + itemData.SeriesId;
      }
   }

   function goBack() {
      window.history.back();
   }

   /**
    * Show loading indicator, hide details content
    * @private
    */
   function showLoading() {
      elements.loadingIndicator.style.display = "flex";
      if (elements.detailsContainer) {
         elements.detailsContainer.style.display = "none";
      }
   }

   /**
    * Hide loading indicator, show details content
    * @private
    */
   function hideLoading() {
      elements.loadingIndicator.style.display = "none";
      if (elements.detailsContainer) {
         elements.detailsContainer.style.display = "block";
      }
   }

   /**
    * Show error message, hide loading and details
    * @param {string} message - Error message to display
    * @private
    */
   function showError(message) {
      hideLoading();
      elements.errorText.textContent = message;
      elements.errorDisplay.style.display = "flex";
      if (elements.detailsContainer) {
         elements.detailsContainer.style.display = "none";
      }
   }

   function showAudioTrackSelector(audioStreams) {
      // Find currently selected track (default track)
      var currentIndex = -1;
      for (var i = 0; i < audioStreams.length; i++) {
         if (audioStreams[i].IsDefault) {
            currentIndex = i;
            break;
         }
      }

      // Use TrackSelector module to build track list with click handlers
      modalFocusableItems = TrackSelector.buildAudioTrackList(
         audioStreams,
         currentIndex,
         elements.audioTrackList,
         function (selectedIndex) {
            // Update visual selection in modal
            modalFocusableItems.forEach(function (item) {
               item.classList.remove("selected");
            });
            if (modalFocusableItems[selectedIndex]) {
               modalFocusableItems[selectedIndex].classList.add("selected");
            }

            // Store preference for this item so player can apply it on playback
            localStorage.setItem(
               "preferredAudioTrack_" + itemId,
               selectedIndex
            );

            // Close after a brief delay to show the selection
            setTimeout(function () {
               closeModal();
            }, 150);
         }
      );

      activeModal = "audio";
      elements.audioModal.style.display = "flex";
      currentModalFocusIndex = Math.max(0, currentIndex);
      if (modalFocusableItems[currentModalFocusIndex]) {
         modalFocusableItems[currentModalFocusIndex].focus();
      }
   }

   function showSubtitleTrackSelector(subtitleStreams) {
      // Find currently selected track (default track)
      var currentIndex = -1;
      for (var i = 0; i < subtitleStreams.length; i++) {
         if (subtitleStreams[i].IsDefault) {
            currentIndex = i;
            break;
         }
      }

      // Use TrackSelector module to build track list with click handlers
      modalFocusableItems = TrackSelector.buildSubtitleTrackList(
         subtitleStreams,
         currentIndex,
         elements.subtitleTrackList,
         function (selectedIndex) {
            // Update visual selection in modal
            // Account for "None" option at index 0
            modalFocusableItems.forEach(function (item) {
               item.classList.remove("selected");
            });
            var modalIndex = selectedIndex === -1 ? 0 : selectedIndex + 1; // +1 because "None" is at position 0
            if (modalFocusableItems[modalIndex]) {
               modalFocusableItems[modalIndex].classList.add("selected");
            }

            // Store preference for this item so player can apply it on playback
            localStorage.setItem(
               "preferredSubtitleTrack_" + itemId,
               selectedIndex
            );

            // Close after a brief delay to show the selection
            setTimeout(function () {
               closeModal();
            }, 150);
         }
      );

      activeModal = "subtitle";
      elements.subtitleModal.style.display = "flex";
      currentModalFocusIndex = currentIndex + 1; // +1 for "None" option
      if (modalFocusableItems[currentModalFocusIndex]) {
         modalFocusableItems[currentModalFocusIndex].focus();
      }
   }

   function closeModal() {
      if (elements.audioModal) {
         elements.audioModal.style.display = "none";
      }
      if (elements.subtitleModal) {
         elements.subtitleModal.style.display = "none";
      }
      if (elements.seasonSelectorModal) {
         elements.seasonSelectorModal.style.display = "none";
      }
      activeModal = null;
      modalFocusableItems = [];
   }

   // ==================== Jellyseerr Integration ====================

   let jellyseerrEnabled = false;
   let jellyseerrData = null;
   let tmdbId = null;
   let mediaType = null;
   let selectedSeasons = "all";

   /**
    * Initialize Jellyseerr integration
    */
   /**
    * Initialize Jellyseerr integration
    * @private
    */
   function initializeJellyseerr() {
      return JellyseerrAPI.initializeFromPreferences().then(function (success) {
         jellyseerrEnabled = success;
         return success;
      });
   }

   /**
    * Load Jellyseerr data for the current item
    */
   function loadJellyseerrData() {
      if (!jellyseerrEnabled || !itemData) return;

      // Extract TMDB ID and media type from item
      tmdbId = getTmdbId(itemData);
      mediaType = getMediaType(itemData);

      if (!tmdbId || !mediaType) {
         return;
      }

      // Get media details including request status
      var apiCall =
         mediaType === "movie"
            ? JellyseerrAPI.getMovieDetails(tmdbId)
            : JellyseerrAPI.getTvDetails(tmdbId);

      apiCall
         .then(function (data) {
            jellyseerrData = data;
            updateRequestUI();
         })
         .catch(function (error) { });
   }

   /**
    * Auto-request a movie
    */
   function autoRequestMovie() {
      if (!tmdbId) return;

      JellyseerrAPI.requestMovie(tmdbId)
         .then(function (result) {
            // Reload Jellyseerr data to update UI
            setTimeout(function () {
               loadJellyseerrData();
            }, 500);
         })
         .catch(function (error) { });
   }

   /**
    * Auto-request a TV show (request first season by default)
    */
   function autoRequestTvShow() {
      if (!tmdbId) return;

      // Request first season by default for auto-request
      JellyseerrAPI.requestTvShow(tmdbId, [1])
         .then(function (result) {
            // Reload Jellyseerr data to update UI
            setTimeout(function () {
               loadJellyseerrData();
            }, 500);
         })
         .catch(function (error) { });
   }

   /**
    * Extract TMDB ID from Jellyfin item
    */
   function getTmdbId(item) {
      if (!item || !item.ProviderIds) return null;
      return item.ProviderIds.Tmdb || null;
   }

   /**
    * Determine media type from Jellyfin item
    */
   function getMediaType(item) {
      if (!item) return null;

      if (item.Type === "Movie") {
         return "movie";
      } else if (item.Type === "Series") {
         return "tv";
      }

      return null;
   }

   /**
    * Update request UI elements based on Jellyseerr data
    */
   function updateRequestUI() {
      if (!jellyseerrData) return;

      var mediaInfo = jellyseerrData.mediaInfo;

      // Update request status badge
      if (mediaInfo && mediaInfo.status) {
         elements.requestStatus.style.display = "inline-flex";

         var statusInfo = getRequestStatusInfo(mediaInfo.status);
         elements.requestStatusIcon.textContent = statusInfo.icon;
         elements.requestStatusText.textContent = statusInfo.text;
         elements.requestStatus.className =
            "info-badge info-badge-request status-" + statusInfo.class;
      } else {
         elements.requestStatus.style.display = "none";
      }

      // Show appropriate action button
      if (
         mediaInfo &&
         (mediaInfo.status === 2 ||
            mediaInfo.status === 3 ||
            mediaInfo.status === 5)
      ) {
         // Available, partially available, or processing
         elements.requestBtnWrapper.style.display = "none";
         elements.deleteRequestBtnWrapper.style.display = "none";
      } else if (mediaInfo && mediaInfo.status === 1) {
         // Pending/Requested - show delete button
         elements.requestBtnWrapper.style.display = "none";
         elements.deleteRequestBtnWrapper.style.display = "flex";

         if (elements.deleteRequestBtn) {
            elements.deleteRequestBtn.addEventListener(
               "click",
               handleDeleteRequest
            );
         }
      } else {
         // Not requested - show request button
         elements.requestBtnWrapper.style.display = "flex";
         elements.deleteRequestBtnWrapper.style.display = "none";

         if (elements.requestBtn) {
            elements.requestBtn.addEventListener("click", handleRequestMedia);
         }
      }
   }

   /**
    * Get request status display info
    */
   function getRequestStatusInfo(status) {
      var statusMap = {
         1: { icon: "...", text: "Requested", class: "pending" },
         2: {
            icon: '<img src="assets/icons/check.png" alt="" class="status-icon">',
            text: "Available",
            class: "available",
         },
         3: { icon: "...", text: "Partially Available", class: "partial" },
         4: { icon: "X", text: "Unavailable", class: "unavailable" },
         5: {
            icon: '<img src="assets/icons/settings.png" alt="" class="status-icon">',
            text: "Processing",
            class: "processing",
         },
      };

      return (
         statusMap[status] || { icon: "?", text: "Unknown", class: "unknown" }
      );
   }

   /**
    * Handle media request
    */
   function handleRequestMedia() {
      if (!tmdbId || !mediaType) return;

      if (mediaType === "tv") {
         // Show season selector for TV shows
         showSeasonSelector();
      } else {
         // Request movie directly
         requestMovie();
      }
   }

   /**
    * Show season selector modal for TV shows
    */
   function showSeasonSelector() {
      if (!jellyseerrData || !elements.seasonSelectorModal) return;

      // Populate season checkboxes
      var seasons = jellyseerrData.seasons || [];
      elements.seasonCheckboxList.innerHTML = "";

      seasons.forEach(function (season, index) {
         if (season.seasonNumber === 0) return; // Skip specials

         var checkbox = document.createElement("label");
         checkbox.className = "season-checkbox";
         checkbox.innerHTML =
            '<input type="checkbox" class="season-check" data-season="' +
            season.seasonNumber +
            '" tabindex="0">' +
            '<span class="checkbox-label">Season ' +
            season.seasonNumber +
            "</span>";

         // Add event listener to checkbox to switch to custom mode
         var checkboxInput = checkbox.querySelector(".season-check");
         checkboxInput.addEventListener("change", function () {
            // When user manually checks/unchecks, switch to custom mode
            selectedSeasons = "custom";
            elements.allSeasonsBtn.classList.remove("active");
            elements.firstSeasonBtn.classList.remove("active");
            elements.latestSeasonBtn.classList.remove("active");
         });

         elements.seasonCheckboxList.appendChild(checkbox);
      });

      // Reset selection
      selectedSeasons = "all";
      elements.allSeasonsBtn.classList.add("active");
      elements.firstSeasonBtn.classList.remove("active");
      elements.latestSeasonBtn.classList.remove("active");

      // Setup event listeners
      if (elements.allSeasonsBtn) {
         elements.allSeasonsBtn.onclick = function () {
            selectSeasonOption("all");
         };
      }
      if (elements.firstSeasonBtn) {
         elements.firstSeasonBtn.onclick = function () {
            selectSeasonOption("first");
         };
      }
      if (elements.latestSeasonBtn) {
         elements.latestSeasonBtn.onclick = function () {
            selectSeasonOption("latest");
         };
      }
      if (elements.confirmRequestBtn) {
         elements.confirmRequestBtn.onclick = requestTvShow;
      }
      if (elements.cancelRequestBtn) {
         elements.cancelRequestBtn.onclick = closeModal;
      }

      activeModal = "seasonSelector";
      elements.seasonSelectorModal.style.display = "flex";
      elements.allSeasonsBtn.focus();
   }

   /**
    * Select season option
    */
   function selectSeasonOption(option) {
      selectedSeasons = option;

      elements.allSeasonsBtn.classList.remove("active");
      elements.firstSeasonBtn.classList.remove("active");
      elements.latestSeasonBtn.classList.remove("active");

      // Update active button
      if (option === "all") {
         elements.allSeasonsBtn.classList.add("active");
      } else if (option === "first") {
         elements.firstSeasonBtn.classList.add("active");
      } else if (option === "latest") {
         elements.latestSeasonBtn.classList.add("active");
      }

      // Update checkboxes
      var checkboxes =
         elements.seasonCheckboxList.querySelectorAll(".season-check");
      checkboxes.forEach(function (cb) {
         cb.checked = option === "all";
      });
   }

   /**
    * Request a movie
    */
   function requestMovie() {
      if (!tmdbId) return;

      JellyseerrAPI.requestMovie(tmdbId)
         .then(function (result) {
            alert("Movie request submitted successfully!");

            // Reload Jellyseerr data to update UI
            setTimeout(function () {
               loadJellyseerrData();
            }, 500);
         })
         .catch(function (error) {
            alert("Failed to submit request. Please try again.");
         });
   }

   /**
    * Request a TV show with selected seasons
    */
   function requestTvShow() {
      if (!tmdbId) return;

      var seasons;
      var seasonText = "";

      if (selectedSeasons === "all") {
         seasons = "all";
         seasonText = "all seasons";
      } else if (selectedSeasons === "first") {
         seasons = [1];
         seasonText = "Season 1";
      } else if (selectedSeasons === "latest") {
         var allSeasons = jellyseerrData.seasons || [];
         var maxSeason = Math.max.apply(
            Math,
            allSeasons.map(function (s) {
               return s.seasonNumber;
            })
         );
         seasons = [maxSeason];
         seasonText = "Season " + maxSeason;
      } else {
         // Get selected checkboxes
         var checkboxes = elements.seasonCheckboxList.querySelectorAll(
            ".season-check:checked"
         );
         seasons = Array.from(checkboxes).map(function (cb) {
            return parseInt(cb.dataset.season);
         });

         if (seasons.length === 0) {
            alert("Please select at least one season");
            return;
         }

         if (seasons.length === 1) {
            seasonText = "Season " + seasons[0];
         } else {
            seasonText = seasons.length + " seasons";
         }
      }

      // Show confirmation dialog
      var itemTitle =
         jellyseerrData && jellyseerrData.name
            ? jellyseerrData.name
            : "this show";
      if (!confirm("Request " + seasonText + " of " + itemTitle + "?")) {
         return;
      }

      // Disable the button to prevent double-submission
      if (elements.confirmRequestBtn) {
         elements.confirmRequestBtn.disabled = true;
         elements.confirmRequestBtn.textContent = "Requesting...";
      }

      JellyseerrAPI.requestTvShow(tmdbId, seasons)
         .then(function (result) {
            alert("TV show request submitted successfully!");

            closeModal();

            // Re-enable button when modal closes
            if (elements.confirmRequestBtn) {
               elements.confirmRequestBtn.disabled = false;
               elements.confirmRequestBtn.textContent = "Request Selected";
            }

            // Reload Jellyseerr data to update UI
            setTimeout(function () {
               loadJellyseerrData();
            }, 500);
         })
         .catch(function (error) {
            var errorMsg = "Failed to submit request";
            if (error && error.message) {
               errorMsg += ": " + error.message;
            }
            alert(errorMsg);

            // Re-enable button on error
            if (elements.confirmRequestBtn) {
               elements.confirmRequestBtn.disabled = false;
               elements.confirmRequestBtn.textContent = "Request Selected";
            }
         });
   }

   /**
    * Handle delete request
    */
   function handleDeleteRequest() {
      if (
         !jellyseerrData ||
         !jellyseerrData.mediaInfo ||
         !jellyseerrData.mediaInfo.requests
      ) {
         return;
      }

      var requests = jellyseerrData.mediaInfo.requests;
      if (requests.length === 0) return;

      var requestId = requests[0].id;

      if (!confirm("Cancel this request?")) {
         return;
      }

      JellyseerrAPI.deleteRequest(requestId)
         .then(function () {
            alert("Request cancelled successfully");

            // Reload Jellyseerr data to update UI
            setTimeout(function () {
               loadJellyseerrData();
            }, 500);
         })
         .catch(function (error) {
            alert("Failed to cancel request. Please try again.");
         });
   }

   return {
      init: init,
   };
})();

window.addEventListener("load", function () {
   DetailsController.init();
});

// Reload details when returning from player (e.g., after back button)
window.addEventListener("pageshow", function (event) {
   // Stop theme music if returning from player or navigation
   if (typeof ThemeMusicPlayer !== "undefined") {
      ThemeMusicPlayer.stop();
   }
   // Only reload if this is a navigation from cache (back button)
   if (event.persisted || performance.navigation.type === 2) {
      var itemIdFromUrl = new URLSearchParams(window.location.search).get("id");
      if (itemIdFromUrl) {
         DetailsController.init();
      }
   }
});
