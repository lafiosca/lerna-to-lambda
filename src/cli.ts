#!/usr/bin/env node
import yargs from 'yargs';

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
	.alias('i', 'input-dir')
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
	.alias('o', 'output-dir')
	.default('o', 'lambda')
	.describe('e', 'Packages to exclude from bundling')
	.array('e')
	.alias('e', 'exclude-packages')
	.default('e', ['aws-sdk'])
	.describe('v', 'Enable verbose output (multiple v for more)')
	.count('v')
	.alias('v', 'verbose')
	.help('h')
	.alias('h', 'help')
	.argv;

const {
	i: inputDir,
	o: outputDir,
	e: excludePackages,
	v: verbosity,
} = options;

bundle({
	inputDir,
	outputDir,
	excludePackages,
	verbosity,
});
