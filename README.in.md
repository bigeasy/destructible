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
//{ "mode": "text" }
npm install destructible
```

Destructible manages the concurrent asynchronous code paths in your application.
At the very least, it provides the functionality of `Promise.allSettled()` but
with dependencies, error handling and reporting, and cancellation.


This `README.md` is also a unit test using the Proof unit test framework. We'll
use the Proof `okay` function to assert out statements in the readme. A Proof
unit test generally looks like this.

```javascript
//{ "code": { "tests": 18 }, "text": { "tests": 4  } }
require('proof')(%(tests)d, async okay => {
    //{ "include": "testRequire" }
    //{ "include": "test" }
    okay('always okay')
    okay(true, 'okay if true')
    okay(1, 1, 'okay if equal')
    okay({ value: 1 }, { value: 1 }, 'okay if deep strict equal')
})
```

You can run this unit test yourself.

```text
//{ "mode": "text" }
git clone git@github.com:bigeasy/destructible.git
cd destructible
npm install --no-package-lock --no-save
make
node test/readme.t.js
```

The `'destructible'` module exports a single `Destructible` object.

```javascript
//{ "name": "displayedRequire", "mode": "text" }
const Destructible = require('destructible')
```

```javascript
//{ "name": "testRequire", "mode": "code" }
const Destructible = require('..')
```

Basic destructible usage.

```javascript
//{ "name": "test" }
{
    const destructible = new Destructible('example')

    const work = [ 1, 2, 3, 4 ].map(work => Promise.resolve(work))

    let sum = 0
    destructible.ephemeral('loop', async () => {
        while (work.length != 0) {
            sum += await work.shift()
        }
    })

    await destructible.destroy().promise

    okay(sum, 10, 'basic destructible')
}
```

## Destructing With Errors

Destructible does not provide any sort of error recovery mechanism, it assumes
that you will perform any error recovery in your appliction strands using
`try`/`catch` or what-have-you. If a strand rejects, the Destructible will be
destroyed and destruction will begin.

There is however an error notification mechanism so that your services can
detect when the failure of other services so that they don't attempt to perform
an orderly shutdown when the services they depend upon are in an unstable state.

If you have a database service fails a single write for some reason, it should
probably not perform its ordinary database shutdown procedure when stacks are
unwinding and the program is headed for oblivion. It would be better to perform
a recovery procedure after the system administrator investigates the fault and
restarts the program.

You can determine if a Destructible exited with an error using the `errored`
property. This is a synchronous property that will return `false` until the
Destructible destructs, then it will return return `true` if the Destruction was
due to an error.

This property exists on all the Destructibles in the destructible tree. If any
fail then all destructibles will have their errored property set, so the
`errored` property is really a property of the destructible tree, not of any
individual destructible itself.

```javascript
//{ "name": "test", "unblock": true }
{
    const destructible = new Destructible('destructible')

    const child = destructible.durable('child')
    const sibling = destructible.durable('sibling')

    child.durable('errored', async () => { throw new Error('reject') })

    try {
        await destructible.promise
    } catch (error) {
        okay(child.errored, 'child errored')
        okay(sibling.errored, 'sibling errored')
        okay(destructible.errored, 'parent errored')
        okay(child.errored && sibling.errored && destructible.errored, 'everyone errored')
    }
}
```

An error in one service is not always an error in every service. Using our
database service example, an error in the database service means that all other
services should stop work since their work cannot be saved. But an error in a
service that depends on the database service shouldn't stop the database service
from saving the writes it has queued and shutting down in an orderly fashion.

We can isolate errors in sub-trees of the destructible tree using the `isolated`
property when we create a sub-destructible. When an error occurs outside of the
isolated sub-tree, the destructibles in the isolated sub-tree will not have
their `errored` property set.

```javascript
//{ "name": "test", "unblock": true }
{
    const destructible = new Destructible('top')

    const outside = destructible.durable('outside')
    const group = destructible.durable({ isolated: true }, 'group')
    const sibling = group.durable('sibling')
    outside.durable('errored', async () => { throw new Error('error') })
    try {
        await destructible.promise
    } catch (error) {
        okay(destructible.errored, 'root errored')
        okay(!group.errored, 'group errored')
        okay(!group.sibling, 'sibling errored')
        okay(outside.errored, 'outside errored')
    }
}
```

When an error occurs inside of the isolated sub-tree, the destructibles outside
the isolated sub-tree _will_ have their `errored` property set.

```javascript
//{ "name": "test", "unblock": true }
{
    const destructible = new Destructible('top')

    const outside = destructible.durable('outside')
    const group = destructible.durable({ isolated: true }, 'group')
    const sibling = group.durable('sibling')
    group.durable('errored', async () => { throw new Error('error') })
    try {
        await destructible.promise
    } catch (error) {
        okay(destructible.errored, 'root errored')
        okay(sibling.errored, 'sibling errored')
        okay(outside.errored, 'outside errored')
    }
}
```

Error can occur after destruction.

At destruction a service might wait for another service to drain but will skip
the drain if the destructible tree is `errored` because the drain might never
come. If the destructible tree enters an `errored` state after destruction, this
service has already begin waiting. It needs a way to be notified so it can
cancel its wait on drain.

For this notification we can register a panic handler using `panic()`. The panic
handler must be synchronous. It can launch new ephemerals, but I doubt that's a
good idea. If I do so myself I'll come back and talk about the use case.

The panic handler is supposed in indicate that an error occurred _after_
shutdown, not before. The `panic()` handler will only be called after
`destruct()` and only if the the destructible was not already `errored` when it
was destructed.

In this example the shutdown of a consumer is expecting an a producer to signal
it is done by releasing a `drain` latch. Before the producer can release the
latch, however, it raises an exception. The consumer registered a panic handler
that will release the latch itself so that the consumer shutdown will complete.

```javascript
//{ "name": "test", "unblock": true }
{
    const destructible = new Destructible('destructible')

    const test = []

    const drain = function () {
        let capture
        return {
            promise: new Promise(resolve => capture = { resolve }),
            ...capture
        }
    } ()

    const producer = destructible.durable('producer')
    producer.destruct(() => test.push(`producer errored: ${producer.errored}`))
    producer.panic(() => test.push('producer panicked'))

    const consumer = destructible.ephemeral('consumer')
    consumer.destruct(() => {
        test.push(`consumer errored: ${consumer.errored}`)
        consumer.ephemeral('shutdown', async () => {
            await drain.promise
        })
    })
    consumer.panic(() => {
        test.push('consumer panicked')
        drain.resolve()
    })
    consumer.destroy()

    producer.durable('rejected', async () => {
        throw new Error('reject')
        drain.resolve()
    })

    try {
        await destructible.promise
    } catch (error) {
        okay(test, [
            'consumer errored: false', 'consumer panicked', 'producer errored: true'
        ], 'panic')
    }
}
```

Panic handlers will not run if the destructible resolves or scrams.

In this example we wait for the sibling to shutdown completely before the child
raises an exception. Because the sibling shutdown completely, it's panic handler
is not called.

```javascript
//{ "name": "test", "unblock": true }
{
    const destructible = new Destructible('destructible')

    const panic = []

    const child = destructible.durable('child')
    child.panic(() => panic.push('child panicked'))

    const sibling = destructible.ephemeral('sibling')
    sibling.panic(() => panic.push('sibling panicked'))
    sibling.destroy()

    await sibling.promise

    child.durable('rejected', async () => { throw new Error('reject') })

    try {
        await destructible.promise
    } catch (error) {
        okay(panic, [], 'no panic')
    }
}
```

After destruction service might be waiting for another service to drain but that
drain notification might never arrive be

You can use the errored property to determine if an operation should be
performed or skipped during. If you have a work queue, once errored you
may decide to skip the work in the queue and let the queue empty quickly.
You may have shutdown ephemerals strands that you won't perform on error
exit.

In our database example, we might write some state information to disk
so that the next time the program runs it can resume quickly. If the
database is in a bad state we probably don't want to write the state
information because we can't trust it.

**TODO** Code exmaple.

At times we might want to isolate the error property in our tree, so that
a particular sub-tree will not be marked as errored if the error occured
in a branch outside the sub-tree.

In our database example, we might have an error originating outside the
strands that compose the database. The database itself is in a fine state
and can perform an orderly shutdown, so it may as well attempt to do so.

**TODO** Code exmaple.

If we've isolated a sub-tree, there may be times when a service in that
sub-tree is doing work in an unknown strand. Our database may do its
writes in a work queue that is managed by a queue service. If the
database write fails and it throws an exception, it will get caught by
the queue service strand and shut it down with an error, but we need to
keep the queue running so other services besides the database can clean
up. We'd rather have the destructible associated with database service
report the exception instead of the destructible associated with the
queue service.