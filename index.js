import png from './types/png.js';
import jpeg from './types/jpeg.js';
import gif from './types/gif.js';

export function imageDimensionsFromData(bytes) {
	// Prevent issues with Buffer being passed. Seems to be an issue on Node.js 20 and later.
	bytes = new Uint8Array(bytes);

	return png(bytes) ?? jpeg(bytes) ?? gif(bytes);
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
