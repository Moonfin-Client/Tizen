/**
 * Tizen Video Service - Hardware-accelerated video playback using AVPlay APIs
 */
/* global webapis, navigator */

let isAVPlayAvailable = false;

export const isTizen = () => {
	if (typeof window === 'undefined') return false;
	if (typeof window.tizen !== 'undefined') return true;
	const ua = navigator.userAgent.toLowerCase();
	return ua.includes('tizen');
};

export const getTizenVersion = () => {
	// Try to get from webapis
	if (typeof webapis !== 'undefined' && webapis.productinfo) {
		try {
			const firmware = webapis.productinfo.getFirmware();
			// Firmware format varies, try to extract year
			const match = firmware?.match(/(\d{4})/);
			if (match) {
				const year = parseInt(match[1], 10);
				// Map years to Tizen versions per Samsung TV Model Groups docs
				if (year >= 2025) return 9;
				if (year >= 2024) return 8;
				if (year >= 2023) return 7;
				if (year >= 2022) return 6.5;
				if (year >= 2021) return 6;
				if (year >= 2020) return 5.5;
				if (year >= 2019) return 5;
				if (year >= 2018) return 4;
				if (year >= 2017) return 3;
			}
		} catch (e) {
			console.log('[tizenVideo] Could not get firmware version');
		}
	}
	return 4; // Default assumption
};

export const initTizenAPI = async () => {
	if (!isTizen()) {
		console.log('[tizenVideo] Not on Tizen platform');
		return false;
	}

	try {
		if (typeof webapis !== 'undefined' && webapis.avplay) {
			isAVPlayAvailable = true;
			console.log('[tizenVideo] AVPlay API initialized');
			return true;
		}
	} catch (e) {
		console.warn('[tizenVideo] AVPlay API not available:', e.message);
	}
	return false;
};

/**
 * Default capabilities fallback - aligned with Samsung spec tables.
 * These values are used when webapis is unavailable (e.g., browser testing).
 * Runtime detection in getMediaCapabilities() overrides where possible.
 *
 * Key Samsung documentation facts applied here:
 * - DTS: NOT supported on any Samsung TV (explicitly stated 2018-2025)
 * - TrueHD: Not documented in Samsung specifications
 * - Dolby Atmos: Not documented in Samsung audio specs
 * - DD+ (EAC3): Limited to 5.1 channels
 * - VP9: UHD models from 2018+, ALL models (incl FHD) from 2021+ (Tizen 6+)
 * - AV1: 2020+ (Tizen 5.5+) all tiers; WebM container for most, general containers on 8K Premium 2022+
 */
const getDefaultCapabilities = () => {
	const tizenVersion = getTizenVersion();
	return {
		tizenVersion,
		modelName: 'Unknown',
		uhd: true,
		uhd8K: false,
		hdr10: tizenVersion >= 4,
		dolbyVision: false, // Detect via avinfo API at runtime, not by version
		dolbyAtmos: false, // Not documented in Samsung audio specifications
		hevc: true,
		av1: tizenVersion >= 5.5,
		vp9: tizenVersion >= 4,
		ac3: true,
		eac3: true,
		truehd: false, // Not in Samsung specifications
		mkv: true,
		nativeHls: true,
		nativeHlsFmp4: true,
		hlsAc3: true
	};
};

export const getMediaCapabilities = async () => {
	const capabilities = getDefaultCapabilities();

	if (typeof webapis === 'undefined') {
		return capabilities;
	}

	try {
		// Get model info
		if (webapis.productinfo) {
			if (typeof webapis.productinfo.getModel === 'function') {
				capabilities.modelName = webapis.productinfo.getModel();
			}

			// Check resolution support
			if (typeof webapis.productinfo.is8KPanelSupported === 'function' &&
				webapis.productinfo.is8KPanelSupported()) {
				capabilities.uhd8K = true;
				capabilities.uhd = true;
			} else if (typeof webapis.productinfo.isUdPanelSupported === 'function' &&
				webapis.productinfo.isUdPanelSupported()) {
				capabilities.uhd = true;
			}
		}

		// Get HDR/Dolby Vision support
		if (webapis.avinfo) {
			if (typeof webapis.avinfo.isHdrTvSupport === 'function') {
				capabilities.hdr10 = webapis.avinfo.isHdrTvSupport();
			}
			if (typeof webapis.avinfo.isDolbyVisionSupport === 'function') {
				capabilities.dolbyVision = webapis.avinfo.isDolbyVisionSupport();
			}
		}
	} catch (e) {
		console.warn('[tizenVideo] Failed to get capabilities:', e.message);
	}

	return capabilities;
};

