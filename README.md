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

This `l2l` command will copy everything from `build` into `lambda`, then populate `lambda/node_modules` with all of the dependencies specified in `package.json` as well as all of their recursive subdependencies. By default, `l2l` will omit the `aws-sdk` and subdependencies which strictly originate from it because these are already provided by the standard Lambda containers. The resulting `lambda` directory should be a standalone application which is ready to ship to Lambda.

## What It's Not

This is not a package manager. `l2l` does not install packages or verify that the proper dependency versions are fulfilled. You must accomplish that via other means such as `yarn` before running `l2l`. Ideally, if you have the correct dependencies installed in your project, such that you are able to run your script locally, then running `l2l` on it will generate a folder which can do the same thing on its own. That's all it does.
