// `npm start`. node:sqlite first: a Node.js without it would fail with a message that doesn't say what to do.
try {
  await import('node:sqlite');
} catch {
  console.error(
    `Dice Roguelife standalone needs Node.js 22.13 or later; this is ${process.version}. https://nodejs.org/`,
  );
  process.exit(1);
}
const { adoptOldData, appHome, checkUpdate, lanAddresses, LOOPBACK, startServer, trustSystemCertificates } =
  await import('./server.js');
trustSystemCertificates();
let server;
try {
  for (const old of adoptOldData()) console.log(`Copied ${old} to ${appHome()}. You can delete the old copy.`);
  server = await startServer();
} catch (e) {
  const words = {
    EADDRINUSE: `Port ${e.port} is in use: is the game already running?`,
    EADDRNOTAVAIL: `${e.address}, the bind address in config.json, isn't this computer's now: connect that network, or remove bind.`,
  };
  console.error(words[e.code] ?? e.message);
  console.error(`Settings and data: ${appHome()}`);
  process.exit(1);
}
const { address, port } = server.address();
const everywhere = address === '0.0.0.0';
console.log(
  `Dice Roguelife (standalone): http://${everywhere || LOOPBACK.test(address) ? 'localhost' : address}:${port}`,
);
if (everywhere) for (const a of lanAddresses()) console.log(`  from another device: http://${a}:${port}`);
console.log(`Saves, pictures and the AI connection: ${server.dataPath}`);
// Ctrl+C: the store closes with the server, so nothing is left half-written
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    server.closeAllConnections();
    server.close(() => process.exit(0));
  });
const update = await checkUpdate();
if (update.newer) console.log(`A newer version, v${update.latest}, is out: ${update.url}`);