export const getPlayMethod = (mediaSource, capabilities) => {
	if (!mediaSource) return 'Transcode';

	const container = (mediaSource.Container || '').toLowerCase();
	const videoStream = mediaSource.MediaStreams?.find(s => s.Type === 'Video');
	const audioStream = mediaSource.MediaStreams?.find(s => s.Type === 'Audio');

	const videoCodec = (videoStream?.Codec || '').toLowerCase();
	const supportedVideoCodecs = ['h264', 'avc'];
	if (capabilities.hevc) supportedVideoCodecs.push('hevc', 'h265', 'hev1', 'hvc1');
	if (capabilities.av1) supportedVideoCodecs.push('av1');
	if (capabilities.vp9) supportedVideoCodecs.push('vp9');
	if (capabilities.dolbyVision) supportedVideoCodecs.push('dvhe', 'dvh1');

	const audioCodec = (audioStream?.Codec || '').toLowerCase();
	// Audio codecs per Samsung spec tables — DTS and TrueHD intentionally excluded
	const supportedAudioCodecs = ['aac', 'mp3', 'flac', 'opus', 'vorbis', 'pcm', 'wav'];
	if (capabilities.ac3) supportedAudioCodecs.push('ac3');
	if (capabilities.eac3) supportedAudioCodecs.push('eac3');
	// DTS: Samsung explicitly states not supported on any TV (2018-2025)
	// TrueHD: Not documented in Samsung specifications

	const supportedContainers = ['mp4', 'm4v', 'mov', 'ts', 'mpegts', 'mkv', 'matroska', 'webm', 'avi'];
	if (capabilities.nativeHls) supportedContainers.push('m3u8');

	const videoOk = !videoCodec || supportedVideoCodecs.includes(videoCodec);
	const audioOk = !audioCodec || supportedAudioCodecs.includes(audioCodec);
	const containerOk = !container || supportedContainers.includes(container);

	// Samsung docs: "HEVC: Supported only for MKV/MP4/TS containers"
	const hevcContainerOk = videoCodec === 'hevc' || videoCodec === 'h265' || videoCodec === 'hev1' || videoCodec === 'hvc1'
		? ['mp4', 'mkv', 'matroska', 'ts', 'mpegts', 'm4v'].includes(container)
		: true;

	// Samsung spec tables: VP9 is WebM container only (all years)
	const vp9ContainerOk = videoCodec === 'vp9'
		? container === 'webm'
		: true;

	// Samsung spec tables: AV1 is WebM container only for most models.
	// 8K Premium 2022+ (Tizen >= 6.5) also supports AV1 in general containers (MP4/MKV/TS/AVI).
	const av1GeneralContainers = capabilities.uhd8K && capabilities.tizenVersion >= 6.5;
	const av1ContainerOk = videoCodec === 'av1'
		? (container === 'webm' || (av1GeneralContainers && ['mp4', 'mkv', 'matroska', 'ts', 'mpegts', 'avi'].includes(container)))
		: true;

	let hdrOk = true;
	if (videoStream?.VideoRangeType) {
		const rangeType = videoStream.VideoRangeType.toUpperCase();
		if (rangeType.includes('DOLBY') || rangeType.includes('DV')) {
			hdrOk = capabilities.dolbyVision;
		} else if (rangeType.includes('HDR')) {
			hdrOk = capabilities.hdr10;
		}
	}

	console.log('[tizenVideo] getPlayMethod check:', {
		container,
		videoCodec,
		audioCodec,
		videoRange: videoStream?.VideoRangeType,
		videoOk,
		audioOk,
		containerOk,
		hdrOk,
		hevcContainerOk,
		vp9ContainerOk,
		av1ContainerOk,
		supportedContainers,
		supportedVideoCodecs,
		supportedAudioCodecs,
		serverSupportsDirectPlay: mediaSource.SupportsDirectPlay
	});

	const codecContainerOk = hevcContainerOk && vp9ContainerOk && av1ContainerOk;

	if (mediaSource.SupportsDirectPlay && videoOk && audioOk && containerOk && hdrOk && codecContainerOk) {
		return 'DirectPlay';
	}

	if (mediaSource.SupportsDirectStream && videoOk && containerOk && codecContainerOk) {
		return 'DirectStream';
	}

	return 'Transcode';
};

