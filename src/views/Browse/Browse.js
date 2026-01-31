import {useState, useEffect, useCallback, useRef, useMemo} from 'react';
import Spottable from '@enact/spotlight/Spottable';
import Spotlight from '@enact/spotlight';
import {useAuth} from '../../context/AuthContext';
import {useSettings} from '../../context/SettingsContext';
import NavBar from '../../components/NavBar';
import MediaRow from '../../components/MediaRow';
import LoadingSpinner from '../../components/LoadingSpinner';
import {getImageUrl, getBackdropId, getLogoUrl} from '../../utils/helpers';

import css from './Browse.module.less';

const FOCUS_DELAY_MS = 100;
const BACKDROP_DEBOUNCE_MS = 300;
const FEATURED_GENRES_LIMIT = 3;
const DETAIL_GENRES_LIMIT = 2;
const TRANSITION_DELAY_MS = 450;
const PRELOAD_ADJACENT_SLIDES = 2;

let cachedRowData = null;
let cachedLibraries = null;
let cachedFeaturedItems = null;

const EXCLUDED_COLLECTION_TYPES = ['playlists', 'livetv', 'boxsets', 'books', 'music', 'musicvideos', 'homevideos', 'photos'];

const SpottableDiv = Spottable('div');
const SpottableButton = Spottable('button');

