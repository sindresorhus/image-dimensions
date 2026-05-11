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

/**
 * Web streams are not async iterable in Safari (iOS, Desktop) as of 2026-05-10
 *
 * @see {@link https://caniuse.com/wf-async-iterable-streams}
 */
async function * asyncIterableFromStream(stream) {
	const reader = stream.getReader();

	try {
		let running = true;
		while (running) {
			// eslint-disable-next-line no-await-in-loop -- Chunks must be read in order to know `done`
			const {done, value} = await reader.read();

			if (done) {
				running = false;
				break;
			}

			yield value;
		}
	} finally {
		reader.releaseLock();
	}
}

export async function imageDimensionsFromStream(stream) {
	let buffer = new Uint8Array(0);

	const asyncIterableStream
		= Symbol.asyncIterator in stream ? stream : asyncIterableFromStream(stream);

	for await (const chunk of asyncIterableStream) {
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
