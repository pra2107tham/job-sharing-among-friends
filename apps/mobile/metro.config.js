// Metro config for a pnpm monorepo.
//
// Two things are non-default and both are required:
//   1. watchFolders must include the repo root, or Metro cannot resolve the
//      workspace packages (@jobdrop/contracts, @jobdrop/api-client) that live
//      outside apps/mobile.
//   2. nodeModulesPaths must list both the app's and the root's node_modules,
//      because pnpm's symlinked store means a single lookup path is not enough.

const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

module.exports = withNativeWind(config, { input: './global.css' });
