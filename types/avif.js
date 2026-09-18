import {getIsobmffImageDimensions} from '../utilities.js';

// Specification: https://aomediacodec.github.io/av1-avif/v1.1.0.html

// AVIF brands: image/collection ('avif'), sequence ('avis'), intra-only ('avio')
const avifBrands = new Set([
	'avif',
	'avis',
	'avio',
]);

export default function avif(bytes) {
	return getIsobmffImageDimensions(bytes, avifBrands, 'avif');
}
