#!/usr/bin/env node
import { spawn } from 'node:child_process'

const commands = [
  ['proxy', 'npm', ['run', 'proxy']],
  ['vite', 'npm', ['run', 'dev']],
]

const children = commands.map(([name, command, args]) => {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env })

  child.stdout.on('data', (data) => process.stdout.write(`[${name}] ${data}`))
  child.stderr.on('data', (data) => process.stderr.write(`[${name}] ${data}`))
  child.on('exit', (code, signal) => {
    console.log(`[${name}] exited code=${code ?? 'null'} signal=${signal ?? 'null'}`)
    for (const other of children) {
      if (other !== child && !other.killed) other.kill('SIGTERM')
    }
  })

  return child
})

process.on('SIGINT', () => {
  for (const child of children) child.kill('SIGINT')
})

process.on('SIGTERM', () => {
  for (const child of children) child.kill('SIGTERM')
})
