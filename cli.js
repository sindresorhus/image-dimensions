#!/usr/bin/env node
import process from 'node:process';
import fs from 'node:fs';
import {imageDimensionsFromStream} from './index.js';

const filename = process.argv[2];

if (!filename) {
	console.error('Usage: image-dimensions <image>');
	process.exit(1);
}

try {
	const dimensions = await imageDimensionsFromStream(fs.createReadStream(filename));

	if (!dimensions) {
		throw new Error('Unsupported image format or invalid image data.');
	}

	console.log(`${dimensions.width}x${dimensions.height}`);
} catch (error) {
	console.error(error.message);
	process.exitCode = 1;
}
