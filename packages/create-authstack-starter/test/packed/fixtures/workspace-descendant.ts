import { openSync, writeSync } from 'node:fs';

const pipe = process.env.AUTHSTACK_DESCENDANT_PIPE;
if (pipe !== undefined) {
  const descriptor = openSync(pipe, 'w');
  writeSync(descriptor, 'ready\n');
}
process.send?.('ready');
setInterval(() => {}, 60_000);
