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

const copyPackage = (source: string, dest: string) => {
	const dirs = [[source, dest]];
	while (dirs.length > 0) {
		const [sourceDir, destDir] = dirs.shift()!;
		const contents = fs.readdirSync(sourceDir);
		contents.forEach((item) => {
			const sourcePath = path.join(sourceDir, item);
			const destPath = path.join(destDir, item);
			if (fs.statSync(sourcePath).isDirectory()) {
				fs.mkdirSync(destPath);
				if (item !== 'node_modules') {
					dirs.push([sourcePath, destPath]);
				}
			} else {
				fs.copyFileSync(sourcePath, destPath);
			}
		});
	}
};

interface BundleDependency {
	/** Name of the package to bundle */
	packageName: string;
	/** Path at which the package was imported */
	importLocation?: string;
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
) => `${[...(dependencyStack ?? []), packageName].join('#')}${(withLocation && importLocation) ? ` (${path.relative('.', importLocation)})` : ''}`;

interface BundleParams {
	/** The input directory of the code to bundle */
	inputDir: string;
	/** The output directory for the bundled code */
	outputDir: string;
	/** Packages to exclude from bundling */
	excludePackages: string[];
	/** Whether to force deletion of the output directory */
	force: boolean;
	/** 0 means quiet, higher numbers are more verbose */
	verbosity: number;
}

export const bundle = ({
	inputDir,
	outputDir,
	excludePackages,
	force,
	verbosity,
}: BundleParams): void => {
	if (!fs.existsSync(inputDir)) {
		throw new Error(`Input directory ${inputDir} does not exist`);
	}
	if (!fs.statSync(inputDir).isDirectory()) {
		throw new Error(`Input directory ${inputDir} is not a directory`);
	}

	if (fs.existsSync(outputDir)) {
		if (force) {
			if (verbosity > 0) {
				console.log(`Removing directory ${outputDir}`);
			}
			fs.rmdirSync(outputDir, { recursive: true });
			if (verbosity > 0) {
				console.log(`Directory ${outputDir} removed`);
			}
			
		} else {
			throw new Error(`Output directory ${outputDir} already exists`);
		}
	} else {
		console.log(`Output directory ${outputDir} does not already exist`);
	}

	console.log(`Bundling ${inputDir} and dependencies to ${outputDir}`);
	console.log(`Excluding dependencies: ${excludePackages.join(', ')}`);

	if (verbosity > 0) {
		console.log('Checking project dependencies');
	}
	const mainDependencies = getDependencyList('package.json', excludePackages);

	/** Packages to bundle */
	const toBundle: BundleDependency[] = mainDependencies.map((packageName) => ({ packageName }));

	/** Package paths that have been resolved (absolute) */
	const resolvedPaths = new Set<string>();

	/**
	 * Source paths that have been bundled (absolute) with optional hash suffixes
	 * to disambiguate unhoisted dependencies.
	 */
	const bundledPaths: string[] = [];

	/** Mapping of package directory paths to their bundled output directories */
	const bundleDestinations: Record<string, string> = {};

	/**
	 * Mapping of destination paths that have been written in the bundle output directory
	 * to the bundle dependencies that claimed them.
	 */
	const bundleClaims: Record<string, BundleDependency> = {};

	if (verbosity > 0) {
		console.log(`Creating bundle output directory ${outputDir}`);
	}
	fs.mkdirSync(outputDir, { recursive: true });

	if (verbosity > 0) {
		console.log(`Copying contents of ${inputDir} to ${outputDir}`);
	}
	copyPackage(inputDir, outputDir);

	const nodeModulesDir = path.join(outputDir, 'node_modules');

	while (toBundle.length > 0) {
		const dependency = toBundle.shift()!;
		if (verbosity > 1) {
			console.log(`\nExamine dependency: ${renderDependency(dependency)}`);
		}
		if (verbosity > 2) {
			console.log(`* toBundle:\n\t${toBundle.map((d) => renderDependency(d)).join('\n\t')}`);
			console.log(`* resolvedPaths:\n\t${Array.from(resolvedPaths).join('\n\t')}`);
			console.log(`* bundledPaths:\n\t${bundledPaths.join('\n\t')}`);
			console.log(`* bundleDestinations:\n\t${Object.entries(bundleClaims).map(([p, d]) => `${p}: ${renderDependency(d)}`).join('\n\t')}`);
		}
		const {
			packageName,
			importLocation,
			dependencyStack,
		} = dependency;
		const resolvedPath = resolvePackagePath(packageName, importLocation ?? inputDir);
		if (!resolvedPath) {
			throw new Error(`Failed to resolve package path for ${renderDependency(dependency)}`);
		}
		if (verbosity > 1) {
			console.log(`- Resolved package path to ${resolvedPath}`);
		}
		if (resolvedPaths.has(resolvedPath)) {
			if (verbosity > 1) {
				console.log('- Already bundled, skipping');
			}
		} else {
			if (verbosity > 1) {
				console.log('- Bundle dependency');
			} else if (verbosity > 0) {
				console.log(`Bundle dependency: ${renderDependency(dependency, false)}`);
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
					return true;
				}
				return false;
			});
			if (!bundled) {
				let destPath = path.join(nodeModulesDir, packageName);
				let unhoist = false;
				if (verbosity > 1) {
					console.log(`- Bundle destination: ${destPath}`);
				}
				if (bundleClaims[destPath]) {
					if (verbosity > 1) {
						console.log(`- Bundle destination conflict at ${destPath} claimed by ${renderDependency(bundleClaims[destPath])}`);
					}
					if (!importLocation || !bundleDestinations[importLocation]) {
						throw new Error(`Unresolvable bundle destination conflict at ${destPath}${verbosity < 3 ? ' (try -vvv option for details)' : ''}`);
					}
					destPath = path.join(bundleDestinations[importLocation], 'node_modules', packageName);
					if (verbosity > 1) {
						console.log(`- Unhoisted bundle destination: ${destPath}`);
					}
					if (bundleClaims[destPath]) {
						if (verbosity > 1) {
							console.log(`- Unhoisted bundle destination conflict at ${destPath} claimed by ${renderDependency(bundleClaims[destPath])}`);
						}
						throw new Error(`Unresolvable unhoisted bundle destination conflict at ${destPath}${verbosity < 3 ? ' (try -vvv option for details)' : ''}`);
					}
					unhoist = true;
				}
				fs.mkdirSync(destPath, { recursive: true });
				copyPackage(packageDirPath, destPath);
				bundledPaths.push(unhoist ? `${packageDirPath}#${importLocation}` : packageDirPath);
				bundleDestinations[packageDirPath] = destPath;
				bundleClaims[destPath] = dependency;
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
