import png from './types/png.js';
import jpeg from './types/jpeg.js';
import gif from './types/gif.js';
import webp from './types/webp.js';
import avif from './types/avif.js';

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
		?? avif(bytes);
}

export async function imageDimensionsFromStream(stream) {
	const chunks = [];

	for await (const chunk of stream) {
		chunks.push(...chunk);

		const dimensions = imageDimensionsFromData(new Uint8Array(chunks));
		if (dimensions) {
			return dimensions;
		}
	}
}