export const getMimeType = (container) => {
	const mimeTypes = {
		mp4: 'video/mp4',
		m4v: 'video/mp4',
		mkv: 'video/x-matroska',
		matroska: 'video/x-matroska',
		webm: 'video/webm',
		ts: 'video/mp2t',
		mpegts: 'video/mp2t',
		m2ts: 'video/mp2t',
		avi: 'video/x-msvideo',
		mov: 'video/quicktime',
		m3u8: 'application/x-mpegURL',
		mpd: 'application/dash+xml'
	};
	return mimeTypes[container?.toLowerCase()] || 'video/mp4';
};

export const setDisplayWindow = async (rect) => {
	if (!isAVPlayAvailable) return false;

	try {
		webapis.avplay.setDisplayRect(
			rect.x || 0,
			rect.y || 0,
			rect.width || 1920,
			rect.height || 1080
		);
		return true;
	} catch (e) {
		console.warn('[tizenVideo] setDisplayRect failed:', e.message);
		return false;
	}
};

export const registerAppStateObserver = (onForeground, onBackground) => {
	if (typeof document === 'undefined') return () => {};

	const handleVisibilityChange = () => {
		if (document.hidden) {
			onBackground?.();
		} else {
			onForeground?.();
		}
	};

	document.addEventListener('visibilitychange', handleVisibilityChange);

	return () => {
		document.removeEventListener('visibilitychange', handleVisibilityChange);
	};
};

export const keepScreenOn = async () => {
	// Tizen handles screen keeping via app lifecycle
	// No explicit API needed - video playback keeps screen on automatically
	return true;
};

export const getAudioOutputInfo = async () => {
	// Tizen doesn't have a direct equivalent to LG's audio output info
	return null;
};

// AVPlay wrapper functions
export const avplayOpen = (url) => {
	if (!isAVPlayAvailable) throw new Error('AVPlay not available');
	webapis.avplay.open(url);
};

export const avplayPrepare = () => {
	return new Promise((resolve, reject) => {
		if (!isAVPlayAvailable) {
			reject(new Error('AVPlay not available'));
			return;
		}
		webapis.avplay.prepareAsync(resolve, reject);
	});
};

export const avplayPlay = () => {
	if (!isAVPlayAvailable) return;
	webapis.avplay.play();
};

export const avplayPause = () => {
	if (!isAVPlayAvailable) return;
	webapis.avplay.pause();
};

export const avplayStop = () => {
	if (!isAVPlayAvailable) return;
	try {
		const state = webapis.avplay.getState();
		if (state !== 'NONE' && state !== 'IDLE') {
			webapis.avplay.stop();
		}
	} catch (e) {
		// Ignore
	}
};

export const avplayClose = () => {
	if (!isAVPlayAvailable) return;
	try {
		webapis.avplay.close();
	} catch (e) {
		// Ignore
	}
};

export const avplaySeek = (timeMs) => {
	return new Promise((resolve, reject) => {
		if (!isAVPlayAvailable) {
			reject(new Error('AVPlay not available'));
			return;
		}
		webapis.avplay.seekTo(timeMs, resolve, reject);
	});
};

export const avplayGetCurrentTime = () => {
	if (!isAVPlayAvailable) return 0;
	try {
		return webapis.avplay.getCurrentTime();
	} catch (e) {
		return 0;
	}
};

export const avplayGetDuration = () => {
	if (!isAVPlayAvailable) return 0;
	try {
		return webapis.avplay.getDuration();
	} catch (e) {
		return 0;
	}
};

export const avplayGetState = () => {
	if (!isAVPlayAvailable) return 'NONE';
	try {
		return webapis.avplay.getState();
	} catch (e) {
		return 'NONE';
	}
};

export const avplaySetListener = (listener) => {
	if (!isAVPlayAvailable) return;
	webapis.avplay.setListener(listener);
};

