#!/usr/bin/env node
import yargs from 'yargs';
// import chalk from 'chalk';

const options = yargs
	.usage('Usage: $0 [options]')
	.example('$0 -b build -o package', 'Bundle `build/index.js` to directory `package`')
	.describe('b', 'Base directory to bundle')
	.string('b')
	.demandOption('b')
	.check(({ b }) => {
		if (Array.isArray(b)) {
			throw new Error('Only one base directory may be specified.');
		}
		return true;
	})
	.alias('b', 'basedir')
	.default('b', '.')
	.describe('e', 'Entry point to bundle, relative to basedir')
	.string('e')
	.demandOption('e')
	.check(({ e }) => {
		if (Array.isArray(e)) {
			throw new Error('Only one entry point may be specified.');
		}
		return true;
	})
	.alias('e', 'entry')
	.default('e', 'index.js')
	.describe('o', 'Output directory for bundle')
	.string('o')
	.demandOption('o')
	.check(({ o }) => {
		if (Array.isArray(o)) {
			throw new Error('Only one output directory may be specified.');
		}
		return true;
	})
	.alias('o', 'outdir')
	.default('o', 'lambda')
	.help('h')
	.alias('h', 'help')
	.argv;

const {
	basedir,
	entry,
	outdir,
} = options;

console.log(options);
