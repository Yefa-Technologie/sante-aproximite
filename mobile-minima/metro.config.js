// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Les dossiers natifs (android/ios) et leurs caches ne contiennent aucun code JS a bundler :
// les exclure evite a Metro de les scanner (tres lent sans Watchman sur Windows, source de
// blocages au demarrage sur "Starting Metro Bundler").
const defaultBlockList = Array.isArray(config.resolver.blockList)
  ? config.resolver.blockList
  : [config.resolver.blockList].filter(Boolean);
config.resolver.blockList = [
  ...defaultBlockList,
  /[/\\]android[/\\].*/,
  /[/\\]ios[/\\].*/,
];

module.exports = config;
