// Validates the LIBRARY surface of @auckland-ai-collective/trundler-mcp:
// mount buildServer() in-process over an in-memory transport (no subprocess).
// This is the path the packaged Electron app would use to avoid spawning node.
import { buildServer, buildRegistry, DEFAULT_PROVIDER } from '@auckland-ai-collective/trundler-mcp'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'

const log = (...a) => console.log(...a)

async function main() {
  log('DEFAULT_PROVIDER =', DEFAULT_PROVIDER)
  log('registry providers =', buildRegistry().list?.() ?? '(no list())')

  const server = buildServer()
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)

  const client = new Client({ name: 'lib-check', version: '0.1.0' }, { capabilities: {} })
  await client.connect(clientTransport)

  const instructions = client.getInstructions?.() ?? ''
  const { tools } = await client.listTools()
  log('in-process connect OK')
  log('tools =', tools.length, '->', tools.map((t) => t.name).join(', '))
  log('instructions =', instructions ? `${instructions.length} chars` : '(none)')

  await client.close()
  await server.close()
  log('\nLibrary surface OK (in-process mount works).')
  process.exit(0)
}

main().catch((e) => {
  console.error('LIB CHECK FAILED:', e)
  process.exit(1)
})
