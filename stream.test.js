import fs from 'node:fs';
import test from 'ava';
import {imageDimensionsFromStream} from './index.js';

for (const failure of ['read', 'cancel']) {
	test(`non-iterable web stream releases its lock after ${failure} fails`, async t => {
		const error = new Error(`${failure} failed`);
		const readableStream = new ReadableStream({
			start(controller) {
				if (failure === 'read') {
					controller.error(error);
				} else {
					controller.enqueue(fs.readFileSync('fixtures/png/valid.png'));
				}
			},
			cancel() {
				throw error;
			},
		});
		const stream = {getReader: readableStream.getReader.bind(readableStream)};

		// Preserve the source error, including errors from cancellation.
		await t.throwsAsync(imageDimensionsFromStream(stream), {is: error});
		t.false(readableStream.locked);
	});
}
