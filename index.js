import png from './types/png.js';
import jpeg from './types/jpeg.js';
import gif from './types/gif.js';
import webp from './types/webp.js';
import avif from './types/avif.js';
import heic from './types/heic.js';

export function imageDimensionsFromData(bytes) {
	// The shortest signature is 3 bytes.
	if (bytes.length < 3) {
		return;
	}

	// Prevent issues with Buffer being passed. Seems to be an issue on Node.js 20 and later.
	bytes = new Uint8Array(bytes);

	// Note: Place types that can be detected fast first.
	return png(bytes)
		?? gif(bytes)
		?? jpeg(bytes)
		?? webp(bytes)
		?? avif(bytes)
		?? heic(bytes);
}

export async function imageDimensionsFromStream(stream) {
	let buffer = new Uint8Array(0);

	// Check if stream supports async iteration (not supported in Safari)
	// https://caniuse.com/wf-async-iterable-streams
	const asyncIterator = stream[Symbol.asyncIterator]?.() ?? stream[Symbol.iterator]?.();

	if (!asyncIterator) {
		throw new TypeError('Expected an async or sync iterable stream');
	}

	// Use async iteration if available, otherwise fall back to sync iteration
	const iteratorMethod = asyncIterator[Symbol.asyncIterator] ? 'async' : 'sync';

	for await (const chunk of (iteratorMethod === 'async' ? stream : [stream])) {
		// Merge chunks
		const newBuffer = new Uint8Array(buffer.length + chunk.length);
		newBuffer.set(buffer);
		newBuffer.set(chunk, buffer.length);
		buffer = newBuffer;

		const dimensions = imageDimensionsFromData(buffer);
		if (dimensions) {
			return dimensions;
		}
	}
}

