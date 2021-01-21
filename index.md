Look at the [Docco](./docco/) for now.

## On Breaking Things

Not a terribly good example, but an example none the less.

```
const Destructible = require('destructible')
const destructible = new Destructible('test')

const fs = require('fs')
const stream = fs.createReadStream(__filename)

destructible.durable('read', async () => {
    for await (const buffer of stream) {
        console.log(buffer)
    }
})
destructible.destruct(() => stream.close())

await destructible.promise
```

Destructible manages multiple running async functions and attempts to provide a
means by which to cancel them on shutdown.

I find this class terribly useful, but I've only recently converted it to
`async`/`await` and I'll have to harvest examples of its use from my code. These
act as notes to self so I can remind myself of the patterns I've created.

Imagine we have a `Processor` object that performs some asynchronous action and
that action can be stopped by calling `Processor.destroy()`.

```
destructible.durable('processor', processor.process(), () => processor.destroy())
```

Here we're doing something ephemeral, when a socket reader quits, it is not supposed
to shutdown all the other concurrent operations, but when the server closes it
should close all available sockets. (Wait, close doesn't fire until all the
sockets close.)

```
const server = net.createServer((socket) => {
    const reader = new Reader(socket)
    destructible.ephemeral([ 'socket', instance ++ ], reader.read(socket), () => reader.hangup())
})

destructible.durable('server', new Promise(resolve => server.once('close', resolve)))
```
