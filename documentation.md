# Destructible

[![Actions Status](https://github.com/bigeasy/destructible/workflows/Node%20CI/badge.svg)](https://github.com/bigeasy/destructible/actions)
[![codecov](https://codecov.io/gh/bigeasy/destructible/branch/master/graph/badge.svg)](https://codecov.io/gh/bigeasy/destructible)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Controlled demoltion of `async`/`await` applications.

| What          | Where                                             |
| --- | --- |
| Discussion    | https://github.com/bigeasy/destructible/issues/1  |
| Documentation | https://bigeasy.github.io/destructible            |
| Source        | https://github.com/bigeasy/destructible           |
| Issues        | https://github.com/bigeasy/destructible/issues    |
| CI            | https://travis-ci.org/bigeasy/destructible        |
| Coverage:     | https://codecov.io/gh/bigeasy/destructible        |
| License:      | MIT                                               |


```
npm install destructible
```

Destructible provides a way of managing the shutdown of asynchronous operations
in an `async`/`await based Node.js application. It is incredibly useful, and yet
incredibly difficult to document, so for starters I've just left some notes to
myself that I can revise as time goes by and maybe it will be documentation
someday. You could look at the Docco, but that's not that much more useful.

Seems like any example is going to require some complexity to be meaningiful.
Although I am using Destructible in my application libraries so that examples
that illustrate application use can reflect composition. However, the
applications tend to be complicated.

Seems like the best examples would be based on a simple evented protocol like
we're reading standard in and writing to standard out.

```javascript
async function () {
    const Memento = require('memento')
    const Diffuser = require('diffuser')

    const memento = new Memento(destructible.durable('memento'), {
        directory: process.env.MEMENTO_DIRECTORY
    })

} ()
```

Destructible deals with the problem of multiple concurrent strands. A strand
represents a single `async`/`await` call stack in your application, it is the
spiritual equivalent of a thread. Not sure where I heard this mentioned, but I'm
pretty sure it's not my own coinage.

```javascript
async function ()
    const Destructible = require('destructible')
    const destructible = new Destructible('stranded.js')

    const latch = { resolve: null }, queue = []

    // Here we have a strand that reads stdin.
    destructible.durable('input', async function () {
        let previous = Buffer.alloc(0)
        for await (const buffer of process.stdin) {
            const combined = Buffer.concat([ previous, buffer ])
            let offset = 0
            for (;;) {
                const index = buffer.indexOf(0xa, offset)
                if (~index) {
                    const line = buffer.slice(offset, index)
                    queue.push(index)
                    latch.resolve()
                    offset = index + 1
                } else {
                    previous = buffer.slice(offset)
                    break
                }
            }
        }
    })

    // Here we have a strand that reads a queue.
    destructible.durable('main', async function ()
        while (! destructible.destroyed || this._queue.length != 0) {
            if (this._queue.length == 0) {
                await new Promise(rsolve => latch.resolve = resolve)
                continue
            }
            destructible.working()
            process.stdout(queue.shift())
        }
    })

    // TODO Somehow shutdown `stdin`, or maybe just `SIGINT` or end of stream?
    await destructible.destructed
} ()
```

Whatever this documentation does, it needs to first get this strand concept
down, otherwise Destructible is just some sort event emission system.

```javascript
async function () {
    const http = require('http')

    const Destructible = require('destructible')
    const destructible = new Destructible('program.js')

    const latch = { resolve: null }, queue = []

    destructible.durable('main', async function ()
        while (! destructible.destroyed || this._queue.length != 0) {
            if (this._queue.length == 0) {
                await new Promise(rsolve => latch.resolve = resolve)
                continue
            }
            destructible.working()
            const work = queue.shift()
            work.res.statusCode = 200
            work.res.setHeader('Content-Type', 'text/plain')
            work.res.end('Hello, World!\n')
        }
    })

    const server = http.createServer((req, res) => {
        queue.push({ res })
        latch.resolve()
    })

    server.listen(3000, '127.0.0.1', () => {
        console.log(`Server running at http://${hostname}:${port}/`);
    })

    destructible.destruct(() => server.close())

    process.on('SIGTERM', () => destructible.destroy())

    await destructible.destructed
} ()
```

Anyway...

The purpose of destructible is to stop all these strands when it comes time to
shutdown. It is also supposed to monitor all these strands so that if more than
one strand throws an exception, your application can produce an exception that
reports both exceptions. If your disk is full and you're saving an image upload,
you can't write the meta data to the database, nor can you write the image to
file, so two background processes stop working.

Also, when you shutdown you want to wait for all your strands to return, and if
they don't return you want know that they didn't. You've written a loop
somewhere that doesn't know how to exit. I'm convinced that > 90% of Node.js
code can only shutdown with `kill -9` in production.

Destructible creates a tree. You can destroy the root and that will trigger a
shutdown of everything under the tree. This is important. Note this.

### `new Destructible([timeout], key, ...context)`

Construct a root destructible. `timeout` is the amount of time to wait for all
strands to exit, the default is one second. If there are strands that have not
returned after one second `Destructible` will scram and report an exception that
lists all the lingering stands. If you have work to do at shutdown time, you can
increase the timeout or else you can use the `destructible.working()` function
to tell `Destructible` you're making progress, but need more time.

Note that there is no concept of hard shutdown versus soft shutdown. You can
create this in your application by setting a flag, or by simply scurring through
work if `destructible.destroyed` is true. You may decide that all your open HTTP
requests should just immediately return `503`, instead of processing the
request.

### `destructible.working()`
