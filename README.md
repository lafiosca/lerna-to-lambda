# lerna-to-lambda (l2l)

## The problem

I want to build AWS Lambda function zip files for individual packages in my lerna monorepo. I could zip the entire monorepo with its dependencies, using a different entry point for each Lambda function, but that may be too large. I could copy each package into a separate directory and run `yarn --production` in it, but this will lead to problems with my internally referenced libraries contained by the monorepo. What I really want is a tool that will help bundle a package with exactly the dependencies it needs, whether they come from external packages or the monorepo.

## Usage

Add `lerna-to-lambda` as a dev dependency to the root of the lerna project:

```
yarn add -W --dev lerna-to-lambda
```

At the necessary point in your workflow, run a packaging step which executes `l2l` with the appropriate options. For example, for a Lambda function written in TypeScript, with `tsc` configured to output JavaScript to a folder named `build`, the `package.json` could include something like this:

```
"scripts": {
  ...
  "clean": "rimraf build lambda",
  "compile": "tsc -p tsconfig.build.json",
  "package": "l2l -i build -o lambda",
  "build": "yarn run clean && yarn run compile && yarn run package"
},
```

This `l2l` command will copy everything from `build` into `lambda`, then populate `lambda/node_modules` with all of the dependencies specified in `package.json` as well as all of their recursive subdependencies. By default, `l2l` will omit the dependency `aws-sdk` and subdependencies which strictly originate from it because these are already provided by the standard Lambda containers. The resulting `lambda` directory should be a standalone application which is ready to ship to Lambda.

Running `yarn l2l --help` in your project will show the full list of options.

## What It's Not

This is not a package manager. `l2l` does not install packages or verify that the proper dependency versions are fulfilled. You must accomplish that via other means such as `yarn` before running `l2l`. Ideally, if you have the correct dependencies installed in your project, such that you are able to run your script locally, then running `l2l` on it will generate a folder which can do the same thing on its own. That's all it does.

## What's Even Weirder

The topology of your dependencies might shift during the bundling process. This is because we are going from a hierarchy with two layers of `node_modules` down to only one. Specifically, consider the following scenario:

* Packages A and B are Lambda scripts which both depend on common library package C
* Packages B and C depend on version X of third-party package D, which lerna hoists
* Package A depends on version Y of third-party package D, which lerna does not hoist
* Package A also depends on third-party package E, which is hoisted

This would lead to a structure like:

```
/node_modules/C -> ../packages/C (symlink)
/node_modules/D
/node_modules/E
/packages/A/node_modules/D
/packages/B
/packages/C
```

When `l2l` bundles package A, it will start by copying all of A's direct dependencies (without their subdependencies) into the `node_modules` directory of the bundle:

```
outdir/node_modules/C (copied from /packages/C)
outdir/node_modules/D (copied from /packages/A/node_modules/D)
outdir/node_modules/E (copied from /node_modules/E)
```

Next `l2l` will recursively copy subdependencies, but it will immediately run into a conflict. Package C's subdependency on D resolves to `/node_modules/D`, but we've already copied `/packages/A/node_modules/D` to `outdir/node_modules/D`. There is no higher level `node_modules` in our bundle to store the lerna-hoisted packages, so instead `l2l` will "unhoist" C's subdependency:

```
outdir/node_modules/C/node_modules/D (copied from /node_modules/D)
```

It is possible to contrive scenarios in which this reorganization could make packages less efficient or potentially even break them. It's also important to note that `l2l` does not install the `node_modules/.bin` directories or any of the related symlinks. This should not matter to most projects, but if a Lambda script is explicitly executing something from there, it will not bundle properly.
