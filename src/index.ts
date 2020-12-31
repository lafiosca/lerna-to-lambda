import path from 'path';
import fs from 'fs';
import { parseScript } from 'esprima';

const getRelativePath = (absPath: string, basePath: string) => {
	const parts = absPath.split(path.sep);
	const baseParts = basePath.split(path.sep);
	while (parts.length > 0 && baseParts.length > 0) {
		if (parts.shift() !== baseParts.shift()) {
			return false;
		}
	}
	if (parts.length === 0) {
		return false;
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

export interface RelativeImport {
	type: 'relative';
	importPath: string;
	resolvedPath: string;
}

export interface AbsoluteImport {
	type: 'absolute';
	importPath: string;
}

export interface PackageModuleImport {
	type: 'packageModule';
	importPath: string;
	resolvedPath: string;
	packageName: string;
	packagePath: string;
}

export interface CoreModuleImport {
	type: 'coreModule';
	importPath: string;
}

export type Import = RelativeImport | AbsoluteImport | PackageModuleImport | CoreModuleImport;

export const findImportsForFile = (filePath: string): Import[] => (
	findImportPathsForFile(filePath).map((importPath): Import => {
		const parts = importPath.split(path.sep);
		if (parts[0] === '') {
			return {
				importPath,
				type: 'absolute',
			};
		}
		if (parts[0] === '.' || parts[0] === '..') {
			return {
				importPath,
				resolvedPath: path.resolve(path.dirname(filePath), importPath),
				type: 'relative',
			};
		}
		const searchPaths = require.resolve.paths(importPath);
		if (searchPaths === null) {
			return {
				importPath,
				type: 'coreModule',
			};
		}

		// Note: this will throw if not found
		const resolvedPath = require.resolve(importPath);

		// Now we basically redo the same resolution work manually to find the location
		// of the entire package this import is from...
		const packageName = parts[0];
		const skipFiles = (parts[parts.length - 1] === '');
		let packagePath = '';
		while (!packagePath && searchPaths.length > 0) {
			const searchPath = searchPaths.shift()!;
			console.log(`Searching for ${importPath} in ${searchPath}`);
			const possiblePaths = [
				...(skipFiles
					? []
					: [
						path.join(searchPath, importPath),
						path.join(searchPath, `${importPath}.js`),
						path.join(searchPath, `${importPath}.json`),
						path.join(searchPath, `${importPath}.node`),
					]
				),
				path.join(searchPath, importPath, 'package.json'),
				path.join(searchPath, importPath, 'index.js'),
				path.join(searchPath, importPath, 'index.node'),
			];
			while (!packagePath && possiblePaths.length > 0) {
				const possiblePath = possiblePaths.shift()!;
				console.log(`Checking if ${possiblePath} exists`);
				if (fs.existsSync(possiblePath)) {
					// TODO: Technically, if the path is a package.json file, we should also verify "main" key exists.
					console.log(`Resolved package module import '${importPath}' to ${possiblePath}`);
					packagePath = path.resolve(searchPath, packageName);
				}
			}
		}
		if (!packagePath) {
			throw new Error(`Failed to locate package for import '${importPath}' in '${filePath}'`);
		}
		console.log(`Package ${packageName} is located at ${packagePath}`);
		return {
			importPath,
			resolvedPath,
			packageName,
			packagePath,
			type: 'packageModule',
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

interface BundleNextItemParams {
	/** The absolute path of the base directory being bundled */
	basePath: string;
	/** The absolute path of the bundle output directory */
	outPath: string;
	/** Items remaining to bundle */
	bundleItems: BundleItem[];
	/** Mapping of bundled resolved paths to their relative output paths */
	bundled?: Record<string, string>;
	/** Absolute paths of packages bundled, keyed by package name */
	packagePaths?: Record<string, string>;
}

const bundleNextItem = ({
	basePath,
	outPath,
	bundleItems: [item, ...bundleItems],
	bundled = {},
	packagePaths = {},
}: BundleNextItemParams): string[] => {
	if (!item) {
		return Object.values(bundled);
	}
	const {
		resolvedPath,
		packageName,
		importStack = [],
	} = item;
	console.log(`bundle item ${resolvedPath} (${packageName ?? 'no package'})`);
	if (bundled[resolvedPath]) {
		return bundleNextItem({
			basePath,
			outPath,
			bundled,
			bundleItems,
		});
	}

	if (packageName) {
		const packagePath = packagePaths[packageName];
		if (!packagePath) {
			throw errorWithImportStack(
				`No package path found for ${packageName}`,
				importStack,
			);
		}
		const relPath = getRelativePath(resolvedPath, packagePath);
		if (relPath === false) {
			throw errorWithImportStack(
				`Resolved import path '${resolvedPath}' used by package '${packageName}' found outside of package directory '${packagePath}'`,
				importStack,
			);
		}
	} else {
		const relPath = getRelativePath(resolvedPath, basePath);
		if (relPath === false) {
			throw errorWithImportStack(
				`Resolved non-package import path '${resolvedPath}' found outside of base directory '${basePath}'`,
				importStack,
			);
		}
		const itemOutPath = path.join(outPath, relPath);
		console.log(`Copy '${resolvedPath}' to '${itemOutPath}'`);
		fs.copyFileSync(resolvedPath, itemOutPath);
	}

	const newItems: BundleItem[] = [];
	findImportsForFile(importPath).forEach((newImport) => {
		switch (newImport.type) {
			case 'absolute':
				throw errorWithImportStack(
					`Absolute import '${newImport.importPath}' found in '${importPath}'`,
					importStack,
				);
			case 'relative':
				newItems.push({
					packageName,
					importPath: path.resolve(path.dirname(importPath), newImport.importPath),
					importStack: [
						importPath,
						...importStack,
					],
				});
				break;
			case 'coreModule':
				/* Do nothing */
				break;
			case 'packageModule':
				// TODO: copy entire package
				newItems.push({
					importPath: newImport.importPath,
					packageName: newImport.packageName,
					importStack: [
						importPath,
						...importStack,
					],
				});
				break;
			default:
				// This should never happen
				throw new Error('Unrecognized import type');
		}
	});
	// requirePaths.forEach((p) => {
	// 	console.log(p);
	// 	console.log(require.resolve.paths(p));
	// 	console.log(require.resolve(p));
	// });
};

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
	if (getRelativePath(entryPath, basePath) === null) {
		throw new Error(`Resolved entry path ${entryPath} is located outside of base directory ${baseDir}`);
	}
	const outPath = path.resolve(outDir);
	if (fs.existsSync(outPath)) {
		throw new Error(`Output directory path ${outPath} already exists`);
	}

	console.log(`Creating bundle directory ${outDir}`);
	fs.mkdirSync(outPath);

	bundleNextItem({
		basePath,
		outPath,
		bundleItems: [{
			importPath: entryPath,
		}],
	});
};
