import path from 'path';
import fs from 'fs';
import { parseScript } from 'esprima';

export interface ImportPaths {
	absolute: string[];
	relative: {
		basedir: string;
		path: string;
	}[];
	module: string[];
}

export const findImports = (codePath: string) => {
	const code = fs.readFileSync(codePath, 'utf-8');
	parseScript(
		code,
		{ loc: true },
		(node) => {
			if (node.type === 'CallExpression'
				&& node.callee.type === 'Identifier'
				&& node.callee.name === 'require') {
				const arg = node.arguments[0];
				if (!arg) {
					throw new Error(`Empty require expression at line ${node.loc!.start.line} of ${codePath}`);
				}
				if (arg.type !== 'Literal') {
					throw new Error(`Non-literal require expression at line ${node.loc!.start.line} of ${codePath}`);
				}
				const { value } = arg;
				if (typeof value !== 'string') {
					throw new Error(`Non-string require expression at line ${node.loc!.start.line} of ${codePath}`);
				}
				console.log(`import found: ${value}`);
			}
		},
	);
};

export interface BundleParams {
	basedir: string;
	entry: string;
	outdir: string;
}

export const bundle = ({
	basedir,
	entry,
}: BundleParams): void => {
	const basePath = path.resolve(basedir);
	const entryPath = path.resolve(basePath, entry);
	console.log(`reading ${entryPath}`);
	findImports(entryPath);
	// const source = fs.readFileSync(entryPath, 'utf-8');
	// const requirePaths: string[] = findRequires(source);
	// requirePaths.forEach((p) => {
	// 	console.log(p);
	// 	console.log(require.resolve.paths(p));
	// 	console.log(require.resolve(p));
	// });
};
