import fs from 'node:fs';
import path from 'node:path';
import test from 'ava';
import {imageDimensionsFromStream, imageDimensionsFromData} from './index.js';

const matches = (t, filename, dimensions) => {
	const data = fs.readFileSync(path.join('fixtures', filename));
	t.deepEqual(imageDimensionsFromData(data), dimensions);
};

test('png', t => {
	matches(t, 'valid.png', {width: 30, height: 20});
});

test('png - minified', t => {
	matches(t, 'minified.png', {width: 30, height: 20});
});

test('png - apple minified', t => {
	matches(t, 'apple-minified.png', {width: 30, height: 20});
});

test('png - invalid', t => {
	matches(t, 'invalid.png', undefined);
});

test('jpg', t => {
	matches(t, 'valid.jpg', {width: 200, height: 133});
});

test('jpg - no exif', t => {
	matches(t, 'no-exif.jpg', {width: 200, height: 133});
});

test('jpg - progressive', t => {
	matches(t, 'progressive.jpg', {width: 40, height: 27});
});

test('imageDimensionsFromStream', async t => {
	const stream = fs.createReadStream('fixtures/valid.png');
	t.deepEqual(await imageDimensionsFromStream(stream), {width: 30, height: 20});
});
