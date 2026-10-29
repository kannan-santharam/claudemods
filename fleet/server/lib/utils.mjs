// Small helpers every module uses: running a command, private file writes,
// day keys, log lines and the text cleaning applied before anything reaches a shell.

import { execFile } from 'node:child_process'
import fs from 'node:fs'

// Files this server writes hold your prompts' metadata: yours alone.
export function writePrivate(file, text) {
  fs.writeFileSync(file, text, { mode: 0o600 })
  fs.chmodSync(file, 0o600)
}

export function run(command, args, options = {}) {
  return new Promise(resolve => {
    execFile(command, args, { timeout: 10000, maxBuffer: 8 * 1024 * 1024, ...options }, (error, stdout, stderr) => {
      resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) })
    })
  })
}

export function dayKey(time) {
  const date = new Date(time)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function baseName(filePath) {
  return filePath.split('/').filter(Boolean).at(-1) || filePath
}

export function log(...parts) {
  console.log(new Date().toISOString(), ...parts)
}

export function shellQuote(text) {
  return `'${String(text).replace(/'/g, `'\\''`)}'`
}

// A session name or a command argument: one line of printable text.
export function cleanLine(text, max) {
  return String(text || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}

// What is typed must stay one prompt: Claude Code reads backslash-Enter as a
// new line, and a leading / or ! would run a command or a shell line instead.
export function asTypedPrompt(text) {
  return guardLeading(stripControls(text))
}

// Escape, Ctrl-C, Ctrl-D and the like would act on the terminal, not be read.
export function stripControls(text) {
  return String(text).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
}

// A leading / or ! would run a command or a shell line instead of being read.
export function guardLeading(text) {
  return /^[\/!]/.test(text) ? ' ' + text : text
}

export const stripAnsi = text => String(text).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')

export const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
