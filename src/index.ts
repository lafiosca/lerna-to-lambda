import path from 'path';
import fs from 'fs';
import resolvePackagePath from 'resolve-package-path';

const getDependencyList = (packageJsonPath: string, excludePackages: string[]) => {
	if (!fs.existsSync(packageJsonPath)) {
		throw new Error(`Package file '${packageJsonPath}' does not exist`);
	}
	if (!fs.statSync(packageJsonPath).isFile()) {
		throw new Error(`Package file '${packageJsonPath}' is not a file`);
	}

	let packageJsonRaw: string;
	try {
		packageJsonRaw = fs.readFileSync(packageJsonPath, 'utf-8');
	} catch (error) {
		console.error('Failed to read package file', error);
		throw new Error(`Failed to read package file '${packageJsonPath}'`);
	}

	let packageJson: any;
	try {
		packageJson = JSON.parse(packageJsonRaw);
	} catch (error) {
		console.error('Failed to parse package file', error);
		throw new Error(`Failed to parse package file '${packageJsonPath}'`);
	}

	if (!packageJson || typeof packageJson !== 'object') {
		throw new Error(`Invalid package specification at '${packageJsonPath}`);
	}

	const { dependencies } = packageJson;
	if (dependencies) {
		if (typeof dependencies !== 'object') {
			throw new Error(`Invalid dependencies entry in '${packageJsonPath}'`);
		}
		return Object.keys(dependencies)
			.filter((dependency) => !excludePackages.includes(dependency));
	}

	return [];
};

const isAncestorPathOf = (ancestorPath: string, childPath: string): boolean => (
	!path.relative(ancestorPath, childPath).match(/^\.\.(\/|$)/)
);

interface BundleDependency {
	/** Name of the package to bundle */
	packageName: string;
	/** Path at which the package was imported */
	importLocation: string;
	/** Nested dependency stack, if a subdependency */
	dependencyStack?: string[];
}

const renderDependency = (
	{
		packageName,
		importLocation,
		dependencyStack,
	}: BundleDependency,
	withLocation = true,
) => `${[...(dependencyStack ?? []), packageName].join('#')}${withLocation ? ` (${path.relative('.', importLocation)})` : ''}`;

interface BundleParams {
	/** The input directory of the code to bundle */
	inputDir: string;
	/** The output directory for the bundled code */
	outputDir: string;
	/** Packages to exclude from bundling */
	excludePackages: string[];
	/** 0 means quiet, higher numbers are more verbose */
	verbosity: number;
}

export const bundle = ({
	inputDir,
	outputDir,
	excludePackages,
	verbosity,
}: BundleParams): void => {
	if (process.env.NODE_PRESERVE_SYMLINKS !== '1') {
		throw new Error('NODE_PRESERVE_SYMLINKS=1 must be set');
	}

	if (!fs.existsSync(inputDir)) {
		throw new Error(`Input directory ${inputDir} does not exist`);
	}
	if (!fs.statSync(inputDir).isDirectory()) {
		throw new Error(`Input directory ${inputDir} is not a directory`);
	}

	if (fs.existsSync(outputDir)) {
		throw new Error(`Output directory ${outputDir} already exists`);
	}

	console.log(`Bundling ${inputDir} and dependencies to ${outputDir}`);

	if (verbosity > 0) {
		console.log('Checking project dependencies');
	}
	const mainDependencies = getDependencyList('package.json', excludePackages);

	/** Packages to bundle */
	const toBundle: BundleDependency[] = mainDependencies.map((packageName) => ({
		packageName,
		importLocation: inputDir,
	}));

	/** Package paths that have been resolved (absolute, with preserved symlinks) */
	const resolvedPaths = new Set<string>();

	/** Source paths that have been bundled (absolute, with preserved symlinks) */
	const bundledPaths: string[] = [];

	/**
	 * Mapping of destination paths that have been written in the bundle output directory
	 * to the bundle dependencies that yielded them.
	 */
	const bundleDestinations: Record<string, BundleDependency> = {};

	if (verbosity > 0) {
		console.log(`Creating bundle output directory ${outputDir}`);
	}
	// fs.mkdirSync(outDir, { recursive: true });

	if (verbosity > 0) {
		console.log(`Copying contents of ${inputDir} to ${outputDir}`);
	}
	// TODO: copy files

	while (toBundle.length > 0) {
		const dependency = toBundle.shift()!;
		const {
			packageName,
			importLocation,
			dependencyStack,
		} = dependency;
		const resolvedPath = resolvePackagePath(packageName, importLocation);
		if (!resolvedPath) {
			throw new Error(`Failed to resolve package path for ${renderDependency(dependency)}`);
		}
		if (!resolvedPaths.has(resolvedPath)) {
			if (verbosity > 1) {
				console.log(); // add whitespace for very verbose output
			}
			if (verbosity > 0) {
				console.log(`Bundle dependency: ${renderDependency(dependency, verbosity > 1)}`);
			}
			const packageDirPath = path.dirname(resolvedPath);
			if (verbosity > 1) {
				console.log(`- Package directory: ${path.relative('.', packageDirPath)}`);
			}
			const bundled = bundledPaths.some((bundledPath) => {
				if (bundledPath === packageDirPath) {
					if (verbosity > 1) {
						console.log('- Already bundled');
					}
				} else if (isAncestorPathOf(bundledPath, packageDirPath)) {
					if (verbosity > 1) {
						console.log(`- Already bundled as part of ${path.relative('.', bundledPath)}`);
					}
					return true;
				}
				return false;
			});
			if (!bundled) {
				const destPath = `${outputDir}/node_modules/${packageName}`;
				if (verbosity > 1) {
					console.log(`- Bundle destination: ${destPath}`);
				}
				if (bundleDestinations[destPath]) {
					throw new Error(`Bundle destination conflict at ${destPath}: targeted by ${renderDependency(dependency)}, but already claimed by ${renderDependency(bundleDestinations[destPath])}`);
				}
				// TODO: copy files
				bundledPaths.push(packageDirPath);
				bundleDestinations[destPath] = dependency;
			}
			const subdependencies = getDependencyList(resolvedPath, excludePackages);
			if (subdependencies.length > 0) {
				if (verbosity > 1) {
					console.log(`- Found subdependencies: ${subdependencies.join(', ')}`);
				}
				toBundle.push(
					...subdependencies.map((subdependency) => ({
						packageName: subdependency,
						importLocation: packageDirPath,
						dependencyStack: (dependencyStack ?? []).concat(packageName),
					})),
				);
			}
			resolvedPaths.add(resolvedPath);
		}
	}

	if (verbosity > 1) {
		console.log(); // add whitespace for very verbose output
	}
	console.log('Done');
};
