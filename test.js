import fs from 'node:fs';
import path from 'node:path';
import test from 'ava';
import {imageDimensionsFromStream, imageDimensionsFromData} from './index.js';

const matches = (t, filename, dimensions) => {
	const data = fs.readFileSync(path.join('fixtures', filename));
	t.deepEqual(imageDimensionsFromData(data), dimensions);
};

test('png', t => {
	matches(t, 'png/valid.png', {width: 30, height: 20});
});

test('png - minified', t => {
	matches(t, 'png/minified.png', {width: 30, height: 20});
});

test('png - apple minified', t => {
	matches(t, 'png/apple-minified.png', {width: 30, height: 20});
});

test('png - invalid', t => {
	matches(t, 'png/invalid.png', undefined);
});

test('png - animated', t => {
	matches(t, 'png/animated.png', {width: 30, height: 17});
});

test('jpg', t => {
	matches(t, 'jpeg/valid.jpg', {width: 200, height: 133});
});

test('jpg - no exif', t => {
	matches(t, 'jpeg/no-exif.jpg', {width: 200, height: 133});
});

test('jpg - progressive', t => {
	matches(t, 'jpeg/progressive.jpg', {width: 40, height: 27});
});

test('gif', t => {
	matches(t, 'gif/valid.gif', {width: 30, height: 17});
});

test.failing('jpeg xl', t => {
	matches(t, 'jpeg xl/valid.jxl', {width: 30, height: 17});
});

test.failing('avif', t => {
	matches(t, 'avif/valid.avif', {width: 30, height: 17});
});

test.failing('heic', t => {
	matches(t, 'heic/valid.heic', {width: 30, height: 17});
});

test('webp - vp8', t => {
	matches(t, 'webp/vp8.webp', {width: 30, height: 20});
});

test('webp - vp8l', t => {
	matches(t, 'webp/vp8l.webp', {width: 30, height: 20});
});

test('webp - vp8x', t => {
	matches(t, 'webp/vp8x.webp', {width: 30, height: 20});
});

test('webp - animated', t => {
	matches(t, 'webp/animated.webp', {width: 30, height: 17});
});

test('imageDimensionsFromStream', async t => {
	const stream = fs.createReadStream('fixtures/png/valid.png');
	t.deepEqual(await imageDimensionsFromStream(stream), {width: 30, height: 20});
});
