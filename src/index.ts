import path from 'path';
import fs from 'fs';
import { parseScript } from 'esprima';

export const getRelativePath = (absPath: string, basePath: string): string | undefined => {
	const parts = absPath.split(path.sep);
	const baseParts = basePath.split(path.sep);
	while (parts.length > 0 && baseParts.length > 0) {
		if (parts.shift() !== baseParts.shift()) {
			return undefined;
		}
	}
	if (parts.length === 0) {
		return undefined;
	}
	return parts.join(path.sep);
};

export const findImportPathsForFile = (filePath: string): string[] => {
	const imports: string[] = [];
	console.log(`Reading ${filePath}`);
	const code = fs.readFileSync(filePath, 'utf-8')
		.replace(/(^#!.*)/, (match) => ' '.repeat(match.length));
	try {
		parseScript(
			code,
			{ loc: true },
			(node) => {
				if (node.type === 'CallExpression'
					&& node.callee.type === 'Identifier'
					&& node.callee.name === 'require') {
					const arg = node.arguments[0];
					if (!arg) {
						throw new Error(`Empty require expression at line ${node.loc!.start.line} of ${filePath}`);
					}
					if (arg.type !== 'Literal') {
						throw new Error(`Non-literal require expression at line ${node.loc!.start.line} of ${filePath}`);
					}
					const { value } = arg;
					if (typeof value !== 'string') {
						throw new Error(`Non-string require expression at line ${node.loc!.start.line} of ${filePath}`);
					}
					imports.push(value);
				}
			},
		);
	} catch (error) {
		throw new Error(`Failed to parse imports from ${filePath}: ${error}`);
	}
	return imports;
};

export interface ResolvedImport {
	/** The real resolved path of the imported file */
	resolvedPath: string;
	/** The directory portion of the import path, based on resolution */
	importDir: string;
	/** The real path of the import directory */
	importDirPath: string;
	/** The real path of package.json used to resolve */
	packageJsonPath?: string;
}

export const resolveImportAtSearchPath = (
	importPath: string,
	searchPath: string,
	skipPackage: boolean = false,
): ResolvedImport | undefined => {
	console.log(`Searching for ${importPath} in ${searchPath}`);

	let foundPath = '';
	let importDir = '';
	let packageJsonPath: string | undefined;

	if (importPath.substr(-1) !== path.sep) {
		// Try import path as a file
		const possiblePaths = [
			path.join(searchPath, importPath),
			path.join(searchPath, `${importPath}.js`),
			path.join(searchPath, `${importPath}.json`),
			path.join(searchPath, `${importPath}.node`),
		];
		while (!foundPath && possiblePaths.length > 0) {
			const possiblePath = possiblePaths.shift()!;
			console.log(`Checking if ${possiblePath} exists`);
			if (fs.existsSync(possiblePath)) {
				foundPath = possiblePath;
				importDir = path.dirname(importPath);
				console.log(`Resolved package module import '${importPath}' to ${foundPath}`);
			}
		}
	}

	if (!foundPath && !skipPackage) {
		// Try import path as a package
		const possiblePath = path.join(searchPath, importPath, 'package.json');
		console.log(`Checking if ${possiblePath} exists`);
		if (fs.existsSync(possiblePath)) {
			// NOTE: Malformed package.json files will throw errors, but that's true of require.resolve too
			const json = fs.readFileSync(possiblePath, 'utf-8');
			const mainPath = JSON.parse(json).main; // Extract "main" from the package.json data
			if (path.normalize(mainPath).split(path.sep)[0] === '..') {
				// NOTE: require.resolve seems to allow this, but we won't
				throw new Error(`Bad "main" path '${mainPath}' in ${possiblePath}`);
			}
			const mainImport = resolveImportAtSearchPath(
				mainPath,
				path.dirname(possiblePath), // package.json's "main" path is relative to its directory
				true, // package.json's "main" path cannot refer to another package.json
			);
			if (mainImport) {
				foundPath = mainImport.resolvedPath;
				console.log(`Resolved package module import '${importPath}' via ${possiblePath} to ${foundPath}`);
				importDir = importPath;
				packageJsonPath = fs.realpathSync(possiblePath);
			}
			// Else: if "main" path is non-existent, the search continues
		}
	}

	if (!foundPath) {
		// Try import path as a directory
		const possiblePaths = [
			path.join(searchPath, importPath, 'index.js'),
			path.join(searchPath, importPath, 'index.node'),
		];
		while (!foundPath && possiblePaths.length > 0) {
			const possiblePath = possiblePaths.shift()!;
			console.log(`Checking if ${possiblePath} exists`);
			if (fs.existsSync(possiblePath)) {
				foundPath = possiblePath;
				importDir = importPath;
				console.log(`Resolved package module import '${importPath}' to ${foundPath}`);
			}
		}
	}

	if (!foundPath) {
		// Couldn't find it
		return undefined;
	}

	return {
		importDir,
		packageJsonPath,
		resolvedPath: fs.realpathSync(foundPath),
		importDirPath: fs.realpathSync(path.join(searchPath, importDir)),
	};
};

export type ImportType = 'relative' | 'absolute' | 'packageModule' | 'coreModule';

export interface Import {
	/** The type of import */
	importType: ImportType;
	/** The path of the import, as specified by the require */
	importPath: string;
	/** The real resolved path of the import */
	resolvedPath: string;
	/**
	 * If this is a package module import, or if the import path was resolved via a package.json,
	 * the name of the package as determined from import path
	 */
	packageName?: string;
	/**
	 * If this is a package module import, or if the import path was resolved via a package.json,
	 * the real path of the package directory
	 */
	packagePath?: string;
	/** If the import path was resolved via a package.json, the real path of that file */
	packageJsonPath?: string;
}

export const findImportsForFile = (filePath: string): Import[] => (
	findImportPathsForFile(filePath).map((importPath): Import => {
		let importType: ImportType;
		let resolved: ResolvedImport | undefined;

		const parts = importPath.split(path.sep);
		if (parts[0] === '') {
			importType = 'absolute';
			resolved = resolveImportAtSearchPath(importPath, '');
		} else if (parts[0] === '.' || parts[0] === '..') {
			importType = 'relative';
			resolved = resolveImportAtSearchPath(importPath, path.dirname(filePath));
		} else {
			const searchPaths = require.resolve.paths(importPath);
			if (searchPaths === null) {
				importType = 'coreModule';
			} else {
				importType = 'packageModule';
				while (!resolved && searchPaths.length > 0) {
					const searchPath = searchPaths.shift()!;
					resolved = resolveImportAtSearchPath(importPath, searchPath);
				}
			}
		}

		if (!resolved) {
			throw new Error(`Failed to resolve import '${importPath}' in '${filePath}'`);
		}

		return {
			importType,
			importPath,
			resolvedPath: resolved.resolvedPath,
			...((importType === 'packageModule' || resolved.packageJsonPath)
				? {
					packageName: resolved.importDir,
					packagePath: resolved.importDirPath,
					packageJsonPath: resolved.packageJsonPath,
				}
				: {}
			),
		};
	})
);

const errorWithImportStack = (error: string, importStack: string[]) => {
	const stackMessage = importStack.map((stackPath) => `\n\tfrom: ${stackPath}`)
		.join('');
	return new Error(`${error}${stackMessage}`);
};

interface BundleItem {
	/** The absolute path of the resolved import file */
	resolvedPath: string;
	/** Package the import comes from, if any */
	packageName?: string;
	/** Stack of import paths that led to this one */
	importStack?: string[];
}

export interface BundleParams {
	/** The base directory of the code to bundle */
	baseDir: string;
	/** The entry point of the code to bundle, relative to the base directory */
	entry: string;
	/** The output directory for the bundled code */
	outDir: string;
}

export const bundle = ({
	baseDir,
	entry,
	outDir,
}: BundleParams): void => {
	const basePath = path.resolve(baseDir);
	const entryPath = path.resolve(basePath, entry);
	if (getRelativePath(entryPath, basePath) === undefined) {
		throw new Error(`Resolved entry path ${entryPath} is located outside of base directory ${baseDir}`);
	}
	const outPath = path.resolve(outDir);
	if (fs.existsSync(outPath)) {
		throw new Error(`Output directory path ${outPath} already exists`);
	}

	console.log(`Creating bundle directory ${outDir}`);
	fs.mkdirSync(outPath);

	/** Items remaining to bundle */
	const bundleItems: BundleItem[] = [{
		resolvedPath: entryPath,
	}];

	/** Set of resolved paths that have been bundled */
	const bundled = new Set<string>();

	/** Absolute paths of packages bundled, keyed by package name */
	const packagePaths: Record<string, string> = {};

	while (bundleItems.length > 0) {
		const {
			resolvedPath,
			packageName,
			importStack = [],
		} = bundleItems.shift()!;
		console.log(`Bundle item ${resolvedPath}${packageName ? ` (package: ${packageName})` : ''})`);
		if (bundled.has(resolvedPath)) {
			console.log('already bundled');
		} else {
			// Determine where the file should be bundled
			let itemOutPath: string;
			if (packageName) {
				const packagePath = packagePaths[packageName];
				if (!packagePath) {
					throw errorWithImportStack(
						`No package path found for ${packageName}`,
						importStack,
					);
				}
				const relPath = getRelativePath(resolvedPath, packagePath);
				if (relPath === undefined) {
					throw errorWithImportStack(
						`Resolved import path ${resolvedPath} used by package ${packageName} found outside of package directory ${packagePath}`,
						importStack,
					);
				}
				itemOutPath = path.join(outPath, 'node_modules', packageName, relPath);
			} else {
				const relPath = getRelativePath(resolvedPath, basePath);
				if (relPath === undefined) {
					throw errorWithImportStack(
						`Resolved non-package import path ${resolvedPath} found outside of base directory ${basePath}`,
						importStack,
					);
				}
				itemOutPath = path.join(outPath, relPath);
			}

			console.log(`Copy ${resolvedPath} to ${itemOutPath}`);
			// fs.copyFileSync(resolvedPath, itemOutPath);

			if (resolvedPath.match(/\.js$/)) {
				console.log(`Recursively checking for imports in ${resolvedPath}`);
				findImportsForFile(resolvedPath).forEach((newImport) => {
					switch (newImport.importType) {
						case 'absolute':
							throw errorWithImportStack(
								`Absolute import '${newImport.importPath}' found in '${resolvedPath}'`,
								importStack,
							);
						case 'relative':
							if (newImport.packageName) {
								throw errorWithImportStack(
									`Relative import '${newImport.importPath}' found in '${resolvedPath}' refers to another package`,
									importStack,
								);
							}
							bundleItems.push({
								packageName,
								resolvedPath: newImport.resolvedPath,
								importStack: [
									resolvedPath,
									...importStack,
								],
							});
							break;
						case 'coreModule':
							/* Do nothing */
							break;
						case 'packageModule':
							if (newImport.packageName && newImport.packagePath) {
								const existingPackagePath = packagePaths[newImport.packageName];
								if (existingPackagePath) {
									if (existingPackagePath !== newImport.packagePath) {
										throw new Error(`Package path '${newImport.packagePath}' for '${newImport.packageName}' does not match previously found path '${existingPackagePath}'`);
									}
								} else {
									packagePaths[newImport.packageName] = newImport.packagePath;
								}
							}
							if (newImport.packageJsonPath) {
								bundleItems.push({
									resolvedPath: newImport.packageJsonPath,
									packageName: newImport.packageName,
									importStack: [
										resolvedPath,
										...importStack,
									],
								});
							}
							bundleItems.push({
								resolvedPath: newImport.resolvedPath,
								packageName: newImport.packageName,
								importStack: [
									resolvedPath,
									...importStack,
								],
							});
							break;
						default:
							// This should never happen
							throw new Error('Unrecognized import type');
					}
				});
			}
		}
	}
};
