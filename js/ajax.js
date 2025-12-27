/* 
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * This file incorporates work covered by the following copyright and
 * permission notice:
 * 
 *   Copyright 2019 Simon J. Hogan
 * 
 *    Licensed under the Apache License, Version 2.0 (the "License");
 *    you may not use this file except in compliance with the License.
 *    You may obtain a copy of the License at
 * 
 *      http://www.apache.org/licenses/LICENSE-2.0
 * 
 *    Unless required by applicable law or agreed to in writing, software
 *    distributed under the License is distributed on an "AS IS" BASIS,
 *    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *    See the License for the specific language governing permissions and
 *    limitations under the License.
 * 
*/

var ajax = new AJAX();

/**
 * AJAX utility for making HTTP requests
 * @constructor
 */
function AJAX() {}

/**
 * Make an HTTP request
 * @param {string} url - The URL to request
 * @param {Object} settings - Request settings
 * @param {string} [settings.method='GET'] - HTTP method
 * @param {Object} [settings.headers] - Request headers
 * @param {Object} [settings.data] - Request body data (will be JSON stringified)
 * @param {number} [settings.timeout] - Request timeout in milliseconds
 * @param {Function} [settings.success] - Success callback
 * @param {Function} [settings.error] - Error callback
 * @param {Function} [settings.abort] - Abort callback
 * @returns {XMLHttpRequest} The XMLHttpRequest object
 */
AJAX.prototype.request = function(url, settings) {
	console.log('[AJAX] request() called - URL:', url, 'method:', settings.method || 'GET');
	var method = (settings.method) ? settings.method : "GET";
	var xhr = new XMLHttpRequest();
	console.log('[AJAX] XMLHttpRequest created - type:', typeof xhr, 'constructor:', xhr.constructor.name);
	
	xhr.open(method, url);
	console.log('[AJAX] xhr.open() called');
	
	if (settings.headers) {
		for (var h in settings.headers) {
			if (settings.headers.hasOwnProperty(h)) {
				xhr.setRequestHeader(h, settings.headers[h]);
			}	
		}
	} 
	
	if (settings.timeout) {
		xhr.timeout = settings.timeout;
	}
	
	xhr.ontimeout = function (event) {
		if (settings.error) {
			settings.error({error: "timeout"});
		}			
	}

	xhr.onerror = function (event) {
		console.error('[AJAX] xhr.onerror triggered - status:', event.target.status, 'readyState:', event.target.readyState, 'responseText:', event.target.responseText);
		if (settings.error) {
			settings.error({error: event.target.status});
		}			
	}
	
	xhr.onabort = function (event) {
		if (settings.abort) {
			settings.abort({error: "abort"});
		}			
	}
	
	xhr.onreadystatechange = function () {
		console.log('[AJAX] onreadystatechange fired - readyState:', xhr.readyState, 'status:', xhr.status, 'XMLHttpRequest.DONE:', XMLHttpRequest.DONE);
		if (xhr.readyState == 4) {  // Use 4 directly instead of XMLHttpRequest.DONE
			console.log('[AJAX] Request complete - status:', xhr.status, 'responseText length:', xhr.responseText ? xhr.responseText.length : 0);
			console.log('[AJAX] responseText:', xhr.responseText ? xhr.responseText.substring(0, 200) : 'null');
			if (xhr.status == 200) {
				if (settings.success) {
					try {
						console.log('[AJAX] Parsing JSON...');
						var jsonData = JSON.parse(xhr.responseText);
						console.log('[AJAX] JSON parsed successfully, calling success callback');
						settings.success(jsonData);
						console.log('[AJAX] Success callback returned');
					} catch (error) {
						console.error('[AJAX] Error in success handler:', error);
						if (typeof JellyfinAPI !== 'undefined') {
							JellyfinAPI.Logger.error(error);
						}
						if (error instanceof SyntaxError) {
							if (settings.error) {
								settings.error({error: "The server did not return valid JSON data."});
							}
						} else {
							if (typeof JellyfinAPI !== 'undefined') {
								JellyfinAPI.Logger.error('Unexpected error after successful request:', error);
							}
						}
					}
				} else {
					console.log('[AJAX] No success callback defined');
				}
			} else if (xhr.status == 204) {
				if (settings.success) {
					settings.success({success: true});
				}
			} else if (settings.error) {
				var errorData = {error: xhr.status};
				try {
					if (xhr.responseText) {
						errorData.responseText = xhr.responseText;
						errorData.responseData = JSON.parse(xhr.responseText);
					}
				} catch (e) {
					// Response wasn't JSON
				}
				settings.error(errorData);
			}
		}
	};
	
	console.log('[AJAX] About to call xhr.send()');
	if (settings.data) {
		xhr.send(JSON.stringify(settings.data));
	} else {
		xhr.send();
	}
	console.log('[AJAX] xhr.send() called, returning xhr');
	return xhr;
};
