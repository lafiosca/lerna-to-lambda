import path from 'path';
import fs from 'fs';
import resolvePackagePath from 'resolve-package-path';

const getDependencyList = (packageJsonPath: string) => {
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
		return Object.keys(dependencies);
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

const renderDependency = ({
	packageName,
	importLocation,
	dependencyStack,
}: BundleDependency) => `${[...(dependencyStack ?? []), packageName].join('#')} (${path.relative('.', importLocation)})`;

interface BundleParams {
	/** The input directory of the code to bundle */
	inDir: string;
	/** The output directory for the bundled code */
	outDir: string;
}

export const bundle = ({
	inDir,
	outDir,
}: BundleParams): void => {
	if (process.env.NODE_PRESERVE_SYMLINKS !== '1') {
		throw new Error('NODE_PRESERVE_SYMLINKS=1 must be set');
	}

	if (!fs.existsSync(inDir)) {
		throw new Error(`Input directory ${inDir} does not exist`);
	}
	if (!fs.statSync(inDir).isDirectory()) {
		throw new Error(`Input directory ${inDir} is not a directory`);
	}

	if (fs.existsSync(outDir)) {
		throw new Error(`Output directory ${outDir} already exists`);
	}

	console.log('Checking project dependencies');
	const mainDependencies = getDependencyList('package.json');

	/** Packages to bundle */
	const toBundle: BundleDependency[] = mainDependencies.map((packageName) => ({
		packageName,
		importLocation: inDir,
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

	console.log(`Creating bundle output directory ${outDir}`);
	// fs.mkdirSync(outDir, { recursive: true });

	console.log(`Copying contents of ${inDir} to ${outDir}`);
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
			console.log(`Bundle dependency: ${renderDependency(dependency)}`);
			const packageDirPath = path.dirname(resolvedPath);
			const bundled = bundledPaths.some((bundledPath) => {
				if (isAncestorPathOf(bundledPath, packageDirPath)) {
					console.log(`- Already bundled ${packageDirPath}${bundledPath === packageDirPath ? '' : ` as part of ${bundledPath}`}`);
					return true;
				}
				return false;
			});
			if (!bundled) {
				const destPath = `${outDir}/node_modules/${packageName}`;
				if (bundleDestinations[destPath]) {
					throw new Error(`Bundle destination conflict at ${destPath}: targeted by ${renderDependency(dependency)}, but already claimed by ${renderDependency(bundleDestinations[destPath])}`);
				}
				console.log(`- Copying ${path.relative('.', packageDirPath)} to ${destPath}`);
				// TODO: copy files
				bundleDestinations[destPath] = dependency;
			}
			const subdependencies = getDependencyList(resolvedPath);
			if (subdependencies.length > 0) {
				console.log(`- Subdependencies: ${subdependencies.join(', ')}`);
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
};
