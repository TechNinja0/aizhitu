#!/usr/bin/env node
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const launcher=fileURLToPath(new URL('../../../../bin/diagram.mjs',import.meta.url));
const child=spawn(process.execPath,[launcher,...process.argv.slice(2)],{stdio:'inherit'});
child.on('exit',code=>process.exit(code??1));