export const avplaySetSpeed = (speed) => {
	if (!isAVPlayAvailable) return;
	try {
		webapis.avplay.setSpeed(speed);
	} catch (e) {
		console.log('[tizenVideo] setSpeed not supported:', e);
	}
};

export const avplaySetDrm = (drmType, operation, drmData) => {
	if (!isAVPlayAvailable) return;
	webapis.avplay.setDrm(drmType, operation, drmData);
};

/**
 * Release hardware video resources
 * Critical on Tizen due to limited hardware decoder instances.
 */
export const cleanupVideoElement = (videoElement, options = {}) => {
	if (!videoElement) {
		console.log('[tizenVideo] No video element to cleanup');
		return false;
	}

	try {
		console.log('[tizenVideo] Cleaning up video element resources');
		console.log('[tizenVideo] Cleanup called from:', new Error().stack);

		if (!videoElement.paused) {
			videoElement.pause();
		}

		// Clear source and call load() to release hardware decoder
		videoElement.removeAttribute('src');
		if (videoElement.srcObject) {
			videoElement.srcObject = null;
		}
		videoElement.load();

		if (options.removeFromDOM && videoElement.parentNode) {
			videoElement.parentNode.removeChild(videoElement);
		}

		console.log('[tizenVideo] Video element cleanup complete');
		return true;
	} catch (err) {
		console.error('[tizenVideo] Error during video cleanup:', err);
		return false;
	}
};

/**
 * Handle visibility changes for app suspend/resume.
 * Uses webkit prefix for Tizen 4 compatibility.
 */
export const setupVisibilityHandler = (onHidden, onVisible) => {
	let hidden, visibilityChange;

	if (typeof document.hidden !== 'undefined') {
		hidden = 'hidden';
		visibilityChange = 'visibilitychange';
	} else if (typeof document.webkitHidden !== 'undefined') {
		hidden = 'webkitHidden';
		visibilityChange = 'webkitvisibilitychange';
	} else {
		console.warn('[tizenVideo] Visibility API not supported');
		return () => {};
	}

	const handleVisibilityChange = () => {
		if (document[hidden]) {
			console.log('[tizenVideo] App hidden/suspended - triggering cleanup');
			onHidden?.();
		} else {
			console.log('[tizenVideo] App visible - resuming');
			onVisible?.();
		}
	};

	document.addEventListener(visibilityChange, handleVisibilityChange, true);

	// Listen to both variants for maximum compatibility
	const altVisibilityChange = visibilityChange === 'visibilitychange'
		? 'webkitvisibilitychange'
		: 'visibilitychange';

	if (visibilityChange !== altVisibilityChange) {
		document.addEventListener(altVisibilityChange, handleVisibilityChange, true);
	}

	console.log('[tizenVideo] Visibility handler registered');

	// Return cleanup function
	return () => {
		document.removeEventListener(visibilityChange, handleVisibilityChange, true);
		document.removeEventListener(altVisibilityChange, handleVisibilityChange, true);
		console.log('[tizenVideo] Visibility handler removed');
	};
};

/**
 * Handle tizenRelaunch event (app re-launched while already running).
 */
export const setupTizenLifecycle = (onRelaunch) => {
	if (!isTizen()) {
		return () => {};
	}

	const handleRelaunch = (event) => {
		console.log('[tizenVideo] tizenRelaunch event received', event?.detail);
		onRelaunch?.(event?.detail);
	};

	document.addEventListener('tizenRelaunch', handleRelaunch, true);
	console.log('[tizenVideo] tizen lifecycle handler registered');

	return () => {
		document.removeEventListener('tizenRelaunch', handleRelaunch, true);
		console.log('[tizenVideo] tizen lifecycle handler removed');
	};
}

export default {
	isTizen,
	getTizenVersion,
	initTizenAPI,
	getMediaCapabilities,
	getPlayMethod,
	getMimeType,
	setDisplayWindow,
	registerAppStateObserver,
	keepScreenOn,
	getAudioOutputInfo,
	avplayOpen,
	avplayPrepare,
	avplayPlay,
	avplayPause,
	avplayStop,
	avplayClose,
	avplaySeek,
	avplayGetCurrentTime,
	avplayGetDuration,
	avplayGetState,
	avplaySetListener,
	avplaySetSpeed,
	avplaySetDrm
};
