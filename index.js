'use strict';
var util = require('gulp-util');
var assign = require('object-assign');
var path = require('path');
var PluginError = require('gulp-util').PluginError;
var chokidar = require('chokidar');
var Duplex = require('readable-stream').Duplex;
var vinyl = require('vinyl-file');
var File = require('vinyl');
var anymatch = require('anymatch');
var pathIsAbsolute = require('path-is-absolute');
var globParent = require('glob-parent');
var slash = require('slash');

function normalizeGlobs(globs) {
	if (!globs) {
		throw new PluginError('gulp-watch', 'glob argument required');
	}

	if (typeof globs === 'string') {
		globs = [globs];
	}

	if (!Array.isArray(globs)) {
		throw new PluginError('gulp-watch', 'glob should be String or Array, not ' + (typeof globs));
	}

	return globs;
}

function watch(globs, opts, cb) {
	var originalGlobs = globs;
	globs = normalizeGlobs(globs);

	if (typeof opts === 'function') {
		cb = opts;
		opts = {};
	}

	opts = assign({}, watch._defaultOptions, opts);
	cb = cb || function () {};

	function resolveFilepath(filepath) {
		if (pathIsAbsolute(filepath)) {
			return path.normalize(filepath);
		}
		return path.resolve(opts.cwd || process.cwd(), filepath);
	}

	function resolveGlob(glob) {
		var mod = '';

		if (glob[0] === '!') {
			mod = glob[0];
			glob = glob.slice(1);
		}

		return mod + slash(resolveFilepath(glob));
	}
	// MAW The map calling resolveGlob seems to get caught up repeating, results an undefined glob, and throws an error in resolveFilepath.
  //     The exact same code works fine as an inline function!
  //globs = globs.map(resolveGlob);
	globs = globs.map((glob) => {
		var mod = '';

		if (glob[0] === '!') {
			mod = glob[0];
			glob = glob.slice(1);
		}

		return mod + slash(resolveFilepath(glob));
	});

	var baseForced = Boolean(opts.base);
	var outputStream = new Duplex({objectMode: true, allowHalfOpen: true});

	outputStream._write = function _write(file, enc, done) {
		cb(file);
		this.push(file);
		done();
	};

	outputStream._read = function _read() { };

	var watcher = chokidar.watch(globs, opts);

	opts.events.forEach(function (ev) {
		watcher.on(ev, processEvent.bind(undefined, ev));
	});

	['add', 'change', 'unlink', 'addDir', 'unlinkDir', 'error', 'ready', 'raw']
		.forEach(function (ev) {
			watcher.on(ev, outputStream.emit.bind(outputStream, ev));
		});

	outputStream.add = function add(newGlobs) {
		newGlobs = normalizeGlobs(newGlobs)
			.map(resolveGlob);
		watcher.add(newGlobs);
		globs.push.apply(globs, newGlobs);
	};
	outputStream.unwatch = watcher.unwatch.bind(watcher);
	outputStream.close = function () {
		watcher.close();
		this.emit('end');
	};

	function processEvent(event, filepath) {
		// MAW Seems to also receive filepath as undefined and then throws error in resolveFilepath, so bail out if it's undefined.
	  if (filepath === undefined) {
	    return;
	  }
		filepath = resolveFilepath(filepath);
		var fileOpts = assign({}, opts);

		var glob;
		var currentFilepath = filepath;
		while (!(glob = globs[anymatch(globs, currentFilepath, true)]) && currentFilepath !== (currentFilepath = path.dirname(currentFilepath))) {} // eslint-disable-line no-empty-blocks/no-empty-blocks

		if (!glob) {
			util.log(
				util.colors.cyan('[gulp-watch]'),
				util.colors.yellow('Watched unexpected path. This is likely a bug. Please open this link to report the issue:\n') +
				'https://github.com/floatdrop/gulp-watch/issues/new?title=' +
				encodeURIComponent('Watched unexpected filepath') + '&body=' +
				encodeURIComponent('Node.js version: `' + process.version + ' ' + process.platform + ' ' + process.arch + '`\ngulp-watch version: `' + require('./package.json').version + '`\nGlobs: `' + JSON.stringify(originalGlobs) + '`\nFilepath: `' + filepath + '`\nEvent: `' + event + '`\nProcess CWD: `' + process.cwd() + '`\nOptions:\n```js\n' + JSON.stringify(opts, null, 2) + '\n```')
			);
			return;
		}

		if (!baseForced) {
			fileOpts.base = path.normalize(globParent(glob));
		}

		// Do not stat deleted files
		if (event === 'unlink' || event === 'unlinkDir') {
			fileOpts.path = filepath;

			write(event, null, new File(fileOpts));
			return;
		}

		// Workaround for early read
		setTimeout(function () {
			vinyl.read(filepath, fileOpts).then(function (file) {
				write(event, null, file);
			});
		}, opts.readDelay);
	}

	function write(event, err, file) {
		if (err) {
			outputStream.emit('error', err);
			return;
		}

		if (opts.verbose) {
			log(event, file);
		}

		file.event = event;
		outputStream.push(file);
		cb(file);
	}

	function log(event, file) {
		event = event[event.length - 1] === 'e' ? event + 'd' : event + 'ed';

		var msg = [util.colors.magenta(file.relative), 'was', event];

		if (opts.name) {
			msg.unshift(util.colors.cyan(opts.name) + ' saw');
		}

		util.log.apply(util, msg);
	}

	return outputStream;
}

// This is not part of the public API as that would lead to global state (singleton) pollution,
// and allow unexpected interference between unrelated modules that make use of gulp-watch.
// This can be useful for unit tests and root application configuration, though.
// Avoid modifying gulp-watch's default options inside a library/reusable package, please.
watch._defaultOptions = {
	events: ['add', 'change', 'unlink'],
	ignoreInitial: true,
	readDelay: 10
};

module.exports = watch;