const Browse = ({
	onSelectItem,
	onSelectLibrary,
	onOpenSearch,
	onOpenSettings,
	onOpenFavorites,
	onOpenJellyseerr,
	onOpenGenres,
	onSwitchUser
}) => {
	const {api, serverUrl, isAuthenticated, accessToken} = useAuth();
	const {settings} = useSettings();
	const [libraries, setLibraries] = useState([]);
	const [isLoading, setIsLoading] = useState(true);
	const [featuredItems, setFeaturedItems] = useState([]);
	const [currentFeaturedIndex, setCurrentFeaturedIndex] = useState(0);
	const [backdropUrl, setBackdropUrl] = useState('');
	const [browseMode, setBrowseMode] = useState('featured');
	const [featuredFocused, setFeaturedFocused] = useState(false);
	const [focusedItem, setFocusedItem] = useState(null);
	const [allRowData, setAllRowData] = useState([]);
	const mainContentRef = useRef(null);
	const backdropTimeoutRef = useRef(null);
	const pendingBackdropRef = useRef(null);
	const preloadedImagesRef = useRef(new Set());

	const homeRowsConfig = useMemo(() => {
		return [...(settings.homeRows || [])].sort((a, b) => a.order - b.order);
	}, [settings.homeRows]);

	const filteredRows = useMemo(() => {
		const enabledRowIds = homeRowsConfig.filter(r => r.enabled).map(r => r.id);

		if (settings.mergeContinueWatchingNextUp) {
			const resumeRow = allRowData.find(r => r.id === 'resume');
			const nextUpRow = allRowData.find(r => r.id === 'nextup');

			let result = allRowData.filter(r => r.id !== 'resume' && r.id !== 'nextup');

			if (resumeRow || nextUpRow) {
				const mergedItems = [
					...(resumeRow?.items || []),
					...(nextUpRow?.items || [])
				];
				const uniqueItems = [...new Map(mergedItems.map(i => [i.Id, i])).values()];

				if (uniqueItems.length > 0) {
					if (enabledRowIds.includes('resume') || enabledRowIds.includes('nextup')) {
						result = [{
							id: 'continue-nextup',
							title: 'Continue Watching',
							items: uniqueItems,
							type: 'landscape'
						}, ...result];
					}
				}
			}

				return result.filter(row =>
				row.id === 'continue-nextup' ||
				enabledRowIds.includes(row.id) ||
				(row.isLatestRow && enabledRowIds.includes('latest-media'))
			);
		}

		return allRowData.filter(row => {
			if (row.id === 'resume' || row.id === 'nextup') {
				return enabledRowIds.includes(row.id);
			}
			if (row.isLatestRow) {
				return enabledRowIds.includes('latest-media');
			}
			return enabledRowIds.includes(row.id);
		});
	}, [allRowData, homeRowsConfig, settings.mergeContinueWatchingNextUp]);

	useEffect(() => {
		if (!isAuthenticated) {
			onSwitchUser?.();
		}
	}, [isAuthenticated, onSwitchUser]);

	useEffect(() => {
		cachedRowData = null;
		cachedLibraries = null;
		cachedFeaturedItems = null;
	}, [accessToken]);

	const handleNavigateUp = useCallback((fromRowIndex) => {
		if (fromRowIndex === 0) {
			Spotlight.focus('featured-banner');
			return;
		}
		const targetIndex = fromRowIndex - 1;
		Spotlight.focus(`row-${targetIndex}`);
		const targetRow = document.querySelector(`[data-row-index="${targetIndex}"]`);
		if (targetRow) {
			targetRow.scrollIntoView({behavior: 'smooth', block: 'start'});
		}
	}, []);

	const handleNavigateDown = useCallback((fromRowIndex) => {
		const targetIndex = fromRowIndex + 1;
		if (targetIndex >= filteredRows.length) return;
		Spotlight.focus(`row-${targetIndex}`);
		const targetRow = document.querySelector(`[data-row-index="${targetIndex}"]`);
		if (targetRow) {
			targetRow.scrollIntoView({behavior: 'smooth', block: 'center'});
		}
	}, [filteredRows.length]);

	useEffect(() => {
		const loadData = async () => {
			if (cachedRowData && cachedLibraries && cachedFeaturedItems) {
				setLibraries(cachedLibraries);
				setAllRowData(cachedRowData);
				setFeaturedItems(cachedFeaturedItems);
				setIsLoading(false);
				return;
			}

			setIsLoading(true);

			try {
				const [libResult, resumeItems, nextUp, userConfig, randomItems] = await Promise.all([
					api.getLibraries(),
					api.getResumeItems(),
					api.getNextUp(),
					api.getUserConfiguration().catch(() => null),
					api.getRandomItems(settings.featuredContentType, settings.featuredItemCount)
				]);

				const libs = libResult.Items || [];
				setLibraries(libs);
				cachedLibraries = libs;

				const latestItemsExcludes = userConfig?.Configuration?.LatestItemsExcludes || [];

				const rowData = [];

				if (resumeItems.Items?.length > 0) {
					rowData.push({
						id: 'resume',
						title: 'Continue Watching',
						items: resumeItems.Items,
						type: 'landscape'
					});
				}

				if (nextUp.Items?.length > 0) {
					rowData.push({
						id: 'nextup',
						title: 'Next Up',
						items: nextUp.Items,
						type: 'landscape'
					});
				}

				const eligibleLibraries = libs.filter(lib => {
					if (EXCLUDED_COLLECTION_TYPES.includes(lib.CollectionType?.toLowerCase())) {
						return false;
					}
					if (latestItemsExcludes.includes(lib.Id)) {
						return false;
					}
					return true;
				});

				const latestResults = await Promise.all(
					eligibleLibraries.map(lib =>
						api.getLatest(lib.Id, 16)
							.then(latest => ({lib, latest}))
							.catch(() => null)
					)
				);

				for (const result of latestResults) {
					if (result && result.latest?.length > 0) {
						rowData.push({
							id: `latest-${result.lib.Id}`,
							title: `Latest in ${result.lib.Name}`,
							items: result.latest,
							library: result.lib,
							type: 'portrait',
							isLatestRow: true
						});
					}
				}

				try {
					const collectionsResult = await api.getCollections(20);
					if (collectionsResult?.Items?.length > 0) {
						rowData.push({
							id: 'collections',
							title: 'Collections',
							items: collectionsResult.Items,
							type: 'portrait'
						});
					}
				} catch (e) {
					console.warn('Failed to load collections:', e);
				}

				if (libs.length > 0) {
					rowData.push({
						id: 'library-tiles',
						title: 'My Media',
						items: libs.map(lib => ({
							...lib,
							Type: 'CollectionFolder',
							isLibraryTile: true
						})),
						type: 'landscape',
						isLibraryRow: true
					});
				}

				setAllRowData(rowData);
				cachedRowData = rowData;

				if (randomItems?.Items?.length > 0) {
					const shuffled = [...randomItems.Items].sort(() => Math.random() - 0.5);
					const featuredWithLogos = shuffled.map(item => ({
						...item,
						LogoUrl: getLogoUrl(serverUrl, item, {maxWidth: 800, quality: 90})
					}));
					setFeaturedItems(featuredWithLogos);
					cachedFeaturedItems = featuredWithLogos;
				}
			} catch (err) {
				console.error('Failed to load browse data:', err);
			} finally {
				setIsLoading(false);
			}
		};

		loadData();
	}, [api, serverUrl, accessToken, settings.featuredContentType, settings.featuredItemCount]);

	useEffect(() => {
		if (featuredItems.length === 0) return;

		const preloadImage = (url) => {
			if (!url || preloadedImagesRef.current.has(url)) return;
			const img = new window.Image();
			img.src = url;
			preloadedImagesRef.current.add(url);
		};

		for (let offset = -PRELOAD_ADJACENT_SLIDES; offset <= PRELOAD_ADJACENT_SLIDES; offset++) {
			const index = (currentFeaturedIndex + offset + featuredItems.length) % featuredItems.length;
			const item = featuredItems[index];
			if (item) {
				const backdropId = getBackdropId(item);
				if (backdropId) {
					preloadImage(getImageUrl(serverUrl, backdropId, 'Backdrop', {maxWidth: 1920, quality: 100}));
				}
				if (item.LogoUrl) {
					preloadImage(item.LogoUrl);
				}
			}
		}
	}, [currentFeaturedIndex, featuredItems, serverUrl]);

	useEffect(() => {
		const carouselSpeed = settings.carouselSpeed || 8000;
		if (featuredItems.length <= 1 || !featuredFocused || carouselSpeed === 0) return;

		const interval = setInterval(() => {
			setCurrentFeaturedIndex((prev) => (prev + 1) % featuredItems.length);
		}, carouselSpeed);

		return () => clearInterval(interval);
	}, [featuredItems.length, featuredFocused, settings.carouselSpeed]);

	useEffect(() => {
		let backdropId = null;

		if (browseMode === 'featured') {
			backdropId = getBackdropId(featuredItems[currentFeaturedIndex]);
		} else if (focusedItem) {
			backdropId = getBackdropId(focusedItem);
		} else {
			backdropId = getBackdropId(featuredItems[currentFeaturedIndex]);
		}

		if (backdropId) {
			const url = getImageUrl(serverUrl, backdropId, 'Backdrop', {maxWidth: 1920, quality: 100});
			if (pendingBackdropRef.current === url) return;

			if (backdropTimeoutRef.current) {
				clearTimeout(backdropTimeoutRef.current);
			}
			pendingBackdropRef.current = url;
			backdropTimeoutRef.current = setTimeout(() => {
				window.requestAnimationFrame(() => {
					setBackdropUrl(pendingBackdropRef.current);
				});
			}, BACKDROP_DEBOUNCE_MS);
		}

		return () => {
			if (backdropTimeoutRef.current) {
				clearTimeout(backdropTimeoutRef.current);
			}
		};
	}, [focusedItem, browseMode, currentFeaturedIndex, featuredItems, serverUrl]);

	const handleSelectItem = useCallback((item) => {
		onSelectItem?.(item);
	}, [onSelectItem]);

	const handleSelectLibrary = useCallback((library) => {
		onSelectLibrary?.(library);
	}, [onSelectLibrary]);

	const handleShuffle = useCallback(async () => {
		try {
			const items = await api.getRandomItem('Movie,Series');
			if (items.Items?.length > 0) {
				const item = items.Items[0];
				console.log('[Shuffle] Got random item:', item.Type, item.Name, item.Id);
				onSelectItem?.(item);
			} else {
				console.warn('[Shuffle] No items returned');
			}
		} catch (err) {
			console.error('Shuffle failed:', err);
		}
	}, [api, onSelectItem]);

	const handleHome = useCallback(() => {
		setBrowseMode('featured');
		if (mainContentRef.current) {
			mainContentRef.current.scrollTo({top: 0, behavior: 'smooth'});
		}
		setTimeout(() => {
			Spotlight.focus('featured-banner');
		}, FOCUS_DELAY_MS);
	}, []);

	const handleFeaturedPrev = useCallback(() => {
		if (featuredItems.length <= 1) return;
		setCurrentFeaturedIndex((prev) =>
			prev === 0 ? featuredItems.length - 1 : prev - 1
		);
	}, [featuredItems.length]);

	const handleFeaturedNext = useCallback(() => {
		if (featuredItems.length <= 1) return;
		setCurrentFeaturedIndex((prev) =>
			(prev + 1) % featuredItems.length
		);
	}, [featuredItems.length]);

	const handleFeaturedKeyDown = useCallback((e) => {
		if (e.keyCode === 37) {
			e.preventDefault();
			e.stopPropagation();
			handleFeaturedPrev();
		} else if (e.keyCode === 39) {
			e.preventDefault();
			e.stopPropagation();
			handleFeaturedNext();
		} else if (e.keyCode === 38) {
			e.preventDefault();
			e.stopPropagation();
			Spotlight.focus('navbar-home');
		} else if (e.keyCode === 40) {
			e.preventDefault();
			e.stopPropagation();
			setBrowseMode('rows');
			setTimeout(() => {
				const contentRows = document.querySelector('[data-element="content-rows"]');
				if (contentRows) contentRows.scrollTop = 0;
				Spotlight.focus('row-0');
			}, TRANSITION_DELAY_MS);
		}
	}, [handleFeaturedPrev, handleFeaturedNext]);

	const handleRowFocus = useCallback(() => {
		if (browseMode !== 'rows') {
			setBrowseMode('rows');
		}
	}, [browseMode]);

	const handleFocusItem = useCallback((item) => {
		setFocusedItem(item);
	}, []);

	const handleFeaturedClick = useCallback(() => {
		const item = featuredItems[currentFeaturedIndex];
		if (item) handleSelectItem(item);
	}, [featuredItems, currentFeaturedIndex, handleSelectItem]);

	const handleFeaturedFocus = useCallback(() => {
		setFeaturedFocused(true);
		setFocusedItem(null);
		setBrowseMode('featured');
	}, []);

	const handleFeaturedBlur = useCallback(() => {
		setFeaturedFocused(false);
	}, []);

	const handleCarouselPrevClick = useCallback((e) => {
		e.stopPropagation();
		handleFeaturedPrev();
	}, [handleFeaturedPrev]);

	const handleCarouselNextClick = useCallback((e) => {
		e.stopPropagation();
		handleFeaturedNext();
	}, [handleFeaturedNext]);

	const formatRuntime = (ticks) => {
		if (!ticks) return '';
		const minutes = Math.round(ticks / 600000000);
		const hours = Math.floor(minutes / 60);
		const mins = minutes % 60;
		return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
	};

	const currentFeatured = featuredItems[currentFeaturedIndex];

	if (isLoading) {
		return (
			<div className={css.page}>
				<div className={css.loadingContainer}>
					<LoadingSpinner />
					<p>Loading your library...</p>
				</div>
			</div>
		);
	}

	return (
		<div className={css.page}>
			<div className={css.globalBackdrop}>
				{backdropUrl && (
					<img
						className={css.globalBackdropImage}
						src={backdropUrl}
						alt=""
						style={{filter: settings.backdropBlurHome > 0 ? `blur(${settings.backdropBlurHome}px)` : 'none'}}
					/>
				)}
				<div className={css.globalBackdropOverlay} />
			</div>

			<NavBar
				activeView="home"
				libraries={libraries}
				onHome={handleHome}
				onSearch={onOpenSearch}
				onShuffle={handleShuffle}
				onGenres={onOpenGenres}
				onFavorites={onOpenFavorites}
				onDiscover={onOpenJellyseerr}
				onSettings={onOpenSettings}
				onSelectLibrary={handleSelectLibrary}
				onUserMenu={onSwitchUser}
			/>

			<div className={css.mainContent} ref={mainContentRef}>
				{currentFeatured && (
					<div
						className={`${css.featuredBanner} ${browseMode === 'rows' ? css.featuredHidden : ''}`}
					>
						<SpottableDiv
							className={css.featuredInner}
							spotlightId="featured-banner"
							onClick={handleFeaturedClick}
							onKeyDown={handleFeaturedKeyDown}
							onFocus={handleFeaturedFocus}
							onBlur={handleFeaturedBlur}
						>
							<div className={css.featuredBackdrop}>
								<img
									src={getImageUrl(serverUrl, getBackdropId(currentFeatured), 'Backdrop', {maxWidth: 1920, quality: 100})}
									alt=""
								/>
							</div>

							{featuredItems.length > 1 && (
								<>
									<SpottableButton
										className={`${css.carouselNav} ${css.carouselNavLeft}`}
										onClick={handleCarouselPrevClick}
									>
										<svg viewBox="0 0 24 24" width="32" height="32">
											<path fill="currentColor" d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
										</svg>
									</SpottableButton>
									<SpottableButton
										className={`${css.carouselNav} ${css.carouselNavRight}`}
										onClick={handleCarouselNextClick}
									>
										<svg viewBox="0 0 24 24" width="32" height="32">
											<path fill="currentColor" d="M8.59 16.59L10 18l6-6-6-6-1.41 1.41L13.17 12z" />
										</svg>
									</SpottableButton>
								</>
							)}

							<div className={css.featuredContent}>
								<div className={css.featuredInfoBox}>
									<h1 className={css.featuredTitle}>{currentFeatured.Name}</h1>
									<div className={css.featuredMeta}>
										{currentFeatured.ProductionYear && (
											<span className={css.metaItem}>{currentFeatured.ProductionYear}</span>
										)}
										{currentFeatured.OfficialRating && (
											<span className={css.metaItem}>{currentFeatured.OfficialRating}</span>
										)}
										{currentFeatured.RunTimeTicks && (
											<span className={css.metaItem}>{formatRuntime(currentFeatured.RunTimeTicks)}</span>
										)}
										{currentFeatured.Genres?.slice(0, FEATURED_GENRES_LIMIT).map((g, i) => (
											<span key={i} className={css.metaItem}>{g}</span>
										))}
									</div>
									<p className={css.featuredOverview}>
										{currentFeatured.Overview || 'No description available.'}
									</p>
								</div>

								<div className={css.featuredLogoContainer}>
									{currentFeatured.LogoUrl && (
										<img
											src={currentFeatured.LogoUrl}
											alt={`${currentFeatured.Name} logo`}
										/>
									)}
								</div>
							</div>

							{featuredItems.length > 1 && (
								<div className={css.featuredIndicators}>
									{featuredItems.map((_, idx) => (
										<div
											key={idx}
											className={`${css.indicatorDot} ${idx === currentFeaturedIndex ? css.active : ''}`}
										/>
									))}
								</div>
							)}
						</SpottableDiv>
					</div>
				)}

				<div
					className={`${css.detailSection} ${browseMode === 'rows' ? css.detailVisible : css.detailHidden}`}
				>
					{focusedItem ? (
						<>
							<h2 className={css.detailTitle}>
								{focusedItem.Type === 'Episode' ? focusedItem.SeriesName : focusedItem.Name}
							</h2>
							<div className={css.detailInfoRow}>
								{focusedItem.ProductionYear && (
									<span className={css.infoBadge}>{focusedItem.ProductionYear}</span>
								)}
								{focusedItem.OfficialRating && (
									<span className={css.infoBadge}>{focusedItem.OfficialRating}</span>
								)}
								{focusedItem.RunTimeTicks && (
									<span className={css.infoBadge}>{formatRuntime(focusedItem.RunTimeTicks)}</span>
								)}
								{focusedItem.Type === 'Episode' && focusedItem.ParentIndexNumber !== undefined && (
									<span className={css.infoBadge}>
										S{focusedItem.ParentIndexNumber} E{focusedItem.IndexNumber}
									</span>
								)}
								{focusedItem.Genres?.slice(0, DETAIL_GENRES_LIMIT).map((g, i) => (
									<span key={i} className={css.infoBadge}>{g}</span>
								))}
							</div>
							<p className={css.detailSummary}>
								{focusedItem.Overview || 'No description available.'}
							</p>
						</>
					) : (
						<div className={css.detailPlaceholder}>
							<p>Navigate to an item to see details</p>
						</div>
					)}
				</div>

				<div
					className={`${css.contentRows} ${browseMode === 'rows' ? css.rowsMode : ''}`}
					data-element="content-rows"
				>
					{filteredRows.map((row, index) => (
						<MediaRow
							key={row.id}
							title={row.title}
							items={row.items}
							serverUrl={serverUrl}
							cardType={row.type}
							onSelectItem={handleSelectItem}
							onFocus={handleRowFocus}
							onFocusItem={handleFocusItem}
							rowIndex={index}
							onNavigateUp={handleNavigateUp}
							onNavigateDown={handleNavigateDown}
						/>
					))}
					{filteredRows.length === 0 && (
						<div className={css.empty}>No content found</div>
					)}
				</div>
			</div>
		</div>
	);
};

export default Browse;
