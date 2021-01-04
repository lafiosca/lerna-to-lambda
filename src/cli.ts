#!/usr/bin/env node
import yargs from 'yargs';
// import chalk from 'chalk';

import { bundle } from '.';

const options = yargs
	.usage('Usage: $0 [options]')
	.example('$0 -i build -o package', 'Bundle `build` to directory `package`')
	.describe('i', 'Input directory to bundle')
	.string('i')
	.demandOption('i')
	.check(({ i }) => {
		if (Array.isArray(i)) {
			throw new Error('Only one input directory may be specified.');
		}
		return true;
	})
	.alias('i', 'in-dir')
	.default('i', '.')
	.describe('o', 'Output directory for bundle')
	.string('o')
	.demandOption('o')
	.check(({ o }) => {
		if (Array.isArray(o)) {
			throw new Error('Only one output directory may be specified.');
		}
		return true;
	})
	.alias('o', 'out-dir')
	.default('o', 'lambda')
	.help('h')
	.alias('h', 'help')
	.argv;

const {
	i: inDir,
	o: outDir,
} = options;

bundle({
	inDir,
	outDir,
});
